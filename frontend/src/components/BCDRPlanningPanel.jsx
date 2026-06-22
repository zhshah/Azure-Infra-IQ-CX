/**
 * BCDR Planning Panel
 * 
 * Phase 1 BCDR Planning - Allows users to categorize resources with BCDR metadata.
 * Displays resources in a table with inline editing for:
 * - Criticality (Critical/High/Medium/Low)
 * - DR Tier (Tier 0/1/2/3)
 * - RTO Target
 * - RPO Target  
 * - Business Function
 * - Notes
 *
 * Features:
 * - Load all BCDR metadata on mount
 * - Inline editing for each resource
 * - Bulk selection and bulk editing
 * - Filter by criticality, DR tier, location, type
 * - Sort by any column
 * - Coverage statistics
 */
import React, { useState, useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { FileText, FileSpreadsheet, X, Loader2, SlidersHorizontal, Paperclip, ChevronLeft, ChevronRight, Columns3, Check } from 'lucide-react'
import { api } from '../api/client'
import { BCDRBadge, BulkBCDREditor, ResourceBCDREditor, CRITICALITY_OPTIONS, DR_TIER_OPTIONS, RTO_OPTIONS, RPO_OPTIONS, AZURE_REGIONS, ENVIRONMENTS, DATA_CLASSES, BCDR_INTAKE_FIELDS } from './BCDRMetadataEditor'

// localStorage key for the user's chosen column visibility in the Phase 1 grid.
const COLS_STORAGE_KEY = 'bcdr-phase1-columns-v1'
// Tracks custom-tag columns we've auto-revealed once (so saved tags show up after tagging
// without the user manually enabling the column, while still respecting later manual hides).
const AUTOSHOWN_TAGS_KEY = 'bcdr-phase1-autoshown-tags-v1'

// Normalise an options array (strings or {value,label}) to a uniform {value,label} list.
const _opts = (arr) => (arr || []).map(o => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label }))

// The fixed BCDR planning fields, rendered as toggleable, inline-editable columns.
// Each saves to the resource_bcdr_metadata store (Azure SQL) the moment a value is entered.
const BCDR_COLUMNS = [
  { key: 'criticality',             label: 'Criticality',       field: 'criticality',             type: 'select', options: _opts(CRITICALITY_OPTIONS), defaultVisible: true,  w: 130 },
  { key: 'dr_tier',                 label: 'DR Tier',           field: 'dr_tier',                 type: 'select', options: _opts(DR_TIER_OPTIONS),     defaultVisible: true,  w: 120 },
  { key: 'rto_target',              label: 'RTO',               field: 'rto_target',              type: 'select', options: _opts(RTO_OPTIONS),         defaultVisible: true,  w: 110 },
  { key: 'rpo_target',              label: 'RPO',               field: 'rpo_target',              type: 'select', options: _opts(RPO_OPTIONS),         defaultVisible: true,  w: 110 },
  { key: 'business_function',       label: 'Business Function', field: 'business_function',       type: 'text',   placeholder: 'e.g. Production API',         defaultVisible: true,  w: 160 },
  { key: 'target_region',           label: 'Target Region',     field: 'target_region',           type: 'select', options: _opts(AZURE_REGIONS),       defaultVisible: true,  w: 140 },
  { key: 'environment',             label: 'Environment',       field: 'environment',             type: 'select', options: _opts(ENVIRONMENTS),        defaultVisible: true,  w: 130 },
  { key: 'data_classification',     label: 'Data Class',        field: 'data_classification',     type: 'select', options: _opts(DATA_CLASSES),        defaultVisible: true,  w: 140 },
  { key: 'desired_sku',             label: 'Desired SKU',       field: 'desired_sku',             type: 'text',   placeholder: 'e.g. Standard_D8s_v5',        defaultVisible: false, w: 160 },
  { key: 'business_owner',          label: 'Business Owner',    field: 'business_owner',          type: 'text',   placeholder: 'e.g. team@contoso.com',       defaultVisible: false, w: 170 },
  { key: 'financial_loss_per_hour', label: 'Loss / hr',         field: 'financial_loss_per_hour', type: 'text',   placeholder: 'e.g. $50,000',                defaultVisible: false, w: 120 },
  { key: 'app_dependencies',        label: 'App Dependencies',  field: 'app_dependencies',        type: 'text',   placeholder: 'e.g. SQL, Key Vault',         defaultVisible: false, w: 170 },
  { key: 'compliance',              label: 'Compliance',        field: 'compliance',              type: 'text',   placeholder: 'e.g. ISO 27001, GDPR',        defaultVisible: false, w: 160 },
  { key: 'notes',                   label: 'Notes',             field: 'notes',                   type: 'text',   placeholder: 'Notes…',                      defaultVisible: true,  w: 160 },
]
const BCDR_COL_KEYS = new Set(BCDR_COLUMNS.map(c => c.key))

// A text/number input that AUTOSAVES as you type (debounced) AND on blur — no Save button,
// just like the Azure portal. Keeps its own local value so typing is instant.
function AutoSaveInput({ value, placeholder, type = 'text', onSave }) {
  const [v, setV] = useState(value || '')
  const tRef = useRef(null)
  const latest = useRef(value || '')      // always holds the newest typed value
  const lastSaved = useRef(value || '')
  useEffect(() => { setV(value || ''); latest.current = value || ''; lastSaved.current = value || '' }, [value])
  const commit = () => {
    if (tRef.current) { clearTimeout(tRef.current); tRef.current = null }
    if (latest.current !== lastSaved.current) { lastSaved.current = latest.current; onSave(latest.current) }
  }
  return (
    <input
      type={type}
      value={v}
      placeholder={placeholder}
      onChange={(e) => {
        const val = e.target.value
        setV(val)
        latest.current = val
        if (tRef.current) clearTimeout(tRef.current)
        tRef.current = setTimeout(commit, 600)   // autosave ~0.6s after typing stops
      }}
      onBlur={commit}
      className="w-full text-xs bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
    />
  )
}

// One editable grid cell — renders the right editor for the column type and autosaves
// immediately on change (selects) or debounced (text/number). Used for BOTH BCDR fields
// and the user's custom tags.
function DataCell({ col, value, onSave }) {
  if (col.type === 'select') {
    return (
      <select
        value={value || ''}
        onChange={(e) => onSave(e.target.value)}
        className="w-full text-xs bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-blue-600"
      >
        <option value="">Select…</option>
        {(col.options || []).map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    )
  }
  if (col.type === 'bool') {
    return (
      <select
        value={value || ''}
        onChange={(e) => onSave(e.target.value)}
        className="w-full text-xs bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-blue-600"
      >
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  }
  return <AutoSaveInput value={value} placeholder={col.placeholder} type={col.type === 'number' ? 'number' : 'text'} onSave={onSave} />
}

// A single row in the "Columns" add/remove menu.
function ColToggle({ col, checked, onToggle }) {
  return (
    <button onClick={onToggle} className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-gray-800 text-xs text-gray-300 transition-colors">
      <span className={clsx('w-4 h-4 rounded border flex items-center justify-center shrink-0', checked ? 'bg-blue-600 border-blue-600' : 'border-gray-600')}>
        {checked && <Check size={11} className="text-white" />}
      </span>
      <span className="truncate text-left">{col.label}</span>
      {col.kind === 'tag' && <span className="ml-auto text-[9px] px-1 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-800/50 shrink-0">tag</span>}
    </button>
  )
}

export default function BCDRPlanningPanel({ resources }) {
  const [metadata, setMetadata] = useState({}) // Map of resource_id -> metadata
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBulkEditor, setShowBulkEditor] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [sortField, setSortField] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [filterCriticality, setFilterCriticality] = useState('')
  const [filterDrTier, setFilterDrTier] = useState('')
  const [filterText, setFilterText] = useState('')
  // Resource-scope filters (subscription / resource group / location / type) — like the main Resources view
  const [subFilter, setSubFilter] = useState('')
  const [rgFilter, setRgFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [subNameMap, setSubNameMap] = useState({})        // { subscription_id: name }
  const [attachCounts, setAttachCounts] = useState({})    // { resource_id_lower: count }
  const [editorResource, setEditorResource] = useState(null) // resource open in the per-resource editor
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50
  // Custom-tag columns + values (so the user's own tags are fillable inline here too)
  const [tagSchema, setTagSchema] = useState([])           // [{tag_key, display_name, tag_type, enum_values, color, category}]
  const [tagsByResource, setTagsByResource] = useState({}) // { resource_id: { tag_key: value } }
  // Column add/remove (show/hide) — persisted so the user's chosen fields stick.
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLS_STORAGE_KEY))
      if (Array.isArray(saved)) return new Set(saved)
    } catch { /* ignore */ }
    return new Set(BCDR_COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  })
  const [colMenuOpen, setColMenuOpen] = useState(false)
  const colMenuRef = useRef(null)
  // Remembers which custom-tag columns were auto-revealed once. Persisted so we never
  // re-show a column the user later hid on purpose.
  const autoShownTags = useRef((() => {
    try { const s = JSON.parse(localStorage.getItem(AUTOSHOWN_TAGS_KEY)); return new Set(Array.isArray(s) ? s : []) } catch { return new Set() }
  })())
  useEffect(() => {
    try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify([...visibleCols])) } catch { /* ignore */ }
  }, [visibleCols])
  // Close the column menu on outside click
  useEffect(() => {
    if (!colMenuOpen) return
    const onClick = (e) => { if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenuOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [colMenuOpen])

  // Load all BCDR metadata on mount
  useEffect(() => {
    loadMetadata()
    loadAttachmentCounts()
    loadTagsAndSchema()
    // Resolve subscription display names for the Subscription filter.
    api._request('/subscriptions').then(list => {
      if (Array.isArray(list)) {
        const m = {}
        for (const s of list) { if (s && s.subscription_id) m[s.subscription_id] = s.subscription_name || s.subscription_id }
        setSubNameMap(m)
      }
    }).catch(() => {})
  }, [])

  // Load the custom-tag schema + every resource's tag values so tags are fillable inline.
  const loadTagsAndSchema = async () => {
    try {
      const [schema, all] = await Promise.all([
        api.getTagSchema().catch(() => []),
        api.getAllTags().catch(() => ({})),
      ])
      setTagSchema(Array.isArray(schema) ? schema : [])
      setTagsByResource(all && typeof all === 'object' ? all : {})
    } catch { /* ignore */ }
  }

  const loadAttachmentCounts = async () => {
    try {
      const all = await api.listBcdrAttachments('')   // no filter → all attachments
      const counts = {}
      for (const a of (all || [])) {
        const rid = (a.resource_id || '').toLowerCase()
        if (rid) counts[rid] = (counts[rid] || 0) + 1
      }
      setAttachCounts(counts)
    } catch { /* ignore */ }
  }

  const loadMetadata = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const allMeta = await api.getBCDRMetadataAll()
      setMetadata(allMeta || {})
    } catch (err) {
      console.error('Failed to load BCDR metadata:', err)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // Immediate autosave for a BCDR field — optimistic local update + partial save (only the
  // changed field). No "Save" button: the value persists the moment it is entered.
  const saveField = (resourceId, field, value) => {
    setMetadata(prev => ({ ...prev, [resourceId]: { ...(prev[resourceId] || {}), [field]: value } }))
    setSaving(prev => ({ ...prev, [resourceId]: true }))
    api.saveBCDRMetadata(resourceId, { [field]: value })
      .catch(err => console.error('Failed to save BCDR metadata:', err))
      .finally(() => setSaving(prev => ({ ...prev, [resourceId]: false })))
  }

  // Immediate autosave for a custom tag value — optimistic local update + merge-save (keeps
  // the resource's other tags). Same "type a value and it's saved" behaviour. NOTE: the backend
  // tagging service stores tags keyed by the LOWERCASED resource_id, and /api/tags/all returns
  // them that way, so we key tagsByResource by the lowercased id too (otherwise the value loads
  // back under a different key than the grid reads and disappears on refresh).
  const saveTag = (resourceId, tagKey, value) => {
    const rkey = (resourceId || '').toLowerCase()
    setTagsByResource(prev => ({ ...prev, [rkey]: { ...((prev || {})[rkey] || {}), [tagKey]: value } }))
    setSaving(prev => ({ ...prev, [resourceId]: true }))
    api.setResourceTags(resourceId, { [tagKey]: value }, true)
      .catch(err => console.error('Failed to save tag:', err))
      .finally(() => setSaving(prev => ({ ...prev, [resourceId]: false })))
  }

  // Read/save a single grid cell regardless of whether it's a BCDR field or a custom tag.
  const cellValue = (col, rid) => col.kind === 'tag'
    ? (tagsByResource[(rid || '').toLowerCase()] || {})[col.tagKey]
    : (metadata[rid] || {})[col.field]
  const saveCell = (col, rid, value) => col.kind === 'tag'
    ? saveTag(rid, col.tagKey, value)
    : saveField(rid, col.field, value)

  const handleBulkSave = async (updates) => {
    const updateMap = {}
    for (const update of updates) {
      const current = metadata[update.resource_id] || {}
      updateMap[update.resource_id] = {
        ...current,
        ...(update.criticality && { criticality: update.criticality }),
        ...(update.dr_tier && { dr_tier: update.dr_tier }),
        ...(update.rto_target && { rto_target: update.rto_target }),
        ...(update.rpo_target && { rpo_target: update.rpo_target }),
        ...(update.business_function && { business_function: update.business_function }),
        ...(update.notes && { notes: update.notes }),
        ...(update.target_region && { target_region: update.target_region }),
        ...(update.desired_sku && { desired_sku: update.desired_sku }),
        ...(update.environment && { environment: update.environment }),
        ...(update.business_owner && { business_owner: update.business_owner }),
        ...(update.financial_loss_per_hour && { financial_loss_per_hour: update.financial_loss_per_hour }),
        ...(update.app_dependencies && { app_dependencies: update.app_dependencies }),
        ...(update.data_classification && { data_classification: update.data_classification }),
        ...(update.compliance && { compliance: update.compliance }),
      }
    }
    setMetadata(prev => ({ ...prev, ...updateMap }))
    setSelectedIds(new Set())
    await loadMetadata(true) // Refresh stats (silent)
  }

  const toggleSelection = (resourceId) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(resourceId)) {
        next.delete(resourceId)
      } else {
        next.add(resourceId)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === processed.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(processed.map(r => r.resource_id || r.id)))
    }
  }

  // Sort and filter
  const processed = useMemo(() => {
    if (!resources) return []
    
    let filtered = resources.filter(r => r.resource_id || r.id)
    
    // Text filter
    if (filterText) {
      const lower = filterText.toLowerCase()
      filtered = filtered.filter(r =>
        (r.resource_name || r.name)?.toLowerCase().includes(lower) ||
        (r.resource_type || r.type)?.toLowerCase().includes(lower) ||
        r.location?.toLowerCase().includes(lower) ||
        metadata[r.resource_id || r.id]?.business_function?.toLowerCase().includes(lower)
      )
    }
    
    // Criticality filter
    if (filterCriticality) {
      filtered = filtered.filter(r => 
        metadata[r.resource_id || r.id]?.criticality === filterCriticality
      )
    }
    
    // DR Tier filter
    if (filterDrTier) {
      filtered = filtered.filter(r => 
        metadata[r.resource_id || r.id]?.dr_tier === filterDrTier
      )
    }

    // Resource-scope filters (subscription / resource group / location / type)
    if (subFilter)      filtered = filtered.filter(r => r.subscription_id === subFilter)
    if (rgFilter)       filtered = filtered.filter(r => (r.resource_group || r.resourceGroup) === rgFilter)
    if (locationFilter) filtered = filtered.filter(r => r.location === locationFilter)
    if (typeFilter)     filtered = filtered.filter(r => (r.resource_type || r.type) === typeFilter)
    
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      const aId = a.resource_id || a.id
      const bId = b.resource_id || b.id
      let aVal, bVal
      
      switch (sortField) {
        case 'name':
          aVal = a.resource_name || a.name || ''
          bVal = b.resource_name || b.name || ''
          break
        case 'type':
          aVal = a.resource_type || a.type || ''
          bVal = b.resource_type || b.type || ''
          break
        case 'location':
          aVal = a.location || ''
          bVal = b.location || ''
          break
        case 'criticality':
          aVal = metadata[aId]?.criticality || 'ZZZ'
          bVal = metadata[bId]?.criticality || 'ZZZ'
          break
        case 'dr_tier':
          aVal = metadata[aId]?.dr_tier || 'ZZZ'
          bVal = metadata[bId]?.dr_tier || 'ZZZ'
          break
        default:
          return 0
      }
      
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    
    return sorted
  }, [resources, metadata, sortField, sortDir, filterText, filterCriticality, filterDrTier, subFilter, rgFilter, locationFilter, typeFilter])

  // Subscription id → display name + the filter option lists (derived from the estate)
  const subName = (sid) => subNameMap[sid] || (sid ? (sid.length > 10 ? sid.slice(0, 8) + '…' : sid) : '—')
  const subscriptions = useMemo(() => {
    const s = new Set()
    for (const r of (resources || [])) { if (r.subscription_id) s.add(r.subscription_id) }
    return [...s].sort((a, b) => subName(a).localeCompare(subName(b)))
  }, [resources, subNameMap])
  const resourceGroups = useMemo(() => {
    const s = new Set()
    for (const r of (resources || [])) { const g = r.resource_group || r.resourceGroup; if (g) s.add(g) }
    return [...s].sort()
  }, [resources])
  const locations = useMemo(() => {
    const s = new Set()
    for (const r of (resources || [])) { if (r.location) s.add(r.location) }
    return [...s].sort()
  }, [resources])
  const types = useMemo(() => {
    const s = new Set()
    for (const r of (resources || [])) { const t = r.resource_type || r.type; if (t) s.add(t) }
    return [...s].sort()
  }, [resources])

  // How many of the 8 BCDR intake fields are filled for a resource's metadata.
  const intakeFilled = (meta) => BCDR_INTAKE_FIELDS.reduce((n, f) => n + (meta?.[f] ? 1 : 0), 0)

  // ── Columns: fixed BCDR fields + one column per user-created custom tag ──
  const tagColumns = useMemo(() => (tagSchema || []).map(t => ({
    key: `tag:${t.tag_key}`,
    label: t.display_name || t.tag_key,
    kind: 'tag',
    tagKey: t.tag_key,
    type: t.tag_type === 'enum' ? 'select' : (t.tag_type === 'bool' ? 'bool' : (t.tag_type === 'number' ? 'number' : 'text')),
    options: _opts(t.enum_values || []),
    color: t.color,
    category: t.category || 'Custom',
    w: 150,
  })), [tagSchema])
  const bcdrColumns = useMemo(() => BCDR_COLUMNS.map(c => ({ ...c, kind: 'bcdr' })), [])
  const allColumns = useMemo(() => [...bcdrColumns, ...tagColumns], [bcdrColumns, tagColumns])
  const dataColumns = useMemo(() => allColumns.filter(c => visibleCols.has(c.key)), [allColumns, visibleCols])
  const toggleCol = (key) => setVisibleCols(prev => {
    const n = new Set(prev)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  // Auto-reveal any custom-tag column that has at least one saved value, so tags applied
  // elsewhere (single or bulk) show up here on the next load without manual column picking.
  // Each column is auto-shown only once (tracked in localStorage) so a later manual hide sticks.
  useEffect(() => {
    if (!tagColumns.length) return
    const withData = new Set()
    for (const rid in (tagsByResource || {})) {
      const tv = tagsByResource[rid] || {}
      for (const k in tv) { if (tv[k] !== '' && tv[k] != null) withData.add(k) }
    }
    const toAdd = []
    for (const c of tagColumns) {
      if (withData.has(c.tagKey) && !autoShownTags.current.has(c.tagKey)) {
        autoShownTags.current.add(c.tagKey)
        toAdd.push(c.key)
      }
    }
    if (toAdd.length) {
      try { localStorage.setItem(AUTOSHOWN_TAGS_KEY, JSON.stringify([...autoShownTags.current])) } catch { /* ignore */ }
      setVisibleCols(prev => new Set([...prev, ...toAdd]))
    }
  }, [tagColumns, tagsByResource])

  // Pagination over the filtered rows (keeps the wide editable table responsive on large estates)
  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE))
  const pageRows = useMemo(() => processed.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [processed, page])
  useEffect(() => { if (page > totalPages - 1) setPage(0) }, [totalPages, page])

  // Coverage stats derived from the actual resource list + loaded metadata, so the header
  // is always correct regardless of the backend stats shape.
  const coverage = useMemo(() => {
    const list = Array.isArray(resources) ? resources.filter(r => r.resource_id || r.id) : []
    let categorized = 0, critical = 0, high = 0, tier01 = 0
    for (const r of list) {
      const m = metadata[r.resource_id || r.id] || {}
      if (m.criticality || m.dr_tier || m.rto_target || m.rpo_target || m.business_function) categorized++
      if (m.criticality === 'Critical') critical++
      if (m.criticality === 'High') high++
      if (m.dr_tier === 'Tier 0' || m.dr_tier === 'Tier 1') tier01++
    }
    const total = list.length
    return { total, categorized, pct: total ? Math.round((categorized / total) * 100) : 0, critical, high, tier01 }
  }, [resources, metadata])

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-blue-400 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with stats */}
      <div className="bg-gradient-to-br from-blue-950/30 to-purple-950/30 rounded-xl border border-blue-900/30 p-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">Phase 1: BCDR Planning & Categorization</h2>
            <p className="text-xs text-gray-400 max-w-2xl">
              Filter resources by subscription, resource group or type, pick the data fields and custom tags you
              want to capture from <span className="text-gray-300">Columns</span>, then fill them in — every value
              saves instantly (no Save button). This data grounds the AI BCDR analysis &amp; recommendations.
            </p>
          </div>
          {selectedIds.size > 0 && (
            <button
              onClick={() => setShowBulkEditor(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded flex items-center gap-2"
            >
              Bulk Edit ({selectedIds.size})
            </button>
          )}
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
              <p className="text-xs text-gray-400 mb-1">Total Resources</p>
              <p className="text-2xl font-bold text-white">{coverage.total}</p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
              <p className="text-xs text-gray-400 mb-1">Categorized</p>
              <p className="text-2xl font-bold text-blue-400">{coverage.categorized}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{coverage.pct}%</p>
            </div>
            <div className="bg-red-900/20 rounded-lg p-3 border border-red-900/30">
              <p className="text-xs text-gray-400 mb-1">Critical</p>
              <p className="text-2xl font-bold text-red-400">{coverage.critical}</p>
            </div>
            <div className="bg-orange-900/20 rounded-lg p-3 border border-orange-900/30">
              <p className="text-xs text-gray-400 mb-1">High</p>
              <p className="text-2xl font-bold text-orange-400">{coverage.high}</p>
            </div>
            <div className="bg-blue-900/20 rounded-lg p-3 border border-blue-900/30">
              <p className="text-xs text-gray-400 mb-1">Tier 0/1</p>
              <p className="text-2xl font-bold text-blue-400">{coverage.tier01}</p>
            </div>
          </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5 bg-gray-900/40 rounded-lg p-3 border border-gray-800">
        <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium pr-1">
          <SlidersHorizontal size={13} /> Filters
        </div>
        <input
          type="text"
          placeholder="Search resources..."
          value={filterText}
          onChange={(e) => { setFilterText(e.target.value); setPage(0) }}
          className="flex-1 min-w-[180px] bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-600"
        />
        <select
          value={subFilter}
          onChange={(e) => { setSubFilter(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-blue-700/50 rounded px-2.5 py-2 text-sm text-blue-100 max-w-[210px] focus:outline-none focus:border-blue-500"
          title={subFilter ? subName(subFilter) : 'All Subscriptions'}
        >
          <option value="">All Subscriptions</option>
          {subscriptions.map(sid => (<option key={sid} value={sid}>{subName(sid)}</option>))}
        </select>
        <select
          value={rgFilter}
          onChange={(e) => { setRgFilter(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded px-2.5 py-2 text-sm text-gray-200 max-w-[190px] focus:outline-none focus:border-blue-600"
        >
          <option value="">All Resource Groups</option>
          {resourceGroups.map(g => (<option key={g} value={g}>{g}</option>))}
        </select>
        <select
          value={locationFilter}
          onChange={(e) => { setLocationFilter(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded px-2.5 py-2 text-sm text-gray-200 max-w-[160px] focus:outline-none focus:border-blue-600"
        >
          <option value="">All Locations</option>
          {locations.map(l => (<option key={l} value={l}>{l}</option>))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded px-2.5 py-2 text-sm text-gray-200 max-w-[200px] focus:outline-none focus:border-blue-600"
        >
          <option value="">All Resource Types</option>
          {types.map(t => (<option key={t} value={t}>{t.split('/').pop()}</option>))}
        </select>
        <select
          value={filterCriticality}
          onChange={(e) => { setFilterCriticality(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded px-2.5 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
        >
          <option value="">All Criticality</option>
          {CRITICALITY_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={filterDrTier}
          onChange={(e) => { setFilterDrTier(e.target.value); setPage(0) }}
          className="bg-gray-800 border border-gray-700 rounded px-2.5 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
        >
          <option value="">All DR Tiers</option>
          {DR_TIER_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {(filterText || filterCriticality || filterDrTier || subFilter || rgFilter || locationFilter || typeFilter) && (
          <button
            onClick={() => {
              setFilterText(''); setFilterCriticality(''); setFilterDrTier('')
              setSubFilter(''); setRgFilter(''); setLocationFilter(''); setTypeFilter(''); setPage(0)
            }}
            className="text-xs text-blue-400 hover:text-blue-300 px-2"
          >
            Clear all
          </button>
        )}
        {/* Add / remove columns (data fields + custom tags) */}
        <div className="relative ml-auto" ref={colMenuRef}>
          <button
            onClick={() => setColMenuOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm text-gray-200 hover:border-blue-600 whitespace-nowrap"
            title="Add or remove columns — choose which data fields and custom tags to fill per resource"
          >
            <Columns3 size={14} /> Columns ({dataColumns.length})
          </button>
          {colMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-40 w-72 max-h-[420px] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-2">
              <p className="px-2 py-1 text-[11px] text-gray-500 uppercase tracking-wider">BCDR planning fields</p>
              {bcdrColumns.map(c => (
                <ColToggle key={c.key} col={c} checked={visibleCols.has(c.key)} onToggle={() => toggleCol(c.key)} />
              ))}
              {tagColumns.length > 0 && (
                <>
                  <div className="my-1 border-t border-gray-800" />
                  <p className="px-2 py-1 text-[11px] text-gray-500 uppercase tracking-wider">Your custom tags</p>
                  {tagColumns.map(c => (
                    <ColToggle key={c.key} col={c} checked={visibleCols.has(c.key)} onToggle={() => toggleCol(c.key)} />
                  ))}
                </>
              )}
              <div className="my-1 border-t border-gray-800" />
              <button
                onClick={() => setVisibleCols(new Set(BCDR_COLUMNS.filter(c => c.defaultVisible).map(c => c.key)))}
                className="w-full text-left px-2 py-1.5 text-xs text-blue-400 hover:bg-gray-800 rounded"
              >
                Reset to defaults
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === processed.length && processed.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="text-left px-3 py-3">
                  <button
                    onClick={() => toggleSort('name')}
                    className="font-medium text-gray-400 hover:text-gray-200 flex items-center gap-1"
                  >
                    Resource Name {sortField === 'name' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                </th>
                <th className="text-left px-3 py-3">
                  <button
                    onClick={() => toggleSort('type')}
                    className="font-medium text-gray-400 hover:text-gray-200 flex items-center gap-1"
                  >
                    Type {sortField === 'type' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                </th>
                <th className="text-left px-3 py-3">
                  <button
                    onClick={() => toggleSort('location')}
                    className="font-medium text-gray-400 hover:text-gray-200 flex items-center gap-1"
                  >
                    Location {sortField === 'location' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                </th>
                {dataColumns.map(col => (
                  <th key={col.key} className="text-left px-3 py-3 font-medium text-gray-400 whitespace-nowrap" style={{ minWidth: col.w || 130 }}>
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.kind === 'tag' && <span className="text-[9px] px-1 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-800/50">tag</span>}
                    </span>
                  </th>
                ))}
                <th className="text-left px-3 py-3 font-medium text-gray-400 whitespace-nowrap">Planning Inputs</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((resource) => {
                const resourceId = resource.resource_id || resource.id
                const meta = metadata[resourceId] || {}
                const isSaving = saving[resourceId]
                const isSelected = selectedIds.has(resourceId)
                
                return (
                  <tr key={resourceId} className={clsx(
                    'border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors',
                    isSelected && 'bg-blue-950/20'
                  )}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(resourceId)}
                        className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-blue-300 truncate max-w-xs">{resource.resource_name || resource.name}</span>
                        {isSaving && (
                          <div className="animate-spin h-3 w-3 border-2 border-blue-400 border-t-transparent rounded-full" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                        {(resource.resource_type || resource.type)?.split('/').pop()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {resource.location}
                    </td>
                    {dataColumns.map(col => (
                      <td key={col.key} className="px-3 py-2 align-top" style={{ minWidth: col.w || 130 }}>
                        <DataCell col={col} value={cellValue(col, resourceId)} onSave={(v) => saveCell(col, resourceId, v)} />
                        {col.key === 'criticality' && meta.criticality && <div className="mt-1"><BCDRBadge type="criticality" value={meta.criticality} /></div>}
                        {col.key === 'dr_tier' && meta.dr_tier && <div className="mt-1"><BCDRBadge type="dr_tier" value={meta.dr_tier} /></div>}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      {(() => {
                        const filled = intakeFilled(meta)
                        const att = attachCounts[(resourceId || '').toLowerCase()] || 0
                        return (
                          <button
                            onClick={() => setEditorResource(resource)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-800 hover:bg-blue-900/40 border border-gray-700 hover:border-blue-700/60 text-xs text-gray-300 transition-colors whitespace-nowrap"
                            title="Edit all BCDR planning fields and upload supporting inputs for this resource"
                          >
                            <SlidersHorizontal size={12} className="text-blue-400" />
                            {filled > 0 && <span className="text-blue-300">{filled}/8</span>}
                            {att > 0 && <span className="flex items-center gap-0.5 text-emerald-300"><Paperclip size={11} />{att}</span>}
                            {filled === 0 && att === 0 && <span className="text-gray-500">Add</span>}
                          </button>
                        )
                      })()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        
        {processed.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No resources found matching filters
          </div>
        )}
        
        <div className="px-4 py-3 bg-gray-900/50 border-t border-gray-800 flex items-center justify-between gap-3 text-xs text-gray-500">
          <div>
            Showing {processed.length === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, processed.length)} of {processed.length}
            {processed.length !== (resources?.length || 0) && <span className="text-gray-600"> (filtered from {resources?.length || 0})</span>}
            {selectedIds.size > 0 && <span className="ml-3 text-blue-400">• {selectedIds.size} selected</span>}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={13} /> Prev
              </button>
              <span className="text-gray-400">Page {page + 1} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bulk Editor Modal */}
      {showBulkEditor && (
        <BulkBCDREditor
          resources={processed.filter(r => selectedIds.has(r.resource_id || r.id))}
          onClose={() => setShowBulkEditor(false)}
          onSave={handleBulkSave}
        />
      )}

      {/* Per-resource BCDR editor — ALL Phase 1 fields + supporting-input uploads */}
      {editorResource && (
        <ResourceBCDREditor
          resource={editorResource}
          initial={metadata[editorResource.resource_id || editorResource.id] || {}}
          onClose={() => setEditorResource(null)}
          onSaved={(rid, form) => {
            setMetadata(prev => ({ ...prev, [rid]: { ...(prev[rid] || {}), ...form } }))
            loadMetadata(true)
            loadAttachmentCounts()
          }}
        />
      )}
    </div>
  )
}

// ── Customer intake + report generation modal ─────────────────────────────────
const intakeInput = 'w-full px-3 py-2 rounded-lg bg-gray-950/60 border border-gray-700/60 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600'

function IntakeField({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

export function CustomerIntakeModal({ customerInfo, onChange, onClose, onGenerate, busy, error, coverage }) {
  const [ci, setCi] = useState(customerInfo || {})
  const set = (k, v) => setCi(prev => { const next = { ...prev, [k]: v }; onChange(next); return next })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative w-[96vw] max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2"><FileText size={16} className="text-blue-400" /> Generate Consultant BCDR Report</h3>
            <p className="text-xs text-gray-500 mt-0.5">A full 13-section assessment, grounded on your Azure estate + Phase 1 classification + AI.</p>
          </div>
          <button onClick={onClose} disabled={!!busy} className="text-gray-500 hover:text-gray-300 disabled:opacity-40"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {coverage && coverage.categorized === 0 && (
            <div className="text-xs text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
              No resources are categorized yet. The report will be grounded on Azure posture only — categorize key workloads (criticality, RTO/RPO, target region, financial loss) below in the table for a richer, customer-specific report.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <IntakeField label="Customer name"><input className={intakeInput} value={ci.customer_name || ''} onChange={e => set('customer_name', e.target.value)} placeholder="e.g. Contoso Ltd" /></IntakeField>
            <IntakeField label="Prepared by"><input className={intakeInput} value={ci.prepared_by || ''} onChange={e => set('prepared_by', e.target.value)} placeholder="e.g. your name / partner" /></IntakeField>
            <IntakeField label="Assessment period"><input className={intakeInput} value={ci.assessment_period || ''} onChange={e => set('assessment_period', e.target.value)} placeholder="e.g. June 2026" /></IntakeField>
            <IntakeField label="Report version"><input className={intakeInput} value={ci.report_version || ''} onChange={e => set('report_version', e.target.value)} placeholder="1.0" /></IntakeField>
          </div>
          <IntakeField label="Business drivers"><textarea rows={2} className={intakeInput} value={ci.business_drivers || ''} onChange={e => set('business_drivers', e.target.value)} placeholder="e.g. Meet 1-hour RTO for ERP, pass ISO 27001 audit, reduce downtime and data-loss risk" /></IntakeField>
          <IntakeField label="Region strategy (primary / secondary)"><input className={intakeInput} value={ci.region_strategy || ''} onChange={e => set('region_strategy', e.target.value)} placeholder="e.g. Primary West Europe, secondary North Europe (paired-region failover)" /></IntakeField>
          <IntakeField label="Regulatory / compliance & data residency"><input className={intakeInput} value={ci.compliance || ''} onChange={e => set('compliance', e.target.value)} placeholder="e.g. ISO 27001, GDPR, PCI-DSS; data must stay in EU" /></IntakeField>
          {busy && <div className="text-xs text-blue-300 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Generating the consultant report with AI… this can take 30–60 seconds.</div>}
          {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">{error}</div>}
        </div>
        <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} disabled={!!busy} className="px-4 py-2 rounded-lg text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-40">Cancel</button>
          <button onClick={() => onGenerate('xlsx')} disabled={!!busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50">
            {busy === 'xlsx' ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />} Generate Excel
          </button>
          <button onClick={() => onGenerate('pdf')} disabled={!!busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
            {busy === 'pdf' ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Generate PDF
          </button>
        </div>
      </div>
    </div>
  )
}
