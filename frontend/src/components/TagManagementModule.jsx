/**
 * Tag Management Module
 * 
 * Comprehensive tag schema management system allowing users to:
 * - Create custom tag definitions
 * - Edit existing tags (display name, type, allowed values, colors, categories)
 * - Delete unused tags
 * - Preview tag appearance
 * - View tag usage statistics
 * - Import/export tag schemas
 * 
 * Tag Types:
 * - text: Free text input
 * - enum: Dropdown with predefined values
 * - bool: Yes/No radio buttons
 * - number: Numeric input
 */
import React, { useState, useEffect } from 'react'
import clsx from 'clsx'
import { Tag, Plus, Pencil, Trash2, Save, X, Download, Upload, RefreshCw, Eye, AlertTriangle } from 'lucide-react'
import { api } from '../api/client'

export default function TagManagementModule() {
  const [schema, setSchema] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingTag, setEditingTag] = useState(null)
  const [creatingNew, setCreatingNew] = useState(false)
  
  useEffect(() => {
    loadData()
  }, [])
  
  const loadData = async () => {
    setLoading(true)
    try {
      const [schemaData, statsData] = await Promise.all([
        api.getTagSchema(),
        api.getTagStats()
      ])
      setSchema(schemaData)
      setStats(statsData)
    } catch (err) {
      console.error('Failed to load tag data:', err)
    } finally {
      setLoading(false)
    }
  }
  
  const handleCreateNew = () => {
    setCreatingNew(true)
    setEditingTag({
      tag_key: '',
      display_name: '',
      tag_type: 'text',
      enum_values: [],
      category: 'Custom',
      is_required: false,
      color: 'var(--c-6b7280)',
    })
  }
  
  const handleEdit = (entry) => {
    setCreatingNew(false)
    setEditingTag({ ...entry })
  }
  
  const handleDelete = async (tagKey) => {
    const usage = stats?.by_key?.[tagKey] || 0
    if (usage > 0) {
      if (!confirm(`This tag is used on ${usage} resources. Deleting it will remove all values. Continue?`)) {
        return
      }
    } else {
      if (!confirm(`Delete tag "${tagKey}"?`)) return
    }
    
    try {
      await api.deleteTagSchema(tagKey)
      await loadData()
    } catch (err) {
      alert(`Failed to delete: ${err.message}`)
    }
  }
  
  const exportSchema = () => {
    const json = JSON.stringify(schema, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tag-schema-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  
  const importSchema = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) return
      
      const text = await file.text()
      try {
        const imported = JSON.parse(text)
        if (!Array.isArray(imported)) {
          alert('Invalid schema format')
          return
        }
        
        // Upsert all entries
        for (const entry of imported) {
          await api.upsertTagSchema(entry)
        }
        
        await loadData()
        alert(`Imported ${imported.length} tag definitions`)
      } catch (err) {
        alert(`Import failed: ${err.message}`)
      }
    }
    input.click()
  }
  
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw size={24} className="animate-spin text-blue-400" />
      </div>
    )
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white mb-2">🏷️ Tag Management</h1>
          <p className="text-sm text-gray-400 max-w-2xl">
            Define custom tag schemas for resource categorization. Create dropdowns, text fields, yes/no toggles, 
            and numeric inputs to organize your Azure resources with flexible metadata.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportSchema}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm"
          >
            <Download size={14} />
            Export
          </button>
          <button
            onClick={importSchema}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm"
          >
            <Upload size={14} />
            Import
          </button>
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium"
          >
            <Plus size={14} />
            Create Tag Definition
          </button>
        </div>
      </div>
      
      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-1">Total Tag Definitions</p>
            <p className="text-2xl font-bold text-white">{schema.length}</p>
          </div>
          <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-1">Tagged Resources</p>
            <p className="text-2xl font-bold text-blue-400">{stats.total_tagged_resources || 0}</p>
          </div>
          <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-1">Total Tag Values</p>
            <p className="text-2xl font-bold text-purple-400">{stats.total_tag_count || 0}</p>
          </div>
          <div className="bg-gray-900/40 border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-1">Categories</p>
            <p className="text-2xl font-bold text-green-400">
              {new Set(schema.map(s => s.category)).size}
            </p>
          </div>
        </div>
      )}
      
      {/* Tag Schema Table */}
      <div className="bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Tag Key</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Display Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Category</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Values</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Usage</th>
                <th className="text-left px-4 py-3 font-medium text-gray-400">Preview</th>
                <th className="text-right px-4 py-3 font-medium text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schema.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-500">
                    No custom tags defined yet. Click "Create Tag Definition" to get started.
                  </td>
                </tr>
              )}
              {schema.map((entry) => {
                const usage = stats?.by_key?.[entry.tag_key] || 0
                return (
                  <tr key={entry.tag_key} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-3">
                      <code className="text-xs text-blue-300 bg-gray-950/50 px-2 py-1 rounded">
                        {entry.tag_key}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="text-gray-300">{entry.display_name}</span>
                        {entry.is_required && <span className="text-xs text-red-400">*</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400">
                        {entry.tag_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {entry.category}
                    </td>
                    <td className="px-4 py-3">
                      {entry.tag_type === 'enum' && entry.enum_values?.length > 0 && (
                        <span className="text-xs text-gray-500">
                          {entry.enum_values.length} options
                        </span>
                      )}
                      {entry.tag_type === 'bool' && (
                        <span className="text-xs text-gray-500">Yes/No</span>
                      )}
                      {(entry.tag_type === 'text' || entry.tag_type === 'number') && (
                        <span className="text-xs text-gray-500">Free input</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        'text-xs font-medium',
                        usage > 0 ? 'text-green-400' : 'text-gray-600'
                      )}>
                        {usage} resource{usage !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <TagPreview entry={entry} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(entry)}
                          className="p-1.5 rounded text-gray-500 hover:text-blue-400 hover:bg-blue-900/20 transition-colors"
                          title="Edit tag definition"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(entry.tag_key)}
                          className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                          title="Delete tag definition"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Tag Editor Modal */}
      {editingTag && (
        <TagSchemaEditor
          tag={editingTag}
          isNew={creatingNew}
          onClose={() => {
            setEditingTag(null)
            setCreatingNew(false)
          }}
          onSave={async (updatedTag) => {
            try {
              await api.upsertTagSchema(updatedTag)
              await loadData()
              setEditingTag(null)
              setCreatingNew(false)
            } catch (err) {
              alert(`Failed to save: ${err.message}`)
            }
          }}
        />
      )}
    </div>
  )
}

/**
 * Tag Preview Component
 * Shows how the tag will appear when used
 */
function TagPreview({ entry }) {
  if (entry.tag_type === 'enum' && entry.enum_values?.length > 0) {
    return (
      <div className="flex items-center gap-1">
        {entry.enum_values.slice(0, 2).map((val, i) => (
          <span
            key={i}
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: `${entry.color}20`,
              color: entry.color,
              borderWidth: '1px',
              borderColor: `${entry.color}60`,
            }}
          >
            {val}
          </span>
        ))}
        {entry.enum_values.length > 2 && (
          <span className="text-[10px] text-gray-600">
            +{entry.enum_values.length - 2}
          </span>
        )}
      </div>
    )
  }
  
  if (entry.tag_type === 'bool') {
    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded"
        style={{
          backgroundColor: `${entry.color}20`,
          color: entry.color,
          borderWidth: '1px',
          borderColor: `${entry.color}60`,
        }}
      >
        Yes/No
      </span>
    )
  }
  
  return (
    <span className="text-[10px] text-gray-600">
      {entry.tag_type === 'number' ? '123' : 'Text'}
    </span>
  )
}

/**
 * Tag Schema Editor Modal
 * Create or edit tag definitions
 */
function TagSchemaEditor({ tag, isNew, onClose, onSave }) {
  const [formData, setFormData] = useState(tag)
  const [enumInput, setEnumInput] = useState('')
  const [saving, setSaving] = useState(false)
  
  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }
  
  const addEnumValue = () => {
    if (!enumInput.trim()) return
    const current = formData.enum_values || []
    if (current.includes(enumInput.trim())) {
      alert('Value already exists')
      return
    }
    updateField('enum_values', [...current, enumInput.trim()])
    setEnumInput('')
  }
  
  const removeEnumValue = (value) => {
    updateField('enum_values', formData.enum_values.filter(v => v !== value))
  }
  
  const handleSave = async () => {
    // Validation
    if (!formData.tag_key?.trim()) {
      alert('Tag key is required')
      return
    }
    if (!formData.display_name?.trim()) {
      alert('Display name is required')
      return
    }
    if (formData.tag_type === 'enum' && (!formData.enum_values || formData.enum_values.length === 0)) {
      alert('Enum type requires at least one value')
      return
    }
    
    setSaving(true)
    try {
      await onSave(formData)
    } catch (err) {
      alert(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }
  
  const CATEGORIES = ['Custom', 'Cost Management', 'BCDR', 'Compliance', 'Operations', 'Security', 'Governance']
  const COLORS = [
    { name: 'Gray', value: '#6b7280' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Purple', value: '#a855f7' },
    { name: 'Green', value: '#22c55e' },
    { name: 'Red', value: '#ef4444' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Pink', value: '#ec4899' },
  ]
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-gray-800">
          <Tag size={18} className="text-purple-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-white">
              {isNew ? 'Create Tag Definition' : `Edit Tag: ${tag.tag_key}`}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Define how this tag appears and behaves across all resources
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>
        
        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Tag Key */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Tag Key <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.tag_key}
              onChange={(e) => updateField('tag_key', e.target.value)}
              disabled={!isNew}
              placeholder="e.g., environment, cost-center, owner"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600 disabled:opacity-50"
            />
            {!isNew && (
              <p className="text-xs text-gray-600 mt-1">Tag key cannot be changed after creation</p>
            )}
          </div>
          
          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Display Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.display_name}
              onChange={(e) => updateField('display_name', e.target.value)}
              placeholder="e.g., Environment, Cost Center, Owner"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
            />
          </div>
          
          {/* Type and Category */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Tag Type</label>
              <select
                value={formData.tag_type}
                onChange={(e) => updateField('tag_type', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
              >
                <option value="text">Text (free input)</option>
                <option value="enum">Dropdown (predefined values)</option>
                <option value="bool">Yes/No (boolean)</option>
                <option value="number">Number</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Category</label>
              <select
                value={formData.category}
                onChange={(e) => updateField('category', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>
          
          {/* Enum Values */}
          {formData.tag_type === 'enum' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Allowed Values <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={enumInput}
                  onChange={(e) => setEnumInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addEnumValue()}
                  placeholder="Add value..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
                />
                <button
                  onClick={addEnumValue}
                  className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.enum_values?.map((val, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs"
                    style={{
                      backgroundColor: `${formData.color}20`,
                      color: formData.color,
                      borderWidth: '1px',
                      borderColor: `${formData.color}60`,
                    }}
                  >
                    {val}
                    <button
                      onClick={() => removeEnumValue(val)}
                      className="hover:opacity-70"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* Color */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Color</label>
            <div className="flex gap-2">
              {COLORS.map(color => (
                <button
                  key={color.value}
                  onClick={() => updateField('color', color.value)}
                  className={clsx(
                    'w-8 h-8 rounded-lg border-2 transition-all',
                    formData.color === color.value
                      ? 'border-white scale-110'
                      : 'border-gray-700 hover:scale-105'
                  )}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                />
              ))}
            </div>
          </div>
          
          {/* Required */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_required}
                onChange={(e) => updateField('is_required', e.target.checked)}
                className="w-4 h-4 rounded accent-purple-600"
              />
              <span className="text-sm text-gray-300">Mark as required</span>
            </label>
            <p className="text-xs text-gray-600 mt-1 ml-6">
              Required tags will show a red asterisk (*) in the UI
            </p>
          </div>
          
          {/* Preview */}
          <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-2">Preview:</p>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: formData.color }} />
              <span className="text-sm text-gray-300">{formData.display_name || 'Tag Name'}</span>
              {formData.is_required && <span className="text-xs text-red-400">*</span>}
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-5 border-t border-gray-800 bg-gray-950/30">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg text-sm font-medium"
          >
            {saving ? (
              <>
                <RefreshCw size={14} className="animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save size={14} /> {isNew ? 'Create Tag' : 'Save Changes'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
