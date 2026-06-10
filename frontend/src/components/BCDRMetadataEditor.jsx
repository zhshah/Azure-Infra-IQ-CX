/**
 * BCDR Metadata Editor Component
 * 
 * Phase 1 BCDR Planning - Allows users to categorize resources with:
 * - Criticality (Critical/High/Medium/Low)
 * - DR Tier (Tier 0/1/2/3)
 * - RTO Target
 * - RPO Target  
 * - Business Function
 * - Notes
 * 
 * Features:
 * - Inline editing in resource table
 * - Bulk editing for multiple resources
 * - Auto-save to backend
 * - Visual badges and color coding
 * - Filter/sort by metadata
 */
import React, { useState, useEffect } from 'react'
import clsx from 'clsx'
import { api } from '../api/client'

// BCDR Field Definitions
export const CRITICALITY_OPTIONS = [
  { value: 'Critical', label: 'Critical', color: 'red', dot: '#ef4444' },
  { value: 'High', label: 'High', color: 'orange', dot: '#f97316' },
  { value: 'Medium', label: 'Medium', color: 'yellow', dot: '#eab308' },
  { value: 'Low', label: 'Low', color: 'green', dot: '#22c55e' },
]

export const DR_TIER_OPTIONS = [
  { value: 'Tier 0', label: 'Tier 0', description: 'Mission Critical (< 1hr RTO)', color: 'red' },
  { value: 'Tier 1', label: 'Tier 1', description: 'Business Critical (< 4hr RTO)', color: 'orange' },
  { value: 'Tier 2', label: 'Tier 2', description: 'Important (< 24hr RTO)', color: 'yellow' },
  { value: 'Tier 3', label: 'Tier 3', description: 'Low Priority (Best Effort)', color: 'gray' },
]

export const RTO_OPTIONS = [
  { value: '< 1 hr', label: '< 1 hour' },
  { value: '< 4 hrs', label: '< 4 hours' },
  { value: '< 8 hrs', label: '< 8 hours' },
  { value: '< 24 hrs', label: '< 24 hours' },
  { value: 'Best Effort', label: 'Best Effort' },
]

export const RPO_OPTIONS = [
  { value: '< 15 min', label: '< 15 minutes' },
  { value: '< 1 hr', label: '< 1 hour' },
  { value: '< 4 hrs', label: '< 4 hours' },
  { value: '< 24 hrs', label: '< 24 hours' },
  { value: 'Best Effort', label: 'Best Effort' },
]

/**
 * Badge Component for Criticality/DR Tier
 */
export function BCDRBadge({ type, value }) {
  if (!value) return null
  
  const config = type === 'criticality' 
    ? CRITICALITY_OPTIONS.find(o => o.value === value)
    : DR_TIER_OPTIONS.find(o => o.value === value)
  
  if (!config) return <span className="text-xs text-gray-500">{value}</span>
  
  const colorClasses = {
    red: 'bg-red-900/40 text-red-300 border-red-800',
    orange: 'bg-orange-900/40 text-orange-300 border-orange-800',
    yellow: 'bg-yellow-900/40 text-yellow-300 border-yellow-800',
    green: 'bg-green-900/40 text-green-300 border-green-800',
    gray: 'bg-gray-800/40 text-gray-400 border-gray-700',
  }
  
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border',
      colorClasses[config.color]
    )}>
      {config.dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: config.dot, display: 'inline-block' }} />}
      {config.label}
    </span>
  )
}

/**
 * Inline Editor for a single field
 */
function InlineEditor({ value, options, onChange, placeholder }) {
  const [editing, setEditing] = useState(false)
  const [tempValue, setTempValue] = useState(value || '')
  
  useEffect(() => {
    setTempValue(value || '')
  }, [value])
  
  if (!editing && !value) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs text-gray-500 hover:text-blue-400 transition-colors"
      >
        + Add
      </button>
    )
  }
  
  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs text-gray-300 hover:text-blue-400 transition-colors text-left"
      >
        {value}
      </button>
    )
  }
  
  return (
    <select
      value={tempValue}
      onChange={(e) => {
        setTempValue(e.target.value)
        onChange(e.target.value)
        setEditing(false)
      }}
      onBlur={() => setEditing(false)}
      autoFocus
      className="text-xs bg-gray-900 border border-blue-700 rounded px-1 py-0.5 text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      <option value="">{placeholder || 'Select...'}</option>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

/**
 * BCDR Metadata Row Component
 * Shows metadata for a single resource with inline editing
 */
export function BCDRMetadataRow({ resource, metadata, onUpdate }) {
  const [saving, setSaving] = useState(false)
  const [localMeta, setLocalMeta] = useState(metadata || {})
  
  const saveField = async (field, value) => {
    const updated = { ...localMeta, [field]: value }
    setLocalMeta(updated)
    setSaving(true)
    
    try {
      await api.saveBCDRMetadata(resource.resource_id, updated)
      onUpdate(resource.resource_id, updated)
    } catch (err) {
      console.error('Failed to save BCDR metadata:', err)
    } finally {
      setSaving(false)
    }
  }
  
  return (
    <div className="grid grid-cols-6 gap-2 items-center py-2 border-b border-gray-800/50">
      {/* Criticality */}
      <div>
        {localMeta.criticality ? (
          <BCDRBadge type="criticality" value={localMeta.criticality} />
        ) : (
          <InlineEditor
            value={localMeta.criticality}
            options={CRITICALITY_OPTIONS}
            onChange={(v) => saveField('criticality', v)}
            placeholder="Set criticality"
          />
        )}
      </div>
      
      {/* DR Tier */}
      <div>
        {localMeta.dr_tier ? (
          <BCDRBadge type="dr_tier" value={localMeta.dr_tier} />
        ) : (
          <InlineEditor
            value={localMeta.dr_tier}
            options={DR_TIER_OPTIONS}
            onChange={(v) => saveField('dr_tier', v)}
          />
        )}
      </div>
      
      {/* RTO */}
      <div>
        <InlineEditor
          value={localMeta.rto_target}
          options={RTO_OPTIONS}
          onChange={(v) => saveField('rto_target', v)}
          placeholder="RTO"
        />
      </div>
      
      {/* RPO */}
      <div>
        <InlineEditor
          value={localMeta.rpo_target}
          options={RPO_OPTIONS}
          onChange={(v) => saveField('rpo_target', v)}
          placeholder="RPO"
        />
      </div>
      
      {/* Business Function */}
      <div>
        <input
          type="text"
          value={localMeta.business_function || ''}
          onChange={(e) => setLocalMeta({ ...localMeta, business_function: e.target.value })}
          onBlur={() => saveField('business_function', localMeta.business_function)}
          placeholder="e.g. Production API"
          className="w-full text-xs bg-gray-900/50 border border-gray-700 rounded px-2 py-1 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600"
        />
      </div>
      
      {/* Notes */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={localMeta.notes || ''}
          onChange={(e) => setLocalMeta({ ...localMeta, notes: e.target.value })}
          onBlur={() => saveField('notes', localMeta.notes)}
          placeholder="Notes..."
          className="w-full text-xs bg-gray-900/50 border border-gray-700 rounded px-2 py-1 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600"
        />
        {saving && (
          <div className="animate-spin h-3 w-3 border-2 border-blue-400 border-t-transparent rounded-full" />
        )}
      </div>
    </div>
  )
}

/**
 * Bulk Editor Modal
 */
export function BulkBCDREditor({ resources, onClose, onSave }) {
  const [formData, setFormData] = useState({
    criticality: '',
    dr_tier: '',
    rto_target: '',
    rpo_target: '',
    business_function: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  
  const handleSave = async () => {
    setSaving(true)
    
    try {
      const updates = resources.map(r => ({
        resource_id: r.resource_id,
        ...formData,
      }))
      
      await api.bulkSaveBCDRMetadata(updates)
      onSave(updates)
      onClose()
    } catch (err) {
      console.error('Bulk save failed:', err)
      alert(`Failed to save: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">
            Bulk Edit BCDR Metadata ({resources.length} resources)
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300"
          >
            ✕
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Criticality</label>
            <select
              value={formData.criticality}
              onChange={(e) => setFormData({ ...formData, criticality: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200"
            >
              <option value="">-- No Change --</option>
              {CRITICALITY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">DR Tier</label>
            <select
              value={formData.dr_tier}
              onChange={(e) => setFormData({ ...formData, dr_tier: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200"
            >
              <option value="">-- No Change --</option>
              {DR_TIER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label} - {opt.description}</option>
              ))}
            </select>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">RTO Target</label>
              <select
                value={formData.rto_target}
                onChange={(e) => setFormData({ ...formData, rto_target: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200"
              >
                <option value="">-- No Change --</option>
                {RTO_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">RPO Target</label>
              <select
                value={formData.rpo_target}
                onChange={(e) => setFormData({ ...formData, rpo_target: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200"
              >
                <option value="">-- No Change --</option>
                {RPO_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Business Function</label>
            <input
              type="text"
              value={formData.business_function}
              onChange={(e) => setFormData({ ...formData, business_function: e.target.value })}
              placeholder="e.g. Production API, Analytics, Dev/Test"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200 placeholder-gray-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional notes..."
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200 placeholder-gray-500"
            />
          </div>
        </div>
        
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded disabled:opacity-50"
          >
            {saving ? 'Saving...' : `Save to ${resources.length} Resources`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default { BCDRBadge, BCDRMetadataRow, BulkBCDREditor }
