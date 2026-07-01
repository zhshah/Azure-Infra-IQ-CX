/**
 * FinOps Warehouse Dashboard
 *
 * Offline-first enterprise FinOps dashboard — all data served from Azure SQL.
 * No live Azure API calls, no throttling, instant page loads.
 *
 * Features:
 * - Data freshness banner with last-updated timestamp and refresh button
 * - KPI row: MTD total, MoM change, anomaly count, critical alerts
 * - Daily spend trend area chart (30 / 60 / 90 day toggle)
 * - Subscription breakdown pie chart
 * - Top 10 costliest resources with sortable table
 * - Cost by service family horizontal bar chart
 * - Cost by tag (Environment / BusinessUnit / Project selector)
 * - Monthly service trend stacked bar chart (last 6 months)
 * - Anomaly alerts card list with severity badges
 * - Filters: subscription, resource group, days range
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts'
import {
  AlertTriangle, RefreshCw, Database, TrendingUp, TrendingDown,
  DollarSign, Zap, Shield, Clock, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle,
} from 'lucide-react'
import {
  getWarehouseStatus, getWarehouseDashboard, getWarehouseResources,
  getWarehouseAnomalies, triggerWarehouseETL,
  fmtUsd, fmtPct, ageLabel, severityColor, serviceColor, CHART_PALETTE,
} from './FinOpsWarehouseAPI'
import FinOpsAIPanel from './FinOpsAIPanel'

// ── Design tokens (consistent with rest of app) ───────────────────────────────
const C = {
  bg:        'var(--c-0a0f1e)',
  surface:   'var(--c-111827)',
  border:    'var(--c-1e293b)',
  accent:    '#3b82f6',
  text:      'var(--c-f1f5f9)',
  muted:     'var(--c-64748b)',
  green:     '#10b981',
  red:       '#ef4444',
  orange:    '#f97316',
  yellow:    '#f59e0b',
}

// ── Reusable UI primitives ───────────────────────────────────────────────────

function Card({ children, style }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: '16px 20px', ...style,
    }}>
      {children}
    </div>
  )
}

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <h3 style={{ margin: 0, color: C.text, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {children}
      </h3>
      {right}
    </div>
  )
}

function KPICard({ label, value, sub, icon: Icon, color, trend }) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: C.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
            {label}
          </div>
          <div style={{ color: C.text, fontSize: 24, fontWeight: 700 }}>{value}</div>
          {sub && <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{sub}</div>}
        </div>
        {Icon && (
          <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color || C.accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={18} color={color || C.accent} />
          </div>
        )}
      </div>
      {trend !== undefined && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
          {trend > 0
            ? <TrendingUp size={12} color={C.red} />
            : <TrendingDown size={12} color={C.green} />}
          <span style={{ fontSize: 11, color: trend > 0 ? C.red : C.green, fontWeight: 600 }}>
            {fmtPct(trend)} vs last month
          </span>
        </div>
      )}
    </Card>
  )
}

function SeverityBadge({ severity }) {
  const color = severityColor(severity)
  return (
    <span style={{
      background: `${color}22`, color, border: `1px solid ${color}44`,
      borderRadius: 5, padding: '2px 8px', fontSize: 10, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.5px',
    }}>
      {severity}
    </span>
  )
}

function Spinner() {
  return <div style={{ display: 'inline-block', width: 14, height: 14, border: `2px solid ${C.border}`, borderTop: `2px solid ${C.accent}`, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
}

function EmptyState({ message, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: C.muted }}>
      <Database size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{message}</div>
      {sub && <div style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  )
}

// ── Custom chart elements ─────────────────────────────────────────────────────

function DateTick({ x, y, payload }) {
  const label = payload?.value ? String(payload.value).slice(5) : ''
  return <text x={x} y={y + 12} fill={C.muted} fontSize={9} textAnchor="middle">{label}</text>
}

function CostTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--c-0f172a)', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: C.muted, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>{fmtUsd(p.value)}</strong>
        </div>
      ))}
    </div>
  )
}

// ── Filters bar ───────────────────────────────────────────────────────────────

function FiltersBar({ filters, onChange, subscriptions }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
      {/* Days range */}
      <div style={{ display: 'flex', gap: 4 }}>
        {[7, 14, 30, 60, 90].map(d => (
          <button
            key={d}
            onClick={() => onChange({ ...filters, days: d })}
            style={{
              padding: '5px 12px', borderRadius: 6, border: `1px solid ${filters.days === d ? C.accent : C.border}`,
              background: filters.days === d ? `${C.accent}22` : 'transparent',
              color: filters.days === d ? C.accent : C.muted,
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Subscription */}
      {subscriptions?.length > 0 && (
        <select
          value={filters.subscription_id || ''}
          onChange={e => onChange({ ...filters, subscription_id: e.target.value || undefined })}
          style={{
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
            color: C.text, padding: '5px 10px', fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="">All Subscriptions</option>
          {subscriptions.map(s => (
            <option key={s.id || s} value={s.id || s}>{s.name || s.id || s}</option>
          ))}
        </select>
      )}
    </div>
  )
}

// ── Anomaly list ──────────────────────────────────────────────────────────────

function AnomalyList({ anomalies }) {
  if (!anomalies?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '20px', color: C.muted, fontSize: 12 }}>
        <CheckCircle size={20} style={{ marginBottom: 6, color: C.green }} />
        <div>No open anomalies detected</div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
      {anomalies.map(a => (
        <div key={a.anomaly_id} style={{
          background: 'var(--c-0f172a)', border: `1px solid ${severityColor(a.severity)}33`,
          borderLeft: `3px solid ${severityColor(a.severity)}`,
          borderRadius: 8, padding: '10px 14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>
              {a.resource_name || a.resource_group || 'Unknown resource'}
            </span>
            <SeverityBadge severity={a.severity} />
          </div>
          <div style={{ color: C.muted, fontSize: 11, display: 'flex', gap: 16 }}>
            <span>{a.resource_type?.split('/').pop() || a.resource_type}</span>
            <span>Spike: <strong style={{ color: C.orange }}>+{a.spike_pct?.toFixed(0)}%</strong></span>
            <span>Latest: <strong style={{ color: C.text }}>{fmtUsd(a.cost_latest)}</strong></span>
            <span>7d avg: {fmtUsd(a.cost_7d_avg)}</span>
            <span>{a.detected_date}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Resource table ────────────────────────────────────────────────────────────

function ResourceTable({ items, total, page, totalPages, onPageChange, onSort, sortBy, sortDir, loading }) {
  const Th = ({ col, children }) => (
    <th
      onClick={() => onSort(col)}
      style={{
        padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
        color: sortBy === col ? C.accent : C.muted, textTransform: 'uppercase',
        letterSpacing: '0.5px', cursor: 'pointer', userSelect: 'none',
        borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
      }}
    >
      {children}
      {sortBy === col && (sortDir === 'desc' ? ' ↓' : ' ↑')}
    </th>
  )

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--c-0f172a)' }}>
              <Th col="name">Resource</Th>
              <Th col="group">Resource Group</Th>
              <th style={{ padding: '10px 12px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>Type</th>
              <th style={{ padding: '10px 12px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>Service</th>
              <th style={{ padding: '10px 12px', color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>Location</th>
              <Th col="cost">Total Cost</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: C.muted }}>Loading…</td></tr>
            ) : !items?.length ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: C.muted }}>No resources found</td></tr>
            ) : items.map((r, i) => (
              <tr key={r.resource_id || i} style={{ borderBottom: `1px solid ${C.border}22`, ':hover': { background: '#ffffff08' } }}>
                <td style={{ padding: '9px 12px', color: C.text, fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.resource_name || r.resource_id?.split('/').pop() || '—'}
                </td>
                <td style={{ padding: '9px 12px', color: C.muted }}>{r.resource_group || '—'}</td>
                <td style={{ padding: '9px 12px', color: C.muted, fontSize: 11 }}>{r.resource_type?.split('/').pop() || '—'}</td>
                <td style={{ padding: '9px 12px', color: C.muted, fontSize: 11 }}>{r.service_family || '—'}</td>
                <td style={{ padding: '9px 12px', color: C.muted, fontSize: 11 }}>{r.location || '—'}</td>
                <td style={{ padding: '9px 12px', color: C.text, fontWeight: 700, textAlign: 'right' }}>
                  {fmtUsd(r.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, padding: '0 4px' }}>
          <span style={{ fontSize: 11, color: C.muted }}>{total} total resources</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.border}`, background: 'transparent', color: page <= 1 ? C.muted : C.text, cursor: page <= 1 ? 'not-allowed' : 'pointer', fontSize: 12 }}
            >
              ← Prev
            </button>
            <span style={{ padding: '4px 8px', fontSize: 12, color: C.muted }}>{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.border}`, background: 'transparent', color: page >= totalPages ? C.muted : C.text, cursor: page >= totalPages ? 'not-allowed' : 'pointer', fontSize: 12 }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function FinOpsWarehouse() {
  const [status, setStatus] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [resources, setResources] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingResources, setLoadingResources] = useState(false)
  // Auto-refresh: data collects automatically every 12h — no manual trigger needed
  const [error, setError] = useState(null)
  const [tagKey, setTagKey] = useState('Environment')
  const [filters, setFilters] = useState({ days: 30 })
  const [resourcePage, setResourcePage] = useState(1)
  const [sortBy, setSortBy] = useState('cost')
  const [sortDir, setSortDir] = useState('desc')
  const [expandedSection, setExpandedSection] = useState(null)
  const refreshTimer = useRef(null)

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getWarehouseStatus()
      setStatus(s)
      return s
    } catch (e) {
      console.error('Warehouse status error:', e)
      return null
    }
  }, [])

  const fetchDashboard = useCallback(async (f = filters) => {
    setLoading(true)
    setError(null)
    try {
      const [stat, dash] = await Promise.all([
        getWarehouseStatus(),
        getWarehouseDashboard(f),
      ])
      setStatus(stat)
      if (dash.error) {
        setError(dash.error)
      } else {
        setDashboard(dash)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters])

  const fetchResources = useCallback(async (page = 1, sb = sortBy, sd = sortDir) => {
    setLoadingResources(true)
    try {
      const res = await getWarehouseResources({
        ...filters, page, page_size: 50, sort_by: sb, sort_dir: sd,
      })
      setResources(res)
    } catch (e) {
      console.error('Warehouse resources error:', e)
    } finally {
      setLoadingResources(false)
    }
  }, [filters, sortBy, sortDir])

  useEffect(() => {
    fetchDashboard(filters)
    fetchResources(1, sortBy, sortDir)
    // Poll status every 15s when ETL might be running
    refreshTimer.current = setInterval(async () => {
      const s = await fetchStatus()
      if (s?.etl_running) fetchDashboard(filters)
    }, 15000)
    return () => clearInterval(refreshTimer.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters)
    setResourcePage(1)
    fetchDashboard(newFilters)
    fetchResources(1, sortBy, sortDir)
  }

  const handleSort = (col) => {
    const newDir = col === sortBy && sortDir === 'desc' ? 'asc' : 'desc'
    setSortBy(col)
    setSortDir(newDir)
    fetchResources(resourcePage, col, newDir)
  }

  const handlePageChange = (page) => {
    setResourcePage(page)
    fetchResources(page, sortBy, sortDir)
  }

  // Data refreshes automatically every 12 hours in the background

  // ── Derived data ──────────────────────────────────────────────────────────

  const kpis = dashboard?.kpis || {}
  const dailyTrend = dashboard?.daily_trend || []
  const bySubscription = dashboard?.by_subscription || []
  const byService = dashboard?.by_service?.slice(0, 12) || []
  const topResources = dashboard?.top_resources || []
  const anomalies = dashboard?.anomalies || []
  const monthlyServiceTrend = dashboard?.monthly_service_trend || []
  const byEnvironment = dashboard?.by_environment || []
  const freshness = dashboard?.data_freshness || status || {}

  // Build subscriptions list for filter
  const subscriptions = bySubscription.map(s => ({ id: s.subscription_id, name: s.subscription_id }))

  // Get unique service families for monthly stacked chart
  const svcFamilies = [...new Set(monthlyServiceTrend.flatMap(m => Object.keys(m).filter(k => k !== 'month')))].slice(0, 8)

  // Tag chart: pivot tag data from dashboard
  const envData = byEnvironment.map(e => ({ name: e.environment || 'untagged', cost: e.cost }))

  const isNeverRun = freshness.status === 'never_run'
  const isRunning = freshness.etl_running || freshness.status === 'running'
  const hasData = !!(dashboard && (dailyTrend.length > 0 || topResources.length > 0))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: C.bg, minHeight: '100%', padding: '20px 24px', fontFamily: 'system-ui, sans-serif', color: C.text }}>

      <div style={{ marginBottom: 16 }}>
        <FinOpsAIPanel view="warehouse" data={hasData ? { kpis, by_service: byService.slice(0, 10), by_subscription: bySubscription.slice(0, 8), top_resources: topResources.slice(0, 8), anomaly_count: anomalies.length, anomalies: anomalies.slice(0, 5) } : {}} />
      </div>

      {/* ── Freshness Banner ─────────────────────────────────────────── */}
      <div style={{
        background: isNeverRun ? 'var(--c-1c1a0a)' : isRunning ? 'var(--c-0a1a2e)' : freshness.data_age_hours > 26 ? 'var(--c-1c100a)' : 'var(--c-0a1a0e)',
        border: `1px solid ${isNeverRun ? 'var(--c-5c4700)' : isRunning ? C.accent : freshness.data_age_hours > 26 ? 'var(--c-7c3a00)' : 'var(--c-166534)'}`,
        borderRadius: 10, padding: '12px 20px', marginBottom: 20,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Database size={18} color={isRunning ? C.accent : freshness.data_age_hours > 26 ? C.orange : C.green} />
          <div>
            {isNeverRun ? (
              <span style={{ color: C.yellow, fontWeight: 600, fontSize: 13 }}>
                First data collection in progress — automatically refreshes every 12 hours
              </span>
            ) : isRunning ? (
              <span style={{ color: C.accent, fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Spinner /> Refreshing cost data in background…
              </span>
            ) : (
              <span style={{ fontSize: 13 }}>
                <span style={{ color: C.text, fontWeight: 600 }}>Data as of </span>
                <span style={{ color: C.accent }}>{freshness.completed_at ? new Date(freshness.completed_at).toLocaleString() : 'unknown'}</span>
                <span style={{ color: C.muted, fontSize: 11, marginLeft: 8 }}>({ageLabel(freshness.data_age_hours)})</span>
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!isRunning && freshness.completed_at && (
            <span style={{ fontSize: 11, color: C.muted }}>
              Next refresh ~{Math.max(0, (12 - (freshness.data_age_hours || 0))).toFixed(0)}h
            </span>
          )}
          <button
            onClick={() => fetchDashboard(filters)}
            style={{
              padding: '6px 10px', borderRadius: 7, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.muted, cursor: 'pointer', fontSize: 12,
            }}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* ── Error state ───────────────────────────────────────────────── */}
      {error && (
        <div style={{ background: 'var(--c-2a0a0a)', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: C.red, fontSize: 13 }}>
          <AlertCircle size={14} style={{ marginRight: 8 }} /> {error}
        </div>
      )}

      {/* ── Filters ───────────────────────────────────────────────────── */}
      <FiltersBar filters={filters} onChange={handleFilterChange} subscriptions={subscriptions} />

      {/* ── KPI Cards ─────────────────────────────────────────────────── */}
      {loading && !dashboard ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <Card key={i} style={{ height: 90, background: 'var(--c-0f172a)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
          <KPICard
            label="MTD Spend"
            value={fmtUsd(kpis.total_mtd, true)}
            sub={`${filters.days}d: ${fmtUsd(kpis.total_30d, true)}`}
            icon={DollarSign}
            color={C.accent}
            trend={kpis.mom_pct}
          />
          <KPICard
            label="vs Last Month"
            value={fmtPct(kpis.mom_pct)}
            sub={`${kpis.mom_delta > 0 ? '+' : ''}${fmtUsd(kpis.mom_delta, true)} MoM`}
            icon={kpis.mom_delta > 0 ? TrendingUp : TrendingDown}
            color={kpis.mom_delta > 0 ? C.red : C.green}
          />
          <KPICard
            label="Open Anomalies"
            value={kpis.anomaly_count || 0}
            sub={kpis.critical_anomalies ? `${kpis.critical_anomalies} critical` : 'None critical'}
            icon={AlertTriangle}
            color={kpis.critical_anomalies > 0 ? C.red : kpis.anomaly_count > 0 ? C.orange : C.green}
          />
          <KPICard
            label="Top Resources"
            value={topResources.length}
            sub="tracked this period"
            icon={Zap}
            color={C.yellow}
          />
          <KPICard
            label="Services Tracked"
            value={byService.length}
            sub="service families"
            icon={Shield}
            color="#8b5cf6"
          />
        </div>
      )}

      {!hasData && !loading && !isRunning && !isNeverRun && (
        <EmptyState
          message="No cost data in warehouse"
          sub="Data is collected automatically every 12 hours. First collection runs on startup."
        />
      )}

      {hasData && (
        <>
          {/* ── Row 1: Trend + Subscription Breakdown ─────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>

            {/* Daily Spend Trend */}
            <Card>
              <SectionTitle>Daily Spend Trend</SectionTitle>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={dailyTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="wh_cost_grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.accent} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="date" tick={<DateTick />} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={v => fmtUsd(v, true)}
                    axisLine={false} tickLine={false}
                    tick={{ fill: C.muted, fontSize: 9 }}
                    width={55}
                  />
                  <Tooltip content={<CostTooltip />} />
                  <Area
                    type="monotone" dataKey="cost" name="Daily Cost"
                    stroke={C.accent} fill="url(#wh_cost_grad)" strokeWidth={2} dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* Subscription Pie */}
            <Card>
              <SectionTitle>By Subscription</SectionTitle>
              {bySubscription.length === 0 ? (
                <EmptyState message="No subscription data" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={bySubscription}
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={80}
                      dataKey="cost"
                      nameKey="subscription_id"
                      paddingAngle={2}
                    >
                      {bySubscription.map((_, i) => (
                        <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [fmtUsd(v), 'Cost']} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* ── Row 2: Service Family + Tag Breakdown ─────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

            {/* Cost by Service Family */}
            <Card>
              <SectionTitle>Cost by Service Family</SectionTitle>
              {byService.length === 0 ? (
                <EmptyState message="No service data" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={byService}
                    layout="vertical"
                    margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                    <XAxis
                      type="number"
                      tickFormatter={v => fmtUsd(v, true)}
                      axisLine={false} tickLine={false}
                      tick={{ fill: C.muted, fontSize: 9 }}
                    />
                    <YAxis
                      type="category" dataKey="service_family"
                      width={100} axisLine={false} tickLine={false}
                      tick={{ fill: C.muted, fontSize: 10 }}
                    />
                    <Tooltip formatter={(v) => [fmtUsd(v), 'Cost']} contentStyle={{ background: 'var(--c-0f172a)', border: `1px solid ${C.border}` }} />
                    <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                      {byService.map((entry, i) => (
                        <Cell key={i} fill={serviceColor(entry.service_family)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Cost by Tag */}
            <Card>
              <SectionTitle
                right={
                  <select
                    value={tagKey}
                    onChange={e => setTagKey(e.target.value)}
                    style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '3px 8px', fontSize: 11 }}
                  >
                    {['Environment', 'BusinessUnit', 'Project', 'Application', 'CostCenter'].map(k => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                }
              >
                Cost by Tag: {tagKey}
              </SectionTitle>
              {envData.length === 0 ? (
                <EmptyState message="No tag data" sub="Tags may not be applied to resources" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={envData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis
                      dataKey="name" axisLine={false} tickLine={false}
                      tick={{ fill: C.muted, fontSize: 10 }}
                    />
                    <YAxis
                      tickFormatter={v => fmtUsd(v, true)}
                      axisLine={false} tickLine={false}
                      tick={{ fill: C.muted, fontSize: 9 }}
                      width={50}
                    />
                    <Tooltip formatter={(v) => [fmtUsd(v), 'Cost']} contentStyle={{ background: 'var(--c-0f172a)', border: `1px solid ${C.border}` }} />
                    <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                      {envData.map((_, i) => (
                        <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* ── Row 3: Monthly Service Trend ─────────────────────────── */}
          {monthlyServiceTrend.length > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <SectionTitle>Monthly Spend by Service (Last 6 Months)</SectionTitle>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyServiceTrend} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: C.muted, fontSize: 10 }} />
                  <YAxis
                    tickFormatter={v => fmtUsd(v, true)}
                    axisLine={false} tickLine={false}
                    tick={{ fill: C.muted, fontSize: 9 }}
                    width={55}
                  />
                  <Tooltip
                    formatter={(v, n) => [fmtUsd(v), n]}
                    contentStyle={{ background: 'var(--c-0f172a)', border: `1px solid ${C.border}` }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: C.muted }} />
                  {svcFamilies.map((svc, i) => (
                    <Bar key={svc} dataKey={svc} stackId="a" fill={serviceColor(svc)} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* ── Row 4: Anomaly Alerts ─────────────────────────────────── */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle>
              Cost Anomalies
              {anomalies.length > 0 && (
                <span style={{ marginLeft: 8, background: `${C.orange}22`, color: C.orange, border: `1px solid ${C.orange}44`, borderRadius: 12, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>
                  {anomalies.length} open
                </span>
              )}
            </SectionTitle>
            <AnomalyList anomalies={anomalies} />
          </Card>

          {/* ── Row 5: Top Resources Table ────────────────────────────── */}
          <Card>
            <SectionTitle>
              All Resources by Cost
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>
                {filters.days}d window • {resources?.total || 0} resources
              </span>
            </SectionTitle>
            <ResourceTable
              items={resources?.items}
              total={resources?.total || 0}
              page={resourcePage}
              totalPages={resources?.total_pages || 1}
              onPageChange={handlePageChange}
              onSort={handleSort}
              sortBy={sortBy}
              sortDir={sortDir}
              loading={loadingResources}
            />
          </Card>
        </>
      )}

      {/* Inline keyframes */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  )
}
