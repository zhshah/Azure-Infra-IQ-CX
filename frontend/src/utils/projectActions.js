/**
 * Shared "add resources to an existing project" action.
 * Centralises the API call so EVERY entry point (resource-table dropdown, module list
 * views, Save-as-Project modal) gets identical behaviour: robust project-id resolution,
 * a visible success/error toast, and a refreshed projects list.
 *
 * Previously each call site did `api.addProjectResources(p.id, ids).then(...)` with no
 * feedback and used `p.id` only — which is undefined for assessment/APEX projects that
 * expose `project_id` — so adds silently did nothing. This fixes both.
 */
import { api } from '../api/client'
import { notify } from '../components/Toast'

/** Resolve a usable project id from any project shape (portal `id` or APEX `project_id`). */
export function projectId(p) {
  if (!p) return ''
  return p.id || p.project_id || ''
}

/** Human-friendly project name from any project shape. */
export function projectName(p) {
  if (!p) return ''
  return p.name || p.project_name || 'project'
}

/**
 * Add resource ids to an existing project.
 * @returns the refreshed projects array on success, or null on failure / no-op.
 */
export async function addToExistingProject(id, ids, name) {
  if (!id) {
    notify('Could not add resources — this project has no id. Reopen it from the Projects list and try again.', 'error')
    return null
  }
  if (!ids || !ids.length) {
    notify('Select at least one resource first.', 'info')
    return null
  }
  try {
    await api.addProjectResources(id, ids)
    const updated = await api.getProjects().catch(() => null)
    notify(`Added ${ids.length} resource${ids.length !== 1 ? 's' : ''} to ${name || 'project'}.`, 'success')
    return updated
  } catch (e) {
    notify(`Failed to add resources: ${e?.message || 'unknown error'}`, 'error')
    return null
  }
}
