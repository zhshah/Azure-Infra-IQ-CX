import React, { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'
import {
  Database, Server, Shield, Activity, RefreshCw,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle,
  HardDrive, Layers, Lock, Search, Eye,
} from 'lucide-react'

// ── Main SQL & BCDR Component ────────────────────────────────────────────────

export default function ArcSqlBCDR() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [expandedInstance, setExpandedInstance] = useState(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/arc/sql')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const filteredInstances = useMemo(() => {
    if (!data?.instances) return []
    if (!search) return data.instances
    const q = search.toLowerCase()
    return data.instances.filter(inst =>
      (inst.name || '').toLowerCase().includes(q) ||
      (inst.instanceName || '').toLowerCase().includes(q) ||
      (inst.edition || '').toLowerCase().includes(q) ||
      (inst.version || '').toLowerCase().includes(q)
    )
  }, [data, search])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw size={20} className="animate-spin text-teal-400" />
        <span className="ml-2 text-gray-400 text-sm">Loading Arc SQL data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-6 text-center">
        <p className="text-red-300">{error}</p>
        <button onClick={loadData} className="mt-3 px-4 py-2 bg-red-900/40 border border-red-700/50 rounded-lg text-sm text-red-300">Retry</button>
      </div>
    )
  }

  if (!data || data.total_instances === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center">
        <Database size={40} className="mx-auto text-gray-600 mb-4" />
        <h3 className="text-xl font-semibold text-gray-300">No Arc SQL Instances Found</h3>
        <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
          No Arc-enabled SQL Server instances were discovered. SQL instances automatically appear
          when the SQL Server extension is deployed on Arc machines.
        </p>
      </div>
    )
  }

  // Compute BCDR stats
  const dbsWithBackup = data.databases.filter(db => db.backupStatus).length
  const dbsFullRecovery = data.databases.filter(db => (db.recoveryMode || '').toLowerCase() === 'full').length
  const dbsSimple = data.databases.filter(db => (db.recoveryMode || '').toLowerCase() === 'simple').length

  return (
    <div className="space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Database size={14} className="text-teal-400" />
            <span className="text-xs text-gray-500">SQL Instances</span>
          </div>
          <p className="text-2xl font-bold text-teal-400">{data.total_instances}</p>
        </div>
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-4">
          <div className="flex items-center gap-2 mb-1">
            <HardDrive size={14} className="text-blue-400" />
            <span className="text-xs text-gray-500">Databases</span>
          </div>
          <p className="text-2xl font-bold text-blue-400">{data.total_databases}</p>
        </div>
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Layers size={14} className="text-purple-400" />
            <span className="text-xs text-gray-500">Availability Groups</span>
          </div>
          <p className="text-2xl font-bold text-purple-400">{data.total_ags}</p>
        </div>
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Shield size={14} className={dbsWithBackup === data.total_databases ? 'text-green-400' : 'text-orange-400'} />
            <span className="text-xs text-gray-500">Backup Coverage</span>
          </div>
          <p className={clsx('text-2xl font-bold', dbsWithBackup === data.total_databases ? 'text-green-400' : 'text-orange-400')}>
            {data.total_databases ? Math.round(dbsWithBackup / data.total_databases * 100) : 0}%
          </p>
          <p className="text-xs text-gray-600">{dbsWithBackup}/{data.total_databases} with backup</p>
        </div>
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Lock size={14} className={dbsFullRecovery > dbsSimple ? 'text-green-400' : 'text-yellow-400'} />
            <span className="text-xs text-gray-500">Full Recovery</span>
          </div>
          <p className={clsx('text-2xl font-bold', dbsFullRecovery > dbsSimple ? 'text-green-400' : 'text-yellow-400')}>
            {data.total_databases ? Math.round(dbsFullRecovery / data.total_databases * 100) : 0}%
          </p>
          <p className="text-xs text-gray-600">{dbsFullRecovery} Full / {dbsSimple} Simple</p>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search SQL instances..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600"
          />
        </div>
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

          return (
            <div key={inst.id} className={clsx(
              'rounded-xl border transition-all',
              hasBackupGap
                ? 'border-orange-800/40 bg-gray-900/50'
                : 'border-gray-800/60 bg-gray-900/50'
            )}>
              {/* Instance Header */}
              <button
                onClick={() => setExpandedInstance(isExpanded ? null : inst.id)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-800/20 transition-colors rounded-xl"
              >
                <div className="p-2 rounded-lg bg-teal-900/30">
                  <Database size={16} className="text-teal-400" />
                </div>
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
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                    <span>{dbs.length} databases</span>
                    <span>{inst.resourceGroup}</span>
                    {inst.licenseType && <span>License: {inst.licenseType}</span>}
                    {hasBackupGap && <span className="text-orange-400">△ Backup gaps</span>}
                    {hasSimpleRecovery && <span className="text-yellow-400">△ Simple recovery</span>}
                  </div>
                </div>
                {isExpanded ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
              </button>

              {/* Expanded: Database list */}
              {isExpanded && (
                <div className="border-t border-gray-800/50 px-4 pb-4">
                  <table className="w-full text-xs mt-3">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left text-gray-500 font-medium py-2 pr-2">Database</th>
                        <th className="text-left text-gray-500 font-medium py-2 pr-2">State</th>
                        <th className="text-left text-gray-500 font-medium py-2 pr-2">Recovery Model</th>
                        <th className="text-right text-gray-500 font-medium py-2 pr-2">Size (MB)</th>
                        <th className="text-left text-gray-500 font-medium py-2 pr-2">Last Backup</th>
                        <th className="text-center text-gray-500 font-medium py-2">BCDR Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbs.map(db => {
                        const hasBackup = !!db.backupStatus
                        const isFull = (db.recoveryMode || '').toLowerCase() === 'full'
                        const bcdrOk = hasBackup && isFull
                        return (
                          <tr key={db.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                            <td className="py-2 pr-2">
                              <span className="text-gray-200 font-medium">{db.databaseName}</span>
                            </td>
                            <td className="py-2 pr-2">
                              <span className={clsx('text-xs',
                                db.state === 'ONLINE' ? 'text-green-400' : 'text-yellow-400')}>
                                {db.state || '—'}
                              </span>
                            </td>
                            <td className="py-2 pr-2">
                              <span className={clsx('text-xs px-1.5 py-0.5 rounded border',
                                isFull ? 'bg-green-900/20 text-green-300 border-green-800/40' :
                                'bg-yellow-900/20 text-yellow-300 border-yellow-800/40')}>
                                {db.recoveryMode || '—'}
                              </span>
                            </td>
                            <td className="py-2 pr-2 text-right text-gray-400">
                              {db.sizeMB ? `${Math.round(db.sizeMB).toLocaleString()}` : '—'}
                            </td>
                            <td className="py-2 pr-2 text-gray-500">
                              {db.backupStatus ? db.backupStatus.split('T')[0] : (
                                <span className="text-red-400">No backup</span>
                              )}
                            </td>
                            <td className="py-2 text-center">
                              {bcdrOk ? (
                                <CheckCircle size={13} className="inline text-green-400" />
                              ) : (
                                <AlertTriangle size={13} className="inline text-orange-400" />
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  {/* Instance-level BCDR Summary */}
                  <div className="mt-3 p-3 rounded-lg bg-gray-800/30 border border-gray-800/40">
                    <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">BCDR Assessment</h5>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-gray-600">Backup Coverage:</span>
                        <span className={clsx('ml-1 font-medium',
                          dbs.filter(d => d.backupStatus).length === dbs.length ? 'text-green-400' : 'text-orange-400')}>
                          {dbs.filter(d => d.backupStatus).length}/{dbs.length}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Full Recovery:</span>
                        <span className={clsx('ml-1 font-medium',
                          dbs.filter(d => (d.recoveryMode || '').toLowerCase() === 'full').length === dbs.length ? 'text-green-400' : 'text-yellow-400')}>
                          {dbs.filter(d => (d.recoveryMode || '').toLowerCase() === 'full').length}/{dbs.length}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Total Size:</span>
                        <span className="ml-1 text-gray-300">
                          {(dbs.reduce((s, d) => s + (d.sizeMB || 0), 0) / 1024).toFixed(1)} GB
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Read-Only:</span>
                        <span className="ml-1 text-gray-300">{dbs.filter(d => d.isReadOnly).length}</span>
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
          <h3 className="text-sm font-semibold text-purple-300 mb-3 flex items-center gap-2">
            <Layers size={14} /> Availability Groups ({data.availability_groups.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.availability_groups.map(ag => (
              <div key={ag.id} className="rounded-lg border border-purple-800/30 bg-purple-950/10 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-purple-200">{ag.agName}</span>
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full border',
                    ag.healthState === 'HEALTHY' ? 'bg-green-900/30 text-green-300 border-green-800/50' : 'bg-yellow-900/30 text-yellow-300 border-yellow-800/50')}>
                    {ag.healthState || 'Unknown'}
                  </span>
                </div>
                <div className="mt-2 text-xs text-gray-500 space-y-0.5">
                  {ag.primaryReplica && <div>Primary: <span className="text-gray-300">{ag.primaryReplica}</span></div>}
                  {ag.failoverMode && <div>Failover: <span className="text-gray-300">{ag.failoverMode}</span></div>}
                  {ag.availabilityMode && <div>Mode: <span className="text-gray-300">{ag.availabilityMode}</span></div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
