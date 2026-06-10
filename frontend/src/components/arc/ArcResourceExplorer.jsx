import React, { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'
import {
  Server, Shield, Monitor, Database, Search, Filter,
  Cpu, HardDrive, RefreshCw, ChevronDown, ChevronRight, ChevronUp,
  Wifi, WifiOff, Tag, Settings, Terminal, CheckCircle,
  X, ExternalLink, Layers, Eye, MapPin, Square, CheckSquare,
  Download, AlertTriangle, ArrowUpRight, GitBranch,
} from 'lucide-react'

// ── Machine Detail Drawer ────────────────────────────────────────────────────

function MachineDetail({ machine, onClose }) {
  if (!machine) return null
  const cov = machine.coverage || {}
  const CoverageIndicator = ({ label, covered }) => (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-800/40">
      <span className="text-xs text-gray-400">{label}</span>
      {covered
        ? <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={11} /> Deployed</span>
        : <span className="text-xs text-red-400 flex items-center gap-1"><X size={11} /> Missing</span>}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative ml-auto w-[520px] bg-gray-900 border-l border-gray-800 overflow-y-auto">
        <div className="sticky top-0 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-white">{machine.name}</h2>
            <p className="text-xs text-gray-500 font-mono">{machine.machineFqdn || machine.osName || machine.osType}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Status & OS badges */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
              machine.status === 'Connected' ? 'bg-green-900/30 text-green-300 border-green-800/50' : 'bg-red-900/30 text-red-300 border-red-800/50')}>
              {machine.status === 'Connected' ? <Wifi size={11} /> : <WifiOff size={11} />} {machine.status}
            </span>
            {machine.osType && <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{machine.osType}</span>}
            {machine.cloudProvider && <span className="text-xs px-2 py-0.5 rounded bg-blue-900/30 text-blue-300 border border-blue-800/50">{machine.cloudProvider}</span>}
          </div>

          {/* Machine Info */}
          <div className="rounded-lg border border-gray-800/60 bg-gray-800/20 p-4 space-y-2 text-xs">
            <h4 className="text-gray-400 font-semibold uppercase tracking-wider text-[10px]">Machine Details</h4>
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-gray-600">FQDN: </span><span className="text-gray-300">{machine.machineFqdn || '—'}</span></div>
              <div><span className="text-gray-600">Domain: </span><span className="text-gray-300">{machine.domainName || '—'}</span></div>
              <div><span className="text-gray-600">Location: </span><span className="text-gray-300">{machine.location}</span></div>
              <div><span className="text-gray-600">RG: </span><span className="text-gray-300">{machine.resourceGroup}</span></div>
              <div><span className="text-gray-600">Subscription: </span><span className="text-gray-300 font-mono text-[10px]">{machine.subscriptionId?.slice(0, 8)}…</span></div>
              <div><span className="text-gray-600">OS: </span><span className="text-gray-300">{machine.osSku || machine.osName || '—'}</span></div>
              <div><span className="text-gray-600">Cores: </span><span className="text-gray-300">{machine.cores || '—'}</span></div>
              <div><span className="text-gray-600">Memory: </span><span className="text-gray-300">{machine.totalMemoryGB ? `${machine.totalMemoryGB.toFixed(1)} GB` : '—'}</span></div>
              <div><span className="text-gray-600">Manufacturer: </span><span className="text-gray-300">{machine.manufacturer || '—'}</span></div>
              <div><span className="text-gray-600">Model: </span><span className="text-gray-300">{machine.model || '—'}</span></div>
              <div className="col-span-2"><span className="text-gray-600">Agent: </span><span className="text-gray-300">v{machine.agentVersion || '—'}</span></div>
              {machine.processor && <div className="col-span-2"><span className="text-gray-600">CPU: </span><span className="text-gray-300">{machine.processor}</span></div>}
              {machine.licenseStatus && <div><span className="text-gray-600">License: </span><span className="text-gray-300">{machine.licenseStatus}</span></div>}
              {machine.esuEnabled && <div><span className="text-gray-600">ESU: </span><span className="text-gray-300">{machine.esuEnabled}</span></div>}
              {machine.lastStatusChange && <div className="col-span-2"><span className="text-gray-600">Last Status Change: </span><span className="text-gray-300">{machine.lastStatusChange?.split('T')[0]}</span></div>}
            </div>
          </div>

          {/* Coverage */}
          <div className="rounded-lg border border-gray-800/60 bg-gray-800/20 p-4">
            <h4 className="text-gray-400 font-semibold uppercase tracking-wider text-[10px] mb-2">Coverage Status</h4>
            <CoverageIndicator label="Monitoring Agent" covered={cov.monitoring} />
            <CoverageIndicator label="Endpoint Security" covered={cov.security} />
            <CoverageIndicator label="Patch Management" covered={cov.patching} />
            <CoverageIndicator label="Change Tracking" covered={cov.change_tracking} />
            <CoverageIndicator label="SQL Extension" covered={cov.sql_extension} />
          </div>

          {/* Extensions */}
          {machine.classified_extensions?.length > 0 && (
            <div className="rounded-lg border border-gray-800/60 bg-gray-800/20 p-4">
              <h4 className="text-gray-400 font-semibold uppercase tracking-wider text-[10px] mb-2">
                Installed Extensions ({machine.classified_extensions.length})
              </h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {machine.classified_extensions.map((ext, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-gray-800/30">
                    <span className={clsx('w-2 h-2 rounded-full',
                      ext.category === 'security' ? 'bg-red-400' :
                      ext.category === 'monitoring' ? 'bg-blue-400' :
                      ext.category === 'patching' ? 'bg-orange-400' :
                      ext.category === 'change_tracking' ? 'bg-purple-400' :
                      ext.category === 'dependency' ? 'bg-indigo-400' :
                      ext.category === 'sql' ? 'bg-teal-400' : 'bg-gray-500')} />
                    <span className="text-gray-300">{ext.label}</span>
                    <span className="ml-auto text-gray-600 capitalize">{ext.category}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SQL Instances */}
          {machine.sql_instances?.length > 0 && (
            <div className="rounded-lg border border-teal-800/30 bg-teal-950/10 p-4">
              <h4 className="text-teal-400 font-semibold uppercase tracking-wider text-[10px] mb-2">
                <Database size={11} className="inline mr-1" /> SQL Instances ({machine.sql_instances.length})
              </h4>
              {machine.sql_instances.map((sql, i) => (
                <div key={i} className="mb-2 p-2 rounded bg-gray-800/30 border border-gray-800/40">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-teal-300 font-medium">{sql.instanceName || sql.name}</span>
                    <span className="text-gray-500">{sql.edition} {sql.version}</span>
                  </div>
                  {sql.databases?.length > 0 && <p className="text-xs text-gray-500 mt-1">{sql.databases.length} database(s)</p>}
                </div>
              ))}
            </div>
          )}

          {/* Tags */}
          {machine.tags && Object.keys(machine.tags).length > 0 && (
            <div className="rounded-lg border border-gray-800/60 bg-gray-800/20 p-4">
              <h4 className="text-gray-400 font-semibold uppercase tracking-wider text-[10px] mb-2">Tags ({Object.keys(machine.tags).length})</h4>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(machine.tags).map(([k, v]) => (
                  <span key={k} className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">{k}: {v}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Resource Explorer ───────────────────────────────────────────────────

export default function ArcResourceExplorer({ onSelectForAssessment }) {
  const [machines, setMachines] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [osFilter, setOsFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [rgFilter, setRgFilter] = useState('all')
  const [locationFilter, setLocationFilter] = useState('all')
  const [coverageFilter, setCoverageFilter] = useState('all')
  const [selectedMachine, setSelectedMachine] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25

  useEffect(() => { loadMachines() }, [])

  async function loadMachines() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/arc/summary')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setMachines(json.machines || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const resourceGroups = useMemo(() => [...new Set(machines.map(m => m.resourceGroup).filter(Boolean))].sort(), [machines])
  const locations = useMemo(() => [...new Set(machines.map(m => m.location).filter(Boolean))].sort(), [machines])

  const filtered = useMemo(() => {
    let result = machines
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(m =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.machineFqdn || '').toLowerCase().includes(q) ||
        (m.osName || '').toLowerCase().includes(q) ||
        (m.osSku || '').toLowerCase().includes(q) ||
        (m.domainName || '').toLowerCase().includes(q) ||
        (m.manufacturer || '').toLowerCase().includes(q) ||
        JSON.stringify(m.tags || {}).toLowerCase().includes(q)
      )
    }
    if (osFilter !== 'all') result = result.filter(m => (m.osType || '').toLowerCase() === osFilter.toLowerCase())
    if (statusFilter !== 'all') result = result.filter(m => (m.status || '').toLowerCase() === statusFilter.toLowerCase())
    if (rgFilter !== 'all') result = result.filter(m => m.resourceGroup === rgFilter)
    if (locationFilter !== 'all') result = result.filter(m => m.location === locationFilter)
    if (coverageFilter === 'full') result = result.filter(m => m.coverage?.security && m.coverage?.monitoring && m.coverage?.patching && m.coverage?.change_tracking)
    else if (coverageFilter === 'partial') result = result.filter(m => {
      const c = m.coverage || {}; const cnt = [c.security, c.monitoring, c.patching, c.change_tracking].filter(Boolean).length
      return cnt > 0 && cnt < 4
    })
    else if (coverageFilter === 'none') result = result.filter(m => !m.coverage?.security && !m.coverage?.monitoring && !m.coverage?.patching && !m.coverage?.change_tracking)

    result = [...result].sort((a, b) => {
      let va, vb
      if (sortBy === 'cores') { va = a.cores || 0; vb = b.cores || 0 }
      else if (sortBy === 'memory') { va = a.totalMemoryGB || 0; vb = b.totalMemoryGB || 0 }
      else if (sortBy === 'extensions') { va = a.classified_extensions?.length || 0; vb = b.classified_extensions?.length || 0 }
      else if (sortBy === 'coverage') {
        const cc = m => [m.coverage?.security, m.coverage?.monitoring, m.coverage?.patching, m.coverage?.change_tracking].filter(Boolean).length
        va = cc(a); vb = cc(b)
      }
      else { va = (a[sortBy] || '').toString().toLowerCase(); vb = (b[sortBy] || '').toString().toLowerCase() }
      if (typeof va === 'number') return sortDir === 'asc' ? va - vb : vb - va
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })
    return result
  }, [machines, search, osFilter, statusFilter, rgFilter, locationFilter, coverageFilter, sortBy, sortDir])

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(m => m.id)))
  }

  function exportCSV() {
    const sel = filtered.filter(m => selectedIds.has(m.id))
    const data = (sel.length > 0 ? sel : filtered)
    const headers = ['Name', 'OS', 'Status', 'Location', 'Resource Group', 'Cores', 'Memory (GB)', 'FQDN', 'Domain', 'Agent Version', 'Security', 'Monitoring', 'Patching', 'Change Tracking', 'Extensions', 'SQL Instances']
    const rows = data.map(m => [
      m.name, m.osSku || m.osName || m.osType, m.status, m.location, m.resourceGroup,
      m.cores || '', m.totalMemoryGB?.toFixed(1) || '', m.machineFqdn || '', m.domainName || '', m.agentVersion || '',
      m.coverage?.security ? 'Yes' : 'No', m.coverage?.monitoring ? 'Yes' : 'No',
      m.coverage?.patching ? 'Yes' : 'No', m.coverage?.change_tracking ? 'Yes' : 'No',
      m.classified_extensions?.length || 0, m.sql_instances?.length || 0
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `arc-machines-${Date.now()}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return <ChevronDown size={10} className="text-gray-700" />
    return sortDir === 'asc' ? <ChevronUp size={11} className="text-blue-400" /> : <ChevronDown size={11} className="text-blue-400" />
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <RefreshCw size={20} className="animate-spin text-blue-400" />
      <span className="ml-2 text-gray-400 text-sm">Loading Arc machines...</span>
    </div>
  )

  if (error) return (
    <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-6 text-center">
      <p className="text-red-300">{error}</p>
      <button onClick={loadMachines} className="mt-3 px-4 py-2 bg-red-900/40 border border-red-700/50 rounded-lg text-sm text-red-300">Retry</button>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" placeholder="Search machines (name, FQDN, OS, domain, tags)..."
            value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600" />
        </div>
        <select value={osFilter} onChange={e => { setOsFilter(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600">
          <option value="all">All OS</option>
          <option value="windows">Windows</option>
          <option value="linux">Linux</option>
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600">
          <option value="all">All Status</option>
          <option value="connected">Connected</option>
          <option value="disconnected">Disconnected</option>
        </select>
        <select value={rgFilter} onChange={e => { setRgFilter(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600">
          <option value="all">All Resource Groups</option>
          {resourceGroups.map(rg => <option key={rg} value={rg}>{rg}</option>)}
        </select>
        <select value={locationFilter} onChange={e => { setLocationFilter(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600">
          <option value="all">All Locations</option>
          {locations.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={coverageFilter} onChange={e => { setCoverageFilter(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600">
          <option value="all">All Coverage</option>
          <option value="full">Full Coverage</option>
          <option value="partial">Partial Coverage</option>
          <option value="none">No Coverage</option>
        </select>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{filtered.length} of {machines.length} machines</span>
          {selectedIds.size > 0 && (
            <>
              <span className="text-xs text-blue-400 font-medium">{selectedIds.size} selected</span>
              <button onClick={exportCSV}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700">
                <Download size={12} /> Export Selected
              </button>
              {onSelectForAssessment && (
                <button onClick={() => onSelectForAssessment(filtered.filter(m => selectedIds.has(m.id)))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 rounded-lg text-xs text-white hover:bg-blue-500">
                  <ArrowUpRight size={12} /> Send to Assessment
                </button>
              )}
              <button onClick={() => setSelectedIds(new Set())}
                className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700">
            <Download size={12} /> CSV
          </button>
          <button onClick={loadMachines} className="p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Machine Table */}
      <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-800/40">
              <tr className="border-b border-gray-700">
                <th className="py-2.5 px-2 w-8">
                  <button onClick={toggleSelectAll} className="text-gray-500 hover:text-gray-300">
                    {selectedIds.size === filtered.length && filtered.length > 0
                      ? <CheckSquare size={14} className="text-blue-400" />
                      : <Square size={14} />}
                  </button>
                </th>
                <th className="text-left text-gray-500 font-medium py-2.5 px-3 cursor-pointer hover:text-gray-300" onClick={() => toggleSort('name')}>
                  <div className="flex items-center gap-1">Machine <SortIcon col="name" /></div>
                </th>
                <th className="text-left text-gray-500 font-medium py-2.5 px-3 cursor-pointer hover:text-gray-300" onClick={() => toggleSort('osType')}>
                  <div className="flex items-center gap-1">OS <SortIcon col="osType" /></div>
                </th>
                <th className="text-center text-gray-500 font-medium py-2.5 px-2 cursor-pointer hover:text-gray-300" onClick={() => toggleSort('status')}>
                  <div className="flex items-center justify-center gap-1">Status <SortIcon col="status" /></div>
                </th>
                <th className="text-left text-gray-500 font-medium py-2.5 px-3 cursor-pointer hover:text-gray-300" onClick={() => toggleSort('location')}>
                  <div className="flex items-center gap-1">Location <SortIcon col="location" /></div>
                </th>
                <th className="text-right text-gray-500 font-medium py-2.5 px-2 cursor-pointer hover:text-gray-300" onClick={() => toggleSort('cores')}>
                  <div className="flex items-center justify-end gap-1">CPU <SortIcon col="cores" /></div>
                </th>
                <th className="text-right text-gray-500 font-medium py-2.5 px-2 cursor-pointer hover:text-gray-300" onClick={() => toggleSort('memory')}>
                  <div className="flex items-center justify-end gap-1">Memory <SortIcon col="memory" /></div>
                </th>
                <th className="text-center text-gray-500 font-medium py-2.5 px-2"><Shield size={10} className="inline" /></th>
                <th className="text-center text-gray-500 font-medium py-2.5 px-2"><Monitor size={10} className="inline" /></th>
                <th className="text-center text-gray-500 font-medium py-2.5 px-2"><Settings size={10} className="inline" /></th>
                <th className="text-center text-gray-500 font-medium py-2.5 px-2"><Eye size={10} className="inline" /></th>
                <th className="text-center text-gray-500 font-medium py-2.5 px-2"><GitBranch size={10} className="inline" /></th>
                <th className="text-right text-gray-500 font-medium py-2.5 px-2 cursor-pointer hover:text-gray-300" onClick={() => toggleSort('extensions')}>
                  <div className="flex items-center justify-end gap-1">Ext <SortIcon col="extensions" /></div>
                </th>
                <th className="text-left text-gray-500 font-medium py-2.5 px-3">Tags</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(m => {
                const cov = m.coverage || {}
                const isSelected = selectedIds.has(m.id)
                const hasDep = m.classified_extensions?.some(e => e.category === 'dependency')
                const tagCount = Object.keys(m.tags || {}).length
                return (
                  <tr key={m.id} className={clsx('border-b border-gray-800/30 hover:bg-gray-800/20 cursor-pointer',
                    isSelected && 'bg-blue-950/20')}>
                    <td className="py-2 px-2" onClick={e => { e.stopPropagation(); toggleSelect(m.id) }}>
                      {isSelected
                        ? <CheckSquare size={14} className="text-blue-400" />
                        : <Square size={14} className="text-gray-600 hover:text-gray-400" />}
                    </td>
                    <td className="py-2 px-3" onClick={() => setSelectedMachine(m)}>
                      <div className="flex items-center gap-2">
                        <span className={clsx('w-2 h-2 rounded-full shrink-0', m.status === 'Connected' ? 'bg-green-400' : 'bg-red-400')} />
                        <div>
                          <span className="text-gray-200 font-medium">{m.name}</span>
                          {m.machineFqdn && m.machineFqdn !== m.name && (
                            <p className="text-[10px] text-gray-600 truncate max-w-[200px]">{m.machineFqdn}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-gray-400 truncate max-w-[150px]" onClick={() => setSelectedMachine(m)}>
                      {m.osSku || m.osName || m.osType}
                    </td>
                    <td className="py-2 px-2 text-center" onClick={() => setSelectedMachine(m)}>
                      <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium',
                        m.status === 'Connected' ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300')}>
                        {m.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-500 text-[10px]" onClick={() => setSelectedMachine(m)}>{m.location}</td>
                    <td className="py-2 px-2 text-right text-gray-400 tabular-nums" onClick={() => setSelectedMachine(m)}>{m.cores || '—'}</td>
                    <td className="py-2 px-2 text-right text-gray-400 tabular-nums" onClick={() => setSelectedMachine(m)}>
                      {m.totalMemoryGB ? `${m.totalMemoryGB.toFixed(0)}G` : '—'}
                    </td>
                    <td className="py-2 px-2 text-center" onClick={() => setSelectedMachine(m)}>
                      {cov.security ? <CheckCircle size={12} className="mx-auto text-green-400" /> : <AlertTriangle size={12} className="mx-auto text-red-400" />}
                    </td>
                    <td className="py-2 px-2 text-center" onClick={() => setSelectedMachine(m)}>
                      {cov.monitoring ? <CheckCircle size={12} className="mx-auto text-green-400" /> : <AlertTriangle size={12} className="mx-auto text-yellow-400" />}
                    </td>
                    <td className="py-2 px-2 text-center" onClick={() => setSelectedMachine(m)}>
                      {cov.patching ? <CheckCircle size={12} className="mx-auto text-green-400" /> : <AlertTriangle size={12} className="mx-auto text-orange-400" />}
                    </td>
                    <td className="py-2 px-2 text-center" onClick={() => setSelectedMachine(m)}>
                      {cov.change_tracking ? <CheckCircle size={12} className="mx-auto text-purple-400" /> : <span className="text-gray-700">—</span>}
                    </td>
                    <td className="py-2 px-2 text-center" onClick={() => setSelectedMachine(m)}>
                      {hasDep ? <CheckCircle size={12} className="mx-auto text-indigo-400" /> : <span className="text-gray-700">—</span>}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-500" onClick={() => setSelectedMachine(m)}>
                      {m.classified_extensions?.length || 0}
                    </td>
                    <td className="py-2 px-3" onClick={() => setSelectedMachine(m)}>
                      {tagCount > 0
                        ? <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{tagCount} tags</span>
                        : <span className="text-gray-700 text-[10px]">none</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800/40">
            <span className="text-xs text-gray-500">
              Page {page + 1} of {totalPages} ({filtered.length} machines)
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                className="px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-200 disabled:text-gray-700 disabled:cursor-not-allowed">
                ← Prev
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = page < 3 ? i : page > totalPages - 3 ? totalPages - 5 + i : page - 2 + i
                if (p < 0 || p >= totalPages) return null
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={clsx('w-7 h-7 rounded text-xs', p === page ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200')}>
                    {p + 1}
                  </button>
                )
              })}
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                className="px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-200 disabled:text-gray-700 disabled:cursor-not-allowed">
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      {selectedMachine && <MachineDetail machine={selectedMachine} onClose={() => setSelectedMachine(null)} />}
    </div>
  )
}
