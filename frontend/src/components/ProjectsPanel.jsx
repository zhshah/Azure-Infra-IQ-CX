/**
 * ProjectsPanel — "Projects" tab showing all saved projects/workloads.
 *
 * Displayed under the "Projects" nav tab. Lets users:
 *   - View all saved projects with their resource count & metadata
 *   - Switch active project (same as header switcher)
 *   - Delete projects
 *   - See which resources are in each project
 */
import React, { useState } from 'react'
import { FolderOpen, Trash2, ArrowRight, Globe, Edit2, Users, LayoutGrid, X, LayoutDashboard } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import ProjectWorkspace from './ProjectWorkspace'

function ProjectCard({ project, isActive, onActivate, onDelete, onOpenWorkspace, allResources }) {
  const [expanded, setExpanded] = useState(false)

  const projectResources = allResources.filter(r =>
    project.resource_ids.includes((r.resource_id || r.id || '').toLowerCase())
  )

  return (
    <div
      className={clsx(
        'rounded-2xl border transition-all',
        isActive
          ? 'border-blue-600/50 bg-blue-900/10'
          : 'border-gray-800/60 bg-gray-900/60 hover:border-gray-700/60',
      )}
      style={{ borderLeft: `4px solid ${project.color || '#3b82f6'}` }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl shrink-0">{project.icon || '📁'}</span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">{project.name}</h3>
              {project.description && (
                <p className="text-xs text-gray-500 mt-0.5 truncate">{project.description}</p>
              )}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-600">
                <span className="flex items-center gap-1">
                  <LayoutGrid size={10} />
                  {project.resource_count} resources
                </span>
                <span>
                  {new Date(project.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onOpenWorkspace(project)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              title="Open the project workspace — tag resources and run AI assessments"
            >
              <LayoutDashboard size={11} /> Workspace
            </button>
            {isActive ? (
              <button
                onClick={() => onActivate(null)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-900/40 border border-blue-600/50 text-blue-300 hover:bg-blue-900/60 transition-colors"
              >
                <Globe size={11} /> All resources
              </button>
            ) : (
              <button
                onClick={() => onActivate(project.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-800 border border-gray-700/60 text-gray-300 hover:bg-gray-700 transition-colors"
                title="Filter all dashboards to this project's resources"
              >
                Filter <ArrowRight size={11} />
              </button>
            )}
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1.5 rounded-lg text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
              title="View resources"
            >
              <Users size={13} />
            </button>
            <button
              onClick={() => onDelete(project.id, project.name)}
              className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors"
              title="Delete project"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Resource type breakdown */}
        {project.resource_count > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Object.entries(
              projectResources.reduce((acc, r) => {
                const t = (r.resource_type || 'unknown').split('/').slice(-1)[0].toLowerCase()
                acc[t] = (acc[t] || 0) + 1
                return acc
              }, {})
            )
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([type, count]) => (
                <span
                  key={type}
                  className="px-2 py-0.5 rounded-full text-xs bg-gray-800 border border-gray-700/40 text-gray-400"
                >
                  {type} <span className="text-gray-600">×{count}</span>
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Expanded resource list */}
      {expanded && (
        <div className="border-t border-gray-800/60 px-4 py-3">
          <div className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">
            Resources ({projectResources.length})
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {projectResources.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No matching resources in current data</p>
            ) : (
              projectResources.map(r => {
                const rid = r.resource_id || r.id || ''
                const name = rid.split('/').slice(-1)[0] || rid
                return (
                  <div key={rid} className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: project.color || '#3b82f6' }} />
                    <span className="truncate">{name}</span>
                    <span className="text-gray-700 shrink-0 ml-auto">
                      {(r.resource_type || '').split('/').slice(-1)[0]}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProjectsPanel({ projects, activeProjectId, onSelectProject, onDeleteProject, allResources }) {
  const [confirmDelete, setConfirmDelete] = useState(null) // { id, name }
  const [workspaceId, setWorkspaceId] = useState(null)

  const workspaceProject = workspaceId ? projects.find(p => p.id === workspaceId) : null
  if (workspaceProject) {
    return (
      <ProjectWorkspace
        project={workspaceProject}
        allResources={allResources}
        onBack={() => setWorkspaceId(null)}
      />
    )
  }

  function handleDeleteRequest(id, name) {
    setConfirmDelete({ id, name })
  }

  async function handleDeleteConfirm() {
    if (!confirmDelete) return
    await onDeleteProject(confirmDelete.id)
    setConfirmDelete(null)
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">Projects & Workloads</h2>
            <p className="text-sm text-gray-500 mt-1 max-w-xl">
              Group resources into named projects for focused analysis. Select resources from any view and save them as a project — then all dashboards (Cost, BCDR, Dependencies) will filter to that project.
            </p>
          </div>
          <div className="flex items-center gap-6 text-center">
            <div>
              <div className="text-2xl font-bold text-white">{projects.length}</div>
              <div className="text-xs text-gray-500">Projects</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white">
                {new Set(projects.flatMap(p => p.resource_ids)).size}
              </div>
              <div className="text-xs text-gray-500">Tagged Resources</div>
            </div>
          </div>
        </div>

        {/* How to create tip */}
        {projects.length === 0 && (
          <div className="mt-4 flex items-start gap-3 bg-blue-900/20 border border-blue-700/30 rounded-xl px-4 py-3">
            <span className="text-xl">💡</span>
            <div>
              <p className="text-sm font-medium text-blue-300">How to create a project</p>
              <p className="text-xs text-gray-400 mt-1">
                Go to the <strong className="text-gray-300">Resources</strong> tab → check the boxes next to resources you want to group → click the <strong className="text-gray-300">"Save as Project"</strong> button that appears in the toolbar. You can also filter by subscription, resource group, or tags first, then save the entire filtered view.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Project cards */}
      {projects.length > 0 && (
        <div className="space-y-3">
          {projects.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              isActive={p.id === activeProjectId}
              onActivate={onSelectProject}
              onDelete={handleDeleteRequest}
              onOpenWorkspace={(proj) => setWorkspaceId(proj.id)}
              allResources={allResources}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-700/60 rounded-2xl shadow-2xl w-80 p-6 mx-4">
            <h3 className="text-sm font-semibold text-white mb-2">Delete Project?</h3>
            <p className="text-xs text-gray-400 mb-5">
              <strong className="text-gray-200">"{confirmDelete.name}"</strong> will be permanently deleted. Resources are not affected.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
