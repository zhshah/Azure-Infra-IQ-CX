/**
 * AdvancedFilterBar — Enterprise-class shared filter bar for all FinOps views.
 *
 * Rebuilt with Azure Portal-style searchable dropdowns, live tag picker,
 * and consistent enterprise dark theme.
 *
 * Features:
 * - Subscription, Resource Group, Region, Resource Type, Service Family multi-selects (searchable)
 * - Live Azure tag key+value picker (from backend /api/tags/keys & /api/tags/values)
 * - Resource Name text search
 * - Environment tag quick-filter (searchable select)
 * - Cost Min/Max range
 * - Active filter pills with individual ✕ dismiss
 * - Save/Load preset → localStorage
 * - Collapsible toggle
 * - Clear All
 */
import React, { useState, useEffect, useRef } from 'react'
import { Filter, X, Plus, ChevronDown, ChevronUp, Save, FolderOpen, Trash2, Search, Tag } from 'lucide-react'
import SearchableMultiSelect from '../components/shared/SearchableMultiSelect'
import SearchableSelect from '../components/shared/SearchableSelect'

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRESET_STORAGE_KEY = 'finops_filter_presets_v1'

function loadPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function savePresets(presets) {
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets))
}

// ── Filter pill ───────────────────────────────────────────────────────────────

function FilterPill({ label, onRemove, color = '#0078d4' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
      background: `${color}12`, border: `1px solid ${color}30`, color,
    }}>
      {label}
      <button onClick={onRemove} style={{ background: 'none', border: 'none', color: `${color}90`, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}>
        <X size={10} />
      </button>
    </span>
  )
}

// ── Tag row with live values ──────────────────────────────────────────────────

function TagRow({ tag, index, tagKeyOptions, onUpdate, onRemove }) {
  const [values, setValues] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!tag.key) { setValues([]); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/tags/values/${encodeURIComponent(tag.key)}`)
      .then(r => r.ok ? r.json() : { values: [] })
      .then(data => { if (!cancelled) setValues(data.values || []) })
      .catch(() => { if (!cancelled) setValues([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tag.key])

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 6 }}>
      <div style={{ flex: 2, minWidth: 0 }}>
        <SearchableSelect
          value={tag.key}
          onChange={v => onUpdate(index, 'key', v)}
          options={tagKeyOptions}
          placeholder="Select tag key…"
          searchPlaceholder="Search keys…"
          compact
        />
      </div>
      <span style={{ color: 'var(--c-475569)', fontSize: 13, fontWeight: 600, paddingBottom: 8 }}>=</span>
      <div style={{ flex: 3, minWidth: 0 }}>
        <SearchableSelect
          value={tag.value}
          onChange={v => onUpdate(index, 'value', v)}
          options={values.map(v => ({ value: v, label: v }))}
          placeholder={loading ? 'Loading…' : tag.key ? 'Select value…' : 'Pick key first'}
          searchPlaceholder="Search values…"
          disabled={!tag.key || loading}
          compact
        />
      </div>
      <button
        onClick={() => onRemove(index)}
        style={{
          background: 'none', border: 'none', color: 'var(--c-475569)', cursor: 'pointer',
          padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0, marginBottom: 4,
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--c-475569)'}
      >
        <X size={14} />
      </button>
    </div>
  )
}

// ── Default empty filter state ───────────────────────────────────────────────

export const EMPTY_FILTERS = {
  subscriptions: [],
  resource_groups: [],
  regions: [],
  resource_types: [],
  service_families: [],
  tags: [],              // [{ key: '', value: '' }]
  resource_name: '',
  environment: '',
  cost_min: '',
  cost_max: '',
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdvancedFilterBar({ filters = EMPTY_FILTERS, onChange, filterOptions = {}, collapsed: initialCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [pending, setPending] = useState(filters)   // editing state — not live until Apply
  const [presetName, setPresetName] = useState('')
  const [presets, setPresets] = useState(loadPresets)
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [showPresetMenu, setShowPresetMenu] = useState(false)
  const [liveTagKeys, setLiveTagKeys] = useState([])
  const presetMenuRef = useRef(null)

  // Sync when external filters prop changes (e.g. preset load from parent)
  useEffect(() => { setPending(filters) }, [filters])

  // Close preset menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target)) setShowPresetMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fetch live tag keys for tag picker
  useEffect(() => {
    fetch('/api/tags/keys')
      .then(r => r.ok ? r.json() : { tag_keys: [] })
      .then(data => setLiveTagKeys(data.tag_keys || []))
      .catch(() => {
        // Fallback to filter-options tag keys
        setLiveTagKeys(filterOptions.available_tag_keys || [])
      })
  }, [])

  const update = (key, value) => setPending(p => ({ ...p, [key]: value }))

  const applyFilters = () => onChange({ ...pending })

  const addTagRow = () => update('tags', [...(pending.tags || []), { key: '', value: '' }])
  const removeTagRow = (i) => update('tags', (pending.tags || []).filter((_, idx) => idx !== i))
  const updateTag = (i, field, value) => {
    const updated = (pending.tags || []).map((t, idx) => idx === i ? { ...t, [field]: value } : t)
    update('tags', updated)
  }

  const clearAll = () => { setPending({ ...EMPTY_FILTERS }); onChange({ ...EMPTY_FILTERS }) }

  const savePreset = () => {
    if (!presetName.trim()) return
    const updated = { ...presets, [presetName.trim()]: filters }
    setPresets(updated)
    savePresets(updated)
    setPresetName('')
    setShowSaveInput(false)
  }

  const loadPreset = (name) => {
    if (presets[name]) { const p = { ...EMPTY_FILTERS, ...presets[name] }; setPending(p); onChange(p) }
    setShowPresetMenu(false)
  }

  const deletePreset = (name) => {
    const updated = { ...presets }
    delete updated[name]
    setPresets(updated)
    savePresets(updated)
  }

  // Count active filters (based on the applied filters passed as prop)
  const activeCount = [
    (filters.subscriptions || []).length,
    (filters.resource_groups || []).length,
    (filters.regions || []).length,
    (filters.resource_types || []).length,
    (filters.service_families || []).length,
    (filters.tags || []).filter(t => t.key).length,
    filters.resource_name ? 1 : 0,
    filters.environment ? 1 : 0,
    filters.cost_min ? 1 : 0,
    filters.cost_max ? 1 : 0,
  ].reduce((s, n) => s + n, 0)

  // Check if pending differs from applied
  const hasPendingChanges = JSON.stringify(pending) !== JSON.stringify(filters)

  // Build active filter pills (from *applied* filters for accuracy)
  const pills = []
  ;(filters.subscriptions || []).forEach(v => pills.push({ label: `Sub: ${v.slice(0, 8)}…`, clear: () => update('subscriptions', filters.subscriptions.filter(x => x !== v)), color: '#0078d4' }))
  ;(filters.resource_groups || []).forEach(v => pills.push({ label: `RG: ${v}`, clear: () => update('resource_groups', filters.resource_groups.filter(x => x !== v)), color: '#22c55e' }))
  ;(filters.regions || []).forEach(v => pills.push({ label: `Region: ${v}`, clear: () => update('regions', filters.regions.filter(x => x !== v)), color: '#06b6d4' }))
  ;(filters.resource_types || []).forEach(v => pills.push({ label: `Type: ${v.split('/').pop()}`, clear: () => update('resource_types', filters.resource_types.filter(x => x !== v)), color: '#f97316' }))
  ;(filters.service_families || []).forEach(v => pills.push({ label: `Family: ${v}`, clear: () => update('service_families', filters.service_families.filter(x => x !== v)), color: '#eab308' }))
  ;(filters.tags || []).filter(t => t.key).forEach((t, i) => pills.push({ label: `${t.key}${t.value ? '=' + t.value : ''}`, clear: () => removeTagRow(i), color: '#a855f7' }))
  if (filters.resource_name) pills.push({ label: `Name: ${filters.resource_name}`, clear: () => update('resource_name', ''), color: '#0078d4' })
  if (filters.environment) pills.push({ label: `Env: ${filters.environment}`, clear: () => update('environment', ''), color: '#10b981' })
  if (filters.cost_min) pills.push({ label: `Cost ≥ $${filters.cost_min}`, clear: () => update('cost_min', ''), color: '#f59e0b' })
  if (filters.cost_max) pills.push({ label: `Cost ≤ $${filters.cost_max}`, clear: () => update('cost_max', ''), color: '#f59e0b' })

  // Build options arrays — use pending state in selects, not applied filters
  const subs = (filterOptions.subscriptions || []).map(s =>
    typeof s === 'string' ? { value: s, label: s.slice(0, 8) + '…' } : { value: s.id || s.value, label: s.name || s.label, description: s.count != null ? `${s.count} resources` : undefined }
  )
  const rgs = (filterOptions.resource_groups || []).map(rg =>
    typeof rg === 'string' ? { value: rg, label: rg } : { value: rg.value || rg, label: rg.label || rg.value || rg, count: rg.count }
  )
  const regions = (filterOptions.regions || []).map(r =>
    typeof r === 'string' ? { value: r, label: r } : { value: r.value || r, label: r.label || r.value || r, count: r.count }
  )
  const rtypes = (filterOptions.resource_types || []).map(t =>
    typeof t === 'string' ? { value: t, label: t.split('/').pop() } : { value: t.value || t, label: t.label || (t.value || t).split('/').pop(), count: t.count }
  )
  const families = (filterOptions.service_families || []).map(f =>
    typeof f === 'string' ? { value: f, label: f } : { value: f.value || f, label: f.label || f.value || f }
  )
  const tagKeyOptions = (liveTagKeys.length > 0 ? liveTagKeys : (filterOptions.available_tag_keys || []))
    .map(k => ({ value: k, label: k }))

  const envOptions = ['Production', 'Staging', 'Development', 'Test', 'QA', 'DR', 'Sandbox']
    .map(e => ({ value: e, label: e }))

  return (
    <div style={{ background: 'var(--c-111827)', border: '1px solid rgba(var(--rgb-slate), 0.7)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: collapsed ? 'none' : '1px solid rgba(var(--rgb-slate), 0.5)',
      }}>
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'none', border: 'none', color: 'var(--c-94a3b8)',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}
        >
          <Filter size={14} style={{ color: '#0078d4' }} />
          Filters
          {activeCount > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 18, height: 18, borderRadius: 9,
              background: '#0078d4', color: '#fff', fontSize: 10, fontWeight: 700,
            }}>
              {activeCount}
            </span>
          )}
          {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Preset management */}
          <div ref={presetMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowPresetMenu(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 500,
                background: 'transparent', border: '1px solid var(--c-1e293b)',
                color: 'var(--c-94a3b8)', cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <FolderOpen size={12} /> Presets
            </button>
            {showPresetMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, zIndex: 300,
                background: 'var(--c-111827)', border: '1px solid rgba(var(--rgb-slate), 0.7)',
                borderRadius: 8, minWidth: 200,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)', marginTop: 4,
                animation: 'dropdown-in 0.15s ease-out',
              }}>
                {Object.keys(presets).length === 0 && (
                  <div style={{ padding: '10px 14px', color: 'var(--c-475569)', fontSize: 12 }}>No saved presets</div>
                )}
                {Object.keys(presets).map(name => (
                  <div key={name} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(var(--rgb-slate), 0.3)',
                  }}>
                    <span onClick={() => loadPreset(name)} style={{ color: '#0078d4', fontSize: 12, flex: 1, cursor: 'pointer' }}>{name}</span>
                    <button onClick={() => deletePreset(name)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 2, display: 'flex' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid rgba(var(--rgb-slate), 0.5)', padding: '8px 14px' }}>
                  {showSaveInput ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text" value={presetName} onChange={e => setPresetName(e.target.value)}
                        placeholder="Preset name…"
                        onKeyDown={e => { if (e.key === 'Enter') savePreset() }}
                        style={{
                          flex: 1, background: 'var(--c-0c1220)', border: '1px solid var(--c-1e293b)',
                          borderRadius: 6, color: 'var(--c-e2e8f0)', padding: '5px 10px', fontSize: 12,
                        }}
                        autoFocus
                      />
                      <button onClick={savePreset} style={{
                        background: '#0078d4', border: 'none', borderRadius: 6,
                        color: '#fff', padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      }}>Save</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowSaveInput(true)}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: '#0078d4', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}
                    >
                      <Save size={12} /> Save current filters
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {activeCount > 0 && (
            <button
              onClick={clearAll}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 500,
                background: 'transparent', border: '1px solid rgba(239, 68, 68, 0.3)',
                color: 'var(--c-f87171)', cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <X size={12} /> Clear All
            </button>
          )}
          {/* Apply Filters button — only shown when pending != applied */}
          {hasPendingChanges && (
            <button
              onClick={applyFilters}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 14px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                background: '#0078d4', border: 'none',
                color: '#fff', cursor: 'pointer', transition: 'all 0.15s',
                boxShadow: '0 0 0 2px rgba(0,120,212,0.3)',
              }}
            >
              Apply Filters
            </button>
          )}
        </div>
      </div>

      {/* Active filter pills */}
      {pills.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
          padding: '8px 16px',
          borderBottom: collapsed ? 'none' : '1px solid rgba(var(--rgb-slate), 0.4)',
        }}>
          {pills.map((p, i) => <FilterPill key={i} label={p.label} onRemove={p.clear} color={p.color} />)}
        </div>
      )}

      {/* Expanded filter form */}
      {!collapsed && (
        <div style={{ padding: '14px 16px' }}>
          {/* Row 1: main multi-selects */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            {subs.length > 0 && (
              <SearchableMultiSelect
                label="Subscription"
                options={subs}
                selected={pending.subscriptions || []}
                onChange={v => update('subscriptions', v)}
                placeholder="All Subscriptions"
                searchPlaceholder="Search subscriptions…"
                compact
              />
            )}
            {rgs.length > 0 && (
              <SearchableMultiSelect
                label="Resource Group"
                options={rgs}
                selected={pending.resource_groups || []}
                onChange={v => update('resource_groups', v)}
                placeholder="All Resource Groups"
                searchPlaceholder="Search resource groups…"
                compact
              />
            )}
            {regions.length > 0 && (
              <SearchableMultiSelect
                label="Region"
                options={regions}
                selected={pending.regions || []}
                onChange={v => update('regions', v)}
                placeholder="All Regions"
                searchPlaceholder="Search regions…"
                compact
              />
            )}
            {rtypes.length > 0 && (
              <SearchableMultiSelect
                label="Resource Type"
                options={rtypes}
                selected={pending.resource_types || []}
                onChange={v => update('resource_types', v)}
                placeholder="All Types"
                searchPlaceholder="Search resource types…"
                compact
              />
            )}
            {families.length > 0 && (
              <SearchableMultiSelect
                label="Service Family"
                options={families}
                selected={pending.service_families || []}
                onChange={v => update('service_families', v)}
                placeholder="All Service Families"
                searchPlaceholder="Search families…"
                compact
              />
            )}
          </div>

          {/* Row 2: text search + environment + cost range */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Resource Name</label>
              <div style={{ position: 'relative' }}>
                <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-475569)', pointerEvents: 'none' }} />
                <input
                  type="text" value={pending.resource_name || ''}
                  onChange={e => update('resource_name', e.target.value)}
                  placeholder="Search by name…"
                  style={{
                    width: '100%', background: 'var(--c-0c1220)', border: '1px solid var(--c-1e293b)',
                    borderRadius: 7, color: 'var(--c-e2e8f0)', padding: '7px 10px 7px 28px',
                    fontSize: 12, boxSizing: 'border-box', outline: 'none',
                  }}
                />
              </div>
            </div>
            <SearchableSelect
              label="Environment"
              value={pending.environment || ''}
              onChange={v => update('environment', v)}
              options={envOptions}
              placeholder="All Environments"
              compact
            />
            <div>
              <label style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Cost Min ($)</label>
              <input
                type="number" min="0" value={pending.cost_min || ''}
                onChange={e => update('cost_min', e.target.value)}
                placeholder="0"
                style={{
                  width: '100%', background: 'var(--c-0c1220)', border: '1px solid var(--c-1e293b)',
                  borderRadius: 7, color: 'var(--c-e2e8f0)', padding: '7px 10px',
                  fontSize: 12, boxSizing: 'border-box', outline: 'none',
                }}
              />
            </div>
            <div>
              <label style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>Cost Max ($)</label>
              <input
                type="number" min="0" value={pending.cost_max || ''}
                onChange={e => update('cost_max', e.target.value)}
                placeholder="No limit"
                style={{
                  width: '100%', background: 'var(--c-0c1220)', border: '1px solid var(--c-1e293b)',
                  borderRadius: 7, color: 'var(--c-e2e8f0)', padding: '7px 10px',
                  fontSize: 12, boxSizing: 'border-box', outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Row 3: Tag key=value dynamic rows with live autocomplete */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Tag size={13} style={{ color: '#a855f7' }} />
              <label style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tag Filters</label>
              <button
                onClick={addTagRow}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'transparent', border: '1px solid rgba(168, 85, 247, 0.3)',
                  borderRadius: 6, color: '#a855f7', cursor: 'pointer',
                  padding: '3px 10px', fontSize: 11, fontWeight: 500,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(168, 85, 247, 0.1)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <Plus size={11} /> Add Tag
              </button>
            </div>
            {(pending.tags || []).map((tag, i) => (
              <TagRow
                key={i}
                tag={tag}
                index={i}
                tagKeyOptions={tagKeyOptions}
                onUpdate={updateTag}
                onRemove={removeTagRow}
              />
            ))}
            {(pending.tags || []).length === 0 && (
              <div style={{ color: 'var(--c-475569)', fontSize: 11, fontStyle: 'italic', paddingLeft: 23 }}>
                No tag filters active — click "Add Tag" to filter by Azure resource tags
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
