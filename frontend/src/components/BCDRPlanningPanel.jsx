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
import React, { useState, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { api } from '../api/client'
import { BCDRBadge, BulkBCDREditor, CRITICALITY_OPTIONS, DR_TIER_OPTIONS, RTO_OPTIONS, RPO_OPTIONS } from './BCDRMetadataEditor'

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
  const [stats, setStats] = useState(null)

  // Load all BCDR metadata on mount
  useEffect(() => {
    loadMetadata()
  }, [])

  const loadMetadata = async () => {
    setLoading(true)
    try {
      const [allMeta, statsData] = await Promise.all([
        api.getBCDRMetadataAll(),
        api.getBCDRMetadataStats()
      ])
      setMetadata(allMeta || {})
      setStats(statsData)
    } catch (err) {
      console.error('Failed to load BCDR metadata:', err)
    } finally {
      setLoading(false)
    }
  }

  const saveField = async (resourceId, field, value) => {
    const current = metadata[resourceId] || {}
    const updated = { ...current, [field]: value }
    
    setSaving(prev => ({ ...prev, [resourceId]: true }))
    
    try {
      await api.saveBCDRMetadata(resourceId, updated)
      setMetadata(prev => ({ ...prev, [resourceId]: updated }))
      await loadMetadata() // Refresh stats
    } catch (err) {
      console.error('Failed to save BCDR metadata:', err)
      alert(`Failed to save: ${err.message}`)
    } finally {
      setSaving(prev => ({ ...prev, [resourceId]: false }))
    }
  }

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
      }
    }
    setMetadata(prev => ({ ...prev, ...updateMap }))
    setSelectedIds(new Set())
    await loadMetadata() // Refresh stats
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
        r.name?.toLowerCase().includes(lower) ||
        r.type?.toLowerCase().includes(lower) ||
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
    
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      const aId = a.resource_id || a.id
      const bId = b.resource_id || b.id
      let aVal, bVal
      
      switch (sortField) {
        case 'name':
          aVal = a.name || ''
          bVal = b.name || ''
          break
        case 'type':
          aVal = a.type || ''
          bVal = b.type || ''
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
  }, [resources, metadata, sortField, sortDir, filterText, filterCriticality, filterDrTier])

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
              Categorize your resources with criticality, DR tier, RTO/RPO targets, and business functions. 
              This metadata will be used by AI to generate deep BCDR analysis and recommendations.
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
        
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
              <p className="text-xs text-gray-400 mb-1">Total Resources</p>
              <p className="text-2xl font-bold text-white">{stats.total_resources || 0}</p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
              <p className="text-xs text-gray-400 mb-1">Categorized</p>
              <p className="text-2xl font-bold text-blue-400">{stats.categorized_count || 0}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{stats.coverage_percentage || '0%'}</p>
            </div>
            <div className="bg-red-900/20 rounded-lg p-3 border border-red-900/30">
              <p className="text-xs text-gray-400 mb-1">Critical</p>
              <p className="text-2xl font-bold text-red-400">{stats.by_criticality?.Critical || 0}</p>
            </div>
            <div className="bg-orange-900/20 rounded-lg p-3 border border-orange-900/30">
              <p className="text-xs text-gray-400 mb-1">High</p>
              <p className="text-2xl font-bold text-orange-400">{stats.by_criticality?.High || 0}</p>
            </div>
            <div className="bg-blue-900/20 rounded-lg p-3 border border-blue-900/30">
              <p className="text-xs text-gray-400 mb-1">Tier 0/1</p>
              <p className="text-2xl font-bold text-blue-400">
                {(stats.by_dr_tier?.['Tier 0'] || 0) + (stats.by_dr_tier?.['Tier 1'] || 0)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 bg-gray-900/40 rounded-lg p-3 border border-gray-800">
        <input
          type="text"
          placeholder="Search resources..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-600"
        />
        <select
          value={filterCriticality}
          onChange={(e) => setFilterCriticality(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
        >
          <option value="">All Criticality</option>
          {CRITICALITY_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
          ))}
        </select>
        <select
          value={filterDrTier}
          onChange={(e) => setFilterDrTier(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
        >
          <option value="">All DR Tiers</option>
          {DR_TIER_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {(filterText || filterCriticality || filterDrTier) && (
          <button
            onClick={() => {
              setFilterText('')
              setFilterCriticality('')
              setFilterDrTier('')
            }}
            className="text-xs text-blue-400 hover:text-blue-300 px-2"
          >
            Clear
          </button>
        )}
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
                <th className="text-left px-3 py-3">
                  <button
                    onClick={() => toggleSort('criticality')}
                    className="font-medium text-gray-400 hover:text-gray-200 flex items-center gap-1"
                  >
                    Criticality {sortField === 'criticality' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                </th>
                <th className="text-left px-3 py-3">
                  <button
                    onClick={() => toggleSort('dr_tier')}
                    className="font-medium text-gray-400 hover:text-gray-200 flex items-center gap-1"
                  >
                    DR Tier {sortField === 'dr_tier' && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                </th>
                <th className="text-left px-3 py-3 font-medium text-gray-400">RTO</th>
                <th className="text-left px-3 py-3 font-medium text-gray-400">RPO</th>
                <th className="text-left px-3 py-3 font-medium text-gray-400">Business Function</th>
                <th className="text-left px-3 py-3 font-medium text-gray-400">Notes</th>
              </tr>
            </thead>
            <tbody>
              {processed.map((resource) => {
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
                        <span className="font-mono text-xs text-blue-300 truncate max-w-xs">{resource.name}</span>
                        {isSaving && (
                          <div className="animate-spin h-3 w-3 border-2 border-blue-400 border-t-transparent rounded-full" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                        {resource.type?.split('/').pop()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {resource.location}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={meta.criticality || ''}
                        onChange={(e) => saveField(resourceId, 'criticality', e.target.value)}
                        className="text-xs bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-blue-600"
                      >
                        <option value="">Select...</option>
                        {CRITICALITY_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
                        ))}
                      </select>
                      {meta.criticality && <BCDRBadge type="criticality" value={meta.criticality} />}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={meta.dr_tier || ''}
                        onChange={(e) => saveField(resourceId, 'dr_tier', e.target.value)}
                        className="text-xs bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-blue-600"
                      >
                        <option value="">Select...</option>
                        {DR_TIER_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      {meta.dr_tier && <BCDRBadge type="dr_tier" value={meta.dr_tier} />}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={meta.rto_target || ''}
                        onChange={(e) => saveField(resourceId, 'rto_target', e.target.value)}
                        className="text-xs bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-blue-600"
                      >
                        <option value="">Select...</option>
                        {RTO_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={meta.rpo_target || ''}
                        onChange={(e) => saveField(resourceId, 'rpo_target', e.target.value)}
                        className="text-xs bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-blue-600"
                      >
                        <option value="">Select...</option>
                        {RPO_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={meta.business_function || ''}
                        onChange={(e) => {
                          const val = e.target.value
                          setMetadata(prev => ({
                            ...prev,
                            [resourceId]: { ...prev[resourceId], business_function: val }
                          }))
                        }}
                        onBlur={() => saveField(resourceId, 'business_function', meta.business_function)}
                        placeholder="e.g. Production API"
                        className="w-full text-xs bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={meta.notes || ''}
                        onChange={(e) => {
                          const val = e.target.value
                          setMetadata(prev => ({
                            ...prev,
                            [resourceId]: { ...prev[resourceId], notes: val }
                          }))
                        }}
                        onBlur={() => saveField(resourceId, 'notes', meta.notes)}
                        placeholder="Notes..."
                        className="w-full text-xs bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
                      />
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
        
        <div className="px-4 py-3 bg-gray-900/50 border-t border-gray-800 text-xs text-gray-500">
          Showing {processed.length} of {resources?.length || 0} resources
          {selectedIds.size > 0 && <span className="ml-3 text-blue-400">• {selectedIds.size} selected</span>}
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
    </div>
  )
}
