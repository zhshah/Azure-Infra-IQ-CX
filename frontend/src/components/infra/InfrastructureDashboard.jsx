import React, { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'
import {
  Server, Shield, DollarSign, Activity, Network, Tag,
  AlertTriangle, CheckCircle, TrendingUp, TrendingDown, Minus,
  BarChart2, PieChart, MapPin, Layers, Lock, Eye, Trash2,
  Zap, RefreshCw, ChevronDown, ChevronRight, Search, Brain,
  HardDrive, Database, Cloud, Globe, ArrowUpRight, ArrowDownRight,
  ShieldAlert, ShieldCheck, Archive, AlertCircle, Cpu, Box,
  FileText, ChevronUp, ExternalLink,
} from 'lucide-react'

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ icon: Icon, label, value, subValue, trend, color = 'text-blue-400', onClick }) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'rounded-xl border border-gray-800/60 bg-gray-900/50 p-4 transition-all',
        onClick && 'cursor-pointer hover:border-gray-700 hover:bg-gray-900/70',
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className={clsx('p-1.5 rounded-lg bg-gray-800/80')}>
            <Icon size={14} className={color} />
          </div>
          <span className="text-xs text-gray-500 font-medium">{label}</span>
        </div>
        {trend !== undefined && trend !== null && (
          <span className={clsx('text-xs flex items-center gap-0.5',
            trend > 0 ? 'text-red-400' : trend < 0 ? 'text-green-400' : 'text-gray-500')}>
            {trend > 0 ? <ArrowUpRight size={11} /> : trend < 0 ? <ArrowDownRight size={11} /> : <Minus size={11} />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <p className={clsx('text-2xl font-bold mt-2 tabular-nums', color)}>{value}</p>
      {subValue && <p className="text-xs text-gray-600 mt-0.5">{subValue}</p>}
    </div>
  )
}

// ── Progress Ring ────────────────────────────────────────────────────────────

function ProgressRing({ value, size = 64, label, color = '#3b82f6' }) {
  const r = (size / 2) - 5
  const circ = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const dash = (pct / 100) * circ

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth="5" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
        </svg>
        <span className="absolute text-sm font-bold text-white tabular-nums">{Math.round(pct)}%</span>
      </div>
      {label && <span className="text-xs text-gray-500">{label}</span>}
    </div>
  )
}

// ── Horizontal Bar ───────────────────────────────────────────────────────────

function HorizontalBar({ items, maxItems = 8 }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1
  const shown = items.slice(0, maxItems)
  return (
    <div className="space-y-2">
      {shown.map((item, idx) => (
        <div key={idx} className="space-y-0.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-300 truncate max-w-[60%]">{item.label}</span>
            <span className="text-gray-500 tabular-nums">{item.formatted || item.value}</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={clsx('h-full rounded-full', item.color || 'bg-blue-500')}
              style={{ width: `${Math.max(2, (item.value / total) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Score Distribution ───────────────────────────────────────────────────────

function ScoreDistribution({ dist }) {
  if (!dist) return null
  const items = [
    { label: 'Well Used (76-100)', count: dist.well_used || 0, color: 'bg-green-500', textColor: 'text-green-400' },
    { label: 'Underutilized (51-75)', count: dist.underutilized || 0, color: 'bg-yellow-500', textColor: 'text-yellow-400' },
    { label: 'Likely Waste (26-50)', count: dist.likely_waste || 0, color: 'bg-orange-500', textColor: 'text-orange-400' },
    { label: 'Confirmed Waste (0-25)', count: dist.confirmed_waste || 0, color: 'bg-red-500', textColor: 'text-red-400' },
    { label: 'No Metrics', count: dist.no_metrics || 0, color: 'bg-gray-600', textColor: 'text-gray-400' },
  ]
  const total = items.reduce((s, i) => s + i.count, 0) || 1

  return (
    <div className="space-y-2.5">
      {items.map(item => (
        <div key={item.label}>
          <div className="flex items-center justify-between text-xs mb-0.5">
            <span className={item.textColor}>{item.label}</span>
            <span className="text-gray-500 tabular-nums">{item.count}</span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className={clsx('h-full rounded-full transition-all', item.color)}
              style={{ width: `${Math.max(1, (item.count / total) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Top Cost Table ───────────────────────────────────────────────────────────

function TopCostTable({ resources }) {
  if (!resources?.length) return null
  const SCORE_COLOR = {
    'Fully Used': 'text-green-400',
    'Actively Used': 'text-blue-400',
    'Likely Waste': 'text-orange-400',
    'Confirmed Waste': 'text-red-400',
    'Unknown': 'text-gray-500',
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-800">
            <th className="text-left text-gray-500 font-medium py-2 pr-3">#</th>
            <th className="text-left text-gray-500 font-medium py-2 pr-3">Resource</th>
            <th className="text-left text-gray-500 font-medium py-2 pr-3">Type</th>
            <th className="text-right text-gray-500 font-medium py-2 pr-3">Cost/mo</th>
            <th className="text-right text-gray-500 font-medium py-2">Health</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r, i) => (
            <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/30">
              <td className="py-2 pr-3 text-gray-600">{i + 1}</td>
              <td className="py-2 pr-3 text-gray-200 font-medium truncate max-w-[180px]">{r.name}</td>
              <td className="py-2 pr-3 text-gray-500 truncate max-w-[120px]">{r.type}</td>
              <td className="py-2 pr-3 text-right text-green-400 tabular-nums">${r.cost?.toFixed(0)}</td>
              <td className={clsx('py-2 text-right', SCORE_COLOR[r.score_label] || 'text-gray-500')}>{r.score_label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Location Map (simplified) ────────────────────────────────────────────────

function LocationBreakdown({ byLocation }) {
  if (!byLocation) return null
  const sorted = Object.entries(byLocation)
    .map(([loc, d]) => ({ location: loc, ...d }))
    .sort((a, b) => b.cost - a.cost)

  const REGION_EMOJI = {
    'qatarcentral': '🇶🇦', 'westeurope': '🇪🇺', 'northeurope': '🇪🇺',
    'uaenorth': '🇦🇪', 'eastus': '🇺🇸', 'eastus2': '🇺🇸', 'westus': '🇺🇸',
    'centralus': '🇺🇸', 'southeastasia': '🌏', 'global': '🌍',
  }

  return (
    <div className="space-y-2">
      {sorted.map(r => (
        <div key={r.location} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-800/30">
          <span className="text-lg">{REGION_EMOJI[r.location.toLowerCase().replace(/\s/g, '')] || '📍'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-200 font-medium">{r.location}</span>
              <span className="text-xs text-green-400 tabular-nums">${r.cost.toFixed(0)}/mo</span>
            </div>
            <span className="text-xs text-gray-500">{r.count} resources</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Security Posture Panel ───────────────────────────────────────────────────

function SecurityPosture({ health }) {
  if (!health) return null
  const items = [
    { label: 'Backup Coverage', value: health.backup_coverage_pct, icon: Archive, good: health.backup_coverage_pct > 60 },
    { label: 'Resource Locks', value: health.lock_coverage_pct, icon: Lock, good: health.lock_coverage_pct > 30 },
    { label: 'Tag Compliance', value: health.tag_compliance_pct, icon: Tag, good: health.tag_compliance_pct > 70 },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-around">
        {items.map(item => (
          <ProgressRing
            key={item.label}
            value={item.value}
            label={item.label}
            color={item.good ? '#22c55e' : item.value > 30 ? '#f59e0b' : '#ef4444'}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-gray-800/60 bg-gray-800/30 p-3 text-center">
          <p className={clsx('text-xl font-bold tabular-nums', health.orphan_count > 0 ? 'text-orange-400' : 'text-green-400')}>
            {health.orphan_count}
          </p>
          <p className="text-xs text-gray-500">Orphaned Resources</p>
        </div>
        <div className="rounded-lg border border-gray-800/60 bg-gray-800/30 p-3 text-center">
          <p className={clsx('text-xl font-bold tabular-nums', health.deallocated_count > 0 ? 'text-yellow-400' : 'text-green-400')}>
            {health.deallocated_count}
          </p>
          <p className="text-xs text-gray-500">Deallocated VMs</p>
        </div>
        <div className="rounded-lg border border-gray-800/60 bg-gray-800/30 p-3 text-center col-span-2">
          <p className={clsx('text-xl font-bold tabular-nums', health.advisor_recommendations > 0 ? 'text-blue-400' : 'text-green-400')}>
            {health.advisor_recommendations}
          </p>
          <p className="text-xs text-gray-500">Azure Advisor Recommendations</p>
        </div>
      </div>
    </div>
  )
}

// ── Resource Group Explorer ──────────────────────────────────────────────────

function ResourceGroupExplorer({ byRg }) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)

  if (!byRg) return null
  const sorted = Object.entries(byRg)
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.cost - a.cost)
    .filter(rg => !search || rg.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search resource groups..."
          className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-800/60 border border-gray-700/60 rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50" />
      </div>
      <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
        {sorted.map(rg => (
          <div key={rg.name} className="rounded-lg border border-gray-800/50 bg-gray-900/30 overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === rg.name ? null : rg.name)}
              className="w-full flex items-center gap-3 p-3 hover:bg-gray-800/30 transition-colors text-left"
            >
              <Layers size={14} className="text-blue-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-200 font-medium truncate block">{rg.name}</span>
                <span className="text-xs text-gray-500">{rg.count} resources</span>
              </div>
              <span className="text-sm text-green-400 tabular-nums shrink-0">${rg.cost.toFixed(0)}/mo</span>
              {expanded === rg.name ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
            </button>
            {expanded === rg.name && (
              <div className="px-3 pb-3 pt-1 border-t border-gray-800/40">
                <div className="flex flex-wrap gap-1">
                  {(rg.types || []).map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700/50">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Waste & Savings Panel ────────────────────────────────────────────────────

function WasteSavingsPanel({ waste, scoreDist }) {
  if (!waste) return null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-red-800/40 bg-red-950/10 p-3 text-center">
          <p className="text-xl font-bold text-red-400 tabular-nums">${waste.confirmed_waste_cost?.toFixed(0)}</p>
          <p className="text-xs text-red-400/60">Confirmed Waste/mo</p>
        </div>
        <div className="rounded-xl border border-orange-800/40 bg-orange-950/10 p-3 text-center">
          <p className="text-xl font-bold text-orange-400 tabular-nums">${waste.likely_waste_cost?.toFixed(0)}</p>
          <p className="text-xs text-orange-400/60">Likely Waste/mo</p>
        </div>
        <div className="rounded-xl border border-green-800/40 bg-green-950/10 p-3 text-center">
          <p className="text-xl font-bold text-green-400 tabular-nums">${waste.total_potential_savings?.toFixed(0)}</p>
          <p className="text-xs text-green-400/60">Potential Savings/mo</p>
        </div>
      </div>
      <ScoreDistribution dist={scoreDist} />
    </div>
  )
}

// ── Main Infrastructure Dashboard ────────────────────────────────────────────

export default function InfrastructureDashboard({ resources, onOpenSettings }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activePanel, setActivePanel] = useState('overview')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/infra/summary')
      const json = await res.json()
      if (json.error && !json.has_data) throw new Error(json.error)
      setData(json)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <Server size={32} className="text-blue-400 animate-pulse" />
        <p className="text-sm text-gray-400">Loading infrastructure intelligence...</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center gap-3 py-16">
      <AlertTriangle size={28} className="text-red-400" />
      <p className="text-sm text-red-400">{error}</p>
      <button onClick={loadData} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  )

  if (!data?.has_data) return (
    <div className="flex flex-col items-center gap-3 py-16">
      <Server size={28} className="text-gray-600" />
      <p className="text-sm text-gray-400">No infrastructure data available. Run a scan first.</p>
    </div>
  )

  const costTrendIcon = data.cost_trend_pct > 2 ? TrendingUp : data.cost_trend_pct < -2 ? TrendingDown : Minus

  // Calculate infra health score
  const healthScore = Math.round(
    ((data.health?.backup_coverage_pct || 0) * 0.25) +
    ((data.health?.tag_compliance_pct || 0) * 0.2) +
    ((data.health?.lock_coverage_pct || 0) * 0.15) +
    (Math.max(0, 100 - (data.health?.orphan_count || 0) * 5) * 0.2) +
    (((data.score_distribution?.well_used || 0) / Math.max(data.total_resources, 1)) * 100 * 0.2)
  )
  const healthColor = healthScore >= 70 ? '#22c55e' : healthScore >= 50 ? '#f59e0b' : '#ef4444'
  const healthLabel = healthScore >= 70 ? 'Good' : healthScore >= 50 ? 'Fair' : 'Needs Attention'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Server size={20} className="text-blue-400" />
            Infrastructure Intelligence
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Comprehensive view of your Azure infrastructure — {data.total_resources} resources across {Object.keys(data.by_subscription || {}).length} subscriptions
          </p>
        </div>
        <button onClick={loadData} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 border border-gray-700">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Health Score Banner */}
      <div className="rounded-xl border border-gray-800/60 bg-gradient-to-r from-gray-900/80 via-gray-900/50 to-gray-900/80 p-5">
        <div className="flex items-center gap-6 flex-wrap">
          <ProgressRing value={healthScore} size={80} label="Health Score" color={healthColor} />
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">Infrastructure Health: </span>
              <span className={clsx('text-lg font-bold', healthScore >= 70 ? 'text-green-400' : healthScore >= 50 ? 'text-yellow-400' : 'text-red-400')}>
                {healthLabel}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Based on backup coverage ({data.health?.backup_coverage_pct?.toFixed(0)}%), tag compliance ({data.health?.tag_compliance_pct?.toFixed(0)}%),
              resource locks ({data.health?.lock_coverage_pct?.toFixed(0)}%), orphaned resources ({data.health?.orphan_count}),
              and utilization scores
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-400 tabular-nums">${(data.total_cost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              <p className="text-xs text-gray-500">Monthly Cost</p>
            </div>
            <div className="text-center">
              <p className={clsx('text-lg font-bold tabular-nums flex items-center gap-1',
                data.cost_trend_pct > 2 ? 'text-red-400' : data.cost_trend_pct < -2 ? 'text-green-400' : 'text-gray-400')}>
                {data.cost_trend_pct > 0 ? '+' : ''}{data.cost_trend_pct?.toFixed(1)}%
              </p>
              <p className="text-xs text-gray-500">vs Last Month</p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KPICard icon={Server} label="Total Resources" value={data.total_resources} color="text-blue-400"
          subValue={`${Object.keys(data.by_resource_group || {}).length} resource groups`} />
        <KPICard icon={DollarSign} label="Monthly Cost" value={`$${(data.total_cost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          color="text-green-400" trend={data.cost_trend_pct} />
        <KPICard icon={AlertTriangle} label="Waste Detected"
          value={`$${(data.waste_summary?.total_potential_savings || 0).toFixed(0)}/mo`}
          color="text-orange-400" subValue={`${(data.score_distribution?.confirmed_waste || 0) + (data.score_distribution?.likely_waste || 0)} resources`} />
        <KPICard icon={Archive} label="Backup Coverage"
          value={`${data.health?.backup_coverage_pct?.toFixed(0) || 0}%`}
          color={data.health?.backup_coverage_pct > 60 ? 'text-green-400' : 'text-orange-400'} />
        <KPICard icon={Tag} label="Tag Compliance"
          value={`${data.health?.tag_compliance_pct?.toFixed(0) || 0}%`}
          color={data.health?.tag_compliance_pct > 70 ? 'text-green-400' : 'text-yellow-400'} />
        <KPICard icon={ShieldAlert} label="Advisor Issues"
          value={data.health?.advisor_recommendations || 0}
          color={data.health?.advisor_recommendations > 10 ? 'text-red-400' : 'text-blue-400'}
          subValue={`${data.health?.orphan_count || 0} orphaned`} />
      </div>

      {/* Panel Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-800 pb-2 overflow-x-auto">
        {[
          { key: 'overview',   label: '📊 Overview', icon: BarChart2 },
          { key: 'cost',       label: '💰 Cost Intelligence', icon: DollarSign },
          { key: 'security',   label: '🛡️ Security & Compliance', icon: Shield },
          { key: 'topology',   label: '🗺️ Topology', icon: MapPin },
          { key: 'groups',     label: '📁 Resource Groups', icon: Layers },
        ].map(t => (
          <button key={t.key} onClick={() => setActivePanel(t.key)}
            className={clsx('px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
              activePanel === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Panel Content */}
      {activePanel === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Cost by Type */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <BarChart2 size={14} className="text-blue-400" /> Cost by Resource Type
            </h3>
            <HorizontalBar
              items={Object.entries(data.by_type || {}).slice(0, 8).map(([type, d]) => ({
                label: type,
                value: d.cost,
                formatted: `$${d.cost.toFixed(0)}/mo (${d.count})`,
                color: 'bg-blue-500',
              }))}
            />
          </div>

          {/* Score Distribution */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Activity size={14} className="text-indigo-400" /> Resource Utilization
            </h3>
            <ScoreDistribution dist={data.score_distribution} />
          </div>

          {/* Top Cost Resources */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <DollarSign size={14} className="text-green-400" /> Top 10 Cost Drivers
            </h3>
            <TopCostTable resources={data.top_cost_resources} />
          </div>

          {/* Location Breakdown */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Globe size={14} className="text-teal-400" /> Geographic Distribution
            </h3>
            <LocationBreakdown byLocation={data.by_location} />
          </div>
        </div>
      )}

      {activePanel === 'cost' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Waste & Savings */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Trash2 size={14} className="text-red-400" /> Waste Analysis & Savings
            </h3>
            <WasteSavingsPanel waste={data.waste_summary} scoreDist={data.score_distribution} />
          </div>

          {/* Cost by Subscription */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Layers size={14} className="text-purple-400" /> Cost by Subscription
            </h3>
            <HorizontalBar
              items={Object.entries(data.by_subscription || {}).map(([id, d]) => ({
                label: d.name || id,
                value: d.cost,
                formatted: `$${d.cost.toFixed(0)}/mo (${d.count} res)`,
                color: 'bg-purple-500',
              })).sort((a, b) => b.value - a.value)}
            />
          </div>

          {/* Cost by Resource Group */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Layers size={14} className="text-cyan-400" /> Top Resource Groups by Cost
            </h3>
            <HorizontalBar
              maxItems={12}
              items={Object.entries(data.by_resource_group || {}).map(([name, d]) => ({
                label: name,
                value: d.cost,
                formatted: `$${d.cost.toFixed(0)}/mo (${d.count} resources)`,
                color: 'bg-cyan-500',
              })).sort((a, b) => b.value - a.value)}
            />
          </div>

          {/* Top Cost Resources */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <DollarSign size={14} className="text-green-400" /> Top Cost Drivers
            </h3>
            <TopCostTable resources={data.top_cost_resources} />
          </div>
        </div>
      )}

      {activePanel === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Security Posture */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Shield size={14} className="text-green-400" /> Security & Governance Posture
            </h3>
            <SecurityPosture health={data.health} />
          </div>

          {/* Quick Actions */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Zap size={14} className="text-yellow-400" /> Quick Actions & Insights
            </h3>
            <div className="space-y-2">
              {data.health?.orphan_count > 0 && (
                <div className="flex items-start gap-2 p-2 rounded-lg border border-orange-800/30 bg-orange-950/10">
                  <AlertCircle size={14} className="text-orange-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-orange-300 font-medium">{data.health.orphan_count} Orphaned Resources Detected</p>
                    <p className="text-xs text-orange-400/60">Resources with no active connections — review for potential cleanup</p>
                  </div>
                </div>
              )}
              {data.health?.deallocated_count > 0 && (
                <div className="flex items-start gap-2 p-2 rounded-lg border border-yellow-800/30 bg-yellow-950/10">
                  <AlertCircle size={14} className="text-yellow-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-yellow-300 font-medium">{data.health.deallocated_count} Deallocated VMs</p>
                    <p className="text-xs text-yellow-400/60">Still incurring storage costs — consider deleting if not needed</p>
                  </div>
                </div>
              )}
              {data.health?.backup_coverage_pct < 50 && (
                <div className="flex items-start gap-2 p-2 rounded-lg border border-red-800/30 bg-red-950/10">
                  <ShieldAlert size={14} className="text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-red-300 font-medium">Low Backup Coverage ({data.health.backup_coverage_pct?.toFixed(0)}%)</p>
                    <p className="text-xs text-red-400/60">Many resources are not backed up — critical risk for data loss</p>
                  </div>
                </div>
              )}
              {data.health?.tag_compliance_pct < 50 && (
                <div className="flex items-start gap-2 p-2 rounded-lg border border-blue-800/30 bg-blue-950/10">
                  <Tag size={14} className="text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-blue-300 font-medium">Low Tag Compliance ({data.health.tag_compliance_pct?.toFixed(0)}%)</p>
                    <p className="text-xs text-blue-400/60">Resources without tags are hard to manage and govern</p>
                  </div>
                </div>
              )}
              {data.health?.advisor_recommendations > 0 && (
                <div className="flex items-start gap-2 p-2 rounded-lg border border-indigo-800/30 bg-indigo-950/10">
                  <FileText size={14} className="text-indigo-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-indigo-300 font-medium">{data.health.advisor_recommendations} Azure Advisor Recommendations</p>
                    <p className="text-xs text-indigo-400/60">Azure Advisor has identified optimization opportunities</p>
                  </div>
                </div>
              )}
              {(data.waste_summary?.confirmed_waste_cost || 0) > 100 && (
                <div className="flex items-start gap-2 p-2 rounded-lg border border-green-800/30 bg-green-950/10">
                  <DollarSign size={14} className="text-green-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-green-300 font-medium">${data.waste_summary.total_potential_savings?.toFixed(0)}/mo in Potential Savings</p>
                    <p className="text-xs text-green-400/60">Confirmed + likely waste that can be recovered</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activePanel === 'topology' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Globe size={14} className="text-teal-400" /> Geographic Distribution
            </h3>
            <LocationBreakdown byLocation={data.by_location} />
          </div>
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <BarChart2 size={14} className="text-blue-400" /> Resource Type Distribution
            </h3>
            <HorizontalBar
              maxItems={12}
              items={Object.entries(data.by_type || {}).map(([type, d]) => ({
                label: type,
                value: d.count,
                formatted: `${d.count} resources ($${d.cost.toFixed(0)}/mo)`,
                color: 'bg-indigo-500',
              })).sort((a, b) => b.value - a.value)}
            />
          </div>
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Layers size={14} className="text-purple-400" /> Subscription Overview
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(data.by_subscription || {}).map(([id, sub]) => (
                <div key={id} className="rounded-lg border border-gray-800/50 bg-gray-800/30 p-3">
                  <p className="text-sm font-medium text-gray-200 truncate">{sub.name || id}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-500">{sub.count} resources</span>
                    <span className="text-sm text-green-400 font-semibold tabular-nums">${sub.cost.toFixed(0)}/mo</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activePanel === 'groups' && (
        <ResourceGroupExplorer byRg={data.by_resource_group} />
      )}
    </div>
  )
}
