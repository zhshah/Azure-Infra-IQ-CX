/**
 * Analyze — warehouse-backed Cost Analysis (Azure Cost Management parity, and more).
 *
 * Scope: multi-select subscription dropdown + click-through drill-down
 *   (All → subscription → resource group → resources).
 * Period: presets + custom from/to (calendar). Group-by: subscription / resource group
 *   / service / service family / meter / location. Cost type: actual / amortized (with
 *   an inline explanation). Chart modes: Accumulated / Daily / Visualize (each described).
 * Served from the Azure SQL warehouse (no Cost Management throttling at view time);
 * the resource-level drill reads per-resource run-rate cost from the dashboard cache.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  BarChart3, TrendingUp, PieChart as PieIcon, RefreshCw, AlertCircle, Filter,
  Calendar, Layers, Database, ChevronRight, ChevronDown, Info, Home, ExternalLink,
} from 'lucide-react'
import { finopsApi, fmtUsd, getSubscriptions } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'

const card      = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const miniLabel = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }
const inputStyle = { background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 10px', color: 'var(--c-e2e8f0)', fontSize: 12, colorScheme: 'dark' }
const seg = (on) => ({ borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: on ? '#0078d4' : 'var(--c-0b1220)', border: `1px solid ${on ? '#0078d4' : 'var(--c-334155)'}`, color: on ? '#fff' : 'var(--c-94a3b8)' })

const PERIODS = [
  { id: 'today', label: 'Today' }, { id: 'last_7d', label: '7 days' }, { id: 'last_week', label: 'Last week' },
  { id: 'last_30d', label: '30 days' }, { id: 'this_month', label: 'This month' }, { id: 'last_month', label: 'Last month' },
  { id: 'last_3m', label: 'Last 3 months' }, { id: 'custom', label: 'Custom' },
]
const CHART_MODES = [
  { id: 'accumulated', label: 'Accumulated', icon: TrendingUp, desc: 'Running cumulative total across the period — how spend builds up day by day.' },
  { id: 'daily', label: 'Daily', icon: BarChart3, desc: 'Cost per day, stacked by the selected group — spot spikes and daily patterns.' },
  { id: 'visualize', label: 'Visualize', icon: PieIcon, desc: 'Share of total by the selected group — where the money goes as a proportion.' },
]
const COST_TYPE_HELP = 'Actual = the cost billed on each day (upfront reservation/savings-plan purchases land on their purchase day). Amortized = those upfront commitment costs are spread evenly across the term, giving a smoother, truer daily run-rate for chargeback and unit economics.'
const COLORS = ['#0078d4', '#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#a855f7', '#3b82f6', '#eab308', '#64748b', '#94a3b8']
const fmtDate = d => (typeof d === 'string' ? d.slice(5) : d)

/* ── Multi-select dropdown for subscriptions ── */
function SubDropdown({ subs, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  const label = selected.length === 0 ? 'All subscriptions' : (selected.length === 1 ? (subs.find(s => s.id === selected[0])?.name || '1 selected') : `${selected.length} subscriptions`)
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 260 }}>
      <button onClick={() => setOpen(o => !o)} style={{ ...inputStyle, width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--c-64748b)' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: 280, overflowY: 'auto', padding: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--c-cbd5e1)', borderBottom: '1px solid var(--c-1e293b)' }}>
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} /> All subscriptions
          </label>
          {subs.map(s => (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--c-cbd5e1)' }}>
              <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} /> {s.name}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AnalyzeHub() {
  const [subs, setSubs]       = useState([])
  const [selSubs, setSelSubs] = useState([])          // [] = all
  const [groupBy, setGroupBy] = useState('service_name')
  const [period, setPeriod]   = useState('last_30d')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]   = useState('')
  const [costType, setCostType] = useState('actual')
  const [chartMode, setChartMode] = useState('accumulated')
  const [compare, setCompare] = useState(false)      // compare vs another period
  const [cmpMode, setCmpMode] = useState('auto')      // 'auto' (previous period) | 'custom'
  const [cmpFrom, setCmpFrom] = useState('')
  const [cmpTo, setCmpTo]     = useState('')
  const [dims, setDims]       = useState([])
  const [coverage, setCoverage] = useState(null)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  // Drill: {level:'root'|'subscription'|'resource_group', sub, subName, rg}
  const [drill, setDrill]     = useState({ level: 'root' })
  const [resRows, setResRows] = useState(null)        // resource-level rows (leaf)
  const [resLoading, setResLoading] = useState(false)

  useEffect(() => {
    getSubscriptions().then(s => setSubs((s || []).map(x => ({ id: x.subscription_id, name: x.subscription_name || x.subscription_id })))).catch(() => {})
    finopsApi.getAnalyzeMeta().then(m => { setDims(m.dimensions || []); setCoverage(m.coverage || null) }).catch(() => {})
  }, [])

  // Effective subscription filter = explicit selection, narrowed by drill.
  const effSubs = useMemo(() => (drill.level !== 'root' && drill.sub ? [drill.sub] : selSubs), [drill, selSubs])

  const run = useCallback(async () => {
    if (period === 'custom' && (!dateFrom || !dateTo)) return
    if (drill.level === 'resource_group') return   // leaf handled separately
    setLoading(true); setError(null)
    try {
      const model = { subscription_ids: effSubs.length ? effSubs : null, group_by: groupBy, cost_type: costType, top: 14 }
      if (period === 'custom') { model.date_from = dateFrom; model.date_to = dateTo }
      else model.period = period
      if (compare) {
        model.compare = true
        if (cmpMode === 'custom' && cmpFrom && cmpTo) { model.compare_from = cmpFrom; model.compare_to = cmpTo }
      }
      setData(await finopsApi.analyze(model))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [effSubs, groupBy, period, dateFrom, dateTo, costType, drill.level, compare, cmpMode, cmpFrom, cmpTo])

  useEffect(() => { run() }, [run])

  // Resource-level leaf (drilled into an RG): per-resource cost from dashboard cache.
  useEffect(() => {
    if (drill.level !== 'resource_group') { setResRows(null); return }
    let cancelled = false
    setResLoading(true)
    finopsApi.getCostResources({ subscription_id: drill.sub, resource_group: drill.rg, limit: 200 })
      .then(r => { if (!cancelled) setResRows(r?.resources || []) })
      .catch(() => { if (!cancelled) setResRows([]) })
      .finally(() => { if (!cancelled) setResLoading(false) })
    return () => { cancelled = true }
  }, [drill])

  const keys = data?.series_keys || []
  const breakdown = useMemo(() => (data?.breakdown || []).map((b, i) => ({ ...b, fill: COLORS[i % COLORS.length] })), [data])
  const dimLabel = (v) => (dims.find(d => d.value === v) || {}).label || v

  const rowDrill = (key) => {
    if (drill.level === 'root' && groupBy === 'subscription') {
      setDrill({ level: 'subscription', sub: key, subName: subs.find(s => s.id === key)?.name || key })
      setGroupBy('resource_group')
    } else if (drill.level === 'subscription' && groupBy === 'resource_group') {
      setDrill({ level: 'resource_group', sub: drill.sub, subName: drill.subName, rg: key })
    }
  }
  const canDrill = (drill.level === 'root' && groupBy === 'subscription') || (drill.level === 'subscription' && groupBy === 'resource_group')

  const goRoot = () => { setDrill({ level: 'root' }); setGroupBy('service_name') }
  const goSub = () => { setDrill({ level: 'subscription', sub: drill.sub, subName: drill.subName }); setGroupBy('resource_group') }

  // Human-readable scope for exports + report headers.
  const scopeText = drill.level === 'resource_group'
    ? `${drill.subName} / ${drill.rg}`
    : drill.level === 'subscription'
      ? drill.subName
      : (selSubs.length ? `${selSubs.length} subscription(s)` : 'All subscriptions')

  // Resource rows for the leaf view, sorted by current-month cost (for export).
  const sortedResRows = useMemo(() => (resRows || []).slice().sort(
    (a, b) => (b.cost_current_month || b.cost_previous_month || 0) - (a.cost_current_month || a.cost_previous_month || 0)
  ), [resRows])

  // Whether an export is available in the current context.
  const canExport = (data?.breakdown?.length > 0) || (drill.level === 'resource_group' && sortedResRows.length > 0)

  // Build the Excel payload reflecting exactly what's on screen (incl. comparison
  // columns and, when drilled into an RG, the per-resource detail).
  const buildXlsxPayload = () => {
    const cmp = !!data?.compare_from
    const denom = data?.period_total_usd || data?.total_cost || 0
    const summaryRows = [
      ['Scope', scopeText],
      ['Group by', dimLabel(groupBy)],
      ['Cost type', data?.cost_type || costType],
      ['Period', `${data?.date_from} to ${data?.date_to}`],
      ['Total cost (USD)', data?.period_total_usd ?? data?.total_cost ?? 0],
    ]
    if (cmp) {
      summaryRows.push(
        ['Comparison period', `${data.compare_from} to ${data.compare_to}`],
        ['Comparison total (USD)', data.compare_total_usd],
        ['Change (USD)', data.total_delta_usd],
        ['Change %', data.total_delta_pct != null ? data.total_delta_pct : 'N/A'],
      )
    }
    const bdCols = cmp
      ? [dimLabel(groupBy), 'Cost (USD)', 'Previous (USD)', 'Change (USD)', 'Change %', 'Share %']
      : [dimLabel(groupBy), 'Cost (USD)', 'Share %']
    const bdRows = (data?.breakdown || []).map(b => {
      const share = denom > 0 ? Math.round(b.cost / denom * 100) : 0
      return cmp
        ? [b.key, b.cost, b.prev_cost ?? 0, b.delta_usd ?? 0, b.delta_pct != null ? b.delta_pct : 'N/A', share]
        : [b.key, b.cost, share]
    })
    const sheets = [
      { name: 'Summary', columns: ['Metric', 'Value'], rows: summaryRows },
      { name: 'Breakdown', columns: bdCols, rows: bdRows },
      { name: 'Daily', columns: ['Date', 'Cost (USD)', 'Accumulated (USD)'], rows: (data?.series || []).map(s => [s.date, s.cost, s.accumulated]) },
    ]
    if (drill.level === 'resource_group' && sortedResRows.length) {
      sheets.push({
        name: 'Resources',
        columns: ['Resource', 'Type', 'Location', 'This month (USD)', 'Last month (USD)', 'Change (USD)'],
        rows: sortedResRows.map(r => {
          const cur = r.cost_current_month || 0, prev = r.cost_previous_month || 0
          return [r.resource_name, (r.resource_type || '').split('/').pop(), r.location, cur, prev, Math.round((cur - prev) * 100) / 100]
        }),
      })
    }
    return { title: `Cost Analysis - ${scopeText}`, sheets }
  }

  const doExportXlsx = () => finopsApi.exportGenericXlsx(buildXlsxPayload())

  // Build the PDF report (kpis + on-screen table incl. comparison, and resources when drilled).
  const buildReport = () => {
    const cmp = !!data?.compare_from
    const denom = data?.period_total_usd || data?.total_cost || 0
    const kpis = [
      { label: 'Total cost', value: fmtUsd(data?.period_total_usd ?? data?.total_cost) },
      { label: 'Scope', value: scopeText },
      { label: 'Period', value: `${data?.date_from} → ${data?.date_to}` },
      { label: 'Cost type', value: data?.cost_type || costType },
    ]
    if (cmp) {
      kpis.push({ label: `vs ${data.compare_from} → ${data.compare_to}`, value: `${fmtUsd(data.compare_total_usd)} (${data.total_delta_pct != null ? (data.total_delta_pct > 0 ? '+' : '') + data.total_delta_pct + '%' : 'n/a'})` })
    }
    const tables = [{
      title: `Cost by ${dimLabel(groupBy)}`,
      columns: cmp ? [dimLabel(groupBy), 'Cost', 'Previous', 'Change', 'Share'] : [dimLabel(groupBy), 'Cost', 'Share'],
      rows: (data?.breakdown || []).map(b => {
        const share = denom > 0 ? `${Math.round(b.cost / denom * 100)}%` : '—'
        return cmp
          ? [b.key, fmtUsd(b.cost), fmtUsd(b.prev_cost), `${(b.delta_usd ?? 0) >= 0 ? '+' : ''}${fmtUsd(b.delta_usd)}${b.delta_pct != null ? ` (${b.delta_pct > 0 ? '+' : ''}${b.delta_pct}%)` : ''}`, share]
          : [b.key, fmtUsd(b.cost), share]
      }),
    }]
    if (drill.level === 'resource_group' && sortedResRows.length) {
      tables.push({
        title: `Resources in ${drill.rg}`,
        columns: ['Resource', 'Type', 'This month', 'Last month'],
        rows: sortedResRows.map(r => [r.resource_name, (r.resource_type || '').split('/').pop(), fmtUsd(r.cost_current_month || 0), fmtUsd(r.cost_previous_month || 0)]),
      })
    }
    return { title: `Cost Analysis — ${scopeText}`, kpis, tables }
  }

  const activeMode = CHART_MODES.find(m => m.id === chartMode) || CHART_MODES[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
            <BarChart3 size={20} style={{ color: '#0078d4' }} /> Analyze
          </h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '4px 0 0' }}>
            Break down costs by scope, period and dimension — drill from subscription to resource group to resource. Served from your cost warehouse, so it is fast and never throttled.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {coverage?.date_to && (
            <span style={{ fontSize: 10, color: 'var(--c-64748b)', border: '1px solid var(--c-1e293b)', borderRadius: 4, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Database size={11} /> data through {coverage.date_to}
            </span>
          )}
          {canExport && (
            <FinOpsExportMenu view="cost-analysis" onXlsx={doExportXlsx} report={buildReport()} />
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={miniLabel}><Filter size={11} style={{ verticalAlign: 'middle' }} /> Scope — subscriptions</div>
            <SubDropdown subs={subs} selected={selSubs} onChange={(v) => { setSelSubs(v); setDrill({ level: 'root' }) }} />
          </div>
          <div>
            <div style={miniLabel}><Calendar size={11} style={{ verticalAlign: 'middle' }} /> Period</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PERIODS.map(p => <button key={p.id} onClick={() => setPeriod(p.id)} style={seg(period === p.id)}>{p.label}</button>)}
            </div>
          </div>
          {period === 'custom' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div><div style={miniLabel}>From</div><input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} style={inputStyle} /></div>
              <div><div style={miniLabel}>To</div><input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} style={inputStyle} /></div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={miniLabel}><Layers size={11} style={{ verticalAlign: 'middle' }} /> Group by</div>
            <select value={groupBy} onChange={e => setGroupBy(e.target.value)} style={{ ...inputStyle, minWidth: 150 }}>
              {(dims.length ? dims : [{ value: 'service_name', label: 'Service' }]).map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ ...miniLabel, display: 'flex', alignItems: 'center', gap: 5 }}>Cost type <span title={COST_TYPE_HELP} style={{ cursor: 'help', display: 'inline-flex' }}><Info size={11} /></span></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setCostType('actual')} style={seg(costType === 'actual')}>Actual</button>
              <button onClick={() => setCostType('amortized')} style={seg(costType === 'amortized')}>Amortized</button>
            </div>
          </div>
          <div>
            <div style={miniLabel}>Compare</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={() => setCompare(c => !c)} style={seg(compare)}>{compare ? 'On' : 'Off'}</button>
              {compare && (
                <>
                  <button onClick={() => setCmpMode('auto')} style={seg(cmpMode === 'auto')}>Previous period</button>
                  <button onClick={() => setCmpMode('custom')} style={seg(cmpMode === 'custom')}>Custom</button>
                  {cmpMode === 'custom' && (
                    <>
                      <input type="date" value={cmpFrom} max={cmpTo || undefined} onChange={e => setCmpFrom(e.target.value)} style={inputStyle} />
                      <input type="date" value={cmpTo} min={cmpFrom || undefined} onChange={e => setCmpTo(e.target.value)} style={inputStyle} />
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <button onClick={run} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 12, marginLeft: 'auto' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--c-475569)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <Info size={12} style={{ marginTop: 1, flexShrink: 0 }} /> <span><strong style={{ color: 'var(--c-94a3b8)' }}>{costType === 'amortized' ? 'Amortized' : 'Actual'} cost</strong> — {COST_TYPE_HELP}</span>
        </div>
      </div>

      {/* Drill breadcrumb */}
      {drill.level !== 'root' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-94a3b8)' }}>
          <button onClick={goRoot} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 12 }}><Home size={12} /> All</button>
          <ChevronRight size={12} />
          <button onClick={goSub} style={{ background: 'none', border: 'none', color: drill.level === 'resource_group' ? '#60a5fa' : 'var(--c-e2e8f0)', cursor: 'pointer', fontSize: 12 }}>{drill.subName}</button>
          {drill.level === 'resource_group' && (<><ChevronRight size={12} /><span style={{ color: 'var(--c-e2e8f0)' }}>{drill.rg}</span></>)}
        </div>
      )}

      {error && (
        <div style={{ ...card, borderColor: 'var(--c-7f1d1d)', color: 'var(--c-fca5a5)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ fontSize: 12 }}>{error}</span>
        </div>
      )}

      {/* Resource-level leaf view */}
      {drill.level === 'resource_group' ? (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-1e293b)', color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700 }}>
            Resources in {drill.rg} <span style={{ color: 'var(--c-64748b)', fontWeight: 400 }}>· per-resource run-rate — this month vs last month</span>
          </div>
          {resLoading ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-64748b)' }}><RefreshCw size={16} className="animate-spin" /> Loading resources…</div>
          ) : (sortedResRows && sortedResRows.length) ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: 'var(--c-0b1220)', color: 'var(--c-64748b)', textAlign: 'left' }}>
                {['Resource', 'Type', 'Location', 'This month', 'Last month', 'Change', ''].map((h, i) => <th key={i} style={{ padding: '9px 14px', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {sortedResRows.map((r, i) => {
                  const cur = r.cost_current_month || 0, prev = r.cost_previous_month || 0
                  const delta = cur - prev, up = delta >= 0
                  return (
                  <tr key={i} style={{ borderTop: '1px solid var(--c-1e293b)' }}>
                    <td style={{ padding: '8px 14px', color: 'var(--c-e2e8f0)' }}>{r.resource_name}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--c-64748b)' }}>{(r.resource_type || '').split('/').pop()}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--c-64748b)' }}>{r.location}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--c-f1f5f9)', fontWeight: 600 }}>{fmtUsd(cur)}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--c-94a3b8)' }}>{fmtUsd(prev)}</td>
                    <td style={{ padding: '8px 14px', color: prev > 0 ? (up ? '#ef4444' : '#22c55e') : 'var(--c-64748b)', fontWeight: 600 }}>{prev > 0 ? `${up ? '▲' : '▼'} ${fmtUsd(Math.abs(delta))}` : '—'}</td>
                    <td style={{ padding: '8px 14px' }}>{r.portal_url && <a href={r.portal_url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', display: 'inline-flex' }}><ExternalLink size={13} /></a>}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-64748b)', fontSize: 12 }}>No per-resource cost available for this resource group yet.</div>
          )}
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 160 }}>
              <div style={miniLabel}>Total cost</div>
              <div style={{ color: 'var(--c-f1f5f9)', fontSize: 22, fontWeight: 700 }}>{fmtUsd(data?.period_total_usd ?? data?.total_cost)}</div>
              <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>{data?.date_from} → {data?.date_to} · {data?.cost_type}</div>
              {data && data.compare_from && (
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  <span style={{ color: (data.total_delta_usd ?? 0) > 0 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>
                    {(data.total_delta_usd ?? 0) >= 0 ? '▲' : '▼'} {fmtUsd(Math.abs(data.total_delta_usd || 0))}
                    {data.total_delta_pct != null ? ` (${data.total_delta_pct > 0 ? '+' : ''}${data.total_delta_pct}%)` : ''}
                  </span>
                  <span style={{ color: 'var(--c-64748b)' }}> vs {fmtUsd(data.compare_total_usd)}</span>
                  <div style={{ color: 'var(--c-475569)', fontSize: 10 }}>prior: {data.compare_from} → {data.compare_to}</div>
                </div>
              )}
              {data && data.breakdown_coverage_pct != null && data.breakdown_coverage_pct < 99 && (
                <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 3 }}>Breakdown covers {data.breakdown_coverage_pct}% of total (this dimension is still syncing)</div>
              )}
            </div>
            <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 160 }}>
              <div style={miniLabel}>Groups</div>
              <div style={{ color: 'var(--c-f1f5f9)', fontSize: 22, fontWeight: 700 }}>{(data?.breakdown || []).length}</div>
              <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>by {dimLabel(groupBy)}{canDrill ? ' · click a row to drill in' : ''}</div>
            </div>
            <div style={{ ...card, padding: '12px 16px', flex: 2, minWidth: 260 }}>
              <div style={miniLabel}>View</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                {CHART_MODES.map(m => { const I = m.icon; return <button key={m.id} onClick={() => setChartMode(m.id)} style={{ ...seg(chartMode === m.id), display: 'inline-flex', alignItems: 'center', gap: 5 }}><I size={13} /> {m.label}</button> })}
              </div>
              <div style={{ fontSize: 10, color: 'var(--c-64748b)', marginTop: 5 }}>{activeMode.desc}</div>
            </div>
          </div>

          {/* Chart */}
          <div style={card}>
            {loading && !data ? (
              <div style={{ padding: 50, textAlign: 'center', color: 'var(--c-64748b)' }}><RefreshCw size={16} className="animate-spin" /> Loading…</div>
            ) : !data || ((data.total_cost || 0) === 0 && (data.period_total_usd || 0) === 0) ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-64748b)', fontSize: 12 }}>
                No cost for this scope/period{period === 'today' ? ' — "Today" is usually near-zero until the day\u2019s usage is metered by Azure (cost lands a day or two later). Try 7 days or 30 days.' : '.'}
                {coverage?.date_from && <div style={{ marginTop: 6, color: 'var(--c-475569)' }}>Warehouse coverage: {coverage.date_from} → {coverage.date_to}</div>}
              </div>
            ) : chartMode === 'accumulated' ? (
              <ResponsiveContainer width="100%" height={360}>
                <AreaChart data={data.series} margin={{ top: 14, right: 20, left: 6, bottom: 6 }}>
                  <defs><linearGradient id="acc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0078d4" stopOpacity={0.5} /><stop offset="100%" stopColor="#0078d4" stopOpacity={0.05} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--c-1e293b)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'var(--c-64748b)' }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--c-64748b)' }} tickFormatter={v => fmtUsd(v)} />
                  <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }} formatter={v => [fmtUsd(v), 'Accumulated']} />
                  <Area type="monotone" dataKey="accumulated" stroke="#0078d4" strokeWidth={2} fill="url(#acc)" dot={(data.series || []).length <= 3 ? { r: 3, fill: '#0078d4' } : false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : chartMode === 'daily' ? (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={data.stacked} margin={{ top: 14, right: 20, left: 6, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--c-1e293b)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'var(--c-64748b)' }} minTickGap={20} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--c-64748b)' }} tickFormatter={v => fmtUsd(v)} />
                  <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }} formatter={v => fmtUsd(v)} />
                  {keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={COLORS[i % COLORS.length]} />)}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <ResponsiveContainer width="100%" height={340}>
                  <PieChart>
                    <Pie data={breakdown} dataKey="cost" nameKey="key" cx="50%" cy="50%" innerRadius={70} outerRadius={120} paddingAngle={1}>
                      {breakdown.map((b, i) => <Cell key={i} fill={b.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }} formatter={v => fmtUsd(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={breakdown} layout="vertical" margin={{ top: 6, right: 20, left: 10, bottom: 6 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--c-1e293b)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--c-64748b)' }} tickFormatter={v => fmtUsd(v)} />
                    <YAxis type="category" dataKey="key" width={130} tick={{ fontSize: 11, fill: 'var(--c-cbd5e1)' }} />
                    <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }} formatter={v => fmtUsd(v)} />
                    <Bar dataKey="cost" radius={[0, 4, 4, 0]}>{breakdown.map((b, i) => <Cell key={i} fill={b.fill} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Breakdown table (click to drill when applicable) */}
          {data?.breakdown?.length > 0 && (
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: 'var(--c-0b1220)', color: 'var(--c-64748b)', textAlign: 'left' }}>
                  <th style={{ padding: '9px 14px', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>{dimLabel(groupBy)}</th>
                  <th style={{ padding: '9px 14px', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>Cost</th>
                  {data.compare_from && <th style={{ padding: '9px 14px', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>Previous</th>}
                  {data.compare_from && <th style={{ padding: '9px 14px', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>Change</th>}
                  <th style={{ padding: '9px 14px', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>Share</th>
                </tr></thead>
                <tbody>
                  {breakdown.map((b, i) => {
                    const drillable = canDrill && b.key !== 'Other'
                    const denom = data.period_total_usd || data.total_cost || 0
                    const up = (b.delta_usd ?? 0) >= 0
                    return (
                      <tr key={i} onClick={drillable ? () => rowDrill(groupBy === 'subscription' ? (subs.find(s => s.name === b.key)?.id || b.key) : b.key) : undefined}
                          style={{ borderTop: '1px solid var(--c-1e293b)', cursor: drillable ? 'pointer' : 'default' }}>
                        <td style={{ padding: '8px 14px', color: 'var(--c-e2e8f0)' }}>
                          <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: b.fill, marginRight: 8 }} />{b.key}
                          {drillable && <ChevronRight size={12} style={{ color: 'var(--c-64748b)', marginLeft: 6, verticalAlign: 'middle' }} />}
                        </td>
                        <td style={{ padding: '8px 14px', color: 'var(--c-f1f5f9)', fontWeight: 600 }}>{fmtUsd(b.cost)}</td>
                        {data.compare_from && <td style={{ padding: '8px 14px', color: 'var(--c-94a3b8)' }}>{fmtUsd(b.prev_cost)}</td>}
                        {data.compare_from && (
                          <td style={{ padding: '8px 14px', color: up ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                            {up ? '▲' : '▼'} {fmtUsd(Math.abs(b.delta_usd || 0))}{b.delta_pct != null ? ` (${b.delta_pct > 0 ? '+' : ''}${b.delta_pct}%)` : ''}
                          </td>
                        )}
                        <td style={{ padding: '8px 14px', color: 'var(--c-94a3b8)' }}>{denom > 0 ? `${Math.round(b.cost / denom * 100)}%` : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* AI analysis grounded on THIS scope + period + dimension slice */}
          {data?.breakdown?.length > 0 && (
            <FinOpsAIPanel
              view="analyze"
              filters={{ subscription_ids: effSubs.length ? effSubs : null, period: period === 'custom' ? `${dateFrom}..${dateTo}` : period, group_by: groupBy, cost_type: costType }}
              data={{
                scope: drill.level === 'root' ? (selSubs.length ? `${selSubs.length} subscription(s)` : 'all subscriptions') : drill.subName,
                period: period === 'custom' ? `${dateFrom} to ${dateTo}` : period,
                date_from: data.date_from, date_to: data.date_to,
                group_by: dimLabel(groupBy), cost_type: costType,
                total_usd: data.period_total_usd ?? data.total_cost,
                group_count: (data.breakdown || []).length,
                top_groups: (data.breakdown || []).slice(0, 10).map(b => ({ name: b.key, cost: b.cost })),
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
