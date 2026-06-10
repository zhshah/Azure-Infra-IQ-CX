/**
 * Resource Details Modal
 * 
 * Full-width modal for displaying affected resources in AI BCDR analysis.
 * Shows comprehensive resource information in a proper data table with:
 * - All technical details (name, type, location, backup status, zone redundancy, score)
 * - User-defined BCDR metadata (criticality, DR tier, RTO, RPO, business function, notes)
 * - Sorting and filtering
 * - Export functionality
 * - Responsive design
 */
import React, { useState, useMemo, useEffect } from 'react'
import clsx from 'clsx'
import { X, Download, Filter, ArrowUpDown } from 'lucide-react'
import { BCDRBadge } from './BCDRMetadataEditor'
import { api } from '../api/client'

export function ResourceDetailsModal({ isOpen, onClose, title, description, resources, context = {} }) {
  const [sortField, setSortField] = useState('score')
  const [sortDir, setSortDir] = useState('asc')
  const [filterText, setFilterText] = useState('')
  const [filterCriticality, setFilterCriticality] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [customTags, setCustomTags] = useState({}) // {resource_id: {key: val}}
  const [tagSchema, setTagSchema] = useState([]) // tag schema for display names
  
  // Load custom tags when modal opens
  useEffect(() => {
    if (isOpen) {
      api.getAllTags().then(tags => setCustomTags(tags || {})).catch(() => {})
      api.getTagSchema().then(schema => setTagSchema(schema || [])).catch(() => {})
    }
  }, [isOpen])
  
  // Sort and filter resources — must be BEFORE any early return to keep hook order stable
  const processed = useMemo(() => {
    let filtered = resources || []
    
    // Text filter
    if (filterText) {
      const lower = filterText.toLowerCase()
      filtered = filtered.filter(r => 
        r.name?.toLowerCase().includes(lower) ||
        r.type?.toLowerCase().includes(lower) ||
        r.location?.toLowerCase().includes(lower) ||
        r.user_metadata?.business_function?.toLowerCase().includes(lower)
      )
    }
    
    // Criticality filter
    if (filterCriticality) {
      filtered = filtered.filter(r => 
        r.user_metadata?.criticality === filterCriticality
      )
    }
    
    // Sort
    const sorted = [...filtered].sort((a, b) => {
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
        case 'score':
          aVal = a.score || 0
          bVal = b.score || 0
          break
        case 'criticality':
          aVal = a.user_metadata?.criticality || 'ZZZ'
          bVal = b.user_metadata?.criticality || 'ZZZ'
          break
        default:
          return 0
      }
      
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    
    return sorted
  }, [resources, sortField, sortDir, filterText, filterCriticality])
  
  // Early return AFTER all hooks to maintain stable hook order across renders
  if (!isOpen) return null
  
  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }
  
  const exportToCSV = () => {
    // Collect all unique tag keys across all resources
    const allTagKeys = new Set()
    processed.forEach(r => {
      const rid = r.resource_id || r.id
      const tags = customTags[rid?.toLowerCase()] || {}
      Object.keys(tags).forEach(k => allTagKeys.add(k))
    })
    const tagKeys = [...allTagKeys].sort()
    
    const headers = [
      'Name', 'Type', 'Location', 'Backup', 'Zone Redundant', 'Score', 
      'Criticality', 'DR Tier', 'RTO', 'RPO', 'Business Function', 'Notes',
      ...tagKeys.map(k => {
        const schemaEntry = tagSchema.find(s => s.tag_key === k)
        return `Tag: ${schemaEntry?.display_name || k}`
      })
    ]
    
    const rows = processed.map(r => {
      const rid = r.resource_id || r.id
      const tags = customTags[rid?.toLowerCase()] || {}
      return [
        r.name,
        r.type,
        r.location,
        r.has_backup ? 'Yes' : 'No',
        r.zone_redundant ? 'Yes' : 'No',
        r.score || '',
        r.user_metadata?.criticality || '',
        r.user_metadata?.dr_tier || '',
        r.user_metadata?.rto_target || '',
        r.user_metadata?.rpo_target || '',
        r.user_metadata?.business_function || '',
        r.user_metadata?.notes || '',
        ...tagKeys.map(k => tags[k] || '')
      ]
    })
    
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bcdr-resources-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-800 w-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-800">
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-white mb-1">{title}</h2>
            {description && <p className="text-sm text-gray-400">{description}</p>}
            <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
              <span>Total: <strong className="text-gray-300">{resources?.length || 0}</strong></span>
              {processed.length !== resources?.length && (
                <span>Filtered: <strong className="text-blue-400">{processed.length}</strong></span>
              )}
              {context.gap_id && <span className="text-gray-600">Gap ID: {context.gap_id}</span>}
              {context.severity && (
                <span className={clsx(
                  'px-2 py-0.5 rounded text-xs',
                  context.severity === 'Critical' ? 'bg-red-900/40 text-red-300' :
                  context.severity === 'High' ? 'bg-orange-900/40 text-orange-300' :
                  'bg-yellow-900/40 text-yellow-300'
                )}>{context.severity}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 p-1"
          >
            <X size={24} />
          </button>
        </div>
        
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-800 bg-gray-900/50">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors',
              showFilters ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            )}
          >
            <Filter size={14} />
            Filters
          </button>
          
          <input
            type="text"
            placeholder="Search resources..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-600"
          />
          
          <button
            onClick={exportToCSV}
            className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
        
        {/* Filters Panel */}
        {showFilters && (
          <div className="px-6 py-3 border-b border-gray-800 bg-gray-950/30">
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Criticality</label>
                <select
                  value={filterCriticality}
                  onChange={(e) => setFilterCriticality(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
                >
                  <option value="">All</option>
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
              
              {filterText || filterCriticality ? (
                <button
                  onClick={() => {
                    setFilterText('')
                    setFilterCriticality('')
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300 mt-5"
                >
                  Clear Filters
                </button>
              ) : null}
            </div>
          </div>
        )}
        
        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-400">
                  <button
                    onClick={() => toggleSort('name')}
                    className="flex items-center gap-1 hover:text-gray-200"
                  >
                    Name
                    {sortField === 'name' && <ArrowUpDown size={12} />}
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">
                  <button
                    onClick={() => toggleSort('type')}
                    className="flex items-center gap-1 hover:text-gray-200"
                  >
                    Type
                    {sortField === 'type' && <ArrowUpDown size={12} />}
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">
                  <button
                    onClick={() => toggleSort('location')}
                    className="flex items-center gap-1 hover:text-gray-200"
                  >
                    Location
                    {sortField === 'location' && <ArrowUpDown size={12} />}
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">
                  <button
                    onClick={() => toggleSort('score')}
                    className="flex items-center gap-1 hover:text-gray-200"
                  >
                    Score
                    {sortField === 'score' && <ArrowUpDown size={12} />}
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">
                  <button
                    onClick={() => toggleSort('criticality')}
                    className="flex items-center gap-1 hover:text-gray-200"
                  >
                    Criticality
                    {sortField === 'criticality' && <ArrowUpDown size={12} />}
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">DR Tier</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">RTO/RPO</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Business Function</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Custom Tags</th>
              </tr>
            </thead>
            <tbody>
              {processed.map((resource, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-3">
                    <div className="font-mono text-blue-300 text-xs truncate max-w-xs">
                      {resource.name}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                      {resource.type?.split('/').pop()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    📍 {resource.location}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1 text-[10px]">
                      {resource.has_backup !== undefined && (
                        <span className={resource.has_backup ? 'text-green-400' : 'text-red-400'}>
                          {resource.has_backup ? '✓ Backed up' : '✗ No backup'}
                        </span>
                      )}
                      {resource.zone_redundant !== undefined && (
                        <span className={resource.zone_redundant ? 'text-green-400' : 'text-orange-400'}>
                          {resource.zone_redundant ? '✓ Zone redundant' : '⚠ Regional only'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {resource.score !== undefined && (
                      <span className={clsx(
                        'text-xs font-medium',
                        resource.score >= 75 ? 'text-green-400' :
                        resource.score >= 50 ? 'text-yellow-400' :
                        resource.score >= 25 ? 'text-orange-400' :
                        'text-red-400'
                      )}>
                        {resource.score}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {resource.user_metadata?.criticality && (
                      <BCDRBadge type="criticality" value={resource.user_metadata.criticality} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {resource.user_metadata?.dr_tier && (
                      <BCDRBadge type="dr_tier" value={resource.user_metadata.dr_tier} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5 text-[10px] text-gray-400">
                      {resource.user_metadata?.rto_target && (
                        <span>⏱️ {resource.user_metadata.rto_target}</span>
                      )}
                      {resource.user_metadata?.rpo_target && (
                        <span>💾 {resource.user_metadata.rpo_target}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="max-w-xs">
                      {resource.user_metadata?.business_function && (
                        <span className="text-xs text-gray-300">
                          {resource.user_metadata.business_function}
                        </span>
                      )}
                      {resource.user_metadata?.notes && (
                        <div className="text-[10px] text-gray-500 mt-0.5 truncate">
                          {resource.user_metadata.notes}
                        </div>
                      )}
                    </div>
                  </td>                  <td className="px-4 py-3">
                    {(() => {
                      const rid = resource.resource_id || resource.id
                      const tags = customTags[rid?.toLowerCase()] || {}
                      const entries = Object.entries(tags).slice(0, 3) // Show first 3 tags
                      if (entries.length === 0) return <span className="text-xs text-gray-700">—</span>
                      return (
                        <div className="flex flex-wrap gap-1">
                          {entries.map(([key, value]) => {
                            const schemaEntry = tagSchema.find(s => s.tag_key === key)
                            const color = schemaEntry?.color || '#6b7280'
                            const displayName = schemaEntry?.display_name || key
                            return (
                              <span
                                key={key}
                                className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{
                                  backgroundColor: `${color}20`,
                                  color: color,
                                  borderWidth: '1px',
                                  borderColor: `${color}60`,
                                }}
                                title={`${displayName}: ${value}`}
                              >
                                {value}
                              </span>
                            )
                          })}
                          {Object.keys(tags).length > 3 && (
                            <span className="text-[10px] text-gray-600">+{Object.keys(tags).length - 3}</span>
                          )}
                        </div>
                      )
                    })()}
                  </td>                </tr>
              ))}
            </tbody>
          </table>
          
          {processed.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              No resources found matching filters
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-800 bg-gray-900/50 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            Showing {processed.length} of {resources?.length || 0} resources
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default ResourceDetailsModal
