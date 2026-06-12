import React, { useMemo, useState, useEffect, useCallback } from 'react'
import { Layers, FolderOpen, ChevronDown, MapPin, Tag, Box, X, Filter, FolderPlus } from 'lucide-react'
import SearchableSelect from './shared/SearchableSelect'
import SearchableMultiSelect from './shared/SearchableMultiSelect'

// ── Active filter chip ─────────────────────────────────────────────────────────
function Chip({ label, onRemove, color = '#0078d4' }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
        background: `${color}12`, border: `1px solid ${color}30`, color: `${color}`,
      }}
    >
      {label}
      <button
        onClick={onRemove}
        style={{
          background: 'none', border: 'none', color: `${color}90`,
          cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center',
          marginLeft: 2,
        }}
      >
        <X size={10} />
      </button>
    </span>
  )
}

// ── Sub badge (single subscription, display only) ─────────────────────────────
function SubBadge({ sub }) {
  const name = sub.subscription_name || null
  const shortId = sub.subscription_id
    ? `${sub.subscription_id.slice(0, 8)}…${sub.subscription_id.slice(-4)}`
    : ''
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 12px', borderRadius: 8,
        background: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(30, 41, 59, 0.6)',
      }}
    >
      <Layers size={14} style={{ color: '#0078d4', flexShrink: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
        {name
          ? <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{name}</span>
          : <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', fontFamily: 'monospace' }}>{shortId}</span>
        }
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
          {name && <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>{shortId}</span>}
          {name && <span style={{ color: '#334155' }}>·</span>}
          <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 500 }}>${sub.cost_current?.toFixed(2)}/mo</span>
          <span style={{ color: '#334155' }}>·</span>
          <span style={{ fontSize: 10, color: '#64748b' }}>{sub.resource_count} resources</span>
        </div>
      </div>
    </div>
  )
}

export default function FilterBar({
  subscriptions = [],
  resourceGroups = [],
  resources = [],
  selectedSubscription,
  selectedResourceGroup,
  selectedLocation,
  selectedResourceType,
  selectedTagKey,
  selectedTagValue,
  onSubscriptionChange,
  onResourceGroupChange,
  onLocationChange,
  onResourceTypeChange,
  onTagKeyChange,
  onTagValueChange,
  filteredCount,
  totalCount,
  onSaveProject,
  activeProjectName,
}) {
  const [expanded, setExpanded] = useState(false)
  const [tagValues, setTagValues] = useState([])
  const [mgGroups, setMgGroups] = useState([])

  // Fetch the management-group hierarchy so the scope picker can show MGs (selecting one scopes
  // to every subscription under it). Degrades silently to a flat subscription list if MG data is
  // unavailable (e.g. no Management Group Reader).
  useEffect(() => {
    let cancelled = false
    fetch('/api/management-groups')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d && Array.isArray(d.management_groups)) setMgGroups(d.management_groups) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Fetch tag values when tag key changes
  useEffect(() => {
    if (!selectedTagKey) {
      setTagValues([])
      return
    }
    let cancelled = false
    fetch(`/api/tags/values/${encodeURIComponent(selectedTagKey)}`)
      .then(r => r.ok ? r.json() : { values: [] })
      .then(data => {
        if (!cancelled) setTagValues(data.values || [])
      })
      .catch(() => {
        // Fallback: derive from resources
        if (!cancelled) {
          const vals = new Set()
          for (const r of resources) {
            const v = (r.tags || {})[selectedTagKey]
            if (v != null) vals.add(String(v))
          }
          setTagValues([...vals].sort())
        }
      })
    return () => { cancelled = true }
  }, [selectedTagKey, resources])

  // Derive filter options from resource data
  const { locations, resourceTypes, tagKeys } = useMemo(() => {
    const locs  = [...new Set(resources.map(r => r.location).filter(Boolean))].sort()
    const types = [...new Set(resources.map(r => r.resource_type).filter(Boolean))].sort()
    const allTags = {}
    for (const r of resources) {
      for (const [k, v] of Object.entries(r.tags || {})) {
        if (!allTags[k]) allTags[k] = new Set()
        allTags[k].add(v)
      }
    }
    const tKeys = Object.keys(allTags).sort()
    return { locations: locs, resourceTypes: types, tagKeys: tKeys }
  }, [resources])

  // Count resources per filter dimension
  const { rgCounts, locCounts, typeCounts } = useMemo(() => {
    const rg = {}, loc = {}, tp = {}
    for (const r of resources) {
      if (r.resource_group) rg[r.resource_group] = (rg[r.resource_group] || 0) + 1
      if (r.location) loc[r.location] = (loc[r.location] || 0) + 1
      if (r.resource_type) tp[r.resource_type] = (tp[r.resource_type] || 0) + 1
    }
    return { rgCounts: rg, locCounts: loc, typeCounts: tp }
  }, [resources])

  const rgOptions = resourceGroups.map(rg => ({ value: rg, label: rg, count: rgCounts[rg] || 0 }))
  const locOptions = locations.map(l => ({ value: l, label: l, count: locCounts[l] || 0 }))
  const typeOptions = resourceTypes.map(t => {
    const parts = t.split('/')
    const label = parts[parts.length - 1]
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, s => s.toUpperCase())
    return { value: t, label, count: typeCounts[t] || 0 }
  })

  const subOptions = [
    { value: '', label: `All ${subscriptions.length} subscriptions`, description: 'Show every accessible subscription' },
    ...mgGroups.map(mg => {
      const ids = mg.subscription_ids || []
      return {
        value: ids.length ? ids.join(',') : `mg:${mg.id}`,
        label: mg.name,
        group: 'Management Groups',
        level: mg.level || 0,
        disabled: ids.length === 0,
        description: ids.length
          ? `${ids.length} subscription${ids.length === 1 ? '' : 's'}`
          : 'No accessible subscriptions',
      }
    }),
    ...subscriptions.map(s => ({
      value: s.subscription_id,
      label: s.subscription_name || s.subscription_id.slice(0, 8) + '\u2026',
      group: 'Subscriptions',
      description: `$${s.cost_current?.toFixed(0)}/mo · ${s.resource_count} resources`,
    })),
  ]

  const tagKeyOptions = tagKeys.map(k => ({ value: k, label: k }))
  const tagValueOptions = tagValues.map(v => ({ value: v, label: v }))

  const hasAnyFilter = selectedSubscription || selectedResourceGroup || selectedLocation || selectedResourceType || selectedTagKey

  if (!subscriptions.length && !resourceGroups.length && !resources.length) return null

  return (
    <div style={{ borderBottom: '1px solid rgba(30, 41, 59, 0.5)', background: 'rgba(12, 18, 32, 0.6)' }}>
      {/* Primary filter row */}
      <div style={{ padding: '8px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
            <Filter size={11} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
            Scope
          </span>

          {/* Subscription */}
          {subscriptions.length === 1 && <SubBadge sub={subscriptions[0]} />}
          {subscriptions.length > 1 && (
            <div style={{ width: 200 }}>
              <SearchableSelect
                value={selectedSubscription || ''}
                onChange={onSubscriptionChange}
                options={subOptions}
                placeholder={`All ${subscriptions.length} subscriptions`}
                searchPlaceholder="Search subscriptions…"
                compact
              />
            </div>
          )}

          {/* Resource Group */}
          {rgOptions.length > 0 && (
            <div style={{ width: 190 }}>
              <SearchableSelect
                value={selectedResourceGroup || ''}
                onChange={onResourceGroupChange}
                options={rgOptions}
                placeholder="All resource groups"
                searchPlaceholder="Search resource groups…"
                compact
              />
            </div>
          )}

          {/* Location */}
          {locOptions.length > 0 && (
            <div style={{ width: 160 }}>
              <SearchableSelect
                value={selectedLocation || ''}
                onChange={onLocationChange}
                options={locOptions}
                placeholder="All locations"
                searchPlaceholder="Search locations…"
                compact
              />
            </div>
          )}

          {/* Resource Type */}
          {typeOptions.length > 0 && (
            <div style={{ width: 180 }}>
              <SearchableSelect
                value={selectedResourceType || ''}
                onChange={onResourceTypeChange}
                options={typeOptions}
                placeholder="All resource types"
                searchPlaceholder="Search types…"
                compact
              />
            </div>
          )}

          {/* Tag filter toggle */}
          {tagKeys.length > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                background: expanded || selectedTagKey ? 'rgba(168, 85, 247, 0.1)' : 'transparent',
                border: `1px solid ${expanded || selectedTagKey ? 'rgba(168, 85, 247, 0.3)' : '#1e293b'}`,
                color: expanded || selectedTagKey ? '#c084fc' : '#64748b',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <Tag size={12} />
              Tags
              {selectedTagKey && (
                <span style={{ fontSize: 10, opacity: 0.8 }}>
                  ({selectedTagKey}{selectedTagValue ? `=${selectedTagValue}` : ''})
                </span>
              )}
            </button>
          )}

          {/* Clear all */}
          {hasAnyFilter && (
            <button
              onClick={() => {
                onSubscriptionChange?.('')
                onResourceGroupChange?.('')
                onLocationChange?.('')
                onResourceTypeChange?.('')
                onTagKeyChange?.('')
                onTagValueChange?.('')
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'none', border: 'none', color: '#64748b',
                cursor: 'pointer', fontSize: 11, transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
            >
              <X size={12} /> Clear
            </button>
          )}

          {/* Resource count + Save as Project */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#64748b', flexShrink: 0 }}>
            {hasAnyFilter && filteredCount !== undefined && totalCount !== undefined && (
              <span style={{ color: '#0078d4', fontWeight: 600 }}>
                {filteredCount} of {totalCount} resources
              </span>
            )}
            {!hasAnyFilter && subscriptions.length > 1 && (
              <span>
                {subscriptions.reduce((s, x) => s + x.resource_count, 0)} resources ·{' '}
                <span style={{ color: '#94a3b8' }}>
                  ${subscriptions.reduce((s, x) => s + x.cost_current, 0).toFixed(2)}/mo
                </span>
              </span>
            )}
            {onSaveProject && filteredCount > 0 && (
              <button
                onClick={onSaveProject}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 12px', borderRadius: 7,
                  border: '1px solid rgba(0, 120, 212, 0.3)',
                  background: 'rgba(0, 120, 212, 0.08)',
                  color: '#0078d4', fontSize: 11, fontWeight: 500,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
                title={`Save these ${filteredCount} resources as a project`}
              >
                <FolderPlus size={12} />
                Save as Project
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tag filter row (expanded) — now with searchable dropdowns */}
      {expanded && tagKeys.length > 0 && (
        <div style={{ padding: '8px 24px 12px', borderTop: '1px solid rgba(30, 41, 59, 0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, maxWidth: 600 }}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <SearchableSelect
                label="Tag Key"
                value={selectedTagKey || ''}
                onChange={v => { onTagKeyChange(v); onTagValueChange('') }}
                options={tagKeyOptions}
                placeholder="Select tag key…"
                searchPlaceholder="Search tag keys…"
                compact
              />
            </div>
            <span style={{ color: '#475569', fontSize: 14, fontWeight: 600, paddingBottom: 8 }}>=</span>
            <div style={{ flex: 3, minWidth: 0 }}>
              <SearchableSelect
                label="Tag Value"
                value={selectedTagValue || ''}
                onChange={onTagValueChange}
                options={tagValueOptions}
                placeholder={selectedTagKey ? 'Select value…' : 'Select key first'}
                searchPlaceholder="Search tag values…"
                disabled={!selectedTagKey}
                compact
              />
            </div>
          </div>
        </div>
      )}

      {/* Active filter chips */}
      {hasAnyFilter && (
        <div style={{ padding: '0 24px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {selectedSubscription && (
              <Chip
                label={subscriptions.find(s => s.subscription_id === selectedSubscription)?.subscription_name || selectedSubscription.slice(0, 8)}
                onRemove={() => onSubscriptionChange('')}
              />
            )}
            {selectedResourceGroup && (
              <Chip label={selectedResourceGroup} onRemove={() => onResourceGroupChange('')} color="#22c55e" />
            )}
            {selectedLocation && (
              <Chip label={selectedLocation} onRemove={() => onLocationChange('')} color="#06b6d4" />
            )}
            {selectedResourceType && (
              <Chip
                label={selectedResourceType.split('/').pop()}
                onRemove={() => onResourceTypeChange('')}
                color="#f97316"
              />
            )}
            {selectedTagKey && (
              <Chip
                label={`${selectedTagKey}${selectedTagValue ? `=${selectedTagValue}` : ''}`}
                onRemove={() => { onTagKeyChange(''); onTagValueChange('') }}
                color="#a855f7"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
