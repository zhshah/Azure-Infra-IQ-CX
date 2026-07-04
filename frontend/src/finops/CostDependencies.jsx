/**
 * CostDependencies — Advanced FinOps: cost dependencies & workload roll-up.
 *
 * Rolls Azure cost up into WORKLOADS under three lenses:
 *   • Dependency  — connected-component clusters from the dependency graph
 *                   (a VM + its disks + NIC + public IP + backup as ONE application).
 *   • Resource Group
 *   • Tag         — by the value of a chosen tag key (application / cost-center / env…).
 *
 * Two visualisations: a cost-sized bubble MAP and a sortable TABLE. Selecting a
 * workload reveals its per-resource-type cost breakdown, a hub-spoke cost graph of
 * its members, and a drillable member list (→ full resource detail).
 *
 * Data: GET /api/finops/workloads (dependency graph + dashboard cache). No mock data.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Network, RefreshCw, AlertCircle, Layers, Tag as TagIcon, FolderTree,
  LayoutGrid, Table as TableIcon, ChevronRight, TrendingUp, TrendingDown,
  Boxes, MapPin, Info,
} from 'lucide-react'
import { finopsApi, getFilterOptions, fmtUsd } from './finopsApi'
import { C, CHART_COLORS } from './finopsTheme'
import { useDrill } from '../drill/DrillContext'
import SearchableSelect from '../components/shared/SearchableSelect'
import FinOpsExportMenu from './FinOpsExportMenu'

const shortType = (t) => (t || '').split('/').pop() || t || ''

const MODE_TABS = [
  { key: 'dependency',     label: 'Dependency workloads', Icon: Network,
    hint: 'Connected resources (VM + disks + NIC + IP + backup) rolled up as one application' },
  { key: 'resource_group', label: 'By resource group',    Icon: FolderTree,
    hint: 'Cost grouped by resource group' },
  { key: 'tag',            label: 'By tag',                Icon: TagIcon,
    hint: 'Cost grouped by the value of a chosen tag key' },
]

/* Enterprise cost treemap */
function worstRatio(row, len) {
  const s = row.reduce((a, n) => a + n.area, 0)
  const t = s / len, t2 = t * t
  const maxA = Math.max(...row.map(n => n.area))
  const minA = Math.min(...row.map(n => n.area))
  return Math.max(t2 / (minA || 1), (maxA) / (t2 || 1))
}
function squarify(items, x, y, w, h) {
  const total = items.reduce((s, it) => s + Math.max(it.value, 0), 0)
  if (total <= 0 || w <= 0 || h <= 0) return []
  const scale = (w * h) / total
  const nodes = items.filter(it => it.value > 0).map(it => ({ ...it, area: it.value * scale }))
  const out = []
  let rx = x, ry = y, rw = w, rh = h, i = 0
  while (i < nodes.length) {
    const vertical = rw >= rh
    const len = vertical ? rh : rw
    let row = [nodes[i]]; i++
    while (i < nodes.length && worstRatio(row.concat(nodes[i]), len) <= worstRatio(row, len)) {
      row = row.concat(nodes[i]); i++
    }
    const rowArea = row.reduce((s, n) => s + n.area, 0)
    const thick = rowArea / len
    let off = 0
    for (const n of row) {
      const seg = n.area / thick
      if (vertical) out.push({ ...n, _r: { x: rx, y: ry + off, w: thick, h: seg } })
      else          out.push({ ...n, _r: { x: rx + off, y: ry, w: seg, h: thick } })
      off += seg
    }
    if (vertical) { rx += thick; rw -= thick } else { ry += thick; rh -= thick }
  }
  return out
}

function Treemap({ workloads, total, onSelect, selectedId }) {
  const W = 1000, H = 460
  const laid = useMemo(
    () => squarify(workloads.map(w => ({ ...w, value: Math.max(w.cost, 0) })), 0, 0, W, H),
    [workloads],
  )
  if (!laid.length) {
    return (
      <div style={{ padding: 50, textAlign: 'center', color: C.muted, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12 }}>
        No billable cost to map in this scope.
      </div>
    )
  }
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {laid.map((n, i) => {
          const color = CHART_COLORS[i % CHART_COLORS.length]
          const sel = n.id === selectedId
          const r = n._r
          const pct = total > 0 ? (n.cost / total * 100) : 0
          const wide = r.w > 64 && r.h > 24
          const maxChars = Math.max(3, Math.floor(r.w / 7))
          const nm = (n.name || '').length > maxChars ? (n.name || '').slice(0, maxChars) + '…' : (n.name || '')
          return (
            <g key={n.id || i} style={{ cursor: 'pointer' }} onClick={() => onSelect(n)}>
              <rect x={r.x + 1} y={r.y + 1} width={Math.max(0, r.w - 2)} height={Math.max(0, r.h - 2)}
                rx={3} fill={`${color}2e`} stroke={sel ? '#ffffff' : color} strokeWidth={sel ? 2.5 : 1} />
              {wide && (
                <>
                  <text x={r.x + 8} y={r.y + 17} style={{ fill: C.text }} fontSize={11} fontWeight={700}>{nm}</text>
                  <text x={r.x + 8} y={r.y + 32} style={{ fill: color }} fontSize={11} fontWeight={700}>{fmtUsd(n.cost)} · {pct.toFixed(1)}%</text>
                </>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ── Hub-spoke cost graph for a selected workload's members ─────────────────── */
function MemberGraph({ workload, onNode }) {
  const members = (workload?.members || []).filter(m => (m.cost_current_month || 0) >= 0).slice(0, 13)
  if (members.length < 2) return null
  const W = 520, H = 300, cx = W / 2, cy = H / 2
  const sorted = [...members].sort((a, b) => b.cost_current_month - a.cost_current_month)
  const anchor = sorted[0]
  const spokes = sorted.slice(1)
  const maxCost = Math.max(1, ...members.map(m => m.cost_current_month))
  const rOf = (c) => Math.max(12, Math.min(38, Math.sqrt((c || 0) / maxCost) * 38))
  const ringR = Math.min(W, H) / 2 - 46
  const nodes = spokes.map((m, i) => {
    const ang = (i / spokes.length) * 2 * Math.PI - Math.PI / 2
    return { m, x: cx + ringR * Math.cos(ang), y: cy + ringR * Math.sin(ang) }
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 300 }}>
      {nodes.map((n, i) => (
        <line key={`e${i}`} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke={C.border} strokeWidth={1.5} />
      ))}
      {nodes.map((n, i) => {
        const r = rOf(n.m.cost_current_month)
        const color = CHART_COLORS[(i + 1) % CHART_COLORS.length]
        return (
          <g key={`n${i}`} style={{ cursor: 'pointer' }} onClick={() => onNode?.(n.m)}>
            <circle cx={n.x} cy={n.y} r={r} fill={`${color}33`} stroke={color} strokeWidth={2} />
            <text x={n.x} y={n.y - 1} textAnchor="middle" style={{ fill: C.text }} fontSize={8} fontWeight={700}>
              {shortType(n.m.resource_type)}
            </text>
            <text x={n.x} y={n.y + 9} textAnchor="middle" style={{ fill: color }} fontSize={8} fontWeight={700}>
              {fmtUsd(n.m.cost_current_month)}
            </text>
          </g>
        )
      })}
      {/* anchor (largest-cost member) in the centre */}
      <g style={{ cursor: 'pointer' }} onClick={() => onNode?.(anchor)}>
        <circle cx={cx} cy={cy} r={rOf(anchor.cost_current_month)} fill={`${CHART_COLORS[0]}44`} stroke={CHART_COLORS[0]} strokeWidth={2.5} />
        <text x={cx} y={cy - 2} textAnchor="middle" style={{ fill: '#fff' }} fontSize={9} fontWeight={700}>
          {shortType(anchor.resource_type)}
        </text>
        <text x={cx} y={cy + 9} textAnchor="middle" style={{ fill: CHART_COLORS[0] }} fontSize={9} fontWeight={700}>
          {fmtUsd(anchor.cost_current_month)}
        </text>
      </g>
    </svg>
  )
}

/* ── KPI tile ──────────────────────────────────────────────────────────────── */
function Kpi({ label, value, sub, Icon, color = C.accent }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: C.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</span>
        {Icon && <Icon size={15} style={{ color }} />}
      </div>
      <div style={{ color: C.text, fontSize: 21, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub != null && <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

/* ── Delta pill ────────────────────────────────────────────────────────────── */
function Delta({ delta }) {
  if (delta == null || Math.abs(delta) < 0.005) return <span style={{ color: C.muted, fontSize: 12 }}>—</span>
  const up = delta > 0
  const Icon = up ? TrendingUp : TrendingDown
  const color = up ? C.red : C.green
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color, fontSize: 12, fontWeight: 600 }}>
      <Icon size={12} /> {up ? '+' : ''}{fmtUsd(delta)}
    </span>
  )
}

export default function CostDependencies() {
  const { openResourceDetail } = useDrill()
  const [mode, setMode]       = useState('dependency')
  const [tagKey, setTagKey]   = useState('Application')
  const [tagKeys, setTagKeys] = useState([])
  const [view, setView]       = useState('map')      // 'map' | 'table'
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch]   = useState('')
  const [subFilter, setSubFilter]         = useState('')
  const [regionFilter, setRegionFilter]   = useState('')
  const [subOptions, setSubOptions]       = useState([])
  const [regionOptions, setRegionOptions] = useState([])
  const abortRef = useRef(null)

  useEffect(() => {
    getFilterOptions().then(o => {
      setTagKeys(o.tag_keys || [])
      setSubOptions((o.subscriptions || []).map(s => (typeof s === 'string'
        ? { value: s, label: s }
        : { value: s.id || s.value || '', label: s.name || s.label || s.id || '', count: s.count })))
      setRegionOptions((o.regions || []).map(r => (typeof r === 'string'
        ? { value: r, label: r }
        : { value: r.value, label: r.label ?? r.value, count: r.count })))
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController(); abortRef.current = ctrl
    setLoading(true); setError(null); setSelectedId(null)
    try {
      const res = await finopsApi.getWorkloads(mode, mode === 'tag' ? tagKey : null,
        { subscription_id: subFilter || undefined, region: regionFilter || undefined }, ctrl.signal)
      if (!ctrl.signal.aborted) setData(res)
    } catch (e) { if (e.name !== 'AbortError') setError(e.message) }
    finally { if (!ctrl.signal.aborted) setLoading(false) }
  }, [mode, tagKey, subFilter, regionFilter])

  useEffect(() => { load(); return () => { if (abortRef.current) abortRef.current.abort() } }, [load])

  const allWorkloads = data?.workloads || []
  const totalCost    = data?.total_cost || 0
  const workloads = useMemo(() => {
    const s = search.trim().toLowerCase()
    return s ? allWorkloads.filter(w => (w.name || '').toLowerCase().includes(s)) : allWorkloads
  }, [allWorkloads, search])
  const selected = useMemo(() => allWorkloads.find(w => w.id === selectedId) || null, [allWorkloads, selectedId])

  const crossRegion = allWorkloads.filter(w => w.cross_region).length
  const biggest = allWorkloads[0]

  const tagKeyOptions = useMemo(() => {
    const base = ['Application', 'Workload', 'CostCenter', 'Environment', 'Project', 'Department', 'Owner', 'Team']
    const merged = [...new Set([...base, ...(tagKeys || [])])]
    return merged.map(k => ({ value: k, label: k }))
  }, [tagKeys])

  const exportCsv = useCallback(async () => {
    const hdr = ['Workload', 'Monthly Cost (USD)', 'Prev Month (USD)', 'Delta (USD)', 'Resources', 'Types', 'Regions']
    const lines = [hdr.join(',')]
    for (const w of allWorkloads) {
      lines.push([
        `"${(w.name || '').replace(/"/g, '""')}"`, w.cost, w.prev_cost,
        w.delta_usd, w.resource_count,
        `"${(w.resource_types || []).map(shortType).join('; ')}"`,
        `"${(w.regions || []).join('; ')}"`,
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `azure-cost-workloads-${mode}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
  }, [allWorkloads, mode])

  const reportForExport = useMemo(() => ({
    title: 'Azure Cost Dependencies & Workloads',
    kpis: [
      { label: 'Workloads', value: String(allWorkloads.length) },
      { label: 'Total Monthly', value: fmtUsd(totalCost) },
      { label: 'Largest Workload', value: biggest ? `${biggest.name} (${fmtUsd(biggest.cost)})` : '—' },
      { label: 'Cross-region', value: String(crossRegion) },
    ],
    tables: [{
      title: 'Workloads by cost',
      columns: ['Workload', 'Monthly', 'Δ vs last', 'Resources', 'Regions'],
      rows: allWorkloads.slice(0, 60).map(w => [w.name, fmtUsd(w.cost), fmtUsd(w.delta_usd), String(w.resource_count), (w.regions || []).join(', ')]),
    }],
  }), [allWorkloads, totalCost, biggest, crossRegion])

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 22, fontWeight: 700, margin: 0 }}>
            <Network size={22} style={{ color: C.accent }} /> Cost Dependencies &amp; Workloads
          </h1>
          <p style={{ color: C.muted, fontSize: 13, margin: '6px 0 0' }}>
            Roll cost up into applications — a VM and its disks, NIC, public IP &amp; backup counted as one workload.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={load} disabled={loading} style={{
            display: 'flex', alignItems: 'center', gap: 6, background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: '6px 12px', cursor: loading ? 'wait' : 'pointer', color: C.textDim, fontSize: 12, fontWeight: 600,
          }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <FinOpsExportMenu view="dependencies" onCsv={exportCsv} report={reportForExport} />
        </div>
      </div>

      {/* Value explainer */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'rgba(59,130,246,0.07)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
        <Info size={16} style={{ color: C.accent, flexShrink: 0, marginTop: 1 }} />
        <span style={{ color: C.textDim, fontSize: 12.5, lineHeight: 1.5 }}>
          Azure bills every resource separately. This view rolls spend up into <b style={{ color: C.text }}>workloads</b> — a VM with its disks, NIC, public IP &amp; backup counted as <b style={{ color: C.text }}>one application</b> — so you see cost by business service, spot the priciest workloads, and drill into exactly what drives them. Use the scope filters to focus on a subscription or region.
        </span>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {MODE_TABS.map(t => {
          const active = mode === t.key
          return (
            <button key={t.key} onClick={() => setMode(t.key)} title={t.hint} style={{
              display: 'flex', alignItems: 'center', gap: 7, background: active ? C.accentDim : C.surface,
              border: `1px solid ${active ? C.accent : C.border}`, borderRadius: 8, padding: '8px 14px',
              cursor: 'pointer', color: active ? C.text : C.textDim, fontSize: 13, fontWeight: 600,
            }}>
              <t.Icon size={15} style={{ color: active ? C.accent : C.muted }} /> {t.label}
            </button>
          )
        })}
        {mode === 'tag' && (
          <div style={{ minWidth: 200 }}>
            <SearchableSelect
              options={tagKeyOptions}
              value={tagKey}
              onChange={setTagKey}
              placeholder="Tag key…"
            />
          </div>
        )}
      </div>

      {/* Scope filters (subscription / region) */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ minWidth: 240 }}>
          <SearchableSelect label="Subscription" value={subFilter} onChange={setSubFilter} options={subOptions} placeholder="All subscriptions" searchPlaceholder="Search subscriptions…" compact />
        </div>
        <div style={{ minWidth: 190 }}>
          <SearchableSelect label="Region" value={regionFilter} onChange={setRegionFilter} options={regionOptions} placeholder="All regions" searchPlaceholder="Search regions…" compact />
        </div>
        {(subFilter || regionFilter) && (
          <button onClick={() => { setSubFilter(''); setRegionFilter('') }} style={{
            display: 'flex', alignItems: 'center', gap: 5, background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: '7px 12px', cursor: 'pointer', color: C.textDim, fontSize: 12, fontWeight: 600, alignSelf: 'flex-end',
          }}>Clear scope</button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Kpi label="Workloads" value={loading ? '…' : allWorkloads.length} Icon={Boxes} sub={mode === 'dependency' ? 'dependency clusters' : (mode === 'tag' ? `by ${tagKey}` : 'resource groups')} />
        <Kpi label="Total monthly" value={loading ? '…' : fmtUsd(totalCost)} Icon={Layers} color={C.green} />
        <Kpi label="Largest workload" value={loading ? '…' : (biggest ? fmtUsd(biggest.cost) : '$0')} Icon={TrendingUp} color={C.orange} sub={biggest ? biggest.name : ''} />
        <Kpi label="Cross-region" value={loading ? '…' : crossRegion} Icon={MapPin} color={C.purple} sub="span >1 region" />
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 16 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* View toggle + search */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[{ k: 'map', L: 'Cost map', Icon: LayoutGrid }, { k: 'table', L: 'Table', Icon: TableIcon }].map(v => (
            <button key={v.k} onClick={() => setView(v.k)} style={{
              display: 'flex', alignItems: 'center', gap: 6, background: view === v.k ? C.accentDim : C.surface,
              border: `1px solid ${view === v.k ? C.accent : C.border}`, borderRadius: 6, padding: '6px 12px',
              cursor: 'pointer', color: view === v.k ? C.text : C.textDim, fontSize: 12, fontWeight: 600,
            }}>
              <v.Icon size={13} /> {v.L}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search workloads…" style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 12px',
          color: C.text, fontSize: 13, minWidth: 220,
        }} />
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>
          <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 10px' }} /> Loading workloads…
        </div>
      ) : allWorkloads.length === 0 ? (
        <div style={{ padding: 50, textAlign: 'center', color: C.muted, background: C.surface2, border: `1px dashed ${C.border}`, borderRadius: 12 }}>
          <Info size={22} style={{ margin: '0 auto 8px' }} />
          No workload data yet. Load your Azure resources (run a scan on the dashboard) — cost dependencies build from the resource cache.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 420px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div>
            {view === 'map'
              ? <Treemap workloads={workloads} total={totalCost} onSelect={w => setSelectedId(w.id)} selectedId={selectedId} />
              : (
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: C.surface2, color: C.muted, textAlign: 'left' }}>
                        <th style={{ padding: '10px 14px', fontWeight: 600 }}>Workload</th>
                        <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>Monthly cost</th>
                        <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>Δ vs last</th>
                        <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>Resources</th>
                        <th style={{ padding: '10px 14px', fontWeight: 600 }}>Types</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workloads.map((w, i) => {
                        const pct = totalCost > 0 ? (w.cost / totalCost * 100) : 0
                        const color = CHART_COLORS[i % CHART_COLORS.length]
                        return (
                          <tr key={w.id || i} onClick={() => setSelectedId(w.id)} style={{
                            borderTop: `1px solid ${C.border}`, cursor: 'pointer',
                            background: selectedId === w.id ? C.accentDim : 'transparent',
                          }}>
                            <td style={{ padding: '9px 14px', color: C.text, fontWeight: 600 }}>
                              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color, marginRight: 8 }} />
                              {w.name}
                            </td>
                            <td style={{ padding: '9px 14px', textAlign: 'right', color: C.text }}>
                              <div>{fmtUsd(w.cost)}</div>
                              <div style={{ height: 3, background: C.border, borderRadius: 2, marginTop: 3 }}>
                                <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, borderRadius: 2 }} />
                              </div>
                            </td>
                            <td style={{ padding: '9px 14px', textAlign: 'right' }}><Delta delta={w.delta_usd} /></td>
                            <td style={{ padding: '9px 14px', textAlign: 'right', color: C.textDim }}>{w.resource_count}</td>
                            <td style={{ padding: '9px 14px', color: C.textDim, fontSize: 12 }}>
                              {(w.resource_types || []).slice(0, 4).map(shortType).join(', ')}{(w.resource_types || []).length > 4 ? '…' : ''}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </div>

          {/* Selected workload detail */}
          {selected && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, position: 'sticky', top: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                <div>
                  <div style={{ color: C.text, fontSize: 16, fontWeight: 700 }}>{selected.name}</div>
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                    {selected.resource_count} resources · {fmtUsd(selected.cost)}/mo · <Delta delta={selected.delta_usd} />
                  </div>
                </div>
                <button onClick={() => setSelectedId(null)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18 }}>×</button>
              </div>

              {selected.regions?.length > 0 && (
                <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selected.regions.map(r => (
                    <span key={r} style={{ fontSize: 11, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '2px 8px', color: C.textDim }}>
                      <MapPin size={9} style={{ display: 'inline', marginRight: 3 }} />{r}
                    </span>
                  ))}
                </div>
              )}

              {/* Type breakdown */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Cost by resource type</div>
                {(selected.breakdown || []).slice(0, 8).map((b, i) => {
                  const pct = selected.cost > 0 ? (b.cost / selected.cost * 100) : 0
                  const color = CHART_COLORS[i % CHART_COLORS.length]
                  return (
                    <div key={b.type} style={{ marginBottom: 7 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.textDim, marginBottom: 2 }}>
                        <span>{b.type} <span style={{ color: C.muted }}>({b.count})</span></span>
                        <span style={{ color: C.text, fontWeight: 600 }}>{fmtUsd(b.cost)}</span>
                      </div>
                      <div style={{ height: 5, background: C.border, borderRadius: 3 }}>
                        <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, borderRadius: 3 }} />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Hub-spoke cost graph */}
              {(selected.members || []).length >= 2 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Dependency cost map</div>
                  <MemberGraph workload={selected} onNode={openResourceDetail} />
                </div>
              )}

              {/* Members */}
              <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Resources ({selected.members?.length || 0})</div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {(selected.members || []).map((m, i) => (
                  <div key={m.resource_id || i} onClick={() => openResourceDetail(m)} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    padding: '7px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                    borderBottom: `1px solid ${C.border}`,
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = C.surface2}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: C.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.resource_name}</div>
                      <div style={{ color: C.muted, fontSize: 11 }}>{shortType(m.resource_type)}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ color: C.text, fontWeight: 600 }}>{fmtUsd(m.cost_current_month)}</span>
                      <ChevronRight size={13} style={{ color: C.muted }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p style={{ color: C.muted, fontSize: 11, marginTop: 14 }}>
        {mode === 'dependency'
          ? 'Workloads are connected-component clusters from the live dependency graph (disk↔VM, NIC↔VM, public-IP↔NIC, subnet↔NIC, etc.). Cost is the sum of each member’s current-month spend.'
          : 'Cost rolled up from the resource cache. Click any workload to see its resources and per-type cost.'}
        {data?.data_source ? `  ·  source: ${data.data_source}` : ''}
      </p>
    </div>
  )
}
