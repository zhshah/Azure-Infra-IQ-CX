/**
 * Tag-driven chargeback.
 *
 * The customer picks any tag key that carries cost; every distinct value becomes a cost
 * centre automatically. Unallocated spend — resources with no value for that key — is
 * shown first and deliberately, because on a typical estate it is the largest bucket and
 * the only one that changes behaviour.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { RefreshCw, AlertCircle, Tag, ChevronDown } from 'lucide-react'
import { fmtUsd, CHART_COLORS } from './finopsApi'

const card = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const UNALLOC = 'var(--c-475569)'

export default function ChargebackByTag() {
  const [keys, setKeys] = useState([])
  const [tagKey, setTagKey] = useState('')
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openCentre, setOpenCentre] = useState(null)
  const [hovered, setHovered] = useState(null)

  useEffect(() => {
    let dead = false
    fetch(`/api/finops/chargeback/tag-keys?days=${days}`)
      .then(r => r.json())
      .then(j => {
        if (dead) return
        const ks = j?.keys || []
        setKeys(ks)
        // Default to the key that can allocate the most, not an assumed "CostCenter"
        // which on most estates covers a small slice.
        if (!tagKey && ks.length) setTagKey(ks[0].key)
        if (!ks.length) setLoading(false)
      })
      .catch(e => { if (!dead) { setError(e.message); setLoading(false) } })
    return () => { dead = true }
  }, [days])

  const load = useCallback(() => {
    if (!tagKey) return undefined
    let dead = false
    setLoading(true)
    fetch(`/api/finops/chargeback/by-tag?tag_key=${encodeURIComponent(tagKey)}&days=${days}`)
      .then(r => r.json())
      .then(j => { if (!dead) { setData(j); setError(null) } })
      .catch(e => { if (!dead) setError(e.message) })
      .finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [tagKey, days])
  useEffect(() => load(), [load])

  const slices = useMemo(() => {
    if (!data?.available) return []
    const out = (data.cost_centres || []).filter(c => c.cost_usd > 0)
      .map((c, i) => ({ ...c, color: CHART_COLORS[i % CHART_COLORS.length] }))
    if (data.unallocated?.cost_usd > 0) out.push({ ...data.unallocated, color: UNALLOC, isUnalloc: true })
    return out
  }, [data])

  const selectedKey = keys.find(k => k.key === tagKey)

  if (error) return (
    <div style={{ ...card, color: 'var(--c-fca5a5)', display: 'flex', gap: 8, fontSize: 12 }}>
      <AlertCircle size={16} /><span>{error}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Chargeback by tag</h2>
        <div style={{ fontSize: 12, color: 'var(--c-64748b)', marginTop: 3 }}>
          Pick the tag your organisation charges against. Every value becomes a cost centre.
        </div>
      </div>

      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Tag size={15} style={{ color: '#0078d4' }} />
        <span style={{ fontSize: 11, color: 'var(--c-94a3b8)' }}>Tag key</span>
        <select value={tagKey} onChange={e => { setTagKey(e.target.value); setOpenCentre(null) }}
          style={{ background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6,
                   padding: '6px 10px', color: 'var(--c-e2e8f0)', fontSize: 12, minWidth: 300 }}>
          {keys.map(k => (
            <option key={k.key} value={k.key}>
              {k.display_key} — allocates {k.coverage_pct}% · {k.distinct_values} value{k.distinct_values === 1 ? '' : 's'}
            </option>
          ))}
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          style={{ background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6,
                   padding: '6px 10px', color: 'var(--c-e2e8f0)', fontSize: 12 }}>
          {[7, 30, 60, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        {loading && <RefreshCw size={13} className="animate-spin" style={{ color: '#3b82f6' }} />}
        {selectedKey?.variants?.length > 1 && (
          // Real estates carry CostCenter and costCenter as separate keys; merging them is
          // the difference between one cost centre and two half-sized ones.
          <span style={{ fontSize: 10.5, color: 'var(--c-fbbf24)' }}>
            merged case variants: {selectedKey.variants.join(', ')}
          </span>
        )}
      </div>

      {data?.available && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Kpi label="Total spend" value={fmtUsd(data.total_cost_usd)} sub={`last ${data.days} days`} />
            <Kpi label="Allocated" value={fmtUsd(data.allocated_cost_usd)}
                 sub={`${data.coverage_pct}% of spend`} color="#22c55e" />
            <Kpi label="Unallocated" value={fmtUsd(data.unallocated_cost_usd)}
                 sub={`${data.unallocated.resource_count} resources untagged`}
                 color={data.unallocated_cost_usd > data.allocated_cost_usd ? '#ef4444' : '#f59e0b'} />
            <Kpi label="Cost centres" value={data.centre_count} sub="distinct tag values" />
          </div>

          {data.unallocated_cost_usd > data.allocated_cost_usd && (
            <div style={{ background: 'rgba(239,68,68,.10)', border: '1px solid rgba(239,68,68,.35)',
                          borderRadius: 10, padding: 12, fontSize: 12, color: 'var(--c-fca5a5)',
                          display: 'flex', gap: 8 }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>
                More spend is unallocated than allocated. <strong>{fmtUsd(data.unallocated_cost_usd)}</strong> cannot
                be charged back with <strong>{selectedKey?.display_key || tagKey}</strong>. Tag those resources, or
                pick a key with wider coverage, before circulating this as a bill.
              </span>
            </div>
          )}

          <div style={{ ...card, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 220, height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={slices} dataKey="cost_usd" nameKey="name" cx="50%" cy="50%"
                       innerRadius="54%" outerRadius="84%" paddingAngle={1} minAngle={2}
                       isAnimationActive={false} labelLine={false}
                       onMouseEnter={(_, i) => setHovered(slices[i]?.name)}
                       onMouseLeave={() => setHovered(null)}
                       label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                         if (percent < 0.05) return null
                         const R = Math.PI / 180
                         const r = innerRadius + (outerRadius - innerRadius) * 0.5
                         return (
                           <text x={cx + r * Math.cos(-midAngle * R)} y={cy + r * Math.sin(-midAngle * R)}
                                 textAnchor="middle" dominantBaseline="central" fill="#fff"
                                 fontSize={11.5} fontWeight={700} style={{ pointerEvents: 'none' }}>
                             {`${(percent * 100).toFixed(0)}%`}
                           </text>
                         )
                       }}>
                    {slices.map((s, i) => (
                      <Cell key={i} fill={s.color}
                            opacity={!hovered || hovered === s.name ? 1 : 0.32} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [fmtUsd(v), n]}
                           contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)',
                                           borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--c-64748b)' }}>Total</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-f1f5f9)' }}>{fmtUsd(data.total_cost_usd)}</div>
              </div>
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {slices.map(s => (
                <div key={s.name}>
                  <div onMouseEnter={() => setHovered(s.name)} onMouseLeave={() => setHovered(null)}
                       onClick={() => setOpenCentre(openCentre === s.name ? null : s.name)}
                       style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 6px', borderRadius: 5,
                                cursor: 'pointer', fontSize: 11.5,
                                background: hovered === s.name ? 'rgba(var(--rgb-slate), .30)' : 'transparent' }}>
                    <ChevronDown size={12} style={{ color: 'var(--c-64748b)', flexShrink: 0,
                                 transform: openCentre === s.name ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, color: s.isUnalloc ? 'var(--c-94a3b8)' : 'var(--c-e2e8f0)',
                                   fontStyle: s.isUnalloc ? 'italic' : 'normal', overflow: 'hidden',
                                   textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span style={{ color: 'var(--c-64748b)', fontSize: 10.5 }}>{s.resource_count} res</span>
                    <span style={{ color: 'var(--c-f1f5f9)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtUsd(s.cost_usd)}
                    </span>
                    <span style={{ color: 'var(--c-64748b)', width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {s.share_pct}%
                    </span>
                  </div>
                  {openCentre === s.name && (
                    <div style={{ margin: '2px 0 8px 28px', borderLeft: '1px solid var(--c-1e293b)', paddingLeft: 10 }}>
                      {s.resources.map(r => (
                        <div key={r.resource_id} style={{ display: 'flex', gap: 8, fontSize: 10.5, padding: '2px 0' }}>
                          <span style={{ flex: 1, color: 'var(--c-94a3b8)', overflow: 'hidden',
                                         textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                title={r.resource_id}>{r.resource_name || r.resource_id}</span>
                          <span style={{ color: 'var(--c-64748b)' }}>{r.resource_group}</span>
                          <span style={{ color: 'var(--c-e2e8f0)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(r.cost_usd)}</span>
                        </div>
                      ))}
                      {s.resource_count > s.resources.length && (
                        <div style={{ fontSize: 10, color: 'var(--c-475569)', paddingTop: 3 }}>
                          +{s.resource_count - s.resources.length} more
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!loading && data && !data.available && (
        <div style={{ ...card, fontSize: 12, color: 'var(--c-64748b)' }}>
          {data.reason || 'No cost rows available for chargeback yet.'}
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ ...card, flex: '1 1 170px', minWidth: 160 }}>
      <div style={{ fontSize: 10, color: 'var(--c-64748b)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: color || 'var(--c-f1f5f9)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--c-64748b)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
