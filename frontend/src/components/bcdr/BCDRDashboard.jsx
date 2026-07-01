import React, { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'
import ResourceDetailDrawer from '../ResourceDetailDrawer'
import {
  Shield, AlertTriangle, CheckCircle, Clock, Zap, TrendingUp,
  Globe, MapPin, RefreshCw, ChevronRight, Info, Target, Layers,
  Activity, BarChart2, Building2, Filter, X,
} from 'lucide-react'
import { api } from '../../api/client'
import { prettyResourceType } from '../../utils/resourceTypes'
import BIAGenerator from '../BIAGenerator'

// ── Helpers ────────────────────────────────────────────────────────────────

function RiskBadge({ score }) {
  if (score >= 80) return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-900/40 text-red-300 border border-red-800/50">High {score}</span>
  if (score >= 60) return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-900/40 text-orange-300 border border-orange-800/50">Med-High {score}</span>
  if (score >= 40) return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-900/40 text-yellow-300 border border-yellow-800/50">Medium {score}</span>
  return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-900/40 text-green-300 border border-green-800/50">Low {score}</span>
}

function PriorityBadge({ priority }) {
  const map = {
    P1: 'bg-red-900/40 text-red-300 border-red-800/50',
    P2: 'bg-orange-900/40 text-orange-300 border-orange-800/50',
    P3: 'bg-yellow-900/40 text-yellow-300 border-yellow-800/50',
    P4: 'bg-gray-800 text-gray-400 border-gray-700',
  }
  return <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold border', map[priority] || map.P4)}>{priority}</span>
}

function ZoneStatusBadge({ status }) {
  const map = {
    ZoneRedundant:    { cls: 'bg-green-900/40 text-green-300 border-green-800/50', icon: '✓' },
    Zonal:            { cls: 'bg-yellow-900/40 text-yellow-300 border-yellow-800/50', icon: '◐' },
    LocallyRedundant: { cls: 'bg-red-900/40 text-red-300 border-red-800/50', icon: '△' },
    NotZoneAware:     { cls: 'bg-blue-900/40 text-blue-300 border-blue-800/50', icon: 'ℹ' },
    Unknown:          { cls: 'bg-gray-800 text-gray-400 border-gray-700', icon: '?' },
  }
  const style = map[status] || map.Unknown
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', style.cls)}>
      <span>{style.icon}</span>{status}
    </span>
  )
}

const ZONE_COLOR_MAP = {
  ZoneRedundant:    '#22c55e',
  Zonal:            '#eab308',
  LocallyRedundant: '#ef4444',
  NotZoneAware:     '#60a5fa',
  Unknown:          '#6b7280',
}

// Color palettes for new charts
const RISK_COLORS = { 'High Risk (Critical Non-Zonal)': '#ef4444', 'Medium Risk (Other Non-Zonal)': '#f97316', 'Low Risk (Protected)': '#22c55e' }
const CROSS_REGION_COLORS = { 'Geo-Redundant': '#22c55e', 'Global/Multi-Region': '#60a5fa', 'Single-Region': '#f97316', 'Unknown': '#6b7280' }
const IAAS_PAAS_COLORS = { 'IaaS': '#60a5fa', 'PaaS & App Services': '#a78bfa', 'Platform Infrastructure': '#6b7280' }
const BAR_COLORS = ['#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#34d399', '#22d3ee', '#818cf8', '#f87171', '#94a3b8', '#fbbf24', '#6ee7b7']

// Simple donut chart using SVG arcs
function DonutChart({ data, size = 120 }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  if (!total) return <div className="w-24 h-24 rounded-full bg-gray-800 flex items-center justify-center text-gray-600 text-xs">No data</div>

  const r = 45
  const cx = size / 2
  const cy = size / 2
  let startAngle = -Math.PI / 2

  const slices = Object.entries(data).map(([label, value]) => {
    const angle = (value / total) * 2 * Math.PI
    const endAngle = startAngle + angle
    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const largeArc = angle > Math.PI ? 1 : 0
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`
    startAngle = endAngle
    return { label, value, pct: ((value / total) * 100).toFixed(0), d, color: ZONE_COLOR_MAP[label] || '#6b7280' }
  })

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size}>
        {slices.map(s => <path key={s.label} d={s.d} fill={s.color} opacity={0.85} />)}
        <circle cx={cx} cy={cy} r={r * 0.55} style={{ fill: 'var(--c-111827)' }} />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" style={{ fill: 'var(--c-e5e7eb)' }} fontSize="14" fontWeight="bold">{total}</text>
      </svg>
    </div>
  )
}

// Donut chart with custom color map
function ColoredDonut({ data, colorMap, size = 120 }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  if (!total) return <div className="w-24 h-24 rounded-full bg-gray-800 flex items-center justify-center text-gray-600 text-xs">No data</div>
  const r = 45, cx = size / 2, cy = size / 2
  let startAngle = -Math.PI / 2
  const slices = Object.entries(data).map(([label, value]) => {
    const angle = (value / total) * 2 * Math.PI
    const endAngle = startAngle + angle
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle)
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${angle > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`
    startAngle = endAngle
    return { label, value, pct: ((value / total) * 100).toFixed(0), d, color: colorMap[label] || '#6b7280' }
  })
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size}>
        {slices.map(s => <path key={s.label} d={s.d} fill={s.color} opacity={0.85} />)}
        <circle cx={cx} cy={cy} r={r * 0.55} style={{ fill: 'var(--c-111827)' }} />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" style={{ fill: 'var(--c-e5e7eb)' }} fontSize="14" fontWeight="bold">{total}</text>
      </svg>
    </div>
  )
}

function DonutLegend({ data, colorMap }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0)
  if (!total) return null
  return (
    <div className="flex-1 space-y-1.5">
      {Object.entries(data).filter(([, v]) => v > 0).map(([label, count]) => (
        <div key={label} className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorMap[label] || '#6b7280' }} />
          <span className="text-xs text-gray-400 flex-1 truncate">{label}</span>
          <span className="text-xs font-semibold text-gray-200 tabular-nums">{count}</span>
          <span className="text-xs text-gray-600">{Math.round(count / total * 100)}%</span>
        </div>
      ))}
    </div>
  )
}

// Horizontal bar chart
function HBarChart({ data, maxBars = 10, showCount = true }) {
  const entries = Object.entries(data).slice(0, maxBars)
  const maxVal = Math.max(...entries.map(([, v]) => v), 1)
  return (
    <div className="space-y-2">
      {entries.map(([label, count], i) => {
        const pct = (count / maxVal * 100).toFixed(0)
        return (
          <div key={label}>
            <div className="flex items-center justify-between text-xs mb-0.5">
              <span className="text-gray-400 truncate max-w-[60%]">{label}</span>
              {showCount && <span className="text-gray-300 font-medium tabular-nums">{count}</span>}
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Subscription zone stacked bar
function SubscriptionZoneBar({ rows }) {
  if (!rows?.length) return null
  return (
    <div className="space-y-2">
      {rows.slice(0, 8).map((row, i) => {
        const total = row.total || 1
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-gray-400 font-mono w-24 truncate">{row.subscription_id?.slice(-12) || 'sub-' + i}</span>
            <div className="flex-1 flex h-3 rounded-full overflow-hidden bg-gray-800 gap-px">
              {row.ZoneRedundant > 0 && <div style={{ width: `${(row.ZoneRedundant / total * 100)}%`, backgroundColor: '#22c55e' }} title={`ZR: ${row.ZoneRedundant}`} />}
              {row.LocallyRedundant > 0 && <div style={{ width: `${(row.LocallyRedundant / total * 100)}%`, backgroundColor: '#ef4444' }} title={`LR: ${row.LocallyRedundant}`} />}
              {row.NonZonal > 0 && <div style={{ width: `${(row.NonZonal / total * 100)}%`, backgroundColor: '#6b7280' }} title={`NZ: ${row.NonZonal}`} />}
            </div>
            <span className="text-xs text-gray-500 tabular-nums w-8 text-right">{total}</span>
          </div>
        )
      })}
      <div className="flex items-center gap-4 mt-1 flex-wrap">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#22c55e' }} /><span className="text-xs text-gray-500">ZoneRedundant</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} /><span className="text-xs text-gray-500">LocallyRedundant</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#6b7280' }} /><span className="text-xs text-gray-500">NonZonal/Unknown</span></div>
      </div>
    </div>
  )
}

// ── KPI Card ───────────────────────────────────────────────────────────────

function KPICard({ icon: Icon, label, value, sub, color = 'text-gray-300', bgColor = 'bg-gray-800/60', borderColor = 'border-gray-700/50' }) {
  return (
    <div className={clsx('rounded-xl border p-4 flex flex-col gap-1', bgColor, borderColor)}>
      <div className="flex items-center gap-2">
        <div className={clsx('p-1.5 rounded-lg bg-gray-900/60')}>
          <Icon size={14} className={color} />
        </div>
        <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">{label}</span>
      </div>
      <div className={clsx('text-2xl font-bold tabular-nums', color)}>{value}</div>
      {sub && <div className="text-xs text-gray-600">{sub}</div>}
    </div>
  )
}

// ── Risk Heatmap Row ────────────────────────────────────────────────────────

function RiskHeatmapRow({ row }) {
  const pctZR = row.pct_zone_redundant || 0
  const riskColor = row.avg_risk >= 70 ? '#ef4444' : row.avg_risk >= 50 ? '#f97316' : row.avg_risk >= 30 ? '#eab308' : '#22c55e'
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-800/30 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-300 font-mono truncate">{row.subscription_id?.slice(-12) || 'unknown'}</p>
        <p className="text-xs text-gray-600">{row.total} resources {row.has_qatar && <span className="text-orange-400 ml-1">Qatar Central</span>}</p>
      </div>
      <div className="flex-1">
        <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-800 gap-px">
          {Object.entries(ZONE_COLOR_MAP).map(([status, color]) => {
            const count = row[status] || 0
            if (!count) return null
            const pct = (count / row.total * 100).toFixed(1)
            return <div key={status} style={{ width: `${pct}%`, backgroundColor: color }} title={`${status}: ${count}`} />
          })}
        </div>
        <p className="text-xs text-gray-600 mt-0.5">{pctZR}% zone-redundant</p>
      </div>
      <div className="shrink-0 text-right">
        <span className="text-sm font-bold tabular-nums" style={{ color: riskColor }}>{row.avg_risk}</span>
        <p className="text-xs text-gray-600">avg risk</p>
      </div>
    </div>
  )
}

// ── High Risk Resource Row ──────────────────────────────────────────────────

function HighRiskRow({ item, onClick }) {
  return (
    <button
      onClick={() => onClick && onClick(item)}
      className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-gray-800/40 transition-colors text-left group"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate group-hover:text-blue-300">{item.resource_name}</p>
        <p className="text-xs text-gray-500 truncate">{item.resource_type?.split('/').slice(-1)[0]} · {item.location} · {item.resource_group}</p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <ZoneStatusBadge status={item.zone_status} />
        <RiskBadge score={item.zone_risk_score} />
        <ChevronRight size={13} className="text-gray-600 group-hover:text-gray-400" />
      </div>
    </button>
  )
}

// ── Main BCDRDashboard ──────────────────────────────────────────────────────

export default function BCDRDashboard({ onSelectResource }) {
  const [summary, setSummary]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [selectedResource, setSelectedResource] = useState(null)

  function handleSelectResource(item) {
    if (item?.resource_id) { setSelectedResource(item); return; }
    onSelectResource && onSelectResource(item);
  }
  const [error,   setError]     = useState(null)
  const [activeHeatmapIdx, setActiveHeatmapIdx] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [biaData, setBiaData]     = useState(null)
  const [biaLoading, setBiaLoading] = useState(false)
  const [seqData, setSeqData]     = useState(null)
  const [seqLoading, setSeqLoading] = useState(false)
  // Recovery Sequence scope filters. The server applies them BEFORE computing dependency
  // edges and waves so the result reflects the chosen scope honestly (a 'Foundation' wave
  // is only labelled that way if it actually contains foundation resources).
  const [seqFilters, setSeqFilters] = useState({
    subscription_id: '', resource_group: '', resource_type: '', azure_tag: '', custom_tag: '',
  })

  function load() {
    setLoading(true)
    setError(null)
    api.getBCDRDashboard()
      .then(d => { setSummary(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  // Lazy-load BIA data
  useEffect(() => {
    if (activeTab === 'bia' && !biaData && !biaLoading) {
      setBiaLoading(true)
      api.getBCDRBusinessImpact()
        .then(d => setBiaData(d))
        .catch(() => {})
        .finally(() => setBiaLoading(false))
    }
  }, [activeTab, biaData, biaLoading])

  // Lazy-load Recovery Sequence data — re-fetches whenever the user changes a filter so
  // wave membership + RTO totals stay grounded on the current scope. The previous result is
  // kept on screen while the new one loads so the UI doesn't flash empty.
  useEffect(() => {
    if (activeTab !== 'recovery') return
    setSeqLoading(true)
    api.getBCDRRecoverySeq(seqFilters)
      .then(d => setSeqData(d))
      .catch(() => {})
      .finally(() => setSeqLoading(false))
  }, [activeTab, seqFilters])

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="relative">
        <RefreshCw size={32} className="text-blue-400 animate-spin" />
      </div>
      <div className="text-center space-y-2">
        <p className="text-base font-medium text-gray-300">Running BCDR Assessment...</p>
        <p className="text-sm text-gray-500">Analyzing zone redundancy and disaster recovery readiness</p>
        <div className="flex items-center justify-center gap-1 mt-3">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )

  if (error) return (
    <div className="card flex flex-col gap-3 p-6">
      <div className="flex items-start gap-3 text-red-400">
        <AlertTriangle size={20} className="shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <div>
            <p className="font-semibold text-base">BCDR Assessment Unavailable</p>
            <p className="text-sm text-red-400/90 mt-1">{error}</p>
          </div>
          {error.includes('HTML') && (
            <div className="rounded-lg bg-gray-900/60 border border-gray-700/50 p-3 space-y-1.5">
              <p className="text-xs text-gray-400 font-medium">Possible causes:</p>
              <ul className="text-xs text-gray-500 space-y-0.5 pl-4">
                <li>• Backend server may be offline or restarting</li>
                <li>• Network connectivity issue</li>
                <li>• Try refreshing the main dashboard first, then retry</li>
              </ul>
            </div>
          )}
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm text-white font-medium transition-colors shrink-0"
        >
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    </div>
  )

  if (!summary || summary.total === 0) return (
    <div className="card text-center text-gray-500 py-12">
      <Shield size={32} className="mx-auto mb-3 opacity-30" />
      <p>No resources found. Refresh the main dashboard first.</p>
    </div>
  )

  const zoneBreakdown = summary.zone_breakdown || {}
  const tierBreakdown = summary.tier_breakdown || {}
  const heatmap       = summary.risk_heatmap   || []
  const highRisk      = summary.high_risk_resources || []

  // New chart data from Phase1 PowerShell integration
  const topTypes       = summary.top_resource_types || {}
  const riskExposure   = summary.risk_exposure || {}
  const crossRegion    = summary.cross_region_status || {}
  const regionDist     = summary.regional_distribution || {}
  const nonzonalTypes  = summary.nonzonal_by_type || {}
  const iaasPaasPlatform = summary.iaas_paas_platform || {}
  const subZoneBars    = summary.subscription_zone_breakdown || []
  const qatarRoc       = summary.qatar_roc_summary || null

  return (
    <>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield size={20} className="text-blue-400" />
            BCDR Assessment Dashboard
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Microsoft Qatar SA-Level Analysis · Zone Redundancy · Cross-Region DR Readiness
          </p>
        </div>
        <div className="flex items-center gap-2">
          {summary.qatar_central_count > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-900/20 border border-orange-700/40 text-xs text-orange-300">
              <AlertTriangle size={12} />
              Qatar Central: {summary.qatar_central_count} resources — ZR DISABLED
            </div>
          )}
          <button
            onClick={() => { setSummary(null); setLoading(true); api.refreshBCDR().then(() => api.getBCDRDashboard()).then(d => { setSummary(d); setLoading(false) }).catch(e => { setError(e.message); setLoading(false) }) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs text-gray-300 transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-gray-800 pb-1">
        {[
          { key: 'overview', label: 'Overview', Icon: BarChart2 },
          { key: 'bia', label: 'Business Impact', Icon: Building2 },
          { key: 'recovery', label: 'Recovery Sequence', Icon: RefreshCw },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={clsx('px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors flex items-center gap-1.5',
              activeTab === t.key ? 'bg-gray-800 text-blue-400 border border-gray-700 border-b-0' : 'text-gray-500 hover:text-gray-300'
            )}>
            <t.Icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (<>

      {/* Qatar Central — BCDR Best Practices (region-level resilience guidance) */}
      <div className="rounded-xl border border-sky-800/50 bg-sky-950/30 p-4">
        <div className="flex items-start gap-3">
          <Globe size={18} className="text-sky-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-sky-300">Qatar Central — BCDR Best Practices</p>
            <p className="text-xs text-sky-200/80 mt-1 leading-relaxed">
              Zone redundancy protects against a datacenter or availability-zone failure <strong>within</strong> a
              region — it does <strong>not</strong> protect against a full regional outage. Business continuity and
              disaster recovery for line-of-business applications critical to business function must be designed
              <strong> cross-region</strong> to provide redundancy and high availability across regional failures.
              It is recommended that, even before deploying cross-region DR capabilities for a workload, customers
              first establish <strong>cross-region backup</strong> using the <strong>Region-of-Choice (RoC)</strong> capability.
            </p>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          icon={Layers} label="Total Resources" value={summary.total}
          bgColor="bg-gray-800/60" borderColor="border-gray-700/50"
        />
        <KPICard
          icon={AlertTriangle} label="Need DR Action" value={summary.needs_dr_action}
          sub={`${Math.round(summary.needs_dr_action / summary.total * 100)}% of resources`}
          color="text-orange-400" bgColor="bg-orange-950/20" borderColor="border-orange-800/40"
        />
        <KPICard
          icon={Activity} label="Avg Risk Score" value={summary.average_risk_score}
          sub="0 = safe · 100 = critical"
          color={summary.average_risk_score >= 60 ? 'text-red-400' : summary.average_risk_score >= 40 ? 'text-yellow-400' : 'text-green-400'}
          bgColor="bg-gray-800/60" borderColor="border-gray-700/50"
        />
        <KPICard
          icon={CheckCircle} label="Geo-Redundant" value={summary.geo_redundant}
          sub={`${Math.round(summary.geo_redundant / summary.total * 100)}% of resources`}
          color="text-green-400" bgColor="bg-green-950/20" borderColor="border-green-800/40"
        />
      </div>

      {/* Zone breakdown + Tier breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <Globe size={14} className="text-blue-400" />
            Zone Redundancy Status
          </h3>
          <div className="flex items-center gap-6">
            <DonutChart data={zoneBreakdown} size={120} />
            <div className="flex-1 space-y-2">
              {Object.entries(zoneBreakdown).map(([status, count]) => (
                <div key={status} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ZONE_COLOR_MAP[status] || '#6b7280' }} />
                  <span className="text-xs text-gray-400 flex-1">{status}</span>
                  <span className="text-xs font-semibold text-gray-200 tabular-nums">{count}</span>
                  <span className="text-xs text-gray-600">{Math.round(count / summary.total * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <Target size={14} className="text-purple-400" />
            Workload Tier Breakdown
          </h3>
          <div className="space-y-2">
            {Object.entries(tierBreakdown).sort((a, b) => {
              const order = { Production: 0, 'Non-Production': 1, 'Dev/Test': 2, Sandbox: 3, Unknown: 4 }
              return (order[a[0]] ?? 5) - (order[b[0]] ?? 5)
            }).map(([tier, count]) => {
              const pct = (count / summary.total * 100).toFixed(0)
              const color = { Production: '#ef4444', 'Non-Production': '#f97316', 'Dev/Test': '#eab308', Sandbox: '#22c55e', Unknown: '#6b7280' }[tier] || '#6b7280'
              return (
                <div key={tier}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-400">{tier}</span>
                    <span className="text-gray-300 font-medium tabular-nums">{count} <span className="text-gray-600">({pct}%)</span></span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Estate Overview Charts (Phase 1 PowerShell Dashboard) ─────────── */}

      {/* Row: Risk Exposure + Cross-Region + IaaS/PaaS/Platform */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Object.keys(riskExposure).length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-400" />
              Risk Assessment — Zone Exposure
            </h3>
            <div className="flex items-center gap-4">
              <ColoredDonut data={riskExposure} colorMap={RISK_COLORS} size={110} />
              <DonutLegend data={riskExposure} colorMap={RISK_COLORS} />
            </div>
          </div>
        )}
        {Object.keys(crossRegion).length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <Globe size={14} className="text-green-400" />
              Cross-Region Replication Status
            </h3>
            <div className="flex items-center gap-4">
              <ColoredDonut data={crossRegion} colorMap={CROSS_REGION_COLORS} size={110} />
              <DonutLegend data={crossRegion} colorMap={CROSS_REGION_COLORS} />
            </div>
          </div>
        )}
        {Object.keys(iaasPaasPlatform).length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <Layers size={14} className="text-indigo-400" />
              IaaS vs PaaS vs Platform
            </h3>
            <div className="flex items-center gap-4">
              <ColoredDonut data={iaasPaasPlatform} colorMap={IAAS_PAAS_COLORS} size={110} />
              <DonutLegend data={iaasPaasPlatform} colorMap={IAAS_PAAS_COLORS} />
            </div>
          </div>
        )}
      </div>

      {/* Row: Top Resource Types + Regional Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.keys(topTypes).length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <BarChart2 size={14} className="text-blue-400" />
              Top Resource Types by Count
            </h3>
            <HBarChart data={topTypes} maxBars={12} />
          </div>
        )}
        {Object.keys(regionDist).length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <MapPin size={14} className="text-cyan-400" />
              Regional Distribution
            </h3>
            <HBarChart data={regionDist} maxBars={10} />
          </div>
        )}
      </div>

      {/* Row: Non-Zonal by Type + Zone Status by Subscription */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.keys(nonzonalTypes).length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <AlertTriangle size={14} className="text-orange-400" />
              Non-Zonal Resources by Type
              <span className="text-xs text-gray-600 font-normal">— highest exposure</span>
            </h3>
            <HBarChart data={nonzonalTypes} maxBars={12} />
          </div>
        )}
        {subZoneBars.length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <BarChart2 size={14} className="text-purple-400" />
              Zone Status by Subscription
            </h3>
            <SubscriptionZoneBar rows={subZoneBars} />
          </div>
        )}
      </div>

      {/* Qatar Region of Choice (RoC) Info Card */}
      {qatarRoc && (
        <div className="card border-blue-800/40 bg-blue-950/20">
          <h3 className="text-sm font-semibold text-blue-300 mb-3 flex items-center gap-2">
            <Info size={14} className="text-blue-400" />
            Azure Backup — Region of Choice (RoC) — Preview
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Qatar Central Resources</p>
              <div className="space-y-1 text-xs text-gray-300">
                <p>Total Qatar Resources: <span className="font-semibold text-white">{qatarRoc.total_qatar_resources}</span></p>
                <p>VMs in Qatar: <span className="font-semibold text-white">{qatarRoc.vms_in_qatar}</span></p>
                <p>Recovery Vaults: <span className="font-semibold text-white">{qatarRoc.recovery_vaults_in_qatar}</span></p>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">RoC Target Regions</p>
              <div className="space-y-1">
                {qatarRoc.roc_target_regions?.map(r => (
                  <div key={r} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-900/40 border border-blue-800/50 text-xs text-blue-300 mr-2">
                    <MapPin size={10} /> {r}
                  </div>
                ))}
              </div>
              <p className="text-xs text-yellow-400/80 mt-2 flex items-start gap-1">
                <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                SDC/SZN are NOT NIA/NCSA certified. For regulated workloads, use West/North Europe.
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Supported Workloads</p>
              <div className="flex flex-wrap gap-1">
                {qatarRoc.roc_supported_workloads?.map(w => (
                  <span key={w} className="px-1.5 py-0.5 rounded text-xs bg-green-900/30 text-green-300 border border-green-800/40">{w}</span>
                ))}
              </div>
              {qatarRoc.roc_not_supported?.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-gray-500 mb-1">Not Supported:</p>
                  {qatarRoc.roc_not_supported.map(w => (
                    <span key={w} className="px-1.5 py-0.5 rounded text-xs bg-red-900/30 text-red-300 border border-red-800/40">{w}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3 border-t border-gray-800 pt-2">{qatarRoc.note}</p>
        </div>
      )}

      {/* Risk Heatmap */}
      {heatmap.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <BarChart2 size={14} className="text-red-400" />
            Subscription Risk Heatmap
            <span className="text-xs text-gray-600 font-normal ml-1">— sorted by average risk score</span>
          </h3>
          <div className="divide-y divide-gray-800/50">
            {heatmap.slice(0, 8).map((row, i) => (
              <RiskHeatmapRow key={i} row={row} />
            ))}
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-800 flex-wrap">
            {Object.entries(ZONE_COLOR_MAP).map(([label, color]) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                <span className="text-xs text-gray-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* High Risk Resources */}
      {highRisk.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-400" />
              High-Risk Resources
              <span className="text-xs text-gray-600 font-normal">risk score ≥ 70</span>
            </h3>
          </div>
          <div className="divide-y divide-gray-800/50">
            {highRisk.slice(0, 10).map((item, i) => (
              <HighRiskRow key={i} item={item} onClick={handleSelectResource} />
            ))}
          </div>
        </div>
      )}
      </>)}

      {/* ── Business Impact Analysis Tab ── */}
      {activeTab === 'bia' && (
        <BIATab data={biaData} loading={biaLoading} />
      )}

      {/* ── Recovery Sequence Tab ── */}
      {activeTab === 'recovery' && (
        <RecoverySequenceTab
          data={seqData}
          loading={seqLoading}
          filters={seqFilters}
          onChangeFilters={setSeqFilters}
        />
      )}

    </div>

      {selectedResource && (
        <ResourceDetailDrawer
          resourceId={selectedResource.resource_id}
          resourceName={selectedResource.resource_name}
          onClose={() => setSelectedResource(null)}
        />
      )}
    </>
  )
}

// ── BIA Tab Component ───────────────────────────────────────────────────────

const BIA_TIER_COLORS = {
  'Mission-Critical':     '#ef4444',
  'Business-Critical':    '#f97316',
  'Business-Operational': '#eab308',
  'Low':                  '#22c55e',
}

function BIASourceBadge({ source }) {
  const tagged = source === 'Tagged'
  return (
    <span
      title={tagged ? 'Classified from your BCDR Planning tags (authoritative)' : 'Inferred from resource type, cost & zone risk'}
      className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap',
        tagged ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700/50' : 'bg-gray-800 text-gray-500 border-gray-700')}>
      {tagged ? 'Tagged' : 'Inferred'}
    </span>
  )
}

// ── BIA filtering + client-side recompute ───────────────────────────────────
const BIA_TIER_ORDER = ['Mission-Critical', 'Business-Critical', 'Business-Operational', 'Low']
const BIA_TIER_RTO = { 'Mission-Critical': 0.25, 'Business-Critical': 1.0, 'Business-Operational': 4.0, 'Low': 24.0 }
const BIA_ALL = '__all__'
const biaTagPairs = (obj) => Object.entries(obj || {})
  .filter(([k, v]) => k && v != null && String(v).trim() !== '')
  .map(([k, v]) => `${k}=${v}`)

// Recompute tiers / top list / grounding for an arbitrary (filtered) subset of rows,
// so the whole BIA reflects exactly the resources the user selected.
function recomputeBIA(rows) {
  const byTier = {}
  rows.forEach((r) => { (byTier[r.bia_tier] = byTier[r.bia_tier] || []).push(r) })
  const total = rows.length
  const tier_summary = BIA_TIER_ORDER.filter((t) => (byTier[t] || []).length).map((t) => {
    const items = byTier[t]
    return {
      tier: t,
      count: items.length,
      pct: total ? Math.round((items.length / total) * 1000) / 10 : 0,
      avg_impact_score: Math.round((items.reduce((a, i) => a + (i.impact_score || 0), 0) / items.length) * 10) / 10,
      est_downtime_cost_hr: Math.round((items.reduce((a, i) => a + (i.downtime_cost_hr || 0), 0) / items.length) * 100) / 100,
      target_rto_hours: BIA_TIER_RTO[t] ?? 24,
    }
  })
  const sorted = [...rows].sort((a, b) => (b.impact_score || 0) - (a.impact_score || 0))
  return {
    total_resources: total,
    tier_summary,
    impact_matrix: sorted,
    top_critical: sorted.slice(0, 10),
    tagged_count: rows.filter((r) => r.criticality_source === 'Tagged').length,
    stated_downtime_count: rows.filter((r) => r.downtime_cost_source === 'Stated').length,
  }
}

function BIAFilter({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-gray-900 border border-gray-700/70 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 min-w-[140px] focus:border-blue-500 outline-none">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function BIATab({ data, loading }) {
  const allRows = React.useMemo(() => (data && data.impact_matrix) || [], [data])

  // ── Context filters (subscription / RG / type / Azure tag / custom tag) ─────
  const [fSub, setFSub] = React.useState(BIA_ALL)
  const [fRg, setFRg] = React.useState(BIA_ALL)
  const [fType, setFType] = React.useState(BIA_ALL)
  const [fAz, setFAz] = React.useState(BIA_ALL)
  const [fCt, setFCt] = React.useState(BIA_ALL)

  const opts = React.useMemo(() => {
    const uniq = (key) => Array.from(new Set(allRows.map((r) => r[key]).filter(Boolean))).sort()
    const mk = (vals, allLabel, labelFn) => [{ value: BIA_ALL, label: allLabel },
      ...vals.map((v) => ({ value: v, label: labelFn ? labelFn(v) : v }))]
    const subMap = new Map()
    allRows.forEach((r) => { if (r.subscription_id) subMap.set(r.subscription_id, r.subscription_name || (r.subscription_id.slice(0, 8) + '\u2026')) })
    const az = new Set(), ct = new Set()
    allRows.forEach((r) => { biaTagPairs(r.azure_tags).forEach((p) => az.add(p)); biaTagPairs(r.custom_tags).forEach((p) => ct.add(p)) })
    const mkPairs = (set, allLabel) => [{ value: BIA_ALL, label: allLabel },
      ...Array.from(set).sort().map((p) => ({ value: p, label: p.replace('=', ': ') }))]
    return {
      sub: [{ value: BIA_ALL, label: 'All subscriptions' }, ...Array.from(subMap.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([id, name]) => ({ value: id, label: name }))],
      rg: mk(uniq('resource_group'), 'All resource groups'),
      type: mk(uniq('resource_type'), 'All types', (t) => prettyResourceType(t) || t.split('/').pop()),
      az: mkPairs(az, 'All Azure tags'),
      ct: mkPairs(ct, 'All custom tags'),
    }
  }, [allRows])

  const rows = React.useMemo(() => allRows.filter((r) =>
    (fSub === BIA_ALL || r.subscription_id === fSub) &&
    (fRg === BIA_ALL || r.resource_group === fRg) &&
    (fType === BIA_ALL || r.resource_type === fType) &&
    (fAz === BIA_ALL || biaTagPairs(r.azure_tags).includes(fAz)) &&
    (fCt === BIA_ALL || biaTagPairs(r.custom_tags).includes(fCt)),
  ), [allRows, fSub, fRg, fType, fAz, fCt])

  const view = React.useMemo(() => recomputeBIA(rows), [rows])
  const { tier_summary, impact_matrix, top_critical } = view
  const taggedCount = view.tagged_count
  const totalRes = view.total_resources
  const statedCount = view.stated_downtime_count
  const anyFilter = [fSub, fRg, fType, fAz, fCt].some((v) => v !== BIA_ALL)
  const clearFilters = () => { setFSub(BIA_ALL); setFRg(BIA_ALL); setFType(BIA_ALL); setFAz(BIA_ALL); setFCt(BIA_ALL) }

  if (loading) return (
    <div className="flex items-center justify-center h-48 gap-3">
      <RefreshCw size={20} className="text-blue-400 animate-spin" />
      <span className="text-gray-400 text-sm">Running Business Impact Analysis…</span>
    </div>
  )
  if (!data || !data.total_resources) return (
    <div className="card text-center text-gray-500 py-12">
      <Target size={32} className="mx-auto mb-3 opacity-30" />
      <p>No BIA data available. Run a scan first.</p>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Context filter bar — scope the BIA to selected resources */}
      <div className="flex flex-wrap items-end gap-2.5 rounded-xl border border-gray-800 bg-gray-900/40 p-3">
        <BIAFilter label="Subscription" value={fSub} onChange={setFSub} options={opts.sub} />
        <BIAFilter label="Resource Group" value={fRg} onChange={setFRg} options={opts.rg} />
        <BIAFilter label="Resource Type" value={fType} onChange={setFType} options={opts.type} />
        {opts.az.length > 1 && <BIAFilter label="Azure Tag" value={fAz} onChange={setFAz} options={opts.az} />}
        {opts.ct.length > 1 && <BIAFilter label="Custom Tag" value={fCt} onChange={setFCt} options={opts.ct} />}
        {anyFilter && (
          <button onClick={clearFilters} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 border border-gray-700/60">
            <X size={12} /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-500 self-center">
          <span className="text-gray-300 font-semibold tabular-nums">{rows.length}</span> of {allRows.length} resources
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="card text-center text-gray-500 py-12">
          <Filter size={28} className="mx-auto mb-2 opacity-30" />
          <p>No resources match these filters.</p>
        </div>
      ) : (<>
      {/* Advanced AI BIA — consultant-grade, framework-based, over the filtered resources */}
      <BIAGenerator
        resourceIds={rows.map((r) => r.resource_id).filter(Boolean)}
        resourceCount={rows.length}
      />

      {/* Grounding banner — how much of the BIA is driven by the customer's BCDR tags */}
      <div className={clsx('rounded-xl border p-3 flex items-start gap-2.5',
        taggedCount > 0 ? 'border-emerald-800/50 bg-emerald-950/20' : 'border-gray-700/50 bg-gray-800/30')}>
        <Info size={15} className={clsx('shrink-0 mt-0.5', taggedCount > 0 ? 'text-emerald-400' : 'text-gray-500')} />
        <div className="text-xs leading-relaxed">
          {taggedCount > 0 ? (
            <p className="text-emerald-200/90">
              <strong>{taggedCount} of {totalRes}</strong> resources are classified directly from your BCDR Planning
              tags (criticality{statedCount > 0 ? ', financial loss/hr' : ''}, RTO/RPO) — these drive the tiers below
              as authoritative business intent. The remaining <strong>{totalRes - taggedCount}</strong> are inferred
              from resource type, cost &amp; zone risk.
            </p>
          ) : (
            <p className="text-gray-400">
              No BCDR Planning tags found yet — tiers below are <strong>inferred</strong> from resource type, cost &amp;
              zone risk. Classify resources in <strong>BCDR Planning</strong> (criticality, RTO/RPO, financial loss per
              hour) to ground this analysis in your business intent.
            </p>
          )}
        </div>
      </div>

      {/* Tier Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tier_summary.map(t => {
          const color = BIA_TIER_COLORS[t.tier] || '#6b7280'
          return (
            <div key={t.tier} className="rounded-xl border p-4" style={{ borderColor: color + '40', background: color + '10' }}>
              <div className="text-xs uppercase tracking-wider font-medium mb-1" style={{ color }}>{t.tier}</div>
              <div className="text-2xl font-bold text-white">{t.count}</div>
              <div className="text-xs text-gray-500">{t.pct}% of resources</div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="text-gray-500">Avg Impact</span>
                <span className="font-semibold" style={{ color }}>{t.avg_impact_score}</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-gray-500">Target RTO</span>
                <span className="text-gray-300">{t.target_rto_hours}h</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-gray-500">Downtime $/hr</span>
                <span className="text-gray-300">${Math.round(t.est_downtime_cost_hr).toLocaleString()}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Impact Score Distribution Bar */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <Target size={14} className="text-purple-400" />
          Impact Score Distribution
        </h3>
        <div className="flex h-6 rounded-full overflow-hidden bg-gray-800">
          {tier_summary.map(t => {
            const color = BIA_TIER_COLORS[t.tier] || '#6b7280'
            return (
              <div key={t.tier} style={{ width: `${t.pct}%`, backgroundColor: color }} title={`${t.tier}: ${t.count} (${t.pct}%)`} />
            )
          })}
        </div>
        <div className="flex items-center gap-4 mt-3 flex-wrap">
          {tier_summary.map(t => (
            <div key={t.tier} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BIA_TIER_COLORS[t.tier] || '#6b7280' }} />
              <span className="text-xs text-gray-500">{t.tier} ({t.count})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top 10 Critical Resources */}
      {top_critical?.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-400" />
            Top 10 Highest-Impact Resources
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Resource', 'Type', 'Location', 'Impact', 'BIA Tier', 'Source', 'Workload Tier', 'Zone', 'RTO', 'Downtime $/hr'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-gray-500 uppercase tracking-wider font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {top_critical.map((r, i) => {
                  const tierColor = BIA_TIER_COLORS[r.bia_tier] || '#6b7280'
                  return (
                    <tr key={i} className="hover:bg-gray-800/40">
                      <td className="px-3 py-2">
                        <div className="font-medium text-white truncate max-w-[200px]">{r.resource_name}</div>
                        <div className="text-gray-600 truncate max-w-[200px]">{r.resource_group}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-400">{r.resource_type?.split('/').pop()}</td>
                      <td className="px-3 py-2 text-gray-400">{r.location}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${r.impact_score}%`, backgroundColor: tierColor }} />
                          </div>
                          <span className="font-bold tabular-nums" style={{ color: tierColor }}>{r.impact_score}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold border" style={{ color: tierColor, borderColor: tierColor + '40', background: tierColor + '15' }}>
                          {r.bia_tier}
                        </span>
                      </td>
                      <td className="px-3 py-2"><BIASourceBadge source={r.criticality_source} /></td>
                      <td className="px-3 py-2 text-gray-400">{r.workload_tier}</td>
                      <td className="px-3 py-2"><ZoneStatusBadge status={r.zone_status} /></td>
                      <td className="px-3 py-2 text-gray-300">{r.rto_target || `${r.target_rto_hours}h`}</td>
                      <td className="px-3 py-2 text-gray-300">${Math.round(r.downtime_cost_hr).toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full Impact Matrix (truncated) */}
      {impact_matrix?.length > 10 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Layers size={14} className="text-blue-400" />
            Full BIA Matrix ({totalRes} resources)
          </h3>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="border-b border-gray-800">
                  {['Resource', 'Impact', 'BIA Tier', 'Source', 'Cost/mo', 'Type Wt', 'Cost Wt', 'Tier Boost', 'Risk Pen.'].map(h => (
                    <th key={h} className="text-left px-2 py-2 text-gray-500 uppercase tracking-wider font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/30">
                {impact_matrix.map((r, i) => {
                  const tierColor = BIA_TIER_COLORS[r.bia_tier] || '#6b7280'
                  return (
                    <tr key={i} className="hover:bg-gray-800/30">
                      <td className="px-2 py-1.5 text-gray-300 truncate max-w-[180px]">{r.resource_name}</td>
                      <td className="px-2 py-1.5 font-bold tabular-nums" style={{ color: tierColor }}>{r.impact_score}</td>
                      <td className="px-2 py-1.5" style={{ color: tierColor }}>{r.bia_tier}</td>
                      <td className="px-2 py-1.5"><BIASourceBadge source={r.criticality_source} /></td>
                      <td className="px-2 py-1.5 text-gray-400">${Math.round(r.monthly_cost)}</td>
                      <td className="px-2 py-1.5 text-gray-500">{r.type_weight}</td>
                      <td className="px-2 py-1.5 text-gray-500">{r.cost_weight}</td>
                      <td className="px-2 py-1.5 text-gray-500">{r.tier_boost > 0 ? '+' : ''}{r.tier_boost}</td>
                      <td className="px-2 py-1.5 text-gray-500">{r.risk_penalty > 0 ? '+' : ''}{r.risk_penalty}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>)}
    </div>
  )
}

// ── Recovery Sequence Tab Component ─────────────────────────────────────────

const WAVE_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#22c55e', '#f97316', '#ec4899', '#eab308', '#64748b']

// Server-driven filter options. We derive them from the SAME resource list that drove the
// BIA tab (data.impact_matrix) so the dropdowns are consistent across tabs.
function useSeqFilterOptions() {
  const [opts, setOpts] = React.useState({ sub: [], rg: [], type: [], az: [], ct: [] })
  React.useEffect(() => {
    let alive = true
    api.getBCDRBusinessImpact()
      .then(d => {
        if (!alive) return
        const rows = (d && d.impact_matrix) || []
        const uniq = (key) => Array.from(new Set(rows.map(r => r[key]).filter(Boolean))).sort()
        const subMap = new Map()
        rows.forEach(r => { if (r.subscription_id) subMap.set(r.subscription_id, r.subscription_name || (r.subscription_id.slice(0, 8) + '\u2026')) })
        const az = new Set(), ct = new Set()
        rows.forEach(r => { biaTagPairs(r.azure_tags).forEach(p => az.add(p)); biaTagPairs(r.custom_tags).forEach(p => ct.add(p)) })
        setOpts({
          sub:  Array.from(subMap.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([id, name]) => ({ value: id, label: name })),
          rg:   uniq('resource_group').map(v => ({ value: v, label: v })),
          type: uniq('resource_type').map(v => ({ value: v, label: prettyResourceType(v) || v.split('/').pop() })),
          az:   Array.from(az).sort().map(p => ({ value: p, label: p.replace('=', ': ') })),
          ct:   Array.from(ct).sort().map(p => ({ value: p, label: p.replace('=', ': ') })),
        })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return opts
}

function RecoverySequenceTab({ data, loading, filters, onChangeFilters }) {
  const opts = useSeqFilterOptions()
  const setF = (k, v) => onChangeFilters({ ...filters, [k]: v })
  const clearF = () => onChangeFilters({ subscription_id: '', resource_group: '', resource_type: '', azure_tag: '', custom_tag: '' })
  const anyFilter = Object.values(filters || {}).some(v => v)
  const scope = data?.scope || {}

  const filterBar = (
    <div className="flex flex-wrap items-end gap-2.5 rounded-xl border border-gray-800 bg-gray-900/40 p-3">
      <BIAFilter label="Subscription"    value={filters.subscription_id} onChange={v => setF('subscription_id', v)} options={[{ value: '', label: 'All subscriptions' }, ...opts.sub]} />
      <BIAFilter label="Resource Group"  value={filters.resource_group}  onChange={v => setF('resource_group',  v)} options={[{ value: '', label: 'All resource groups' }, ...opts.rg]} />
      <BIAFilter label="Resource Type"   value={filters.resource_type}   onChange={v => setF('resource_type',   v)} options={[{ value: '', label: 'All types' }, ...opts.type]} />
      {opts.az.length > 0 && <BIAFilter label="Azure Tag"  value={filters.azure_tag}  onChange={v => setF('azure_tag',  v)} options={[{ value: '', label: 'All Azure tags' }, ...opts.az]} />}
      {opts.ct.length > 0 && <BIAFilter label="Custom Tag" value={filters.custom_tag} onChange={v => setF('custom_tag', v)} options={[{ value: '', label: 'All custom tags' }, ...opts.ct]} />}
      {anyFilter && (
        <button onClick={clearF} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 border border-gray-700/60">
          <X size={12} /> Clear
        </button>
      )}
      <span className="ml-auto text-xs text-gray-500 self-center">
        {scope.scoped_resources != null ? (
          <><span className="text-gray-300 font-semibold tabular-nums">{scope.scoped_resources}</span> of {scope.total_resources} resources</>
        ) : (loading ? 'Computing…' : '')}
      </span>
    </div>
  )

  const ctxBanner = (
    <div className={clsx('rounded-xl border p-3 flex items-start gap-2.5',
      anyFilter ? 'border-emerald-800/50 bg-emerald-950/20' : 'border-amber-700/40 bg-amber-900/15')}>
      <Info size={15} className={clsx('shrink-0 mt-0.5', anyFilter ? 'text-emerald-400' : 'text-amber-400')} />
      <div className="text-xs leading-relaxed">
        {anyFilter ? (
          <p className="text-emerald-200/90">
            Recovery sequence is <strong>scoped</strong> to your filter — dependency edges, waves and the cumulative
            RTO below only consider in-scope resources. Wave labels are derived from the actual content of each wave.
          </p>
        ) : (
          <p className="text-amber-200/90">
            <strong>No scope applied — viewing the entire estate.</strong> With resources spanning multiple
            subscriptions / regions, the sequence collapses most resources into Wave 1 because cross-subscription
            dependency edges are rare. Pick a <strong>Subscription</strong>, <strong>Resource Group</strong> or
            <strong> Custom Tag</strong> (e.g. <code className="px-1 py-0.5 rounded bg-gray-900/60">Application=Orders</code>)
            for a sequence that maps to one workload.
          </p>
        )}
      </div>
    </div>
  )

  if (loading && !data) return (
    <div className="space-y-4">
      {filterBar}
      <div className="flex items-center justify-center h-48 gap-3">
        <RefreshCw size={20} className="text-blue-400 animate-spin" />
        <span className="text-gray-400 text-sm">Building Recovery Sequence Plan…</span>
      </div>
    </div>
  )
  if (!data || !data.total_resources) return (
    <div className="space-y-4">
      {filterBar}
      {ctxBanner}
      <div className="card text-center text-gray-500 py-12">
        <Zap size={32} className="mx-auto mb-3 opacity-30" />
        <p>{anyFilter ? 'No resources match these filters.' : 'No recovery sequence data available. Run a scan first.'}</p>
      </div>
    </div>
  )

  const { waves, dependency_edges, total_dependencies, total_estimated_rto_hours } = data

  return (
    <div className="space-y-6">
      {filterBar}
      {ctxBanner}
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard icon={Layers} label="Recovery Waves" value={waves.length} sub="Parallel recovery groups" color="text-blue-400" />
        <KPICard icon={Zap} label="Dependencies" value={total_dependencies} sub="Resource relationships" color="text-purple-400" />
        <KPICard icon={Clock} label="Total Est. RTO" value={`${total_estimated_rto_hours}h`} sub="Cumulative recovery time" color={total_estimated_rto_hours > 8 ? 'text-red-400' : 'text-green-400'} />
        <KPICard icon={Target} label="Resources" value={data.total_resources} sub="In recovery plan" />
      </div>

      {/* Recovery Timeline */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <Clock size={14} className="text-cyan-400" />
          Recovery Timeline — Wave Sequence
        </h3>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-800" />

          {waves.map((w, i) => {
            const waveColor = WAVE_COLORS[i % WAVE_COLORS.length]
            return (
              <div key={i} className="relative pl-12 pb-6">
                {/* Timeline dot */}
                <div className="absolute left-3 top-1 w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold"
                  style={{ borderColor: waveColor, color: waveColor, background: 'var(--c-0f172a)' }}>
                  {w.wave}
                </div>

                <div className="rounded-xl border p-4" style={{ borderColor: waveColor + '30' }}>
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div>
                      <span className="text-sm font-semibold text-white">{w.label}</span>
                      <span className="ml-2 text-xs text-gray-500">{w.resource_count} resources</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-gray-500">Wave RTO: <span className="font-semibold" style={{ color: waveColor }}>{w.estimated_rto_hours}h</span></span>
                      <span className="text-gray-500">Cumulative: <span className="font-semibold text-white">{w.cumulative_rto_hours}h</span></span>
                      {w.parallel_recoverable && (
                        <span className="px-2 py-0.5 rounded-full bg-green-900/30 text-green-300 border border-green-800/40 text-xs flex items-center gap-1">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Parallel
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Resource list within wave */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {w.resources.slice(0, 12).map((r, j) => {
                      const tierColor = BIA_TIER_COLORS[r.bia_tier] || '#6b7280'
                      return (
                        <div key={j} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900/60 border border-gray-800/50">
                          <div className="w-1.5 h-8 rounded-full" style={{ backgroundColor: tierColor }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-gray-200 truncate">{r.resource_name}</div>
                            <div className="text-xs text-gray-600">{r.resource_type?.split('/').pop()}</div>
                          </div>
                          <div className="text-xs font-bold tabular-nums" style={{ color: tierColor }}>{r.impact_score}</div>
                        </div>
                      )
                    })}
                    {w.resources.length > 12 && (
                      <div className="flex items-center justify-center px-3 py-2 rounded-lg bg-gray-900/30 text-xs text-gray-600">
                        +{w.resources.length - 12} more
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Dependency Graph */}
      {dependency_edges?.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <TrendingUp size={14} className="text-orange-400" />
            Resource Dependencies ({total_dependencies})
          </h3>
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="border-b border-gray-800">
                  <th className="text-left px-3 py-2 text-gray-500 uppercase font-medium">Prerequisite</th>
                  <th className="text-center px-3 py-2 text-gray-500">→</th>
                  <th className="text-left px-3 py-2 text-gray-500 uppercase font-medium">Dependent</th>
                  <th className="text-left px-3 py-2 text-gray-500 uppercase font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/30">
                {dependency_edges.map((e, i) => (
                  <tr key={i} className="hover:bg-gray-800/30">
                    <td className="px-3 py-1.5 text-green-400 truncate max-w-[200px]">{e.from_name}</td>
                    <td className="px-3 py-1.5 text-center text-gray-600">→</td>
                    <td className="px-3 py-1.5 text-blue-400 truncate max-w-[200px]">{e.to_name}</td>
                    <td className="px-3 py-1.5 text-gray-500 truncate max-w-[300px]">{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* RTO Progress Bar */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <Activity size={14} className="text-green-400" />
          Cumulative Recovery Timeline
        </h3>
        <div className="flex items-center gap-1 h-8">
          {waves.map((w, i) => {
            const waveColor = WAVE_COLORS[i % WAVE_COLORS.length]
            const pct = total_estimated_rto_hours > 0 ? (w.estimated_rto_hours / total_estimated_rto_hours * 100) : (100 / waves.length)
            return (
              <div key={i} className="h-full rounded flex items-center justify-center text-xs font-bold text-white"
                style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: waveColor }}
                title={`Wave ${w.wave}: ${w.estimated_rto_hours}h (cumulative: ${w.cumulative_rto_hours}h)`}>
                W{w.wave}
              </div>
            )
          })}
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>0h</span>
          <span>{total_estimated_rto_hours}h total RTO</span>
        </div>
      </div>
    </div>
  )
}
