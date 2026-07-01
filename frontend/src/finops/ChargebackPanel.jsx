/**
 * Chargeback Panel — CostCenter-based cost allocation
 * Sourced from Azure Cost Management group_by=[TagKey:CostCenter]
 */
import React, { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Download, RefreshCw, AlertCircle } from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct, CHART_COLORS } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import DateRangePicker from './DateRangePicker'

export default function ChargebackPanel() {
  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [timeRange, setTimeRange] = useState('last_30d')
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')

  const load = async () => {
    setLoading(true); setError(null)
    try { setData(await finopsApi.getChargeback(timeRange, dateFrom || undefined, dateTo || undefined)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [timeRange, dateFrom, dateTo])

  const entries = data?.entries || []
  const pieData = entries.filter(e => e.cost_center !== '(Unallocated)').map((e, i) => ({
    name: e.cost_center, value: e.allocated_cost_usd, color: CHART_COLORS[i % CHART_COLORS.length],
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <FinOpsAIPanel view="chargeback" data={data ? { time_range: timeRange, total_allocated_usd: data.total_allocated_usd, total_unallocated_usd: data.total_unallocated_usd, coverage_pct: data.coverage_pct, top_centers: (data.entries || []).slice(0, 10).map(e => ({ center: e.cost_center, cost: e.allocated_cost_usd, coverage: e.coverage_pct })) } : {}} />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Chargeback Report</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>
            Cost by CostCenter tag — sourced from Azure Cost Management API
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <DateRangePicker
            value={timeRange} onChange={v => { setTimeRange(v); if (v !== 'custom') { setDateFrom(''); setDateTo('') } }}
            dateFrom={dateFrom} dateTo={dateTo}
            onDateFromChange={setDateFrom} onDateToChange={setDateTo}
          />
          {data && (
            <button onClick={() => finopsApi.exportAllocationXlsx('TagKey:CostCenter', timeRange, dateFrom, dateTo)} title="Download XLSX" style={{
              background: 'var(--c-0d2b1f)', border: '1px solid var(--c-166534)', borderRadius: 6,
              padding: '5px 10px', cursor: 'pointer', color: 'var(--c-4ade80)', fontSize: 11,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Download size={12} /> XLSX
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20 }}>
          <RefreshCw size={16} className="animate-spin" style={{ color: '#3b82f6' }} />
          <span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>Loading…</span>
        </div>
      )}
      {error && (
        <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 8, padding: 12, color: 'var(--c-fca5a5)', fontSize: 12, display: 'flex', gap: 8 }}>
          <AlertCircle size={14} />{error}
        </div>
      )}

      {data && entries.length === 0 && (
        <div style={{ color: 'var(--c-334155)', fontSize: 12, textAlign: 'center', padding: 40 }}>
          No chargeback data found for this period. Apply a CostCenter tag to resources for full chargeback coverage.
        </div>
      )}

      {data && entries.length > 0 && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {[
              { label: 'Total Allocated',  value: fmtUsd(data.total_allocated_usd),   color: '#3b82f6' },
              { label: 'Unallocated',      value: fmtUsd(data.total_unallocated_usd), color: '#f59e0b' },
              { label: 'Tag Coverage',     value: fmtPct(data.coverage_pct),           color: '#22c55e' },
              { label: 'Cost Centers',     value: entries.filter(e => e.cost_center !== '(Unallocated)').length, color: 'var(--c-94a3b8)' },
            ].map(c => (
              <div key={c.label} style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>{c.label}</div>
                <div style={{ color: c.color, fontSize: 18, fontWeight: 700 }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Coverage warning */}
          {data.coverage_pct < 80 && (
            <div style={{ background: 'var(--c-1c1003)', border: '1px solid #854d0e', borderRadius: 8, padding: 12, fontSize: 12, color: 'var(--c-fbbf24)', display: 'flex', gap: 8 }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              Only {fmtPct(data.coverage_pct)} of spend has a CostCenter tag. Apply the CostCenter tag to remaining resources for full chargeback coverage.
            </div>
          )}

          {/* Pie + table */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
            {/* Pie */}
            <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
              <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>By Cost Center</div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={45} paddingAngle={2}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={v => fmtUsd(v, 2)} contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }} />
                  <Legend iconSize={9} wrapperStyle={{ fontSize: 10, color: 'var(--c-94a3b8)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
              <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
                Detail — {data.period_label}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>{['Cost Center', 'Allocated (USD)', 'Coverage %', 'Top Service'].map(h => (
                    <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)', fontWeight: 600 }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const topSvc = Object.entries(e.by_service || {}).sort((a, b) => b[1] - a[1])[0]
                    const isUnalloc = e.cost_center === '(Unallocated)'
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--c-0f172a)', opacity: isUnalloc ? 0.6 : 1 }}>
                        <td style={{ padding: '6px 8px', color: isUnalloc ? '#f59e0b' : 'var(--c-e2e8f0)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {!isUnalloc && <div style={{ width: 8, height: 8, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />}
                          {e.cost_center}
                        </td>
                        <td style={{ padding: '6px 8px', color: '#3b82f6', fontWeight: 600 }}>{fmtUsd(e.allocated_cost_usd, 2)}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--c-64748b)' }}>{fmtPct(e.coverage_pct)}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--c-475569)', fontSize: 11 }}>{topSvc ? topSvc[0] : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
