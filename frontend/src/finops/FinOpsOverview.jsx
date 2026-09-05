/**
 * FinOps Overview — Unified Single-Page Dashboard
 * Combines: KPIs, spend trend (with cumulative toggle), forecast,
 * RI utilization, Advisor cost recommendations, resource optimization,
 * top savings opportunities, and budget alerts.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { asText } from '../utils/safeText'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  DollarSign, TrendingUp, Shield, Zap, Tag, AlertTriangle,
  RefreshCw, AlertCircle, Download, ChevronRight, TrendingDown, Filter, X,
} from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct, CHART_COLORS, drillToExplorer, getSubscriptions, getFilterOptions, TIME_RANGE_OPTIONS } from './finopsApi'
import { OverviewSkeleton } from './FinOpsSkeleton'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'
import SearchableSelect from '../components/shared/SearchableSelect'
import { useDrill } from '../drill/DrillContext'

/* ── helpers ── */
const fmtDate = d => (d ? d.slice(5) : '')   // "MM-DD" from "YYYY-MM-DD"

/* ── KPI Card ── */
function KPICard({ label, value, sub, icon: Icon, color = '#3b82f6', accent }) {
  return (
    <div style={{
      background: 'var(--c-111827)', border: `1px solid ${accent || 'var(--c-1e293b)'}`,
      borderRadius: 10, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
        {Icon && <Icon size={15} style={{ color }} />}
      </div>
      <div style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>{sub}</div>}
    </div>
  )
}

/* ── Section Header ── */
function SectionHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700 }}>{title}</div>
      {sub && <div style={{ color: 'var(--c-475569)', fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

/* ── Mini loading spinner ── */
function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', color: 'var(--c-475569)', fontSize: 12 }}>
      <RefreshCw size={14} className="animate-spin" style={{ color: '#3b82f6' }} /> Loading…
    </div>
  )
}

/* ── Impact badge ── */
const IMPACT_COLOR = { High: '#ef4444', Medium: '#f59e0b', Low: 'var(--c-94a3b8)' }
function ImpactBadge({ impact }) {
  return (
    <span style={{
      background: IMPACT_COLOR[impact] + '22', color: IMPACT_COLOR[impact] || 'var(--c-94a3b8)',
      borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600,
    }}>{impact || '—'}</span>
  )
}

/* ═══════════════════════════════════════════════════════════════ */
export default function FinOpsOverview() {
  const { openResourceDetail } = useDrill()
  const [kpi,          setKpi]          = useState(null)
  const [metrics,      setMetrics]      = useState(null)   // Metrics Service — single source of truth
  const [forecast,     setForecast]     = useState(null)
  const [savings,      setSavings]      = useState(null)
  const [advisor,      setAdvisor]      = useState(null)
  const [optim,        setOptim]        = useState(null)
  const [commitments,  setCommitments]  = useState(null)
  const [alerts,       setAlerts]       = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [accumulated,  setAccumulated]  = useState(false)
  const [optimTab,     setOptimTab]     = useState('oversized')   // oversized | underutilized | orphaned
  const [optimQuery,   setOptimQuery]   = useState('')
  const [optimSort,    setOptimSort]    = useState({ key: 'cost', dir: 'desc' })
  const [savingsQuery, setSavingsQuery] = useState('')
  const [savingsSort,  setSavingsSort]  = useState({ key: 'potential_savings_usd', dir: 'desc' })
  const [downloading,  setDownloading]  = useState(false)
  const [downloadErr,  setDownloadErr]  = useState(null)
  const [liveRefreshing, setLiveRefreshing] = useState(false)
  const [snapAsOf,     setSnapAsOf]     = useState(null)
  const [showAllAlerts, setShowAllAlerts] = useState(false)
  const [horizon,      setHorizon]      = useState(90)
  const [scopeSub,     setScopeSub]     = useState('')
  const [scopeRG,      setScopeRG]      = useState('')
  const [scopeTime,    setScopeTime]    = useState('last_30d')
  const [scoped,       setScoped]       = useState(null)
  const [scopeLoading, setScopeLoading] = useState(false)
  const [insights,     setInsights]     = useState(null)
  const [subOpts,      setSubOpts]      = useState([])
  const [rgOpts,       setRgOpts]       = useState([])

  const handleDownload = async () => {
    setDownloading(true); setDownloadErr(null)
    try { await finopsApi.downloadReport() }
    catch (e) { setDownloadErr(e.message) }
    finally { setDownloading(false) }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Fast path: load critical KPIs, advisor, and optimization first
      const [k, adv, op] = await Promise.all([
        finopsApi.getSummary(),
        finopsApi.getAdvisorCost().catch(() => null),
        finopsApi.getResourceOptimization().catch(() => null),
      ])
      setKpi(k); setAdvisor(adv); setOptim(op)
      setLoading(false)  // render immediately with fast data
      // Metrics Service (single source of truth) — non-blocking; cards fall back
      // to the legacy summary until it lands.
      finopsApi.getMetrics().then(setMetrics).catch(() => {})

      // Slow path: load remaining sections in background (don't block UI).
      // Forecast is loaded by its own effect (depends on the selected horizon).
      finopsApi.getSavings().then(sv => setSavings(sv)).catch(() => {})
      finopsApi.getCommitments().then(cm => setCommitments(cm)).catch(() => {})
      finopsApi.getBudgetAlerts().then(al => setAlerts(al)).catch(() => {})
      finopsApi.getCostInsights().then(setInsights).catch(() => {})
    } catch (e) { setError(e.message); setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Forecast follows the selected horizon (30/60/90/180/365 days).
  useEffect(() => { finopsApi.getForecast(horizon).then(f => setForecast(f)).catch(() => {}) }, [horizon])

  // Scope-filter option sources (subscriptions + resource groups).
  useEffect(() => {
    getSubscriptions().then(subs => setSubOpts((subs || []).map(s => ({ value: s.subscription_id, label: s.subscription_name || s.subscription_id })))).catch(() => {})
    getFilterOptions().then(o => setRgOpts((o.resource_groups || []).map(rg => (typeof rg === 'string' ? { value: rg, label: rg } : { value: rg.value, label: rg.label ?? rg.value })))).catch(() => {})
  }, [])

  // Re-scope the spend trend to the selected subscription / resource group / time range.
  useEffect(() => {
    const active = !!(scopeSub || scopeRG || scopeTime !== 'last_30d')
    if (!active) { setScoped(null); return }
    let cancelled = false
    setScopeLoading(true)
    finopsApi.getDashboardData({ subscription_id: scopeSub || undefined, resource_group: scopeRG || undefined, time_range: scopeTime, group_by: 'ServiceName' })
      .then(d => { if (!cancelled) setScoped(d) })
      .catch(() => { if (!cancelled) setScoped(null) })
      .finally(() => { if (!cancelled) setScopeLoading(false) })
    return () => { cancelled = true }
  }, [scopeSub, scopeRG, scopeTime])

  /* ── Cost snapshot "as of" indicator ── */
  const loadSnapStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/finops/cost-snapshot/status')
      if (r.ok) {
        const j = await r.json()
        setSnapAsOf(j.captured_at || j.last_run || null)
      }
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { loadSnapStatus() }, [loadSnapStatus])

  const liveRefreshCancelRef = useRef(false)

  /* ── Refresh live: trigger a fresh cost-bundle capture, then reload ── */
  const refreshLive = useCallback(async () => {
    // Cancel any in-flight refresh
    liveRefreshCancelRef.current = true
    liveRefreshCancelRef.current = false
    setLiveRefreshing(true)
    const cancelled = () => liveRefreshCancelRef.current
    try {
      await fetch('/api/finops/cost-snapshot/refresh', { method: 'POST' })
      // Poll status until the capture finishes (cap ~90s)
      for (let i = 0; i < 30; i++) {
        if (cancelled()) break
        await new Promise(res => setTimeout(res, 3000))
        if (cancelled()) break
        try {
          const r = await fetch('/api/finops/cost-snapshot/status')
          if (r.ok) {
            const j = await r.json()
            if (!j.running) { setSnapAsOf(j.captured_at || j.last_run || null); break }
          }
        } catch { /* keep polling */ }
      }
      if (!cancelled()) await load()
    } finally {
      if (!cancelled()) setLiveRefreshing(false)
    }
  }, [load])

  // Cancel in-flight refresh on unmount
  useEffect(() => () => { liveRefreshCancelRef.current = true }, [])


  /* ── Trend data with optional cumulative ── */
  const trendData = useMemo(() => {
    let raw
    if (scoped && Array.isArray(scoped.trend) && scoped.trend.length) {
      raw = scoped.trend.map(p => ({ date: p.date, cost: p.cost ?? 0 }))
    } else {
      const dates = kpi?.cost_trend_dates || []
      const costs = kpi?.cost_trend_30d   || []
      raw = dates.map((d, i) => ({ date: d, cost: costs[i] ?? 0 }))
    }
    if (!accumulated) return raw
    return raw.reduce((acc, pt, i) => {
      acc.push({ date: pt.date, cost: (acc[i - 1]?.cost ?? 0) + (pt.cost ?? 0) })
      return acc
    }, [])
  }, [kpi, accumulated, scoped])

  /* ── Forecast chart data (history = actual, forecast = projected) ── */
  const fcastData = useMemo(() => ([
    ...((forecast?.history) || []).map(p => ({ date: p.date, actual: p.cost_usd })),
    ...((forecast?.forecast) || []).map(p => ({ date: p.date, projected: p.cost_usd })),
  ]), [forecast])

  /* ── RI health bars ── */
  const riCoverage    = kpi?.ri_coverage_pct    ?? 0
  const riUtilization = kpi?.ri_utilization_pct ?? 0
  const budgetUtil    = kpi?.budget_utilization_pct ?? 0
  const tagCompliance = kpi?.tagging_compliance_pct ?? 0

  function HealthBar({ label, pct, color }) {
    const c = color || (pct >= 90 ? '#ef4444' : pct >= 70 ? '#f97316' : '#22c55e')
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ color: 'var(--c-94a3b8)', fontSize: 11 }}>{label}</span>
          <span style={{ color: c, fontSize: 11, fontWeight: 700 }}>{fmtPct(pct)}</span>
        </div>
        <div style={{ height: 5, background: 'var(--c-1e293b)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: c, borderRadius: 4, transition: 'width 0.6s' }} />
        </div>
      </div>
    )
  }

  /* ── Render ── */
  if (loading) return <OverviewSkeleton />

  if (error) return (
    <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 10, padding: 20, color: 'var(--c-fca5a5)', display: 'flex', gap: 10 }}>
      <AlertCircle size={18} />
      <div>
        <div style={{ fontWeight: 600 }}>Failed to load overview</div>
        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{error}</div>
        <button onClick={load} style={{ marginTop: 10, fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>↺ Retry</button>
      </div>
    </div>
  )

  // Projected month-over-month = projected end-of-month vs the FULL last month (a like-for-like
  // comparison; raw MTD-vs-last-month % is misleading early in the month).
  const _lastMo  = kpi?.total_spend_last_month ?? 0
  const _projMoM = _lastMo > 0 ? (((kpi?.forecast_eom_usd ?? 0) - _lastMo) / _lastMo) * 100 : 0
  const momColor = _projMoM >= 0 ? '#ef4444' : '#22c55e'
  const momArrow = _projMoM >= 0 ? '↑' : '↓'
  const scopeActive = !!(scopeSub || scopeRG || scopeTime !== 'last_30d')
  const advisorItems  = advisor?.items || []
  const optimOversized    = optim?.oversized    || []
  const optimUnderutilized = optim?.underutilized || []
  const optimOrphaned  = optim?.orphaned    || []
  // Land on a tab that actually has findings. "Oversized" is empty whenever no VM
  // carries a rightsizing recommendation (e.g. a fleet that is powered off), which
  // made the whole panel look broken even with 39 idle resources one click away.
  const optimCounts = { oversized: optimOversized.length, underutilized: optimUnderutilized.length, orphaned: optimOrphaned.length }
  const activeOptimTab = optimCounts[optimTab] > 0
    ? optimTab
    : (['oversized', 'underutilized', 'orphaned'].find(k => optimCounts[k] > 0) || optimTab)

  // The three tabs come back with different shapes (rightsizing / utilisation / orphan).
  // Flatten them onto ONE schema so the columns, search, sort and export stay identical
  // whichever tab is open, instead of three bespoke layouts.
  // Plain computation, not useMemo: this sits after an early return, and the row counts
  // here are small enough that memoising is not worth breaking the Rules of Hooks for.
  const optimRows = (() => {
    const src = activeOptimTab === 'oversized' ? optimOversized
      : activeOptimTab === 'underutilized' ? optimUnderutilized
      : optimOrphaned
    const mapped = (src || []).map(r => {
      const cost = Number(r.cost_current_month || 0)
      return {
        resource_id:    r.resource_id || '',
        name:           r.resource_name || '',
        type:           (r.resource_type || '').split('/').pop() || '',
        resource_group: r.resource_group || '',
        subscription:   r.subscription_name || '',
        location:       r.location || '',
        state:          r.power_state || '',
        utilization:    r.utilization_pct != null ? Number(r.utilization_pct)
                        : (r.avg_cpu_pct != null ? Number(r.avg_cpu_pct) : null),
        days_inactive:  r.days_since_active != null ? Number(r.days_since_active) : null,
        current_sku:    r.sku || r.current_sku || '',
        target_sku:     r.rightsize_sku || '',
        cost,
        savings:        r.estimated_monthly_savings != null ? Number(r.estimated_monthly_savings)
                        : (r.savings_pct != null ? cost * Number(r.savings_pct) / 100 : 0),
        savings_pct:    r.savings_pct != null ? Number(r.savings_pct) : null,
        recommendation: r.recommendation || r.orphan_reason || '',
      }
    })
    const q = optimQuery.trim().toLowerCase()
    const filtered = q
      ? mapped.filter(r => [r.name, r.type, r.resource_group, r.subscription, r.location, r.recommendation]
          .some(v => String(v || '').toLowerCase().includes(q)))
      : mapped
    const { key, dir } = optimSort
    const mul = dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = a[key], bv = b[key]
      if (av == null && bv == null) return 0
      if (av == null) return 1          // blanks always sort last
      if (bv == null) return -1
      return (typeof av === 'number' && typeof bv === 'number')
        ? (av - bv) * mul
        : String(av).localeCompare(String(bv)) * mul
    })
  })()

  const OPTIM_COLUMNS = [
    { key: 'name',           label: 'Resource' },
    { key: 'type',           label: 'Type' },
    { key: 'resource_group', label: 'Resource Group' },
    { key: 'subscription',   label: 'Subscription' },
    { key: 'location',       label: 'Location' },
    { key: 'utilization',    label: 'Utilisation' },
    { key: 'days_inactive',  label: 'Days Inactive' },
    { key: 'current_sku',    label: 'Current \u2192 Target SKU' },
    { key: 'cost',           label: 'Monthly Cost' },
    { key: 'savings',        label: 'Est. Savings' },
    { key: 'recommendation', label: 'Recommendation' },
  ]

  const optimCsv = () => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = optimRows.map(r => [
      r.name, r.type, r.resource_group, r.subscription, r.location,
      r.utilization != null ? r.utilization.toFixed(2) : '',
      r.days_inactive ?? '', r.current_sku, r.target_sku,
      r.cost.toFixed(2), r.savings.toFixed(2), r.recommendation,
    ])
    const head = ['Resource', 'Type', 'Resource Group', 'Subscription', 'Location', 'Utilisation %',
                  'Days Inactive', 'Current SKU', 'Target SKU', 'Monthly Cost USD', 'Est. Savings USD', 'Recommendation']
    const text = [head, ...body].map(row => row.map(esc).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `resource-optimization-${activeOptimTab}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const topSavings = (savings?.opportunities || []).slice(0, 5)
  const budgetAlerts = alerts?.alerts || []

  // ── Metrics Service = single source of truth for the 6 headline cards. Falls
  //    back to the legacy summary (kpi) until /api/metrics/summary lands. ──
  const M = metrics || {}
  // Prefer the metrics value, but treat 0/null/undefined as "no data" and fall back
  // to the KPI. This prevents a stale/throttled 0 from blanking a card.
  const pick = (...vals) => { for (const v of vals) { if (v !== null && v !== undefined && v !== 0) return v } return vals[vals.length - 1] }
  const cardMtdSpend    = pick(M.spend?.mtd,            kpi?.total_spend_mtd)
  const cardForecastEom = pick(M.forecast?.eom,         kpi?.forecast_eom_usd)
  const cardBudgetUtil  = pick(M.budgets?.utilizationPct, kpi?.budget_utilization_pct)
  const cardBudgetBreaching = M.budgets?.breaching?.length ?? kpi?.budgets_exceeded ?? 0
  const cardBudgetCount = M.budgets?.count ?? null
  const cardSavingsMonthly = pick(M.savings?.monthlyRunRate, kpi?.savings_identified_usd)
  const cardSavingsAnnual  = M.savings?.identifiedAnnualizedPotential ?? null
  const cardRiCoverage  = pick(M.reservations?.coveragePct, kpi?.ri_coverage_pct)
  const cardRiUtil      = pick(M.reservations?.utilizationPct, kpi?.ri_utilization_pct)
  const cardTagPct      = pick(M.resources?.tagCompliancePct, kpi?.tagging_compliance_pct)
  const cardUntagged    = M.resources?.untagged ?? kpi?.total_untagged ?? 0
  const hasReservations = M.reservations ? (M.reservations.count > 0 || cardRiCoverage > 0) : kpi?.has_reservations
  const hasBudgets      = M.budgets ? (M.budgets.count > 0) : kpi?.has_budgets

  // ── Grounded enrichment from Cost Insights (estate stats, top services, risk) ──
  const insSummary = insights?.summary || {}
  const insOpts = insSummary.options || {}
  const estateStats = insights ? {
    subscriptions: (insOpts.subscriptions || []).length,
    regions: (insOpts.regions || []).length,
    resourceGroups: (insOpts.resource_groups || []).length,
    services: (insOpts.services || []).length,
    resources: insSummary.total_resources || 0,
  } : null
  const costAtRisk = insSummary.cost_at_risk || null
  const topServices = (() => {
    const m = {}
    for (const r of (insights?.rows || [])) m[r.service] = (m[r.service] || 0) + (r.cost_current || 0)
    return Object.entries(m).map(([name, cost]) => ({ name, cost })).sort((a, b) => b.cost - a.cost).filter(x => x.cost > 0).slice(0, 6)
  })()
  const topServicesMax = topServices[0]?.cost || 1

  // Compact data fingerprint for the AI panel + a structured report for PDF export.
  const aiData = {
    mtd_spend: cardMtdSpend, last_month: kpi?.total_spend_last_month,
    mom_delta_pct: kpi?.mom_delta_pct, forecast_eom: cardForecastEom,
    savings_identified: cardSavingsMonthly, savings_annualized_potential: cardSavingsAnnual,
    budget_utilization_pct: cardBudgetUtil,
    budgets_exceeded: cardBudgetBreaching, ri_coverage_pct: cardRiCoverage,
    ri_utilization_pct: cardRiUtil, tag_compliance_pct: cardTagPct, untagged: cardUntagged,
    anomaly_count: M.anomalies?.openCount ?? kpi?.anomaly_count, subscriptions: kpi?.subscription_count, resources: M.resources?.total ?? kpi?.total_resource_count,
    oversized: optim?.oversized_count, underutilized: optim?.underutilized_count, orphaned: M.savings?.orphanedCount ?? optim?.orphaned_count,
    top_savings: topSavings.map(o => ({ name: o.resource_name || o.title, savings: o.savings_usd ?? o.monthly_savings })),
  }
  const aiReport = {
    title: 'Azure FinOps Overview',
    kpis: [
      { label: 'MTD Spend', value: fmtUsd(cardMtdSpend) },
      { label: 'EOM Forecast', value: fmtUsd(cardForecastEom) },
      { label: 'Savings Found', value: fmtUsd(cardSavingsMonthly) },
      { label: 'Budget Util', value: fmtPct(cardBudgetUtil) },
      { label: 'RI Coverage', value: fmtPct(cardRiCoverage) },
      { label: 'Tag Compliance', value: fmtPct(cardTagPct) },
    ],
    tables: [
      { title: 'Top Savings Opportunities', columns: ['Resource', 'Monthly Savings'],
        rows: topSavings.map(o => [o.resource_name || o.title || '-', fmtUsd(o.savings_usd ?? o.monthly_savings ?? 0)]) },
    ],
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ══ HEADER ══ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0 }}>FinOps Overview</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>
            {kpi?.subscription_count} subscriptions · {kpi?.total_resource_count} resources · All data from Azure Cost Management
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--c-475569)', background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 4, padding: '2px 6px' }}>
            {kpi?.data_source === 'dashboard_cache' ? '⚡ cached' : '☁ live'}
          </span>
          {snapAsOf && (
            <span title="Latest persisted cost snapshot" style={{ fontSize: 10, color: 'var(--c-64748b)' }}>
              as of {new Date(snapAsOf).toLocaleString()}
            </span>
          )}
          <button onClick={refreshLive} disabled={liveRefreshing} style={{
            background: liveRefreshing ? 'var(--c-1e293b)' : 'var(--c-0c1f33)', border: `1px solid ${liveRefreshing ? 'var(--c-334155)' : '#1d4ed8'}`, borderRadius: 6,
            padding: '6px 12px', cursor: liveRefreshing ? 'not-allowed' : 'pointer', color: liveRefreshing ? 'var(--c-94a3b8)' : '#60a5fa', fontSize: 11,
            display: 'flex', alignItems: 'center', gap: 5, opacity: liveRefreshing ? 0.7 : 1,
          }}>
            {liveRefreshing ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {liveRefreshing ? 'Crunching live…' : 'Refresh live'}
          </button>
          <FinOpsExportMenu view="overview" focusDays={30}
            onXlsx={() => finopsApi.downloadReport()}
            report={aiReport} />
          <button onClick={load} style={{
            background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6,
            padding: '6px 10px', cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 11,
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Scope filter bar (subscription / resource group / time range) ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', background: 'var(--c-0f172a)', border: `1px solid ${scopeActive ? '#1d4ed8' : 'var(--c-1e293b)'}`, borderRadius: 10, padding: '12px 16px' }}>
        <Filter size={15} style={{ color: scopeActive ? '#60a5fa' : 'var(--c-64748b)', marginBottom: 6 }} />
        <div style={{ minWidth: 210 }}>
          <SearchableSelect label="Subscription" value={scopeSub} onChange={v => setScopeSub(v || '')} options={subOpts} placeholder="All subscriptions" searchPlaceholder="Search subscriptions…" compact />
        </div>
        <div style={{ minWidth: 200 }}>
          <SearchableSelect label="Resource Group" value={scopeRG} onChange={v => setScopeRG(v || '')} options={rgOpts} placeholder="All resource groups" searchPlaceholder="Search resource groups…" compact />
        </div>
        <div style={{ minWidth: 150 }}>
          <SearchableSelect label="Time Range" value={scopeTime} onChange={v => setScopeTime(v || 'last_30d')} options={TIME_RANGE_OPTIONS.filter(o => o.value !== 'custom')} compact />
        </div>
        {scopeActive && (
          <button onClick={() => { setScopeSub(''); setScopeRG(''); setScopeTime('last_30d') }} style={{
            background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 12px',
            cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1,
          }}><X size={11} /> Clear</button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          {scopeLoading && <span style={{ color: 'var(--c-64748b)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><RefreshCw size={11} className="animate-spin" /> Updating…</span>}
          {scoped && (
            <span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>Spend in scope: <b style={{ color: '#60a5fa' }}>{fmtUsd(scoped.total_cost)}</b></span>
          )}
        </div>
      </div>

      {/* ── Download Error Banner ── */}
      {downloadErr && (
        <div style={{
          background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 8,
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertCircle size={15} style={{ color: 'var(--c-f87171)' }} />
          <span style={{ color: 'var(--c-fca5a5)', fontSize: 12 }}>{downloadErr}</span>
          <button onClick={() => setDownloadErr(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--c-64748b)', cursor: 'pointer', fontSize: 11 }}>✕</button>
        </div>
      )}

      {/* ── Anomaly Banner ── */}
      {(kpi?.anomaly_count > 0) && (
        <div style={{
          background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 8,
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertTriangle size={15} style={{ color: 'var(--c-f87171)' }} />
          <span style={{ color: 'var(--c-fca5a5)', fontWeight: 600, fontSize: 13 }}>
            {kpi.anomaly_count} cost anomal{kpi.anomaly_count === 1 ? 'y' : 'ies'} detected
          </span>
          <span style={{ color: 'var(--c-64748b)', fontSize: 12 }}>— check FinOps Alerts for details</span>
        </div>
      )}

      {/* ══ AI COST ANALYSIS ══ */}
      <FinOpsAIPanel view="overview" data={aiData} filters={{ subscription_id: scopeSub || null, resource_group: scopeRG || null }} />

      {/* ══ SECTION 1: KPI CARDS ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 12 }}>
        <KPICard label="Spend (30d run-rate)" icon={DollarSign} color="#3b82f6"
          value={fmtUsd(cardMtdSpend)}
          sub={<span style={{ color: 'var(--c-64748b)' }}>Last 30 days · warehouse actuals</span>}
        />
        <KPICard label="EOM Forecast" icon={TrendingUp} color="#8b5cf6"
          value={fmtUsd(cardForecastEom)}
          sub={<span style={{ color: momColor }}>{momArrow} {Math.abs(_projMoM).toFixed(1)}% vs last month (proj.)</span>}
        />
        <KPICard label="Budget Health" icon={Shield} color="#f59e0b"
          value={hasBudgets ? fmtPct(cardBudgetUtil) : '—'}
          sub={hasBudgets
            ? `${cardBudgetBreaching} breaching${cardBudgetCount != null ? ` · ${cardBudgetCount} total` : ''}`
            : 'No budgets configured'}
          accent={cardBudgetBreaching > 0 ? '#854d0e' : undefined}
        />
        <KPICard label="Savings Found" icon={Zap} color="#22c55e"
          value={fmtUsd(cardSavingsMonthly)}
          sub={cardSavingsAnnual != null
            ? `Monthly run-rate · ${fmtUsd(cardSavingsAnnual)}/yr potential`
            : 'RI · rightsize · waste (monthly)'}
        />
        <KPICard label="RI Coverage" icon={Shield} color="#06b6d4"
          value={hasReservations ? fmtPct(cardRiCoverage) : '—'}
          sub={hasReservations
            ? `Utilization: ${fmtPct(cardRiUtil)}`
            : 'No reservations purchased'}
        />
        <KPICard label="Tag Compliance" icon={Tag} color="#10b981"
          value={fmtPct(cardTagPct)}
          sub={(cardUntagged ?? 0) > 0
            ? `${cardUntagged} resource${cardUntagged === 1 ? '' : 's'} untagged`
            : 'Required tags coverage'}
          accent={(cardTagPct ?? 100) < 60 ? '#854d0e' : undefined}
        />
      </div>

      {/* ══ SECTION 1b: ESTATE AT A GLANCE ══ */}
      {estateStats && (
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <SectionHeader title="Estate at a Glance" sub="Scope of the analysed estate" />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            {[
              { label: 'Subscriptions', value: estateStats.subscriptions },
              { label: 'Regions', value: estateStats.regions },
              { label: 'Resource groups', value: estateStats.resourceGroups },
              { label: 'Azure services', value: estateStats.services },
              { label: 'Resources', value: estateStats.resources },
            ].map((s, i) => (
              <div key={i} style={{ flex: 1, minWidth: 120, background: 'var(--c-0f172a)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
                <div style={{ color: 'var(--c-f1f5f9)', fontSize: 22, fontWeight: 700 }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ SECTION 1c: TOP SERVICES + COST AT RISK ══ */}
      {(topServices.length > 0 || costAtRisk) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {topServices.length > 0 && (
            <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
              <SectionHeader title="Top Services by Spend" sub="Where the money goes (last 30 days)" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {topServices.map((s, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span style={{ color: 'var(--c-cbd5e1)' }}>{s.name}</span>
                      <span style={{ color: 'var(--c-f1f5f9)', fontWeight: 600 }}>{fmtUsd(s.cost)}</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--c-0f172a)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(3, s.cost / topServicesMax * 100)}%`, background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {costAtRisk && (
            <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
              <SectionHeader title="Cost at Risk" sub="Spend on resources with a posture gap" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                {[
                  { label: 'Unprotected (no backup)', value: costAtRisk.unprotected_usd, color: '#ef4444' },
                  { label: 'Not zone-redundant', value: costAtRisk.non_zone_redundant_usd, color: '#f59e0b' },
                  { label: 'Untagged (unallocated)', value: costAtRisk.untagged_usd, color: '#a855f7' },
                  { label: 'Idle / orphaned', value: costAtRisk.idle_orphaned_usd, color: '#64748b' },
                ].map((r, i) => (
                  <div key={i} style={{ background: 'var(--c-0f172a)', borderLeft: `3px solid ${r.color}`, borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{r.label}</div>
                    <div style={{ color: r.color, fontSize: 18, fontWeight: 700 }}>{fmtUsd(r.value)}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: 'var(--c-475569)', marginTop: 8 }}>Open <b style={{ color: 'var(--c-94a3b8)' }}>Cost Insights</b> to drill into the resources behind each.</div>
            </div>
          )}
        </div>
      )}

      {/* ══ SECTION 2: SPEND TREND + FORECAST ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>

        {/* Spend Trend */}
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionHeader title="30-Day Spend Trend" />
            <button onClick={() => setAccumulated(a => !a)} style={{
              background: accumulated ? 'var(--c-1e3a5f)' : 'var(--c-1e293b)',
              border: `1px solid ${accumulated ? '#1d4ed8' : 'var(--c-334155)'}`,
              borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
              color: accumulated ? '#93c5fd' : 'var(--c-64748b)', fontSize: 11,
            }}>∑ Cumulative</button>
          </div>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trendData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ovGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickFormatter={fmtDate}
                  interval={Math.floor(trendData.length / 5)} />
                <YAxis tick={{ fill: '#475569', fontSize: 9 }} tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v)} width={48} />
                <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }}
                  formatter={v => [fmtUsd(v, 2), accumulated ? 'Cumulative' : 'Daily']} labelFormatter={d => `Date: ${d}`} />
                <Area type="monotone" dataKey="cost" stroke="#3b82f6" fill="url(#ovGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-334155)', fontSize: 12 }}>No trend data</div>
          )}
        </div>

        {/* Forecast (selectable horizon) */}
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <SectionHeader title={`${horizon}-Day Forecast`}
              sub={forecast ? `Projected EOM: ${fmtUsd(forecast.eom_forecast_usd)}` : undefined} />
            <div style={{ display: 'flex', gap: 4 }}>
              {[30, 60, 90, 180, 365].map(h => (
                <button key={h} onClick={() => setHorizon(h)} style={{
                  background: horizon === h ? 'var(--c-1e3a5f)' : 'var(--c-1e293b)',
                  border: `1px solid ${horizon === h ? '#1d4ed8' : 'var(--c-334155)'}`,
                  borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
                  color: horizon === h ? '#93c5fd' : 'var(--c-64748b)', fontSize: 10, fontWeight: 600,
                }}>{h}d</button>
              ))}
            </div>
          </div>
          {fcastData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={fcastData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickFormatter={fmtDate}
                  interval={Math.floor(fcastData.length / 5)} />
                <YAxis tick={{ fill: '#475569', fontSize: 9 }} tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v)} width={48} />
                <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }}
                  formatter={v => [fmtUsd(v, 2)]} labelFormatter={d => `Date: ${d}`} />
                <Line type="monotone" dataKey="actual" stroke="#3b82f6" strokeWidth={2} dot={false} name="Actual" />
                <Line type="monotone" dataKey="projected" stroke="#8b5cf6" strokeWidth={2} dot={false}
                  strokeDasharray="5 3" name="Projected" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-334155)', fontSize: 12 }}>No forecast data</div>
          )}
        </div>
      </div>

      {/* ══ SECTION 3: UTILIZATION HEALTH + BUDGET ALERTS ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Utilization health bars */}
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <SectionHeader title="Utilization & Health" />
          <HealthBar label="Budget Utilization" pct={budgetUtil}
            color={budgetUtil >= 90 ? '#ef4444' : budgetUtil >= 75 ? '#f97316' : '#22c55e'} />
          <HealthBar label="RI Coverage" pct={riCoverage}
            color={riCoverage >= 80 ? '#22c55e' : riCoverage >= 50 ? '#f59e0b' : '#ef4444'} />
          <HealthBar label="RI Utilization" pct={riUtilization}
            color={riUtilization >= 80 ? '#22c55e' : riUtilization >= 60 ? '#f59e0b' : '#ef4444'} />
          <HealthBar label="Tag Compliance" pct={tagCompliance}
            color={tagCompliance >= 80 ? '#22c55e' : tagCompliance >= 60 ? '#f59e0b' : '#ef4444'} />
          {commitments && (
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { l: 'RI Savings/mo', v: fmtUsd(commitments.ri_monthly_savings) },
                { l: 'Savings Plans', v: fmtUsd(commitments.savings_plan_monthly) },
                { l: 'Expiring 30d', v: commitments.expiring_30d ?? '—' },
                { l: 'Active RIs', v: commitments.active_ri_count ?? '—' },
              ].map(({ l, v }) => (
                <div key={l} style={{ background: 'var(--c-0f172a)', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ color: 'var(--c-64748b)', fontSize: 10 }}>{l}</div>
                  <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Budget Alerts */}
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <SectionHeader title="Budget Alerts"
            sub={budgetAlerts.length > 0 ? `${budgetAlerts.length} active alert${budgetAlerts.length > 1 ? 's' : ''}` : 'All budgets healthy'} />
          {budgetAlerts.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 0', color: '#22c55e', fontSize: 12 }}>
              <Shield size={14} /> No budget alerts at this time
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(showAllAlerts ? budgetAlerts : budgetAlerts.slice(0, 6)).map((al, i) => {
              const pct = al.current_pct ?? al.utilization_pct ?? 0
              const color = pct >= 100 ? '#ef4444' : pct >= 90 ? '#f97316' : '#f59e0b'
              return (
                <div key={i} style={{ background: 'var(--c-0f172a)', borderRadius: 6, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: 'var(--c-e2e8f0)', fontSize: 11, fontWeight: 600 }}>{al.budget_name || al.name || 'Budget'}</div>
                    <div style={{ color: 'var(--c-64748b)', fontSize: 10 }}>{al.scope || ''}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color, fontSize: 12, fontWeight: 700 }}>{pct.toFixed(0)}%</div>
                    <div style={{ color: 'var(--c-475569)', fontSize: 10 }}>{fmtUsd(al.current_spend)} / {fmtUsd(al.budget_amount)}</div>
                  </div>
                </div>
              )
            })}
          </div>
          {budgetAlerts.length > 6 && (
            <button
              onClick={() => setShowAllAlerts(s => !s)}
              style={{ marginTop: 10, fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {showAllAlerts ? '↑ Show less' : `↓ Show all ${budgetAlerts.length} alerts`}
            </button>
          )}
        </div>
      </div>

      {/* ══ SECTION 4: AZURE ADVISOR COST RECOMMENDATIONS ══ */}
      <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeader title="Azure Advisor — Cost Recommendations"
            sub={advisorItems.length > 0 ? `${advisorItems.length} recommendations · ${fmtUsd(advisor?.total_savings_monthly)}/mo potential savings` : 'No cost recommendations found'} />
        </div>
        {advisorItems.length === 0 ? (
          <div style={{ color: 'var(--c-475569)', fontSize: 12, padding: '8px 0' }}>No cost advisory items in current data.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>{['Resource', 'Type', 'Impact', 'Recommendation', 'Est. Savings/mo'].map(h => (
                  <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {advisorItems.slice(0, 8).map((item, i) => (
                  <tr key={i} onClick={() => item.resource_id && openResourceDetail(item)}
                    title={item.resource_id ? 'View resource details' : undefined}
                    style={{ borderBottom: '1px solid var(--c-0f172a)', cursor: item.resource_id ? 'pointer' : 'default' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={item.resource_name}>{item.resource_name}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-64748b)' }}>{(item.resource_type || '').split('/').pop()}</td>
                    <td style={{ padding: '6px 8px' }}><ImpactBadge impact={item.impact} /></td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={asText(item.recommendation)}>{asText(item.recommendation)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-4ade80)', fontWeight: 600 }}>
                      {item.potential_savings_monthly > 0 ? fmtUsd(item.potential_savings_monthly) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ══ SECTION 5: TOP SAVINGS ══ */}
      <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
        {(() => {
          const all = savings?.opportunities || []
          const q = savingsQuery.trim().toLowerCase()
          const filtered = q
            ? all.filter(o => [o.resource_name, o.resource_type, o.resource_group, o.category_label, o.action, o.confidence, o.effort]
                .some(v => String(v || '').toLowerCase().includes(q)))
            : all
          const mul = savingsSort.dir === 'asc' ? 1 : -1
          const rows = [...filtered].sort((a, b) => {
            const av = a[savingsSort.key], bv = b[savingsSort.key]
            if (av == null && bv == null) return 0
            if (av == null) return 1
            if (bv == null) return -1
            return (typeof av === 'number' && typeof bv === 'number')
              ? (av - bv) * mul
              : String(av).localeCompare(String(bv)) * mul
          })
          const cols = [
            { key: 'resource_name',        label: 'Resource' },
            { key: 'resource_type',        label: 'Type' },
            { key: 'resource_group',       label: 'Resource Group' },
            { key: 'category_label',       label: 'Category' },
            { key: 'current_monthly_cost', label: 'Monthly Cost' },
            { key: 'potential_savings_usd', label: 'Potential Savings' },
            { key: 'savings_pct',          label: 'Savings %' },
            { key: 'confidence',           label: 'Confidence' },
            { key: 'effort',               label: 'Effort' },
            { key: 'priority_score',       label: 'Priority' },
            { key: 'action',               label: 'Recommended Action' },
          ]
          const totalSave = rows.reduce((s, o) => s + Number(o.potential_savings_usd || 0), 0)
          const totalCost = rows.reduce((s, o) => s + Number(o.current_monthly_cost || 0), 0)
          const csv = () => {
            const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
            const body = rows.map(o => [
              o.resource_name, o.resource_type, o.resource_group, o.category_label,
              Number(o.current_monthly_cost || 0).toFixed(2), Number(o.potential_savings_usd || 0).toFixed(2),
              o.savings_pct != null ? Number(o.savings_pct).toFixed(1) : '',
              o.confidence, o.effort, o.priority_score, o.action, o.resource_id,
            ])
            const head = [...cols.map(c => c.label), 'Resource ID']
            const text = [head, ...body].map(r => r.map(esc).join(',')).join('\n')
            const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }))
            const a = document.createElement('a')
            a.href = url
            a.download = `savings-opportunities-${rows.length}.csv`
            a.click()
            URL.revokeObjectURL(url)
          }
          const sortBy = k => setSavingsSort(s => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))
          const cell = { padding: '6px 8px', color: 'var(--c-64748b)', whiteSpace: 'nowrap' }
          return (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                <SectionHeader title="Top Savings Opportunities"
                  sub={all.length > 0 ? `${rows.length} of ${all.length} opportunities · ${fmtUsd(totalSave)}/mo identified` : ''} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    value={savingsQuery}
                    onChange={e => setSavingsQuery(e.target.value)}
                    placeholder="Filter resource, category, action…"
                    style={{
                      background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6,
                      padding: '4px 8px', color: 'var(--c-e2e8f0)', fontSize: 11, width: 220,
                    }} />
                  <FinOpsExportMenu
                    view="savings-opportunities"
                    onCsv={csv}
                    report={{
                      title: 'Savings Opportunities',
                      kpis: [
                        { label: 'Opportunities', value: String(rows.length) },
                        { label: 'Current cost', value: fmtUsd(totalCost) },
                        { label: 'Potential savings', value: fmtUsd(totalSave) },
                      ],
                      tables: [{
                        title: 'Savings opportunities',
                        columns: cols.map(c => c.label),
                        rows: rows.slice(0, 200).map(o => [
                          o.resource_name || '—', (o.resource_type || '').split('/').pop() || '—',
                          o.resource_group || '—', o.category_label || '—',
                          fmtUsd(o.current_monthly_cost || 0), fmtUsd(o.potential_savings_usd || 0),
                          o.savings_pct != null ? Number(o.savings_pct).toFixed(0) + '%' : '—',
                          o.confidence || '—', o.effort || '—',
                          o.priority_score != null ? Number(o.priority_score).toFixed(0) : '—',
                          o.action || '—',
                        ]),
                      }],
                    }} />
                </div>
              </div>

              {rows.length === 0 ? (
                <div style={{ color: 'var(--c-475569)', fontSize: 12 }}>
                  {q ? `No opportunities match “${savingsQuery}”.` : 'No savings opportunities found.'}
                </div>
              ) : (
                <>
                  <div style={{ maxHeight: 420, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--c-111827)', zIndex: 1 }}>
                        <tr>
                          {cols.map(c => (
                            <th key={c.key} onClick={() => sortBy(c.key)} title="Sort"
                              style={{
                                textAlign: 'left', color: savingsSort.key === c.key ? 'var(--c-94a3b8)' : 'var(--c-475569)',
                                padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)',
                                whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
                              }}>
                              {c.label}{savingsSort.key === c.key ? (savingsSort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((o, i) => (
                          <tr key={o.id || i}
                            onClick={() => o.resource_id && openResourceDetail(o)}
                            title={o.resource_id ? 'View resource details' : undefined}
                            style={{ borderBottom: '1px solid var(--c-0f172a)', cursor: o.resource_id ? 'pointer' : 'default' }}>
                            <td style={{ ...cell, color: 'var(--c-e2e8f0)', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }} title={o.resource_name}>{o.resource_name || '—'}</td>
                            <td style={cell}>{(o.resource_type || '').split('/').pop() || '—'}</td>
                            <td style={cell}>{o.resource_group || '—'}</td>
                            <td style={cell}>
                              {o.category_label
                                ? <span style={{ fontSize: 9, color: 'var(--c-94a3b8)', background: 'var(--c-1e293b)', borderRadius: 4, padding: '1px 5px' }}>{o.category_label}</span>
                                : '—'}
                            </td>
                            <td style={{ ...cell, color: 'var(--c-e2e8f0)' }}>{fmtUsd(o.current_monthly_cost || 0)}</td>
                            <td style={{ ...cell, color: 'var(--c-4ade80)', fontWeight: 700 }}>{fmtUsd(o.potential_savings_usd || 0)}</td>
                            <td style={cell}>{o.savings_pct != null ? Number(o.savings_pct).toFixed(0) + '%' : '—'}</td>
                            <td style={cell}>{o.confidence || '—'}</td>
                            <td style={cell}>{o.effort || '—'}</td>
                            <td style={cell}>{o.priority_score != null ? Number(o.priority_score).toFixed(0) : '—'}</td>
                            <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={o.action}>{o.action || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ color: 'var(--c-475569)', fontSize: 11, marginTop: 8 }}>
                    {rows.length} opportunit{rows.length === 1 ? 'y' : 'ies'} · {fmtUsd(totalCost)}/mo current · {fmtUsd(totalSave)}/mo potential savings
                  </div>
                </>
              )}
            </>
          )
        })()}
      </div>

      {/* ══ SECTION 6: RESOURCE OPTIMIZATION ══ */}
      <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeader title="Resource Optimization"
            sub={optim ? `${optim.oversized_count ?? 0} oversized · ${optim.underutilized_count ?? 0} underutilized · ${optim.orphaned_count ?? 0} orphaned` : ''} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={optimQuery}
              onChange={e => setOptimQuery(e.target.value)}
              placeholder="Filter resource, group, subscription…"
              style={{
                background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6,
                padding: '4px 8px', color: 'var(--c-e2e8f0)', fontSize: 11, width: 220,
              }} />
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { key: 'oversized', label: `Oversized (${optim?.oversized_count ?? 0})`, color: '#ef4444' },
                { key: 'underutilized', label: `Low Util (${optim?.underutilized_count ?? 0})`, color: '#f59e0b' },
                { key: 'orphaned', label: `Orphaned (${optim?.orphaned_count ?? 0})`, color: 'var(--c-64748b)' },
              ].map(tab => (
                <button key={tab.key} onClick={() => setOptimTab(tab.key)} style={{
                  background: activeOptimTab === tab.key ? 'var(--c-0f172a)' : 'none',
                  border: `1px solid ${activeOptimTab === tab.key ? tab.color + '55' : 'var(--c-1e293b)'}`,
                  borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                  color: activeOptimTab === tab.key ? tab.color : 'var(--c-475569)', fontSize: 11,
                }}>{tab.label}</button>
              ))}
            </div>
            <FinOpsExportMenu
              view={`resource-optimization-${activeOptimTab}`}
              onCsv={optimCsv}
              report={{
                title: `Resource Optimization — ${activeOptimTab}`,
                kpis: [
                  { label: 'Rows', value: String(optimRows.length) },
                  { label: 'Monthly cost', value: fmtUsd(optimRows.reduce((s, r) => s + r.cost, 0)) },
                  { label: 'Est. savings', value: fmtUsd(optimRows.reduce((s, r) => s + r.savings, 0)) },
                ],
                tables: [{
                  title: 'Optimization candidates',
                  columns: OPTIM_COLUMNS.map(c => c.label),
                  rows: optimRows.slice(0, 200).map(r => [
                    r.name, r.type, r.resource_group, r.subscription, r.location,
                    r.utilization != null ? r.utilization.toFixed(2) + '%' : '—',
                    r.days_inactive ?? '—',
                    r.current_sku ? `${r.current_sku}${r.target_sku ? ' → ' + r.target_sku : ''}` : '—',
                    fmtUsd(r.cost), fmtUsd(r.savings), r.recommendation,
                  ]),
                }],
              }} />
          </div>
        </div>

        {/* Tab content */}
        {(() => {
          if (!optimRows || optimRows.length === 0) return (
            <div style={{ color: 'var(--c-475569)', fontSize: 12, padding: '8px 0', lineHeight: 1.6 }}>
              {optimQuery.trim()
                ? `No rows match “${optimQuery}”.`
                : activeOptimTab === 'oversized'
                  ? 'No rightsizing candidates. Azure only proposes a smaller SKU for a VM that has been running long enough to produce CPU and memory history — a powered-off or newly-created VM produces none.'
                  : activeOptimTab === 'underutilized'
                    ? 'Nothing is running below the utilisation threshold with meaningful spend.'
                    : 'No unattached disks, NICs or public IPs were found.'}
            </div>
          )
          const totalCost = optimRows.reduce((s, r) => s + r.cost, 0)
          const totalSave = optimRows.reduce((s, r) => s + r.savings, 0)
          const sortBy = key => setOptimSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
          const cell = { padding: '6px 8px', color: 'var(--c-64748b)', whiteSpace: 'nowrap' }
          return (
            <>
              <div style={{ maxHeight: 420, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--c-111827)', zIndex: 1 }}>
                    <tr>
                      {OPTIM_COLUMNS.map(c => (
                        <th key={c.key} onClick={() => sortBy(c.key)} title="Sort"
                          style={{
                            textAlign: 'left', color: optimSort.key === c.key ? 'var(--c-94a3b8)' : 'var(--c-475569)',
                            padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)',
                            whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
                          }}>
                          {c.label}{optimSort.key === c.key ? (optimSort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {optimRows.map((r, i) => (
                      <tr key={r.resource_id || i}
                        onClick={() => drillToExplorer({ groupBy: ['ResourceType'], timeRange: 'last_30d', advFilters: r.resource_group ? { resource_groups: [r.resource_group] } : null })}
                        title="Open in Cost Explorer"
                        style={{ borderBottom: '1px solid var(--c-0f172a)', cursor: 'pointer' }}>
                        <td style={{ ...cell, color: 'var(--c-e2e8f0)', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.name}>{r.name || '—'}</td>
                        <td style={cell}>{r.type || '—'}</td>
                        <td style={cell}>{r.resource_group || '—'}</td>
                        <td style={{ ...cell, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.subscription}>{r.subscription || '—'}</td>
                        <td style={cell}>{r.location || '—'}</td>
                        <td style={{ ...cell, color: 'var(--c-94a3b8)' }}>
                          {(r.state === 'deallocated' || r.state === 'stopped')
                            ? <span style={{ color: '#f59e0b' }} title="Powered off — it emits no live CPU, so any percentage would be stale">Stopped</span>
                            : r.utilization != null
                              ? <span style={{ color: r.utilization < 5 ? '#ef4444' : '#f59e0b' }}>{r.utilization.toFixed(2)}%</span>
                              : '—'}
                        </td>
                        <td style={cell}>{r.days_inactive != null ? `${r.days_inactive}d` : '—'}</td>
                        <td style={{ ...cell, color: 'var(--c-94a3b8)' }}>
                          {r.current_sku
                            ? <span>{r.current_sku}{r.target_sku ? <> <ChevronRight size={10} style={{ display: 'inline' }} /> <span style={{ color: 'var(--c-4ade80)' }}>{r.target_sku}</span></> : null}</span>
                            : '—'}
                        </td>
                        <td style={{ ...cell, color: 'var(--c-e2e8f0)' }}>{fmtUsd(r.cost)}</td>
                        <td style={{ ...cell, color: r.savings > 0 ? 'var(--c-4ade80)' : 'var(--c-64748b)', fontWeight: r.savings > 0 ? 600 : 400 }}>
                          {r.savings > 0 ? fmtUsd(r.savings) : '—'}
                          {r.savings_pct != null ? <span style={{ color: 'var(--c-475569)' }}> ({r.savings_pct.toFixed(0)}%)</span> : null}
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={r.recommendation}>{r.recommendation || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ color: 'var(--c-475569)', fontSize: 11, marginTop: 8 }}>
                {optimRows.length} resource{optimRows.length === 1 ? '' : 's'} · {fmtUsd(totalCost)}/mo current · {fmtUsd(totalSave)}/mo estimated savings
              </div>
            </>
          )
        })()}
      </div>

    </div>
  )
}
