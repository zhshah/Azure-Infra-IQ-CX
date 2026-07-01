/**
 * Cost Allocation View — dimension picker + stacked bar + donut + drill-down table
 * Live Azure Cost Management data
 */
import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Download, RefreshCw, AlertCircle, Layers } from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct, CHART_COLORS, DIMENSION_OPTIONS } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import DateRangePicker from './DateRangePicker'
import SearchableSelect from '../components/shared/SearchableSelect'
import EnterpriseCard from '../components/shared/EnterpriseCard'

export default function AllocationView() {
  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [dimension, setDimension] = useState('SubscriptionId')
  const [timeRange, setTimeRange] = useState('last_30d')
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [view,      setView]      = useState('bar')   // 'bar' | 'donut'
  const [tablePage, setTablePage] = useState(0)
  const PAGE_SIZE = 20
  const abortRef  = useRef(null)
  const debounceRef = useRef(null)

  const load = async () => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true); setError(null); setTablePage(0)
    try {
      const d = await finopsApi.getAllocation(dimension, timeRange, dateFrom || undefined, dateTo || undefined, ctrl.signal)
      if (!ctrl.signal.aborted) setData(d)
    } catch (e) { if (e.name !== 'AbortError') setError(e.message) }
    finally { if (!ctrl.signal.aborted) setLoading(false) }
  }

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(), 300)
    return () => clearTimeout(debounceRef.current)
  }, [dimension, timeRange, dateFrom, dateTo])

  // Cleanup on unmount
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort() }, [])

  const items   = useMemo(() => (
    (data?.items || []).map(it => ({ ...it, dimension_value: it.dimension_value || '(unassigned)' }))
  ), [data])
  const pieData = useMemo(() => (
    items.map((it, i) => ({ name: it.dimension_value, value: it.cost_usd, color: CHART_COLORS[i % CHART_COLORS.length] }))
  ), [items])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <FinOpsAIPanel view="allocation" data={data ? { dimension, time_range: timeRange, total_usd: data.total_usd, unallocated_usd: data.unallocated_usd, unallocated_pct: data.unallocated_pct, top_items: (data.items || []).slice(0, 10).map(i => ({ name: i.dimension_value, cost: i.cost_usd })) } : {}} />
      {/* Header + controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Cost Allocation</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>Live Azure data — group by any dimension to allocate costs</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: 170 }}>
            <SearchableSelect value={dimension} onChange={setDimension} options={DIMENSION_OPTIONS} placeholder="Group by…" compact />
          </div>
          <DateRangePicker
            value={timeRange} onChange={v => { setTimeRange(v); if (v !== 'custom') { setDateFrom(''); setDateTo('') } }}
            dateFrom={dateFrom} dateTo={dateTo}
            onDateFromChange={setDateFrom} onDateToChange={setDateTo}
          />
          <button onClick={() => finopsApi.exportAllocationXlsx(dimension, timeRange, dateFrom, dateTo)} title="Download XLSX" style={{
            background: 'var(--c-0d2b1f)', border: '1px solid var(--c-166534)', borderRadius: 6,
            padding: '5px 10px', cursor: 'pointer', color: 'var(--c-4ade80)', fontSize: 11,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Download size={12} /> XLSX
          </button>
          <div style={{ display: 'flex', gap: 4 }}>
            {['bar', 'donut'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                background: view === v ? 'var(--c-1e293b)' : 'none', border: `1px solid ${view === v ? 'var(--c-334155)' : 'transparent'}`,
                borderRadius: 5, padding: '5px 10px', cursor: 'pointer', color: view === v ? 'var(--c-e2e8f0)' : 'var(--c-475569)', fontSize: 11,
              }}>
                {v === 'bar' ? 'Bar' : 'Donut'}
              </button>
            ))}
          </div>
          {data && (
            <button onClick={() => finopsApi.downloadCsv(dimension, timeRange).catch(e => console.error('CSV export:', e))}
              style={{
                background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6,
                padding: '5px 10px', color: 'var(--c-94a3b8)', fontSize: 11, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
              <Download size={12} /> CSV
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20 }}>
          <RefreshCw size={16} className="animate-spin" style={{ color: '#3b82f6' }} />
          <span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>Loading allocation data…</span>
        </div>
      )}
      {error && (
        <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 8, padding: 12, color: 'var(--c-fca5a5)', fontSize: 12, display: 'flex', gap: 8 }}>
          <AlertCircle size={14} />{error}
        </div>
      )}

      {data && (
        <>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            {[
              { label: 'Total Allocated', value: fmtUsd(data.total_usd), color: '#3b82f6' },
              { label: 'Unallocated', value: fmtUsd(data.unallocated_usd), color: '#f59e0b' },
              { label: 'Coverage', value: fmtPct(100 - (data.unallocated_pct || 0)), color: '#22c55e' },
              { label: 'Groups', value: items.length, color: 'var(--c-94a3b8)' },
            ].map(c => (
              <div key={c.label} style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>{c.label}</div>
                <div style={{ color: c.color, fontSize: 18, fontWeight: 700 }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
            <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, marginBottom: 12 }}>
              {data.dimension_label} · {data.period_label}
            </div>
            {view === 'bar' ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={items.slice(0, 20)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#475569', fontSize: 10 }} tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
                  <YAxis type="category" dataKey="dimension_value" tick={{ fill: '#94a3b8', fontSize: 10 }} width={140} />
                  <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }} formatter={v => fmtUsd(v, 2)} />
                  <Bar dataKey="cost_usd" name="Cost (USD)" radius={[0, 4, 4, 0]}>
                    {items.slice(0, 20).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={pieData.slice(0, 12)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110} innerRadius={55} paddingAngle={2}>
                    {pieData.slice(0, 12).map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={v => fmtUsd(v, 2)} contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: 'var(--c-94a3b8)' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Drill-down table */}
          <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
            <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Breakdown</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>{['Dimension', 'Cost (USD)', '% of Total', 'MoM Δ'].map(h => (
                  <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {items.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE).map((it, i) => {
                  const globalIdx = tablePage * PAGE_SIZE + i
                  return (
                    <tr key={globalIdx} style={{ borderBottom: '1px solid var(--c-0f172a)' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: CHART_COLORS[globalIdx % CHART_COLORS.length], flexShrink: 0 }} />
                        <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.dimension_value}>{it.dimension_value}</span>
                      </td>
                      <td style={{ padding: '6px 8px', color: '#3b82f6', fontWeight: 600 }}>{fmtUsd(it.cost_usd, 2)}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-64748b)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ height: 4, width: `${Math.min(it.cost_pct || 0, 100)}%`, background: CHART_COLORS[globalIdx % CHART_COLORS.length], borderRadius: 2, maxWidth: 80 }} />
                          {it.cost_pct}%
                        </div>
                      </td>
                      <td style={{ padding: '6px 8px', color: (it.mom_delta_pct ?? 0) > 5 ? '#f87171' : (it.mom_delta_pct ?? 0) < -5 ? '#4ade80' : 'var(--c-64748b)' }}>
                        {it.mom_delta_pct != null ? `${it.mom_delta_pct > 0 ? '+' : ''}${it.mom_delta_pct}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {items.length > PAGE_SIZE && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 11, color: 'var(--c-64748b)' }}>
                <span>Showing {tablePage * PAGE_SIZE + 1}–{Math.min((tablePage + 1) * PAGE_SIZE, items.length)} of {items.length}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setTablePage(p => Math.max(0, p - 1))} disabled={tablePage === 0}
                    style={{ background: 'var(--c-1e293b)', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: tablePage === 0 ? 'default' : 'pointer', color: tablePage === 0 ? 'var(--c-334155)' : 'var(--c-94a3b8)', fontSize: 11 }}>
                    ← Prev
                  </button>
                  <button onClick={() => setTablePage(p => Math.min(Math.ceil(items.length / PAGE_SIZE) - 1, p + 1))} disabled={(tablePage + 1) * PAGE_SIZE >= items.length}
                    style={{ background: 'var(--c-1e293b)', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: (tablePage + 1) * PAGE_SIZE >= items.length ? 'default' : 'pointer', color: (tablePage + 1) * PAGE_SIZE >= items.length ? 'var(--c-334155)' : 'var(--c-94a3b8)', fontSize: 11 }}>
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
