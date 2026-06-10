import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Monitor, Server, AlertTriangle, CheckCircle, Clock, Shield, Filter, Download, ChevronDown, ChevronRight, RotateCw } from 'lucide-react'
import { api } from '../../api/client'
import ResourceDetailDrawer from '../ResourceDetailDrawer'

// ── KPI Card Component ──────────────────────────────────────────────────────

function KPICard({ label, value, subtitle, color = 'blue', icon: Icon }) {
  const colors = {
    blue: 'border-blue-600/40 bg-blue-900/10',
    green: 'border-green-600/40 bg-green-900/10',
    red: 'border-red-600/40 bg-red-900/10',
    amber: 'border-amber-600/40 bg-amber-900/10',
    purple: 'border-purple-600/40 bg-purple-900/10',
    cyan: 'border-cyan-600/40 bg-cyan-900/10',
  }
  const textColors = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
    purple: 'text-purple-400',
    cyan: 'text-cyan-400',
  }
  return (
    <div className={`rounded-xl border ${colors[color]} p-4 flex flex-col gap-1`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-medium">{label}</span>
        {Icon && <Icon size={14} className={textColors[color]} />}
      </div>
      <div className={`text-2xl font-bold ${textColors[color]}`}>{value}</div>
      {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
    </div>
  )
}

// ── Donut Chart ─────────────────────────────────────────────────────────────

function ComplianceDonut({ compliance }) {
  const pct = Math.min(100, Math.max(0, compliance))
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444'

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#1e293b" strokeWidth="8" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
        <text x="50" y="50" textAnchor="middle" dy="4" fill={color} fontSize="16" fontWeight="bold">
          {pct}%
        </text>
      </svg>
      <span className="text-xs text-gray-400">Patch Compliance</span>
    </div>
  )
}

// ── Bar Chart ───────────────────────────────────────────────────────────────

function HorizontalBarChart({ data, title }) {
  const maxVal = Math.max(...data.map(d => d.total), 1)
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <h4 className="text-sm font-semibold text-gray-200 mb-3">{title}</h4>
      <div className="space-y-2">
        {data.map((item, i) => (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400 truncate max-w-[160px]">{item.category}</span>
              <span className="text-gray-300">{item.patched}/{item.total} ({item.compliance_pct}%)</span>
            </div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden flex">
              <div className="h-full bg-green-600 transition-all" style={{ width: `${(item.patched / maxVal) * 100}%` }} />
              <div className="h-full bg-red-600/60 transition-all" style={{ width: `${(item.unpatched / maxVal) * 100}%` }} />
            </div>
          </div>
        ))}
        {data.length === 0 && <p className="text-xs text-gray-500 text-center py-4">No data available</p>}
      </div>
    </div>
  )
}

// ── Classification Breakdown ────────────────────────────────────────────────

function ClassificationBreakdown({ data }) {
  const total = (data.Critical || 0) + (data.Security || 0) + (data.Other || 0)
  const items = [
    { label: 'Critical', count: data.Critical || 0, color: 'bg-red-500' },
    { label: 'Security', count: data.Security || 0, color: 'bg-amber-500' },
    { label: 'Other', count: data.Other || 0, color: 'bg-blue-500' },
  ]
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <h4 className="text-sm font-semibold text-gray-200 mb-3">Pending by Classification</h4>
      <div className="text-center mb-3">
        <span className="text-3xl font-bold text-gray-100">{total}</span>
        <span className="text-xs text-gray-500 ml-1">total pending</span>
      </div>
      <div className="h-4 bg-gray-800 rounded-full overflow-hidden flex mb-3">
        {items.map((item, i) => (
          <div key={i} className={`h-full ${item.color} transition-all`}
            style={{ width: total > 0 ? `${(item.count / total) * 100}%` : '0%' }}
            title={`${item.label}: ${item.count}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${item.color}`} />
            <span className="text-gray-400">{item.label}: {item.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Machine Table ───────────────────────────────────────────────────────────

function MachineTable({ machines, title, emptyMsg, onSelectResource }) {
  const [sortField, setSortField] = useState('days_since_patch')
  const [sortDir, setSortDir] = useState('desc')
  const [expanded, setExpanded] = useState(new Set())

  const sorted = [...machines].sort((a, b) => {
    const av = a[sortField], bv = b[sortField]
    if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
  })

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const SortHeader = ({ field, children }) => (
    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 cursor-pointer hover:text-gray-200 select-none"
      onClick={() => toggleSort(field)}>
      {children} {sortField === field && (sortDir === 'asc' ? '↑' : '↓')}
    </th>
  )

  const statusColor = (status) => {
    if (status === 'Succeeded' || status === 'Completed') return 'text-green-400'
    if (status === 'Failed') return 'text-red-400'
    if (status === 'InProgress') return 'text-blue-400'
    if (status === 'assessment_pending') return 'text-amber-400'
    return 'text-gray-400'
  }

  const statusLabel = (status) => {
    if (status === 'assessment_pending') return 'Assessment Pending'
    return status
  }

  const rebootBadge = (status) => {
    if (status === 'Required') return <span className="px-1.5 py-0.5 rounded text-xs bg-red-900/40 text-red-400 border border-red-800/40">Reboot Required</span>
    if (status === 'Started') return <span className="px-1.5 py-0.5 rounded text-xs bg-amber-900/40 text-amber-400 border border-amber-800/40">Rebooting</span>
    if (status === 'Completed') return <span className="px-1.5 py-0.5 rounded text-xs bg-green-900/40 text-green-400 border border-green-800/40">Completed</span>
    return null
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
      {title && <div className="px-4 py-3 border-b border-gray-800"><h4 className="text-sm font-semibold text-gray-200">{title}</h4></div>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-900/60">
            <tr>
              <th className="w-6" />
              <SortHeader field="vm_name">Machine</SortHeader>
              <SortHeader field="os_type">OS</SortHeader>
              <SortHeader field="machine_type">Type</SortHeader>
              <SortHeader field="total_pending">Pending</SortHeader>
              <SortHeader field="critical_pending">Critical</SortHeader>
              <SortHeader field="days_since_patch">Days Since Patch</SortHeader>
              <SortHeader field="patch_status">Status</SortHeader>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Reboot</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {sorted.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">{emptyMsg || 'No machines found'}</td></tr>
            )}
            {sorted.map((m, i) => (
              <React.Fragment key={m.vm_id || i}>
                <tr className="hover:bg-gray-800/40 transition-colors cursor-pointer"
                  onClick={() => setExpanded(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s })}>
                  <td className="px-2 py-2 text-gray-500">
                    {expanded.has(i) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </td>
                  <td className="px-3 py-2 text-gray-200 font-medium">
                    <span
                      className={m.vm_id ? 'text-blue-300 cursor-pointer hover:underline' : ''}
                      onClick={e => { if (m.vm_id && onSelectResource) { e.stopPropagation(); onSelectResource(m); } }}
                    >
                      {m.vm_name || m.vm_id?.split('/').pop()}{m.vm_id && <span className="text-blue-400 text-xs ml-1">↗</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-400">{m.os_type}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${m.machine_type === 'Arc' ? 'bg-purple-900/40 text-purple-400 border border-purple-800/40' : 'bg-blue-900/40 text-blue-400 border border-blue-800/40'}`}>
                      {m.machine_type}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={m.total_pending > 0 ? 'text-amber-400 font-semibold' : 'text-green-400'}>{m.total_pending}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={m.critical_pending > 0 ? 'text-red-400 font-semibold' : 'text-gray-400'}>{m.critical_pending}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={m.days_since_patch > 30 ? 'text-red-400' : m.days_since_patch > 14 ? 'text-amber-400' : 'text-green-400'}>
                      {m.days_since_patch < 9999 ? `${m.days_since_patch}d` : 'Never'}
                    </span>
                  </td>
                  <td className={`px-3 py-2 ${statusColor(m.patch_status)}`}>
                    {m.patch_status === 'assessment_pending'
                      ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-amber-900/30 text-amber-400 border border-amber-700/40">
                          <Clock size={10} /> Assessment Pending
                        </span>
                      : statusLabel(m.patch_status)}
                  </td>
                  <td className="px-3 py-2">{rebootBadge(m.reboot_status)}</td>
                </tr>
                {expanded.has(i) && (
                  <tr className="bg-gray-900/60">
                    <td colSpan={9} className="px-6 py-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div><span className="text-gray-500">Resource Group:</span> <span className="text-gray-300">{m.resource_group}</span></div>
                        <div><span className="text-gray-500">Subscription:</span> <span className="text-gray-300">{m.subscription_id?.substring(0, 8)}...</span></div>
                        <div><span className="text-gray-500">Location:</span> <span className="text-gray-300">{m.location}</span></div>
                        <div><span className="text-gray-500">Last Assessment:</span> <span className="text-gray-300">{m.last_assessment_time ? new Date(m.last_assessment_time).toLocaleDateString() : 'N/A'}</span></div>
                        <div><span className="text-gray-500">Last Patch:</span> <span className="text-gray-300">{m.last_patch_time ? new Date(m.last_patch_time).toLocaleDateString() : 'N/A'}</span></div>
                        <div><span className="text-gray-500">Installed:</span> <span className="text-green-400">{m.installed_count}</span></div>
                        <div><span className="text-gray-500">Failed:</span> <span className="text-red-400">{m.failed_count}</span></div>
                        <div><span className="text-gray-500">Security Pending:</span> <span className="text-amber-400">{m.security_pending}</span></div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
          Showing {sorted.length} machine{sorted.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}

// ── Compliance Trend Chart ──────────────────────────────────────────────────

function ComplianceTrendChart({ data }) {
  if (!data || data.length === 0) return null
  const maxPct = 100
  const width = 600
  const height = 150
  const padding = { top: 10, right: 10, bottom: 25, left: 35 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  const points = data.map((d, i) => ({
    x: padding.left + (i / Math.max(data.length - 1, 1)) * chartW,
    y: padding.top + chartH - (d.compliance_pct / maxPct) * chartH,
    ...d,
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <h4 className="text-sm font-semibold text-gray-200 mb-3">Compliance Trend (30 Days)</h4>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(pct => {
          const y = padding.top + chartH - (pct / maxPct) * chartH
          return (
            <g key={pct}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#1e293b" strokeWidth="0.5" />
              <text x={padding.left - 4} y={y + 3} textAnchor="end" fill="#475569" fontSize="8">{pct}%</text>
            </g>
          )
        })}
        {/* Line */}
        <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Area fill */}
        <path d={`${pathD} L ${points[points.length - 1]?.x} ${padding.top + chartH} L ${points[0]?.x} ${padding.top + chartH} Z`}
          fill="url(#trend-gradient)" opacity="0.3" />
        <defs>
          <linearGradient id="trend-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* X-axis labels */}
        {points.filter((_, i) => i % 7 === 0 || i === points.length - 1).map((p, i) => (
          <text key={i} x={p.x} y={height - 4} textAnchor="middle" fill="#475569" fontSize="7">
            {p.date?.substring(5)}
          </text>
        ))}
      </svg>
    </div>
  )
}

// ── Main Update Management View ─────────────────────────────────────────────

export default function UpdateManagementView() {
  const [summary, setSummary] = useState(null)
  const [byOS, setByOS] = useState([])
  const [bySub, setBySub] = useState([])
  const [byClass, setByClass] = useState({})
  const [trend, setTrend] = useState([])
  const [filters, setFilters] = useState(null)
  const [activeTab, setActiveTab] = useState('all')
  const [machines, setMachines] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedFilters, setSelectedFilters] = useState({})
  const [selectedResource, setSelectedResource] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [sum, os, sub, cls, tr, flt] = await Promise.all([
        api.getUpdateSummary(),
        api.getUpdatesByOS(),
        api.getUpdatesBySubscription(),
        api.getUpdatesByClassification(),
        api.getComplianceTrend(30),
        api.getUpdateFilters(),
      ])
      setSummary(sum)
      setByOS(os)
      setBySub(sub)
      setByClass(cls)
      setTrend(tr)
      setFilters(flt)
    } catch (e) {
      console.error('Update Management load failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMachines = useCallback(async (tab) => {
    try {
      let data
      switch (tab) {
        case 'patched': data = await api.getPatchedMachines(30); break
        case 'unpatched': data = await api.getUnpatchedMachines(30); break
        case 'pending-reboot': data = await api.getPendingReboot(); break
        case 'rebooted': data = await api.getRebootedMachines(30); break
        case 'no-assessment': {
          const all = await api.getDetailedUpdateReport({})
          data = all.filter(m => m.assessment_available === false || m.patch_status === 'assessment_pending')
          break
        }
        default: data = await api.getDetailedUpdateReport(selectedFilters); break
      }
      setMachines(data)
    } catch (e) {
      console.error('Failed to load machines:', e)
      setMachines([])
    }
  }, [selectedFilters])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadMachines(activeTab) }, [activeTab, loadMachines])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await api.refreshUpdates()
      await loadData()
      await loadMachines(activeTab)
    } finally {
      setRefreshing(false)
    }
  }

  const handleFilterChange = (key, value) => {
    const f = { ...selectedFilters, [key]: value || undefined }
    Object.keys(f).forEach(k => { if (!f[k]) delete f[k] })
    setSelectedFilters(f)
  }

  useEffect(() => {
    if (activeTab === 'all') loadMachines('all')
  }, [selectedFilters])

  const handleExport = () => {
    if (!machines.length) return
    const headers = ['Machine', 'OS', 'Type', 'Total Pending', 'Critical', 'Security', 'Days Since Patch', 'Status', 'Reboot', 'Resource Group', 'Subscription']
    const rows = machines.map(m => [m.vm_name, m.os_type, m.machine_type, m.total_pending, m.critical_pending, m.security_pending, m.days_since_patch, m.patch_status, m.reboot_status, m.resource_group, m.subscription_id])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `update-report-${new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={24} className="animate-spin text-blue-400" />
        <span className="ml-3 text-gray-400">Loading Update Management data...</span>
      </div>
    )
  }

  const tabs = [
    { key: 'all', label: 'All Machines' },
    { key: 'patched', label: `Patched (${summary?.patched_last_30d || 0})` },
    { key: 'unpatched', label: `Unpatched (${summary?.not_patched_30d || 0})` },
    { key: 'pending-reboot', label: `Pending Reboot (${summary?.pending_reboot || 0})` },
    { key: 'rebooted', label: `Rebooted (${summary?.rebooted_last_30d || 0})` },
    ...(summary?.machines_without_assessment > 0
      ? [{ key: 'no-assessment', label: `No Assessment (${summary.machines_without_assessment})` }]
      : []),
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Update Management</h2>
          <p className="text-sm text-gray-400 mt-1">Azure Update Manager · Patch compliance for Azure VMs & Arc machines</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} disabled={!machines.length}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 transition-colors">
            <Download size={12} /> Export CSV
          </button>
          <button onClick={handleRefresh} disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60 transition-colors">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Assessment Pending Banner */}
      {summary?.machines_without_assessment > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-700/40 bg-amber-900/10">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-amber-300">
              {summary.machines_without_assessment} VM{summary.machines_without_assessment !== 1 ? 's' : ''} have no patch assessment data
            </div>
            <div className="text-xs text-amber-400/80 mt-0.5">
              These machines are visible in your subscriptions but Azure Update Manager has not assessed them yet.
              Enable <strong>Periodic Assessment</strong> on each VM or use an Azure Policy assignment to automatically enable it.
            </div>
          </div>
          <a href="https://portal.azure.com/#blade/Microsoft_Azure_Security/UpdateManagementBlade"
            target="_blank" rel="noopener noreferrer"
            className="flex-shrink-0 px-3 py-1 rounded-lg text-xs font-medium bg-amber-700/40 hover:bg-amber-700/60 text-amber-200 whitespace-nowrap">
            Enable in Portal ↗
          </a>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard label="Total Machines" value={summary?.total_machines || 0} subtitle={`${summary?.azure_vms || 0} VMs · ${summary?.arc_machines || 0} Arc`} color="blue" icon={Monitor} />
        <KPICard label="Patched (30d)" value={summary?.patched_last_30d || 0} subtitle={`${summary?.compliance_pct || 0}% compliant`} color="green" icon={CheckCircle} />
        <KPICard label="Not Patched (30d)" value={summary?.not_patched_30d || 0} subtitle={`Avg ${summary?.avg_days_since_patch || 0} days`} color="red" icon={AlertTriangle} />
        <KPICard label="Pending Reboot" value={summary?.pending_reboot || 0} subtitle="After patch install" color="amber" icon={RotateCw} />
        <KPICard label="Critical Pending" value={summary?.critical_pending || 0} subtitle={`+ ${summary?.security_pending || 0} security`} color="red" icon={Shield} />
        <KPICard label="Compliance" value={`${summary?.compliance_pct || 0}%`} subtitle={`${summary?.windows_machines || 0} Win · ${summary?.linux_machines || 0} Linux`} color="cyan" icon={Server} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex items-center justify-center rounded-xl border border-gray-800 bg-gray-900/40 p-4">
          <ComplianceDonut compliance={summary?.compliance_pct || 0} />
        </div>
        <HorizontalBarChart data={byOS} title="Updates by OS" />
        <ClassificationBreakdown data={byClass} />
      </div>

      {/* Compliance Trend */}
      <ComplianceTrendChart data={trend} />

      {/* By Subscription */}
      {bySub.length > 0 && (
        <HorizontalBarChart data={bySub} title="Patch Compliance by Subscription" />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 text-xs text-gray-400"><Filter size={12} /> Filters:</div>
        {filters?.os_types?.length > 0 && (
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300"
            value={selectedFilters.os_type || ''} onChange={e => handleFilterChange('os_type', e.target.value)}>
            <option value="">All OS</option>
            {filters.os_types.map(os => <option key={os} value={os}>{os}</option>)}
          </select>
        )}
        {filters?.machine_types?.length > 0 && (
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300"
            value={selectedFilters.machine_type || ''} onChange={e => handleFilterChange('machine_type', e.target.value)}>
            <option value="">All Types</option>
            {filters.machine_types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {filters?.subscriptions?.length > 0 && (
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300"
            value={selectedFilters.subscription_id || ''} onChange={e => handleFilterChange('subscription_id', e.target.value)}>
            <option value="">All Subscriptions</option>
            {filters.subscriptions.map(s => <option key={s.id} value={s.id}>{s.name || s.id.substring(0, 8)}</option>)}
          </select>
        )}
        {filters?.resource_groups?.length > 0 && (
          <select className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300"
            value={selectedFilters.resource_group || ''} onChange={e => handleFilterChange('resource_group', e.target.value)}>
            <option value="">All Resource Groups</option>
            {filters.resource_groups.map(rg => <option key={rg} value={rg}>{rg}</option>)}
          </select>
        )}
        {Object.keys(selectedFilters).length > 0 && (
          <button onClick={() => setSelectedFilters({})} className="text-xs text-blue-400 hover:text-blue-300">Clear all</button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900/60 border border-gray-800 rounded-lg p-1 overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Machine Table */}
      <MachineTable
        machines={machines}
        title={tabs.find(t => t.key === activeTab)?.label || 'All Machines'}
        emptyMsg={summary?.total_machines === 0 ? 'No machines found. Ensure Azure Update Manager is configured for your VMs and Arc machines.' : 'No machines match current filters.'}
        onSelectResource={m => setSelectedResource(m)}
      />

      {selectedResource && (
        <ResourceDetailDrawer
          resourceId={selectedResource.vm_id}
          resourceName={selectedResource.vm_name}
          onClose={() => setSelectedResource(null)}
        />
      )}
    </div>
  )
}
