/**
 * Cross-domain Cost Lens — ties SPEND to resiliency / security / governance posture.
 * The differentiator: "how much are we spending on unprotected / exposed / ungoverned
 * resources?" — answers the Azure Portal cannot give in one view.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { ShieldAlert, ShieldCheck, Landmark, RefreshCw, AlertCircle, ExternalLink, ChevronRight, Download } from 'lucide-react'
import { finopsApi, fmtUsd } from './finopsApi'

const card      = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const miniLabel = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }
const secLabel  = { color: 'var(--c-e2e8f0)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }

const LENSES = [
  { id: 'resiliency', label: 'Resiliency', icon: ShieldCheck, color: '#22c55e' },
  { id: 'security',   label: 'Security',   icon: ShieldAlert, color: '#ef4444' },
  { id: 'governance', label: 'Governance', icon: Landmark,    color: '#a855f7' },
]
const BAR_COLORS = ['#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#22c55e']

export default function CostLens() {
  const [lens, setLens]       = useState('resiliency')
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(async (l) => {
    setLoading(true); setError(null); setExpanded(null)
    try { setData(await finopsApi.getCostLens(l)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(lens) }, [lens, load])

  const buckets = data?.buckets || []
  const chartData = buckets.map(b => ({ name: b.label, value: b.monthly_usd, count: b.resource_count }))
  const meta = LENSES.find(l => l.id === lens) || LENSES[0]

  const exportXlsx = () => {
    if (!buckets.length) return
    finopsApi.exportGenericXlsx({
      title: `Cost Lens - ${meta.label}`,
      sheets: [{
        name: meta.label,
        columns: ['Bucket', 'Monthly cost (USD)', 'Resource count'],
        rows: buckets.map(b => [b.label, b.monthly_usd, b.resource_count]),
      }],
    }).catch(() => {})
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
          <ShieldAlert size={20} style={{ color: '#a855f7' }} /> Cost Lens
        </h2>
        <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '4px 0 0' }}>
          Spend viewed through your resiliency, security &amp; governance posture — what your risk is actually costing.
        </p>
      </div>

      {/* Lens tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {LENSES.map(l => {
          const Icon = l.icon
          const on = lens === l.id
          return (
            <button key={l.id} onClick={() => setLens(l.id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: on ? `${l.color}22` : 'var(--c-0b1220)', border: `1px solid ${on ? l.color : 'var(--c-334155)'}`, color: on ? l.color : 'var(--c-94a3b8)',
            }}>
              <Icon size={15} /> {l.label}
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        {buckets.length > 0 && (
          <button onClick={exportXlsx} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 12 }}>
            <Download size={13} /> Export
          </button>
        )}
        <button onClick={() => load(lens)} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 12 }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div style={{ ...card, borderColor: 'var(--c-7f1d1d)', color: 'var(--c-fca5a5)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ fontSize: 12 }}>{error}</span>
        </div>
      )}

      {/* Exposure KPIs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 160 }}>
          <div style={miniLabel}>Exposed spend ({meta.label})</div>
          <div style={{ color: meta.color, fontSize: 22, fontWeight: 700 }}>{fmtUsd(data?.exposed_spend_usd)}/mo</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>{data?.exposed_pct ?? 0}% of tracked spend</div>
        </div>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 160 }}>
          <div style={miniLabel}>Tracked spend</div>
          <div style={{ color: 'var(--c-f1f5f9)', fontSize: 22, fontWeight: 700 }}>{fmtUsd(data?.total_spend_usd)}/mo</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>{data?.resource_count ?? 0} resources</div>
        </div>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 160 }}>
          <div style={miniLabel}>Exposure areas</div>
          <div style={{ color: 'var(--c-f1f5f9)', fontSize: 22, fontWeight: 700 }}>{buckets.filter(b => b.resource_count > 0).length}</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>categories flagged</div>
        </div>
      </div>

      {/* Chart */}
      <div style={card}>
        <div style={secLabel}><meta.icon size={16} style={{ color: meta.color }} /> {meta.label} exposure by category ($/mo)</div>
        {loading && !buckets.length ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-64748b)' }}><RefreshCw size={16} className="animate-spin" /> Loading…</div>
        ) : chartData.some(d => d.value > 0) ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--c-1e293b)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--c-64748b)' }} tickFormatter={v => fmtUsd(v)} />
              <YAxis type="category" dataKey="name" width={210} tick={{ fontSize: 11, fill: 'var(--c-cbd5e1)' }} />
              <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }} formatter={(v, n, p) => [`${fmtUsd(v)} · ${p.payload.count} resources`, 'Exposed']} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {chartData.map((d, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ padding: 30, textAlign: 'center', color: '#22c55e', fontSize: 12 }}>No {meta.label.toLowerCase()} exposure detected in the tracked estate. ✓</div>
        )}
      </div>

      {/* Buckets */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {buckets.map(b => (
          <div key={b.key} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: b.resource_count ? 'pointer' : 'default' }}
                 onClick={() => b.resource_count && setExpanded(expanded === b.key ? null : b.key)}>
              <div>
                <div style={{ color: 'var(--c-f1f5f9)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
                  {b.resource_count > 0 && <ChevronRight size={14} style={{ color: 'var(--c-64748b)', transform: expanded === b.key ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />}
                  {b.label}
                </div>
                <div style={{ color: 'var(--c-64748b)', fontSize: 11, marginTop: 3, marginLeft: b.resource_count ? 21 : 0 }}>{b.recommendation}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ color: b.monthly_usd > 0 ? meta.color : 'var(--c-64748b)', fontSize: 16, fontWeight: 700 }}>{fmtUsd(b.monthly_usd)}/mo</div>
                <div style={{ color: 'var(--c-64748b)', fontSize: 11 }}>{b.resource_count} resources</div>
              </div>
            </div>
            {expanded === b.key && b.resources?.length > 0 && (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--c-1e293b)', paddingTop: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ color: 'var(--c-64748b)', textAlign: 'left' }}>
                    {['Resource', 'Type', 'Resource group', '$ / month', ''].map((h, i) => <th key={i} style={{ padding: '5px 8px', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {b.resources.map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--c-1e293b)' }}>
                        <td style={{ padding: '6px 8px', color: 'var(--c-cbd5e1)' }}>{r.resource_name}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--c-64748b)' }}>{r.resource_type}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--c-64748b)' }}>{r.resource_group}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)', fontWeight: 600 }}>{r.monthly_usd > 0 ? fmtUsd(r.monthly_usd) : '—'}</td>
                        <td style={{ padding: '6px 8px' }}>{r.portal_url && <a href={r.portal_url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', display: 'inline-flex' }}><ExternalLink size={13} /></a>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
