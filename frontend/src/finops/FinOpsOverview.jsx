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
  RefreshCw, AlertCircle, Download, ChevronRight, TrendingDown,
} from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct, CHART_COLORS, drillToExplorer } from './finopsApi'
import { OverviewSkeleton } from './FinOpsSkeleton'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'

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
  const [kpi,          setKpi]          = useState(null)
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
  const [downloading,  setDownloading]  = useState(false)
  const [downloadErr,  setDownloadErr]  = useState(null)
  const [liveRefreshing, setLiveRefreshing] = useState(false)
  const [snapAsOf,     setSnapAsOf]     = useState(null)
  const [showAllAlerts, setShowAllAlerts] = useState(false)

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

      // Slow path: load remaining sections in background (don't block UI)
      finopsApi.getForecast(90).then(f => setForecast(f)).catch(() => {})
      finopsApi.getSavings().then(sv => setSavings(sv)).catch(() => {})
      finopsApi.getCommitments().then(cm => setCommitments(cm)).catch(() => {})
      finopsApi.getBudgetAlerts().then(al => setAlerts(al)).catch(() => {})
    } catch (e) { setError(e.message); setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

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
    const dates = kpi?.cost_trend_dates || []
    const costs = kpi?.cost_trend_30d   || []
    const raw = dates.map((d, i) => ({ date: d, cost: costs[i] ?? 0 }))
    if (!accumulated) return raw
    return raw.reduce((acc, pt, i) => {
      acc.push({ date: pt.date, cost: (acc[i - 1]?.cost ?? 0) + (pt.cost ?? 0) })
      return acc
    }, [])
  }, [kpi, accumulated])

  /* ── Forecast chart data ── */
  const fcastData = useMemo(() => (
    forecast?.forecast_points?.map(p => ({
      date: p.date, actual: p.actual ?? null, projected: p.projected ?? null,
    })) || []
  ), [forecast])

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

  const momColor = (kpi?.mom_delta_pct ?? 0) >= 0 ? '#ef4444' : '#22c55e'
  const momArrow = (kpi?.mom_delta_pct ?? 0) >= 0 ? '↑' : '↓'
  const advisorItems  = advisor?.items || []
  const optimOversized    = optim?.oversized    || []
  const optimUnderutilized = optim?.underutilized || []
  const optimOrphaned  = optim?.orphaned    || []
  const topSavings = (savings?.opportunities || []).slice(0, 5)
  const budgetAlerts = alerts?.alerts || []

  // Compact data fingerprint for the AI panel + a structured report for PDF export.
  const aiData = {
    mtd_spend: kpi?.total_spend_mtd, last_month: kpi?.total_spend_last_month,
    mom_delta_pct: kpi?.mom_delta_pct, forecast_eom: kpi?.forecast_eom_usd,
    savings_identified: kpi?.savings_identified_usd, budget_utilization_pct: kpi?.budget_utilization_pct,
    budgets_exceeded: kpi?.budgets_exceeded, ri_coverage_pct: kpi?.ri_coverage_pct,
    ri_utilization_pct: kpi?.ri_utilization_pct, tag_compliance_pct: kpi?.tagging_compliance_pct,
    anomaly_count: kpi?.anomaly_count, subscriptions: kpi?.subscription_count, resources: kpi?.total_resource_count,
    oversized: optim?.oversized_count, underutilized: optim?.underutilized_count, orphaned: optim?.orphaned_count,
    top_savings: topSavings.map(o => ({ name: o.resource_name || o.title, savings: o.savings_usd ?? o.monthly_savings })),
  }
  const aiReport = {
    title: 'Azure FinOps Overview',
    kpis: [
      { label: 'MTD Spend', value: fmtUsd(kpi?.total_spend_mtd) },
      { label: 'EOM Forecast', value: fmtUsd(kpi?.forecast_eom_usd) },
      { label: 'Savings Found', value: fmtUsd(kpi?.savings_identified_usd) },
      { label: 'Budget Util', value: fmtPct(kpi?.budget_utilization_pct) },
      { label: 'RI Coverage', value: fmtPct(kpi?.ri_coverage_pct) },
      { label: 'Tag Compliance', value: fmtPct(kpi?.tagging_compliance_pct) },
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
      <FinOpsAIPanel view="overview" data={aiData} />

      {/* ══ SECTION 1: KPI CARDS ══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 12 }}>
        <KPICard label="MTD Spend" icon={DollarSign} color="#3b82f6"
          value={fmtUsd(kpi?.total_spend_mtd)}
          sub={<span style={{ color: momColor }}>{momArrow} {Math.abs(kpi?.mom_delta_pct ?? 0).toFixed(1)}% vs last month</span>}
          accent={(kpi?.mom_delta_pct ?? 0) > 20 ? 'var(--c-7f1d1d)' : undefined}
        />
        <KPICard label="EOM Forecast" icon={TrendingUp} color="#8b5cf6"
          value={fmtUsd(kpi?.forecast_eom_usd)}
          sub={`Prev month: ${fmtUsd(kpi?.total_spend_last_month)}`}
        />
        <KPICard label="Budget Health" icon={Shield} color="#f59e0b"
          value={kpi?.has_budgets ? fmtPct(kpi?.budget_utilization_pct) : '—'}
          sub={kpi?.has_budgets
            ? `${kpi?.budgets_exceeded ?? 0} exceeded · ${kpi?.budgets_at_risk ?? 0} at risk`
            : 'No budgets configured'}
          accent={(kpi?.budgets_exceeded ?? 0) > 0 ? '#854d0e' : undefined}
        />
        <KPICard label="Savings Found" icon={Zap} color="#22c55e"
          value={fmtUsd(kpi?.savings_identified_usd)}
          sub="RI · rightsize · waste"
        />
        <KPICard label="RI Coverage" icon={Shield} color="#06b6d4"
          value={kpi?.has_reservations ? fmtPct(kpi?.ri_coverage_pct) : '—'}
          sub={kpi?.has_reservations
            ? `Utilization: ${fmtPct(kpi?.ri_utilization_pct)}`
            : 'No reservations purchased'}
        />
        <KPICard label="Tag Compliance" icon={Tag} color="#10b981"
          value={fmtPct(kpi?.tagging_compliance_pct)}
          sub={(kpi?.total_untagged ?? 0) > 0
            ? `${kpi.total_untagged} resource${kpi.total_untagged === 1 ? '' : 's'} untagged`
            : 'Required tags coverage'}
          accent={(kpi?.tagging_compliance_pct ?? 100) < 60 ? '#854d0e' : undefined}
        />
      </div>

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

        {/* 90-day Forecast */}
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <SectionHeader title="90-Day Forecast"
            sub={forecast ? `Projected EOM: ${fmtUsd(forecast.forecast_eom_usd)}` : undefined} />
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
                  <tr key={i} style={{ borderBottom: '1px solid var(--c-0f172a)' }}>
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
        <SectionHeader title="Top Savings Opportunities"
          sub={topSavings.length > 0 ? `Showing top ${topSavings.length} of ${savings?.opportunities?.length || 0}` : ''} />
        {topSavings.length === 0 ? (
          <div style={{ color: 'var(--c-475569)', fontSize: 12 }}>No savings opportunities found.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {topSavings.map((op, i) => (
              <div key={i} style={{ background: 'var(--c-0f172a)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--c-e2e8f0)', fontSize: 11, fontWeight: 600, flex: 1, paddingRight: 8 }}>{op.resource_name || op.title || '—'}</span>
                  <span style={{ color: 'var(--c-4ade80)', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtUsd(op.savings_usd ?? op.monthly_savings ?? 0)}/mo</span>
                </div>
                <div style={{ color: 'var(--c-64748b)', fontSize: 10 }}>{op.recommendation || op.action || '—'}</div>
                {op.current_sku && op.rightsize_sku && (
                  <div style={{ color: 'var(--c-475569)', fontSize: 10 }}>
                    {op.current_sku} <ChevronRight size={10} style={{ display: 'inline' }} /> {op.rightsize_sku}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══ SECTION 6: RESOURCE OPTIMIZATION ══ */}
      <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SectionHeader title="Resource Optimization"
            sub={optim ? `${optim.oversized_count ?? 0} oversized · ${optim.underutilized_count ?? 0} underutilized · ${optim.orphaned_count ?? 0} orphaned` : ''} />
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { key: 'oversized', label: `Oversized (${optim?.oversized_count ?? 0})`, color: '#ef4444' },
              { key: 'underutilized', label: `Low Util (${optim?.underutilized_count ?? 0})`, color: '#f59e0b' },
              { key: 'orphaned', label: `Orphaned (${optim?.orphaned_count ?? 0})`, color: 'var(--c-64748b)' },
            ].map(tab => (
              <button key={tab.key} onClick={() => setOptimTab(tab.key)} style={{
                background: optimTab === tab.key ? 'var(--c-0f172a)' : 'none',
                border: `1px solid ${optimTab === tab.key ? tab.color + '55' : 'var(--c-1e293b)'}`,
                borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                color: optimTab === tab.key ? tab.color : 'var(--c-475569)', fontSize: 11,
              }}>{tab.label}</button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {(() => {
          const rows = optimTab === 'oversized' ? optimOversized
            : optimTab === 'underutilized' ? optimUnderutilized
            : optimOrphaned
          if (!rows || rows.length === 0) return (
            <div style={{ color: 'var(--c-475569)', fontSize: 12, padding: '8px 0' }}>
              No {optimTab} resources found.
            </div>
          )
          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    {['Resource', 'Type', 'Resource Group',
                      optimTab === 'oversized' ? 'Current SKU → Recommended' : optimTab === 'underutilized' ? 'Avg CPU %' : 'Days Inactive',
                      'Monthly Cost', optimTab !== 'orphaned' ? 'Savings %' : 'Recommendation',
                    ].map(h => (
                      <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((r, i) => (
                    <tr key={i}
                      onClick={() => drillToExplorer({ groupBy: ['ResourceType'], timeRange: 'last_30d', advFilters: r.resource_group ? { resource_groups: [r.resource_group] } : null })}
                      title="Open in Cost Explorer"
                      style={{ borderBottom: '1px solid var(--c-0f172a)', cursor: 'pointer' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={r.resource_name}>{r.resource_name}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-64748b)' }}>{(r.resource_type || '').split('/').pop()}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-64748b)' }}>{r.resource_group}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)' }}>
                        {optimTab === 'oversized'
                          ? <span>{r.sku || r.current_sku || '—'} <ChevronRight size={10} style={{ display: 'inline' }} /> <span style={{ color: 'var(--c-4ade80)' }}>{r.rightsize_sku || '—'}</span></span>
                          : optimTab === 'underutilized'
                            ? <span style={{ color: (r.avg_cpu_pct ?? 100) < 10 ? '#ef4444' : '#f59e0b' }}>{r.avg_cpu_pct != null ? r.avg_cpu_pct.toFixed(1) + '%' : '—'}</span>
                            : r.days_since_active != null ? `${r.days_since_active}d` : '—'}
                      </td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)' }}>{fmtUsd(r.cost_current_month)}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {optimTab !== 'orphaned'
                          ? <span style={{ color: 'var(--c-4ade80)', fontWeight: 600 }}>{r.rightsize_savings_pct != null ? r.rightsize_savings_pct.toFixed(0) + '%' : '—'}</span>
                          : <span style={{ color: 'var(--c-94a3b8)' }}>{r.recommendation || 'Review & remove'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}
      </div>

    </div>
  )
}
