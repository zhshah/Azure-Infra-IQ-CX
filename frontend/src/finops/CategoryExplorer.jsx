/**
 * Service-category explorer.
 *
 * The category roll-up on its own is a pie: it says "AI/ML is 62%" and stops there.
 * This adds the sub-categories behind each slice — service, then resource type, then
 * the individual resources — with a period-over-period delta so a reviewer can see
 * which category actually moved and open the resources responsible without leaving
 * the review. Filters (window, resource group, name) apply to every level at once.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { RefreshCw, AlertCircle, ChevronRight, ChevronDown, Search, X } from 'lucide-react'
import { fmtUsd } from './finopsApi'

const PALETTE = ['#0078d4', '#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444',
  '#ec4899', '#14b8a6', '#a3e635', '#f97316', '#6366f1', '#64748b']
const WINDOWS = [{ d: 7, l: '7d' }, { d: 30, l: '30d' }, { d: 60, l: '60d' }, { d: 90, l: '90d' }]
const sub = 'var(--c-94a3b8, #94a3b8)'
const dim = 'var(--c-64748b, #64748b)'
const ink = 'var(--c-e2e8f0, #e2e8f0)'
const line = '1px solid var(--c-1e293b, #1e293b)'

const ctl = {
  background: 'var(--c-0f172a, #0f172a)', color: ink,
  border: '1px solid var(--c-334155, #334155)', borderRadius: 6,
  padding: '5px 9px', fontSize: 12,
}

export default function CategoryExplorer() {
  const [days, setDays] = useState(30)
  const [rg, setRg] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [data, setData] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState(null)

  // Typing straight into the query string would refetch on every keystroke.
  useEffect(() => { const t = setTimeout(() => setQ(search), 400); return () => clearTimeout(t) }, [search])

  const qs = useCallback((extra = {}) => {
    const p = new URLSearchParams({ days: String(days) })
    if (rg) p.set('resource_group', rg)
    if (q) p.set('search', q)
    Object.entries(extra).forEach(([k, v]) => v && p.set(k, v))
    return p.toString()
  }, [days, rg, q])

  useEffect(() => {
    let live = true
    setLoading(true)
    fetch(`/api/finops/mgmt/category-breakdown?${qs()}`)
      .then(r => r.json())
      .then(d => { if (live) { setData(d); setError(null) } })
      .catch(e => live && setError(e.message))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [qs])

  // Reopening the same category under new filters must refetch, so this keys off qs too.
  useEffect(() => {
    if (!open) { setDetail(null); return }
    let live = true
    setDetailLoading(true)
    fetch(`/api/finops/mgmt/category-breakdown?${qs({ category: open })}`)
      .then(r => r.json())
      .then(d => { if (live) setDetail(d.detail) })
      .catch(() => live && setDetail(null))
      .finally(() => live && setDetailLoading(false))
    return () => { live = false }
  }, [open, qs])

  const cats = data?.categories || []
  const filtered = !!(rg || q)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 2, background: 'var(--c-0f172a, #0f172a)', border: '1px solid var(--c-334155, #334155)', borderRadius: 6, padding: 2 }}>
          {WINDOWS.map(w => (
            <button key={w.d} onClick={() => setDays(w.d)}
              style={{ background: days === w.d ? '#0078d4' : 'transparent', color: days === w.d ? '#fff' : sub,
                       border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer' }}>
              {w.l}
            </button>
          ))}
        </div>

        <select value={rg} onChange={e => setRg(e.target.value)} style={{ ...ctl, maxWidth: 260 }}>
          <option value="">All resource groups</option>
          {(data?.resource_groups || []).map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: 8, color: dim }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Resource name…"
                 style={{ ...ctl, paddingLeft: 24, width: 190 }} />
        </div>

        {filtered && (
          <button onClick={() => { setRg(''); setSearch('') }}
                  style={{ ...ctl, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, color: sub }}>
            <X size={11} /> Clear
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 11, color: dim }}>
          {data?.date_from} → {data?.date_to} · vs {data?.prev_from} → {data?.prev_to}
        </span>
      </div>

      {loading && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 20, color: sub, fontSize: 12 }}>
          <RefreshCw size={14} className="animate-spin" style={{ color: '#3b82f6' }} /> Loading categories…
        </div>
      )}
      {error && (
        <div style={{ color: 'var(--c-fca5a5, #fca5a5)', fontSize: 12, display: 'flex', gap: 6, padding: 12 }}>
          <AlertCircle size={14} />{error}
        </div>
      )}
      {!loading && !error && cats.length === 0 && (
        <div style={{ fontSize: 12, color: dim, padding: 14 }}>
          No resource-grain cost rows for this window{filtered ? ' with these filters' : ''}.
        </div>
      )}

      {!loading && cats.length > 0 && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 1 250px', minWidth: 210, position: 'relative' }}>
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={cats.filter(c => c.cost_usd > 0)} dataKey="cost_usd" nameKey="category"
                     innerRadius="54%" outerRadius="84%" paddingAngle={1} minAngle={2}
                     isAnimationActive={false} labelLine={false}
                     label={({ cost_pct }) => (cost_pct >= 6 ? `${cost_pct}%` : null)}>
                  {cats.filter(c => c.cost_usd > 0).map((c, i) => (
                    <Cell key={c.category} fill={PALETTE[cats.indexOf(c) % PALETTE.length]}
                          stroke={open === c.category ? '#fff' : 'none'} strokeWidth={open === c.category ? 2 : 0}
                          opacity={!open || open === c.category ? 1 : 0.3}
                          onClick={() => setOpen(open === c.category ? null : c.category)}
                          style={{ cursor: 'pointer' }} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 10, color: dim, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-f1f5f9, #f1f5f9)' }}>{fmtUsd(data.total_usd)}</div>
              <div style={{ fontSize: 10, color: dim }}>{days} days</div>
            </div>
          </div>

          <div style={{ flex: '1 1 480px', minWidth: 380 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: sub, textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Category</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cost</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Share</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>vs prev</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Sub-categories</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c, i) => {
                  const on = open === c.category
                  const up = c.delta_usd > 0
                  return (
                    <React.Fragment key={c.category}>
                      <tr onClick={() => setOpen(on ? null : c.category)}
                          style={{ borderTop: line, cursor: 'pointer',
                                   background: on ? 'rgba(59,130,246,.12)' : 'transparent' }}>
                        <td style={{ padding: '6px 8px', color: ink }}>
                          {on ? <ChevronDown size={12} style={{ verticalAlign: -2, color: sub }} />
                              : <ChevronRight size={12} style={{ verticalAlign: -2, color: dim }} />}
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                                         background: PALETTE[i % PALETTE.length], margin: '0 8px 0 5px' }} />
                          {c.category}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: ink, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(c.cost_usd)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: sub, fontVariantNumeric: 'tabular-nums' }}>{c.cost_pct}%</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                     color: c.is_new ? '#fbbf24' : up ? '#f87171' : '#4ade80' }}>
                          {c.is_new ? 'new' : c.delta_pct === null ? '—' : `${up ? '+' : ''}${c.delta_pct}%`}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: dim, fontSize: 11 }}>
                          {c.service_count} svc · {c.type_count} types · {c.resource_count} res
                        </td>
                      </tr>
                      {on && (
                        <tr>
                          <td colSpan={5} style={{ padding: 0, background: 'var(--c-0b1220, #0b1220)' }}>
                            <Detail d={detail} loading={detailLoading} days={days} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 10.5, color: dim, marginTop: 8 }}>
              Click a category to open its services, resource types and resources. Deltas compare
              this window against the preceding window of equal length. Costs are actuals from the
              cost warehouse, not estimates.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ d, loading, days }) {
  const [tab, setTab] = useState('services')
  if (loading) return (
    <div style={{ padding: 14, fontSize: 12, color: sub, display: 'flex', gap: 8 }}>
      <RefreshCw size={13} className="animate-spin" style={{ color: '#3b82f6' }} /> Loading sub-categories…
    </div>
  )
  if (!d) return <div style={{ padding: 14, fontSize: 12, color: dim }}>No detail available.</div>

  const tabs = [
    ['services', `Services (${d.services.length})`],
    ['types', `Resource types (${d.resource_types.length})`],
    ['rg', `Resource groups (${d.by_resource_group.length})`],
    ['loc', `Regions (${d.by_location.length})`],
    ['res', `Resources (${d.resources_total})`],
  ]

  return (
    <div style={{ padding: '10px 12px 14px' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ background: tab === k ? 'rgba(0,120,212,.18)' : 'transparent',
                     border: `1px solid ${tab === k ? '#0078d4' : 'var(--c-334155, #334155)'}`,
                     color: tab === k ? '#7cc4fa' : sub, borderRadius: 6,
                     padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>{l}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: dim }}>
          {fmtUsd(d.cost_usd)} · {d.cost_pct_of_total}% of total · {d.resource_count} resources
        </span>
      </div>

      {tab === 'services' && d.services.map(s => (
        <div key={s.service_name} style={{ borderTop: line, padding: '6px 0' }}>
          <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
            <span style={{ color: ink, flex: 1 }}>{s.service_name}</span>
            <span style={{ color: ink, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(s.cost_usd)}</span>
            <span style={{ color: sub, width: 46, textAlign: 'right' }}>{s.cost_pct}%</span>
            <span style={{ color: dim, width: 64, textAlign: 'right', fontSize: 11 }}>{s.resource_count} res</span>
          </div>
          <div style={{ height: 3, background: 'var(--c-1e293b, #1e293b)', borderRadius: 2, margin: '4px 0 5px' }}>
            <div style={{ width: `${Math.min(100, s.cost_pct)}%`, height: '100%', background: '#0078d4', borderRadius: 2 }} />
          </div>
          {s.types.map(t => (
            <div key={t.resource_type} style={{ display: 'flex', gap: 10, fontSize: 11, color: dim, paddingLeft: 16 }}>
              <span style={{ flex: 1 }}>↳ {t.resource_type}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(t.cost_usd)}</span>
              <span style={{ width: 46, textAlign: 'right' }}>{t.cost_pct}%</span>
              <span style={{ width: 64, textAlign: 'right' }}>{t.resource_count} res</span>
            </div>
          ))}
        </div>
      ))}

      {tab === 'types' && <Rank rows={d.resource_types} k="resource_type" />}
      {tab === 'rg' && <Rank rows={d.by_resource_group} k="resource_group" />}
      {tab === 'loc' && <Rank rows={d.by_location} k="location" />}

      {tab === 'res' && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ color: sub, textAlign: 'left' }}>
                <th style={{ padding: '4px 6px' }}>Resource</th>
                <th style={{ padding: '4px 6px' }}>Resource group</th>
                <th style={{ padding: '4px 6px' }}>Type</th>
                <th style={{ padding: '4px 6px' }}>Region</th>
                <th style={{ padding: '4px 6px', textAlign: 'right' }}>Cost</th>
                <th style={{ padding: '4px 6px', textAlign: 'right' }}>$/day</th>
                <th style={{ padding: '4px 6px', textAlign: 'right' }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {d.resources.map(r => (
                <tr key={r.resource_id || r.resource_name} style={{ borderTop: line }}>
                  <td style={{ padding: '4px 6px', color: ink }}>{r.resource_name || '(unnamed)'}</td>
                  <td style={{ padding: '4px 6px', color: sub }}>{r.resource_group || '—'}</td>
                  <td style={{ padding: '4px 6px', color: dim }}>{r.resource_type}</td>
                  <td style={{ padding: '4px 6px', color: dim }}>{r.location || '—'}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', color: ink, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(r.cost_usd)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', color: sub, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(r.daily_avg_usd, 2)}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right', color: sub, fontVariantNumeric: 'tabular-nums' }}>{r.cost_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.resources_truncated && (
            <div style={{ fontSize: 10.5, color: dim, marginTop: 6 }}>
              Showing the top {d.resources.length} of {d.resources_total} resources by cost.
              Narrow with the resource-group or name filter above.
            </div>
          )}
          <div style={{ fontSize: 10.5, color: dim, marginTop: 6 }}>
            $/day is this resource&apos;s cost over the {days}-day window divided by {days}.
          </div>
        </>
      )}
    </div>
  )
}

function Rank({ rows, k }) {
  return (
    <div>
      {rows.map(r => (
        <div key={r[k]} style={{ borderTop: line, padding: '5px 0' }}>
          <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
            <span style={{ color: ink, flex: 1 }}>{r[k]}</span>
            <span style={{ color: ink, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(r.cost_usd)}</span>
            <span style={{ color: sub, width: 46, textAlign: 'right' }}>{r.cost_pct}%</span>
            <span style={{ color: dim, width: 64, textAlign: 'right', fontSize: 11 }}>{r.resource_count} res</span>
          </div>
          <div style={{ height: 3, background: 'var(--c-1e293b, #1e293b)', borderRadius: 2, marginTop: 4 }}>
            <div style={{ width: `${Math.min(100, r.cost_pct)}%`, height: '100%', background: '#8b5cf6', borderRadius: 2 }} />
          </div>
        </div>
      ))}
    </div>
  )
}
