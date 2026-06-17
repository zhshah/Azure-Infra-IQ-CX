import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import clsx from 'clsx'
import {
  ChevronUp, ChevronDown, ChevronsUpDown, Search, Brain, Lightbulb,
  ExternalLink, Terminal, Check, Clock, X as XIcon, AlertTriangle,
  MapPin, Server, Database, Cloud, Cpu, Shield, Zap, HardDrive, Filter,
  Network, SlidersHorizontal, RotateCcw, Navigation, Copy, Lock, Eye, ShieldOff,
  FolderPlus, FolderInput, Square, CheckSquare, Tag, Pencil,
} from 'lucide-react'
import { asText } from '../utils/safeText'
import SparkLine from './SparkLine'
import ResourceConnectionModal from './ResourceConnectionModal'
import TagEditorModal from './TagEditorModal'
import BulkTagEditorModal from './BulkTagEditorModal'
import ServiceIcon from './ServiceIcon'
import { SCORE_HEX, SCORE_STYLE as SCORE_STYLE_MAP } from '../scoreColors'

// ── Action tracker (localStorage) ─────────────────────────────────────────────

const STORAGE_KEY = 'azure-optimizer-actions'
function loadActions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function saveActions(map) { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)) }

// ── Resource category styling ──────────────────────────────────────────────────

const CATEGORY_STYLE = {
  compute:        { bg: 'bg-blue-900/40',   text: 'text-blue-300',   border: 'border-blue-800/50',   icon: Cpu,       dot: '#60a5fa' },
  storage:        { bg: 'bg-amber-900/40',  text: 'text-amber-300',  border: 'border-amber-800/50',  icon: HardDrive, dot: '#fbbf24' },
  data:           { bg: 'bg-purple-900/40', text: 'text-purple-300', border: 'border-purple-800/50', icon: Database,  dot: '#c084fc' },
  ai:             { bg: 'bg-indigo-900/40', text: 'text-indigo-300', border: 'border-indigo-800/50', icon: Brain,     dot: '#818cf8' },
  infrastructure: { bg: 'bg-slate-800/60',  text: 'text-slate-400',  border: 'border-slate-700/50',  icon: Shield,    dot: '#94a3b8' },
  other:          { bg: 'bg-gray-800/60',   text: 'text-gray-400',   border: 'border-gray-700/50',   icon: Server,    dot: '#9ca3af' },
}

const SCORE_COLORS = Object.fromEntries(
  Object.entries(SCORE_STYLE_MAP).map(([label, s]) => [
    label, { ...s, dot: SCORE_HEX[label] ?? '#6b7280' },
  ])
)

const DISPLAY_LABEL = {
  'Not Used':    'Confirmed Waste',
  'Rarely Used': 'Likely Waste',
}

const TREND_BADGE = {
  rising:  { icon: '↑', label: 'Rising',  cls: 'text-red-400'    },
  stable:  { icon: '→', label: 'Stable',  cls: 'text-gray-500'   },
  falling: { icon: '↓', label: 'Falling', cls: 'text-blue-400'   },
  idle:    { icon: '○', label: 'Idle',    cls: 'text-orange-400' },
}

const AI_CONFIDENCE_COLOR = { high: 'text-indigo-400', medium: 'text-blue-400', low: 'text-gray-500' }
const AI_ACTION_ICON = { delete: '🗑', downsize: '📉', reserve: '📌', monitor: '👁', none: '✓' }

const ACTION_STATUS = {
  done:    { label: 'Done',      cls: 'bg-green-900/40 text-green-400 border-green-800/50',    icon: Check },
  snoozed: { label: 'Snoozed',   cls: 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50', icon: Clock },
  wontfix: { label: "Won't Fix", cls: 'bg-gray-800 text-gray-500 border-gray-700',              icon: XIcon },
}

// ── Utility formatters ─────────────────────────────────────────────────────────

function fmt(n) {
  if (n === null || n === undefined) return '—'
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtPct(n) {
  if (n === null || n === undefined) return null
  return `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`
}
function fmtUtil(n) {
  if (n === null || n === undefined) return null
  return `${Number(n).toFixed(1)}%`
}

// Prettify Azure location strings: "eastus" → "East US", "westeurope" → "West Europe"
const LOCATION_NAMES = {
  eastus: 'East US', eastus2: 'East US 2', westus: 'West US', westus2: 'West US 2',
  westus3: 'West US 3', centralus: 'Central US', northcentralus: 'N. Central US',
  southcentralus: 'S. Central US', westcentralus: 'W. Central US',
  northeurope: 'North EU', westeurope: 'West EU',
  uksouth: 'UK South', ukwest: 'UK West',
  francecentral: 'France C.', francesouth: 'France S.',
  germanywestcentral: 'Germany WC', germanynorth: 'Germany N.',
  swedencentral: 'Sweden C.',
  norwayeast: 'Norway E.',
  switzerlandnorth: 'Switzerland N.',
  eastasia: 'East Asia', southeastasia: 'SE Asia',
  australiaeast: 'Australia E.', australiasoutheast: 'Australia SE',
  japaneast: 'Japan E.', japanwest: 'Japan W.',
  koreacentral: 'Korea C.', koreasouth: 'Korea S.',
  brazilsouth: 'Brazil S.',
  southafricanorth: 'S. Africa N.',
  uaenorth: 'UAE N.',
  canadacentral: 'Canada C.', canadaeast: 'Canada E.',
  global: 'Global',
}
function prettyLocation(loc) {
  if (!loc) return '—'
  return LOCATION_NAMES[loc.toLowerCase()] || loc
}

// Short resource type label (last segment)
function shortType(resourceType) {
  if (!resourceType) return ''
  if (resourceType.toLowerCase().includes('recoveryservices')) return 'Backup Vaults'
  return resourceType.split('/').pop() || resourceType
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SortIcon({ col, sortCol, sortDir }) {
  if (col !== sortCol) return <ChevronsUpDown size={11} className="text-gray-700 shrink-0" />
  return sortDir === 'asc'
    ? <ChevronUp size={11} className="text-blue-400 shrink-0" />
    : <ChevronDown size={11} className="text-blue-400 shrink-0" />
}

function ResourceTypeBadge({ resourceType, category, azureIcon }) {
  const style = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.other
  const Icon  = style.icon
  
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs font-medium',
      style.bg, style.text, style.border,
    )} title={resourceType}>
      {azureIcon ? (
        <ServiceIcon icon={azureIcon} alt={resourceType} size="xs" />
      ) : (
        <Icon size={10} className="shrink-0" />
      )}
      {shortType(resourceType)}
    </span>
  )
}

function ScoreBar({ score, label }) {
  const sc = SCORE_COLORS[label] ?? SCORE_COLORS['Not Used']
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          style={{ width: `${score}%`, backgroundColor: sc.dot }}
          className="h-full rounded-full transition-all"
        />
      </div>
      <span className="tabular-nums text-xs text-gray-400 w-6 text-right shrink-0">{score.toFixed(0)}</span>
    </div>
  )
}

// ── Plain-English scoring signals ──────────────────────────────────────────────

function buildSignals(r) {
  const signals = []

  // Data confidence / metrics availability
  if (r.score_label === 'Unknown') {
    signals.push({ text: 'No usage data — diagnostics not enabled', cls: 'text-gray-500' })
  } else if (r.data_confidence === 'none') {
    signals.push({ text: 'No monitoring data — score estimated from cost signals only', cls: 'text-gray-500' })
  } else if (r.data_confidence === 'low') {
    signals.push({ text: 'Limited monitoring data — score may not reflect actual usage', cls: 'text-yellow-600' })
  }

  // Protection signals (positive)
  if (r.has_lock) {
    signals.push({ text: 'Resource has a management lock — intentionally protected', cls: 'text-sky-400' })
  }
  if (r.is_infrastructure) {
    signals.push({ text: 'Infrastructure resource — not scored for usage', cls: 'text-slate-400' })
  }

  // VM power state
  if (r.power_state === 'deallocated') {
    signals.push({ text: 'VM is stopped (deallocated) — disk and IP costs still apply', cls: 'text-yellow-500' })
  } else if (r.power_state === 'running') {
    signals.push({ text: 'VM is running', cls: 'text-green-500' })
  }

  // Utilisation
  const util = r.primary_utilization_pct
  if (util != null) {
    if (util < 3) {
      signals.push({ text: `${util.toFixed(1)}% utilisation — below idle threshold`, cls: 'text-red-400' })
    } else if (util < 20) {
      signals.push({ text: `${util.toFixed(1)}% utilisation — low but active`, cls: 'text-orange-400' })
    } else if (util < 60) {
      signals.push({ text: `${util.toFixed(1)}% utilisation — moderate usage`, cls: 'text-yellow-400' })
    } else {
      signals.push({ text: `${util.toFixed(1)}% utilisation — well utilised`, cls: 'text-green-400' })
    }
  }

  // Activity
  if (r.has_any_activity) {
    signals.push({ text: 'Active network / disk / request traffic detected', cls: 'text-green-500' })
  }
  if (r.idle_confirmed) {
    signals.push({ text: 'Confirmed idle — no reads or writes in 90+ days', cls: 'text-red-400' })
  }
  if (r.days_since_active != null && r.days_since_active > 30) {
    signals.push({ text: `No management activity for ${r.days_since_active} days`, cls: 'text-orange-500' })
  }

  // Trend
  const trendMap = {
    rising:  { text: 'Cost trend is rising month-over-month',   cls: 'text-red-400'   },
    falling: { text: 'Cost trend is falling month-over-month',  cls: 'text-green-400' },
    idle:    { text: 'Cost trend shows idle or zero spend',     cls: 'text-red-400'   },
  }
  if (r.trend && trendMap[r.trend]) {
    signals.push(trendMap[r.trend])
  }

  // Orphan
  if (r.is_orphan && r.orphan_reason) {
    signals.push({ text: `Orphaned — ${r.orphan_reason}`, cls: 'text-orange-400' })
  }

  // Auto-shutdown schedule
  if (r.auto_shutdown) {
    signals.push({ text: 'Auto-shutdown schedule configured — intentionally managed VM', cls: 'text-green-500' })
  }

  // S18: Peak utilization — burst detection
  if (r.peak_utilization_pct != null) {
    if (r.peak_utilization_pct > 60) {
      signals.push({ text: `Peak utilization ${r.peak_utilization_pct.toFixed(0)}% in last 30 days — bursty workload, not idle`, cls: 'text-green-400' })
    } else if (r.peak_utilization_pct > 30 && (r.primary_utilization_pct ?? 0) < 10) {
      signals.push({ text: `Average util low but peaked at ${r.peak_utilization_pct.toFixed(0)}% — possible scheduled job`, cls: 'text-yellow-400' })
    }
  }

  // S19: Workload pattern
  const patternMap = {
    bursty:     { text: 'Bursty workload pattern — event-driven or scheduled job', cls: 'text-yellow-400' },
    declining:  { text: 'Declining usage pattern — candidate for right-sizing or decommission', cls: 'text-orange-400' },
    inactive:   { text: 'Inactive — no detectable usage signals', cls: 'text-red-400' },
    steady_low: { text: 'Consistently low usage — review if workload is still needed', cls: 'text-orange-400' },
  }
  if (r.workload_pattern && patternMap[r.workload_pattern]) {
    signals.push(patternMap[r.workload_pattern])
  }

  // S17: Intent/protection signals — note they protect but don't indicate active usage
  // Direct RBAC assignments
  if ((r.rbac_assignment_count ?? 0) > 0) {
    const n = r.rbac_assignment_count
    signals.push({ text: `${n} direct role assignment${n !== 1 ? 's' : ''} — protected from deletion (intent signal, not usage)`, cls: 'text-sky-400' })
  }

  // Reservation coverage
  if (r.ri_covered) {
    signals.push({ text: 'Covered by an active Azure Reservation — committed spend, will not be flagged for deletion', cls: 'text-sky-400' })
  }

  // Private endpoint
  if (r.has_private_endpoint) {
    signals.push({ text: 'Private endpoint attached — protected from deletion (another resource targets this)', cls: 'text-sky-400' })
  }

  // SQL replica
  if (r.is_sql_replica) {
    signals.push({ text: 'SQL secondary replica — exists to serve the primary database', cls: 'text-sky-400' })
  }

  // Azure Backup coverage (VMs only)
  const isVm = (r.resource_type || '').toLowerCase() === 'microsoft.compute/virtualmachines'
  if (isVm) {
    if (r.has_backup) {
      signals.push({ text: 'Protected by Azure Backup policy', cls: 'text-green-500' })
    } else {
      signals.push({ text: 'No Azure Backup policy detected — data loss risk if VM is deleted or corrupted', cls: 'text-amber-400' })
    }
  }

  // Deployment
  if (r.recently_deployed) {
    signals.push({ text: 'Deployed or updated in the last 30 days', cls: 'text-green-500' })
  }

  // App Service Plan link
  if (r.server_farm_id) {
    signals.push({ text: 'Hosted on a shared App Service Plan', cls: 'text-gray-400' })
  }

  // Advisor
  if ((r.advisor_score_delta ?? 0) < 0) {
    const count = r.advisor_recommendations?.length ?? 0
    signals.push({ text: `Azure Advisor flagged ${count} cost recommendation${count !== 1 ? 's' : ''}`, cls: 'text-yellow-400' })
  }

  // AI
  if ((r.ai_score_adjustment ?? 0) < -5) {
    signals.push({ text: 'AI analysis confirmed waste signal', cls: 'text-indigo-400' })
  } else if ((r.ai_score_adjustment ?? 0) > 5) {
    signals.push({ text: 'AI analysis found mitigating activity — score raised', cls: 'text-green-400' })
  }

  // Protection tags
  if (r.tags) {
    const protectionKeys = ['environment', 'env', 'criticality', 'critical']
    const protectionVals = ['prod', 'production', 'prd', 'live', 'high', 'critical', 'business-critical', 'true', 'yes']
    for (const [k, v] of Object.entries(r.tags)) {
      if (protectionKeys.includes(k.toLowerCase()) && protectionVals.includes(String(v).toLowerCase())) {
        signals.push({ text: `Tagged as ${k}=${v} — protected from "Confirmed Waste" label`, cls: 'text-sky-400' })
        break
      }
    }
  }

  return signals
}

function ScoreBreakdown({ resource }) {
  const components = [
    { label: 'Base',    value: resource.base_score ?? 0,          signed: false, color: 'bg-blue-500'   },
    { label: 'Trend',   value: resource.trend_modifier ?? 0,       signed: true,  color: 'bg-purple-500' },
    { label: 'Advisor', value: resource.advisor_score_delta ?? 0,  signed: true,  color: 'bg-yellow-500' },
    { label: 'AI',      value: resource.ai_score_adjustment ?? 0,  signed: true,  color: 'bg-indigo-500' },
  ]
  const final   = resource.final_score ?? 0
  const sc      = SCORE_COLORS[resource.score_label]
  const signals = buildSignals(resource)

  return (
    <div>
      {/* Score gauge */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500">Score</span>
            <span className={clsx('font-bold tabular-nums', sc?.text ?? 'text-gray-300')}>
              {final.toFixed(0)} / 100
            </span>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-all', sc?.bg ?? 'bg-gray-600')}
              style={{ width: `${Math.min(100, Math.max(0, final))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Component breakdown mini-bars */}
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {components.map(c => {
          const neg = c.signed && c.value < 0
          const pos = c.signed && c.value > 0
          const textCls = neg ? 'text-red-400' : pos ? 'text-green-400' : 'text-gray-400'
          const barColor = neg ? 'bg-red-500' : pos ? 'bg-green-500' : c.color
          const barPct   = Math.min(100, Math.abs(c.value))
          return (
            <div key={c.label} className="bg-gray-800/60 rounded-lg px-2 py-1.5">
              <p className="text-gray-600 text-xs mb-1">{c.label}</p>
              <p className={clsx('text-xs font-mono font-bold tabular-nums', textCls)}>
                {c.signed && c.value > 0 ? '+' : ''}{c.value}
              </p>
              <div className="h-0.5 bg-gray-700 rounded-full mt-1 overflow-hidden">
                <div className={clsx('h-full rounded-full', barColor)} style={{ width: `${barPct}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Plain-English signals */}
      {signals.length > 0 && (
        <ul className="space-y-0.5">
          {signals.map((sig, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs">
              <span className="text-gray-700 shrink-0 mt-px select-none">·</span>
              <span className={clsx('leading-relaxed', sig.cls)}>{sig.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ActionTracker({ resourceId, actions, onAction }) {
  const current = actions[resourceId]
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {Object.entries(ACTION_STATUS).map(([key, cfg]) => {
        const active = current === key
        const Icon   = cfg.icon
        return (
          <button
            key={key}
            onClick={() => onAction(resourceId, active ? null : key)}
            className={clsx(
              'flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border transition-all',
              active ? cfg.cls : 'bg-gray-800/60 text-gray-600 border-gray-700 hover:text-gray-400',
            )}
          >
            <Icon size={10} />{cfg.label}
          </button>
        )
      })}
    </div>
  )
}

function CLIModal({ resource, onClose }) {
  const [copied, setCopied] = useState(null)
  function copy(text, key) {
    navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2000) })
  }
  const cmds = [
    resource.cli_delete_cmd && { label: 'Delete / Deallocate', cmd: resource.cli_delete_cmd, key: 'delete' },
    resource.cli_resize_cmd && { label: 'Resize',              cmd: resource.cli_resize_cmd, key: 'resize' },
  ].filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl p-5 max-w-lg w-full shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-white">CLI Commands</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><XIcon size={16} /></button>
        </div>
        <p className="text-xs text-gray-500 mb-3 font-mono truncate">{resource.resource_name}</p>
        {cmds.length === 0 && <p className="text-gray-600 text-sm">No CLI commands available for this resource type.</p>}
        {cmds.map(({ label, cmd, key }) => (
          <div key={key} className="mb-3">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <div className="flex items-start gap-2">
              <pre className="flex-1 bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {cmd}
              </pre>
              <button
                onClick={() => copy(cmd, key)}
                className={clsx(
                  'shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  copied === key ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700',
                )}
              >
                {copied === key ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Column definitions ─────────────────────────────────────────────────────────

const ALL_COLS = [
  // alwaysVisible = cannot be hidden; defaultVisible = shown unless user changes it
  { key: 'resource_name',             label: 'Resource',          sortable: true,  alwaysVisible: true,  defaultVisible: true  },
  { key: 'resource_type',             label: 'Type',              sortable: true,  alwaysVisible: false, defaultVisible: true  },
  { key: 'location',                  label: 'Region',            sortable: true,  alwaysVisible: false, defaultVisible: true  },
  { key: 'resource_group',            label: 'Resource Group',    sortable: true,  alwaysVisible: false, defaultVisible: true  },
  { key: 'score_label',               label: 'Status',            sortable: true,  alwaysVisible: false, defaultVisible: true  },
  { key: 'final_score',               label: 'Score',             sortable: true,  alwaysVisible: false, defaultVisible: true  },
  { key: 'cost_current_month',        label: 'Cost / Mo',         sortable: true,  alwaysVisible: false, defaultVisible: true  },
  { key: 'primary_utilization_pct',   label: 'Utilisation (30d)', sortable: true,  alwaysVisible: false, defaultVisible: true  },
  { key: 'daily_costs',               label: 'Cost Trend (MoM)',  sortable: false, alwaysVisible: false, defaultVisible: true  },
  { key: 'estimated_monthly_savings', label: 'Est. Savings',      sortable: true,  alwaysVisible: false, defaultVisible: true  },
  { key: 'connections',               label: 'Map',               sortable: false, alwaysVisible: false, defaultVisible: true  },
  { key: 'ai_action',                 label: 'Advisor',           sortable: false, alwaysVisible: false, defaultVisible: true  },
  // Optional extras (hidden by default)
  { key: 'sku',                       label: 'SKU / Tier',        sortable: true,  alwaysVisible: false, defaultVisible: false },
  { key: 'subscription_id',           label: 'Subscription',      sortable: true,  alwaysVisible: false, defaultVisible: false },
  { key: 'carbon_kg_per_month',       label: 'Carbon (kg CO₂/mo)', sortable: true, alwaysVisible: false, defaultVisible: false },
  { key: 'days_since_active',         label: 'Days Since Active', sortable: true,  alwaysVisible: false, defaultVisible: false },
  { key: 'data_confidence',           label: 'Data Confidence',   sortable: true,  alwaysVisible: false, defaultVisible: false },
  { key: 'orphan_reason',             label: 'Orphan Reason',     sortable: false, alwaysVisible: false, defaultVisible: false },
  { key: 'missing_tags',              label: 'Missing Tags',      sortable: false, alwaysVisible: false, defaultVisible: false },
]

const COLS_STORAGE_KEY  = 'azure-optimizer-columns'
const DEFAULT_VISIBLE   = new Set(ALL_COLS.filter(c => c.defaultVisible).map(c => c.key))

// ── Main component ─────────────────────────────────────────────────────────────

export default function ResourceTable({ resources, externalFilter = null, onClearExternalFilter, aiEnabled = false, onSaveSelectedAsProject, projects = [], onAddSelected, addSelectedLabel = 'Add to project' }) {
  const [sortCol,     setSortCol]     = useState('cost_current_month')
  const [sortDir,     setSortDir]     = useState('desc')
  const [search,      setSearch]      = useState('')
  const [page,        setPage]        = useState(0)
  const [scoreFilter, setScoreFilter] = useState('')
  const [catFilter,   setCatFilter]   = useState('')
  const [typeFilter,  setTypeFilter]  = useState('') // resource type filter
  const [locationFilter, setLocationFilter] = useState('') // location filter
  const [rgFilter,    setRgFilter]    = useState('') // resource group filter
  const [expanded,    setExpanded]    = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [addToMenuOpen, setAddToMenuOpen] = useState(false)
  const addToMenuRef = useRef(null)
  const [cliResource,        setCliResource]        = useState(null)
  const [connectionResource, setConnectionResource] = useState(null)
  const [actions,     setActions]     = useState(loadActions)
  const [showAnomaly,   setShowAnomaly]   = useState(false)
  const [showNoBackup,  setShowNoBackup]  = useState(false)
  const [hideSnoozed, setHideSnoozed] = useState(true)
  // Per-resource on-demand AI analysis results (keyed by resource_id)
  const [aiOverrides, setAiOverrides] = useState({})
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLS_STORAGE_KEY))
      if (Array.isArray(saved)) return new Set(saved)
    } catch {}
    return new Set(DEFAULT_VISIBLE)
  })
  const [colPickerOpen, setColPickerOpen] = useState(false)
  const colPickerRef = useRef(null)

  // ── Tag support ───────────────────────────────────────────────────────────
  const [tagSchema,       setTagSchema]       = useState([])   // custom tag schema
  const [customTagsMap,   setCustomTagsMap]   = useState({})   // {resource_id: {key: val}}
  const [visibleTagCols,  setVisibleTagCols]  = useState(new Set())  // which tag keys shown as columns
  const [tagFilter,       setTagFilter]       = useState({})   // {key: value} filter
  const [tagEditResource, setTagEditResource] = useState(null) // resource being tagged
  const [bulkTagEditorOpen, setBulkTagEditorOpen] = useState(false) // bulk tag editor modal
  
  // ── Azure icon cache ──────────────────────────────────────────────────────
  const [iconCache, setIconCache] = useState({}) // {resourceType: icon_path}

  // Compute which Azure tag keys appear across ALL resources (for column picker)
  const azureTagKeys = useMemo(() => {
    const keys = new Set()
    for (const r of resources) {
      for (const k of Object.keys(r.tags || {})) keys.add(k)
    }
    return [...keys].sort()
  }, [resources])

  // Auto-show top 5 most common Azure tags as columns
  useEffect(() => {
    if (azureTagKeys.length === 0 || visibleTagCols.size > 0) return
    
    // Count frequency of each tag key
    const frequency = {}
    for (const r of resources) {
      for (const k of Object.keys(r.tags || {})) {
        frequency[k] = (frequency[k] || 0) + 1
      }
    }
    
    // Sort by frequency and show top 5
    const topKeys = Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => `az:${k}`)
    
    setVisibleTagCols(new Set(topKeys))
  }, [azureTagKeys, resources])

  // Load tag schema + custom tags on mount
  useEffect(() => {
    fetch('/api/tags/schema').then(r => r.json()).then(s => setTagSchema(s)).catch(() => {})
    fetch('/api/tags/all').then(r => r.json()).then(t => setCustomTagsMap(t || {})).catch(() => {})
  }, [])
  
  // Load Azure icons for all unique resource types
  useEffect(() => {
    if (!resources || resources.length === 0) return
    
    // Get unique resource types
    const uniqueTypes = [...new Set(resources.map(r => r.resource_type).filter(Boolean))]
    
    // Fetch icons for types not in cache
    uniqueTypes.forEach(resourceType => {
      if (iconCache[resourceType] !== undefined) return // Already fetched or fetching
      
      setIconCache(prev => ({ ...prev, [resourceType]: null })) // Mark as loading
      
      fetch(`/api/icons/${encodeURIComponent(resourceType)}`)
        .then(r => r.json())
        .then(data => {
          if (data.icon_path) {
            setIconCache(prev => ({ ...prev, [resourceType]: data.icon_path }))
          } else {
            setIconCache(prev => ({ ...prev, [resourceType]: false })) // No icon available
          }
        })
        .catch(() => {
          setIconCache(prev => ({ ...prev, [resourceType]: false })) // Error, use fallback
        })
    })
  }, [resources]) // Only depend on resources, not iconCache

  function refreshCustomTags() {
    fetch('/api/tags/all').then(r => r.json()).then(t => setCustomTagsMap(t || {})).catch(() => {})
  }

  function toggleTagCol(key) {
    setVisibleTagCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function setTagFilterValue(key, value) {
    setTagFilter(prev => {
      if (!value) {
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: value }
    })
  }

  // Helper: get merged tags for a resource (Azure + custom)
  function getMergedTags(r) {
    const azureTags  = r.tags || {}
    const customTags = customTagsMap[r.resource_id?.toLowerCase()] || {}
    return { ...azureTags, ...customTags }
  }

  const PAGE_SIZE = 25

  // On-demand per-resource AI analysis
  async function handleAnalyzeAI(resourceId, e) {
    e.stopPropagation()
    setAiOverrides(prev => ({ ...prev, [resourceId]: { loading: true } }))
    try {
      const res = await fetch(`/api/resource/${encodeURIComponent(resourceId)}/ai-analyze`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setAiOverrides(prev => ({ ...prev, [resourceId]: { error: body.detail || 'AI analysis failed' } }))
        return
      }
      setAiOverrides(prev => ({ ...prev, [resourceId]: {
        ai_confidence:  body.ai_confidence,
        ai_action:      body.ai_action,
        ai_explanation: body.ai_explanation,
      }}))
    } catch (err) {
      setAiOverrides(prev => ({ ...prev, [resourceId]: { error: String(err) } }))
    }
  }

  // Close column picker on outside click
  useEffect(() => {
    function onDown(e) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target)) setColPickerOpen(false)
      if (addToMenuRef.current && !addToMenuRef.current.contains(e.target)) setAddToMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function toggleCol(key) {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }

  function resetCols() {
    setVisibleCols(new Set(DEFAULT_VISIBLE))
    localStorage.removeItem(COLS_STORAGE_KEY)
  }

  // ── Selection helpers ──────────────────────────────────────────────────────
  function toggleSelect(resourceId, e) {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(resourceId)) next.delete(resourceId)
      else next.add(resourceId)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === pageRows.length && pageRows.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(pageRows.map(r => r.resource_id)))
    }
  }

  function clearSelection() { setSelectedIds(new Set()) }

  const visibleColDefs = ALL_COLS.filter(c => c.alwaysVisible || visibleCols.has(c.key))

  // Reset page when external filter changes
  React.useEffect(() => { setPage(0) }, [externalFilter])

  function toggleSort(col) {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
    setPage(0)
  }

  const handleAction = useCallback((rid, status) => {
    setActions(prev => {
      const next = { ...prev }
      if (status === null) delete next[rid]
      else next[rid] = status
      saveActions(next)
      return next
    })
  }, [])

  const filtered = useMemo(() => {
    let rows = resources || []
    const q = search.toLowerCase()
    if (q) rows = rows.filter(r =>
      r.resource_name.toLowerCase().includes(q) ||
      r.resource_group.toLowerCase().includes(q) ||
      r.resource_type.toLowerCase().includes(q) ||
      (r.location || '').toLowerCase().includes(q) ||
      // Also search in tags
      Object.values(r.tags || {}).some(v => String(v).toLowerCase().includes(q)) ||
      Object.values(customTagsMap[r.resource_id?.toLowerCase()] || {}).some(v => String(v).toLowerCase().includes(q))
    )
    if (scoreFilter) rows = rows.filter(r => r.score_label === scoreFilter)
    if (catFilter)   rows = rows.filter(r => (r.resource_category || 'other') === catFilter)
    if (typeFilter)  rows = rows.filter(r => r.resource_type === typeFilter)
    if (locationFilter) rows = rows.filter(r => r.location === locationFilter)
    if (rgFilter)    rows = rows.filter(r => r.resource_group === rgFilter)
    if (showAnomaly)  rows = rows.filter(r => r.is_anomaly)
    if (showNoBackup) rows = rows.filter(r =>
      (r.resource_type || '').toLowerCase() === 'microsoft.compute/virtualmachines' && !r.has_backup
    )
    // Tag filters
    if (Object.keys(tagFilter).length > 0) {
      rows = rows.filter(r => {
        const merged = getMergedTags(r)
        return Object.entries(tagFilter).every(([k, v]) =>
          !v || String(merged[k] || '').toLowerCase().includes(v.toLowerCase())
        )
      })
    }
    // External filter from chart/KPI interactions
    if (externalFilter) {
      const { field, value } = externalFilter
      rows = rows.filter(r => {
        const rv = r[field]
        if (rv === undefined || rv === null) return false
        if (field === 'resource_type') return String(rv).toLowerCase().startsWith(String(value).toLowerCase())
        return String(rv) === String(value)
      })
    }
    rows = [...rows].sort((a, b) => {
      const av = a[sortCol] ?? ''
      const bv = b[sortCol] ?? ''
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : (av - bv)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [resources, search, scoreFilter, catFilter, typeFilter, locationFilter, rgFilter, showAnomaly, showNoBackup, sortCol, sortDir, tagFilter, customTagsMap, externalFilter])

  const snoozedCount = useMemo(() =>
    (resources || []).filter(r => actions[r.resource_id] === 'snoozed').length,
  [resources, actions])

  const visibleScored = useMemo(() =>
    hideSnoozed
      ? filtered.filter(r => actions[r.resource_id] !== 'snoozed')
      : filtered,
  [filtered, hideSnoozed, actions])

  const totalPages   = Math.ceil(visibleScored.length / PAGE_SIZE)
  const pageRows     = visibleScored.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const anomalyCount  = (resources || []).filter(r => r.is_anomaly).length
  const noBackupCount = (resources || []).filter(r =>
    (r.resource_type || '').toLowerCase() === 'microsoft.compute/virtualmachines' && !r.has_backup
  ).length

  // Distinct categories present
  const categories = useMemo(() => {
    const s = new Set((resources || []).map(r => r.resource_category || 'other'))
    return [...s].sort()
  }, [resources])

  // Distinct resource types for filter dropdown
  const resourceTypes = useMemo(() => {
    const s = new Set((resources || []).map(r => r.resource_type).filter(Boolean))
    return [...s].sort()
  }, [resources])

  // Distinct locations for filter dropdown
  const locations = useMemo(() => {
    const s = new Set((resources || []).map(r => r.location).filter(Boolean))
    return [...s].sort()
  }, [resources])

  // Distinct resource groups for filter dropdown
  const resourceGroups = useMemo(() => {
    const s = new Set((resources || []).map(r => r.resource_group).filter(Boolean))
    return [...s].sort()
  }, [resources])

  function exportCSV() {
    const cols = ['resource_name','resource_type','resource_category','location','resource_group',
                  'score_label','final_score','cost_current_month','cost_previous_month',
                  'cost_delta_pct','primary_utilization_pct','estimated_monthly_savings',
                  'is_orphan','is_anomaly','carbon_kg_per_month','subscription_id']
    const rows = [cols.join(',')]
    for (const r of filtered) {
      rows.push(cols.map(c => {
        const v = r[c]
        if (v === null || v === undefined) return ''
        if (typeof v === 'string' && v.includes(',')) return `"${v}"`
        return v
      }).join(','))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'azure-resources.csv' })
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  return (
    <>
      {cliResource && <CLIModal resource={cliResource} onClose={() => setCliResource(null)} />}
      {connectionResource && (
        <ResourceConnectionModal
          resource={connectionResource}
          allResources={resources || []}
          onClose={() => setConnectionResource(null)}
          onNavigate={(r) => {
            setConnectionResource(null)
            setExpanded(r.resource_id)
            setTimeout(() => {
              document.getElementById(`row-${r.resource_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, 50)
          }}
        />
      )}
      {tagEditResource && (
        <TagEditorModal
          resource={tagEditResource}
          schema={tagSchema}
          onClose={() => setTagEditResource(null)}
          onSaved={() => {
            setTagEditResource(null)
            fetch('/api/tags/all').then(r => r.json()).then(t => setCustomTagsMap(t || {})).catch(() => {})
          }}
        />
      )}
      {bulkTagEditorOpen && (
        <BulkTagEditorModal
          resources={filtered.filter(r => selectedIds.has(r.resource_id))}
          onClose={() => setBulkTagEditorOpen(false)}
          onSaved={() => {
            setBulkTagEditorOpen(false)
            fetch('/api/tags/all').then(r => r.json()).then(t => setCustomTagsMap(t || {})).catch(() => {})
            // Don't clear selection - user may want to do more actions
          }}
        />
      )}

      <div id="resource-table-section" className="card flex flex-col gap-4">

        {/* External filter badge */}
        {externalFilter && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-900/20 border border-blue-700/40 text-xs">
            <Filter size={12} className="text-blue-400 shrink-0" />
            <span className="text-blue-300">Filtered by: <strong>{externalFilter.label}</strong></span>
            <button
              onClick={onClearExternalFilter}
              className="ml-auto flex items-center gap-1 text-blue-500 hover:text-blue-300 transition-colors"
            >
              <XIcon size={11} /> Clear
            </button>
          </div>
        )}

        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
              All Resources
            </h2>
            <p className="text-xs text-gray-600 mt-0.5">
              {visibleScored.length} of {resources?.length ?? 0} shown
              {hideSnoozed && snoozedCount > 0 && ` · ${snoozedCount} snoozed`}
              {(scoreFilter || catFilter || typeFilter || locationFilter || rgFilter || search || externalFilter) && ' · filtered'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text" placeholder="Search name, type, RG, region…" value={search}
                onChange={e => { setSearch(e.target.value); setPage(0) }}
                className="bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600 w-52"
              />
            </div>

            {/* Status filter */}
            <select
              value={scoreFilter}
              onChange={e => { setScoreFilter(e.target.value); setPage(0) }}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600"
            >
              <option value="">All Statuses</option>
              {[
                ['Not Used',      'Confirmed Waste'],
                ['Rarely Used',   'Likely Waste'],
                ['Actively Used', 'Actively Used'],
                ['Fully Used',    'Fully Used'],
                ['Unknown',       'Unknown'],
              ].map(([val, display]) => (
                <option key={val} value={val}>{display}</option>
              ))}
            </select>

            {/* Category filter */}
            <select
              value={catFilter}
              onChange={e => { setCatFilter(e.target.value); setPage(0) }}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600"
            >
              <option value="">All Categories</option>
              {categories.map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>

            {/* Resource Type filter */}
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(0) }}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600 max-w-[180px]"
              title={typeFilter || "All Resource Types"}
            >
              <option value="">All Resource Types</option>
              {resourceTypes.map(t => (
                <option key={t} value={t}>{shortType(t)}</option>
              ))}
            </select>

            {/* Location filter */}
            <select
              value={locationFilter}
              onChange={e => { setLocationFilter(e.target.value); setPage(0) }}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600"
            >
              <option value="">All Locations</option>
              {locations.map(loc => (
                <option key={loc} value={loc}>{prettyLocation(loc)}</option>
              ))}
            </select>

            {/* Resource Group filter */}
            <select
              value={rgFilter}
              onChange={e => { setRgFilter(e.target.value); setPage(0) }}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600 max-w-[180px]"
              title={rgFilter || "All Resource Groups"}
            >
              <option value="">All Resource Groups</option>
              {resourceGroups.map(rg => (
                <option key={rg} value={rg}>{rg}</option>
              ))}
            </select>

            {/* Clear All Filters button */}
            {(scoreFilter || catFilter || typeFilter || locationFilter || rgFilter || search) && (
              <button
                onClick={() => {
                  setScoreFilter('')
                  setCatFilter('')
                  setTypeFilter('')
                  setLocationFilter('')
                  setRgFilter('')
                  setSearch('')
                  setPage(0)
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-blue-600 transition-colors"
                title="Clear all filters"
              >
                <RotateCcw size={12} />
                Clear Filters
              </button>
            )}

            {/* Anomaly filter */}
            {anomalyCount > 0 && (
              <button
                onClick={() => { setShowAnomaly(v => !v); setPage(0) }}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors',
                  showAnomaly
                    ? 'bg-orange-900/40 border-orange-700 text-orange-400'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-300',
                )}
              >
                <AlertTriangle size={12} />
                Anomalies ({anomalyCount})
              </button>
            )}

            {/* No-backup VM filter */}
            {noBackupCount > 0 && (
              <button
                onClick={() => { setShowNoBackup(v => !v); setPage(0) }}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors',
                  showNoBackup
                    ? 'bg-amber-900/40 border-amber-700 text-amber-400'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-300',
                )}
              >
                <ShieldOff size={12} />
                No Backup ({noBackupCount})
              </button>
            )}

            {/* Snoozed toggle */}
            {snoozedCount > 0 && (
              <button
                onClick={() => { setHideSnoozed(v => !v); setPage(0) }}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors',
                  !hideSnoozed
                    ? 'bg-yellow-900/40 border-yellow-700 text-yellow-400'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-300',
                )}
                title={hideSnoozed ? 'Show snoozed resources' : 'Hide snoozed resources'}
              >
                <Clock size={12} />
                {hideSnoozed ? `${snoozedCount} snoozed` : 'Hide snoozed'}
              </button>
            )}

            <button onClick={exportCSV} className="btn-ghost text-xs">↓ CSV</button>

            {/* Column picker */}
            <div className="relative" ref={colPickerRef}>
              <button
                onClick={() => setColPickerOpen(v => !v)}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors',
                  colPickerOpen
                    ? 'bg-blue-900/40 border-blue-600 text-blue-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-300',
                )}
              >
                <SlidersHorizontal size={12} /> Columns
              </button>

              {colPickerOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-30 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Show / Hide</span>
                    <button
                      onClick={resetCols}
                      className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors"
                      title="Reset to defaults"
                    >
                      <RotateCcw size={11} /> Reset
                    </button>
                  </div>
                  <div className="space-y-0.5 max-h-72 overflow-y-auto">
                    {ALL_COLS.map(col => {
                      const checked = col.alwaysVisible || visibleCols.has(col.key)
                      return (
                        <label
                          key={col.key}
                          className={clsx(
                            'flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors',
                            col.alwaysVisible ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-800/60',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={col.alwaysVisible}
                            onChange={() => !col.alwaysVisible && toggleCol(col.key)}
                            className="w-3.5 h-3.5 rounded accent-blue-500"
                          />
                          <span className="text-xs text-gray-300">{col.label}</span>
                          {!col.defaultVisible && (
                            <span className="ml-auto text-xs text-gray-700">optional</span>
                          )}
                        </label>
                      )
                    })}
                    {/* Azure Tags section */}
                    {azureTagKeys.length > 0 && (
                      <>
                        <div className="px-2 pt-2 pb-1">
                          <span className="text-xs font-semibold text-blue-500 uppercase tracking-wider">Azure Tags</span>
                        </div>
                        {azureTagKeys.map(k => (
                          <label key={`az_${k}`} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-800/60">
                            <input
                              type="checkbox"
                              checked={visibleTagCols.has(`az:${k}`)}
                              onChange={() => toggleTagCol(`az:${k}`)}
                              className="w-3.5 h-3.5 rounded accent-blue-500"
                            />
                            <span className="text-xs text-gray-300">{k}</span>
                            <Tag size={9} className="text-blue-600 ml-auto" />
                          </label>
                        ))}
                      </>
                    )}
                    {/* Custom Tags section */}
                    {tagSchema.length > 0 && (
                      <>
                        <div className="px-2 pt-2 pb-1">
                          <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Custom Tags</span>
                        </div>
                        {tagSchema.map(s => (
                          <label key={`ct_${s.tag_key}`} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-800/60">
                            <input
                              type="checkbox"
                              checked={visibleTagCols.has(`ct:${s.tag_key}`)}
                              onChange={() => toggleTagCol(`ct:${s.tag_key}`)}
                              className="w-3.5 h-3.5 rounded accent-purple-500"
                            />
                            <span className="text-xs text-gray-300">{s.display_name || s.tag_key}</span>
                            <Tag size={9} className="text-purple-500 ml-auto" />
                          </label>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Selection toolbar (shown when resources are checked) ── */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-blue-900/30 border border-blue-700/50 text-sm">
            <CheckSquare size={15} className="text-blue-400 shrink-0" />
            <span className="text-blue-200 font-medium">{selectedIds.size} resource{selectedIds.size !== 1 ? 's' : ''} selected</span>
            <div className="ml-auto flex items-center gap-2">
              {onAddSelected ? (
                <button
                  onClick={() => { onAddSelected(Array.from(selectedIds)); clearSelection() }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                >
                  <FolderPlus size={13} />
                  {addSelectedLabel} ({selectedIds.size})
                </button>
              ) : (<>
              {/* Bulk Tag Selected button */}
              <button
                onClick={() => setBulkTagEditorOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 text-white text-xs font-medium transition-colors"
                title={`Apply custom tags to ${selectedIds.size} selected resource${selectedIds.size !== 1 ? 's' : ''}`}
              >
                <Tag size={13} />
                Bulk Tag ({selectedIds.size})
              </button>
              {onSaveSelectedAsProject && (
                <div className="relative" ref={addToMenuRef}>
                  <button
                    onClick={() => setAddToMenuOpen(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                  >
                    <FolderPlus size={13} />
                    Save as Project
                    <ChevronDown size={11} />
                  </button>
                  {addToMenuOpen && (
                    <div className="absolute right-0 top-full mt-1.5 z-40 w-52 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-2">
                      <button
                        onClick={() => { setAddToMenuOpen(false); onSaveSelectedAsProject({ mode: 'new', ids: Array.from(selectedIds) }) }}
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg hover:bg-gray-800 text-xs text-gray-300 transition-colors"
                      >
                        <FolderPlus size={13} className="text-blue-400" />
                        Create new project
                      </button>
                      {projects.length > 0 && (
                        <>
                          <div className="my-1 border-t border-gray-800" />
                          <p className="px-3 py-1 text-xs text-gray-600 uppercase tracking-wider">Add to existing</p>
                          {projects.map(p => (
                            <button
                              key={p.id}
                              onClick={() => { setAddToMenuOpen(false); onSaveSelectedAsProject({ mode: 'add', ids: Array.from(selectedIds), projectId: p.id }) }}
                              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg hover:bg-gray-800 text-xs text-gray-300 transition-colors"
                            >
                              <span className="text-sm">{p.icon || '📁'}</span>
                              <span className="truncate">{p.name}</span>
                              <span className="ml-auto text-gray-600">{(p.resource_ids || []).length}</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              </>)}
              <button
                onClick={clearSelection}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              >
                <XIcon size={12} /> Deselect
              </button>
            </div>
          </div>
        )}

        {/* ── Table ── */}
        <div className="overflow-x-auto rounded-lg border border-gray-800/80">
          <table className="w-full text-left" style={{ minWidth: '1060px' }}>
            <thead>
              <tr className="bg-gray-800/70 border-b border-gray-700/60">
                {/* Select-all checkbox */}
                <th className="px-3 py-2.5 w-8">
                  <button
                    onClick={toggleSelectAll}
                    className="text-gray-500 hover:text-blue-400 transition-colors"
                    title="Select all on this page"
                  >
                    {selectedIds.size > 0 && selectedIds.size === pageRows.length
                      ? <CheckSquare size={13} className="text-blue-400" />
                      : <Square size={13} />
                    }
                  </button>
                </th>
                {visibleColDefs.map(c => (
                  <th
                    key={c.key}
                    onClick={() => c.sortable && toggleSort(c.key)}
                    className={clsx(
                      'px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap',
                      c.sortable && 'cursor-pointer hover:text-gray-200 select-none',
                      c.key === 'resource_name' && 'sticky left-0 bg-gray-800/70 z-10',
                    )}
                  >
                    <span className="flex items-center gap-1">
                      {c.label}
                      {c.sortable && <SortIcon col={c.key} sortCol={sortCol} sortDir={sortDir} />}
                    </span>
                  </th>
                ))}
                {/* Tag columns */}
                {[...visibleTagCols].map(tagKey => (
                  <th key={tagKey} className="px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      <Tag size={10} className={tagKey.startsWith('ct:') ? 'text-purple-500' : 'text-blue-400'} />
                      {tagKey.startsWith('ct:')
                        ? (tagSchema.find(s => s.tag_key === tagKey.slice(3))?.display_name || tagKey.slice(3))
                        : tagKey.startsWith('az:')
                        ? tagKey.slice(3)
                        : tagKey}
                    </span>
                  </th>
                ))}
                {/* Tag edit column */}
                <th className="px-3 py-2.5 w-8" title="Edit custom tags" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {pageRows.map(r => {
                const sc        = SCORE_COLORS[r.score_label] ?? SCORE_COLORS['Not Used']
                const tr        = TREND_BADGE[r.trend]        ?? TREND_BADGE.stable
                const catStyle  = CATEGORY_STYLE[r.resource_category] ?? CATEGORY_STYLE.other
                const isExpanded = expanded === r.resource_id
                const vis       = new Set(visibleColDefs.map(c => c.key))

                return (
                  <React.Fragment key={r.resource_id}>
                    <tr
                      id={`row-${r.resource_id}`}
                      onClick={() => setExpanded(isExpanded ? null : r.resource_id)}
                      className={clsx(
                        'cursor-pointer transition-colors group',
                        isExpanded ? 'bg-gray-800/60' : 'hover:bg-gray-800/30',
                        selectedIds.has(r.resource_id) && 'ring-1 ring-inset ring-blue-700/50 bg-blue-950/20',
                        r.is_orphan  && !selectedIds.has(r.resource_id) && 'bg-orange-950/20',
                        r.is_anomaly && !r.is_orphan && !selectedIds.has(r.resource_id) && 'bg-red-950/10',
                        actions[r.resource_id] === 'done'    && 'opacity-50',
                        actions[r.resource_id] === 'wontfix' && 'opacity-40',
                        actions[r.resource_id] === 'snoozed' && 'opacity-40',
                      )}
                    >
                      {/* Checkbox */}
                      <td className="px-3 py-3 w-8" onClick={e => toggleSelect(r.resource_id, e)}>
                        {selectedIds.has(r.resource_id)
                          ? <CheckSquare size={13} className="text-blue-400" />
                          : <Square size={13} className="text-gray-700 group-hover:text-gray-500" />
                        }
                      </td>
                      {/* Resource Name — sticky */}
                      <td className={clsx(
                        'px-3 py-3 sticky left-0 z-10 transition-colors',
                        isExpanded ? 'bg-gray-800/60' : 'bg-gray-900/95 group-hover:bg-gray-800/40',
                      )}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          {r.is_orphan  && <AlertTriangle size={12} className="text-orange-400 shrink-0" title="Orphaned resource" />}
                          {r.is_anomaly && !r.is_orphan && <span className="text-orange-500 text-xs shrink-0" title="Cost anomaly">⚡</span>}
                          {r.has_lock   && <Lock size={11} className="text-sky-400 shrink-0" title="Resource lock — intentionally protected" />}
                          <span className="font-medium text-white text-sm truncate max-w-[160px]" title={r.resource_name}>
                            {r.resource_name}
                          </span>
                        </div>
                        {/* Inline recommendation preview — only for actionable resources */}
                        {(r.score_label === 'Not Used' || r.score_label === 'Rarely Used' || r.is_orphan) &&
                          (r.ai_explanation || r.recommendation) && (
                          <p className="text-xs text-gray-600 mt-0.5 truncate max-w-[190px]"
                             title={asText(r.ai_explanation || r.recommendation)}>
                            {asText(r.ai_explanation || r.recommendation).slice(0, 72)}{asText(r.ai_explanation || r.recommendation).length > 72 ? '…' : ''}
                          </p>
                        )}
                        {/* D2: Waste Age — idle days + cumulative cost wasted */}
                        {r.days_idle != null && r.days_idle > 0 && r.cumulative_waste_usd != null && (
                          <p className={clsx(
                            'text-xs mt-0.5 font-medium tabular-nums',
                            r.days_idle > 90 ? 'text-red-500' : r.days_idle > 30 ? 'text-orange-500' : 'text-yellow-600'
                          )}>
                            Idle {r.days_idle}d · ${r.cumulative_waste_usd.toFixed(2)} wasted
                          </p>
                        )}
                        {actions[r.resource_id] && (
                          <span className={clsx('inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded border mt-1',
                            ACTION_STATUS[actions[r.resource_id]]?.cls)}>
                            {ACTION_STATUS[actions[r.resource_id]]?.label}
                          </span>
                        )}
                      </td>

                      {/* Resource Type — colored badge */}
                      {vis.has('resource_type') && (
                        <td className="px-3 py-3">
                          <ResourceTypeBadge
                            resourceType={r.resource_type}
                            category={r.resource_category || 'other'}
                            azureIcon={iconCache[r.resource_type] || null}
                          />
                        </td>
                      )}

                      {/* Region */}
                      {vis.has('location') && (
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            <MapPin size={11} className="text-gray-600 shrink-0" />
                            <span className="text-xs text-gray-300 whitespace-nowrap">
                              {prettyLocation(r.location)}
                            </span>
                          </div>
                        </td>
                      )}

                      {/* Resource Group */}
                      {vis.has('resource_group') && (
                        <td className="px-3 py-3">
                          <span className="text-xs text-gray-400 truncate block max-w-[120px]" title={r.resource_group}>
                            {r.resource_group}
                          </span>
                        </td>
                      )}

                      {/* Status badge + infra note */}
                      {vis.has('score_label') && (
                        <td className="px-3 py-3">
                          {r.is_infrastructure ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs bg-slate-800/60 text-slate-400 border-slate-700/50">
                              <Shield size={10} />Infrastructure
                            </span>
                          ) : r.score_label === 'Unknown' ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs bg-gray-800/60 text-gray-400 border-gray-700/50 whitespace-nowrap">
                              <Eye size={10} className="shrink-0" />No diagnostics
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <span className={clsx(
                                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs font-medium whitespace-nowrap',
                                sc.bg, sc.text, sc.border,
                              )}>
                                <span style={{ background: sc.dot }} className="w-1.5 h-1.5 rounded-full shrink-0" />
                                {DISPLAY_LABEL[r.score_label] ?? r.score_label}
                              </span>
                              {/* S19: Workload pattern badge */}
                              {r.workload_pattern === 'bursty' && (
                                <span className="block text-xs text-yellow-500 bg-yellow-950/30 border border-yellow-800/30 rounded px-1.5 py-0.5 whitespace-nowrap">
                                  ⚡ Bursty
                                </span>
                              )}
                              {r.workload_pattern === 'declining' && (
                                <span className="block text-xs text-orange-500 bg-orange-950/30 border border-orange-800/30 rounded px-1.5 py-0.5 whitespace-nowrap">
                                  ↘ Declining
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      )}

                      {/* Score bar */}
                      {vis.has('final_score') && (
                        <td className="px-3 py-3">
                          <ScoreBar score={r.final_score} label={r.score_label} />
                        </td>
                      )}

                      {/* Cost + MoM delta combined */}
                      {vis.has('cost_current_month') && (
                        <td className="px-3 py-3">
                          <div className="tabular-nums">
                            <p className="text-sm font-semibold text-white">{fmt(r.cost_current_month)}</p>
                            {r.cost_delta_pct !== 0 && r.cost_delta_pct !== null && (
                              <p className={clsx('text-xs mt-0.5',
                                r.cost_delta_pct > 0 ? 'text-red-400' : 'text-green-400')}
                                title={r.cost_delta_is_mtd
                                  ? `Comparing current month-to-date vs same ${new Date().getDate()} days last month`
                                  : 'Comparing current month vs full previous month'}>
                                {fmtPct(r.cost_delta_pct)} {r.cost_delta_is_mtd ? 'vs last mo. MTD' : 'MoM'}
                              </p>
                            )}
                          </div>
                        </td>
                      )}

                      {/* Utilisation */}
                      {vis.has('primary_utilization_pct') && (
                        <td className="px-3 py-3">
                          {r.is_infrastructure ? (
                            <span className="text-xs text-gray-600">N/A</span>
                          ) : fmtUtil(r.primary_utilization_pct) ? (
                            <div>
                              <p className="text-sm tabular-nums text-gray-200">
                                {fmtUtil(r.primary_utilization_pct)}
                              </p>
                              {r.avg_cpu_pct != null && r.avg_cpu_pct !== r.primary_utilization_pct && (
                                <p className="text-xs text-gray-600">CPU {r.avg_cpu_pct.toFixed(0)}%</p>
                              )}
                              {/* S18: Peak utilization */}
                              {r.peak_utilization_pct != null && r.peak_utilization_pct > (r.primary_utilization_pct ?? 0) * 1.5 && (
                                <p className="text-xs text-yellow-600" title="Maximum utilization seen in last 30 days">
                                  peak {r.peak_utilization_pct.toFixed(0)}%
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-gray-600">—</span>
                              {(r.data_confidence === 'none' || r.data_confidence === 'low') && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs bg-gray-800/60 text-gray-500 border-gray-700/60 whitespace-nowrap" title="No monitoring data — score is estimated from cost signals only">
                                  <Zap size={9} className="text-gray-600" />
                                  {r.data_confidence === 'none' ? 'No data' : 'Cost only'}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      )}

                      {/* Cost trend — month-over-month (uses data that loads on the fast open) */}
                      {vis.has('daily_costs') && (
                        <td className="px-3 py-3">
                          {(() => {
                            const curr = r.cost_current_month ?? 0
                            const prev = r.cost_previous_month ?? 0
                            if (curr <= 0 && prev <= 0)
                              return <span className="text-xs text-gray-600">—</span>
                            if (prev <= 0 && curr > 0)
                              return <span className="text-xs text-blue-400" title={`No spend last month · ${fmt(curr)} this month`}>↑ New</span>
                            if (curr <= 0 && prev > 0)
                              return <span className="text-xs text-green-400" title={`${fmt(prev)} last month · none this month`}>↓ Stopped</span>
                            const max  = Math.max(curr, prev) || 1
                            const pct  = r.cost_delta_pct ?? 0
                            const up   = pct > 0
                            const flat = Math.abs(pct) < 0.5
                            return (
                              <div className="flex items-center gap-2" title={`Last month ${fmt(prev)} → this month ${fmt(curr)}${r.cost_delta_is_mtd ? ' (month-to-date)' : ''}`}>
                                <div className="flex items-end gap-0.5 h-6">
                                  <div className="w-1.5 rounded-sm bg-gray-600" style={{ height: `${Math.max(2, (prev / max) * 24)}px` }} />
                                  <div className={clsx('w-1.5 rounded-sm', flat ? 'bg-gray-500' : up ? 'bg-red-500/70' : 'bg-green-500/70')} style={{ height: `${Math.max(2, (curr / max) * 24)}px` }} />
                                </div>
                                <span className={clsx('text-xs tabular-nums', flat ? 'text-gray-500' : up ? 'text-red-400' : 'text-green-400')}>
                                  {flat ? '→' : up ? '▲' : '▼'} {fmtPct(pct)}
                                </span>
                              </div>
                            )
                          })()}
                        </td>
                      )}

                      {/* Savings */}
                      {vis.has('estimated_monthly_savings') && (
                        <td className="px-3 py-3 tabular-nums">
                          {r.estimated_monthly_savings > 0 ? (
                            <div>
                              <p className="text-sm font-semibold text-green-400">{fmt(r.estimated_monthly_savings)}</p>
                              <p className="text-xs text-gray-600">{fmt(r.estimated_monthly_savings * 12)}/yr</p>
                            </div>
                          ) : (
                            <span className="text-gray-700 text-sm">—</span>
                          )}
                        </td>
                      )}

                      {/* Connections button */}
                      {vis.has('connections') && (
                        <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => setConnectionResource(r)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-400 border border-gray-700 hover:text-blue-300 hover:border-blue-600 hover:bg-blue-900/20 transition-colors whitespace-nowrap"
                          >
                            <Network size={11} /> Map
                          </button>
                        </td>
                      )}

                      {/* AI + Advisor combined */}
                      {vis.has('ai_action') && (
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            {r.ai_action && r.ai_action !== 'none' && (
                              <div className="flex items-center gap-1">
                                <Brain size={11} className={AI_CONFIDENCE_COLOR[r.ai_confidence] || 'text-gray-500'} />
                                <span className={clsx('text-xs capitalize', AI_CONFIDENCE_COLOR[r.ai_confidence] || 'text-gray-500')}>
                                  {AI_ACTION_ICON[r.ai_action]} {r.ai_action}
                                </span>
                              </div>
                            )}
                            {r.advisor_recommendations?.length > 0 && (
                              <div className="flex items-center gap-1">
                                <Lightbulb size={11} className="text-yellow-400" />
                                <span className="text-xs text-yellow-400">
                                  {r.advisor_recommendations.length} rec{r.advisor_recommendations.length > 1 ? 's' : ''}
                                </span>
                              </div>
                            )}
                            {!r.ai_action && !r.advisor_recommendations?.length && (
                              <span className="text-gray-700 text-xs">—</span>
                            )}
                          </div>
                        </td>
                      )}

                      {/* ── Optional extra columns ── */}
                      {vis.has('sku') && (
                        <td className="px-3 py-3">
                          <span className="text-xs text-gray-400 font-mono">{r.sku || '—'}</span>
                        </td>
                      )}
                      {vis.has('subscription_id') && (
                        <td className="px-3 py-3">
                          <span className="text-xs text-gray-500 font-mono">
                            {r.subscription_id ? r.subscription_id.slice(0, 8) + '…' : '—'}
                          </span>
                        </td>
                      )}
                      {vis.has('carbon_kg_per_month') && (
                        <td className="px-3 py-3 tabular-nums">
                          {r.carbon_kg_per_month > 0
                            ? <span className="text-xs text-green-600">{r.carbon_kg_per_month.toFixed(1)}</span>
                            : <span className="text-xs text-gray-700">—</span>}
                        </td>
                      )}
                      {vis.has('days_since_active') && (
                        <td className="px-3 py-3 tabular-nums">
                          {r.days_since_active != null
                            ? <span className={clsx('text-xs', r.days_since_active > 30 ? 'text-orange-400' : 'text-gray-400')}>{r.days_since_active}d</span>
                            : <span className="text-xs text-gray-700">—</span>}
                        </td>
                      )}
                      {vis.has('data_confidence') && (
                        <td className="px-3 py-3">
                          <span className={clsx('text-xs font-medium', {
                            'text-green-400':  r.data_confidence === 'high',
                            'text-yellow-500': r.data_confidence === 'medium',
                            'text-orange-500': r.data_confidence === 'low',
                            'text-red-500':    r.data_confidence === 'none',
                            'text-gray-600':   !r.data_confidence,
                          })}>
                            {r.data_confidence || '—'}
                          </span>
                        </td>
                      )}
                      {vis.has('orphan_reason') && (
                        <td className="px-3 py-3">
                          {r.is_orphan
                            ? <span className="text-xs text-orange-400">{r.orphan_reason || 'Orphaned'}</span>
                            : <span className="text-xs text-gray-700">—</span>}
                        </td>
                      )}
                      {vis.has('missing_tags') && (
                        <td className="px-3 py-3">
                          {r.missing_tags?.length > 0
                            ? <span className="text-xs text-orange-400">{r.missing_tags.join(', ')}</span>
                            : <span className="text-xs text-gray-700">—</span>}
                        </td>
                      )}

                      {/* ── Tag value columns ── */}
                      {[...visibleTagCols].map(tagKey => {
                        const merged = getMergedTags(r)
                        const val = tagKey.startsWith('az:')
                          ? (r.tags || {})[tagKey.slice(3)]
                          : merged[tagKey.slice(3)]
                        return (
                          <td key={tagKey} className="px-3 py-3" onClick={e => e.stopPropagation()}>
                            {val != null && val !== ''
                              ? <span className="text-xs text-gray-300 bg-gray-800/60 border border-gray-700/50 rounded px-1.5 py-0.5 max-w-[120px] truncate block" title={String(val)}>{String(val)}</span>
                              : <span className="text-xs text-gray-700">—</span>}
                          </td>
                        )
                      })}

                      {/* ── Tag edit button ── */}
                      <td className="px-3 py-3 w-8" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setTagEditResource(r)}
                          className="p-1 rounded text-gray-600 hover:text-purple-400 hover:bg-purple-900/20 transition-colors"
                          title="Edit custom tags"
                        >
                          <Pencil size={12} />
                        </button>
                      </td>
                    </tr>

                    {/* ── Expanded detail row ── */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={visibleColDefs.length} className="bg-gray-900/60 border-t border-b border-gray-800/60 px-0 py-0">
                          <div className="px-6 py-5">

                            {/* Resource metadata strip */}
                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 mb-4 pb-3 border-b border-gray-800/60">
                              <span><span className="text-gray-600">ID:</span> <span className="font-mono text-gray-500 text-xs break-all">{r.resource_id}</span></span>
                              {r.subscription_id && <span><span className="text-gray-600">Sub:</span> <span className="font-mono">{r.subscription_id.slice(0,8)}…</span></span>}
                              {r.sku && <span><span className="text-gray-600">SKU:</span> <span className="text-gray-400">{r.sku}</span></span>}
                              {r.last_active_date && <span><span className="text-gray-600">Last active:</span> <span className="text-gray-400">{r.last_active_date} ({r.days_since_active}d ago)</span></span>}
                              {r.carbon_kg_per_month > 0 && <span><span className="text-gray-600">Carbon:</span> <span className="text-green-600">{r.carbon_kg_per_month.toFixed(1)} kg CO₂/mo</span></span>}
                              {r.data_confidence && r.data_confidence !== 'high' && (
                                <span>
                                  <span className="text-gray-600">Data confidence:</span>{' '}
                                  <span className={clsx('font-medium', {
                                    'text-yellow-500': r.data_confidence === 'medium',
                                    'text-orange-500': r.data_confidence === 'low',
                                    'text-red-500':    r.data_confidence === 'none',
                                  })}>
                                    {r.data_confidence}
                                  </span>
                                  {r.telemetry_source && r.telemetry_source !== 'none' && (
                                    <span className="text-gray-700"> ({r.telemetry_source.replace('_', ' ')})</span>
                                  )}
                                </span>
                              )}
                            </div>

                            {/* Resource tags */}
                            {r.tags && Object.keys(r.tags).length > 0 && (
                              <div className="mb-4">
                                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Tags</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {Object.entries(r.tags).map(([k, v]) => (
                                    <span key={k} className="inline-flex items-center gap-1 text-xs bg-gray-800/60 border border-gray-700/60 rounded-md px-2 py-0.5">
                                      <span className="text-gray-500">{k}:</span>
                                      <span className="text-gray-300 font-medium">{v || '—'}</span>
                                    </span>
                                  ))}
                                </div>
                                {r.missing_tags?.length > 0 && (
                                  <p className="text-xs text-orange-500/80 mt-1.5">
                                    Missing: {r.missing_tags.join(', ')}
                                  </p>
                                )}
                              </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

                              {/* Score & recommendation */}
                              <div className="space-y-3">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Score Breakdown</p>
                                <ScoreBreakdown resource={r} />

                                {/* D2: Waste Age — detailed view */}
                                {r.days_idle != null && r.days_idle > 0 && r.cumulative_waste_usd != null && (
                                  <div className={clsx(
                                    'flex items-center gap-2 text-xs rounded-lg px-2.5 py-2 border',
                                    r.days_idle > 90
                                      ? 'bg-red-950/30 border-red-800/40 text-red-400'
                                      : r.days_idle > 30
                                        ? 'bg-orange-950/30 border-orange-800/40 text-orange-400'
                                        : 'bg-yellow-950/30 border-yellow-800/40 text-yellow-500'
                                  )}>
                                    <span className="text-base shrink-0">⏱</span>
                                    <div>
                                      <span className="font-semibold">Idle {r.days_idle} days</span>
                                      <span className="text-gray-500 mx-1">·</span>
                                      <span className="font-semibold">${r.cumulative_waste_usd.toFixed(2)} wasted</span>
                                      {r.idle_since_date && (
                                        <span className="text-gray-600 ml-1">since {r.idle_since_date}</span>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* S22: Why NOT waste explanation */}
                                {r.protection_reason && (
                                  <div className="flex items-center gap-1.5 text-xs text-sky-400 bg-sky-950/20 border border-sky-800/30 rounded-lg px-2.5 py-1.5">
                                    <span className="shrink-0">🛡</span>
                                    <span>{r.protection_reason}</span>
                                  </div>
                                )}

                                {r.recommendation && (
                                  <p className="text-xs text-gray-400 leading-relaxed bg-gray-800/40 rounded-lg p-2.5 border border-gray-800">
                                    {r.recommendation}
                                  </p>
                                )}
                                {r.rightsize_sku && (
                                  <div className="flex items-center gap-1.5 text-xs text-blue-400 bg-blue-900/20 border border-blue-800/30 rounded-lg px-2.5 py-1.5">
                                    <span>💡</span>
                                    <span>Right-size to <span className="font-mono font-semibold">{r.rightsize_sku}</span> — save {r.rightsize_savings_pct?.toFixed(0)}%</span>
                                  </div>
                                )}
                              </div>

                              {/* Azure Advisor */}
                              <div className="space-y-2">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                  <Lightbulb size={11} className="text-yellow-400" /> Azure Advisor
                                </p>
                                {r.advisor_recommendations?.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {r.advisor_recommendations.map((rec, i) => (
                                      <div key={i} className="flex items-start gap-2 text-xs bg-gray-800/40 rounded-lg p-2 border border-gray-800">
                                        <span className={clsx(
                                          'shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold',
                                          rec.impact === 'High'   && 'bg-red-900/60 text-red-400',
                                          rec.impact === 'Medium' && 'bg-orange-900/60 text-orange-400',
                                          rec.impact === 'Low'    && 'bg-blue-900/60 text-blue-400',
                                        )}>
                                          {rec.impact}
                                        </span>
                                        <span className="text-gray-300 flex-1 leading-relaxed">{rec.short_description || rec.category}</span>
                                        {rec.potential_savings > 0 && (
                                          <span className="text-green-400 font-semibold shrink-0">{fmt(rec.potential_savings)}/mo</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-600">No Advisor recommendations.</p>
                                )}
                              </div>

                              {/* AI Analysis */}
                              <div className="space-y-2">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                                  <Brain size={11} className="text-indigo-400" /> AI Analysis
                                </p>
                                {(() => {
                                  const ao = aiOverrides[r.resource_id] || {}
                                  const explanation = ao.ai_explanation || r.ai_explanation
                                  const confidence  = ao.ai_confidence  || r.ai_confidence
                                  const action      = ao.ai_action      || r.ai_action

                                  if (explanation) {
                                    return (
                                      <div className="space-y-2">
                                        <p className="text-xs text-gray-300 leading-relaxed bg-indigo-950/30 border border-indigo-900/40 rounded-lg p-2.5">
                                          {explanation}
                                        </p>
                                        <div className="flex gap-2">
                                          <span className={clsx('text-xs px-1.5 py-0.5 rounded bg-indigo-900/30 border border-indigo-800/40',
                                            AI_CONFIDENCE_COLOR[confidence] || 'text-gray-400')}>
                                            {confidence} confidence
                                          </span>
                                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300">
                                            {AI_ACTION_ICON[action]} {action}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  }

                                  if (r.is_infrastructure) {
                                    return <p className="text-xs text-gray-600">Infrastructure resource — not sent for AI review.</p>
                                  }
                                  if (r.score_label === 'Unknown') {
                                    return (
                                      <p className="text-xs text-gray-600">
                                        No utilisation metrics available — AI assessment requires diagnostics.{' '}
                                        {r.resource_id && (
                                          <a href={`https://portal.azure.com/#resource${r.resource_id}/diagnostics`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="text-amber-500 hover:text-amber-400 transition-colors"
                                            onClick={e => e.stopPropagation()}>
                                            Enable diagnostics →
                                          </a>
                                        )}
                                      </p>
                                    )
                                  }
                                  if (r.final_score >= 75) {
                                    return <p className="text-xs text-gray-600">Score ≥ 75 — healthy resource, not sent for AI review.</p>
                                  }

                                  // AI is configured but verdict is missing (e.g. cached scan pre-dates AI setup)
                                  if (aiEnabled) {
                                    if (ao.loading) {
                                      return (
                                        <div className="flex items-center gap-2 text-xs text-indigo-400">
                                          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                          </svg>
                                          Running AI analysis…
                                        </div>
                                      )
                                    }
                                    if (ao.error) {
                                      return (
                                        <div className="space-y-1">
                                          <p className="text-xs text-red-400">{ao.error}</p>
                                          <button onClick={e => handleAnalyzeAI(r.resource_id, e)}
                                            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                                            Retry →
                                          </button>
                                        </div>
                                      )
                                    }
                                    return (
                                      <div className="flex items-center gap-3">
                                        <p className="text-xs text-gray-600">AI analysis not yet run for this resource.</p>
                                        <button
                                          onClick={e => handleAnalyzeAI(r.resource_id, e)}
                                          className="text-xs px-2.5 py-1 rounded bg-indigo-900/40 border border-indigo-700/40 text-indigo-300 hover:bg-indigo-800/40 hover:text-indigo-200 transition-colors shrink-0"
                                        >
                                          ✦ Analyze with AI
                                        </button>
                                      </div>
                                    )
                                  }

                                  return <p className="text-xs text-gray-600">No AI analysis — add an API key in Settings.</p>
                                })()}
                              </div>
                            </div>

                            {/* Action steps — specific plan for this resource */}
                            {r.safe_action_steps?.length > 0 && (
                              <div className="mt-5 pt-4 border-t border-gray-800/60">
                                {r.score_label === 'Unknown' ? (
                                  <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg bg-amber-900/10 border border-amber-700/30">
                                    <span className="text-amber-500 text-sm shrink-0 mt-0.5">⏳</span>
                                    <div>
                                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Diagnostics Required</p>
                                      <p className="text-xs text-amber-600/80 mt-0.5">
                                        No utilisation data — follow these steps before making any changes.
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                                    <Navigation size={11} className="text-blue-400" />
                                    {r.steps_source === 'ai' ? 'AI-Generated Action Plan' : 'Recommended Action Plan'}
                                  </p>
                                )}
                                <div className="space-y-0">
                                  {r.safe_action_steps.map((step, i) => {
                                    const phaseStyle = {
                                      immediate: { badge: 'bg-orange-900/40 border-orange-700/40 text-orange-300', line: 'bg-orange-800/40' },
                                      verify:    { badge: 'bg-blue-900/40 border-blue-700/40 text-blue-300',       line: 'bg-blue-800/40'   },
                                      tag:       { badge: 'bg-purple-900/40 border-purple-700/40 text-purple-300', line: 'bg-purple-800/40' },
                                      wait:      { badge: 'bg-amber-900/40 border-amber-700/40 text-amber-300',    line: 'bg-amber-800/40'  },
                                      delete:    { badge: 'bg-red-900/40 border-red-700/40 text-red-300',          line: 'bg-red-800/40'    },
                                    }[step.phase] ?? { badge: 'bg-gray-800 border-gray-700 text-gray-400', line: 'bg-gray-700' }
                                    const isLast = i === r.safe_action_steps.length - 1
                                    return (
                                      <div key={i} className="flex gap-3">
                                        {/* Spine: step number + connecting line */}
                                        <div className="flex flex-col items-center shrink-0">
                                          <div className={clsx('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border', phaseStyle.badge)}>
                                            {i + 1}
                                          </div>
                                          {!isLast && <div className={clsx('w-px flex-1 my-1 min-h-[16px]', phaseStyle.line)} />}
                                        </div>
                                        {/* Content */}
                                        <div className={clsx('flex-1 min-w-0', !isLast && 'pb-4')}>
                                          <div className="flex items-center gap-2 mb-1 mt-0.5">
                                            <span className="text-xs font-semibold text-gray-200 leading-tight">{step.title}</span>
                                            <span className={clsx('text-xs px-1.5 py-px rounded border capitalize shrink-0', phaseStyle.badge)}>
                                              {step.phase}
                                            </span>
                                          </div>
                                          {step.detail && (
                                            <p className="text-xs text-gray-500 leading-relaxed mb-1.5">{step.detail}</p>
                                          )}
                                          {step.portal_path && (
                                            <div className="flex items-start gap-1.5 mt-1">
                                              <Navigation size={9} className="text-blue-500 mt-0.5 shrink-0" />
                                              <span className="text-xs text-blue-400/80 font-mono leading-relaxed">{step.portal_path}</span>
                                            </div>
                                          )}
                                          {step.az_cli && (
                                            <div className="mt-1 flex items-start gap-1.5 bg-gray-950/60 rounded px-2 py-1">
                                              <Terminal size={9} className="text-green-500 mt-0.5 shrink-0" />
                                              <code className="text-xs text-green-400/80 font-mono leading-relaxed break-all flex-1">{step.az_cli}</code>
                                              <button
                                                onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(step.az_cli) }}
                                                className="shrink-0 text-gray-600 hover:text-gray-300 transition-colors"
                                                title="Copy CLI command">
                                                <Copy size={10} />
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Action footer */}
                            <div className="flex items-center justify-between pt-4 mt-4 border-t border-gray-800/60 gap-4 flex-wrap">
                              <ActionTracker resourceId={r.resource_id} actions={actions} onAction={handleAction} />
                              <div className="flex items-center gap-2">
                                {r.portal_url && (
                                  <a
                                    href={r.portal_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
                                  >
                                    <ExternalLink size={11} /> Open in Portal
                                  </a>
                                )}
                                {(r.cli_delete_cmd || r.cli_resize_cmd) && (
                                  <button
                                    onClick={e => { e.stopPropagation(); setCliResource(r) }}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
                                  >
                                    <Terminal size={11} /> CLI Commands
                                  </button>
                                )}
                              </div>
                            </div>

                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}

              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={visibleColDefs.length} className="px-6 py-10 text-center text-gray-600 text-sm">
                    No resources match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Page {page + 1} of {totalPages} · {visibleScored.length} results</span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="px-2 py-1 rounded bg-gray-800 border border-gray-700 disabled:opacity-30 hover:bg-gray-700 transition-colors"
              >«</button>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2.5 py-1 rounded bg-gray-800 border border-gray-700 disabled:opacity-30 hover:bg-gray-700 transition-colors"
              >← Prev</button>
              {/* Page number pills */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(0, Math.min(totalPages - 5, page - 2)) + i
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={clsx(
                      'px-2.5 py-1 rounded border text-xs transition-colors',
                      p === page
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-gray-800 border-gray-700 hover:bg-gray-700',
                    )}
                  >
                    {p + 1}
                  </button>
                )
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-2.5 py-1 rounded bg-gray-800 border border-gray-700 disabled:opacity-30 hover:bg-gray-700 transition-colors"
              >Next →</button>
              <button
                onClick={() => setPage(totalPages - 1)}
                disabled={page >= totalPages - 1}
                className="px-2 py-1 rounded bg-gray-800 border border-gray-700 disabled:opacity-30 hover:bg-gray-700 transition-colors"
              >»</button>
            </div>
          </div>
        )}

      </div>
    </>
  )
}
