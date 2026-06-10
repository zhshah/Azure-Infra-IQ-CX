/**
 * Savings Summary — Consolidated savings opportunities
 * RI recommendations (Azure native) + rightsize + waste + orphan
 */
import React, { useState, useEffect } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { RefreshCw, AlertCircle, Download } from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct, CHART_COLORS } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'

const CATEGORY_COLORS = {
  ri_purchase: '#3b82f6',
  rightsize:   '#8b5cf6',
  waste:       '#f59e0b',
  orphan:      '#ef4444',
  licensing:   '#06b6d4',
}
const CATEGORY_LABELS = {
  ri_purchase: 'Reserve Instance',
  rightsize:   'Right-Size',
  waste:       'Waste Cleanup',
  orphan:      'Orphan Resource',
  licensing:   'Licensing',
}
const EFFORT_COLORS = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' }

export default function SavingsSummary() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [filter,  setFilter]  = useState('all')

  const load = async () => {
    setLoading(true); setError(null)
    try { setData(await finopsApi.getSavings()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 10 }}>
      <RefreshCw size={18} className="animate-spin" style={{ color: '#3b82f6' }} /><span style={{ color: '#94a3b8' }}>Loading savings analysis…</span>
    </div>
  )
  if (error) return (
    <div style={{ background: '#1a0e0e', border: '1px solid #7f1d1d', borderRadius: 10, padding: 16, color: '#fca5a5', display: 'flex', gap: 8 }}>
      <AlertCircle size={16} /><span style={{ fontSize: 12 }}>{error}</span>
    </div>
  )
  if (!data) return null

  const allOpps = data.opportunities || []
  const visible  = filter === 'all' ? allOpps : allOpps.filter(o => o.category === filter)

  // Category summary cards
  const catSummary = Object.entries(data.by_category || {}).sort((a, b) => b[1] - a[1])

  // Scatter data (effort vs savings)
  const EFFORT_X = { low: 1, medium: 2, high: 3 }
  const scatterData = (filter === 'all' ? allOpps : allOpps.filter(o => o.category === filter)).map(o => ({
    x: EFFORT_X[o.effort] || 1,
    y: o.potential_savings_usd,
    z: Math.max(50, Math.min(o.potential_savings_usd / 10, 500)),
    cat: o.category,
    name: o.resource_name,
    savings: o.potential_savings_usd,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <FinOpsExportMenu view="savings" focusDays={30} onXlsx={() => finopsApi.downloadReport()} report={{ title: 'Savings Optimizer', kpis: [{ label: 'Identified', value: fmtUsd(data.total_identified_usd) }, { label: 'Opportunities', value: String(data.opportunity_count ?? 0) }], tables: [{ title: 'Top Opportunities', columns: ['Resource', 'Category', 'Savings'], rows: (data.opportunities || []).slice(0, 30).map(o => [o.resource_name || '-', o.category || '-', fmtUsd(o.potential_savings_usd ?? 0)]) }] }} />
      </div>
      <FinOpsAIPanel view="savings" data={{ total_identified_usd: data.total_identified_usd, opportunity_count: data.opportunity_count, by_category: data.by_category, top_opportunities: (data.opportunities || []).slice(0, 10).map(o => ({ name: o.resource_name, savings: o.potential_savings_usd, category: o.category, effort: o.effort })) }} />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 700, margin: 0 }}>Savings Optimizer</h2>
          <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>
            Azure-native RI recommendations + rightsize + waste analysis
          </p>
        </div>
        <button onClick={load} style={{
          background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
          padding: '5px 10px', cursor: 'pointer', color: '#94a3b8', fontSize: 11,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Total savings hero */}
      <div style={{ background: 'linear-gradient(135deg, #052e16 0%, #0f172a 100%)', border: '1px solid #166534', borderRadius: 12, padding: 20, textAlign: 'center' }}>
        <div style={{ color: '#86efac', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Identified Savings</div>
        <div style={{ color: '#4ade80', fontSize: 36, fontWeight: 800, margin: '8px 0' }}>{fmtUsd(data.total_identified_usd)}</div>
        <div style={{ color: '#64748b', fontSize: 12 }}>{data.opportunity_count} opportunities across {catSummary.length} categories</div>
      </div>

      {/* Category breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {catSummary.map(([cat, savings]) => (
          <button
            key={cat}
            onClick={() => setFilter(filter === cat ? 'all' : cat)}
            style={{
              background: filter === cat ? '#1e293b' : '#111827',
              border: `1px solid ${filter === cat ? (CATEGORY_COLORS[cat] || '#334155') : '#1e293b'}`,
              borderRadius: 8, padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: CATEGORY_COLORS[cat] || '#64748b', marginBottom: 6 }} />
            <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{CATEGORY_LABELS[cat] || cat}</div>
            <div style={{ color: '#4ade80', fontSize: 16, fontWeight: 700, marginTop: 4 }}>{fmtUsd(savings)}</div>
          </button>
        ))}
      </div>

      {/* Effort vs Savings scatter */}
      {scatterData.length > 0 && (
        <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 16 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
            Opportunity Matrix — Effort vs Savings (size = savings magnitude)
          </div>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 10 }}>X: Low effort → High effort · Y: Monthly savings (USD)</div>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis type="number" dataKey="x" domain={[0.5, 3.5]} tick={{ fill: '#475569', fontSize: 10 }}
                tickFormatter={v => v === 1 ? 'Low' : v === 2 ? 'Medium' : 'High'} />
              <YAxis type="number" dataKey="y" tick={{ fill: '#475569', fontSize: 10 }}
                tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
              <ZAxis type="number" dataKey="z" range={[40, 400]} />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]?.payload
                  return (
                    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', fontSize: 11 }}>
                      <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{d.name || 'Resource'}</div>
                      <div style={{ color: '#4ade80' }}>Savings: {fmtUsd(d.savings, 2)}</div>
                    </div>
                  )
                }}
              />
              <Scatter data={scatterData}>
                {scatterData.map((d, i) => (
                  <Cell key={i} fill={CATEGORY_COLORS[d.cat] || CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Opportunities table */}
      <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
            {filter === 'all' ? 'All Opportunities' : CATEGORY_LABELS[filter]} ({visible.length})
          </div>
          {filter !== 'all' && (
            <button onClick={() => setFilter('all')} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 11 }}>Clear filter</button>
          )}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>{['Resource', 'Category', 'Monthly Savings', 'Savings %', 'Effort', 'Confidence', 'Action'].map(h => (
              <th key={h} style={{ textAlign: 'left', color: '#475569', padding: '5px 8px', borderBottom: '1px solid #1e293b' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {visible.slice(0, 50).map((o, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #0f172a' }}>
                <td style={{ padding: '6px 8px', color: '#e2e8f0', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.resource_name || o.resource_type}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <span style={{ color: CATEGORY_COLORS[o.category] || '#94a3b8', fontSize: 10 }}>
                    {CATEGORY_LABELS[o.category] || o.category}
                  </span>
                </td>
                <td style={{ padding: '6px 8px', color: '#4ade80', fontWeight: 600 }}>{fmtUsd(o.potential_savings_usd, 2)}</td>
                <td style={{ padding: '6px 8px', color: '#4ade80' }}>{fmtPct(o.savings_pct)}</td>
                <td style={{ padding: '6px 8px', color: EFFORT_COLORS[o.effort] || '#94a3b8', fontSize: 10 }}>{o.effort}</td>
                <td style={{ padding: '6px 8px', color: o.confidence === 'high' ? '#4ade80' : o.confidence === 'medium' ? '#f59e0b' : '#94a3b8', fontSize: 10 }}>{o.confidence}</td>
                <td style={{ padding: '6px 8px', color: '#64748b', fontSize: 11, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.action}>
                  {o.action}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length > 50 && (
          <div style={{ color: '#475569', fontSize: 11, marginTop: 8, textAlign: 'center' }}>Showing top 50 of {visible.length}</div>
        )}
      </div>
    </div>
  )
}
