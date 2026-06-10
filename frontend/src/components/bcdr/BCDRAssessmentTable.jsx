import React, { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'
import {
  RefreshCw, ChevronDown, ChevronUp, X, AlertTriangle,
  CheckCircle, Search, Filter, FileDown, ExternalLink,
  Shield, Clock, Zap, Target, Globe,
} from 'lucide-react'
import { api } from '../../api/client'

// ── Badges ─────────────────────────────────────────────────────────────────

function PriorityBadge({ p }) {
  const map = {
    P1: 'bg-red-900/40 text-red-300 border-red-800/50',
    P2: 'bg-orange-900/40 text-orange-300 border-orange-800/50',
    P3: 'bg-yellow-900/40 text-yellow-300 border-yellow-800/50',
    P4: 'bg-gray-800 text-gray-400 border-gray-700',
  }
  return <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border', map[p] || map.P4)}>{p}</span>
}

function ZoneBadge({ status }) {
  const map = {
    ZoneRedundant:    { cls: 'bg-green-900/30 text-green-400 border-green-800/40', dot: '#22c55e' },
    Zonal:            { cls: 'bg-yellow-900/30 text-yellow-400 border-yellow-800/40', dot: '#eab308' },
    LocallyRedundant: { cls: 'bg-red-900/30 text-red-400 border-red-800/40', dot: '#ef4444' },
    NotZoneAware:     { cls: 'bg-blue-900/30 text-blue-400 border-blue-800/40', dot: '#60a5fa' },
    Unknown:          { cls: 'bg-gray-800 text-gray-500 border-gray-700', dot: '#6b7280' },
  }
  const s = map[status] || map.Unknown
  return (
    <span className={clsx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border', s.cls)}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.dot }} />
      {status}
    </span>
  )
}

function CriticalityBadge({ c }) {
  const map = {
    Critical: 'text-red-400 bg-red-900/20 border-red-800/40',
    High:     'text-orange-400 bg-orange-900/20 border-orange-800/40',
    Medium:   'text-yellow-400 bg-yellow-900/20 border-yellow-800/40',
    Low:      'text-green-400 bg-green-900/20 border-green-800/40',
  }
  return <span className={clsx('px-2 py-0.5 rounded-full text-xs border', map[c] || 'text-gray-400 bg-gray-800 border-gray-700')}>{c}</span>
}

function QuickWinBadge({ qw }) {
  if (qw !== 'Yes') return <span className="text-gray-600 text-xs">—</span>
  return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs bg-teal-900/30 text-teal-400 border border-teal-800/40"><Zap size={9} />Quick Win</span>
}

// ── Detail Drawer ──────────────────────────────────────────────────────────

function BCDRDetailDrawer({ item, onClose }) {
  if (!item) return null

  const SA_COLS = [
    { key: 'sa_criticality',          label: 'Criticality' },
    { key: 'sa_bcdr_strategy',        label: 'BCDR Strategy' },
    { key: 'sa_dr_region_choice',     label: 'DR Region Choice' },
    { key: 'sa_dr_method',            label: 'DR Method' },
    { key: 'sa_rpo',                  label: 'RPO (Target)' },
    { key: 'sa_rto',                  label: 'RTO (Target)' },
    { key: 'sa_implementation_effort',label: 'Implementation Effort' },
    { key: 'sa_cost_impact',          label: 'Cost Impact' },
    { key: 'sa_priority',             label: 'Priority' },
    { key: 'sa_quick_win',            label: 'Quick Win' },
    { key: 'sa_zr_context',           label: 'Zone Redundancy Context', multiline: true },
    { key: 'sa_bcdr_guidance_summary',label: 'BCDR Guidance Summary', multiline: true },
    { key: 'sa_action_required',      label: 'Action Required', multiline: true },
    { key: 'sa_dependencies',         label: 'Dependencies', multiline: true },
    { key: 'sa_current_gap_summary',  label: 'Current Gap Summary', multiline: true },
    { key: 'sa_compliance_note',      label: 'Compliance Note', multiline: true },
    { key: 'sa_physical_zone_placement', label: 'Physical Zone Placement', multiline: true },
    { key: 'sa_zone_transition_path', label: 'Zone Transition Path', multiline: true },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6 bg-black/60 backdrop-blur-sm">
      <div className="relative bg-gray-900 border border-gray-700/60 rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-gray-800">
          <Shield size={18} className="text-blue-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white truncate">{item.resource_name}</h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {item.resource_type} · {item.location} · {item.resource_group}
            </p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <ZoneBadge status={item.zone_status} />
              <CriticalityBadge c={item.sa_criticality} />
              <PriorityBadge p={item.sa_priority} />
              {item.is_qatar_central && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-orange-900/30 text-orange-300 border border-orange-800/40">
                  △ Qatar Central — ZR Disabled
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-3">
          {SA_COLS.map(col => {
            const val = item[col.key]
            if (!val) return null
            return (
              <div key={col.key}>
                <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{col.label}</dt>
                {col.multiline ? (
                  <dd className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap rounded-lg bg-gray-800/50 p-3 border border-gray-700/50">
                    {val}
                  </dd>
                ) : (
                  <dd className="text-sm text-gray-200">{val}</dd>
                )}
              </div>
            )
          })}

          {item.sa_azure_portal_link && (
            <a
              href={item.sa_azure_portal_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <ExternalLink size={12} />
              Open in Azure Portal
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main BCDRAssessmentTable ────────────────────────────────────────────────

const ZONE_STATUS_OPTIONS = ['ZoneRedundant', 'Zonal', 'LocallyRedundant', 'NotZoneAware', 'Unknown']
const TIER_OPTIONS        = ['Production', 'Non-Production', 'Dev/Test', 'Sandbox', 'Unknown']
const PRIORITY_OPTIONS    = ['P1', 'P2', 'P3', 'P4']

export default function BCDRAssessmentTable() {
  const [data,         setData]         = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [selected,     setSelected]     = useState(null)
  const [search,       setSearch]       = useState('')
  const [zoneFilter,   setZoneFilter]   = useState('')
  const [tierFilter,   setTierFilter]   = useState('')
  const [priorityFilter,setPriorityFilter] = useState('')
  const [quickWinsOnly,setQuickWinsOnly]= useState(false)
  const [page,         setPage]         = useState(0)
  const PAGE_SIZE = 50

  async function load(filters = {}) {
    setLoading(true)
    setError(null)
    try {
      const params = {
        limit: 500,
        offset: 0,
        ...(filters.zone_status     && { zone_status:     filters.zone_status }),
        ...(filters.tier            && { tier:            filters.tier }),
        ...(filters.priority        && { priority:        filters.priority }),
        ...(filters.quick_wins_only && { quick_wins_only: true }),
      }
      const result = await api.getBCDRAssessments(params)
      setData(result)
      setPage(0)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const items = useMemo(() => {
    if (!data?.items) return []
    let rows = data.items
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        r.resource_name?.toLowerCase().includes(q) ||
        r.resource_type?.toLowerCase().includes(q) ||
        r.resource_group?.toLowerCase().includes(q) ||
        r.location?.toLowerCase().includes(q) ||
        r.sa_bcdr_strategy?.toLowerCase().includes(q)
      )
    }
    if (zoneFilter)    rows = rows.filter(r => r.zone_status    === zoneFilter)
    if (tierFilter)    rows = rows.filter(r => r.workload_tier  === tierFilter)
    if (priorityFilter)rows = rows.filter(r => r.sa_priority    === priorityFilter)
    if (quickWinsOnly) rows = rows.filter(r => r.sa_quick_win   === 'Yes')
    return rows
  }, [data, search, zoneFilter, tierFilter, priorityFilter, quickWinsOnly])

  const totalPages = Math.ceil(items.length / PAGE_SIZE)
  const pageItems  = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const summary    = data?.summary

  function exportCSV() {
    const cols = ['resource_name','resource_type','location','resource_group','subscription_id',
                  'zone_status','workload_tier','sa_criticality','sa_priority','sa_quick_win',
                  'sa_bcdr_strategy','sa_dr_method','sa_rpo','sa_rto','sa_implementation_effort',
                  'sa_cost_impact','sa_action_required','sa_dependencies','sa_compliance_note',
                  'sa_current_gap_summary','zone_risk_score','is_qatar_central']
    const rows = [cols.join(',')]
    for (const r of items) {
      rows.push(cols.map(c => {
        const v = r[c]
        if (v === null || v === undefined) return ''
        const s = String(v)
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"` : s
      }).join(','))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'bcdr-assessment.csv' })
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {selected && <BCDRDetailDrawer item={selected} onClose={() => setSelected(null)} />}

      {/* Summary row */}
      {summary && (
        <div className="flex items-center gap-3 flex-wrap">
          {Object.entries(summary.priority_breakdown || {}).sort().map(([p, n]) => (
            <button
              key={p}
              onClick={() => { setPriorityFilter(priorityFilter === p ? '' : p); setPage(0) }}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                priorityFilter === p
                  ? { P1: 'bg-red-900/60 border-red-600 text-red-200', P2: 'bg-orange-900/60 border-orange-600 text-orange-200', P3: 'bg-yellow-900/60 border-yellow-600 text-yellow-200', P4: 'bg-gray-700 border-gray-500 text-gray-200' }[p]
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200',
              )}
            >
              <PriorityBadge p={p} />
              <span className="font-bold">{n}</span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-600">{summary.quick_wins_count} quick wins</span>
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs text-gray-300 transition-colors"
            >
              <FileDown size={12} /> Export CSV
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search name, type, strategy…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600 w-52"
          />
        </div>
        <select
          value={zoneFilter}
          onChange={e => { setZoneFilter(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600"
        >
          <option value="">All Zone Statuses</option>
          {ZONE_STATUS_OPTIONS.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select
          value={tierFilter}
          onChange={e => { setTierFilter(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600"
        >
          <option value="">All Tiers</option>
          {TIER_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={() => { setQuickWinsOnly(v => !v); setPage(0) }}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors',
            quickWinsOnly
              ? 'bg-teal-900/40 border-teal-700 text-teal-300'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200',
          )}
        >
          <Zap size={11} /> Quick Wins
        </button>
        {(zoneFilter || tierFilter || priorityFilter || quickWinsOnly || search) && (
          <button
            onClick={() => { setZoneFilter(''); setTierFilter(''); setPriorityFilter(''); setQuickWinsOnly(false); setSearch(''); setPage(0) }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          >
            <X size={11} /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-600">{items.length} of {data?.total || 0} resources</span>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center h-48 gap-3 text-gray-500">
          <RefreshCw size={16} className="animate-spin" />
          <span>Loading BCDR assessments…</span>
        </div>
      )}
      {error && (
        <div className="card flex items-center gap-3 text-red-400">
          <AlertTriangle size={16} />
          <p className="text-sm">{error}</p>
          <button onClick={() => load()} className="ml-auto text-xs text-red-400 hover:text-red-300">Retry</button>
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border border-gray-800/80">
          <table className="w-full text-left" style={{ minWidth: '1100px' }}>
            <thead>
              <tr className="bg-gray-800/70 border-b border-gray-700/60">
                {[
                  'Resource', 'Type', 'Location', 'Zone Status', 'Tier',
                  'Priority', 'Criticality', 'BCDR Strategy', 'RPO', 'RTO',
                  'Effort', 'Cost Impact', 'Quick Win',
                ].map(col => (
                  <th key={col} className="px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {pageItems.map((item, i) => (
                <tr
                  key={`${item.resource_id}-${i}`}
                  onClick={() => setSelected(item)}
                  className={clsx(
                    'cursor-pointer hover:bg-gray-800/30 transition-colors group',
                    item.is_qatar_central && 'bg-orange-950/10',
                    item.sa_priority === 'P1' && 'bg-red-950/10',
                  )}
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      {item.is_qatar_central && <span title="Qatar Central — ZR Disabled" className="text-orange-400 text-xs">△</span>}
                      <span className="font-medium text-white text-sm truncate max-w-[150px] group-hover:text-blue-300" title={item.resource_name}>
                        {item.resource_name}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 truncate max-w-[150px]">{item.resource_group}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-gray-400">{item.resource_type?.split('/').slice(-1)[0]}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-gray-400 whitespace-nowrap">{item.location}</span>
                  </td>
                  <td className="px-3 py-3">
                    <ZoneBadge status={item.zone_status} />
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-gray-400">{item.workload_tier}</span>
                  </td>
                  <td className="px-3 py-3">
                    <PriorityBadge p={item.sa_priority} />
                  </td>
                  <td className="px-3 py-3">
                    <CriticalityBadge c={item.sa_criticality} />
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-gray-300 truncate max-w-[180px] block" title={item.sa_bcdr_strategy}>
                      {item.sa_bcdr_strategy?.split('(')[0].trim() || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-gray-400 whitespace-nowrap">{item.sa_rpo || '—'}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-gray-400 whitespace-nowrap">{item.sa_rto || '—'}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={clsx('text-xs', item.sa_implementation_effort === 'High' ? 'text-red-400' : item.sa_implementation_effort === 'Medium' ? 'text-yellow-400' : 'text-green-400')}>
                      {item.sa_implementation_effort || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={clsx('text-xs', item.sa_cost_impact?.includes('High') ? 'text-red-400' : item.sa_cost_impact?.includes('Medium') ? 'text-yellow-400' : 'text-green-400')}>
                      {item.sa_cost_impact || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <QuickWinBadge qw={item.sa_quick_win} />
                  </td>
                </tr>
              ))}
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-12 text-center text-gray-600 text-sm">
                    No resources match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <span className="text-xs text-gray-500">Page {page + 1} of {totalPages}</span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
