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
import { Upload, Download, Trash2, FileText, Loader2, X, Paperclip } from 'lucide-react'
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
const AZURE_REGIONS = [
  'eastus', 'eastus2', 'centralus', 'northcentralus', 'southcentralus', 'westus', 'westus2', 'westus3',
  'canadacentral', 'canadaeast', 'brazilsouth', 'mexicocentral',
  'northeurope', 'westeurope', 'uksouth', 'ukwest', 'francecentral', 'germanywestcentral',
  'switzerlandnorth', 'norwayeast', 'swedencentral', 'polandcentral', 'italynorth', 'spaincentral',
  'uaenorth', 'qatarcentral', 'israelcentral', 'southafricanorth',
  'australiaeast', 'australiasoutheast', 'eastasia', 'southeastasia', 'japaneast', 'japanwest',
  'koreacentral', 'centralindia', 'southindia', 'westindia', 'jioindiawest', 'indonesiacentral',
]
const ENVIRONMENTS = ['Production', 'Staging', 'Development', 'Test', 'DR']
const DATA_CLASSES = ['Public', 'Internal', 'Confidential', 'Highly Confidential', 'Restricted']

export { AZURE_REGIONS, ENVIRONMENTS, DATA_CLASSES }

// The complete Phase 1 BCDR field set, in display order. Used by the per-resource editor and
// to count "how complete" a resource's planning data is.
export const BCDR_INTAKE_FIELDS = [
  'target_region', 'desired_sku', 'environment', 'business_owner',
  'financial_loss_per_hour', 'app_dependencies', 'data_classification', 'compliance',
]

export function BulkBCDREditor({ resources, onClose, onSave }) {
  const [formData, setFormData] = useState({
    criticality: '',
    dr_tier: '',
    rto_target: '',
    rpo_target: '',
    business_function: '',
    target_region: '',
    desired_sku: '',
    environment: '',
    business_owner: '',
    financial_loss_per_hour: '',
    app_dependencies: '',
    data_classification: '',
    compliance: '',
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

          {/* Consultant intake fields — the questions a BCDR vendor asks */}
          <div className="pt-2 mt-1 border-t border-gray-800">
            <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide mb-3">BCDR Planning Inputs</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Target Azure Region</label>
                <select value={formData.target_region} onChange={(e) => setFormData({ ...formData, target_region: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200">
                  <option value="">-- No Change --</option>
                  {AZURE_REGIONS.map(r => (<option key={r} value={r}>{r}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Desired SKU</label>
                <input type="text" value={formData.desired_sku} onChange={(e) => setFormData({ ...formData, desired_sku: e.target.value })} placeholder="e.g. Standard_D8s_v5, BC_Gen5_8, GZRS" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200 placeholder-gray-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Environment</label>
                <select value={formData.environment} onChange={(e) => setFormData({ ...formData, environment: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200">
                  <option value="">-- No Change --</option>
                  {ENVIRONMENTS.map(e => (<option key={e} value={e}>{e}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Business Owner</label>
                <input type="text" value={formData.business_owner} onChange={(e) => setFormData({ ...formData, business_owner: e.target.value })} placeholder="e.g. finance@contoso.com" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200 placeholder-gray-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Financial Loss / hour if down</label>
                <input type="text" value={formData.financial_loss_per_hour} onChange={(e) => setFormData({ ...formData, financial_loss_per_hour: e.target.value })} placeholder="e.g. $50,000" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200 placeholder-gray-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Data Classification</label>
                <select value={formData.data_classification} onChange={(e) => setFormData({ ...formData, data_classification: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200">
                  <option value="">-- No Change --</option>
                  {DATA_CLASSES.map(d => (<option key={d} value={d}>{d}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">App Dependencies</label>
                <input type="text" value={formData.app_dependencies} onChange={(e) => setFormData({ ...formData, app_dependencies: e.target.value })} placeholder="e.g. SQL, Key Vault, Entra ID" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200 placeholder-gray-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Compliance</label>
                <input type="text" value={formData.compliance} onChange={(e) => setFormData({ ...formData, compliance: e.target.value })} placeholder="e.g. ISO 27001, PCI-DSS" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-200 placeholder-gray-500" />
              </div>
            </div>
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

// ── Per-resource BCDR editor (ALL Phase 1 fields + supporting-input uploads) ──
const _fld = 'w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-600'
const _lbl = 'block text-xs font-medium text-gray-400 mb-1'

export function ResourceBCDREditor({ resource, initial, onClose, onSaved }) {
  const resourceId = resource?.resource_id || resource?.id
  const rname = resource?.resource_name || resource?.name || resourceId
  const [form, setForm] = useState(() => ({
    criticality: '', dr_tier: '', rto_target: '', rpo_target: '', business_function: '',
    target_region: '', desired_sku: '', environment: '', business_owner: '',
    financial_loss_per_hour: '', app_dependencies: '', data_classification: '', compliance: '', notes: '',
    ...(initial || {}),
  }))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [attachments, setAttachments] = useState([])
  const [loadingAtt, setLoadingAtt] = useState(true)
  const [uploading, setUploading] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const loadAttachments = async () => {
    setLoadingAtt(true)
    try { setAttachments(await api.listBcdrAttachments(resourceId)) } catch { /* ignore */ } finally { setLoadingAtt(false) }
  }
  useEffect(() => { loadAttachments() }, [resourceId])

  const handleSave = async () => {
    setSaving(true); setErr('')
    try {
      await api.saveBCDRMetadata(resourceId, form)
      onSaved?.(resourceId, form)
      onClose?.()
    } catch (e) { setErr(e?.message || 'Save failed') } finally { setSaving(false) }
  }

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true); setErr('')
    try {
      for (const f of files) { await api.uploadBcdrAttachment(resourceId, f) }
      await loadAttachments()
    } catch (er) { setErr(er?.message || 'Upload failed') } finally { setUploading(false); e.target.value = '' }
  }
  const handleDelete = async (id) => {
    try { await api.deleteBcdrAttachment(id); setAttachments(prev => prev.filter(a => a.id !== id)) } catch { /* ignore */ }
  }
  const fmtSize = (n) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[96vw] max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">BCDR Planning — {rname}</h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{(resource?.resource_type || resource?.type || '').split('/').pop()} · {resource?.location || ''}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 shrink-0"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={_lbl}>Criticality</label><select className={_fld} value={form.criticality} onChange={e => set('criticality', e.target.value)}><option value="">Select…</option>{CRITICALITY_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></div>
            <div><label className={_lbl}>DR Tier</label><select className={_fld} value={form.dr_tier} onChange={e => set('dr_tier', e.target.value)}><option value="">Select…</option>{DR_TIER_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></div>
            <div><label className={_lbl}>RTO Target</label><select className={_fld} value={form.rto_target} onChange={e => set('rto_target', e.target.value)}><option value="">Select…</option>{RTO_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></div>
            <div><label className={_lbl}>RPO Target</label><select className={_fld} value={form.rpo_target} onChange={e => set('rpo_target', e.target.value)}><option value="">Select…</option>{RPO_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></div>
            <div><label className={_lbl}>Target Azure Region</label><select className={_fld} value={form.target_region} onChange={e => set('target_region', e.target.value)}><option value="">Select…</option>{AZURE_REGIONS.map(r => (<option key={r} value={r}>{r}</option>))}</select></div>
            <div><label className={_lbl}>Environment</label><select className={_fld} value={form.environment} onChange={e => set('environment', e.target.value)}><option value="">Select…</option>{ENVIRONMENTS.map(x => (<option key={x} value={x}>{x}</option>))}</select></div>
            <div><label className={_lbl}>Data Classification</label><select className={_fld} value={form.data_classification} onChange={e => set('data_classification', e.target.value)}><option value="">Select…</option>{DATA_CLASSES.map(d => (<option key={d} value={d}>{d}</option>))}</select></div>
            <div><label className={_lbl}>Desired SKU</label><input className={_fld} value={form.desired_sku} onChange={e => set('desired_sku', e.target.value)} placeholder="e.g. Standard_D8s_v5, GZRS" /></div>
            <div><label className={_lbl}>Business Owner</label><input className={_fld} value={form.business_owner} onChange={e => set('business_owner', e.target.value)} placeholder="e.g. finance@contoso.com" /></div>
            <div><label className={_lbl}>Financial Loss / hour</label><input className={_fld} value={form.financial_loss_per_hour} onChange={e => set('financial_loss_per_hour', e.target.value)} placeholder="e.g. $50,000" /></div>
            <div className="col-span-2"><label className={_lbl}>Business Function</label><input className={_fld} value={form.business_function} onChange={e => set('business_function', e.target.value)} placeholder="e.g. Production API, Analytics" /></div>
            <div className="col-span-2"><label className={_lbl}>App Dependencies</label><input className={_fld} value={form.app_dependencies} onChange={e => set('app_dependencies', e.target.value)} placeholder="e.g. SQL, Key Vault, Entra ID" /></div>
            <div className="col-span-2"><label className={_lbl}>Compliance / Data Residency</label><input className={_fld} value={form.compliance} onChange={e => set('compliance', e.target.value)} placeholder="e.g. ISO 27001, PCI-DSS, GDPR; data must stay in EU" /></div>
            <div className="col-span-2"><label className={_lbl}>Notes</label><textarea rows={2} className={_fld} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional notes…" /></div>
          </div>

          <div className="pt-3 border-t border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide flex items-center gap-1.5"><Paperclip size={13} /> Supporting inputs</p>
              <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer">
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Upload
                <input type="file" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
              </label>
            </div>
            <p className="text-[11px] text-gray-500 mb-2">Attach DR runbooks, architecture diagrams, requirements, RTO/RPO sign-off, dependency maps… Stored in Azure SQL and fed to the AI assessment.</p>
            {loadingAtt ? (
              <div className="text-xs text-gray-500 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading…</div>
            ) : attachments.length === 0 ? (
              <div className="text-xs text-gray-600 italic py-2">No supporting inputs uploaded yet.</div>
            ) : (
              <div className="space-y-1.5">
                {attachments.map(a => (
                  <div key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/60 border border-gray-700/40 text-xs">
                    <FileText size={14} className="text-blue-400 shrink-0" />
                    <span className="truncate flex-1 text-gray-200" title={a.filename}>{a.filename}</span>
                    {a.has_text && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-800/50">AI-readable</span>}
                    <span className="text-gray-500 shrink-0">{fmtSize(a.size_bytes || 0)}</span>
                    <a href={api.bcdrAttachmentDownloadUrl(a.id)} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-blue-300 shrink-0" title="Download"><Download size={14} /></a>
                    <button onClick={() => handleDelete(a.id)} className="text-gray-500 hover:text-red-400 shrink-0" title="Delete"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {err && <div className="text-xs text-red-400 bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200">Close</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : null} Save BCDR data
          </button>
        </div>
      </div>
    </div>
  )
}

export default { BCDRBadge, BCDRMetadataRow, BulkBCDREditor, ResourceBCDREditor }
