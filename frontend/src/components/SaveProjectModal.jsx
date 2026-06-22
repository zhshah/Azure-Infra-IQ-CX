/**
 * SaveProjectModal — inline modal to save a resource selection as a project.
 * Appears when the user clicks "Save as Project" after selecting resources.
 */
import React, { useState } from 'react'
import { X, FolderOpen, Check } from 'lucide-react'

const COLORS = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
]
const ICONS = ['📁', '🚀', '⚙️', '🌐', '🔒', '💾', '📊', '🏗️', '🔧', '💡']

export default function SaveProjectModal({ resourceCount, onSave, onCancel, existingProjects = [] }) {
  const [name, setName]             = useState('')
  const [description, setDesc]      = useState('')
  const [color, setColor]           = useState(COLORS[0])
  const [icon, setIcon]             = useState(ICONS[0])
  const [addToId, setAddToId]       = useState('')  // add to existing project
  const [mode, setMode]             = useState('new')  // 'new' | 'add'
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')

  const valid = mode === 'new' ? name.trim().length > 0 : addToId.length > 0

  async function handleSave() {
    if (!valid) return
    setSaving(true)
    setError('')
    try {
      await onSave({ mode, name: name.trim(), description, color, icon, addToId })
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl w-[420px] max-w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-sm font-semibold text-white">Save as Project</h3>
            <p className="text-xs text-gray-500 mt-0.5">{resourceCount} resource{resourceCount !== 1 ? 's' : ''} selected</p>
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex p-4 gap-2">
          <button
            onClick={() => setMode('new')}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors border ${
              mode === 'new'
                ? 'bg-blue-900/40 border-blue-600/60 text-blue-300'
                : 'bg-gray-800/60 border-gray-700/40 text-gray-400 hover:text-gray-200'
            }`}
          >
            New Project
          </button>
          {existingProjects.length > 0 && (
            <button
              onClick={() => setMode('add')}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors border ${
                mode === 'add'
                  ? 'bg-blue-900/40 border-blue-600/60 text-blue-300'
                  : 'bg-gray-800/60 border-gray-700/40 text-gray-400 hover:text-gray-200'
              }`}
            >
              Add to Existing
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 pb-5 space-y-4">
          {mode === 'new' ? (
            <>
              {/* Name */}
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Project Name *</label>
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && valid && handleSave()}
                  placeholder="e.g. Production API, Dev Environment…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/60"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Description <span className="text-gray-600">(optional)</span></label>
                <input
                  value={description}
                  onChange={e => setDesc(e.target.value)}
                  placeholder="Brief description…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/60"
                />
              </div>

              {/* Icon & Color */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-xs text-gray-400 mb-1 block">Icon</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ICONS.map(ic => (
                      <button
                        key={ic}
                        onClick={() => setIcon(ic)}
                        className={`w-8 h-8 rounded-lg text-base transition-all ${
                          icon === ic ? 'ring-2 ring-blue-500 bg-blue-900/30' : 'bg-gray-800 hover:bg-gray-700'
                        }`}
                      >
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Color</label>
                  <div className="flex flex-col gap-1">
                    {COLORS.slice(0, 5).map(c => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`w-6 h-6 rounded-full transition-all ${color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-900' : ''}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">&nbsp;</label>
                  <div className="flex flex-col gap-1">
                    {COLORS.slice(5).map(c => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`w-6 h-6 rounded-full transition-all ${color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-900' : ''}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Select Project</label>
              <select
                value={addToId}
                onChange={e => setAddToId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/60"
              >
                <option value="">Choose project…</option>
                {existingProjects.map(p => (
                  <option key={p.id || p.project_id} value={p.id || p.project_id}>
                    {p.icon || '📁'} {p.name || p.project_name} ({p.resource_count ?? (p.resource_ids || []).length} resources)
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onCancel}
              className="flex-1 py-2 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!valid || saving}
              className="flex-1 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {saving ? 'Saving…' : <><Check size={12} /> Save Project</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
