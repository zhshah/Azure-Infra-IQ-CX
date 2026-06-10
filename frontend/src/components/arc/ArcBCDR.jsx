import React, { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'
import {
  Database, Server, Shield, Activity, RefreshCw, Search,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle,
  HardDrive, Layers, Lock, Eye, Monitor, Settings,
  Wifi, WifiOff, GitBranch, ArrowUpRight, Square, CheckSquare,
  Download, Target, MapPin, FileText, Cpu,
} from 'lucide-react'

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ icon: Icon, label, value, subValue, color = 'text-blue-400', badge }) {
  return (
    <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gray-800/80"><Icon size={14} className={color} /></div>
          <span className="text-xs text-gray-500 font-medium">{label}</span>
        </div>
        {badge && <span className={clsx('text-xs px-2 py-0.5 rounded-full border', badge.cls)}>{badge.text}</span>}
      </div>
      <p className={clsx('text-2xl font-bold mt-2 tabular-nums', color)}>{value}</p>
      {subValue && <p className="text-xs text-gray-600 mt-0.5">{subValue}</p>}
    </div>
  )
}

// ── Score Ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 72, label }) {
  const r = (size / 2) - 6
  const circ = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score))
  const dash = (pct / 100) * circ
  const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#eab308' : '#ef4444'
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth="5" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
        </svg>
        <span className="absolute text-lg font-bold text-white tabular-nums">{Math.round(pct)}%</span>
      </div>
      {label && <span className="text-xs text-gray-500 text-center">{label}</span>}
    </div>
  )
}

// ── Risk Card ────────────────────────────────────────────────────────────────

function RiskCard({ risk }) {
  const SEV = { critical: 'border-red-700/50 bg-red-950/20 text-red-400', high: 'border-orange-700/50 bg-orange-950/20 text-orange-400',
    medium: 'border-yellow-700/50 bg-yellow-950/20 text-yellow-400', low: 'border-gray-700/50 bg-gray-900/40 text-gray-400' }
  return (
    <div className={clsx('rounded-lg border p-3', SEV[risk.severity] || SEV.low)}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
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

// ── Main BCDR Component ──────────────────────────────────────────────────────

export default function ArcBCDR({ onSelectForAssessment }) {
  const [data, setData] = useState(null)
  const [sqlData, setSqlData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [filter, setFilter] = useState('all')
  const [activeView, setActiveView] = useState('overview')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true); setError(null)
    try {
      const [summaryRes, sqlRes] = await Promise.all([
        fetch('/api/arc/summary'),
        fetch('/api/arc/sql'),
      ])
      if (!summaryRes.ok) throw new Error(`Summary: HTTP ${summaryRes.status}`)
      if (!sqlRes.ok) throw new Error(`SQL: HTTP ${sqlRes.status}`)
      setData(await summaryRes.json())
      setSqlData(await sqlRes.json())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  // Derive BCDR-relevant machine data
  const machines = data?.machines || []
  const bcdr = data?.bcdr || {}

  const machinesWithDependency = useMemo(() =>
    machines.filter(m => m.classified_extensions?.some(e => e.category === 'dependency')), [machines])
  const machinesWithChangeTracking = useMemo(() =>
    machines.filter(m => m.coverage?.change_tracking), [machines])
  const machinesWithoutMonitoring = useMemo(() =>
    machines.filter(m => !m.coverage?.monitoring), [machines])
  const machinesWithSql = useMemo(() =>
    machines.filter(m => m.sql_instances?.length > 0), [machines])
  const disconnectedMachines = useMemo(() =>
    machines.filter(m => m.status !== 'Connected'), [machines])

  // Filtered machines for list view
  const filteredMachines = useMemo(() => {
    let result = [...machines]
    if (filter === 'dependency') result = machinesWithDependency
    else if (filter === 'change-tracking') result = machinesWithChangeTracking
    else if (filter === 'no-monitoring') result = machinesWithoutMonitoring
    else if (filter === 'sql') result = machinesWithSql
    else if (filter === 'disconnected') result = disconnectedMachines
    else if (filter === 'no-backup-ext') result = machines.filter(m => !m.extensions?.some(e => (e.extensionName || '').toLowerCase().includes('backup')))

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(m =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.osName || '').toLowerCase().includes(q) ||
        (m.resourceGroup || '').toLowerCase().includes(q) ||
        (m.domainName || '').toLowerCase().includes(q)
      )
    }
    return result
  }, [machines, filter, search, machinesWithDependency, machinesWithChangeTracking, machinesWithoutMonitoring, machinesWithSql, disconnectedMachines])

  function toggleSelect(id) {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleSelectAll() {
    if (selectedIds.size === filteredMachines.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filteredMachines.map(m => m.id)))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <RefreshCw size={20} className="animate-spin text-blue-400" />
      <span className="ml-2 text-gray-400 text-sm">Loading BCDR data...</span>
    </div>
  )
  if (error) return (
    <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-6 text-center">
      <p className="text-red-300">{error}</p>
      <button onClick={loadData} className="mt-3 px-4 py-2 bg-red-900/40 border border-red-700/50 rounded-lg text-sm text-red-300">Retry</button>
    </div>
  )

  const databases = sqlData?.databases || []
  const ags = sqlData?.availability_groups || []
  const dbsWithBackup = databases.filter(db => db.backupStatus).length
  const dbsFullRecovery = databases.filter(db => (db.recoveryMode || '').toLowerCase() === 'full').length

  return (
    <div className="space-y-4">
      {/* View Tabs */}
      <div className="flex items-center gap-1 bg-gray-900/60 border border-gray-800 rounded-lg p-1 w-fit">
        {[
          { key: 'overview', label: 'BCDR Overview' },
          { key: 'machines', label: 'Machine List' },
          { key: 'dependency', label: 'Dependency Mapping' },
          { key: 'tracking', label: 'Change Tracking' },
        ].map(v => (
          <button key={v.key} onClick={() => setActiveView(v.key)}
            className={clsx('px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
              activeView === v.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200')}>
            {v.label}
          </button>
        ))}
        <button onClick={loadData} className="ml-2 p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300">
          <RefreshCw size={13} />
        </button>
      </div>

      {activeView === 'overview' && (
        <>
          {/* BCDR KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-4 flex items-center gap-4">
              <ScoreRing score={bcdr.overall_score || 0} label="BCDR Score" />
              <div>
                <p className={clsx('text-sm font-semibold', bcdr.overall_score >= 70 ? 'text-green-400' : bcdr.overall_score >= 40 ? 'text-yellow-400' : 'text-red-400')}>
                  {bcdr.overall_score >= 70 ? 'Good' : bcdr.overall_score >= 40 ? 'Needs Work' : 'Critical'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Overall readiness</p>
              </div>
            </div>
            <KPICard icon={Database} label="DB Backup" value={`${bcdr.db_backup_pct || 0}%`}
              color={bcdr.db_backup_pct >= 80 ? 'text-green-400' : 'text-red-400'}
              subValue={`${dbsWithBackup}/${databases.length} databases`} />
            <KPICard icon={Layers} label="AG Protection" value={`${bcdr.ag_coverage_pct || 0}%`}
              color={bcdr.ag_coverage_pct >= 50 ? 'text-green-400' : 'text-orange-400'}
              subValue={`${ags.length} availability groups`} />
            <KPICard icon={GitBranch} label="Dependency Agent" value={machinesWithDependency.length}
              color="text-indigo-400" subValue={`of ${machines.length} machines`} />
            <KPICard icon={Eye} label="Change Tracking" value={machinesWithChangeTracking.length}
              color="text-purple-400" subValue={`of ${machines.length} tracked`} />
            <KPICard icon={Monitor} label="Monitored" value={bcdr.machines_with_monitoring || 0}
              color="text-blue-400" subValue={`of ${machines.length} total`} />
          </div>

          {/* Recovery Model + Risks */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {databases.length > 0 && (
              <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
                <h3 className="text-sm font-semibold text-gray-200 mb-3">Database Recovery Models</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Full Recovery', count: dbsFullRecovery, color: 'bg-green-500', desc: 'Point-in-time restore capable' },
                    { label: 'Simple Recovery', count: bcdr.dbs_simple_recovery || 0, color: 'bg-orange-500', desc: 'No log backup possible' },
                    { label: 'Bulk-Logged', count: bcdr.dbs_bulk_logged || 0, color: 'bg-yellow-500', desc: 'Limited log backup' },
                  ].map(item => (
                    <div key={item.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-300">{item.label}</span>
                        <span className="text-gray-500">{item.count} ({databases.length ? Math.round(item.count / databases.length * 100) : 0}%)</span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div className={clsx('h-full rounded-full', item.color)}
                          style={{ width: `${databases.length ? (item.count / databases.length * 100) : 0}%` }} />
                      </div>
                      <p className="text-xs text-gray-600">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
              <h3 className="text-sm font-semibold text-gray-200 mb-3">BCDR Risks ({bcdr.risks?.length || 0})</h3>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {(bcdr.risks || []).map((risk, i) => <RiskCard key={i} risk={risk} />)}
                {(!bcdr.risks || bcdr.risks.length === 0) && (
                  <div className="text-center py-6">
                    <CheckCircle size={24} className="mx-auto text-green-400 mb-2" />
                    <p className="text-sm text-green-300">No critical BCDR risks identified</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* BCDR readiness matrix per machine */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-3">Machine BCDR Readiness Matrix</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-700">
                  <th className="text-left text-gray-500 font-medium py-2 pr-3">Machine</th>
                  <th className="text-left text-gray-500 font-medium py-2 pr-3">OS</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">Connected</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">Monitoring</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">Security</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">Dependency</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">Tracking</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">SQL</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">BCDR Ready</th>
                </tr></thead>
                <tbody>
                  {machines.slice(0, 25).map(m => {
                    const cov = m.coverage || {}
                    const hasDep = m.classified_extensions?.some(e => e.category === 'dependency')
                    const hasSql = m.sql_instances?.length > 0
                    const readyCount = [m.status === 'Connected', cov.monitoring, cov.security, hasDep, cov.change_tracking].filter(Boolean).length
                    const readyPct = Math.round(readyCount / 5 * 100)
                    return (
                      <tr key={m.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span className={clsx('w-2 h-2 rounded-full', m.status === 'Connected' ? 'bg-green-400' : 'bg-red-400')} />
                            <span className="text-gray-200 font-medium truncate max-w-[180px]">{m.name}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-gray-400">{m.osSku || m.osType}</td>
                        <td className="py-2 px-2 text-center">{m.status === 'Connected' ? <CheckCircle size={12} className="mx-auto text-green-400" /> : <AlertTriangle size={12} className="mx-auto text-red-400" />}</td>
                        <td className="py-2 px-2 text-center">{cov.monitoring ? <CheckCircle size={12} className="mx-auto text-green-400" /> : <AlertTriangle size={12} className="mx-auto text-yellow-400" />}</td>
                        <td className="py-2 px-2 text-center">{cov.security ? <CheckCircle size={12} className="mx-auto text-green-400" /> : <AlertTriangle size={12} className="mx-auto text-red-400" />}</td>
                        <td className="py-2 px-2 text-center">{hasDep ? <CheckCircle size={12} className="mx-auto text-indigo-400" /> : <span className="text-gray-700">—</span>}</td>
                        <td className="py-2 px-2 text-center">{cov.change_tracking ? <CheckCircle size={12} className="mx-auto text-purple-400" /> : <span className="text-gray-700">—</span>}</td>
                        <td className="py-2 px-2 text-center">{hasSql ? <Database size={12} className="mx-auto text-teal-400" /> : <span className="text-gray-700">—</span>}</td>
                        <td className="py-2 px-2 text-center">
                          <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium',
                            readyPct >= 80 ? 'bg-green-900/30 text-green-300' :
                            readyPct >= 60 ? 'bg-yellow-900/30 text-yellow-300' :
                            'bg-red-900/30 text-red-300')}>{readyPct}%</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {machines.length > 25 && <p className="text-xs text-gray-600 mt-2 text-center">Showing 25 of {machines.length} — switch to Machine List view for full list</p>}
            </div>
          </div>
        </>
      )}

      {activeView === 'machines' && (
        <>
          {/* Filter + Search + Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 bg-gray-900/60 border border-gray-800 rounded-lg p-1 overflow-x-auto">
              {[
                { key: 'all', label: `All (${machines.length})` },
                { key: 'dependency', label: `Has Dependency (${machinesWithDependency.length})` },
                { key: 'change-tracking', label: `Has Tracking (${machinesWithChangeTracking.length})` },
                { key: 'no-monitoring', label: `No Monitor (${machinesWithoutMonitoring.length})` },
                { key: 'sql', label: `Has SQL (${machinesWithSql.length})` },
                { key: 'disconnected', label: `Offline (${disconnectedMachines.length})` },
              ].map(f => (
                <button key={f.key} onClick={() => { setFilter(f.key); setSelectedIds(new Set()) }}
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
          </div>

          {/* Selection actions */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{filteredMachines.length} machines</span>
            {selectedIds.size > 0 && (
              <>
                <span className="text-xs text-blue-400 font-medium">{selectedIds.size} selected</span>
                {onSelectForAssessment && (
                  <button onClick={() => onSelectForAssessment(filteredMachines.filter(m => selectedIds.has(m.id)))}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 rounded-lg text-xs text-white hover:bg-blue-500">
                    <ArrowUpRight size={12} /> Create BCDR Assessment
                  </button>
                )}
                <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
              </>
            )}
          </div>

          {/* Machine BCDR Table */}
          <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-800/40"><tr className="border-b border-gray-700">
                  <th className="py-2.5 px-2 w-8">
                    <button onClick={toggleSelectAll} className="text-gray-500 hover:text-gray-300">
                      {selectedIds.size === filteredMachines.length && filteredMachines.length > 0
                        ? <CheckSquare size={14} className="text-blue-400" />
                        : <Square size={14} />}
                    </button>
                  </th>
                  <th className="text-left text-gray-500 font-medium py-2.5 px-3">Machine</th>
                  <th className="text-left text-gray-500 font-medium py-2.5 px-3">OS</th>
                  <th className="text-center text-gray-500 font-medium py-2.5 px-2">Status</th>
                  <th className="text-left text-gray-500 font-medium py-2.5 px-3">Location</th>
                  <th className="text-left text-gray-500 font-medium py-2.5 px-3">RG</th>
                  <th className="text-center text-gray-500 font-medium py-2.5 px-2">Monitoring</th>
                  <th className="text-center text-gray-500 font-medium py-2.5 px-2">Dependency</th>
                  <th className="text-center text-gray-500 font-medium py-2.5 px-2">Tracking</th>
                  <th className="text-center text-gray-500 font-medium py-2.5 px-2">SQL</th>
                  <th className="text-left text-gray-500 font-medium py-2.5 px-3">Tags</th>
                </tr></thead>
                <tbody>
                  {filteredMachines.map(m => {
                    const cov = m.coverage || {}
                    const isSelected = selectedIds.has(m.id)
                    const hasDep = m.classified_extensions?.some(e => e.category === 'dependency')
                    const tagCount = Object.keys(m.tags || {}).length
                    return (
                      <tr key={m.id} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/20',
                        isSelected && 'bg-blue-950/20')}>
                        <td className="py-2 px-2" onClick={() => toggleSelect(m.id)}>
                          {isSelected ? <CheckSquare size={14} className="text-blue-400" /> : <Square size={14} className="text-gray-600 hover:text-gray-400" />}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <span className={clsx('w-2 h-2 rounded-full', m.status === 'Connected' ? 'bg-green-400' : 'bg-red-400')} />
                            <span className="text-gray-200 font-medium truncate max-w-[180px]">{m.name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-gray-400 truncate max-w-[140px]">{m.osSku || m.osType}</td>
                        <td className="py-2 px-2 text-center">
                          <span className={clsx('px-1.5 py-0.5 rounded text-[10px]', m.status === 'Connected' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300')}>{m.status}</span>
                        </td>
                        <td className="py-2 px-3 text-gray-500">{m.location}</td>
                        <td className="py-2 px-3 text-gray-500 truncate max-w-[120px]">{m.resourceGroup}</td>
                        <td className="py-2 px-2 text-center">{cov.monitoring ? <CheckCircle size={12} className="mx-auto text-green-400" /> : <AlertTriangle size={12} className="mx-auto text-yellow-400" />}</td>
                        <td className="py-2 px-2 text-center">{hasDep ? <CheckCircle size={12} className="mx-auto text-indigo-400" /> : <span className="text-gray-700">—</span>}</td>
                        <td className="py-2 px-2 text-center">{cov.change_tracking ? <CheckCircle size={12} className="mx-auto text-purple-400" /> : <span className="text-gray-700">—</span>}</td>
                        <td className="py-2 px-2 text-center">{m.sql_instances?.length > 0 ? <span className="text-teal-400">{m.sql_instances.length}</span> : <span className="text-gray-700">—</span>}</td>
                        <td className="py-2 px-3">
                          {tagCount > 0 ? <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{tagCount}</span> : <span className="text-gray-700 text-[10px]">none</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeView === 'dependency' && (
        <>
          <div className="rounded-xl border border-indigo-800/30 bg-gray-900/50 p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2">
              <GitBranch size={14} className="text-indigo-400" /> Dependency Mapping Status
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Dependency Agent collects application dependencies, running processes, and network connections from machines.
              Critical for BCDR planning to understand application topology and blast radius.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <KPICard icon={GitBranch} label="With Dependency Agent" value={machinesWithDependency.length}
                color="text-indigo-400" subValue={`${machines.length ? Math.round(machinesWithDependency.length / machines.length * 100) : 0}% coverage`} />
              <KPICard icon={Server} label="Without Agent" value={machines.length - machinesWithDependency.length}
                color={machines.length - machinesWithDependency.length > 0 ? 'text-orange-400' : 'text-green-400'}
                subValue="missing dependency data" />
              <KPICard icon={Eye} label="With Change Tracking" value={machinesWithChangeTracking.length}
                color="text-purple-400" subValue={`${machines.length ? Math.round(machinesWithChangeTracking.length / machines.length * 100) : 0}% coverage`} />
              <KPICard icon={Database} label="SQL Machines" value={machinesWithSql.length}
                color="text-teal-400" subValue="require special BCDR" />
            </div>

            {/* Machine dependency detail */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-700">
                  <th className="text-left text-gray-500 font-medium py-2 pr-3">Machine</th>
                  <th className="text-left text-gray-500 font-medium py-2 pr-3">OS</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">Dependency</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">Change Tracking</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">Connected</th>
                  <th className="text-left text-gray-500 font-medium py-2 pr-3">Domain</th>
                  <th className="text-right text-gray-500 font-medium py-2">Extensions</th>
                </tr></thead>
                <tbody>
                  {machines.map(m => {
                    const cov = m.coverage || {}
                    const hasDep = m.classified_extensions?.some(e => e.category === 'dependency')
                    return (
                      <tr key={m.id} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/20',
                        !hasDep && 'bg-orange-950/5')}>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span className={clsx('w-2 h-2 rounded-full', m.status === 'Connected' ? 'bg-green-400' : 'bg-red-400')} />
                            <span className="text-gray-200 font-medium">{m.name}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-gray-400">{m.osSku || m.osType}</td>
                        <td className="py-2 px-2 text-center">{hasDep
                          ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-900/30 text-indigo-300">Deployed</span>
                          : <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-900/30 text-orange-300">Missing</span>}</td>
                        <td className="py-2 px-2 text-center">{cov.change_tracking
                          ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-900/30 text-purple-300">Enabled</span>
                          : <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-500">Disabled</span>}</td>
                        <td className="py-2 px-2 text-center">{m.status === 'Connected'
                          ? <CheckCircle size={12} className="mx-auto text-green-400" />
                          : <WifiOff size={12} className="mx-auto text-red-400" />}</td>
                        <td className="py-2 pr-3 text-gray-500">{m.domainName || '—'}</td>
                        <td className="py-2 text-right text-gray-500">{m.classified_extensions?.length || 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeView === 'tracking' && (
        <>
          <div className="rounded-xl border border-purple-800/30 bg-gray-900/50 p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2">
              <Eye size={14} className="text-purple-400" /> Change Tracking & Application Data
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Change Tracking monitors file changes, registry modifications, installed software, Windows services, and Linux daemons.
              This data is critical for understanding application workloads running on machines and planning BCDR strategies.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <KPICard icon={Eye} label="Tracking Enabled" value={machinesWithChangeTracking.length}
                color="text-purple-400" subValue={`of ${machines.length} machines`} />
              <KPICard icon={Server} label="No Tracking" value={machines.length - machinesWithChangeTracking.length}
                color={machines.length - machinesWithChangeTracking.length > 0 ? 'text-orange-400' : 'text-green-400'}
                subValue="no application data" />
              <KPICard icon={GitBranch} label="With Both" value={machines.filter(m => m.coverage?.change_tracking && m.classified_extensions?.some(e => e.category === 'dependency')).length}
                color="text-green-400" subValue="tracking + dependency" />
              <KPICard icon={AlertTriangle} label="No Coverage" value={machines.filter(m => !m.coverage?.change_tracking && !m.classified_extensions?.some(e => e.category === 'dependency')).length}
                color={machines.filter(m => !m.coverage?.change_tracking && !m.classified_extensions?.some(e => e.category === 'dependency')).length > 0 ? 'text-red-400' : 'text-green-400'}
                subValue="blind spots" />
            </div>

            {/* Machine tracking detail */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-gray-700">
                  <th className="text-left text-gray-500 font-medium py-2 pr-3">Machine</th>
                  <th className="text-left text-gray-500 font-medium py-2 pr-3">OS</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">Change Tracking</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">Dependency</th>
                  <th className="text-center text-gray-500 font-medium py-2 px-2">Monitoring</th>
                  <th className="text-left text-gray-500 font-medium py-2 pr-3">Resource Group</th>
                  <th className="text-left text-gray-500 font-medium py-2 pr-3">Location</th>
                  <th className="text-left text-gray-500 font-medium py-2">App Data</th>
                </tr></thead>
                <tbody>
                  {machines.map(m => {
                    const cov = m.coverage || {}
                    const hasDep = m.classified_extensions?.some(e => e.category === 'dependency')
                    const hasTracking = cov.change_tracking
                    const appDataLevel = hasTracking && hasDep ? 'Full' : hasTracking ? 'Partial' : hasDep ? 'Deps Only' : 'None'
                    const appDataColor = appDataLevel === 'Full' ? 'text-green-400' : appDataLevel === 'Partial' ? 'text-yellow-400' : appDataLevel === 'Deps Only' ? 'text-blue-400' : 'text-red-400'
                    return (
                      <tr key={m.id} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/20',
                        appDataLevel === 'None' && 'bg-red-950/5')}>
                        <td className="py-2 pr-3"><div className="flex items-center gap-2">
                          <span className={clsx('w-2 h-2 rounded-full', m.status === 'Connected' ? 'bg-green-400' : 'bg-red-400')} />
                          <span className="text-gray-200 font-medium">{m.name}</span>
                        </div></td>
                        <td className="py-2 pr-3 text-gray-400">{m.osSku || m.osType}</td>
                        <td className="py-2 px-2 text-center">{hasTracking
                          ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-900/30 text-purple-300">Enabled</span>
                          : <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-500">Disabled</span>}</td>
                        <td className="py-2 px-2 text-center">{hasDep
                          ? <CheckCircle size={12} className="mx-auto text-indigo-400" />
                          : <span className="text-gray-700">—</span>}</td>
                        <td className="py-2 px-2 text-center">{cov.monitoring
                          ? <CheckCircle size={12} className="mx-auto text-green-400" />
                          : <AlertTriangle size={12} className="mx-auto text-yellow-400" />}</td>
                        <td className="py-2 pr-3 text-gray-500">{m.resourceGroup}</td>
                        <td className="py-2 pr-3 text-gray-500">{m.location}</td>
                        <td className="py-2"><span className={clsx('text-xs font-medium', appDataColor)}>{appDataLevel}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
