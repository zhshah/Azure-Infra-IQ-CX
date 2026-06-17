/**
 * ProjectWorkspace — the detail view for a saved project ("Saved Project Workspace").
 *
 * Opens when a user clicks "Open Workspace" on a project card. Three sections:
 *   1. Overview     — the project's resources, type breakdown, quick stats.
 *   2. Tags & Context — the resource-level custom tags (RTO / RPO / Criticality / DR_Tier / …)
 *                       that ground the AI. Reuses the existing BulkTagEditorModal.
 *   3. Assessments  — pick a category (BCDR, Security, Backup, Resilience, Migration, Cost,
 *                     Update Mgmt, Well-Architected), run a tag-grounded AI assessment scoped
 *                     to this project, and view the score / findings / recommendations + history.
 *
 * 100% additive: it consumes existing endpoints (/api/projects, /api/tags/*) plus the new
 * /api/projects/{id}/assess + /api/projects/{id}/assessments endpoints. It does not change
 * any existing dashboard behaviour.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Play, Tag as TagIcon, Loader2, Trash2, Clock, ShieldCheck,
  LayoutGrid, MapPin, FolderTree, AlertTriangle, Lightbulb, Sparkles, ChevronRight,
  FileText, FileSpreadsheet, Info, Plus, X,
} from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { asText } from '../utils/safeText'
import { DonutChart, SeverityBadge } from './shared/ModuleWidgets'
import BulkTagEditorModal from './BulkTagEditorModal'
import ResourceTable from './ResourceTable'

// Display metadata for the 8 categories (keys MUST match the backend catalogue).
const CATEGORY_META = {
  bcdr:       { label: 'BCDR',             icon: '🛡️', blurb: 'Business continuity & disaster recovery readiness', color: '#0ea5e9' },
  security:   { label: 'Security',         icon: '🔐', blurb: 'Security posture, exposure & compliance',           color: '#ef4444' },
  backup:     { label: 'Backup & DR',      icon: '💾', blurb: 'Backup coverage & data protection vs RPO',          color: '#22c55e' },
  resilience: { label: 'Resilience',       icon: '♻️', blurb: 'High availability & fault tolerance',               color: '#8b5cf6' },
  migration:  { label: 'Migration',        icon: '🚀', blurb: 'Modernization & migration paths (5R)',              color: '#f97316' },
  cost:       { label: 'Cost / FinOps',    icon: '💰', blurb: 'Rightsizing, waste & commitment coverage',          color: '#f59e0b' },
  updates:    { label: 'Update Mgmt',      icon: '🔄', blurb: 'Patch & update compliance',                         color: '#06b6d4' },
  waf:        { label: 'Well-Architected', icon: '🏛️', blurb: 'Balanced five-pillar WAF review',                   color: '#6366f1' },
}

const SCORE_COLOR = (s) => (s >= 70 ? '#22c55e' : s >= 50 ? '#f59e0b' : s >= 30 ? '#f97316' : '#ef4444')
const PRIORITY_STYLE = {
  P1: 'bg-red-900/40 text-red-300 border-red-800/50',
  P2: 'bg-amber-900/40 text-amber-300 border-amber-800/50',
  P3: 'bg-blue-900/40 text-blue-300 border-blue-800/50',
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl px-4 py-3 flex items-center gap-3">
      <Icon size={18} className="text-gray-500 shrink-0" />
      <div className="min-w-0">
        <div className="text-lg font-bold text-white leading-none">{value}</div>
        <div className="text-xs text-gray-500 mt-1">{label}</div>
      </div>
    </div>
  )
}

export default function ProjectWorkspace({ project, allResources = [], onBack, onResourcesChanged }) {
  const [tab, setTab]               = useState('overview')   // overview | tags | assess
  const [categories, setCategories] = useState([])
  const [running, setRunning]       = useState(null)         // category key currently running
  const [result, setResult]         = useState(null)         // displayed assessment result
  const [history, setHistory]       = useState([])
  const [error, setError]           = useState('')
  const [tagModalOpen, setTagModalOpen] = useState(false)
  const [tagsByResource, setTagsByResource] = useState(null) // { resource_id_lower: {k:v} }
  const [tagsLoading, setTagsLoading]       = useState(false)
  const [resourceIds, setResourceIds] = useState(project.resource_ids || [])  // local source of truth for membership
  const [manageOpen, setManageOpen]   = useState(false)

  // Re-sync membership when a different project is opened.
  useEffect(() => { setResourceIds(project.resource_ids || []) }, [project.id])

  // Add/remove resources from this project (persists to the backend + updates the view live).
  async function addResources(ids) {
    if (!ids || !ids.length) return
    await api.addProjectResources(project.id, ids)
    setResourceIds(prev => {
      const have = new Set(prev.map(s => (s || '').toLowerCase()))
      const merged = [...prev]
      ids.forEach(id => { if (!have.has((id || '').toLowerCase())) merged.push(id) })
      return merged
    })
    setTagsByResource(null)        // force the Tags tab to reload
    onResourcesChanged?.()
  }
  async function removeResources(ids) {
    if (!ids || !ids.length) return
    await api.removeProjectResources(project.id, ids)
    const rm = new Set(ids.map(s => (s || '').toLowerCase()))
    setResourceIds(prev => prev.filter(id => !rm.has((id || '').toLowerCase())))
    setTagsByResource(null)
    onResourcesChanged?.()
  }

  const projectResources = useMemo(() => {
    const ids = new Set((resourceIds || []).map(s => (s || '').toLowerCase()))
    return (allResources || []).filter(r => ids.has((r.resource_id || r.id || '').toLowerCase()))
  }, [resourceIds, allResources])

  // Load categories + history on project change.
  useEffect(() => {
    let alive = true
    api.getProjectAssessmentCategories()
      .then(c => { if (alive) setCategories(c.length ? c : Object.entries(CATEGORY_META).map(([key, m]) => ({ key, label: m.label }))) })
      .catch(() => { if (alive) setCategories(Object.entries(CATEGORY_META).map(([key, m]) => ({ key, label: m.label }))) })
    loadHistory()
    return () => { alive = false }
  }, [project.id])

  // Lazy-load resource tags when the Tags tab is opened (or after a tag save).
  useEffect(() => {
    if (tab !== 'tags' || tagsByResource !== null) return
    loadTags()
  }, [tab])

  function loadHistory() {
    api.listProjectAssessments(project.id).then(setHistory).catch(() => setHistory([]))
  }

  function loadTags() {
    const ids = (resourceIds || [])
    if (!ids.length) { setTagsByResource({}); return }
    setTagsLoading(true)
    api.getProjectResourceTags(ids)
      .then(d => setTagsByResource(d || {}))
      .catch(() => setTagsByResource({}))
      .finally(() => setTagsLoading(false))
  }

  async function runAssessment(category) {
    setRunning(category); setError(''); setResult(null)
    try {
      const resp = await api.runProjectAssessment(project.id, category)
      setResult(resp.result)
      loadHistory()
    } catch (e) {
      setError(e.message || 'Assessment failed')
    } finally {
      setRunning(null)
    }
  }

  async function openHistoryRun(aid) {
    setError('')
    try {
      const rec = await api.getProjectAssessment(project.id, aid)
      setResult(rec.result || null)
      setTab('assess')
    } catch (e) { setError(e.message || 'Failed to load run') }
  }

  async function deleteRun(aid) {
    try {
      await api.deleteProjectAssessment(project.id, aid)
      loadHistory()
    } catch (e) { setError(e.message) }
  }

  // Derived stats
  const regions = new Set(projectResources.map(r => r.location).filter(Boolean))
  const rgs     = new Set(projectResources.map(r => r.resource_group).filter(Boolean))
  const taggedCount = tagsByResource
    ? Object.values(tagsByResource).filter(t => t && Object.keys(t).length).length
    : projectResources.filter(r => {
        const rid = (r.resource_id || r.id || '').toLowerCase()
        return tagsByResource?.[rid] && Object.keys(tagsByResource[rid]).length
      }).length

  const typeBreakdown = Object.entries(
    projectResources.reduce((acc, r) => {
      const t = (r.resource_type || 'unknown').split('/').slice(-1)[0].toLowerCase()
      acc[t] = (acc[t] || 0) + 1
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 border border-gray-700/60 text-gray-300 hover:bg-gray-700 transition-colors"
        >
          <ArrowLeft size={13} /> All Projects
        </button>
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl shrink-0">{project.icon || '📁'}</span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{project.name}</h2>
            {project.description && <p className="text-xs text-gray-500 truncate">{project.description}</p>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-800/60">
        {[
          { key: 'overview', label: 'Overview', icon: LayoutGrid },
          { key: 'tags',     label: 'Tags & Context', icon: TagIcon },
          { key: 'assess',   label: 'Assessments', icon: Sparkles },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={LayoutGrid} label="Resources" value={projectResources.length} />
            <StatCard icon={MapPin}     label="Regions"   value={regions.size} />
            <StatCard icon={FolderTree} label="Resource Groups" value={rgs.size} />
            <StatCard icon={Clock}      label="Assessments run" value={history.length} />
          </div>

          {typeBreakdown.length > 0 && (
            <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-white mb-3">Resource types</h3>
              <div className="flex flex-wrap gap-2">
                {typeBreakdown.map(([type, count]) => (
                  <span key={type} className="px-2.5 py-1 rounded-full text-xs bg-gray-800 border border-gray-700/40 text-gray-300">
                    {type} <span className="text-gray-500">×{count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Resources in this project ({projectResources.length})</h3>
              <button onClick={() => setManageOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors">
                <Plus size={13} /> Manage resources
              </button>
            </div>
            {projectResources.length === 0 ? (
              <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl p-6 text-center">
                <p className="text-xs text-gray-500 mb-3">No resources in this project yet. Click <span className="text-gray-300 font-medium">Manage resources</span> to add some from your estate.</p>
                <button onClick={() => setManageOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors">
                  <Plus size={13} /> Add resources
                </button>
              </div>
            ) : (
              /* Full resource table — same component as the main Resources tab: all properties,
                 status/score/cost/utilisation, and the custom tags (Criticality / RTO / RPO / …). */
              <ResourceTable resources={projectResources} aiEnabled={false} projects={[]} onSaveSelectedAsProject={() => {}} />
            )}
          </div>
        </div>
      )}

      {/* ── Tags & Context ───────────────────────────────────────────────── */}
      {tab === 'tags' && (
        <div className="space-y-5">
          <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="max-w-2xl">
                <h3 className="text-sm font-semibold text-white">Business context tags</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Tags like <span className="text-gray-300">Criticality, DR_Tier, RPO, RTO</span> live on each resource (Azure-style — they
                  stay with the resource). The AI assessment uses them to ground its scoring and recommendations in your business intent.
                </p>
              </div>
              <button
                onClick={() => setTagModalOpen(true)}
                disabled={projectResources.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
              >
                <TagIcon size={13} /> Tag {projectResources.length} resource{projectResources.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>

          <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl p-5">
            {tagsLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading tags…</div>
            ) : projectResources.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No resources in this project.</p>
            ) : (() => {
              // Flatten resources → one row per (resource, tag) so the table scales cleanly
              // even with many resources and many distinct tag values. The resource name and
              // type are grouped (row-spanned) across all of that resource's tag rows.
              const rows = []
              projectResources.forEach(r => {
                const rid = (r.resource_id || r.id || '')
                const name = r.resource_name || rid.split('/').slice(-1)[0] || rid
                const rtype = (r.resource_type || '').split('/').slice(-1)[0]
                const tags = (tagsByResource && (tagsByResource[rid] || tagsByResource[rid.toLowerCase()])) || {}
                const entries = Object.entries(tags)
                if (entries.length === 0) {
                  rows.push({ rid, name, rtype, k: null, v: null, first: true, span: 1 })
                } else {
                  entries.forEach(([k, v], i) => rows.push({ rid, name, rtype, k, v, first: i === 0, span: entries.length }))
                }
              })
              const totalTags = rows.filter(x => x.k).length
              return (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Resource tags</h4>
                    <span className="text-xs text-gray-600">
                      {totalTags} tag{totalTags !== 1 ? 's' : ''} · {projectResources.length} resource{projectResources.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="max-h-96 overflow-auto rounded-lg border border-gray-800/60">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-gray-800/90 text-gray-400">
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-700/60">Resource</th>
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-700/60">Type</th>
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-700/60">Tag</th>
                          <th className="text-left font-semibold px-3 py-2 border-b border-gray-700/60">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={row.rid + '|' + (row.k || i)} className="hover:bg-gray-800/30">
                            {row.first && (
                              <>
                                <td rowSpan={row.span} className="align-top px-3 py-2 border-b border-r border-gray-800/50 text-gray-200 font-medium">
                                  <span className="block truncate max-w-[15rem]" title={row.name}>{row.name}</span>
                                </td>
                                <td rowSpan={row.span} className="align-top px-3 py-2 border-b border-r border-gray-800/50 text-gray-500 whitespace-nowrap">
                                  {row.rtype || '—'}
                                </td>
                              </>
                            )}
                            {row.k ? (
                              <>
                                <td className="px-3 py-2 border-b border-gray-800/50 text-gray-400 whitespace-nowrap">{row.k}</td>
                                <td className="px-3 py-2 border-b border-gray-800/50">
                                  <span className="inline-block px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700/50 text-gray-200">{String(row.v)}</span>
                                </td>
                              </>
                            ) : (
                              <td colSpan={2} className="px-3 py-2 border-b border-gray-800/50 text-gray-600 italic">No tags applied</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ── Assessments ──────────────────────────────────────────────────── */}
      {tab === 'assess' && (
        <div className="space-y-5">
          {/* Category picker */}
          <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-1">Run an AI assessment</h3>
            <p className="text-xs text-gray-500 mb-4">
              Choose a category. The AI analyzes <span className="text-gray-300">only this project's {projectResources.length} resource{projectResources.length !== 1 ? 's' : ''}</span>, grounded on their tags, and returns a score with findings & recommendations.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(categories.length ? categories : Object.keys(CATEGORY_META).map(key => ({ key }))).map(({ key }) => {
                const meta = CATEGORY_META[key] || { label: key, icon: '📊', blurb: '', color: '#3b82f6' }
                const isRunning = running === key
                return (
                  <button
                    key={key}
                    onClick={() => runAssessment(key)}
                    disabled={!!running || projectResources.length === 0}
                    className="text-left bg-gray-800/60 border border-gray-700/50 rounded-xl p-3 hover:border-blue-600/50 hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                    style={{ borderLeft: `3px solid ${meta.color}` }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xl">{meta.icon}</span>
                      {isRunning
                        ? <Loader2 size={14} className="animate-spin text-blue-400" />
                        : <Play size={13} className="text-gray-600 group-hover:text-blue-400" />}
                    </div>
                    <div className="text-sm font-semibold text-white mt-2">{meta.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5 leading-snug">{meta.blurb}</div>
                  </button>
                )
              })}
            </div>
            {running && (
              <div className="mt-4 flex items-center gap-2 text-sm text-blue-300">
                <Loader2 size={14} className="animate-spin" />
                Analyzing {projectResources.length} resources with AI… this can take 10–30 seconds.
              </div>
            )}
          </div>

          {/* Result */}
          {result && <AssessmentResult result={result} project={project} resources={projectResources} />}

          {/* History */}
          {history.length > 0 && (
            <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-white mb-3">Past assessments</h3>
              <div className="space-y-1.5">
                {history.map(h => {
                  const meta = CATEGORY_META[h.category] || { label: h.category_label || h.category, icon: '📊' }
                  return (
                    <div key={h.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-800/60 transition-colors border-b border-gray-800/40 last:border-0">
                      <span className="text-lg shrink-0">{meta.icon}</span>
                      <button onClick={() => openHistoryRun(h.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                        <span className="text-sm text-gray-200 truncate">{h.category_label || meta.label}</span>
                        <span
                          className="px-1.5 py-0.5 rounded text-xs font-semibold shrink-0"
                          style={{ background: `${SCORE_COLOR(h.score ?? 0)}22`, color: SCORE_COLOR(h.score ?? 0) }}
                        >
                          {h.score ?? '—'}{h.score != null ? '/100' : ''}
                        </span>
                        <span className="text-xs text-gray-600 shrink-0">{h.score_label}</span>
                        <span className="text-xs text-gray-600 ml-auto shrink-0">
                          {h.created_at ? new Date(h.created_at).toLocaleString() : ''}
                        </span>
                      </button>
                      <ChevronRight size={14} className="text-gray-700 shrink-0" />
                      <button onClick={() => deleteRun(h.id)} className="p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/20 shrink-0" title="Delete run">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bulk tag editor — reuses the existing tag system */}
      {tagModalOpen && (
        <BulkTagEditorModal
          resources={projectResources}
          onClose={() => setTagModalOpen(false)}
          onSaved={() => { setTagsByResource(null); loadTags() }}
        />
      )}

      {/* Add / remove resources to-from this project */}
      {manageOpen && (
        <ManageResourcesModal
          project={project}
          allResources={allResources}
          currentIds={resourceIds}
          onClose={() => setManageOpen(false)}
          onAdd={addResources}
          onRemove={removeResources}
        />
      )}
    </div>
  )
}

// ── Manage resources (add from estate / remove) ───────────────────────────────
function ManageResourcesModal({ project, allResources, currentIds, onClose, onAdd, onRemove }) {
  const [busy, setBusy] = useState(false)

  const currentSet = useMemo(() => new Set((currentIds || []).map(s => (s || '').toLowerCase())), [currentIds])
  const rname = (r) => r.resource_name || (r.resource_id || r.id || '').split('/').slice(-1)[0]
  const rtype = (r) => (r.resource_type || '').split('/').slice(-1)[0]

  const inProject = useMemo(
    () => (allResources || []).filter(r => currentSet.has((r.resource_id || r.id || '').toLowerCase())),
    [allResources, currentSet],
  )
  const available = useMemo(
    () => (allResources || []).filter(r => !currentSet.has((r.resource_id || r.id || '').toLowerCase())),
    [allResources, currentSet],
  )

  const doAdd = async (ids) => { setBusy(true); try { await onAdd(ids) } catch { /* surfaced upstream */ } finally { setBusy(false) } }
  const doRemove = async (id) => { setBusy(true); try { await onRemove([id]) } catch { /* noop */ } finally { setBusy(false) } }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[96vw] max-w-[1400px] h-[90vh] bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">Manage resources — {project.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{inProject.length} in project · {available.length} available to add</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 shrink-0"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Current members — compact chips with remove */}
          {inProject.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">In this project ({inProject.length})</h4>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-auto">
                {inProject.map(r => (
                  <span key={r.resource_id || r.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800/60 border border-gray-700/40 text-xs text-gray-200">
                    <span className="truncate max-w-[16rem]" title={rname(r)}>{rname(r)}</span>
                    <span className="text-[10px] text-gray-500">{rtype(r)}</span>
                    <button onClick={() => doRemove(r.resource_id || r.id)} disabled={busy}
                      className="text-gray-500 hover:text-red-400 disabled:opacity-40" title="Remove from project"><X size={12} /></button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Add from estate — full resource table (filter / search / sort / all columns) */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Add resources from your estate</h4>
            <p className="text-xs text-gray-500 mb-3">Filter, search and sort exactly like the main Resources view, tick the resources you want, then click <span className="text-gray-300 font-medium">Add to project</span>.</p>
            <ResourceTable
              resources={available}
              aiEnabled={false}
              onAddSelected={doAdd}
              addSelectedLabel="Add to project"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-800 flex justify-end shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200">Done</button>
        </div>
      </div>
    </div>
  )
}

// ── Result renderer ───────────────────────────────────────────────────────────

function AssessmentResult({ result, project, resources = [] }) {
  const meta = CATEGORY_META[result.category] || { label: result.category_label || result.category, icon: '📊', color: '#3b82f6' }
  const notApplicable = result.overall_score == null || result.applicability === 'not_applicable' || result.score_label === 'Not Applicable'
  const score = result.overall_score ?? 0
  const [exporting, setExporting] = useState(null)   // 'pdf' | 'xlsx' | null
  const [exportErr, setExportErr] = useState('')
  const exportPdf = async () => {
    setExporting('pdf'); setExportErr('')
    try {
      const { generateAssessmentPDF } = await import('../utils/assessmentExport')
      const blob = await generateAssessmentPDF(result, project, resources)
      const base = `${(project?.name || 'project')}-${result.category || 'assessment'}`.replace(/[^a-z0-9-_]+/gi, '_')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${base}-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch (e) { setExportErr(e?.message || 'PDF export failed') }
    finally { setExporting(null) }
  }
  const exportXlsx = async () => {
    if (!project?.id) { setExportErr('Open this project to export Excel'); return }
    setExporting('xlsx'); setExportErr('')
    try { await api.exportProjectAssessmentXlsx(project.id, result) }
    catch (e) { setExportErr(e?.message || 'Excel export failed') }
    finally { setExporting(null) }
  }
  const findings = Array.isArray(result.findings) ? result.findings : []
  const recs = Array.isArray(result.recommendations) ? result.recommendations : []
  const pillars = Array.isArray(result.pillar_scores) ? result.pillar_scores : []
  const insights = Array.isArray(result.tag_driven_insights) ? result.tag_driven_insights : []
  const risks = Array.isArray(result.key_risks) ? result.key_risks : []

  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl overflow-hidden">
      {/* Header band */}
      <div className="flex items-center gap-5 p-5 border-b border-gray-800/60" style={{ background: `${notApplicable ? '#64748b' : meta.color}10` }}>
        {notApplicable ? (
          <div className="flex flex-col items-center gap-2 shrink-0" title="This assessment category does not apply to the resource type(s) in this project">
            <div className="w-[90px] h-[90px] rounded-full border-[6px] border-slate-600/50 flex items-center justify-center">
              <span className="text-slate-300 text-base font-bold">N/A</span>
            </div>
          </div>
        ) : (
          <DonutChart value={score} max={100} color={SCORE_COLOR(score)} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl">{meta.icon}</span>
            <h3 className="text-base font-bold text-white">{result.category_label || meta.label} Assessment</h3>
            <span className="px-2 py-0.5 rounded text-xs font-semibold"
              style={notApplicable ? { background: '#64748b22', color: '#cbd5e1' } : { background: `${SCORE_COLOR(score)}22`, color: SCORE_COLOR(score) }}>
              {result.score_label || '—'}
            </span>
          </div>
          <p className="text-sm text-gray-300 mt-2 leading-relaxed">{result.executive_summary || 'No summary returned.'}</p>
          {notApplicable && (
            <div className="mt-2 flex items-start gap-2 text-xs text-slate-300 bg-slate-700/20 border border-slate-600/40 rounded-lg px-3 py-2">
              <Info size={13} className="mt-0.5 shrink-0 text-slate-400" />
              <span>This category doesn't directly apply to the resource type(s) in this project{result.applicability_note ? ` — ${asText(result.applicability_note)}` : '.'} The items below are type-appropriate alternatives, not failures.</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-gray-500">
            <span>{result.resource_count ?? 0} resources analyzed</span>
            {typeof result.tag_coverage_pct === 'number' && (
              <span className="flex items-center gap-1"><TagIcon size={11} /> {result.tag_coverage_pct}% tagged</span>
            )}
            {result.model && <span className="flex items-center gap-1"><Sparkles size={11} /> {result.model}</span>}
            {result._partial && <span className="text-amber-500">• partial (truncated)</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0 self-start">
          <button onClick={exportPdf} disabled={!!exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-800 hover:bg-gray-700 border border-gray-700/60 text-gray-200 transition-colors disabled:opacity-50"
            title="Download a board-ready PDF of this assessment">
            {exporting === 'pdf' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Export PDF
          </button>
          <button onClick={exportXlsx} disabled={!!exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-50"
            title="Download a rich multi-sheet Excel workbook (summary, findings, recommendations, resources)">
            {exporting === 'xlsx' ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />} Export Excel
          </button>
          {exportErr && <span className="text-[10px] text-red-400 max-w-[9rem] leading-tight text-right">{exportErr}</span>}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Pillar scores */}
        {pillars.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Pillar scores</h4>
            <div className="space-y-2">
              {pillars.map((p, i) => {
                const ps = typeof p.score === 'number' ? p.score : 0
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-56 shrink-0 truncate" title={p.name}>{p.name}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, ps))}%`, background: SCORE_COLOR(ps) }} />
                    </div>
                    <span className="text-xs font-semibold w-9 text-right" style={{ color: SCORE_COLOR(ps) }}>{ps}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Tag-driven insights */}
        {insights.length > 0 && (
          <div className="bg-blue-900/15 border border-blue-800/30 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-blue-300 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <TagIcon size={12} /> Tag-driven insights
            </h4>
            <ul className="space-y-1.5">
              {insights.map((ins, i) => (
                <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                  <span className="text-blue-400 mt-1">•</span> {ins}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Findings */}
        {findings.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <AlertTriangle size={12} /> Findings ({findings.length})
            </h4>
            <div className="space-y-2">
              {findings.map((f, i) => (
                <div key={i} className="bg-gray-800/50 border border-gray-700/40 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={f.severity} />
                    <span className="text-sm font-semibold text-white">{f.title}</span>
                  </div>
                  {f.detail && <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{f.detail}</p>}
                  <AffectedResources items={f.affected_resources} count={f.affected_count} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {recs.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Lightbulb size={12} /> Recommendations ({recs.length})
            </h4>
            <div className="space-y-2">
              {recs.map((r, i) => (
                <div key={i} className="bg-gray-800/50 border border-gray-700/40 rounded-xl p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.priority && (
                      <span className={clsx('px-1.5 py-0.5 rounded text-xs border font-semibold', PRIORITY_STYLE[r.priority] || PRIORITY_STYLE.P3)}>
                        {r.priority}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-white">{r.action}</span>
                    {r.effort && <span className="text-xs text-gray-500 ml-auto">Effort: {r.effort}</span>}
                  </div>
                  {r.rationale && <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{r.rationale}</p>}
                  {r.business_impact && <p className="text-xs text-gray-500 mt-1"><span className="text-gray-600">Impact:</span> {r.business_impact}</p>}
                  <AffectedResources items={r.affected_resources} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Key risks */}
        {risks.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Key risks & data gaps</h4>
            <ul className="space-y-1">
              {risks.map((rk, i) => (
                <li key={i} className="text-xs text-gray-400 flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5">⚠</span> {rk}
                </li>
              ))}
            </ul>
          </div>
        )}

        {findings.length === 0 && recs.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-green-400">
            <ShieldCheck size={16} /> No material findings — this project looks healthy for this category.
          </div>
        )}
      </div>
    </div>
  )
}

function AffectedResources({ items, count }) {
  if (!Array.isArray(items) || items.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {items.slice(0, 5).map((a, i) => (
        <span key={i} className="px-1.5 py-0.5 rounded text-xs bg-gray-900/70 border border-gray-700/50 text-gray-400" title={a.resource_id}>
          {a.resource_name || a.resource_id || 'resource'}
        </span>
      ))}
      {count > 5 && <span className="text-xs text-gray-600">+{count - 5} more</span>}
    </div>
  )
}
