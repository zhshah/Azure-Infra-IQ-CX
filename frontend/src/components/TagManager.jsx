import React, { useEffect, useState, useCallback } from 'react'
import clsx from 'clsx'
import {
  Tag, Plus, Trash2, Edit2, Save, X, Upload, Download, RefreshCw,
  ChevronRight, ChevronDown, Layers, Check, AlertTriangle, Search,
} from 'lucide-react'
import { api } from '../api/client'

// ── API helpers (tagging-specific) ────────────────────────────────────────────
const tagApi = {
  getSchema:    ()             => api._request('/tags/schema'),
  upsertSchema: (entry)        => api._request('/tags/schema', { method: 'POST', body: JSON.stringify(entry) }),
  deleteSchema: (key)          => api._request(`/tags/schema/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  getStats:     ()             => api._request('/tags/stats'),
  exportCSV:    async ()       => {
    const res = await fetch('/api/tags/export')
    const text = await res.text()
    const blob = new Blob([text], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'resource-tags.csv' })
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  },
  importCSV:    (csv_text)     => api._request('/tags/import', { method: 'POST', body: JSON.stringify({ csv_text }) }),
}

// ── TAG_TYPES ─────────────────────────────────────────────────────────────────
const TAG_TYPES = [
  { value: 'text',   label: 'Free Text' },
  { value: 'enum',   label: 'Dropdown (Enum)' },
  { value: 'bool',   label: 'Yes / No' },
  { value: 'number', label: 'Number' },
]

const CATEGORIES = ['Business', 'BCDR', 'Compliance', 'Migration', 'Technical', 'Governance', 'Custom']

const PRESET_COLORS = [
  '#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e',
  '#10b981','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#a78bfa',
  '#ec4899','#6b7280',
]

// ── Schema Entry Form ─────────────────────────────────────────────────────────

function SchemaForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    tag_key: '', display_name: '', tag_type: 'text', enum_values: [],
    category: 'Custom', is_required: false, color: '#6366f1',
    ...initial,
  })
  const [enumInput, setEnumInput] = useState('')
  const isNew = !initial?.tag_key

  function update(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function addEnum() {
    const val = enumInput.trim()
    if (val && !form.enum_values.includes(val)) {
      update('enum_values', [...form.enum_values, val])
    }
    setEnumInput('')
  }

  function removeEnum(v) { update('enum_values', form.enum_values.filter(e => e !== v)) }

  return (
    <div className="space-y-3 p-4 bg-gray-900 border border-gray-700/60 rounded-xl">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tag Key (unique ID)</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600 font-mono"
            placeholder="e.g. Application"
            value={form.tag_key}
            onChange={e => update('tag_key', e.target.value.replace(/\s+/g, ''))}
            disabled={!isNew}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Display Name</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
            placeholder="e.g. Application Name"
            value={form.display_name}
            onChange={e => update('display_name', e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Type</label>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
            value={form.tag_type}
            onChange={e => update('tag_type', e.target.value)}
          >
            {TAG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Category</label>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
            value={form.category}
            onChange={e => update('category', e.target.value)}
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Color</label>
          <div className="flex flex-wrap gap-1 mt-1">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => update('color', c)}
                className={clsx('w-5 h-5 rounded-full transition-transform', form.color === c ? 'scale-125 ring-2 ring-white' : '')}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>

      {form.tag_type === 'enum' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Dropdown Options</label>
          <div className="flex gap-2 mb-2">
            <input
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
              placeholder="Add option…"
              value={enumInput}
              onChange={e => setEnumInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEnum())}
            />
            <button onClick={addEnum} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white">Add</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {form.enum_values.map(v => (
              <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-300 border border-gray-600">
                {v}
                <button onClick={() => removeEnum(v)} className="text-gray-500 hover:text-red-400"><X size={10} /></button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="req"
          checked={form.is_required}
          onChange={e => update('is_required', e.target.checked)}
          className="w-4 h-4 accent-blue-600"
        />
        <label htmlFor="req" className="text-xs text-gray-400">Required tag (flagged if missing)</label>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onSave(form)}
          disabled={!form.tag_key || !form.display_name}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white disabled:opacity-40"
        >
          <Save size={12} /> {isNew ? 'Create Tag Key' : 'Save Changes'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 border border-gray-700">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Schema Row ────────────────────────────────────────────────────────────────

function SchemaRow({ entry, usageCount, onEdit, onDelete }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-800/30 rounded-lg group">
      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">{entry.display_name}</span>
          <span className="text-xs font-mono text-gray-500">{entry.tag_key}</span>
          {entry.is_required && <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-800/40">Required</span>}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-gray-600">{entry.category} · {entry.tag_type}</span>
          {entry.tag_type === 'enum' && entry.enum_values.length > 0 && (
            <span className="text-xs text-gray-600">{entry.enum_values.slice(0, 4).join(', ')}{entry.enum_values.length > 4 ? '…' : ''}</span>
          )}
          {usageCount > 0 && <span className="text-xs text-gray-600">{usageCount} resources tagged</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onEdit(entry)} className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-500 hover:text-gray-300">
          <Edit2 size={13} />
        </button>
        <button onClick={() => onDelete(entry.tag_key)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-gray-500 hover:text-red-400">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

// ── Main TagManager ────────────────────────────────────────────────────────────

export default function TagManager() {
  const [schema,     setSchema]     = useState([])
  const [stats,      setStats]      = useState(null)
  const [editing,    setEditing]    = useState(null)   // entry or 'new'
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [search,     setSearch]     = useState('')
  const [expandedCat,setExpandedCat]= useState({})
  const [importing,  setImporting]  = useState(false)
  const [importResult,setImportResult] = useState(null)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const [s, st] = await Promise.all([
        fetch('/api/tags/schema').then(r => r.json()),
        fetch('/api/tags/stats').then(r => r.json()),
      ])
      setSchema(s)
      setStats(st)
      // Expand all categories by default
      const cats = [...new Set(s.map(e => e.category))]
      setExpandedCat(Object.fromEntries(cats.map(c => [c, true])))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  async function handleSave(form) {
    await fetch('/api/tags/schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setEditing(null)
    reload()
  }

  async function handleDelete(key) {
    if (!confirm(`Delete tag key "${key}" and all its values?`)) return
    await fetch(`/api/tags/schema/${encodeURIComponent(key)}`, { method: 'DELETE' })
    reload()
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    const text = await file.text()
    const res  = await fetch('/api/tags/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv_text: text }),
    })
    const data = await res.json()
    setImportResult(data)
    setImporting(false)
  }

  const filtered = search
    ? schema.filter(e => e.display_name.toLowerCase().includes(search.toLowerCase()) || e.tag_key.toLowerCase().includes(search.toLowerCase()))
    : schema

  // Group by category
  const grouped = filtered.reduce((acc, e) => {
    const cat = e.category || 'Custom'
    acc[cat] = acc[cat] || []
    acc[cat].push(e)
    return acc
  }, {})

  const categories = Object.keys(grouped).sort()

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Tag size={16} className="text-purple-400" />
            Tag Schema Manager
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Define custom tag keys for resources. These appear as filterable columns in the Resource Table.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors',
            'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200')}>
            <Upload size={12} />
            {importing ? 'Importing…' : 'Import CSV'}
            <input type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
          </label>
          <button
            onClick={async () => {
              const res = await fetch('/api/tags/export')
              const text = await res.text()
              const blob = new Blob([text], { type: 'text/csv' })
              const url  = URL.createObjectURL(blob)
              const a    = Object.assign(document.createElement('a'), { href: url, download: 'resource-tags.csv' })
              document.body.appendChild(a); a.click()
              document.body.removeChild(a); URL.revokeObjectURL(url)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-gray-200"
          >
            <Download size={12} /> Export CSV
          </button>
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white font-medium"
          >
            <Plus size={12} /> New Tag Key
          </button>
        </div>
      </div>

      {/* Import result */}
      {importResult && (
        <div className={clsx('rounded-lg p-3 text-sm border flex items-center gap-2',
          importResult.errors?.length ? 'bg-yellow-900/20 border-yellow-800/40 text-yellow-300' : 'bg-green-900/20 border-green-800/40 text-green-300')}>
          <Check size={14} />
          Imported {importResult.imported} tag values
          {importResult.errors?.length > 0 && ` (${importResult.errors.length} errors)`}
          <button onClick={() => setImportResult(null)} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
          <span>{schema.length} tag keys defined</span>
          <span>{stats.total_tagged_resources} resources tagged</span>
          <span>{stats.total_tag_values} total tag values stored</span>
        </div>
      )}

      {/* New entry form */}
      {editing === 'new' && (
        <SchemaForm onSave={handleSave} onCancel={() => setEditing(null)} />
      )}

      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Search tag keys…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600 max-w-xs"
        />
      </div>

      {/* Schema list */}
      {loading && (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-6">
          <RefreshCw size={14} className="animate-spin" /> Loading schema…
        </div>
      )}
      {error && (
        <div className="text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      {!loading && !error && (
        <div className="space-y-2">
          {categories.map(cat => (
            <div key={cat} className="rounded-xl border border-gray-800/80 overflow-hidden">
              <button
                onClick={() => setExpandedCat(e => ({ ...e, [cat]: !e[cat] }))}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-800/60 hover:bg-gray-800 transition-colors text-left"
              >
                {expandedCat[cat] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">{cat}</span>
                <span className="text-xs text-gray-600 ml-auto">{grouped[cat].length}</span>
              </button>
              {expandedCat[cat] && (
                <div className="p-2 space-y-0.5">
                  {grouped[cat].map(entry => (
                    editing?.tag_key === entry.tag_key
                      ? <SchemaForm key={entry.tag_key} initial={entry} onSave={handleSave} onCancel={() => setEditing(null)} />
                      : <SchemaRow
                          key={entry.tag_key}
                          entry={entry}
                          usageCount={stats?.key_counts?.[entry.tag_key] || 0}
                          onEdit={e => setEditing(e)}
                          onDelete={handleDelete}
                        />
                  ))}
                </div>
              )}
            </div>
          ))}
          {categories.length === 0 && (
            <div className="text-center text-gray-600 py-8">
              <Tag size={24} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No tag keys defined yet.</p>
              <button onClick={() => setEditing('new')} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
                Create your first tag key →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
