import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Tag, Save, X, Plus, Trash2, RefreshCw, ExternalLink, Check } from 'lucide-react'

/**
 * TagEditorModal — per-resource tag editing
 *
 * Props:
 *   resource       object  — the resource being tagged
 *   onClose        fn      — close the modal
 *   onSaved        fn      — called after save (optional, for parent refresh)
 */
export default function TagEditorModal({ resource, onClose, onSaved }) {
  const [schema,   setSchema]   = useState([])
  const [custom,   setCustom]   = useState({})   // tag_key → value (current custom tags)
  const [azureTags,setAzureTags]= useState({})   // read-only Azure native tags
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [newKey,   setNewKey]   = useState('')
  const [newVal,   setNewVal]   = useState('')

  const rid = resource?.resource_id || resource?.id || ''

  useEffect(() => {
    if (!rid) return
    setLoading(true)
    Promise.all([
      fetch('/api/tags/schema').then(r => r.json()),
      fetch(`/api/tags/resource/${encodeURIComponent(rid)}`).then(r => r.json()),
    ]).then(([s, t]) => {
      setSchema(s)
      setCustom(t || {})
      setAzureTags(resource?.tags || {})
    }).catch(console.error).finally(() => setLoading(false))
  }, [rid])

  function setValue(key, val) {
    setCustom(prev => ({ ...prev, [key]: val }))
  }

  function removeKey(key) {
    setCustom(prev => {
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
      await fetch(`/api/tags/resource/${encodeURIComponent(rid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: custom }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved?.()
    } catch (e) {
      console.error('Tag save error:', e)
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
    const val = custom[entry.tag_key] ?? ''

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
      <div className="bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-gray-800">
          <Tag size={18} className="text-purple-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white truncate">Tag Resource</h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {resource?.resource_name || resource?.name || rid}
              {resource?.resource_type && <span className="ml-2 text-gray-600">· {resource.resource_type.split('/').pop()}</span>}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {loading && (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-6">
              <RefreshCw size={14} className="animate-spin" /> Loading tags…
            </div>
          )}

          {!loading && (
            <>
              {/* Azure native tags (read-only) */}
              {Object.keys(azureTags).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    Azure Tags <span className="text-gray-600 font-normal">(from Azure — read only)</span>
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(azureTags).map(([k, v]) => (
                      <span key={k} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 border border-gray-700/60">
                        <span className="text-gray-500">{k}:</span>
                        <span className="text-gray-300">{v}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

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
                          {custom[entry.tag_key] && (
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
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600 font-mono"
                  />
                  <input
                    type="text"
                    placeholder="Value"
                    value={newVal}
                    onChange={e => setNewVal(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustom()}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
                  />
                  <button onClick={addCustom} className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs text-gray-300 border border-gray-600">
                    <Plus size={13} />
                  </button>
                </div>

                {/* Current custom tags not in schema */}
                {Object.entries(custom).filter(([k]) => !schema.find(s => s.tag_key === k)).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 mt-2">
                    <span className="text-xs font-mono text-gray-400 w-32 truncate">{k}</span>
                    <input
                      type="text"
                      value={v}
                      onChange={e => setValue(k, e.target.value)}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
                    />
                    <button onClick={() => removeKey(k)} className="text-gray-600 hover:text-red-400">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-4 border-t border-gray-800">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              saved
                ? 'bg-green-700 text-green-100'
                : 'bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40',
            )}
          >
            {saving ? <RefreshCw size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Tags'}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 border border-gray-700">
            Close
          </button>
          <div className="ml-auto text-xs text-gray-600">
            {Object.keys(custom).length} custom tag{Object.keys(custom).length !== 1 ? 's' : ''} set
          </div>
        </div>
      </div>
    </div>
  )
}
