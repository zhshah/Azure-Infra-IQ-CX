/**
 * Cost Studio — the "design your own FinOps dashboard" flagship view.
 *
 * The differentiator vs Azure Portal: pick from a catalog of rich widgets,
 * apply global cascading filters (sub / RG / region / time / group-by), save
 * named layouts (Executive / Engineering / Governance / custom). Every widget
 * is fed from existing FinOps endpoints — nothing here is fake.
 *
 * Rules of Hooks: all hooks declared unconditionally BEFORE any early return.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  RadialBarChart, RadialBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Treemap,
} from 'recharts'
import {
  LayoutDashboard, Filter, Save, Trash2, X, Settings2, RefreshCw, Palette,
  AlertTriangle, TrendingUp, DollarSign, Zap, Shield, Tag, Activity, Target,
} from 'lucide-react'
import {
  finopsApi, fmtUsd, fmtPct, getSubscriptions, getFilterOptions, TIME_RANGE_OPTIONS,
} from './finopsApi'
import SearchableSelect from '../components/shared/SearchableSelect'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'

// ── Design tokens & shared styles ───────────────────────────────────────────
const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#10b981', '#eab308', '#a855f7', '#14b8a6']
const btnPrimary = { display: 'flex', alignItems: 'center', gap: 5, background: '#4f46e5', border: '1px solid #4f46e5', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 600 }
const btnGhost   = { display: 'flex', alignItems: 'center', gap: 5, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 11 }
const iconBtn    = { background: 'none', border: 'none', color: 'var(--c-64748b)', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }
const inputStyle = { background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 9px', color: 'var(--c-e2e8f0)', fontSize: 12, width: '100%', boxSizing: 'border-box' }
const errorBox   = { display: 'flex', gap: 8, alignItems: 'center', background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', color: 'var(--c-fca5a5)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }
const filterBar  = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: '12px 16px' }
const cardStyle  = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }

// ── Widget catalog ──────────────────────────────────────────────────────────
// colspan: 1 = half width, 2 = full width (4-col grid → span 2 or span 4)
const WIDGET_CATALOG = [
  { id: 'kpi-strip',      name: 'KPI Strip',                colspan: 2, group: 'summary',   desc: 'MTD spend, forecast, MoM, savings' },
  { id: 'spend-trend',    name: 'Spend Trend (30d)',        colspan: 2, group: 'trend',     desc: 'Daily spend area chart' },
  { id: 'forecast-band',  name: 'Forecast (90d)',           colspan: 1, group: 'trend',     desc: 'History + projected end-of-month' },
  { id: 'heatmap-cal',    name: 'Daily Spend Heatmap',      colspan: 2, group: 'trend',     desc: 'GitHub-style calendar of daily spend' },
  { id: 'svc-bars',       name: 'Cost by dimension (Group By)', colspan: 1, group: 'break', desc: 'Follows the Group-By filter' },
  { id: 'rg-treemap',     name: 'Cost by Resource Group',   colspan: 2, group: 'break',     desc: 'Proportional treemap of RGs' },
  { id: 'sub-donut',      name: 'Cost by Subscription',     colspan: 1, group: 'break',     desc: 'Donut chart' },
  { id: 'region-bars',    name: 'Cost by Region',           colspan: 1, group: 'break',     desc: 'Bar chart per Azure region' },
  { id: 'mom-waterfall',  name: 'MoM Movers',               colspan: 1, group: 'trend',     desc: 'Month-over-month change' },
  { id: 'tag-compliance', name: 'Tag Compliance',           colspan: 1, group: 'gov',       desc: 'Tagged vs untagged coverage' },
  { id: 'ri-gauges',      name: 'Reservation Coverage & Use', colspan: 1, group: 'commit',  desc: 'Coverage + utilization gauges' },
  { id: 'top-resources',  name: 'Top-N Costliest Resources', colspan: 2, group: 'detail',   desc: 'Table of highest-spend resources' },
  { id: 'savings-list',   name: 'Savings Opportunities',    colspan: 1, group: 'detail',    desc: 'Top optimization recommendations' },
  { id: 'anomaly-list',   name: 'Cost Anomalies',           colspan: 1, group: 'detail',    desc: 'Detected spend spikes' },
]

// Named built-in layouts (users can also save their own).
const DEFAULT_LAYOUTS = {
  'Executive (CFO)':      ['kpi-strip', 'spend-trend', 'sub-donut', 'forecast-band', 'mom-waterfall', 'savings-list', 'anomaly-list'],
  'Engineering':          ['kpi-strip', 'rg-treemap', 'svc-bars', 'top-resources', 'region-bars', 'heatmap-cal', 'anomaly-list'],
  'Governance & Tagging': ['kpi-strip', 'tag-compliance', 'ri-gauges', 'sub-donut', 'top-resources', 'savings-list'],
  'Everything':           WIDGET_CATALOG.map(w => w.id),
}

const LAYOUTS_KEY = 'finops:studio:layouts:v1'
const ACTIVE_KEY  = 'finops:studio:active:v1'
const FILTERS_KEY = 'finops:studio:filters:v1'

const loadUserLayouts = () => {
  try { const s = localStorage.getItem(LAYOUTS_KEY); if (s) return JSON.parse(s) || {} } catch { /* ignore */ }
  return {}
}
const allLayouts = () => ({ ...DEFAULT_LAYOUTS, ...loadUserLayouts() })
const saveUserLayouts = (merged) => {
  const user = Object.fromEntries(Object.entries(merged).filter(([k]) => !(k in DEFAULT_LAYOUTS)))
  try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(user)) } catch { /* ignore */ }
}

// ── Tiny chart helpers ──────────────────────────────────────────────────────
function TinyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: 'var(--c-e2e8f0)' }}>
      {label != null && <div style={{ color: 'var(--c-64748b)', marginBottom: 3 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {p.name}: <strong>{typeof p.value === 'number' ? fmtUsd(p.value) : p.value}</strong>
        </div>
      ))}
    </div>
  )
}
const shortDate = (v) => (typeof v === 'string' ? v.slice(5) : v)

// ── Widget components ──────────────────────────────────────────────────────
function KPIStrip({ s }) {
  if (!s) return <Empty msg="No summary data yet" />
  const items = [
    { label: 'MTD Spend',        value: fmtUsd(s.total_spend_mtd),        icon: DollarSign,  color: '#3b82f6' },
    { label: 'Forecast EOM',     value: fmtUsd(s.forecast_eom_usd),        icon: TrendingUp,  color: '#8b5cf6' },
    { label: 'Savings potential',value: fmtUsd(s.savings_identified_usd) + '/mo', icon: Zap, color: '#22c55e' },
    { label: 'Tag compliance',   value: `${(s.tagging_compliance_pct ?? 0).toFixed(0)}%`, icon: Tag, color: '#f59e0b' },
    { label: 'Budgets exceeded', value: String(s.budgets_exceeded ?? 0),   icon: Shield,      color: (s.budgets_exceeded ?? 0) > 0 ? '#ef4444' : '#22c55e' },
    { label: 'Anomalies',        value: String(s.anomaly_count ?? 0),      icon: Activity,    color: (s.anomaly_count ?? 0) > 0 ? '#f97316' : '#22c55e' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8, flex: 1 }}>
      {items.map((it, i) => {
        const Icon = it.icon
        return (
          <div key={i} style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
              <Icon size={12} style={{ color: it.color }} /> {it.label}
            </div>
            <div style={{ color: it.color, fontSize: 18, fontWeight: 700 }}>{it.value}</div>
          </div>
        )
      })}
    </div>
  )
}

function SpendTrend({ d }) {
  const data = (d?.trend || []).map(p => ({ date: p.date, cost: p.cost ?? 0 }))
  if (!data.length) return <Empty msg="No trend data" />
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="areaSpend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.55} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tickFormatter={shortDate} stroke="#475569" fontSize={10} />
        <YAxis stroke="#475569" fontSize={10} tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`} />
        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
        <Tooltip content={<TinyTooltip />} />
        <Area type="monotone" dataKey="cost" name="Spend" stroke="#3b82f6" fill="url(#areaSpend)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function ForecastBand({ f }) {
  const history = (f?.history || []).map(p => ({ date: p.date, actual: p.cost }))
  const forecast = (f?.forecast || []).map(p => ({ date: p.date, forecast: p.cost }))
  const data = [...history, ...forecast]
  if (!data.length) return <Empty msg="No forecast data" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ color: 'var(--c-94a3b8)', fontSize: 11 }}>Projected EOM: <b style={{ color: '#8b5cf6' }}>{fmtUsd(f?.eom_forecast_usd)}</b></div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" tickFormatter={shortDate} stroke="#475569" fontSize={10} />
          <YAxis stroke="#475569" fontSize={10} tickFormatter={(v) => `$${Math.round(v)}`} />
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
          <Tooltip content={<TinyTooltip />} />
          <Line type="monotone" dataKey="actual" name="Actual" stroke="#3b82f6" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#8b5cf6" dot={false} strokeWidth={2} strokeDasharray="5 4" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function HeatmapCal({ dates, values }) {
  // GitHub-style calendar: 12 weeks × 7 days = 84 cells.
  const pairs = (dates || []).map((d, i) => ({ date: d, v: (values || [])[i] ?? 0 })).slice(-84)
  if (!pairs.length) return <Empty msg="No trend series" />
  const max = Math.max(...pairs.map(p => p.v), 0.0001)
  const shade = (v) => {
    if (v <= 0) return '#0f172a'
    const t = Math.min(1, v / max)
    // interpolate slate → indigo
    const r = Math.round(15 + t * (129 - 15))
    const g = Math.round(23 + t * (140 - 23))
    const b = Math.round(42 + t * (248 - 42))
    return `rgb(${r},${g},${b})`
  }
  const cell = 14
  const gap  = 2
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ color: 'var(--c-64748b)', fontSize: 11 }}>Last {pairs.length} days · peak {fmtUsd(max)}/day</div>
      <svg width={12 * (cell + gap)} height={7 * (cell + gap)} style={{ display: 'block' }}>
        {pairs.map((p, i) => {
          const col = Math.floor(i / 7)
          const row = i % 7
          return (
            <rect key={i} x={col * (cell + gap)} y={row * (cell + gap)} width={cell} height={cell} rx={2}
              fill={shade(p.v)} stroke="#1e293b" strokeWidth={0.5}>
              <title>{p.date}: {fmtUsd(p.v)}</title>
            </rect>
          )
        })}
      </svg>
    </div>
  )
}

function BreakdownBars({ items, title, height = 220 }) {
  const data = (items || []).slice(0, 10).map((x, i) => ({
    name: (x.name || x.key || '—').toString().slice(0, 22),
    cost: x.cost ?? x.value ?? 0,
    fill: PALETTE[i % PALETTE.length],
  }))
  if (!data.length) return <Empty msg={`No ${title || 'breakdown'} data`} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
        <XAxis type="number" stroke="#475569" fontSize={10} tickFormatter={(v) => `$${Math.round(v)}`} />
        <YAxis type="category" dataKey="name" stroke="#475569" fontSize={10} width={110} />
        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" horizontal={false} />
        <Tooltip content={<TinyTooltip />} />
        <Bar dataKey="cost" name="Cost">
          {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function DonutBreakdown({ items }) {
  const data = (items || []).slice(0, 6).map((x, i) => ({
    name: (x.name || '—').toString().slice(0, 28),
    value: x.cost ?? x.value ?? 0,
    fill: PALETTE[i % PALETTE.length],
  }))
  if (!data.length) return <Empty msg="No breakdown data" />
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1 }}>
      <ResponsiveContainer width="55%" height={180}>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={40} outerRadius={70} paddingAngle={2}>
            {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Pie>
          <Tooltip content={<TinyTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ width: 8, height: 8, background: d.fill, borderRadius: 2, flexShrink: 0 }} />
            <span style={{ color: 'var(--c-cbd5e1)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
            <span style={{ color: 'var(--c-94a3b8)' }}>{fmtPct((d.value / total) * 100)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RGTreemap({ items }) {
  const data = (items || []).slice(0, 20).map((x, i) => ({
    name: (x.name || '—').toString(),
    size: x.cost ?? x.value ?? 0,
    fill: PALETTE[i % PALETTE.length],
  })).filter(x => x.size > 0)
  if (!data.length) return <Empty msg="No RG breakdown data" />
  return (
    <ResponsiveContainer width="100%" height={260}>
      <Treemap data={data} dataKey="size" stroke="#0f172a" content={<TreemapCell />} />
    </ResponsiveContainer>
  )
}
function TreemapCell(props) {
  const { x, y, width, height, name, size, index } = props
  if (width < 2 || height < 2) return null
  const fill = PALETTE[(index ?? 0) % PALETTE.length]
  const showLabel = width > 60 && height > 30
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#0f172a" strokeWidth={1} opacity={0.9} />
      {showLabel && (
        <>
          <text x={x + 6} y={y + 14} fontSize={11} fill="#fff" fontWeight={700}>{(name || '').slice(0, Math.max(4, Math.floor(width / 8)))}</text>
          <text x={x + 6} y={y + 28} fontSize={10} fill="#e2e8f0">{fmtUsd(size)}</text>
        </>
      )}
    </g>
  )
}

function MoMMovers({ s }) {
  const curr = s?.total_spend_mtd ?? 0
  const prev = s?.total_spend_last_month ?? 0
  const delta = curr - prev
  const pct = prev > 0 ? ((curr - prev) / prev) * 100 : 0
  const forecast = s?.forecast_eom_usd ?? 0
  const projDelta = forecast - prev
  const projPct = prev > 0 ? ((forecast - prev) / prev) * 100 : 0
  const rows = [
    { label: 'Last month total',   value: prev,     color: 'var(--c-475569)', width: 100 },
    { label: 'This month MTD',     value: curr,     color: '#3b82f6',         width: prev > 0 ? Math.min(100, (curr / prev) * 100) : 100 },
    { label: 'Projected EOM',      value: forecast, color: '#8b5cf6',         width: prev > 0 ? Math.min(100, (forecast / prev) * 100) : 100 },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ color: 'var(--c-64748b)', fontSize: 11 }}>MTD vs last month</div>
      {rows.map((r, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--c-94a3b8)', marginBottom: 3 }}>
            <span>{r.label}</span><span style={{ color: r.color, fontWeight: 600 }}>{fmtUsd(r.value)}</span>
          </div>
          <div style={{ height: 8, background: 'var(--c-0f172a)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${r.width}%`, height: '100%', background: r.color, opacity: 0.7 }} />
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 4 }}>
        <span style={{ color: 'var(--c-94a3b8)' }}>Actual change:</span>
        <span style={{ color: delta >= 0 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>
          {delta >= 0 ? '+' : ''}{fmtUsd(delta)} ({fmtPct(pct)})
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color: 'var(--c-94a3b8)' }}>Projected change:</span>
        <span style={{ color: projDelta >= 0 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>
          {projDelta >= 0 ? '+' : ''}{fmtUsd(projDelta)} ({fmtPct(projPct)})
        </span>
      </div>
    </div>
  )
}

function TagCompliance({ s }) {
  const total = s?.total_resource_count ?? 0
  const untagged = s?.total_untagged ?? 0
  const tagged = Math.max(0, total - untagged)
  const pct = s?.tagging_compliance_pct ?? (total > 0 ? (tagged / total) * 100 : 0)
  const data = [
    { name: 'Tagged',   value: tagged,   fill: '#22c55e' },
    { name: 'Untagged', value: untagged, fill: '#ef4444' },
  ]
  const keys = s?.tag_required_keys || []
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flex: 1 }}>
      <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={45} outerRadius={60} startAngle={90} endAngle={-270}>
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444', fontSize: 20, fontWeight: 700 }}>{pct.toFixed(0)}%</div>
          <div style={{ color: 'var(--c-64748b)', fontSize: 9 }}>compliant</div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ color: 'var(--c-cbd5e1)', fontSize: 12 }}>{tagged.toLocaleString()} / {total.toLocaleString()} tagged</div>
        <div style={{ color: '#ef4444', fontSize: 11 }}>{untagged.toLocaleString()} missing required tags</div>
        {keys.length > 0 && (
          <div style={{ color: 'var(--c-64748b)', fontSize: 10, marginTop: 4 }}>
            Required: {keys.slice(0, 4).map((k) => (
              <span key={k} style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 4, padding: '1px 6px', marginRight: 4, color: 'var(--c-94a3b8)' }}>{k}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RIGauges({ c }) {
  const cov = c?.coverage_pct ?? 0
  const util = c?.utilization_pct ?? 0
  const mkData = (v, color) => [{ name: 'v', value: Math.max(0, Math.min(100, v)), fill: color }]
  return (
    <div style={{ display: 'flex', gap: 10, flex: 1 }}>
      {[
        { label: 'RI Coverage',   value: cov,  color: cov  >= 60 ? '#22c55e' : cov  >= 30 ? '#f59e0b' : '#ef4444' },
        { label: 'RI Utilization',value: util, color: util >= 80 ? '#22c55e' : util >= 60 ? '#f59e0b' : '#ef4444' },
      ].map((g, i) => (
        <div key={i} style={{ flex: 1, position: 'relative', minHeight: 160 }}>
          <ResponsiveContainer width="100%" height={160}>
            <RadialBarChart cx="50%" cy="55%" innerRadius="65%" outerRadius="95%" barSize={14} data={mkData(g.value, g.color)} startAngle={180} endAngle={0}>
              <RadialBar background={{ fill: 'var(--c-0f172a)' }} dataKey="value" cornerRadius={8} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ color: g.color, fontSize: 22, fontWeight: 700 }}>{g.value.toFixed(0)}%</div>
            <div style={{ color: 'var(--c-64748b)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{g.label}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function TopResources({ rows }) {
  const list = (rows || []).slice(0, 12)
  if (!list.length) return <Empty msg="No per-resource costs yet — try a wider time range" />
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ color: 'var(--c-64748b)', textAlign: 'left' }}>
            <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--c-1e293b)' }}>Resource</th>
            <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--c-1e293b)' }}>Group</th>
            <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--c-1e293b)' }}>Type</th>
            <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--c-1e293b)' }}>Region</th>
            <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--c-1e293b)', textAlign: 'right' }}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={i} style={{ color: 'var(--c-cbd5e1)' }}>
              <td style={{ padding: '5px 6px', borderBottom: '1px solid #1e293b22', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.resource_name || r.name || '—'}</td>
              <td style={{ padding: '5px 6px', borderBottom: '1px solid #1e293b22', color: 'var(--c-94a3b8)' }}>{r.resource_group || '—'}</td>
              <td style={{ padding: '5px 6px', borderBottom: '1px solid #1e293b22', color: 'var(--c-94a3b8)' }}>{(r.resource_type || '').split('/').pop() || '—'}</td>
              <td style={{ padding: '5px 6px', borderBottom: '1px solid #1e293b22', color: 'var(--c-94a3b8)' }}>{r.location || r.region || '—'}</td>
              <td style={{ padding: '5px 6px', borderBottom: '1px solid #1e293b22', textAlign: 'right', color: '#60a5fa', fontWeight: 600 }}>{fmtUsd(r.cost ?? r.cost_usd ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SavingsList({ items }) {
  const list = (items || []).slice(0, 8)
  if (!list.length) return <Empty msg="No savings opportunities detected" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {list.map((o, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6, padding: '6px 10px' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: 'var(--c-e2e8f0)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.resource_name || o.title || o.category || 'Opportunity'}</div>
            <div style={{ color: 'var(--c-64748b)', fontSize: 10 }}>{o.category || o.type || o.action || ''}</div>
          </div>
          <div style={{ color: '#22c55e', fontWeight: 700, fontSize: 12, flexShrink: 0, marginLeft: 8 }}>
            {fmtUsd(o.savings_usd ?? o.monthly_savings ?? o.estimated_monthly_savings ?? 0)}/mo
          </div>
        </div>
      ))}
    </div>
  )
}

function AnomalyList({ s }) {
  const list = (s?.anomalies || s?.cost_anomalies || []).slice(0, 8)
  if (!list.length) return <Empty msg="No cost anomalies detected 🎉" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {list.map((a, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1c0f07', border: '1px solid var(--c-9a3412)', borderRadius: 6, padding: '6px 10px' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: '#fdba74', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.resource_name || a.name || a.title || 'Anomaly'}</div>
            <div style={{ color: 'var(--c-64748b)', fontSize: 10 }}>{a.date || a.detected_date || ''} · spike +{(a.spike_pct ?? 0).toFixed(0)}%</div>
          </div>
          <div style={{ color: '#f97316', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{fmtUsd(a.cost_latest ?? a.cost ?? 0)}</div>
        </div>
      ))}
    </div>
  )
}

function Empty({ msg }) {
  return (
    <div style={{ height: '100%', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-475569)', fontSize: 11, textAlign: 'center', padding: 12 }}>
      {msg}
    </div>
  )
}

// ── Widget renderer ────────────────────────────────────────────────────────
function renderWidget(id, ctx) {
  const { summary, dashData, dashBySub, dashByRG, dashByRegion, forecast, savings, commit, topResources, filters } = ctx
  switch (id) {
    case 'kpi-strip':      return <KPIStrip s={summary} />
    case 'spend-trend':    return <SpendTrend d={dashData} />
    case 'forecast-band':  return <ForecastBand f={forecast} />
    case 'heatmap-cal':    return <HeatmapCal dates={summary?.cost_trend_dates} values={summary?.cost_trend_90d || summary?.cost_trend_30d} />
    case 'svc-bars':       return <BreakdownBars items={dashData?.breakdown} title={filters.group_by} />
    case 'rg-treemap':     return <RGTreemap items={dashByRG?.breakdown} />
    case 'sub-donut':      return <DonutBreakdown items={dashBySub?.breakdown} />
    case 'region-bars':    return <BreakdownBars items={dashByRegion?.breakdown} title="Region" />
    case 'mom-waterfall':  return <MoMMovers s={summary} />
    case 'tag-compliance': return <TagCompliance s={summary} />
    case 'ri-gauges':      return <RIGauges c={commit} />
    case 'top-resources':  return <TopResources rows={topResources?.items || topResources?.resources || topResources || []} />
    case 'savings-list':   return <SavingsList items={savings?.opportunities} />
    case 'anomaly-list':   return <AnomalyList s={summary} />
    default:               return <Empty msg={`Unknown widget: ${id}`} />
  }
}

// ── Main component ─────────────────────────────────────────────────────────
export default function CostStudio() {
  // ── Global filters (persisted) ────────────────────────────────────────
  const [filters, setFilters] = useState(() => {
    try { const s = localStorage.getItem(FILTERS_KEY); if (s) return JSON.parse(s) } catch { /* ignore */ }
    return { subscription_id: '', resource_group: '', region: '', time_range: 'last_30d', group_by: 'ServiceName' }
  })
  useEffect(() => { try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)) } catch { /* ignore */ } }, [filters])

  // ── Filter option lists ───────────────────────────────────────────────
  const [subOpts,    setSubOpts]    = useState([])
  const [rgOpts,     setRgOpts]     = useState([])
  const [regionOpts, setRegionOpts] = useState([])

  useEffect(() => {
    getSubscriptions().then(subs => setSubOpts((subs || []).map(s => ({ value: s.subscription_id, label: s.subscription_name || s.subscription_id })))).catch(() => {})
    getFilterOptions().then(o => {
      setRgOpts((o.resource_groups || []).map(r => (typeof r === 'string' ? { value: r, label: r } : { value: r.value, label: r.label ?? r.value })))
      setRegionOpts((o.regions || []).map(r => (typeof r === 'string' ? { value: r, label: r } : { value: r.value, label: r.label ?? r.value })))
    }).catch(() => {})
  }, [])

  // ── Data buckets ──────────────────────────────────────────────────────
  const [summary,      setSummary]      = useState(null)
  const [dashData,     setDashData]     = useState(null)
  const [dashBySub,    setDashBySub]    = useState(null)
  const [dashByRG,     setDashByRG]     = useState(null)
  const [dashByRegion, setDashByRegion] = useState(null)
  const [forecast,     setForecast]     = useState(null)
  const [savings,      setSavings]      = useState(null)
  const [commit,       setCommit]       = useState(null)
  const [topResources, setTopResources] = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,      setError]      = useState(null)

  const fetchAll = useCallback(async () => {
    setRefreshing(true); setError(null)
    const p = {
      subscription_id: filters.subscription_id || undefined,
      resource_group:  filters.resource_group  || undefined,
      time_range:      filters.time_range      || 'last_30d',
    }
    try {
      const results = await Promise.allSettled([
        finopsApi.getSummary(),
        finopsApi.getDashboardData({ ...p, group_by: filters.group_by || 'ServiceName' }),
        finopsApi.getDashboardData({ ...p, group_by: 'SubscriptionId' }),
        finopsApi.getDashboardData({ ...p, group_by: 'ResourceGroupName' }),
        finopsApi.getDashboardData({ ...p, group_by: 'ResourceLocation' }),
        finopsApi.getForecast(90),
        finopsApi.getSavings(),
        finopsApi.getCommitments(),
        finopsApi.getCostResources({ ...p, limit: 15 }),
      ])
      const [s, dbGrp, dbSub, dbRG, dbReg, f, sv, cm, tr] = results
      if (s.status === 'fulfilled')     setSummary(s.value)
      if (dbGrp.status === 'fulfilled') setDashData(dbGrp.value)
      if (dbSub.status === 'fulfilled') setDashBySub(dbSub.value)
      if (dbRG.status === 'fulfilled')  setDashByRG(dbRG.value)
      if (dbReg.status === 'fulfilled') setDashByRegion(dbReg.value)
      if (f.status === 'fulfilled')     setForecast(f.value)
      if (sv.status === 'fulfilled')    setSavings(sv.value)
      if (cm.status === 'fulfilled')    setCommit(cm.value)
      if (tr.status === 'fulfilled')    setTopResources(tr.value)
      // Metrics Service = single source of truth. Overlay its canonical values onto
      // the summary object so every Cost Studio widget shows the same numbers as
      // the Overview cards (one forecast, one untagged count, one savings figure).
      finopsApi.getMetrics().then(m => {
        if (!m) return
        setSummary(prev => ({
          ...(prev || {}),
          total_spend_mtd:        m.spend?.mtd ?? prev?.total_spend_mtd,
          total_spend_last_month: m.spend?.priorMonthFull ?? prev?.total_spend_last_month,
          mom_delta_pct:          m.spend?.momDeltaPct ?? prev?.mom_delta_pct,
          forecast_eom_usd:       m.forecast?.eom ?? prev?.forecast_eom_usd,
          savings_identified_usd: m.savings?.monthlyRunRate ?? prev?.savings_identified_usd,
          tagging_compliance_pct: m.resources?.tagCompliancePct ?? prev?.tagging_compliance_pct,
          total_untagged:         m.resources?.untagged ?? prev?.total_untagged,
          ri_coverage_pct:        m.reservations?.coveragePct ?? prev?.ri_coverage_pct,
          anomaly_count:          m.anomalies?.openCount ?? prev?.anomaly_count,
          budgets_exceeded:       m.budgets?.breaching?.length ?? prev?.budgets_exceeded,
        }))
      }).catch(() => {})
    } catch (e) { setError(e.message) }
    finally { setRefreshing(false); setLoading(false) }
  }, [filters])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Layout state ──────────────────────────────────────────────────────
  const [layouts,    setLayouts]    = useState(allLayouts)
  const [activeName, setActiveName] = useState(() => {
    try { const s = localStorage.getItem(ACTIVE_KEY); if (s) return s } catch { /* ignore */ }
    return 'Executive (CFO)'
  })
  useEffect(() => { try { localStorage.setItem(ACTIVE_KEY, activeName) } catch { /* ignore */ } }, [activeName])
  const activeWidgets = layouts[activeName] || DEFAULT_LAYOUTS['Executive (CFO)']

  const [designOpen,  setDesignOpen]  = useState(false)
  const [layoutDraft, setLayoutDraft] = useState(null)

  const openDesign = () => {
    setLayoutDraft({ name: activeName in DEFAULT_LAYOUTS ? '' : activeName, widgets: [...activeWidgets] })
    setDesignOpen(true)
  }
  const toggleWidgetInDraft = (id) => setLayoutDraft(d => (d ? { ...d, widgets: d.widgets.includes(id) ? d.widgets.filter(w => w !== id) : [...d.widgets, id] } : d))
  const saveDraft = () => {
    if (!layoutDraft) return
    const name = (layoutDraft.name || '').trim() || `My Layout ${Object.keys(layouts).length + 1}`
    if (name in DEFAULT_LAYOUTS) { alert('Pick a different name — that matches a built-in layout.'); return }
    const next = { ...layouts, [name]: [...layoutDraft.widgets] }
    setLayouts(next); saveUserLayouts(next); setActiveName(name); setDesignOpen(false); setLayoutDraft(null)
  }
  const deleteLayout = (name) => {
    if (name in DEFAULT_LAYOUTS) return
    const next = { ...layouts }; delete next[name]
    setLayouts(next); saveUserLayouts(next)
    if (activeName === name) setActiveName('Executive (CFO)')
  }

  const hideWidget = (id) => {
    // Hiding a widget from a built-in layout forks it as a user copy.
    let name = activeName
    if (name in DEFAULT_LAYOUTS) name = `${activeName} (custom)`
    const next = { ...layouts, [name]: activeWidgets.filter(x => x !== id) }
    setLayouts(next); saveUserLayouts(next); setActiveName(name)
  }

  const anyFilter = filters.subscription_id || filters.resource_group || filters.region || filters.time_range !== 'last_30d' || filters.group_by !== 'ServiceName'

  const aiData = useMemo(() => ({
    layout: activeName,
    widgets: activeWidgets,
    filters,
    summary: summary ? {
      mtd: summary.total_spend_mtd, last_month: summary.total_spend_last_month,
      forecast: summary.forecast_eom_usd, mom_pct: summary.mom_delta_pct,
      savings: summary.savings_identified_usd, tag_compliance: summary.tagging_compliance_pct,
      ri_coverage: summary.ri_coverage_pct, anomalies: summary.anomaly_count,
    } : {},
    top_services: (dashData?.breakdown || []).slice(0, 5).map(x => ({ name: x.name, cost: x.cost })),
    top_subscriptions: (dashBySub?.breakdown || []).slice(0, 5).map(x => ({ name: x.name, cost: x.cost })),
    top_resource_groups: (dashByRG?.breakdown || []).slice(0, 5).map(x => ({ name: x.name, cost: x.cost })),
  }), [activeName, activeWidgets, filters, summary, dashData, dashBySub, dashByRG])

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 280, gap: 10 }}>
        <RefreshCw size={16} className="animate-spin" style={{ color: '#3b82f6' }} />
        <span style={{ color: 'var(--c-94a3b8)', fontSize: 13 }}>Loading Cost Studio…</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <LayoutDashboard size={18} style={{ color: '#818cf8' }} /> Cost Studio
          </h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '2px 0 0 0' }}>
            Design your own FinOps dashboard · <b style={{ color: 'var(--c-cbd5e1)' }}>{activeName}</b> · {activeWidgets.length} widgets · saved locally
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 240 }}>
            <SearchableSelect
              label="Layout"
              value={activeName}
              onChange={(v) => setActiveName(v || 'Executive (CFO)')}
              options={Object.keys(layouts).map(n => ({ value: n, label: (n in DEFAULT_LAYOUTS ? '📐 ' : '★ ') + n }))}
              placeholder="Select layout"
              compact
            />
          </div>
          <button onClick={openDesign} style={{ ...btnPrimary, marginBottom: 1 }}>
            <Palette size={12} /> Design dashboard
          </button>
          <button onClick={fetchAll} disabled={refreshing} style={{ ...btnGhost, marginBottom: 1 }}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <FinOpsExportMenu view="studio" focusDays={30} report={{
            title: `Cost Studio — ${activeName}`,
            kpis: [
              { label: 'MTD Spend',       value: fmtUsd(summary?.total_spend_mtd) },
              { label: 'Forecast EOM',    value: fmtUsd(summary?.forecast_eom_usd) },
              { label: 'Savings',         value: `${fmtUsd(summary?.savings_identified_usd)}/mo` },
              { label: 'Tag compliance',  value: `${(summary?.tagging_compliance_pct ?? 0).toFixed(0)}%` },
              { label: 'RI coverage',     value: `${(commit?.coverage_pct ?? 0).toFixed(0)}%` },
              { label: 'Anomalies',       value: String(summary?.anomaly_count ?? 0) },
            ],
            tables: [
              { title: 'Top services',      columns: ['Service', 'Cost'],       rows: (dashData?.breakdown || []).slice(0, 10).map(x => [x.name, fmtUsd(x.cost)]) },
              { title: 'Top subscriptions', columns: ['Subscription', 'Cost'],  rows: (dashBySub?.breakdown || []).slice(0, 10).map(x => [x.name, fmtUsd(x.cost)]) },
              { title: 'Top resource groups', columns: ['Resource Group', 'Cost'], rows: (dashByRG?.breakdown || []).slice(0, 10).map(x => [x.name, fmtUsd(x.cost)]) },
            ],
          }} />
        </div>
      </div>

      {/* Global filter bar — cascades to every widget */}
      <div style={{ ...filterBar, border: `1px solid ${anyFilter ? '#1d4ed8' : 'var(--c-1e293b)'}` }}>
        <Filter size={14} style={{ color: anyFilter ? '#60a5fa' : 'var(--c-64748b)', marginBottom: 6 }} />
        <div style={{ minWidth: 200 }}>
          <SearchableSelect label="Subscription" value={filters.subscription_id} onChange={v => setFilters(f => ({ ...f, subscription_id: v || '' }))} options={subOpts} placeholder="All subscriptions" compact />
        </div>
        <div style={{ minWidth: 180 }}>
          <SearchableSelect label="Resource Group" value={filters.resource_group} onChange={v => setFilters(f => ({ ...f, resource_group: v || '' }))} options={rgOpts} placeholder="All resource groups" compact />
        </div>
        <div style={{ minWidth: 150 }}>
          <SearchableSelect label="Region" value={filters.region} onChange={v => setFilters(f => ({ ...f, region: v || '' }))} options={regionOpts} placeholder="All regions" compact />
        </div>
        <div style={{ minWidth: 140 }}>
          <SearchableSelect label="Time range" value={filters.time_range} onChange={v => setFilters(f => ({ ...f, time_range: v || 'last_30d' }))} options={TIME_RANGE_OPTIONS.filter(o => o.value !== 'custom')} compact />
        </div>
        <div style={{ minWidth: 150 }}>
          <SearchableSelect label="Group by" value={filters.group_by} onChange={v => setFilters(f => ({ ...f, group_by: v || 'ServiceName' }))} options={[
            { value: 'ServiceName',       label: 'Service' },
            { value: 'ResourceGroupName', label: 'Resource Group' },
            { value: 'SubscriptionId',    label: 'Subscription' },
            { value: 'ResourceLocation',  label: 'Region' },
            { value: 'ResourceType',      label: 'Resource Type' },
            { value: 'MeterCategory',     label: 'Meter Category' },
          ]} compact />
        </div>
        {anyFilter && (
          <button onClick={() => setFilters({ subscription_id: '', resource_group: '', region: '', time_range: 'last_30d', group_by: 'ServiceName' })} style={{ ...btnGhost, marginBottom: 1 }}>
            <X size={11} /> Clear
          </button>
        )}
      </div>

      {/* AI narrative on top of the whole dashboard */}
      <FinOpsAIPanel view="studio" title="AI dashboard narrative" data={aiData} />

      {/* Widget grid — 4 columns, widgets take 2 (half) or 4 (full) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {activeWidgets.map(id => {
          const w = WIDGET_CATALOG.find(x => x.id === id); if (!w) return null
          const span = w.colspan === 2 ? 4 : 2
          const minH = id === 'kpi-strip' ? 110 : 280
          return (
            <div key={id} style={{ ...cardStyle, gridColumn: `span ${span}`, minHeight: minH }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ color: 'var(--c-e2e8f0)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{w.name}</div>
                <button title="Hide this widget (forks built-in layouts)" onClick={() => hideWidget(id)} style={iconBtn}><X size={11} /></button>
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                <div style={{ flex: 1, minWidth: 0 }}>{renderWidget(id, { summary, dashData, dashBySub, dashByRG, dashByRegion, forecast, savings, commit, topResources, filters })}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Design panel */}
      {designOpen && layoutDraft && (
        <div style={{ background: 'var(--c-0f172a)', border: '1px solid #4338ca', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, color: 'var(--c-e2e8f0)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Settings2 size={14} style={{ color: '#818cf8' }} /> Design your dashboard
              </h3>
              <p style={{ margin: '2px 0 0 0', color: 'var(--c-64748b)', fontSize: 11 }}>Pick the widgets you want, name your layout, save it — reopen it anytime.</p>
            </div>
            <button onClick={() => { setDesignOpen(false); setLayoutDraft(null) }} style={iconBtn}><X size={12} /></button>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14, maxWidth: 400 }}>
            <span style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Layout name</span>
            <input value={layoutDraft.name} onChange={e => setLayoutDraft(d => ({ ...d, name: e.target.value }))} placeholder={activeName in DEFAULT_LAYOUTS ? 'e.g. My CFO View' : activeName} style={inputStyle} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 8, marginBottom: 14 }}>
            {WIDGET_CATALOG.map(w => {
              const on = layoutDraft.widgets.includes(w.id)
              return (
                <button key={w.id} onClick={() => toggleWidgetInDraft(w.id)} style={{
                  textAlign: 'left', display: 'flex', gap: 8, alignItems: 'flex-start',
                  background: on ? 'var(--c-14321f)' : 'var(--c-0b1220)',
                  border: `1px solid ${on ? '#166534' : 'var(--c-1e293b)'}`,
                  borderRadius: 8, padding: '8px 10px', cursor: 'pointer', color: 'var(--c-e2e8f0)', fontSize: 12,
                }}>
                  <input type="checkbox" checked={on} readOnly style={{ marginTop: 2, accentColor: '#22c55e' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{w.name}</div>
                    <div style={{ color: 'var(--c-64748b)', fontSize: 11 }}>{w.desc}</div>
                  </div>
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.keys(layouts).filter(n => !(n in DEFAULT_LAYOUTS)).map(n => (
                <button key={n} onClick={() => deleteLayout(n)} style={{ ...btnGhost, color: '#f87171', borderColor: '#7f1d1d' }}>
                  <Trash2 size={11} /> Delete "{n}"
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setDesignOpen(false); setLayoutDraft(null) }} style={btnGhost}>Cancel</button>
              <button onClick={saveDraft} disabled={layoutDraft.widgets.length === 0} style={{ ...btnPrimary, opacity: layoutDraft.widgets.length === 0 ? 0.5 : 1, cursor: layoutDraft.widgets.length === 0 ? 'not-allowed' : 'pointer' }}>
                <Save size={12} /> Save layout
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div style={errorBox}><AlertTriangle size={14} /> {error}</div>}
    </div>
  )
}
