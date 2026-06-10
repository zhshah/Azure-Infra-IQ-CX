import React, { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'
import {
  Database, Server, Shield, RefreshCw, Search,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle,
  HardDrive, Layers, Lock, Eye,
} from 'lucide-react'

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ icon: Icon, label, value, subValue, color = 'text-blue-400' }) {
  return (
    <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-4">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-gray-800/80"><Icon size={14} className={color} /></div>
        <span className="text-xs text-gray-500 font-medium">{label}</span>
      </div>
      <p className={clsx('text-2xl font-bold mt-2 tabular-nums', color)}>{value}</p>
      {subValue && <p className="text-xs text-gray-600 mt-0.5">{subValue}</p>}
    </div>
  )
}

// ── Main SQL Component ───────────────────────────────────────────────────────

export default function ArcSQL() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [expandedInstance, setExpandedInstance] = useState(null)
  const [editionFilter, setEditionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/arc/sql')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const filteredInstances = useMemo(() => {
    if (!data?.instances) return []
    let result = data.instances
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(inst =>
        (inst.name || '').toLowerCase().includes(q) ||
        (inst.instanceName || '').toLowerCase().includes(q) ||
        (inst.edition || '').toLowerCase().includes(q) ||
        (inst.version || '').toLowerCase().includes(q) ||
        (inst.resourceGroup || '').toLowerCase().includes(q)
      )
    }
    if (editionFilter !== 'all') result = result.filter(inst => (inst.edition || '').toLowerCase() === editionFilter.toLowerCase())
    if (statusFilter !== 'all') result = result.filter(inst => (inst.status || '').toLowerCase() === statusFilter.toLowerCase())
    return result
  }, [data, search, editionFilter, statusFilter])

  // Derive editions and statuses for filters
  const editions = useMemo(() => [...new Set((data?.instances || []).map(i => i.edition).filter(Boolean))].sort(), [data])
  const statuses = useMemo(() => [...new Set((data?.instances || []).map(i => i.status).filter(Boolean))].sort(), [data])

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <RefreshCw size={20} className="animate-spin text-teal-400" />
      <span className="ml-2 text-gray-400 text-sm">Loading Arc SQL data...</span>
    </div>
  )

  if (error) return (
    <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-6 text-center">
      <p className="text-red-300">{error}</p>
      <button onClick={loadData} className="mt-3 px-4 py-2 bg-red-900/40 border border-red-700/50 rounded-lg text-sm text-red-300">Retry</button>
    </div>
  )

  if (!data || data.total_instances === 0) return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center">
      <Database size={40} className="mx-auto text-gray-600 mb-4" />
      <h3 className="text-xl font-semibold text-gray-300">No Arc SQL Instances Found</h3>
      <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
        SQL instances automatically appear when the SQL Server extension is deployed on Arc machines.
      </p>
    </div>
  )

  const dbsWithBackup = data.databases.filter(db => db.backupStatus).length
  const dbsFullRecovery = data.databases.filter(db => (db.recoveryMode || '').toLowerCase() === 'full').length
  const dbsSimple = data.databases.filter(db => (db.recoveryMode || '').toLowerCase() === 'simple').length
  const totalSizeMB = data.databases.reduce((s, db) => s + (db.sizeMB || 0), 0)

  return (
    <div className="space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KPICard icon={Database} label="SQL Instances" value={data.total_instances} color="text-teal-400"
          subValue={`across ${new Set(data.instances.map(i => i.resourceGroup)).size} RGs`} />
        <KPICard icon={HardDrive} label="Databases" value={data.total_databases} color="text-blue-400"
          subValue={`${totalSizeMB > 1024 ? `${(totalSizeMB / 1024).toFixed(1)} GB` : `${Math.round(totalSizeMB)} MB`} total`} />
        <KPICard icon={Layers} label="Availability Groups" value={data.total_ags} color="text-purple-400"
          subValue={data.total_ags > 0 ? 'HA configured' : 'no HA protection'} />
        <KPICard icon={Shield} label="Backup Coverage" value={`${data.total_databases ? Math.round(dbsWithBackup / data.total_databases * 100) : 0}%`}
          color={dbsWithBackup === data.total_databases ? 'text-green-400' : 'text-orange-400'}
          subValue={`${dbsWithBackup}/${data.total_databases} with backup`} />
        <KPICard icon={Lock} label="Full Recovery" value={`${data.total_databases ? Math.round(dbsFullRecovery / data.total_databases * 100) : 0}%`}
          color={dbsFullRecovery > dbsSimple ? 'text-green-400' : 'text-yellow-400'}
          subValue={`${dbsFullRecovery} Full / ${dbsSimple} Simple`} />
        <KPICard icon={Eye} label="Read-Only DBs" value={data.databases.filter(db => db.isReadOnly).length}
          color="text-gray-400" subValue={`of ${data.total_databases} total`} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder="Search SQL instances..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600" />
        </div>
        {editions.length > 1 && (
          <select value={editionFilter} onChange={e => setEditionFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600">
            <option value="all">All Editions</option>
            {editions.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        )}
        {statuses.length > 1 && (
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600">
            <option value="all">All Status</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <span className="text-xs text-gray-500">{filteredInstances.length} of {data.total_instances} instances</span>
        <button onClick={loadData} className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* SQL Instance Cards */}
      <div className="space-y-3">
        {filteredInstances.map(inst => {
          const isExpanded = expandedInstance === inst.id
          const dbs = inst.databases || []
          const hasBackupGap = dbs.some(db => !db.backupStatus)
          const hasSimpleRecovery = dbs.some(db => (db.recoveryMode || '').toLowerCase() === 'simple')
          const instSizeMB = dbs.reduce((s, db) => s + (db.sizeMB || 0), 0)

          return (
            <div key={inst.id} className={clsx('rounded-xl border transition-all',
              hasBackupGap ? 'border-orange-800/40 bg-gray-900/50' : 'border-gray-800/60 bg-gray-900/50')}>
              {/* Instance Header */}
              <button onClick={() => setExpandedInstance(isExpanded ? null : inst.id)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-800/20 transition-colors rounded-xl">
                <div className="p-2 rounded-lg bg-teal-900/30"><Database size={16} className="text-teal-400" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{inst.instanceName || inst.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                      {inst.edition || 'Unknown'} {inst.version}
                    </span>
                    {inst.status && (
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full border',
                        inst.status === 'Connected' ? 'bg-green-900/30 text-green-300 border-green-800/50' : 'bg-red-900/30 text-red-300 border-red-800/50')}>
                        {inst.status}
                      </span>
                    )}
                    {inst.currentVersion && <span className="text-xs text-gray-600">v{inst.currentVersion}</span>}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 flex-wrap">
                    <span>{dbs.length} databases</span>
                    <span>{inst.resourceGroup}</span>
                    <span>{inst.location}</span>
                    {inst.licenseType && <span>License: {inst.licenseType}</span>}
                    {inst.vCore && <span>{inst.vCore} vCore</span>}
                    {inst.patchLevel && <span>Patch: {inst.patchLevel}</span>}
                    {instSizeMB > 0 && <span>{instSizeMB > 1024 ? `${(instSizeMB / 1024).toFixed(1)} GB` : `${Math.round(instSizeMB)} MB`}</span>}
                    {hasBackupGap && <span className="text-orange-400">△ Backup gaps</span>}
                    {hasSimpleRecovery && <span className="text-yellow-400">△ Simple recovery</span>}
                  </div>
                </div>
                {isExpanded ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
              </button>

              {/* Expanded: Database list + details */}
              {isExpanded && (
                <div className="border-t border-gray-800/50 px-4 pb-4">
                  {/* Instance config */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 mb-3">
                    {[
                      { label: 'Collation', value: inst.collation || '—' },
                      { label: 'TCP Ports', value: inst.tcpPorts || '—' },
                      { label: 'Product ID', value: inst.productId || '—' },
                      { label: 'Patch Level', value: inst.patchLevel || '—' },
                    ].map(item => (
                      <div key={item.label} className="text-xs">
                        <span className="text-gray-600">{item.label}: </span>
                        <span className="text-gray-400">{item.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Database table */}
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left text-gray-500 font-medium py-2 pr-2">Database</th>
                        <th className="text-left text-gray-500 font-medium py-2 pr-2">State</th>
                        <th className="text-left text-gray-500 font-medium py-2 pr-2">Recovery Model</th>
                        <th className="text-right text-gray-500 font-medium py-2 pr-2">Size (MB)</th>
                        <th className="text-right text-gray-500 font-medium py-2 pr-2">Free (MB)</th>
                        <th className="text-left text-gray-500 font-medium py-2 pr-2">Compat Level</th>
                        <th className="text-left text-gray-500 font-medium py-2 pr-2">Last Full Backup</th>
                        <th className="text-left text-gray-500 font-medium py-2 pr-2">Last Log Backup</th>
                        <th className="text-center text-gray-500 font-medium py-2">Read-Only</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbs.map(db => {
                        const hasBackup = !!db.backupStatus
                        const isFull = (db.recoveryMode || '').toLowerCase() === 'full'
                        return (
                          <tr key={db.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                            <td className="py-2 pr-2"><span className="text-gray-200 font-medium">{db.databaseName}</span></td>
                            <td className="py-2 pr-2">
                              <span className={clsx('text-xs', db.state === 'ONLINE' ? 'text-green-400' : 'text-yellow-400')}>{db.state || '—'}</span>
                            </td>
                            <td className="py-2 pr-2">
                              <span className={clsx('text-xs px-1.5 py-0.5 rounded border',
                                isFull ? 'bg-green-900/20 text-green-300 border-green-800/40' : 'bg-yellow-900/20 text-yellow-300 border-yellow-800/40')}>
                                {db.recoveryMode || '—'}
                              </span>
                            </td>
                            <td className="py-2 pr-2 text-right text-gray-400 tabular-nums">{db.sizeMB ? Math.round(db.sizeMB).toLocaleString() : '—'}</td>
                            <td className="py-2 pr-2 text-right text-gray-500 tabular-nums">{db.spaceAvailableMB ? Math.round(db.spaceAvailableMB).toLocaleString() : '—'}</td>
                            <td className="py-2 pr-2 text-gray-500">{db.compatLevel || '—'}</td>
                            <td className="py-2 pr-2">
                              {db.backupStatus
                                ? <span className="text-gray-400">{db.backupStatus.split('T')[0]}</span>
                                : <span className="text-red-400">No backup</span>}
                            </td>
                            <td className="py-2 pr-2">
                              {db.lastLogBackup
                                ? <span className="text-gray-400">{db.lastLogBackup.split('T')[0]}</span>
                                : <span className="text-gray-600">—</span>}
                            </td>
                            <td className="py-2 text-center">
                              {db.isReadOnly ? <Lock size={12} className="mx-auto text-yellow-400" /> : <span className="text-gray-700">—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  {/* Instance BCDR Summary */}
                  <div className="mt-3 p-3 rounded-lg bg-gray-800/30 border border-gray-800/40">
                    <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">SQL Summary</h5>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                      <div><span className="text-gray-600">Backup: </span>
                        <span className={clsx('font-medium', dbs.filter(d => d.backupStatus).length === dbs.length ? 'text-green-400' : 'text-orange-400')}>
                          {dbs.filter(d => d.backupStatus).length}/{dbs.length}
                        </span>
                      </div>
                      <div><span className="text-gray-600">Full Recovery: </span>
                        <span className={clsx('font-medium', dbs.filter(d => (d.recoveryMode || '').toLowerCase() === 'full').length === dbs.length ? 'text-green-400' : 'text-yellow-400')}>
                          {dbs.filter(d => (d.recoveryMode || '').toLowerCase() === 'full').length}/{dbs.length}
                        </span>
                      </div>
                      <div><span className="text-gray-600">Total Size: </span>
                        <span className="text-gray-300">{instSizeMB > 1024 ? `${(instSizeMB / 1024).toFixed(1)} GB` : `${Math.round(instSizeMB)} MB`}</span>
                      </div>
                      <div><span className="text-gray-600">Read-Only: </span>
                        <span className="text-gray-300">{dbs.filter(d => d.isReadOnly).length}</span>
                      </div>
                      <div><span className="text-gray-600">Online: </span>
                        <span className="text-gray-300">{dbs.filter(d => d.state === 'ONLINE').length}/{dbs.length}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Availability Groups */}
      {data.availability_groups?.length > 0 && (
        <div className="rounded-xl border border-purple-800/30 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
            <Layers size={14} className="text-purple-400" /> Availability Groups ({data.availability_groups.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-gray-700">
                <th className="text-left text-gray-500 font-medium py-2 pr-3">AG Name</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Primary Replica</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Failover Mode</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Availability Mode</th>
                <th className="text-left text-gray-500 font-medium py-2 pr-3">Health</th>
                <th className="text-left text-gray-500 font-medium py-2">Resource Group</th>
              </tr></thead>
              <tbody>
                {data.availability_groups.map(ag => (
                  <tr key={ag.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                    <td className="py-2 pr-3 text-purple-300 font-medium">{ag.agName}</td>
                    <td className="py-2 pr-3 text-gray-300">{ag.primaryReplica || '—'}</td>
                    <td className="py-2 pr-3 text-gray-400">{ag.failoverMode || '—'}</td>
                    <td className="py-2 pr-3 text-gray-400">{ag.availabilityMode || '—'}</td>
                    <td className="py-2 pr-3">
                      <span className={clsx('px-1.5 py-0.5 rounded text-[10px]',
                        (ag.healthState || '').toLowerCase() === 'healthy' ? 'bg-green-900/30 text-green-300' :
                        'bg-yellow-900/30 text-yellow-300')}>
                        {ag.healthState || '—'}
                      </span>
                    </td>
                    <td className="py-2 text-gray-500">{ag.resourceGroup}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All Databases flat view */}
      <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">All Databases ({data.total_databases})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-gray-700">
              <th className="text-left text-gray-500 font-medium py-2 pr-2">Database</th>
              <th className="text-left text-gray-500 font-medium py-2 pr-2">State</th>
              <th className="text-left text-gray-500 font-medium py-2 pr-2">Recovery</th>
              <th className="text-right text-gray-500 font-medium py-2 pr-2">Size</th>
              <th className="text-left text-gray-500 font-medium py-2 pr-2">Last Backup</th>
              <th className="text-center text-gray-500 font-medium py-2">Status</th>
            </tr></thead>
            <tbody>
              {data.databases.map(db => {
                const hasBackup = !!db.backupStatus
                const isFull = (db.recoveryMode || '').toLowerCase() === 'full'
                const ok = hasBackup && isFull
                return (
                  <tr key={db.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                    <td className="py-2 pr-2 text-gray-200 font-medium">{db.databaseName}</td>
                    <td className="py-2 pr-2"><span className={clsx('text-xs', db.state === 'ONLINE' ? 'text-green-400' : 'text-yellow-400')}>{db.state || '—'}</span></td>
                    <td className="py-2 pr-2">
                      <span className={clsx('text-xs px-1.5 py-0.5 rounded border',
                        isFull ? 'bg-green-900/20 text-green-300 border-green-800/40' : 'bg-yellow-900/20 text-yellow-300 border-yellow-800/40')}>
                        {db.recoveryMode || '—'}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right text-gray-400 tabular-nums">{db.sizeMB ? `${Math.round(db.sizeMB).toLocaleString()} MB` : '—'}</td>
                    <td className="py-2 pr-2">{db.backupStatus ? <span className="text-gray-400">{db.backupStatus.split('T')[0]}</span> : <span className="text-red-400">No backup</span>}</td>
                    <td className="py-2 text-center">{ok ? <CheckCircle size={13} className="inline text-green-400" /> : <AlertTriangle size={13} className="inline text-orange-400" />}</td>
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
