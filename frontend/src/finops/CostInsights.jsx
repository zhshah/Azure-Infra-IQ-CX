/**
 * Cost Insights — a filter-reactive, chart-rich lens over your Azure spend.
 *
 * Mirrors the Resiliency Explorer pattern: fetch the grounded per-resource cost
 * dataset ONCE (real run-rate cost + service / region / SKU / storage redundancy /
 * zone posture / modernization), then do ALL filtering + chart aggregation
 * client-side with useMemo — so every donut/bar re-renders INSTANTLY on a filter
 * change, with no Cost Management API call (throttle-immune). 100% grounded: every
 * figure comes from the cached estate, the genuine BCDR zone assessment, and the
 * modernization engine.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import {
  PieChart as PieIcon, RefreshCw, AlertCircle, Filter, Layers, ShieldCheck,
  Database, Recycle, Rocket, TrendingUp, Server, MapPin,
} from 'lucide-react'
import { finopsApi, fmtUsd } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'
import { useDrill } from '../drill/DrillContext'

const card      = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const miniLabel = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }
const inputStyle = { background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 10px', color: 'var(--c-e2e8f0)', fontSize: 12, colorScheme: 'dark' }
const secLabel  = { color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }

const PALETTE = ['#0078d4', '#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#a855f7', '#3b82f6', '#eab308', '#f97316', '#64748b', '#94a3b8']
// Grounded posture color maps (green = resilient, red = at risk).
const REDUNDANCY_COLORS = { LRS: '#ef4444', ZRS: '#eab308', GRS: '#22c55e', 'RA-GRS': '#14b8a6', GZRS: '#16a34a', 'RA-GZRS': '#06b6d4', Unknown: '#64748b' }
const ZONE_COLORS = { 'Zone-redundant': '#22c55e', 'Zone-redundant (default)': '#4ade80', 'Zonal (single zone)': '#eab308', 'Locally-redundant': '#ef4444', 'Not zone-aware': '#60a5fa', Unknown: '#64748b' }

const fmtK = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`)

/* ── Aggregation helper: sum a measure by key, top-N + Other ── */
function rollup(rows, keyFn, { top = 12, valueFn = (r) => r.cost_current || 0 } = {}) {
  const m = {}
  for (const r of rows) {
    const k = keyFn(r)
    if (k === null || k === undefined || k === '') continue
    m[k] = (m[k] || 0) + (valueFn(r) || 0)
  }
  let arr = Object.entries(m).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value)
  if (arr.length > top) {
    const head = arr.slice(0, top)
    const other = arr.slice(top).reduce((s, x) => s + x.value, 0)
    if (other > 0) head.push({ name: 'Other', value: Math.round(other * 100) / 100 })
    arr = head
  }
  return arr
}

/* ── Reusable donut ── */
function CostDonut({ data, colorFn, height = 230, onSlice }) {
  if (!data.length) return <Empty />
  const click = onSlice ? (d) => d && onSlice(d.name ?? d.payload?.name) : undefined
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={1}
          onClick={click} style={onSlice ? { cursor: 'pointer' } : undefined}>
          {data.map((d, i) => <Cell key={i} fill={colorFn ? colorFn(d.name, i) : PALETTE[i % PALETTE.length]} cursor={onSlice ? 'pointer' : undefined} />)}
        </Pie>
        <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }} formatter={(v) => fmtUsd(v)} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}

/* ── Reusable horizontal bars ── */
function CostBars({ data, colorFn, height = 260, onSlice }) {
  if (!data.length) return <Empty />
  const click = onSlice ? (d) => d && onSlice(d.name ?? d.payload?.name) : undefined
  return (
    <ResponsiveContainer width="100%" height={Math.max(height, data.length * 26 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 6, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={fmtK} />
        <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10, fill: '#cbd5e1' }} />
        <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }} formatter={(v) => fmtUsd(v)} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} onClick={click} cursor={onSlice ? 'pointer' : undefined}>
          {data.map((d, i) => <Cell key={i} fill={colorFn ? colorFn(d.name, i) : PALETTE[i % PALETTE.length]} cursor={onSlice ? 'pointer' : undefined} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function Empty() {
  return <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-64748b)', fontSize: 12 }}>No cost in this slice.</div>
}

function Panel({ title, icon: Icon, children, subtitle }) {
  return (
    <div style={{ ...card, flex: 1, minWidth: 320 }}>
      <div style={secLabel}>{Icon && <Icon size={15} style={{ color: '#0078d4' }} />} {title}</div>
      {subtitle && <div style={{ fontSize: 10, color: 'var(--c-64748b)', margin: '-6px 0 8px' }}>{subtitle}</div>}
      {children}
    </div>
  )
}

const FilterSelect = ({ label, value, onChange, options }) => (
  <div>
    <div style={miniLabel}>{label}</div>
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, minWidth: 150 }}>
      <option value="">All</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
)

export default function CostInsights() {
  const { openResourceDetail, openResourceDrill } = useDrill()
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Filters
  const [fSub, setFSub] = useState('')
  const [fRegion, setFRegion] = useState('')
  const [fRG, setFRG] = useState('')
  const [fService, setFService] = useState('')
  const [fCategory, setFCategory] = useState('')
  const [billableOnly, setBillableOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setPayload(await finopsApi.getCostInsights()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const rows = payload?.rows || []
  const opts = payload?.summary?.options || {}

  const filtered = useMemo(() => {
    let r = rows
    if (fSub) r = r.filter(x => x.subscription_id === fSub)
    if (fRegion) r = r.filter(x => x.region === fRegion)
    if (fRG) r = r.filter(x => x.resource_group === fRG)
    if (fService) r = r.filter(x => x.service === fService)
    if (fCategory) r = r.filter(x => x.category === fCategory)
    if (billableOnly) r = r.filter(x => x.cost_current > 0)
    return r
  }, [rows, fSub, fRegion, fRG, fService, fCategory, billableOnly])

  // All aggregations recompute instantly on any filter change (no network).
  const agg = useMemo(() => {
    const total = filtered.reduce((s, r) => s + (r.cost_current || 0), 0)
    const prev = filtered.reduce((s, r) => s + (r.cost_previous || 0), 0)
    const waste = filtered.reduce((s, r) => s + (r.waste_usd || 0), 0)
    const savings = filtered.reduce((s, r) => s + (r.modernization_savings || 0), 0)
    const unprotected = filtered.filter(r => !r.has_backup).reduce((s, r) => s + (r.cost_current || 0), 0)
    return {
      total, prev, waste, savings, unprotected,
      count: filtered.length,
      billable: filtered.filter(r => r.cost_current > 0).length,
      byService: rollup(filtered, r => r.service),
      byCategory: rollup(filtered, r => r.category, { top: 8 }),
      byRegion: rollup(filtered, r => r.region, { top: 10 }),
      byRG: rollup(filtered, r => r.resource_group, { top: 10 }),
      bySkuTier: rollup(filtered, r => r.sku_tier, { top: 10 }),
      byStorageRed: rollup(filtered.filter(r => r.storage_redundancy), r => r.storage_redundancy, { top: 8 }),
      byZone: rollup(filtered, r => r.zone_label, { top: 8 }),
      byGeo: rollup(filtered, r => (r.geo_redundant ? 'Geo-redundant' : 'Single-region'), { top: 3 }),
      byProtection: rollup(filtered, r => (r.has_backup ? 'Backed up' : 'Not backed up'), { top: 3 }),
      byModern: rollup(filtered.filter(r => r.modernization_type), r => r.modernization_type, { top: 10, valueFn: r => r.modernization_savings }),
      topResources: [...filtered].sort((a, b) => b.cost_current - a.cost_current).slice(0, 15),
      expensiveUnderused: [...filtered]
        .filter(r => r.cost_current > 0 && r.utilization_pct != null && r.utilization_pct < 20)
        .sort((a, b) => b.cost_current - a.cost_current).slice(0, 10),
    }
  }, [filtered])

  const anyFilter = fSub || fRegion || fRG || fService || fCategory || billableOnly
  const clear = () => { setFSub(''); setFRegion(''); setFRG(''); setFService(''); setFCategory(''); setBillableOnly(false) }

  // Chart click → open the right-hand resource blade with the resources behind that
  // segment. `aggArr` (top-N + Other) lets us resolve an "Other" slice to the tail.
  const drillBy = (label, aggArr, valueOf) => (name) => {
    if (name == null) return
    const shown = new Set((aggArr || []).filter(d => d.name !== 'Other').map(d => d.name))
    const matches = filtered.filter(r => {
      const v = valueOf(r)
      if (v == null || v === '') return false
      return name === 'Other' ? !shown.has(String(v)) : String(v) === String(name)
    })
    if (matches.length) openResourceDrill(`${label} · ${name} (${matches.length})`, matches)
  }

  // Grounded facts for the AI panel + export.
  const aiData = useMemo(() => ({
    scope: anyFilter ? { subscription: fSub || 'all', region: fRegion || 'all', resource_group: fRG || 'all', service: fService || 'all', category: fCategory || 'all' } : 'entire estate',
    total_cost: Math.round(agg.total),
    resource_count: agg.count,
    monthly_waste: Math.round(agg.waste),
    modernization_savings: Math.round(agg.savings),
    unprotected_spend: Math.round(agg.unprotected),
    top_services: agg.byService.slice(0, 6),
    by_zone_posture: agg.byZone,
    by_storage_redundancy: agg.byStorageRed,
    top_modernization: agg.byModern.slice(0, 5),
    top_resources: agg.topResources.slice(0, 8).map(r => ({ name: r.resource_name, service: r.service, cost: r.cost_current })),
  }), [agg, anyFilter, fSub, fRegion, fRG, fService, fCategory])

  const exportXlsx = () => finopsApi.exportGenericXlsx({
    title: 'Cost Insights',
    sheets: [
      { name: 'Summary', columns: ['Metric', 'Value'], rows: [
        ['Total cost (USD)', Math.round(agg.total * 100) / 100], ['Resources', agg.count],
        ['Potential modernization savings (USD)', Math.round(agg.savings * 100) / 100],
        ['Idle/orphaned waste (USD)', Math.round(agg.waste * 100) / 100],
        ['Unprotected spend (USD)', Math.round(agg.unprotected * 100) / 100],
      ] },
      { name: 'By service', columns: ['Service', 'Cost (USD)'], rows: agg.byService.map(d => [d.name, d.value]) },
      { name: 'By region', columns: ['Region', 'Cost (USD)'], rows: agg.byRegion.map(d => [d.name, d.value]) },
      { name: 'Storage redundancy', columns: ['Redundancy', 'Cost (USD)'], rows: agg.byStorageRed.map(d => [d.name, d.value]) },
      { name: 'Zone posture', columns: ['Posture', 'Cost (USD)'], rows: agg.byZone.map(d => [d.name, d.value]) },
      { name: 'Modernization savings', columns: ['Target service', 'Monthly saving (USD)'], rows: agg.byModern.map(d => [d.name, d.value]) },
      { name: 'Resources', columns: ['Resource', 'Service', 'Region', 'Resource group', 'SKU', 'Zone posture', 'Storage redundancy', 'Cost (USD)', 'Backed up'], rows: filtered.map(r => [r.resource_name, r.service, r.region, r.resource_group, r.sku, r.zone_label, r.storage_redundancy || '—', r.cost_current, r.has_backup ? 'Yes' : 'No']) },
    ],
  })

  const report = useMemo(() => ({
    title: 'Cost Insights',
    kpis: [
      { label: 'Total cost', value: fmtUsd(agg.total) },
      { label: 'Resources', value: String(agg.count) },
      { label: 'Modernization savings', value: fmtUsd(agg.savings) },
      { label: 'Idle/orphaned waste', value: fmtUsd(agg.waste) },
      { label: 'Unprotected spend', value: fmtUsd(agg.unprotected) },
    ],
    tables: [
      { title: 'Cost by service', columns: ['Service', 'Cost'], rows: agg.byService.map(d => [d.name, fmtUsd(d.value)]) },
      { title: 'Cost by zone-resilience posture', columns: ['Posture', 'Cost'], rows: agg.byZone.map(d => [d.name, fmtUsd(d.value)]) },
      { title: 'Cost by storage redundancy', columns: ['Redundancy', 'Cost'], rows: agg.byStorageRed.map(d => [d.name, fmtUsd(d.value)]) },
      { title: 'Modernization savings by target', columns: ['Target service', 'Monthly saving'], rows: agg.byModern.map(d => [d.name, fmtUsd(d.value)]) },
      { title: 'Top resources by cost', columns: ['Resource', 'Service', 'Cost'], rows: agg.topResources.map(r => [r.resource_name, r.service, fmtUsd(r.cost_current)]) },
    ],
  }), [agg])

  if (loading && !payload) {
    return <div style={{ ...card, textAlign: 'center', color: 'var(--c-64748b)', padding: 50 }}><RefreshCw size={18} className="animate-spin" /> Loading cost insights…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
            <PieIcon size={20} style={{ color: '#0078d4' }} /> Cost Insights
          </h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '4px 0 0' }}>
            Your spend, sliced every way — by service, region, SKU, storage redundancy (LRS/ZRS/GRS/GZRS), zone-resilience posture, waste and modernization upside. Filter anything; every chart updates instantly. Grounded in your live estate.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {payload?.rows?.length > 0 && <FinOpsExportMenu view="cost-insights" onXlsx={exportXlsx} report={report} />}
          <button onClick={load} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 12 }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ ...card, borderColor: 'var(--c-7f1d1d)', color: 'var(--c-fca5a5)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ fontSize: 12 }}>{error}</span>
        </div>
      )}

      {/* Filters */}
      <div style={{ ...card, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600 }}><Filter size={13} /> Filters</div>
        <FilterSelect label="Subscription" value={fSub} onChange={setFSub} options={(opts.subscriptions || []).map(s => ({ value: s.id, label: s.name }))} />
        <FilterSelect label="Region" value={fRegion} onChange={setFRegion} options={(opts.regions || []).map(v => ({ value: v, label: v }))} />
        <FilterSelect label="Resource group" value={fRG} onChange={setFRG} options={(opts.resource_groups || []).map(v => ({ value: v, label: v }))} />
        <FilterSelect label="Service" value={fService} onChange={setFService} options={(opts.services || []).map(v => ({ value: v, label: v }))} />
        <FilterSelect label="Category" value={fCategory} onChange={setFCategory} options={(opts.categories || []).map(v => ({ value: v, label: v }))} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-cbd5e1)', cursor: 'pointer' }}>
          <input type="checkbox" checked={billableOnly} onChange={e => setBillableOnly(e.target.checked)} /> Billable only
        </label>
        {anyFilter && <button onClick={clear} style={{ background: 'none', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 10px', color: 'var(--c-94a3b8)', cursor: 'pointer', fontSize: 11 }}>Clear</button>}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-64748b)' }}>{agg.count} of {rows.length} resources · {payload?.data_source}</span>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'Total cost (run-rate)', value: fmtUsd(agg.total), color: '#0078d4', icon: TrendingUp },
          { label: 'Resources', value: `${agg.count}`, sub: `${agg.billable} billable`, color: '#8b5cf6', icon: Server },
          { label: 'Modernization savings', value: fmtUsd(agg.savings), sub: 'per month', color: '#22c55e', icon: Rocket },
          { label: 'Idle / orphaned waste', value: fmtUsd(agg.waste), color: '#f59e0b', icon: Recycle },
          { label: 'Unprotected spend', value: fmtUsd(agg.unprotected), sub: 'no backup', color: '#ef4444', icon: ShieldCheck },
        ].map((k, i) => {
          const I = k.icon
          return (
            <div key={i} style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 170 }}>
              <div style={{ ...miniLabel, display: 'flex', alignItems: 'center', gap: 5 }}><I size={12} style={{ color: k.color }} /> {k.label}</div>
              <div style={{ color: 'var(--c-f1f5f9)', fontSize: 22, fontWeight: 700 }}>{k.value}</div>
              {k.sub && <div style={{ fontSize: 10, color: 'var(--c-64748b)' }}>{k.sub}</div>}
            </div>
          )
        })}
      </div>

      {/* Row 1: what & where */}
      <div style={{ fontSize: 10, color: 'var(--c-64748b)', marginTop: -4 }}>💡 Click any chart segment or bar to see the resources behind it.</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Panel title="Cost by category" icon={Layers}><CostDonut data={agg.byCategory} onSlice={drillBy('Category', agg.byCategory, r => r.category)} /></Panel>
        <Panel title="Cost by service" icon={Server}><CostBars data={agg.byService} onSlice={drillBy('Service', agg.byService, r => r.service)} /></Panel>
        <Panel title="Cost by region" icon={MapPin}><CostBars data={agg.byRegion} onSlice={drillBy('Region', agg.byRegion, r => r.region)} /></Panel>
      </div>

      {/* Row 2: resilience posture of your spend */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Panel title="Cost by zone-resilience posture" icon={ShieldCheck} subtitle="From the genuine zone assessment — where your money sits on resilience">
          <CostDonut data={agg.byZone} colorFn={(n) => ZONE_COLORS[n] || '#64748b'} onSlice={drillBy('Zone posture', agg.byZone, r => r.zone_label)} />
        </Panel>
        <Panel title="Cost by storage redundancy" icon={Database} subtitle="LRS / ZRS / GRS / GZRS — parsed from the storage SKU">
          <CostDonut data={agg.byStorageRed} colorFn={(n) => REDUNDANCY_COLORS[n] || '#64748b'} onSlice={drillBy('Storage redundancy', agg.byStorageRed, r => r.storage_redundancy)} />
        </Panel>
        <Panel title="Geo-redundant vs single-region spend" icon={ShieldCheck}>
          <CostDonut data={agg.byGeo} colorFn={(n) => (n === 'Geo-redundant' ? '#22c55e' : '#f97316')} onSlice={drillBy('Geo-redundancy', agg.byGeo, r => (r.geo_redundant ? 'Geo-redundant' : 'Single-region'))} />
        </Panel>
      </div>

      {/* Row 3: governance + sizing */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Panel title="Protected vs unprotected spend" icon={ShieldCheck}>
          <CostDonut data={agg.byProtection} colorFn={(n) => (n === 'Backed up' ? '#22c55e' : '#ef4444')} onSlice={drillBy('Protection', agg.byProtection, r => (r.has_backup ? 'Backed up' : 'Not backed up'))} />
        </Panel>
        <Panel title="Cost by SKU tier" icon={Layers}><CostBars data={agg.bySkuTier} onSlice={drillBy('SKU tier', agg.bySkuTier, r => r.sku_tier)} /></Panel>
        <Panel title="Cost by resource group" icon={Layers}><CostBars data={agg.byRG} onSlice={drillBy('Resource group', agg.byRG, r => r.resource_group)} /></Panel>
      </div>

      {/* Row 4: modernization upside */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Panel title="Modernization savings by target" icon={Rocket} subtitle="e.g. SQL Server on VM → SQL Managed Instance — grounded monthly saving">
          {agg.byModern.length ? <CostBars data={agg.byModern} colorFn={() => '#22c55e'} onSlice={drillBy('Modernization', agg.byModern, r => r.modernization_type)} /> : <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-64748b)', fontSize: 12 }}>No modernization opportunities in this slice.</div>}
        </Panel>
        <Panel title="Expensive & under-utilized" icon={Recycle} subtitle="Cost > $0 with utilization < 20% — prime right-size / shutdown candidates">
          {agg.expensiveUnderused.length ? (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ color: 'var(--c-64748b)', textAlign: 'left' }}>
                  {['Resource', 'Util %', 'Cost'].map((h, i) => <th key={i} style={{ padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {agg.expensiveUnderused.map((r, i) => (
                    <tr key={i} onClick={() => r.resource_id && openResourceDetail(r)} title={r.resource_id ? 'View resource details' : undefined} style={{ borderTop: '1px solid var(--c-1e293b)', cursor: r.resource_id ? 'pointer' : 'default' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)' }}>{r.resource_name}</td>
                      <td style={{ padding: '6px 8px', color: '#f59e0b' }}>{Math.round(r.utilization_pct)}%</td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-f1f5f9)', fontWeight: 600 }}>{fmtUsd(r.cost_current)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-64748b)', fontSize: 12 }}>No expensive under-utilized resources in this slice.</div>}
        </Panel>
      </div>

      {/* Top resources table */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-1e293b)', color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700 }}>Top 15 resources by cost</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: 'var(--c-0b1220)', color: 'var(--c-64748b)', textAlign: 'left' }}>
            {['Resource', 'Service', 'Region', 'Resource group', 'Zone posture', 'Redundancy', 'Cost'].map((h, i) => <th key={i} style={{ padding: '9px 14px', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {agg.topResources.map((r, i) => (
              <tr key={i} onClick={() => r.resource_id && openResourceDetail(r)} title={r.resource_id ? 'View resource details' : undefined} style={{ borderTop: '1px solid var(--c-1e293b)', cursor: r.resource_id ? 'pointer' : 'default' }}>
                <td style={{ padding: '8px 14px', color: 'var(--c-e2e8f0)' }}>{r.resource_name}</td>
                <td style={{ padding: '8px 14px', color: 'var(--c-94a3b8)' }}>{r.service}</td>
                <td style={{ padding: '8px 14px', color: 'var(--c-64748b)' }}>{r.region}</td>
                <td style={{ padding: '8px 14px', color: 'var(--c-64748b)' }}>{r.resource_group}</td>
                <td style={{ padding: '8px 14px', color: ZONE_COLORS[r.zone_label] || 'var(--c-94a3b8)' }}>{r.zone_label}</td>
                <td style={{ padding: '8px 14px', color: 'var(--c-94a3b8)' }}>{r.storage_redundancy || '—'}</td>
                <td style={{ padding: '8px 14px', color: 'var(--c-f1f5f9)', fontWeight: 600 }}>{fmtUsd(r.cost_current)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Grounded AI analysis of the current slice */}
      {payload?.rows?.length > 0 && (
        <FinOpsAIPanel view="cost-insights" title="AI Cost Analysis — grounded in your live estate" filters={{ subscription: fSub || null, region: fRegion || null, resource_group: fRG || null, service: fService || null, category: fCategory || null }} data={aiData} />
      )}
    </div>
  )
}
