import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Tag, Save, X, Plus, RefreshCw } from 'lucide-react'

/**
 * BulkTagEditorModal — edit custom tags for multiple resources at once
 *
 * Props:
 *   resources      array   — list of resources to bulk-tag
 *   onClose        fn      — close the modal
 *   onSaved        fn      — called after save (optional, for parent refresh)
 */
export default function BulkTagEditorModal({ resources = [], onClose, onSaved }) {
  const [schema,   setSchema]   = useState([])
  const [tags,     setTags]     = useState({})   // tag_key → value
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [mode,     setMode]     = useState('overwrite')  // 'overwrite' or 'merge'
  const [newKey,   setNewKey]   = useState('')
  const [newVal,   setNewVal]   = useState('')

  useEffect(() => {
    setLoading(true)
    fetch('/api/tags/schema')
      .then(r => r.json())
      .then(s => setSchema(s))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function setValue(key, val) {
    setTags(prev => ({ ...prev, [key]: val }))
  }

  function removeKey(key) {
    setTags(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function addCustom() {
    if (!newKey.trim()) return
    setValue(newKey.trim(), newVal.trim())
    setNewKey('')
    setNewVal('')
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Apply tags to all selected resources
      const promises = resources.map(r => {
        const rid = r.resource_id || r.id
        return fetch(`/api/tags/resource/${encodeURIComponent(rid)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            tags,
            merge: mode === 'merge'  // If merge, keeps existing tags; if overwrite, replaces all
          }),
        })
      })
      
      await Promise.all(promises)
      setSaved(true)
      setTimeout(() => {
        setSaved(false)
        onClose()
        onSaved?.()
      }, 1000)
    } catch (e) {
      console.error('Bulk tag save error:', e)
      alert('Failed to save tags: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // Group schema by category
  const grouped = schema.reduce((acc, e) => {
    acc[e.category] = acc[e.category] || []
    acc[e.category].push(e)
    return acc
  }, {})

  function renderField(entry) {
    const val = tags[entry.tag_key] ?? ''

    if (entry.tag_type === 'enum') {
      return (
        <select
          value={val}
          onChange={e => setValue(entry.tag_key, e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
        >
          <option value="">— not set —</option>
          {entry.enum_values.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      )
    }
    if (entry.tag_type === 'bool') {
      return (
        <div className="flex items-center gap-3">
          {['Yes', 'No', ''].map(v => (
            <label key={v} className="flex items-center gap-1.5 text-sm text-gray-300 cursor-pointer">
              <input type="radio" checked={val === v} onChange={() => setValue(entry.tag_key, v)}
                className="accent-blue-600" />
              {v || '— not set —'}
            </label>
          ))}
        </div>
      )
    }
    return (
      <input
        type={entry.tag_type === 'number' ? 'number' : 'text'}
        value={val}
        placeholder={`Enter ${entry.display_name.toLowerCase()}…`}
        onChange={e => setValue(entry.tag_key, e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-gray-800">
          <Tag size={18} className="text-purple-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white">Bulk Tag Resources</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Apply custom tags to <strong className="text-blue-400">{resources.length}</strong> selected resource{resources.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        {/* Mode selector */}
        <div className="p-5 border-b border-gray-800 bg-gray-950/30">
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
            Tag Mode
          </label>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="radio"
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
                className="accent-blue-600"
              />
              <span>Merge — Add these tags, keep existing tags</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="radio"
                checked={mode === 'overwrite'}
                onChange={() => setMode('overwrite')}
                className="accent-blue-600"
              />
              <span>Overwrite — Replace all existing custom tags</span>
            </label>
          </div>
          {mode === 'overwrite' && (
            <p className="text-xs text-orange-400 mt-2">
              Warning: This will clear all existing custom tags on selected resources
            </p>
          )}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {loading && (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-6">
              <RefreshCw size={14} className="animate-spin" /> Loading tag schema…
            </div>
          )}

          {!loading && (
            <>
              {/* Schema-based tag fields */}
              {Object.keys(grouped).sort().map(cat => (
                <div key={cat}>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{cat}</h4>
                  <div className="space-y-3">
                    {grouped[cat].map(entry => (
                      <div key={entry.tag_key}>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                          <label className="text-xs font-medium text-gray-300">{entry.display_name}</label>
                          {entry.is_required && <span className="text-xs text-red-400">*</span>}
                          {tags[entry.tag_key] && (
                            <button
                              onClick={() => removeKey(entry.tag_key)}
                              className="ml-auto text-gray-600 hover:text-red-400 transition-colors"
                            >
                              <X size={11} />
                            </button>
                          )}
                        </div>
                        {renderField(entry)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Ad-hoc custom tag */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Add Custom Tag</h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Tag key"
                    value={newKey}
                    onChange={e => setNewKey(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustom()}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
                  />
                  <input
                    type="text"
                    placeholder="Value"
                    value={newVal}
                    onChange={e => setNewVal(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustom()}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
                  />
                  <button
                    onClick={addCustom}
                    disabled={!newKey.trim()}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
                  >
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>

              {/* Current tags preview */}
              {Object.keys(tags).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Tags to Apply ({Object.keys(tags).length})
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(tags)
                      .filter(([_, v]) => v !== '')
                      .map(([k, v]) => (
                        <span key={k} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs bg-purple-900/30 text-purple-300 border border-purple-800/60">
                          <span className="text-purple-400 font-medium">{k}:</span>
                          <span>{v}</span>
                          <button
                            onClick={() => removeKey(k)}
                            className="hover:text-purple-100 transition-colors"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {/* Selected resources preview */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Selected Resources ({resources.length})
                </h4>
                <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/30 p-2">
                  <div className="space-y-1">
                    {resources.slice(0, 10).map(r => (
                      <div key={r.resource_id || r.id} className="text-xs text-gray-400 truncate">
                        • {r.resource_name || r.name}
                      </div>
                    ))}
                    {resources.length > 10 && (
                      <div className="text-xs text-gray-600">
                        ... and {resources.length - 10} more
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
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
            disabled={saving || loading || Object.keys(tags).filter(k => tags[k] !== '').length === 0}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2',
              saved
                ? 'bg-green-600 text-white'
                : 'bg-purple-600 hover:bg-purple-700 text-white disabled:bg-gray-800 disabled:text-gray-600'
            )}
          >
            {saving ? (
              <>
                <RefreshCw size={14} className="animate-spin" /> Saving to {resources.length} resources...
              </>
            ) : saved ? (
              <>
                <Save size={14} /> Saved!
              </>
            ) : (
              <>
                <Save size={14} /> Save Tags to {resources.length} Resource{resources.length !== 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
