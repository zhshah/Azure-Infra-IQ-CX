/**
 * Cost Explorer — Advanced Self-Service Cost Analysis
 * Enterprise-class UI with Azure Portal-style searchable dropdowns,
 * live tag filtering, and consistent dark theme.
 */
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Download, RefreshCw, AlertCircle, BarChart2, PieChart as PieIcon, TrendingUp, Search as SearchIcon } from 'lucide-react'
import { finopsApi, getFilterOptions, fmtUsd, CHART_COLORS, DIMENSION_OPTIONS, consumeDrill } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import DateRangePicker from './DateRangePicker'
import AdvancedFilterBar, { EMPTY_FILTERS } from './AdvancedFilterBar'
import SearchableSelect from '../components/shared/SearchableSelect'
import EnterpriseCard from '../components/shared/EnterpriseCard'

const GRANULARITY_OPTIONS = [
  { value: 'Daily',   label: 'Daily' },
  { value: 'Monthly', label: 'Monthly' },
  { value: 'None',    label: 'Total' },
]
const COST_TYPE_OPTIONS = [
  { value: 'ActualCost',    label: 'Actual Cost' },
  { value: 'AmortizedCost', label: 'Amortized Cost' },
]
const CHART_TYPES = [
  { value: 'stacked', label: 'Stacked Bar',  Icon: BarChart2 },
  { value: 'area',    label: 'Area',         Icon: TrendingUp },
  { value: 'pie',     label: 'Pie',          Icon: PieIcon },
]

/* ── Chart data builder ─────────────────────────────────────────────── */
function buildChartData(dataPoints) {
  if (!dataPoints?.length) return { rows: [], labels: [] }
  if (dataPoints[0]?.date) {
    const byDate = {}
    const labels = new Set()
    for (const dp of dataPoints) {
      const d = dp.date || 'Total'
      if (!byDate[d]) byDate[d] = { date: d }
      byDate[d][dp.label] = (byDate[d][dp.label] || 0) + dp.cost_usd
      labels.add(dp.label)
    }
    return { rows: Object.values(byDate).sort((a, b) => (a.date > b.date ? 1 : -1)), labels: [...labels] }
  }
  const byLabel = {}
  for (const dp of dataPoints) byLabel[dp.label] = (byLabel[dp.label] || 0) + dp.cost_usd
  const rows = Object.entries(byLabel).sort((a, b) => b[1] - a[1]).map(([label, cost]) => ({ label, cost }))
  return { rows, labels: ['cost'] }
}

/* ── Main Component ─────────────────────────────────────────────────── */
export default function CostExplorer() {
  const [result,    setResult]    = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [xlsxError, setXlsxError] = useState(null)
  const [chartType, setChartType] = useState('stacked')
  const [filterOpts, setFilterOpts] = useState({ subscriptions: [], resource_groups: [], resource_types: [], regions: [], tag_keys: [], available_tag_keys: [] })
  const abortRef = useRef(null)

  // Core query params
  const [timeRange,    setTimeRange]    = useState('last_30d')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [granularity,  setGranularity]  = useState('Daily')
  const [groupBy,      setGroupBy]      = useState(['SubscriptionId'])
  const [costType,     setCostType]     = useState('ActualCost')
  const [accumulated,  setAccumulated]  = useState(false)

  // Advanced filters — now managed by AdvancedFilterBar
  const [advFilters, setAdvFilters] = useState(EMPTY_FILTERS)

  // Apply a pending drill-down (deep-link from another FinOps view) once on mount.
  useEffect(() => {
    const d = consumeDrill()
    if (!d) return
    if (Array.isArray(d.groupBy) && d.groupBy.length) setGroupBy(d.groupBy)
    if (d.timeRange) setTimeRange(d.timeRange)
    if (d.advFilters) setAdvFilters(prev => ({ ...prev, ...d.advFilters }))
  }, [])

  // Load filter options from cache on mount (cached 5 min at module level)
  useEffect(() => {
    const ctrl = new AbortController()
    getFilterOptions(ctrl.signal).then(opts => {
      const normalize = (arr) => (arr || []).map(v =>
        typeof v === 'string' ? { value: v, label: v } : v
      )
      setFilterOpts({
        subscriptions: opts.subscriptions || [],
        resource_groups: normalize(opts.resource_groups),
        resource_types: (opts.resource_types || []).map(v =>
          typeof v === 'string' ? { value: v, label: v.split('/').pop() || v } : v
        ),
        regions: normalize(opts.regions),
        tag_keys: opts.tag_keys || [],
        available_tag_keys: opts.available_tag_keys || opts.tag_keys || [],
      })
    }).catch(() => {})
    return () => ctrl.abort()
  }, [])


  const clearAllFilters = () => setAdvFilters({ ...EMPTY_FILTERS })

  const run = useCallback(async () => {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true); setError(null)
    try {
      // Build filters object matching FinOpsCostFilters schema from AdvancedFilterBar state
      const filters = {}
      if ((advFilters.subscriptions || []).length)  filters.subscriptions   = advFilters.subscriptions
      if ((advFilters.resource_groups || []).length) filters.resource_groups = advFilters.resource_groups
      if ((advFilters.regions || []).length)         filters.regions         = advFilters.regions
      if ((advFilters.resource_types || []).length)  filters.resource_types  = advFilters.resource_types
      if (advFilters.cost_min)                       filters.min_cost        = parseFloat(advFilters.cost_min)
      if (advFilters.cost_max)                       filters.max_cost        = parseFloat(advFilters.cost_max)
      if (advFilters.resource_name)                  filters.resource_name   = advFilters.resource_name
      if (advFilters.environment)                    filters.environment     = advFilters.environment
      // Build tags dict from tag rows
      const tagDict = {}
      ;(advFilters.tags || []).filter(r => r.key).forEach(r => { if (r.value) tagDict[r.key] = r.value })
      if (Object.keys(tagDict).length) filters.tags = tagDict

      const query = {
        time_range:  timeRange,
        date_from:   timeRange === 'custom' ? dateFrom : null,
        date_to:     timeRange === 'custom' ? dateTo   : null,
        granularity,
        group_by:    groupBy,
        cost_type:   costType,
        filters,
      }
      const res = await finopsApi.costExplorer(query, ctrl.signal)
      if (!ctrl.signal.aborted) setResult({ ...res, _query: query })
    } catch (e) { if (e.name !== 'AbortError') setError(e.message) }
    finally { if (!ctrl.signal.aborted) setLoading(false) }
  }, [timeRange, dateFrom, dateTo, granularity, groupBy, costType, advFilters])

  // Cancel in-flight requests on unmount
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort() }, [])

  const handleDownloadXlsx = () => {
    if (!result?._query) return
    setXlsxError(null)
    finopsApi.exportXlsx(result._query).catch(e => setXlsxError(e.message))
  }

  // Accumulated cost computation (running total per series)
  const buildAccumulatedRows = (rows) => {
    const sums = {}
    return rows.map(r => {
      const newRow = { ...r }
      Object.keys(r).forEach(k => {
        if (k !== 'date' && k !== 'label' && typeof r[k] === 'number') {
          sums[k] = (sums[k] || 0) + r[k]
          newRow[k] = sums[k]
        }
      })
      return newRow
    })
  }

  const { rows: rawRows, labels, isTimeSeries } = useMemo(() => {
    if (!result) return { rows: [], labels: [], isTimeSeries: false }
    const { rows: r, labels: l } = buildChartData(result.data_points)
    return { rows: r, labels: l, isTimeSeries: r[0]?.date !== undefined }
  }, [result])

  const rows = useMemo(() => (
    accumulated && isTimeSeries ? buildAccumulatedRows(rawRows) : rawRows
  ), [rawRows, accumulated, isTimeSeries])

  function renderChart() {
    if (!rows.length) return null
    if (!isTimeSeries || chartType === 'pie') {
      const pieData = isTimeSeries
        ? (result?.top_contributors || []).map(t => ({ name: t.label, value: t.cost }))
        : rows.map(r => ({ name: r.label, value: r.cost }))
      return (
        <PieChart>
          <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={120} innerRadius={50} paddingAngle={2}>
            {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={v => fmtUsd(v, 2)} contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }} />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: 'var(--c-94a3b8)' }} />
        </PieChart>
      )
    }
    if (chartType === 'area') {
      return (
        <AreaChart data={rows}>
          <defs>{labels.map((l, i) => (
            <linearGradient key={l} id={`g${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.3} />
              <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
            </linearGradient>
          ))}</defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10 }} />
          <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
          <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }} formatter={v => fmtUsd(v, 2)} />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: 'var(--c-94a3b8)' }} />
          {labels.map((l, i) => (
            <Area key={l} type="monotone" dataKey={l} stackId="1" stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={`url(#g${i})`} strokeWidth={1.5} dot={false} />
          ))}
        </AreaChart>
      )
    }
    return (
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10 }} />
        <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
        <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }} formatter={v => fmtUsd(v, 2)} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: 'var(--c-94a3b8)' }} />
        {labels.map((l, i) => (
          <Bar key={l} dataKey={l} stackId="stack" fill={CHART_COLORS[i % CHART_COLORS.length]} />
        ))}
      </BarChart>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <FinOpsAIPanel view="cost-explorer" data={result ? { total_usd: result.total_usd, group_by: groupBy, time_range: timeRange, cost_type: costType, point_count: (result.data_points || []).length, top_contributors: (result.top_contributors || []).slice(0, 8) } : {}} />

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Cost Explorer</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>Live Azure Cost Management — same data as Azure Portal</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {result && (
            <button onClick={() => finopsApi.downloadCsv(groupBy[0], timeRange).catch(e => console.error('CSV export:', e))}
              style={{
                background: 'transparent', border: '1px solid var(--c-1e293b)', borderRadius: 7,
                padding: '6px 14px', color: 'var(--c-94a3b8)', fontSize: 11, fontWeight: 500,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                transition: 'all 0.15s',
              }}>
              <Download size={12} /> Export CSV
            </button>
          )}
        </div>
      </div>

      {/* ── Core query controls ── */}
      <EnterpriseCard title="Query Parameters" icon={SearchIcon} iconColor="#0078d4" noPadding>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, padding: '14px 16px' }}>
          <div>
            <label style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Time Range</label>
            <DateRangePicker
              value={timeRange} onChange={setTimeRange}
              dateFrom={dateFrom} dateTo={dateTo}
              onDateFromChange={setDateFrom} onDateToChange={setDateTo}
            />
          </div>
          <SearchableSelect label="Granularity" value={granularity} onChange={setGranularity} options={GRANULARITY_OPTIONS} compact />
          <SearchableSelect label="Group By"    value={groupBy[0]}  onChange={v => setGroupBy([v])} options={DIMENSION_OPTIONS} compact />
          <SearchableSelect label="Cost Type"   value={costType}    onChange={setCostType}    options={COST_TYPE_OPTIONS} compact />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', visibility: 'hidden' }}>Run</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={run} disabled={loading} style={{
                flex: 1, background: '#0078d4', border: 'none', borderRadius: 7, padding: '8px 14px',
                color: 'white', fontWeight: 600, fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                boxShadow: loading ? 'none' : '0 1px 4px rgba(0, 120, 212, 0.3)',
                transition: 'all 0.15s',
              }}>
                {loading ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</> : 'Run Query'}
              </button>
            </div>
          </div>
        </div>
      </EnterpriseCard>

      {/* ── Advanced filters ── */}
      <AdvancedFilterBar
        filters={advFilters}
        onChange={setAdvFilters}
        filterOptions={filterOpts}
        collapsed={false}
      />

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 8, padding: 14, color: 'var(--c-fca5a5)', display: 'flex', gap: 8 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 12 }}>{error}</span>
            <button onClick={run} style={{ marginLeft: 12, fontSize: 11, color: 'var(--c-60a5fa)', background: 'none', border: 'none', cursor: 'pointer' }}>↺ Retry</button>
          </div>
        </div>
      )}

      {/* ── XLSX export error ── */}
      {xlsxError && (
        <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 8, padding: '8px 14px', color: 'var(--c-fca5a5)', fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
          XLSX export failed: {xlsxError}
          <button onClick={() => setXlsxError(null)} style={{ background: 'none', border: 'none', color: 'var(--c-94a3b8)', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* ── Chart ── */}
      {result && (
        <EnterpriseCard
          title={`Total: ${fmtUsd(result.total_usd, 2)}`}
          subtitle={`${result.date_from} → ${result.date_to} · ${result.granularity} · ${result.cost_type}`}
          icon={BarChart2}
          iconColor="#0078d4"
          actions={
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {isTimeSeries && (
                <button onClick={() => setAccumulated(a => !a)} style={{
                  background: accumulated ? 'rgba(0, 120, 212, 0.1)' : 'transparent',
                  border: `1px solid ${accumulated ? 'rgba(0, 120, 212, 0.3)' : 'var(--c-1e293b)'}`,
                  borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                  color: accumulated ? '#0078d4' : 'var(--c-64748b)', fontSize: 11, fontWeight: 500,
                  transition: 'all 0.15s',
                }}>
                  ∑ Cumulative
                </button>
              )}
              {CHART_TYPES.map(ct => (
                <button key={ct.value} onClick={() => setChartType(ct.value)} title={ct.label} style={{
                  background: chartType === ct.value ? 'var(--c-1e293b)' : 'transparent',
                  border: `1px solid ${chartType === ct.value ? 'rgba(var(--rgb-slate), 0.7)' : 'transparent'}`,
                  borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                  color: chartType === ct.value ? 'var(--c-e2e8f0)' : 'var(--c-475569)',
                  transition: 'all 0.15s',
                }}>
                  <ct.Icon size={14} />
                </button>
              ))}
              <button onClick={handleDownloadXlsx} title="Download XLSX" style={{
                background: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.25)',
                borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                color: 'var(--c-4ade80)', fontSize: 11, fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
              }}>
                <Download size={12} /> XLSX
              </button>
            </div>
          }
        >
          <ResponsiveContainer width="100%" height={280}>
            {renderChart() || <div />}
          </ResponsiveContainer>
        </EnterpriseCard>
      )}

      {/* ── Top contributors ── */}
      {result?.top_contributors?.length > 0 && (
        <EnterpriseCard title="Top Contributors" icon={TrendingUp} iconColor="#f59e0b" collapsible>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>{['Dimension', 'Cost (USD)', '% of Total'].map(h => (
                <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '6px 8px', borderBottom: '1px solid rgba(var(--rgb-slate), 0.5)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {result.top_contributors.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(15, 23, 42, 0.5)' }}>
                  <td style={{ padding: '8px 8px', color: 'var(--c-e2e8f0)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                      {r.label}
                    </div>
                  </td>
                  <td style={{ padding: '8px 8px', color: '#0078d4', fontWeight: 600 }}>{fmtUsd(r.cost, 2)}</td>
                  <td style={{ padding: '8px 8px', color: 'var(--c-64748b)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ height: 4, width: `${Math.min(r.pct, 100)}%`, background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 2, maxWidth: 80 }} />
                      {r.pct}%
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </EnterpriseCard>
      )}

      {!result && !loading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--c-334155)', fontSize: 13 }}>
          Configure your filters above and click <strong style={{ color: '#0078d4' }}>Run Query</strong> to load live Azure cost data.
        </div>
      )}
    </div>
  )
}

