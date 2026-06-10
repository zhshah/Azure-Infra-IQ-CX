/**
 * ProjectSwitcher — header dropdown showing current project context.
 * 
 * Shows "All Resources" or "Project: [Name]" with a dropdown to switch.
 * When a project is active, all resource views filter to that project's IDs.
 */
import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, FolderOpen, Globe, Plus, Trash2, Check } from 'lucide-react'
import clsx from 'clsx'

export default function ProjectSwitcher({ projects, activeProjectId, onSelectProject, onCreateClick }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const active = projects.find(p => p.id === activeProjectId)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors',
          active
            ? 'border-blue-600/60 bg-blue-900/30 text-blue-300 hover:bg-blue-900/50'
            : 'border-gray-700/60 bg-gray-800/60 text-gray-400 hover:text-gray-200 hover:bg-gray-800',
        )}
        title={active ? `Active project: ${active.name}` : 'All resources shown'}
      >
        {active ? (
          <>
            <span className="text-sm leading-none">{active.icon || '📁'}</span>
            <span className="max-w-[120px] truncate">{active.name}</span>
          </>
        ) : (
          <>
            <Globe size={12} />
            <span>All Resources</span>
          </>
        )}
        <ChevronDown size={11} className={clsx('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 bg-gray-900 border border-gray-700/60 rounded-xl shadow-xl z-50 overflow-hidden">
          {/* All resources option */}
          <button
            onClick={() => { onSelectProject(null); setOpen(false) }}
            className={clsx(
              'w-full flex items-center gap-2.5 px-3 py-2.5 text-xs transition-colors',
              !activeProjectId
                ? 'bg-blue-900/30 text-blue-300'
                : 'text-gray-300 hover:bg-gray-800',
            )}
          >
            <Globe size={13} className="shrink-0 text-gray-500" />
            <span className="flex-1 text-left font-medium">All Resources</span>
            {!activeProjectId && <Check size={12} className="text-blue-400" />}
          </button>

          {projects.length > 0 && (
            <div className="border-t border-gray-800/60 py-1">
              {projects.map(p => (
                <button
                  key={p.id}
                  onClick={() => { onSelectProject(p.id); setOpen(false) }}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors',
                    activeProjectId === p.id
                      ? 'bg-blue-900/30 text-blue-300'
                      : 'text-gray-300 hover:bg-gray-800',
                  )}
                >
                  <span className="text-sm leading-none shrink-0">{p.icon || '📁'}</span>
                  <span className="flex-1 text-left truncate">{p.name}</span>
                  <span
                    className="shrink-0 text-gray-600 tabular-nums"
                    style={{ color: p.color || '#3b82f6' }}
                  >
                    {p.resource_count}
                  </span>
                  {activeProjectId === p.id && <Check size={12} className="text-blue-400 shrink-0" />}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-gray-800/60 p-2">
            <button
              onClick={() => { onCreateClick(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            >
              <Plus size={12} />
              <span>New project from selection…</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
