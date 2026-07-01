/**
 * ResiliencyExplorer — interactive, context-driven resiliency analytics for the BCDR category.
 *
 * Every number and chart is computed live from GENUINE per-resource data returned by
 * GET /api/bcdr/resilience (the Azure zone-redundancy assessment joined with each
 * resource's backup/cost signals and any BCDR Planning classification). There is no
 * sample/mock data.
 *
 * Scope behaviour:
 *  - The org-wide BCDR "Dashboard" tab is preserved untouched.
 *  - This view honours the TOP subscription filter (via the `resources` prop, which is
 *    the already-filtered estate) AND adds its own Subscription / Resource Group / Region /
 *    Type / Criticality / Zone selectors so Sub- and RG-level selection re-draws every chart.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import clsx from 'clsx'
import {
  ShieldCheck, ShieldAlert, AlertTriangle, RefreshCw, Loader2, Download,
  Layers, Globe, Server, Filter, X, Gauge, Activity, Database, ChevronRight, MapPin,
  FileText, FileSpreadsheet, Tag,
} from 'lucide-react'
import { api } from '../../api/client'
import { prettyResourceType } from '../../utils/resourceTypes'
import ResourceDetailDrawer from '../ResourceDetailDrawer'

// ── Palettes ────────────────────────────────────────────────────────────────
const ZONE_COLORS = {
  ZoneRedundant: '#22c55e', Zonal: '#eab308', NotZoneAware: '#60a5fa',
  LocallyRedundant: '#ef4444', Unknown: '#6b7280',
}
const ZONE_ORDER = ['ZoneRedundant', 'Zonal', 'NotZoneAware', 'LocallyRedundant', 'Unknown']
const ZONE_LABEL = {
  ZoneRedundant: 'Zone-redundant', Zonal: 'Single-zone (zonal)', NotZoneAware: 'Not zone-aware',
  LocallyRedundant: 'Locally redundant', Unknown: 'Unknown',
}
const CRIT_COLORS = { Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#22c55e', Unclassified: 'var(--c-64748b)' }
const CRIT_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Unclassified']

const GROUP_DIMS = [
  { key: 'subscription_label', label: 'Subscription' },
  { key: 'resource_group', label: 'Resource Group' },
  { key: 'location', label: 'Region' },
  { key: 'type_label', label: 'Resource Type' },
  { key: 'criticality_label', label: 'Criticality' },
  { key: 'workload_tier', label: 'Workload Tier' },
]
const MEASURES = [
  { key: 'count', label: 'Resource count' },
  { key: 'cost', label: 'Monthly cost ($)' },
]

// ── Tiny helpers ─────────────────────────────────────────────────────────────
const pctOf = (n, d) => (d ? Math.round((100 * n) / d) : 0)
const money = (v) => {
  const n = Number(v) || 0
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k'
  return '$' + n.toFixed(0)
}
const critLabel = (c) => {
  const v = (c || '').toString().trim()
  if (!v) return 'Unclassified'
  const hit = CRIT_ORDER.find((k) => k.toLowerCase() === v.toLowerCase())
  return hit || v
}

// ── Donut ────────────────────────────────────────────────────────────────────
function Donut({ data, colorMap, size = 132, unit = '' }) {
  const entries = Object.entries(data).filter(([, v]) => v > 0)
  const total = entries.reduce((a, [, v]) => a + v, 0)
  const r = 52, cx = size / 2, cy = size / 2
  if (!total) {
    return <div style={{ width: size, height: size }} className="rounded-full bg-gray-800/60 flex items-center justify-center text-gray-600 text-xs">No data</div>
  }
  let start = -Math.PI / 2
  const slices = entries.map(([label, value]) => {
    const ang = (value / total) * 2 * Math.PI
    const end = start + ang
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start)
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end)
    const large = ang > Math.PI ? 1 : 0
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
    start = end
    return { label, value, d, color: (colorMap && colorMap[label]) || '#6b7280' }
  })
  return (
    <svg width={size} height={size} className="shrink-0">
      {slices.map((s) => <path key={s.label} d={s.d} fill={s.color} opacity={0.9} />)}
      <circle cx={cx} cy={cy} r={r * 0.6} style={{ fill: 'var(--c-0b1220)' }} />
      <text x={cx} y={cy - 4} textAnchor="middle" style={{ fill: 'var(--c-e5e7eb)' }} fontSize="20" fontWeight="700">{total}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" style={{ fill: 'var(--c-94a3b8)' }} fontSize="9">{unit || 'resources'}</text>
    </svg>
  )
}

function Legend({ data, colorMap, labelMap }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  const entries = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  if (!entries.length) return null
  return (
    <div className="space-y-1.5 text-xs min-w-0">
      {entries.map(([label, v]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: (colorMap && colorMap[label]) || '#6b7280' }} />
          <span className="text-gray-300 truncate flex-1">{(labelMap && labelMap[label]) || label}</span>
          <span className="text-gray-500 tabular-nums">{v}</span>
          <span className="text-gray-600 tabular-nums w-9 text-right">{pctOf(v, total)}%</span>
        </div>
      ))}
    </div>
  )
}

// ── Resiliency gauge (semicircle) ─────────────────────────────────────────────
function Gauge180({ score }) {
  const s = Math.max(0, Math.min(100, Math.round(score)))
  const color = s >= 70 ? '#22c55e' : s >= 45 ? '#eab308' : '#ef4444'
  const w = 200, h = 112, cx = w / 2, cy = h - 8, r = 84
  const polar = (frac) => {
    const ang = Math.PI * (1 - frac)
    return [cx + r * Math.cos(ang), cy - r * Math.sin(ang)]
  }
  const [sx, sy] = polar(0)
  const [ex, ey] = polar(s / 100)
  const [fx, fy] = polar(1)
  const large = s / 100 > 0.5 ? 1 : 0
  return (
    <div className="relative">
      <svg width={w} height={h}>
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${fx} ${fy}`} fill="none" style={{ stroke: 'var(--c-1f2937)' }} strokeWidth="12" strokeLinecap="round" />
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" />
        <text x={cx} y={cy - 26} textAnchor="middle" style={{ fill: 'var(--c-f8fafc)' }} fontSize="34" fontWeight="800">{s}</text>
        <text x={cx} y={cy - 6} textAnchor="middle" style={{ fill: 'var(--c-94a3b8)' }} fontSize="10">/ 100 resiliency</text>
      </svg>
    </div>
  )
}

// ── Stacked horizontal bar (group × zone) ─────────────────────────────────────
function GroupBars({ groups, measure }) {
  if (!groups.length) return <div className="text-gray-600 text-sm py-8 text-center">No data for this selection.</div>
  const max = Math.max(...groups.map((g) => g.total), 1)
  return (
    <div className="space-y-2.5">
      {groups.map((g) => (
        <div key={g.name}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-300 truncate pr-2" title={g.name}>{g.name}</span>
            <span className="text-gray-500 tabular-nums shrink-0">{measure === 'cost' ? money(g.total) : g.total}</span>
          </div>
          <div className="flex h-5 rounded overflow-hidden bg-gray-800/50">
            {ZONE_ORDER.map((z) => {
              const v = g.byZone[z] || 0
              if (!v) return null
              return (
                <div
                  key={z}
                  title={`${ZONE_LABEL[z]}: ${measure === 'cost' ? money(v) : v}`}
                  style={{ width: `${(v / max) * 100}%`, background: ZONE_COLORS[z] }}
                  className="h-full first:rounded-l last:rounded-r"
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── KPI tile ──────────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, tone = 'slate', Icon }) {
  const tones = {
    green: 'border-green-800/50 text-green-300', amber: 'border-amber-800/50 text-amber-300',
    red: 'border-red-800/50 text-red-300', blue: 'border-blue-800/50 text-blue-300', slate: 'border-gray-700/60 text-gray-200',
  }
  return (
    <div className={clsx('rounded-xl bg-gray-900/50 border p-3.5', tones[tone] || tones.slate)}>
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1">
        {Icon && <Icon size={13} />} {label}
      </div>
      <div className="text-2xl font-bold tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function Card({ title, icon: Icon, children, right, className }) {
  return (
    <div className={clsx('rounded-2xl bg-gray-900/40 border border-gray-800/60 p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon size={15} className="text-gray-400" />}
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </div>
  )
}

// ── Filter select ─────────────────────────────────────────────────────────────
function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-900 border border-gray-700/70 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 min-w-[140px] focus:border-blue-500 outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

const ALL = '__all__'

// Flatten a tag object into sortable "key=value" pairs (ignoring empty values).
const tagPairs = (obj) => Object.entries(obj || {})
  .filter(([kk, vv]) => kk && vv != null && String(vv).trim() !== '')
  .map(([kk, vv]) => `${kk}=${vv}`)

// ── Main ───────────────────────────────────────────────────────────────────────
export default function ResiliencyExplorer({ resources = [] }) {
  const [allRows, setAllRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [drill, setDrill] = useState(null)

  // Filters
  const [fSub, setFSub] = useState(ALL)
  const [fRg, setFRg] = useState(ALL)
  const [fRegion, setFRegion] = useState(ALL)
  const [fType, setFType] = useState(ALL)
  const [fCrit, setFCrit] = useState(ALL)
  const [fZone, setFZone] = useState(ALL)
  const [fAzureTag, setFAzureTag] = useState(ALL)
  const [fCustomTag, setFCustomTag] = useState(ALL)
  // Chart controls
  const [groupBy, setGroupBy] = useState('subscription_label')
  const [measure, setMeasure] = useState('count')
  const [exporting, setExporting] = useState(null)
  const [exportErr, setExportErr] = useState('')

  const load = useCallback(() => {
    setLoading(true); setErr('')
    api.getBCDRResilience()
      .then((d) => setAllRows(Array.isArray(d?.rows) ? d.rows : []))
      .catch((e) => setErr(e?.message || 'Failed to load resiliency data'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  // Enrich rows with display labels + honour the TOP subscription filter (resources prop scope).
  const scopedRows = useMemo(() => {
    const rows = allRows || []
    const scopeIds = new Set(
      (resources || []).map((r) => (r.resource_id || r.id || '').toLowerCase()).filter(Boolean),
    )
    const base = scopeIds.size ? rows.filter((r) => scopeIds.has((r.resource_id || '').toLowerCase())) : rows
    return base.map((r) => ({
      ...r,
      subscription_label: r.subscription_name || (r.subscription_id ? r.subscription_id.slice(0, 8) + '…' : 'Unknown'),
      type_label: prettyResourceType(r.resource_type || '') || (r.resource_type || 'Unknown'),
      criticality_label: critLabel(r.criticality),
      location: r.location || 'unknown',
      resource_group: r.resource_group || 'unknown',
      workload_tier: r.workload_tier || 'Unknown',
    }))
  }, [allRows, resources])

  // Filter option lists (derived from the scoped set so they always make sense).
  const opts = useMemo(() => {
    const uniq = (key) => Array.from(new Set(scopedRows.map((r) => r[key]).filter(Boolean))).sort()
    const mk = (vals, allLabel) => [{ value: ALL, label: allLabel }, ...vals.map((v) => ({ value: v, label: v }))]
    const azSet = new Set(), ctSet = new Set()
    scopedRows.forEach((r) => {
      tagPairs(r.azure_tags).forEach((p) => azSet.add(p))
      tagPairs(r.custom_tags).forEach((p) => ctSet.add(p))
    })
    const mkPairs = (set, allLabel) => [{ value: ALL, label: allLabel },
      ...Array.from(set).sort().map((p) => ({ value: p, label: p.replace('=', ': ') }))]
    return {
      sub: mk(uniq('subscription_label'), 'All subscriptions'),
      rg: mk(uniq('resource_group'), 'All resource groups'),
      region: mk(uniq('location'), 'All regions'),
      type: mk(uniq('type_label'), 'All types'),
      crit: mk(CRIT_ORDER.filter((c) => scopedRows.some((r) => r.criticality_label === c)), 'All criticality'),
      zone: mk(ZONE_ORDER.filter((z) => scopedRows.some((r) => r.zone_status === z)), 'All zone states'),
      azureTag: mkPairs(azSet, 'All Azure tags'),
      customTag: mkPairs(ctSet, 'All custom tags'),
    }
  }, [scopedRows])

  // Apply the in-view context filters.
  const rows = useMemo(() => scopedRows.filter((r) =>
    (fSub === ALL || r.subscription_label === fSub) &&
    (fRg === ALL || r.resource_group === fRg) &&
    (fRegion === ALL || r.location === fRegion) &&
    (fType === ALL || r.type_label === fType) &&
    (fCrit === ALL || r.criticality_label === fCrit) &&
    (fZone === ALL || r.zone_status === fZone) &&
    (fAzureTag === ALL || tagPairs(r.azure_tags).includes(fAzureTag)) &&
    (fCustomTag === ALL || tagPairs(r.custom_tags).includes(fCustomTag)),
  ), [scopedRows, fSub, fRg, fRegion, fType, fCrit, fZone, fAzureTag, fCustomTag])

  // KPIs
  const k = useMemo(() => {
    const total = rows.length
    const zr = rows.filter((r) => r.zone_status === 'ZoneRedundant').length
    const backed = rows.filter((r) => r.has_backup).length
    const geo = rows.filter((r) => r.geo_redundant).length
    const critAtRisk = rows.filter((r) =>
      ['Critical', 'High'].includes(r.criticality_label) && (r.zone_status !== 'ZoneRedundant' || !r.has_backup),
    ).length
    const avgRisk = total ? Math.round(rows.reduce((a, r) => a + (r.zone_risk_score || 0), 0) / total) : 0
    const zonePct = pctOf(zr, total), backupPct = pctOf(backed, total), geoPct = pctOf(geo, total)
    // Composite resiliency score: zone redundancy (40%) + backup (30%) + geo (30%).
    const score = Math.round(0.4 * zonePct + 0.3 * backupPct + 0.3 * geoPct)
    const monthlyExposed = rows
      .filter((r) => r.zone_status !== 'ZoneRedundant' || !r.has_backup)
      .reduce((a, r) => a + (Number(r.cost_current_month) || 0), 0)
    return { total, zr, backed, geo, critAtRisk, avgRisk, zonePct, backupPct, geoPct, score, monthlyExposed }
  }, [rows])

  // Distributions
  const zoneDist = useMemo(() => {
    const d = {}; ZONE_ORDER.forEach((z) => { d[z] = 0 }); rows.forEach((r) => { d[r.zone_status] = (d[r.zone_status] || 0) + 1 }); return d
  }, [rows])
  const backupDist = useMemo(() => ({
    Protected: rows.filter((r) => r.has_backup).length,
    Unprotected: rows.filter((r) => !r.has_backup).length,
  }), [rows])
  const geoDist = useMemo(() => ({
    'Geo-redundant': rows.filter((r) => r.geo_redundant).length,
    'Single-region': rows.filter((r) => !r.geo_redundant).length,
  }), [rows])

  // Group-by chart data
  const groups = useMemo(() => {
    const map = new Map()
    rows.forEach((r) => {
      const name = r[groupBy] || 'Unknown'
      if (!map.has(name)) map.set(name, { name, total: 0, byZone: {} })
      const g = map.get(name)
      const inc = measure === 'cost' ? (Number(r.cost_current_month) || 0) : 1
      g.total += inc
      g.byZone[r.zone_status] = (g.byZone[r.zone_status] || 0) + inc
    })
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 12)
  }, [rows, groupBy, measure])

  // Risk matrix: criticality × zone
  const matrix = useMemo(() => {
    const m = {}
    CRIT_ORDER.forEach((c) => { m[c] = {}; ZONE_ORDER.forEach((z) => { m[c][z] = 0 }) })
    rows.forEach((r) => { m[r.criticality_label][r.zone_status] = (m[r.criticality_label][r.zone_status] || 0) + 1 })
    return m
  }, [rows])

  // At-risk table
  const atRisk = useMemo(() => {
    const critWeight = { Critical: 40, High: 25, Medium: 10, Low: 3, Unclassified: 5 }
    return rows
      .map((r) => {
        let risk = r.zone_risk_score || 0
        if (r.zone_status !== 'ZoneRedundant') risk += 15
        if (!r.has_backup) risk += 20
        risk += critWeight[r.criticality_label] || 0
        return { ...r, _risk: Math.min(100, risk) }
      })
      .filter((r) => r.zone_status !== 'ZoneRedundant' || !r.has_backup || r.needs_dr_action)
      .sort((a, b) => b._risk - a._risk)
      .slice(0, 40)
  }, [rows])

  const anyFilter = [fSub, fRg, fRegion, fType, fCrit, fZone, fAzureTag, fCustomTag].some((v) => v !== ALL)
  const clearFilters = () => { setFSub(ALL); setFRg(ALL); setFRegion(ALL); setFType(ALL); setFCrit(ALL); setFZone(ALL); setFAzureTag(ALL); setFCustomTag(ALL) }

  const exportCsv = () => {
    const cols = ['resource_name', 'resource_type', 'resource_group', 'subscription_name', 'location',
      'zone_status', 'geo_redundant', 'has_backup', 'criticality', 'dr_tier', 'rto_target', 'rpo_target',
      'zone_risk_score', 'cost_current_month']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(',')))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `resiliency-explorer-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  // Assemble the exact on-screen (filtered) posture for the PDF / Excel deliverables.
  const buildExportPayload = () => {
    const dimLabel = (GROUP_DIMS.find((g) => g.key === groupBy) || {}).label || 'Group'
    const measLabel = (MEASURES.find((m) => m.key === measure) || {}).label || 'Resource count'
    const scope = {}
    const addScope = (label, val, optList) => {
      if (val !== ALL) { const o = (optList || []).find((x) => x.value === val); scope[label] = o ? o.label : val }
    }
    addScope('Subscription', fSub, opts.sub)
    addScope('Resource Group', fRg, opts.rg)
    addScope('Region', fRegion, opts.region)
    addScope('Type', fType, opts.type)
    addScope('Criticality', fCrit, opts.crit)
    addScope('Zone state', fZone, opts.zone)
    addScope('Azure tag', fAzureTag, opts.azureTag)
    addScope('Custom tag', fCustomTag, opts.customTag)
    if (!Object.keys(scope).length) scope['Scope'] = 'Entire estate in view (no filters)'
    return {
      generated_at: new Date().toISOString(),
      scope,
      kpis: { score: k.score, total: k.total, zr: k.zr, zonePct: k.zonePct, backed: k.backed, backupPct: k.backupPct, geo: k.geo, geoPct: k.geoPct, critAtRisk: k.critAtRisk, avgRisk: k.avgRisk, monthlyExposed: Math.round(k.monthlyExposed) },
      zone_distribution: zoneDist,
      backup_distribution: backupDist,
      geo_distribution: geoDist,
      group_by_label: dimLabel,
      measure_label: measLabel,
      groups,
      risk_matrix: matrix,
      at_risk: atRisk.map((r) => ({ resource_name: r.resource_name, resource_type: r.resource_type, resource_group: r.resource_group, location: r.location, criticality: r.criticality_label, zone_status: r.zone_status, has_backup: r.has_backup, risk: r._risk })),
      rows: rows.map((r) => ({ resource_name: r.resource_name, resource_type: r.resource_type, resource_group: r.resource_group, subscription_name: r.subscription_name, subscription_id: r.subscription_id, location: r.location, zone_status: r.zone_status, geo_redundant: r.geo_redundant, has_backup: r.has_backup, criticality: r.criticality_label, dr_tier: r.dr_tier, rto_target: r.rto_target, rpo_target: r.rpo_target, zone_risk_score: r.zone_risk_score, cost_current_month: r.cost_current_month })),
    }
  }

  const exportPdf = async () => {
    setExporting('pdf'); setExportErr('')
    try {
      const { generateResiliencyPDF } = await import('../../utils/resiliencyExport')
      const blob = await generateResiliencyPDF(buildExportPayload())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `Resiliency-Explorer-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch (e) { setExportErr(e?.message || 'PDF export failed') } finally { setExporting(null) }
  }

  const exportXlsx = async () => {
    setExporting('xlsx'); setExportErr('')
    try { await api.exportResiliencyXlsx(buildExportPayload()) }
    catch (e) { setExportErr(e?.message || 'Excel export failed') } finally { setExporting(null) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-gray-500 text-sm">
        <Loader2 className="animate-spin" size={18} /> Computing resiliency posture from the live estate…
      </div>
    )
  }
  if (err) {
    return (
      <div className="flex items-center gap-3 bg-red-900/20 border border-red-800/40 text-red-300 rounded-xl px-4 py-3 text-sm">
        <AlertTriangle size={16} /> {err}
        <button onClick={load} className="ml-auto px-3 py-1 rounded-lg bg-red-600/30 hover:bg-red-600/50 text-xs">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="rounded-2xl bg-gradient-to-r from-sky-950/40 to-indigo-950/30 border border-sky-900/40 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
            <Activity size={20} className="text-sky-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white">Resiliency Explorer</h2>
            <p className="text-xs text-gray-400">
              Live availability-zone, backup &amp; geo-redundancy posture — drill by subscription, resource group, region, type or criticality.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={exportPdf} disabled={!rows.length || !!exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 border border-gray-700/60 text-gray-300 hover:bg-gray-700 disabled:opacity-40">
              {exporting === 'pdf' ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} PDF
            </button>
            <button onClick={exportXlsx} disabled={!rows.length || !!exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 border border-gray-700/60 text-gray-300 hover:bg-gray-700 disabled:opacity-40">
              {exporting === 'xlsx' ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />} Excel
            </button>
            <button onClick={exportCsv} disabled={!rows.length}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 border border-gray-700/60 text-gray-300 hover:bg-gray-700 disabled:opacity-40">
              <Download size={13} /> CSV
            </button>
            <button onClick={load}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 border border-gray-700/60 text-gray-300 hover:bg-gray-700">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2.5 mt-4">
          <FilterSelect label="Subscription" value={fSub} onChange={setFSub} options={opts.sub} />
          <FilterSelect label="Resource Group" value={fRg} onChange={setFRg} options={opts.rg} />
          <FilterSelect label="Region" value={fRegion} onChange={setFRegion} options={opts.region} />
          <FilterSelect label="Type" value={fType} onChange={setFType} options={opts.type} />
          <FilterSelect label="Criticality" value={fCrit} onChange={setFCrit} options={opts.crit} />
          <FilterSelect label="Zone state" value={fZone} onChange={setFZone} options={opts.zone} />
          {opts.azureTag.length > 1 && <FilterSelect label="Azure Tag" value={fAzureTag} onChange={setFAzureTag} options={opts.azureTag} />}
          {opts.customTag.length > 1 && <FilterSelect label="Custom Tag" value={fCustomTag} onChange={setFCustomTag} options={opts.customTag} />}
          {anyFilter && (
            <button onClick={clearFilters} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 border border-gray-700/60">
              <X size={12} /> Clear
            </button>
          )}
          {exportErr && <span className="text-[11px] text-red-400 self-center">{exportErr}</span>}
          <span className="ml-auto text-xs text-gray-500 self-center">
            <span className="text-gray-300 font-semibold tabular-nums">{rows.length}</span> resources in scope
          </span>
        </div>
      </div>

      {/* Score + KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Card title="Resiliency Score" icon={Gauge} className="lg:col-span-3 flex flex-col items-center justify-center">
          <Gauge180 score={k.score} />
          <p className="text-[11px] text-gray-500 text-center mt-1">Zone redundancy 40% · Backup 30% · Geo 30%</p>
        </Card>
        <div className="lg:col-span-9 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Resources" value={k.total} sub="in current scope" tone="slate" Icon={Server} />
          <Kpi label="Zone-redundant" value={`${k.zonePct}%`} sub={`${k.zr} of ${k.total}`} tone={k.zonePct >= 60 ? 'green' : k.zonePct >= 30 ? 'amber' : 'red'} Icon={ShieldCheck} />
          <Kpi label="Backup coverage" value={`${k.backupPct}%`} sub={`${k.backed} protected`} tone={k.backupPct >= 80 ? 'green' : k.backupPct >= 50 ? 'amber' : 'red'} Icon={Database} />
          <Kpi label="Geo-redundant" value={`${k.geoPct}%`} sub={`${k.geo} multi-region`} tone={k.geoPct >= 50 ? 'green' : k.geoPct >= 20 ? 'amber' : 'red'} Icon={Globe} />
          <Kpi label="Critical at risk" value={k.critAtRisk} sub="Crit/High exposed" tone={k.critAtRisk ? 'red' : 'green'} Icon={ShieldAlert} />
          <Kpi label="Exposed spend" value={money(k.monthlyExposed)} sub="/mo not fully protected" tone="blue" Icon={AlertTriangle} />
        </div>
      </div>

      {/* Donuts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Availability-zone resilience" icon={ShieldCheck}>
          <div className="flex items-center gap-4">
            <Donut data={zoneDist} colorMap={ZONE_COLORS} />
            <Legend data={zoneDist} colorMap={ZONE_COLORS} labelMap={ZONE_LABEL} />
          </div>
        </Card>
        <Card title="Backup coverage" icon={Database}>
          <div className="flex items-center gap-4">
            <Donut data={backupDist} colorMap={{ Protected: '#22c55e', Unprotected: '#ef4444' }} />
            <Legend data={backupDist} colorMap={{ Protected: '#22c55e', Unprotected: '#ef4444' }} />
          </div>
        </Card>
        <Card title="Cross-region redundancy" icon={Globe}>
          <div className="flex items-center gap-4">
            <Donut data={geoDist} colorMap={{ 'Geo-redundant': '#22c55e', 'Single-region': '#f97316' }} />
            <Legend data={geoDist} colorMap={{ 'Geo-redundant': '#22c55e', 'Single-region': '#f97316' }} />
          </div>
        </Card>
      </div>

      {/* Customizable group-by chart + risk matrix */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card
          title="Resilience breakdown"
          icon={Layers}
          right={(
            <div className="flex items-center gap-2">
              <select value={measure} onChange={(e) => setMeasure(e.target.value)}
                className="bg-gray-900 border border-gray-700/70 rounded-lg px-2 py-1 text-xs text-gray-300">
                {MEASURES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
              <span className="text-xs text-gray-500">by</span>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
                className="bg-gray-900 border border-gray-700/70 rounded-lg px-2 py-1 text-xs text-gray-300">
                {GROUP_DIMS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select>
            </div>
          )}
        >
          <GroupBars groups={groups} measure={measure} />
          <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-gray-800/60">
            {ZONE_ORDER.map((z) => (
              <span key={z} className="flex items-center gap-1.5 text-[10px] text-gray-400">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: ZONE_COLORS[z] }} />{ZONE_LABEL[z]}
              </span>
            ))}
          </div>
        </Card>

        <Card title="Risk matrix — criticality × zone resilience" icon={ShieldAlert}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500">
                  <th className="text-left font-medium py-1.5 pr-2">Criticality</th>
                  {ZONE_ORDER.map((z) => (
                    <th key={z} className="px-1.5 py-1.5 text-center font-medium" title={ZONE_LABEL[z]}>
                      <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle" style={{ background: ZONE_COLORS[z] }} />
                    </th>
                  ))}
                  <th className="px-1.5 text-center font-medium">Σ</th>
                </tr>
              </thead>
              <tbody>
                {CRIT_ORDER.map((c) => {
                  const rowTotal = ZONE_ORDER.reduce((a, z) => a + (matrix[c][z] || 0), 0)
                  if (!rowTotal) return null
                  return (
                    <tr key={c} className="border-t border-gray-800/50">
                      <td className="py-1.5 pr-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: CRIT_COLORS[c] }} />
                          <span className="text-gray-300">{c}</span>
                        </span>
                      </td>
                      {ZONE_ORDER.map((z) => {
                        const v = matrix[c][z] || 0
                        const danger = v > 0 && (z === 'LocallyRedundant' || z === 'Zonal') && (c === 'Critical' || c === 'High')
                        return (
                          <td key={z} className="px-1.5 py-1.5 text-center">
                            {v > 0
                              ? <span className={clsx('inline-block min-w-[22px] px-1.5 py-0.5 rounded tabular-nums', danger ? 'bg-red-600/30 text-red-200 font-semibold ring-1 ring-red-700/50' : 'bg-gray-800/70 text-gray-300')}>{v}</span>
                              : <span className="text-gray-700">·</span>}
                          </td>
                        )
                      })}
                      <td className="px-1.5 text-center text-gray-400 tabular-nums font-medium">{rowTotal}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">Highlighted cells = business-critical workloads without zone redundancy (priority DR candidates).</p>
        </Card>
      </div>

      {/* At-risk table */}
      <Card title={`Top resiliency risks (${atRisk.length})`} icon={AlertTriangle}>
        {atRisk.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            <ShieldCheck size={22} className="mx-auto mb-2 text-green-500" />
            No exposed resources in this selection — everything in scope is zone-redundant and backed up.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left font-medium py-2 pr-3">Resource</th>
                  <th className="text-left font-medium py-2 pr-3">Type</th>
                  <th className="text-left font-medium py-2 pr-3 hidden md:table-cell">Resource group</th>
                  <th className="text-left font-medium py-2 pr-3 hidden lg:table-cell">Region</th>
                  <th className="text-left font-medium py-2 pr-3">Criticality</th>
                  <th className="text-left font-medium py-2 pr-3">Zone</th>
                  <th className="text-center font-medium py-2 pr-3">Backup</th>
                  <th className="text-right font-medium py-2 pr-2">Risk</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map((r) => (
                  <tr
                    key={r.resource_id}
                    onClick={() => setDrill({ id: r.resource_id, name: r.resource_name })}
                    className="border-b border-gray-800/40 hover:bg-gray-800/40 cursor-pointer"
                  >
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5 text-gray-200">
                        {r.resource_name || '—'}<ChevronRight size={12} className="text-gray-600" />
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-gray-400">{r.type_label}</td>
                    <td className="py-2 pr-3 text-gray-400 hidden md:table-cell">{r.resource_group}</td>
                    <td className="py-2 pr-3 text-gray-400 hidden lg:table-cell">
                      <span className="inline-flex items-center gap-1"><MapPin size={11} className="text-gray-600" />{r.location}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ background: (CRIT_COLORS[r.criticality_label] || 'var(--c-64748b)') + '26', color: CRIT_COLORS[r.criticality_label] || 'var(--c-94a3b8)' }}>
                        {r.criticality_label}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: ZONE_COLORS[r.zone_status] }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: ZONE_COLORS[r.zone_status] }} />
                        {ZONE_LABEL[r.zone_status] || r.zone_status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-center">
                      {r.has_backup
                        ? <span className="text-green-400">✓</span>
                        : <span className="text-red-400 font-semibold">✗</span>}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <span className={clsx('inline-block min-w-[34px] px-1.5 py-0.5 rounded tabular-nums font-semibold',
                        r._risk >= 70 ? 'bg-red-900/40 text-red-300' : r._risk >= 45 ? 'bg-orange-900/40 text-orange-300' : 'bg-yellow-900/30 text-yellow-300')}>
                        {r._risk}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[10px] text-gray-600 text-center">
        Computed live from {scopedRows.length} assessed resources via the Azure availability-zone redundancy assessment joined with backup, cost and BCDR Planning classification — no sample data.
      </p>

      {drill && (
        <ResourceDetailDrawer resourceId={drill.id} resourceName={drill.name} onClose={() => setDrill(null)} />
      )}
    </div>
  )
}
