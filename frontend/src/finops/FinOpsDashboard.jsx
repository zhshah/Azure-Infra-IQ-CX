/**
 * FinOps Dashboard — Interactive Executive Overview
 * - Subscription, Resource Group, Time Range, and Breakdown filters
 * - All charts/KPIs dynamically update when filters change
 * - Real calendar dates on trend X-axis
 * - Pie chart for cost breakdown by selected dimension
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  AlertCircle, RefreshCw, TrendingUp,
  DollarSign, Shield, Tag, Zap, AlertTriangle,
  Filter, ChevronDown, X,
} from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct, CHART_COLORS, trendBadge, getSubscriptions, getFilterOptions, TIME_RANGE_OPTIONS, DIMENSION_OPTIONS } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'
import { KPISkeleton } from './FinOpsSkeleton'
import SearchableSelect from '../components/shared/SearchableSelect'

/* ── KPI Card ────────────────────────────────────────────────────── */
function KPICard({ label, value, sub, icon: Icon, color = '#3b82f6', accent }) {
  return (
    <div style={{
      background: 'var(--c-111827)', border: `1px solid ${accent || 'var(--c-1e293b)'}`, borderRadius: 10,
      padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--c-64748b)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
        {Icon && <Icon size={16} style={{ color }} />}
      </div>
      <div style={{ color: 'var(--c-f1f5f9)', fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub != null && (
        <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>{sub}</div>
      )}
    </div>
  )
}

/* ── Health Bar ────────────────────────────────────────────────────── */
function HealthBar({ label, pct, color }) {
  const c = color || (pct >= 90 ? '#ef4444' : pct >= 75 ? '#f97316' : '#3b82f6')
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: 'var(--c-94a3b8)', fontSize: 11 }}>{label}</span>
        <span style={{ color: c, fontSize: 11, fontWeight: 700 }}>{fmtPct(pct)}</span>
      </div>
      <div style={{ height: 5, background: 'var(--c-1e293b)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: c, borderRadius: 4, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

/* ── Date X-axis tick ──────────────────────────────────────────────── */
function DateTick({ x, y, payload }) {
  const label = payload?.value ? payload.value.slice(5) : ''  // "MM-DD"
  return <text x={x} y={y + 12} style={{ fill: 'var(--c-475569)' }} fontSize={9} textAnchor="middle">{label}</text>
}

/* ── Pie chart label ──────────────────────────────────────────────── */
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, pct, label }) {
  if (pct < 5) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} style={{ fill: 'var(--c-e2e8f0)' }} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>
      {pct.toFixed(0)}%
    </text>
  )
}

/* ── Active filter pill ───────────────────────────────────────────── */
function FilterPill({ label, onClear }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: 'var(--c-1e3a5f)', border: '1px solid #1d4ed8', borderRadius: 12,
      padding: '2px 10px 2px 8px', fontSize: 11, color: 'var(--c-93c5fd)',
    }}>
      {label}
      <button onClick={onClear} style={{ background: 'none', border: 'none', color: 'var(--c-93c5fd)', cursor: 'pointer', padding: 0, display: 'flex' }}>
        <X size={10} />
      </button>
    </span>
  )
}

/* ── Time range labels ────────────────────────────────────────────── */
const TIME_LABELS = Object.fromEntries(TIME_RANGE_OPTIONS.map(o => [o.value, o.label]))

/* ── Main breakdown dimension options for dashboard ───────────────── */
const BREAKDOWN_OPTIONS = DIMENSION_OPTIONS.filter(d =>
  ['SubscriptionId','ResourceGroupName','ResourceType','ServiceFamily','MeterCategory','ResourceLocation'].includes(d.value)
)

export default function FinOpsDashboard() {
  // KPI data (from /summary — unfiltered snapshot)
  const [kpi,         setKpi]         = useState(null)
  // Filtered chart data (from /dashboard-data)
  const [chartData,   setChartData]   = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [chartLoading, setChartLoading] = useState(false)
  const [error,       setError]       = useState(null)
  const [accumulated, setAccumulated] = useState(false)

  // Filter state
  const [subscriptions, setSubscriptions] = useState([])  // dropdown options
  const [resourceGroups, setResourceGroups] = useState([])  // dropdown options
  const [selectedSub,   setSelectedSub]   = useState(null)
  const [selectedRG,    setSelectedRG]    = useState(null)
  const [timeRange,     setTimeRange]     = useState('last_30d')
  const [breakdownDim,  setBreakdownDim]  = useState('SubscriptionId')
  const [showFilters,   setShowFilters]   = useState(true)

  const filtersActive = selectedSub || selectedRG || timeRange !== 'last_30d'
  const debounceRef = useRef(null)
  const chartAbortRef = useRef(null)

  // Load KPI summary + filter options on mount
  const loadInitial = async () => {
    setLoading(true); setError(null)
    try {
      const [kpiData, subs, filterOpts] = await Promise.all([
        finopsApi.getSummary(),
        getSubscriptions().catch(() => []),
        getFilterOptions().catch(() => ({ subscriptions: [], resource_groups: [] })),
      ])
      setKpi(kpiData)

      // Merge subscription sources
      const subOpts = subs.length > 0
        ? subs.map(s => ({ value: s.subscription_id, label: s.subscription_name || s.subscription_id }))
        : (filterOpts.subscriptions || []).map(s => ({ value: s, label: s }))
      setSubscriptions(subOpts)

      const rgOpts = (filterOpts.resource_groups || []).map(rg => ({ value: rg, label: rg }))
      setResourceGroups(rgOpts)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Load filtered chart data
  const loadChartData = useCallback(async () => {
    if (chartAbortRef.current) chartAbortRef.current.abort()
    const ctrl = new AbortController()
    chartAbortRef.current = ctrl
    setChartLoading(true)
    try {
      const data = await finopsApi.getDashboardData({
        subscription_id: selectedSub,
        resource_group: selectedRG,
        time_range: timeRange,
        group_by: breakdownDim,
      }, ctrl.signal)
      if (!ctrl.signal.aborted) setChartData(data)
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.warn('Failed to load filtered chart data:', e)
        setChartData(null)
      }
    } finally {
      if (!ctrl.signal.aborted) setChartLoading(false)
    }
  }, [selectedSub, selectedRG, timeRange, breakdownDim])

  // Mount: load KPI + filters + chart data
  useEffect(() => { loadInitial() }, [])

  // Reload charts when filters change (debounced 300ms)
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadChartData(), 300)
    return () => clearTimeout(debounceRef.current)
  }, [selectedSub, selectedRG, timeRange, breakdownDim, loadChartData])

  // Cancel in-flight requests on unmount
  useEffect(() => () => { if (chartAbortRef.current) chartAbortRef.current.abort() }, [])

  const clearAllFilters = () => {
    setSelectedSub(null)
    setSelectedRG(null)
    setTimeRange('last_30d')
    setBreakdownDim('SubscriptionId')
  }

  /* ── Build chart data from filtered response or fallback to KPI ── */
  // NOTE: hooks must be before early returns — kpi/chartData will be null until loaded
  const useFiltered = !!(chartData && chartData.trend && chartData.trend.length > 0)

  // Trend data — memoized
  const { trendData, trendTotal } = useMemo(() => {
    if (!kpi) return { trendData: [], trendTotal: 0 }
    let raw
    if (useFiltered) {
      raw = chartData.trend.map(p => ({ date: p.date, cost: p.cost }))
    } else {
      const dates = kpi.cost_trend_dates || []
      const costs = kpi.cost_trend_30d   || []
      raw = dates.map((d, i) => ({ date: d, cost: costs[i] ?? 0 }))
    }
    const trend = accumulated
      ? raw.reduce((acc, pt, i) => {
          acc.push({ date: pt.date, cost: (acc[i - 1]?.cost ?? 0) + (pt.cost ?? 0) })
          return acc
        }, [])
      : raw
    const total = raw.reduce((s, p) => s + p.cost, 0)
    return { trendData: trend, trendTotal: total }
  }, [useFiltered, chartData, kpi, accumulated])

  // Breakdown data (bar + pie chart) — memoized
  const breakdownData = useMemo(() => {
    if (!kpi) return []
    let data
    if (chartData && chartData.breakdown && chartData.breakdown.length > 0) {
      data = chartData.breakdown.map(b => ({
        name: (b.label || '').replace('Microsoft Azure ', '').slice(0, 28),
        cost: typeof b.cost === 'number' ? b.cost : 0,
        pct: b.pct || 0,
      }))
    } else {
      data = (kpi.by_subscription || []).map(s => ({
        name: (s.name || s.id || '').replace('Microsoft Azure ', '').slice(0, 28),
        cost: s.cost,
        pct: 0,
      }))
      const total = data.reduce((s, d) => s + d.cost, 0) || 1
      data.forEach(d => { d.pct = Math.round(d.cost / total * 100) })
    }
    return data
  }, [chartData, kpi])

  if (loading) return <KPISkeleton count={6} />
  if (error) return (
    <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 10, padding: 20, color: 'var(--c-fca5a5)', display: 'flex', gap: 10 }}>
      <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Failed to load FinOps summary</div>
        <div style={{ fontSize: 12, color: '#ef4444' }}>{error}</div>
        <button onClick={loadInitial} style={{ marginTop: 10, fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>↺ Retry</button>
      </div>
    </div>
  )
  if (!kpi) return null

  const totalCost = chartData ? chartData.total_cost : kpi.total_spend_mtd
  const momColor = kpi.mom_delta_pct >= 0 ? '#ef4444' : '#22c55e'
  const momArrow = kpi.mom_delta_pct >= 0 ? '↑' : '↓'
  const dimLabel = DIMENSION_OPTIONS.find(d => d.value === breakdownDim)?.label || breakdownDim

  const aiData = {
    total_cost: totalCost, mtd_spend: kpi.total_spend_mtd, mom_delta_pct: kpi.mom_delta_pct,
    subscriptions: kpi.subscription_count, resources: kpi.total_resource_count,
    breakdown_dimension: dimLabel, time_range: timeRange,
    top_breakdown: (breakdownData || []).slice(0, 8).map(b => ({ name: b.name, cost: b.cost })),
    selected_subscription: selectedSub, selected_resource_group: selectedRG,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>FinOps Dashboard</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>
            Azure Cost Management · {kpi.subscription_count} subscriptions · {kpi.total_resource_count} resources
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <FinOpsExportMenu view="dashboard" focusDays={30}
            onCsv={() => finopsApi.downloadCsv(breakdownDim, timeRange)}
            onXlsx={() => finopsApi.downloadReport()} />
          {chartData?.date_from && (
            <span style={{ fontSize: 10, color: 'var(--c-475569)' }}>
              {chartData.date_from} → {chartData.date_to}
            </span>
          )}
          <span style={{ fontSize: 10, color: 'var(--c-334155)' }}>
            {kpi.generated_at ? new Date(kpi.generated_at).toLocaleString() : ''}
          </span>
          <span style={{ fontSize: 10, color: 'var(--c-475569)', background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 4, padding: '2px 6px' }}>
            {kpi.data_source === 'dashboard_cache' ? '⚡ cached' : '☁ live'}
          </span>
          <button onClick={() => setShowFilters(f => !f)} style={{
            background: filtersActive ? 'var(--c-1e3a5f)' : 'var(--c-1e293b)',
            border: `1px solid ${filtersActive ? '#1d4ed8' : 'var(--c-334155)'}`,
            borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
            color: filtersActive ? '#93c5fd' : 'var(--c-94a3b8)', fontSize: 11,
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Filter size={12} /> Filters {filtersActive && '●'}
          </button>
          <button onClick={() => { loadInitial(); }} style={{
            background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6,
            padding: '5px 10px', cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 11,
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* ── AI Cost Analysis ── */}
      <FinOpsAIPanel view="dashboard" data={aiData} />

      {/* ── Filter Bar ── */}
      {showFilters && (
        <div style={{
          background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: '14px 18px',
          display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end',
        }}>
          <SearchableSelect
            label="Subscription"
            value={selectedSub || ''}
            onChange={v => setSelectedSub(v || null)}
            options={subscriptions}
            placeholder="All Subscriptions"
            searchPlaceholder="Search subscriptions…"
            compact
          />
          <SearchableSelect
            label="Resource Group"
            value={selectedRG || ''}
            onChange={v => setSelectedRG(v || null)}
            options={resourceGroups}
            placeholder="All Resource Groups"
            searchPlaceholder="Search resource groups…"
            compact
          />
          <SearchableSelect
            label="Time Range"
            value={timeRange}
            onChange={v => setTimeRange(v || 'last_30d')}
            options={TIME_RANGE_OPTIONS.filter(o => o.value !== 'custom')}
            placeholder="Last 30 Days"
            compact
          />
          <SearchableSelect
            label="Breakdown By"
            value={breakdownDim}
            onChange={v => setBreakdownDim(v || 'SubscriptionId')}
            options={BREAKDOWN_OPTIONS}
            placeholder="Subscription"
            compact
          />

          {filtersActive && (
            <button onClick={clearAllFilters} style={{
              background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6,
              padding: '6px 12px', cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 11,
              display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'flex-end',
            }}>
              <X size={10} /> Clear All
            </button>
          )}

          {chartLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingBottom: 4 }}>
              <RefreshCw size={12} className="animate-spin" style={{ color: '#3b82f6' }} />
              <span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>Updating…</span>
            </div>
          )}
        </div>
      )}

      {/* ── Active filter pills ── */}
      {filtersActive && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {selectedSub && (
            <FilterPill
              label={`Sub: ${subscriptions.find(s => s.value === selectedSub)?.label || selectedSub}`}
              onClear={() => setSelectedSub(null)}
            />
          )}
          {selectedRG && <FilterPill label={`RG: ${selectedRG}`} onClear={() => setSelectedRG(null)} />}
          {timeRange !== 'last_30d' && (
            <FilterPill label={TIME_LABELS[timeRange] || timeRange} onClear={() => setTimeRange('last_30d')} />
          )}
        </div>
      )}

      {/* ── Anomaly banner ── */}
      {kpi.anomaly_count > 0 && (
        <div style={{
          background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 8,
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
        }}>
          <AlertTriangle size={16} style={{ color: 'var(--c-f87171)', flexShrink: 0 }} />
          <span style={{ color: 'var(--c-fca5a5)', fontWeight: 600 }}>
            {kpi.anomaly_count} cost anomal{kpi.anomaly_count === 1 ? 'y' : 'ies'} detected
          </span>
          <span style={{ color: 'var(--c-64748b)', fontSize: 12 }}>— check Alerts tab for details</span>
        </div>
      )}

      {/* ── KPI Grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 12 }}>
        <KPICard
          label={filtersActive ? 'Filtered Spend' : 'MTD Spend'}
          icon={DollarSign} color="#3b82f6"
          value={fmtUsd(filtersActive && chartData ? totalCost : kpi.total_spend_mtd)}
          sub={
            filtersActive && chartData
              ? <span style={{ color: 'var(--c-64748b)' }}>{TIME_LABELS[timeRange] || timeRange}</span>
              : <span style={{ color: momColor }}>{momArrow} {Math.abs(kpi.mom_delta_pct).toFixed(1)}% vs last month</span>
          }
          accent={kpi.mom_delta_pct > 20 ? 'var(--c-7f1d1d)' : undefined}
        />
        <KPICard
          label="EOM Forecast" icon={TrendingUp} color="#8b5cf6"
          value={fmtUsd(kpi.forecast_eom_usd)}
          sub={`Prev month: ${fmtUsd(kpi.total_spend_last_month)}`}
        />
        <KPICard
          label="Budget Health" icon={Shield} color="#f59e0b"
          value={kpi.has_budgets ? fmtPct(kpi.budget_utilization_pct) : '—'}
          sub={kpi.has_budgets
            ? `${kpi.budgets_exceeded} exceeded · ${kpi.budgets_at_risk} at risk`
            : 'No budgets configured'}
          accent={kpi.budgets_exceeded > 0 ? '#854d0e' : undefined}
        />
        <KPICard
          label="Savings Found" icon={Zap} color="#22c55e"
          value={fmtUsd(kpi.savings_identified_usd)}
          sub="RI · rightsize · waste"
        />
        <KPICard
          label="RI Coverage" icon={Shield} color="#06b6d4"
          value={kpi.has_reservations ? fmtPct(kpi.ri_coverage_pct) : '—'}
          sub={kpi.has_reservations
            ? `Utilization: ${fmtPct(kpi.ri_utilization_pct)}`
            : 'No reservations purchased'}
        />
        <KPICard
          label="Tag Compliance" icon={Tag} color="#10b981"
          value={fmtPct(kpi.tagging_compliance_pct)}
          sub={(kpi.total_untagged ?? 0) > 0
            ? `${kpi.total_untagged} resource${kpi.total_untagged === 1 ? '' : 's'} untagged`
            : 'Required tags coverage'}
          accent={kpi.tagging_compliance_pct < 60 ? '#854d0e' : undefined}
        />
      </div>

      {/* ── Charts row: Trend + Breakdown Bar ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>

        {/* Spend trend with real dates */}
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16, position: 'relative' }}>
          {chartLoading && (
            <div style={{ position: 'absolute', top: 8, right: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={10} className="animate-spin" style={{ color: '#3b82f6' }} />
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600 }}>
              Spend Trend — {TIME_LABELS[timeRange] || timeRange} (USD)
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ color: 'var(--c-475569)', fontSize: 10, alignSelf: 'center' }}>
                Total: {fmtUsd(trendTotal, 0)}
              </span>
              <button onClick={() => setAccumulated(a => !a)} style={{
                background: accumulated ? 'var(--c-1e3a5f)' : 'var(--c-1e293b)',
                border: `1px solid ${accumulated ? '#1d4ed8' : 'var(--c-334155)'}`,
                borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
                color: accumulated ? '#93c5fd' : 'var(--c-64748b)', fontSize: 11,
              }}>∑ Cumulative</button>
            </div>
          </div>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={<DateTick />} interval={Math.max(1, Math.floor(trendData.length / 6))} />
                <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0))} width={52} />
                <Tooltip
                  contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }}
                  formatter={v => [fmtUsd(v, 2), accumulated ? 'Cumulative' : 'Daily Spend']}
                  labelFormatter={d => `Date: ${d}`}
                />
                <Area type="monotone" dataKey="cost" stroke="#3b82f6" fill="url(#spendGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-334155)', fontSize: 12 }}>
              No trend data available for selected filters
            </div>
          )}
        </div>

        {/* Breakdown bar chart */}
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16, position: 'relative' }}>
          {chartLoading && (
            <div style={{ position: 'absolute', top: 8, right: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <RefreshCw size={10} className="animate-spin" style={{ color: '#3b82f6' }} />
            </div>
          )}
          <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
            Cost by {dimLabel}
          </div>
          {breakdownData.length > 0 ? (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={breakdownData} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#475569', fontSize: 9 }} tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0))} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} width={100} />
                <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }} formatter={v => [fmtUsd(v, 2), 'Cost']} />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]} maxBarSize={22}>
                  {breakdownData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-334155)', fontSize: 12 }}>
              No breakdown data available
            </div>
          )}
        </div>
      </div>

      {/* ── Pie chart + Health metrics row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Pie / donut chart for cost distribution */}
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
            Cost Distribution — {dimLabel}
          </div>
          {breakdownData.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <ResponsiveContainer width="55%" height={200}>
                <PieChart>
                  <Pie
                    data={breakdownData}
                    dataKey="cost"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={80}
                    strokeWidth={1}
                    stroke="#0f172a"
                    label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) =>
                      PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, pct: percent * 100 })
                    }
                    labelLine={false}
                  >
                    {breakdownData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }} formatter={v => fmtUsd(v, 2)} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
                {breakdownData.slice(0, 6).map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                    <span style={{ color: 'var(--c-94a3b8)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span style={{ color: 'var(--c-e2e8f0)', fontWeight: 600, flexShrink: 0 }}>{fmtUsd(d.cost)}</span>
                  </div>
                ))}
                {breakdownData.length > 6 && (
                  <span style={{ color: 'var(--c-475569)', fontSize: 10 }}>+{breakdownData.length - 6} more</span>
                )}
              </div>
            </div>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-334155)', fontSize: 12 }}>
              No data available
            </div>
          )}
        </div>

        {/* Health metrics */}
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600, marginBottom: 14 }}>FinOps Health Metrics</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <HealthBar label="Budget Utilization"
              pct={kpi.budget_utilization_pct}
              color={kpi.budgets_exceeded > 0 ? '#ef4444' : kpi.budget_utilization_pct > 75 ? '#f97316' : '#3b82f6'} />
            <HealthBar label="RI Coverage"
              pct={kpi.ri_coverage_pct}
              color={kpi.ri_coverage_pct < 50 ? '#ef4444' : kpi.ri_coverage_pct < 75 ? '#f59e0b' : '#22c55e'} />
            <HealthBar label="RI Utilization"
              pct={kpi.ri_utilization_pct}
              color={kpi.ri_utilization_pct < 60 ? '#ef4444' : kpi.ri_utilization_pct < 80 ? '#f59e0b' : '#22c55e'} />
            <HealthBar label="Tag Compliance"
              pct={kpi.tagging_compliance_pct}
              color={kpi.tagging_compliance_pct < 60 ? '#ef4444' : kpi.tagging_compliance_pct < 80 ? '#f59e0b' : '#22c55e'} />
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--c-334155)' }}>
        <span>Source: {kpi.data_source} · All figures in USD</span>
        <span>
          MoM: {kpi.mom_delta_usd >= 0 ? '+' : ''}{fmtUsd(kpi.mom_delta_usd, 2)} ({kpi.mom_delta_pct >= 0 ? '+' : ''}{kpi.mom_delta_pct}%)
        </span>
      </div>

    </div>
  )
}
