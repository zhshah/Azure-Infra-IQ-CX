import React, { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'
import {
  Server, Shield, Activity, Monitor, Database, Globe,
  AlertTriangle, CheckCircle, TrendingUp, Wifi, WifiOff,
  BarChart2, PieChart, MapPin, Layers, Lock, Eye,
  Cpu, HardDrive, RefreshCw, ChevronDown, ChevronRight,
  Search, Tag, Settings, Terminal, Box, Disc,
  ShieldCheck, ShieldAlert, ArrowUpRight, ArrowDownRight,
  GitBranch, Cloud, Zap, Users, FileText, Network,
} from 'lucide-react'

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ icon: Icon, label, value, subValue, color = 'text-blue-400', badge, onClick }) {
  return (
    <div className={clsx('rounded-xl border border-gray-800/60 bg-gray-900/50 p-4',
      onClick && 'cursor-pointer hover:bg-gray-800/40 transition-colors')} onClick={onClick}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gray-800/80">
            <Icon size={14} className={color} />
          </div>
          <span className="text-xs text-gray-500 font-medium">{label}</span>
        </div>
        {badge && (
          <span className={clsx('text-xs px-2 py-0.5 rounded-full border', badge.cls)}>{badge.text}</span>
        )}
      </div>
      <p className={clsx('text-2xl font-bold mt-2 tabular-nums', color)}>{value}</p>
      {subValue && <p className="text-xs text-gray-600 mt-0.5">{subValue}</p>}
    </div>
  )
}

// ── Progress Ring ────────────────────────────────────────────────────────────

function ProgressRing({ value, size = 64, label, color }) {
  const r = (size / 2) - 5
  const circ = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const dash = (pct / 100) * circ
  const ringColor = color || (pct >= 70 ? '#22c55e' : pct >= 40 ? '#eab308' : '#ef4444')

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth="5" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringColor} strokeWidth="5"
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
        </svg>
        <span className="absolute text-sm font-bold text-white tabular-nums">{Math.round(pct)}%</span>
      </div>
      {label && <span className="text-xs text-gray-500 text-center">{label}</span>}
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
            <div className={clsx('h-full rounded-full', item.color || 'bg-blue-500')}
              style={{ width: `${Math.max(2, (item.value / total) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Risk Card ────────────────────────────────────────────────────────────────

function RiskCard({ risk }) {
  const SEV_STYLES = {
    critical: 'border-red-700/50 bg-red-950/20 text-red-400',
    high: 'border-orange-700/50 bg-orange-950/20 text-orange-400',
    medium: 'border-yellow-700/50 bg-yellow-950/20 text-yellow-400',
    low: 'border-gray-700/50 bg-gray-900/40 text-gray-400',
  }
  const CAT_ICONS = { security: ShieldAlert, monitoring: Monitor, connectivity: WifiOff, bcdr: Database, patching: Settings }
  const Icon = CAT_ICONS[risk.category] || AlertTriangle
  return (
    <div className={clsx('rounded-lg border p-3', SEV_STYLES[risk.severity] || SEV_STYLES.low)}>
      <div className="flex items-start gap-2">
        <Icon size={14} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase">{risk.category}</span>
            <span className="text-xs opacity-70 capitalize">{risk.severity}</span>
            {risk.affected_count > 0 && <span className="text-xs opacity-60">{risk.affected_count} affected</span>}
          </div>
          <p className="text-xs mt-1 opacity-90 leading-relaxed">{risk.finding}</p>
          <p className="text-xs mt-1 opacity-70 italic">{risk.recommendation}</p>
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard Component ─────────────────────────────────────────────────

export default function ArcDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activePanel, setActivePanel] = useState('overview')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/arc/summary')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw size={24} className="animate-spin text-blue-400" />
      <span className="ml-3 text-gray-400">Discovering Azure Arc machines...</span>
    </div>
  )

  if (error) return (
    <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-6 text-center">
      <AlertTriangle size={32} className="mx-auto text-red-400 mb-3" />
      <h3 className="text-lg font-semibold text-red-300">Failed to load Arc data</h3>
      <p className="text-sm text-red-400/80 mt-1">{error}</p>
      <button onClick={loadData} className="mt-4 px-4 py-2 bg-red-900/40 border border-red-700/50 rounded-lg text-sm text-red-300 hover:bg-red-900/60">Retry</button>
    </div>
  )

  if (!data?.has_data) return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center">
      <Server size={40} className="mx-auto text-gray-600 mb-4" />
      <h3 className="text-xl font-semibold text-gray-300">No Azure Arc Machines Found</h3>
      <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">Azure Arc-enabled servers were not found in your subscriptions.</p>
    </div>
  )

  const panels = [
    { key: 'overview', label: 'Overview' },
    { key: 'security', label: 'Security & Monitoring' },
    { key: 'governance', label: 'Governance' },
    { key: 'topology', label: 'Topology' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 bg-gray-900/60 border border-gray-800 rounded-lg p-1 w-fit">
        {panels.map(p => (
          <button key={p.key} onClick={() => setActivePanel(p.key)}
            className={clsx('px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
              activePanel === p.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200')}>
            {p.label}
          </button>
        ))}
        <button onClick={loadData} className="ml-2 p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300">
          <RefreshCw size={13} />
        </button>
      </div>
      {activePanel === 'overview' && <OverviewPanel data={data} />}
      {activePanel === 'security' && <SecurityPanel data={data} />}
      {activePanel === 'governance' && <GovernancePanel data={data} />}
      {activePanel === 'topology' && <TopologyPanel data={data} />}
    </div>
  )
}

// ── Overview Panel ───────────────────────────────────────────────────────────

function OverviewPanel({ data }) {
  const { coverage, by_os, machines } = data
  const totalCores = machines.reduce((s, m) => s + (m.cores || 0), 0)
  const totalMemory = machines.reduce((s, m) => s + (m.totalMemoryGB || 0), 0)
  const withChangeTracking = machines.filter(m => m.coverage?.change_tracking).length
  const withDependency = machines.filter(m => m.classified_extensions?.some(e => e.category === 'dependency')).length
  const withSql = machines.filter(m => m.sql_instances?.length > 0).length
  const totalExtensions = machines.reduce((s, m) => s + (m.classified_extensions?.length || 0), 0)

  const osItems = useMemo(() => Object.entries(by_os || {}).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([os, count]) => ({ label: os, value: count, color: 'bg-indigo-500' })), [by_os])
  const extItems = useMemo(() => Object.entries(data.extension_distribution || {}).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([ext, count]) => ({ label: ext, value: count, color: 'bg-teal-500' })), [data.extension_distribution])
  const locationItems = useMemo(() => Object.entries(data.by_location || {}).sort((a, b) => b[1] - a[1])
    .map(([loc, count]) => ({ label: loc, value: count, color: 'bg-cyan-500' })), [data.by_location])

  return (
    <div className="space-y-4">
      {/* Primary KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <KPICard icon={Server} label="Total Machines" value={data.total_machines} color="text-blue-400"
          subValue={`${data.windows_count} Win · ${data.linux_count} Linux`} />
        <KPICard icon={Wifi} label="Connected" value={data.connected} color="text-green-400"
          badge={data.disconnected > 0 ? { text: `${data.disconnected} offline`, cls: 'bg-red-900/30 text-red-400 border-red-800/50' } : undefined} />
        <KPICard icon={Database} label="SQL Instances" value={data.total_sql_instances} color="text-teal-400"
          subValue={`${data.total_databases} DBs · ${data.total_availability_groups} AGs`} />
        <KPICard icon={Shield} label="Security" value={`${coverage.security_pct}%`}
          color={coverage.security_pct >= 80 ? 'text-green-400' : 'text-red-400'}
          subValue={`${Math.round(data.total_machines * coverage.security_pct / 100)}/${data.total_machines} protected`} />
        <KPICard icon={Monitor} label="Monitoring" value={`${coverage.monitoring_pct}%`}
          color={coverage.monitoring_pct >= 80 ? 'text-green-400' : 'text-yellow-400'}
          subValue={`${Math.round(data.total_machines * coverage.monitoring_pct / 100)}/${data.total_machines} monitored`} />
        <KPICard icon={Settings} label="Patching" value={`${coverage.patching_pct}%`}
          color={coverage.patching_pct >= 80 ? 'text-green-400' : 'text-orange-400'}
          subValue={`${Math.round(data.total_machines * coverage.patching_pct / 100)}/${data.total_machines} managed`} />
        <KPICard icon={Cpu} label="Total Compute" value={totalCores} color="text-purple-400"
          subValue={`cores · ${totalMemory.toFixed(0)} GB RAM`} />
        <KPICard icon={MapPin} label="Locations" value={Object.keys(data.by_location || {}).length} color="text-cyan-400"
          subValue={`${Object.keys(data.by_resource_group || {}).length} RGs`} />
      </div>

      {/* Secondary insights */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard icon={Eye} label="Change Tracking" value={`${coverage.change_tracking_pct}%`}
          color={coverage.change_tracking_pct >= 50 ? 'text-purple-400' : 'text-orange-400'}
          subValue={`${withChangeTracking}/${data.total_machines} tracked`} />
        <KPICard icon={GitBranch} label="Dependency Agent" value={withDependency}
          color="text-indigo-400" subValue={`of ${data.total_machines} machines`} />
        <KPICard icon={Layers} label="Avg Spec" value={`${machines.length ? (totalCores / machines.length).toFixed(1) : 0} vCPU`}
          color="text-gray-300" subValue={`${machines.length ? (totalMemory / machines.length).toFixed(1) : 0} GB avg memory`} />
        <KPICard icon={Zap} label="Total Extensions" value={totalExtensions}
          color="text-amber-400" subValue={`across ${data.total_machines} machines`} />
        <KPICard icon={Database} label="SQL Machines" value={withSql}
          color="text-teal-400" subValue={`${data.total_databases} databases total`} />
      </div>

      {/* Coverage + OS + Ext + Location */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Coverage Overview</h3>
          <div className="grid grid-cols-2 gap-4">
            <ProgressRing value={coverage.monitoring_pct} label="Monitoring" color="#3b82f6" />
            <ProgressRing value={coverage.security_pct} label="Security" color="#ef4444" />
            <ProgressRing value={coverage.patching_pct} label="Patching" color="#f59e0b" />
            <ProgressRing value={coverage.change_tracking_pct} label="Change Tracking" color="#8b5cf6" />
          </div>
        </div>
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">OS Distribution</h3>
          <HorizontalBar items={osItems} maxItems={8} />
        </div>
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Installed Extensions</h3>
          <HorizontalBar items={extItems} maxItems={8} />
        </div>
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">By Location</h3>
          <HorizontalBar items={locationItems} maxItems={8} />
        </div>
      </div>

      {/* Machine Inventory Table (top 15) */}
      <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">
          Machine Inventory <span className="text-xs text-gray-500 ml-2">({data.total_machines} machines)</span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Machine</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">OS</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Status</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Location</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">CPU</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Memory</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Coverage</th>
                <th className="text-left text-gray-500 font-medium py-2">SQL</th>
              </tr>
            </thead>
            <tbody>
              {machines.slice(0, 15).map(m => {
                const cov = m.coverage || {}
                const covCount = [cov.monitoring, cov.security, cov.patching, cov.change_tracking].filter(Boolean).length
                return (
                  <tr key={m.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <span className={clsx('w-2 h-2 rounded-full shrink-0', m.status === 'Connected' ? 'bg-green-400' : 'bg-red-400')} />
                        <span className="text-gray-200 font-medium truncate max-w-[180px]">{m.name}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-gray-400">{m.osSku || m.osName || m.osType || '—'}</td>
                    <td className="py-2 pr-3">
                      <span className={clsx('px-1.5 py-0.5 rounded text-xs', m.status === 'Connected' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300')}>{m.status}</span>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{m.location}</td>
                    <td className="py-2 pr-3 text-gray-500">{m.cores || '—'} cores</td>
                    <td className="py-2 pr-3 text-gray-500">{m.totalMemoryGB ? `${m.totalMemoryGB.toFixed(1)} GB` : '—'}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1">
                        <div className={clsx('w-1.5 h-1.5 rounded-full', cov.security ? 'bg-green-400' : 'bg-red-400')} title="Security" />
                        <div className={clsx('w-1.5 h-1.5 rounded-full', cov.monitoring ? 'bg-green-400' : 'bg-red-400')} title="Monitoring" />
                        <div className={clsx('w-1.5 h-1.5 rounded-full', cov.patching ? 'bg-green-400' : 'bg-red-400')} title="Patching" />
                        <div className={clsx('w-1.5 h-1.5 rounded-full', cov.change_tracking ? 'bg-green-400' : 'bg-red-400')} title="Tracking" />
                        <span className="text-gray-600 ml-1">{covCount}/4</span>
                      </div>
                    </td>
                    <td className="py-2 text-gray-500">{m.sql_instances?.length || 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {machines.length > 15 && (
            <p className="text-xs text-gray-600 mt-2 text-center">Showing 15 of {machines.length} — switch to Resources tab for full view</p>
          )}
        </div>
      </div>

      {/* Risks */}
      {data.bcdr?.risks?.length > 0 && (
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-3">Top Risks <span className="text-xs text-gray-500 ml-2">({data.bcdr.risks.length} identified)</span></h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.bcdr.risks.slice(0, 6).map((risk, i) => <RiskCard key={i} risk={risk} />)}
          </div>
        </div>
      )}

      {/* RG breakdown */}
      <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Resource Group Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Resource Group</th>
                <th className="text-right text-gray-500 font-medium py-2 pr-3">Machines</th>
                <th className="text-right text-gray-500 font-medium py-2 pr-3">Windows</th>
                <th className="text-right text-gray-500 font-medium py-2 pr-3">Linux</th>
                <th className="text-right text-gray-500 font-medium py-2">SQL</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.by_resource_group || {}).sort((a, b) => b[1].count - a[1].count).map(([rg, info]) => (
                <tr key={rg} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                  <td className="py-2 pr-3 text-gray-300 font-medium">{rg}</td>
                  <td className="py-2 pr-3 text-right text-gray-400">{info.count}</td>
                  <td className="py-2 pr-3 text-right text-blue-400">{info.windows}</td>
                  <td className="py-2 pr-3 text-right text-orange-400">{info.linux}</td>
                  <td className="py-2 text-right text-teal-400">{info.sql_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Security & Monitoring Panel ──────────────────────────────────────────────

function SecurityPanel({ data }) {
  const { coverage, machines } = data
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const noSecurity = machines.filter(m => !m.coverage?.security)
  const noMonitoring = machines.filter(m => !m.coverage?.monitoring)
  const noPatching = machines.filter(m => !m.coverage?.patching)
  const noChangeTracking = machines.filter(m => !m.coverage?.change_tracking)
  const disconnected = machines.filter(m => m.status !== 'Connected')

  const filteredMachines = useMemo(() => {
    let result = [...machines]
    if (filter === 'no-security') result = noSecurity
    else if (filter === 'no-monitoring') result = noMonitoring
    else if (filter === 'no-patching') result = noPatching
    else if (filter === 'no-tracking') result = noChangeTracking
    else if (filter === 'disconnected') result = disconnected
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(m => (m.name || '').toLowerCase().includes(q) || (m.osName || '').toLowerCase().includes(q) || (m.resourceGroup || '').toLowerCase().includes(q))
    }
    return result
  }, [machines, filter, search, noSecurity, noMonitoring, noPatching, noChangeTracking, disconnected])

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard icon={ShieldCheck} label="Endpoint Protection" value={`${coverage.security_pct}%`}
          color={coverage.security_pct >= 80 ? 'text-green-400' : 'text-red-400'}
          subValue={`${machines.length - noSecurity.length}/${machines.length} protected`}
          onClick={() => setFilter(filter === 'no-security' ? 'all' : 'no-security')} />
        <KPICard icon={Monitor} label="Monitoring Agent" value={`${coverage.monitoring_pct}%`}
          color={coverage.monitoring_pct >= 80 ? 'text-green-400' : 'text-yellow-400'}
          subValue={`${machines.length - noMonitoring.length}/${machines.length} monitored`}
          onClick={() => setFilter(filter === 'no-monitoring' ? 'all' : 'no-monitoring')} />
        <KPICard icon={Settings} label="Patch Management" value={`${coverage.patching_pct}%`}
          color={coverage.patching_pct >= 80 ? 'text-green-400' : 'text-orange-400'}
          subValue={`${machines.length - noPatching.length}/${machines.length} managed`}
          onClick={() => setFilter(filter === 'no-patching' ? 'all' : 'no-patching')} />
        <KPICard icon={Eye} label="Change Tracking" value={`${coverage.change_tracking_pct}%`}
          color={coverage.change_tracking_pct >= 50 ? 'text-purple-400' : 'text-orange-400'}
          subValue={`${machines.length - noChangeTracking.length}/${machines.length} tracked`}
          onClick={() => setFilter(filter === 'no-tracking' ? 'all' : 'no-tracking')} />
        <KPICard icon={Wifi} label="Connectivity" value={`${data.disconnected === 0 ? '100' : ((data.connected / data.total_machines) * 100).toFixed(0)}%`}
          color={data.disconnected === 0 ? 'text-green-400' : 'text-red-400'}
          subValue={`${data.disconnected} disconnected`}
          onClick={() => setFilter(filter === 'disconnected' ? 'all' : 'disconnected')} />
      </div>

      {/* Filter + Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-gray-900/60 border border-gray-800 rounded-lg p-1 overflow-x-auto">
          {[
            { key: 'all', label: `All (${machines.length})` },
            { key: 'no-security', label: `No Security (${noSecurity.length})` },
            { key: 'no-monitoring', label: `No Monitor (${noMonitoring.length})` },
            { key: 'no-patching', label: `No Patch (${noPatching.length})` },
            { key: 'no-tracking', label: `No Tracking (${noChangeTracking.length})` },
            { key: 'disconnected', label: `Offline (${disconnected.length})` },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={clsx('px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap',
                filter === f.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200')}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder="Search machines..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600" />
        </div>
        <span className="text-xs text-gray-500">{filteredMachines.length} machines</span>
      </div>

      {/* Security Table */}
      <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-800/40">
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-500 font-medium py-2.5 px-3">Machine</th>
                <th className="text-left text-gray-500 font-medium py-2.5 px-3">OS</th>
                <th className="text-center text-gray-500 font-medium py-2.5 px-2">Status</th>
                <th className="text-left text-gray-500 font-medium py-2.5 px-3">Resource Group</th>
                <th className="text-center text-gray-500 font-medium py-2.5 px-2"><div className="flex items-center justify-center gap-1"><Shield size={10} /> Security</div></th>
                <th className="text-center text-gray-500 font-medium py-2.5 px-2"><div className="flex items-center justify-center gap-1"><Monitor size={10} /> Monitor</div></th>
                <th className="text-center text-gray-500 font-medium py-2.5 px-2"><div className="flex items-center justify-center gap-1"><Settings size={10} /> Patching</div></th>
                <th className="text-center text-gray-500 font-medium py-2.5 px-2"><div className="flex items-center justify-center gap-1"><Eye size={10} /> Tracking</div></th>
                <th className="text-left text-gray-500 font-medium py-2.5 px-3">Agent</th>
                <th className="text-right text-gray-500 font-medium py-2.5 px-3">Ext</th>
              </tr>
            </thead>
            <tbody>
              {filteredMachines.map(m => {
                const cov = m.coverage || {}
                return (
                  <tr key={m.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                    <td className="py-2 px-3"><div className="flex items-center gap-2">
                      <span className={clsx('w-2 h-2 rounded-full shrink-0', m.status === 'Connected' ? 'bg-green-400' : 'bg-red-400')} />
                      <span className="text-gray-200 font-medium truncate max-w-[200px]">{m.name}</span>
                    </div></td>
                    <td className="py-2 px-3 text-gray-400 truncate max-w-[160px]">{m.osSku || m.osName || m.osType}</td>
                    <td className="py-2 px-2 text-center"><span className={clsx('px-1.5 py-0.5 rounded text-xs',
                      m.status === 'Connected' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300')}>{m.status}</span></td>
                    <td className="py-2 px-3 text-gray-500 truncate max-w-[140px]">{m.resourceGroup}</td>
                    <td className="py-2 px-2 text-center">{cov.security ? <CheckCircle size={14} className="mx-auto text-green-400" /> : <AlertTriangle size={14} className="mx-auto text-red-400" />}</td>
                    <td className="py-2 px-2 text-center">{cov.monitoring ? <CheckCircle size={14} className="mx-auto text-green-400" /> : <AlertTriangle size={14} className="mx-auto text-yellow-400" />}</td>
                    <td className="py-2 px-2 text-center">{cov.patching ? <CheckCircle size={14} className="mx-auto text-green-400" /> : <AlertTriangle size={14} className="mx-auto text-orange-400" />}</td>
                    <td className="py-2 px-2 text-center">{cov.change_tracking ? <CheckCircle size={14} className="mx-auto text-purple-400" /> : <span className="text-gray-600">—</span>}</td>
                    <td className="py-2 px-3 text-gray-500 font-mono text-[10px]">{m.agentVersion || '—'}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{m.classified_extensions?.length || 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Extension Matrix */}
      <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Extension Deployment Matrix</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-700">
              <th className="text-left text-gray-500 font-medium py-2 pr-3">Extension</th>
              <th className="text-right text-gray-500 font-medium py-2 pr-3">Deployed</th>
              <th className="text-right text-gray-500 font-medium py-2 pr-3">Coverage</th>
              <th className="text-left text-gray-500 font-medium py-2 w-[40%]">Distribution</th>
            </tr></thead>
            <tbody>
              {Object.entries(data.extension_distribution || {}).sort((a, b) => b[1] - a[1]).map(([ext, count]) => {
                const pct = data.total_machines ? (count / data.total_machines * 100) : 0
                return (
                  <tr key={ext} className="border-b border-gray-800/30">
                    <td className="py-2 pr-3 text-gray-300">{ext}</td>
                    <td className="py-2 pr-3 text-right text-gray-400">{count}/{data.total_machines}</td>
                    <td className="py-2 pr-3 text-right"><span className={clsx('font-medium', pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400')}>{pct.toFixed(0)}%</span></td>
                    <td className="py-2 pr-3"><div className="h-2 bg-gray-800 rounded-full overflow-hidden"><div className={clsx('h-full rounded-full', pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500')} style={{ width: `${pct}%` }} /></div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Governance Panel ─────────────────────────────────────────────────────────

function GovernancePanel({ data }) {
  const { governance, machines } = data
  const untagged = machines.filter(m => !m.tags || Object.keys(m.tags).length === 0)
  const tagFrequency = useMemo(() => {
    const freq = {}
    for (const m of machines) for (const k of Object.keys(m.tags || {})) freq[k] = (freq[k] || 0) + 1
    return Object.entries(freq).sort((a, b) => b[1] - a[1])
  }, [machines])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard icon={Tag} label="Tag Compliance" value={`${governance.tag_compliance_pct}%`}
          color={governance.tag_compliance_pct >= 80 ? 'text-green-400' : 'text-orange-400'}
          subValue={`${governance.tagged_count} tagged · ${governance.untagged_count} untagged`} />
        <KPICard icon={FileText} label="ESU Eligible" value={governance.esu_eligible} color="text-amber-400" subValue="Extended Security Updates" />
        <KPICard icon={Users} label="Resource Groups" value={Object.keys(data.by_resource_group || {}).length}
          color="text-cyan-400" subValue={`across ${Object.keys(data.by_subscription || {}).length} subscriptions`} />
        <KPICard icon={Layers} label="Avg Extensions" value={(machines.reduce((s, m) => s + (m.classified_extensions?.length || 0), 0) / (machines.length || 1)).toFixed(1)}
          color="text-indigo-400" subValue="per machine" />
      </div>

      {tagFrequency.length > 0 && (
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-3">Tag Key Coverage</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-700">
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Tag Key</th>
                <th className="text-right text-gray-500 font-medium py-2 pr-3">Machines</th>
                <th className="text-right text-gray-500 font-medium py-2 pr-3">Coverage</th>
                <th className="text-left text-gray-500 font-medium py-2 w-[30%]">Distribution</th>
              </tr></thead>
              <tbody>
                {tagFrequency.map(([key, count]) => {
                  const pct = data.total_machines ? (count / data.total_machines * 100) : 0
                  return (
                    <tr key={key} className="border-b border-gray-800/30">
                      <td className="py-2 pr-3 text-gray-300 font-mono text-[10px]">{key}</td>
                      <td className="py-2 pr-3 text-right text-gray-400">{count}/{data.total_machines}</td>
                      <td className="py-2 pr-3 text-right"><span className={clsx('font-medium', pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400')}>{pct.toFixed(0)}%</span></td>
                      <td className="py-2"><div className="h-2 bg-gray-800 rounded-full overflow-hidden"><div className="h-full rounded-full bg-cyan-500" style={{ width: `${pct}%` }} /></div></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {untagged.length > 0 && (
        <div className="rounded-xl border border-orange-800/30 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-orange-300 mb-3">Untagged Machines ({untagged.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-700">
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Machine</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">OS</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Resource Group</th>
                <th className="text-left text-gray-500 font-medium py-2">Location</th>
              </tr></thead>
              <tbody>
                {untagged.map(m => (
                  <tr key={m.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                    <td className="py-2 pr-3 text-gray-300 font-medium">{m.name}</td>
                    <td className="py-2 pr-3 text-gray-400">{m.osSku || m.osType}</td>
                    <td className="py-2 pr-3 text-gray-500">{m.resourceGroup}</td>
                    <td className="py-2 text-gray-500">{m.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Topology Panel ───────────────────────────────────────────────────────────

function TopologyPanel({ data }) {
  const { by_subscription, by_location, by_resource_group, machines } = data
  const domains = useMemo(() => {
    const d = {}
    machines.forEach(m => { const k = m.domainName || 'No Domain'; d[k] = (d[k] || 0) + 1 })
    return Object.entries(d).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l, value: v, color: 'bg-violet-500' }))
  }, [machines])

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">By Subscription</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-700">
              <th className="text-left text-gray-500 font-medium py-2 pr-3">Subscription ID</th>
              <th className="text-right text-gray-500 font-medium py-2 pr-3">Total</th>
              <th className="text-right text-gray-500 font-medium py-2 pr-3">Connected</th>
              <th className="text-right text-gray-500 font-medium py-2">Disconnected</th>
            </tr></thead>
            <tbody>
              {Object.entries(by_subscription || {}).map(([sub, info]) => (
                <tr key={sub} className="border-b border-gray-800/30">
                  <td className="py-2 pr-3 text-gray-300 font-mono text-[10px]">{sub}</td>
                  <td className="py-2 pr-3 text-right text-gray-400">{info.count}</td>
                  <td className="py-2 pr-3 text-right text-green-400">{info.connected}</td>
                  <td className="py-2 text-right text-red-400">{info.disconnected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">By Location</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(by_location || {}).sort((a, b) => b[1] - a[1]).map(([loc, count]) => (
            <div key={loc} className="rounded-lg border border-gray-800/40 bg-gray-800/20 p-3 text-center">
              <MapPin size={14} className="mx-auto text-cyan-400 mb-1" />
              <p className="text-lg font-bold text-white">{count}</p>
              <p className="text-xs text-gray-500 truncate">{loc}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">By Domain</h3>
        <HorizontalBar items={domains} maxItems={10} />
      </div>
    </div>
  )
}
