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
import { notify } from './Toast'
import { asText } from '../utils/safeText'
import { DonutChart, SeverityBadge } from './shared/ModuleWidgets'
import BulkTagEditorModal from './BulkTagEditorModal'
import ResourceTable from './ResourceTable'
import { CustomerIntakeModal } from './BCDRPlanningPanel'

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

export default function ProjectWorkspace({ project, allResources = [], onBack, onResourcesChanged, onDelete }) {
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
  // BCDR Plan tab
  const [bcdrInputs, setBcdrInputs]   = useState({})
  const [bcdrRunning, setBcdrRunning] = useState(false)
  const [bcdrResult, setBcdrResult]   = useState(null)
  const [bcdrError, setBcdrError]     = useState('')
  // Consultant BCDR report (13-section PDF / Excel) — scoped to this project
  const [showConsultIntake, setShowConsultIntake] = useState(false)
  const [consultBusy, setConsultBusy] = useState(null)   // 'pdf' | 'xlsx' | null
  const [consultErr, setConsultErr]   = useState('')
  const [consultInfo, setConsultInfo] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bcdr-customer-info') || '{}') } catch { return {} }
  })

  // Re-sync membership when a different project is opened.
  useEffect(() => { setResourceIds(project.resource_ids || []) }, [project.id])

  // Add/remove resources from this project (persists to the backend + updates the view live).
  async function addResources(ids) {
    if (!ids || !ids.length) return
    // Trust the project the backend returns (its resource_ids are already merged + de-duped)
    // so the live view can NEVER drift from what was actually saved — even on a slow network
    // or rapid consecutive adds. Falls back to an optimistic merge only if no body comes back.
    const updated = await api.addProjectResources(project.id, ids)
    const serverIds = updated && Array.isArray(updated.resource_ids) ? updated.resource_ids : null
    setResourceIds(prev => {
      if (serverIds) return serverIds
      const have = new Set(prev.map(s => (s || '').toLowerCase()))
      const merged = [...prev]
      ids.forEach(id => { if (!have.has((id || '').toLowerCase())) merged.push(id) })
      return merged
    })
    setTagsByResource(null)        // force the Tags tab to reload
    onResourcesChanged?.()
    notify(`Added ${ids.length} resource${ids.length !== 1 ? 's' : ''} to ${project.name || 'project'}.`, 'success')
  }
  async function removeResources(ids) {
    if (!ids || !ids.length) return
    const updated = await api.removeProjectResources(project.id, ids)
    const serverIds = updated && Array.isArray(updated.resource_ids) ? updated.resource_ids : null
    const rm = new Set(ids.map(s => (s || '').toLowerCase()))
    setResourceIds(prev => serverIds ? serverIds : prev.filter(id => !rm.has((id || '').toLowerCase())))
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

  async function runBcdrPlanFn() {
    setBcdrRunning(true); setBcdrError(''); setBcdrResult(null)
    try {
      const resp = await api.runBcdrPlan(project.id, bcdrInputs)
      setBcdrResult(resp.result)
      loadHistory()
    } catch (e) {
      setBcdrError(e.message || 'BCDR plan failed')
    } finally {
      setBcdrRunning(false)
    }
  }

  function persistConsultInfo(ci) {
    setConsultInfo(ci)
    try { localStorage.setItem('bcdr-customer-info', JSON.stringify(ci)) } catch {}
  }

  async function generateConsultantReport(format) {
    setConsultBusy(format); setConsultErr('')
    try {
      // Merge the BCDR Plan tab's continuity requirements into the report intake so the
      // consultant deliverable is grounded on the SAME inputs as the in-app plan.
      const report = await api.generateBcdrConsultantReport({ ...bcdrInputs, ...consultInfo }, project.id)
      if (format === 'pdf') {
        const { generateBcdrConsultantPDF } = await import('../utils/bcdrConsultantReport')
        const blob = await generateBcdrConsultantPDF(report)
        const base = `${consultInfo.customer_name || project.name || 'Project'}-BCDR-Assessment-Report`.replace(/[^a-z0-9-_]+/gi, '_')
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `${base}-${new Date().toISOString().slice(0, 10)}.pdf`
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
      } else {
        await api.exportBcdrConsultantXlsx(report)
      }
      setShowConsultIntake(false)
      notify('Consultant BCDR report generated', 'success')
    } catch (e) {
      setConsultErr(e?.message || 'Report generation failed')
    } finally {
      setConsultBusy(null)
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
        {onDelete && (
          <button onClick={onDelete}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600/15 border border-red-600/40 text-red-300 hover:bg-red-600/25 transition-colors shrink-0"
            title="Delete this project">
            <Trash2 size={13} /> Delete project
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-800/60">
        {[
          { key: 'overview', label: 'Overview', icon: LayoutGrid },
          { key: 'tags',     label: 'Tags & Context', icon: TagIcon },
          { key: 'assess',   label: 'Assessments', icon: Sparkles },
          { key: 'bcdr',     label: 'BCDR Plan', icon: ShieldCheck },
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
              <ResourceTable resources={projectResources} aiEnabled={false} projects={[]} onRemoveSelected={removeResources} removeSelectedLabel="Remove from project" />
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
              Choose a category for a quick, <span className="text-gray-300">scored health-check</span> of this project's {projectResources.length} resource{projectResources.length !== 1 ? 's' : ''}, grounded on their tags — you get a score plus top findings & recommendations in ~30s.
              <br />
              <span className="text-gray-600">Need a full, client-ready BCDR document (RTO/RPO, board-ready PDF/Excel) instead? Use the <span className="text-sky-400 font-medium">BCDR Plan</span> tab.</span>
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

      {/* ── BCDR Plan ────────────────────────────────────────────────────── */}
      {tab === 'bcdr' && (
        <div className="space-y-5">
          <div className="bg-gradient-to-br from-sky-900/20 to-gray-900/40 border border-sky-800/30 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck size={20} className="text-sky-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-white">Full BCDR Plan &amp; Consultant Report</h3>
                <p className="text-xs text-gray-400 mt-1 max-w-3xl leading-relaxed">
                  The in-depth, <span className="text-gray-200">client-ready</span> BCDR deliverable for this project&apos;s {projectResources.length} resource{projectResources.length !== 1 ? 's' : ''} — Critical Services
                  Identification, Workload Prioritization, Infrastructure Modernization and FinOps &amp; Cost Visibility — grounded on each
                  resource&apos;s posture, your tags, and the continuity requirements below. Fill in the requirements, click <span className="text-sky-300 font-medium">Generate BCDR Plan</span> to preview it here, then <span className="text-sky-300 font-medium">Generate Consultant Report</span> to export a board-ready PDF / multi-sheet Excel.
                </p>
                <p className="text-[11px] text-gray-500 mt-2">
                  Just want a quick readiness score? Run the 🛡️ <span className="text-sky-400 font-medium">BCDR</span> card on the <span className="text-gray-300">Assessments</span> tab — that&apos;s the fast scored check; this tab is the full document.
                </p>
              </div>
              <button
                onClick={() => { if (!consultInfo.customer_name && project?.name) persistConsultInfo({ ...consultInfo, customer_name: project.name }); setShowConsultIntake(true) }}
                disabled={projectResources.length === 0}
                className="shrink-0 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg flex items-center gap-2 shadow-lg shadow-blue-900/30"
                title="Generate the full 13-section consultant BCDR report (PDF + Excel), scoped to this project"
              >
                <FileText size={15} /> Generate Consultant Report
              </button>
            </div>
          </div>

          {bcdrError && (
            <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3 text-sm text-red-300">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {bcdrError}
            </div>
          )}

          <BcdrPlanInputs
            inputs={bcdrInputs}
            setInputs={setBcdrInputs}
            project={project}
            disabled={bcdrRunning}
            canRun={projectResources.length > 0}
            running={bcdrRunning}
            onRun={runBcdrPlanFn}
          />

          {bcdrRunning && (
            <div className="flex items-center gap-2 text-sm text-sky-300">
              <Loader2 size={14} className="animate-spin" />
              Building the BCDR plan for {projectResources.length} resources with AI… this can take 30–60 seconds.
            </div>
          )}

          {bcdrResult && <BcdrPlanResult result={bcdrResult} project={project} resources={projectResources} />}
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

      {/* Consultant BCDR report (13-section PDF / Excel) — scoped to this project */}
      {showConsultIntake && (
        <CustomerIntakeModal
          customerInfo={consultInfo}
          onChange={persistConsultInfo}
          onClose={() => setShowConsultIntake(false)}
          onGenerate={generateConsultantReport}
          busy={consultBusy}
          error={consultErr}
        />
      )}
    </div>
  )
}

// ── Manage resources (add from estate / remove) ───────────────────────────────
function ManageResourcesModal({ project, allResources, currentIds, onClose, onAdd, onRemove }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [addingId, setAddingId] = useState(null)     // per-row "+ Add" in flight
  const [removingId, setRemovingId] = useState(null) // per-row remove in flight
  // End-user filters for finding the relevant resources to add.
  const [subFilter, setSubFilter]   = useState('')
  const [locFilter, setLocFilter]   = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [rgFilter, setRgFilter]     = useState('')
  const [tagFilter, setTagFilter]   = useState('')   // "key=value"
  const [subNameMap, setSubNameMap] = useState({})
  // Resolve subscription display names for the Subscription filter.
  useEffect(() => {
    api._request('/subscriptions').then(list => {
      if (!Array.isArray(list)) return
      const m = {}
      for (const s of list) { if (s && s.subscription_id) m[s.subscription_id] = s.subscription_name || s.subscription_id }
      setSubNameMap(m)
    }).catch(() => {})
  }, [])

  const currentSet = useMemo(() => new Set((currentIds || []).map(s => (s || '').toLowerCase())), [currentIds])
  const rname = (r) => r.resource_name || (r.resource_id || r.id || '').split('/').slice(-1)[0]
  const rtype = (r) => (r.resource_type || '').split('/').slice(-1)[0]
  const rgOf = (r) => r.resource_group || r.resourceGroup || ''
  const typeOf = (r) => r.resource_type || r.type || ''
  const subName = (id) => subNameMap[id] || (id ? (id.length > 12 ? id.slice(0, 8) + '\u2026' : id) : '\u2014')

  const inProject = useMemo(
    () => (allResources || []).filter(r => currentSet.has((r.resource_id || r.id || '').toLowerCase())),
    [allResources, currentSet],
  )
  const available = useMemo(
    () => (allResources || []).filter(r => !currentSet.has((r.resource_id || r.id || '').toLowerCase())),
    [allResources, currentSet],
  )

  const doAdd = async (ids) => {
    if (!project?.id) { setErr('This project has no id — reopen it from the Projects list and try again.'); return false }
    if (!ids || !ids.length) { setErr('Pick at least one resource to add.'); return false }
    setErr('')
    try { await onAdd(ids); return true }
    catch (e) { setErr(e?.message || 'Failed to add — please retry.'); return false }
  }

  // Distinct filter options derived from the available estate.
  const subscriptions  = useMemo(() => [...new Set(available.map(r => r.subscription_id).filter(Boolean))].sort((a, b) => subName(a).localeCompare(subName(b))), [available, subNameMap])
  const locations      = useMemo(() => [...new Set(available.map(r => r.location).filter(Boolean))].sort(), [available])
  const types          = useMemo(() => [...new Set(available.map(r => typeOf(r)).filter(Boolean))].sort(), [available])
  const resourceGroups = useMemo(() => [...new Set(available.map(r => rgOf(r)).filter(Boolean))].sort(), [available])
  const tagPairs       = useMemo(() => {
    const s = new Set()
    for (const r of available) { const t = r.tags || {}; for (const k of Object.keys(t)) { if (t[k] != null && t[k] !== '') s.add(`${k}=${t[k]}`) } }
    return [...s].sort()
  }, [available])

  // Search + Sub / Location / Type / RG / Tag filters over the available estate.
  const filteredAvailable = useMemo(() => {
    const q = search.trim().toLowerCase()
    return available.filter(r => {
      if (subFilter && r.subscription_id !== subFilter) return false
      if (locFilter && r.location !== locFilter) return false
      if (typeFilter && typeOf(r) !== typeFilter) return false
      if (rgFilter && rgOf(r) !== rgFilter) return false
      if (tagFilter) { const i = tagFilter.indexOf('='); const k = tagFilter.slice(0, i); const v = tagFilter.slice(i + 1); if (String((r.tags || {})[k] ?? '') !== v) return false }
      if (q) {
        const hay = `${rname(r)} ${rtype(r)} ${rgOf(r)} ${r.location || ''} ${Object.values(r.tags || {}).join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [available, search, subFilter, locFilter, typeFilter, rgFilter, tagFilter])
  const filtersActive = !!(subFilter || locFilter || typeFilter || rgFilter || tagFilter || search)
  const clearFilters = () => { setSubFilter(''); setLocFilter(''); setTypeFilter(''); setRgFilter(''); setTagFilter(''); setSearch('') }
  const selectCls = 'px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-200 focus:outline-none focus:border-blue-500 max-w-[170px] truncate'
  const shown = filteredAvailable.slice(0, 300)
  // Only one add/remove in flight at a time — prevents fast clicks from racing the
  // (1-3s) Azure SQL writes and leaving the project's resource list inconsistent.
  const anyBusy = busy || !!addingId || !!removingId

  // One-click add for a single resource — the easy, can't-get-it-wrong path (no checkboxes).
  const addOne = async (r) => {
    const id = r.resource_id || r.id
    if (!id || addingId) return
    setAddingId(id)
    await doAdd([id])
    setAddingId(null)
  }
  // Add every resource currently shown by the search filter, in one click.
  const addAllShown = async () => {
    const ids = filteredAvailable.map(r => r.resource_id || r.id).filter(Boolean)
    if (!ids.length || busy) return
    setBusy(true)
    await doAdd(ids)
    setBusy(false)
  }
  const removeOne = async (r) => {
    const id = r.resource_id || r.id
    if (!id || removingId) return
    setRemovingId(id); setErr('')
    try { await onRemove([id]) } catch (e) { setErr(e?.message || 'Failed to remove.') } finally { setRemovingId(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[96vw] max-w-[1100px] h-[88vh] bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">Manage resources — {project.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{inProject.length} in project · {available.length} available to add</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 shrink-0"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col p-5 gap-3">
          {err && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-700/50 text-xs text-red-300 shrink-0">
              <AlertTriangle size={13} className="shrink-0" /> {err}
            </div>
          )}

          {/* Current members — chips with one-click remove */}
          {inProject.length > 0 && (
            <div className="shrink-0">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">In this project ({inProject.length})</h4>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-auto">
                {inProject.map(r => (
                  <span key={r.resource_id || r.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-900/30 border border-blue-800/40 text-xs text-gray-100">
                    <span className="truncate max-w-[16rem]" title={rname(r)}>{rname(r)}</span>
                    <span className="text-[10px] text-gray-500">{rtype(r)}</span>
                    <button onClick={() => removeOne(r)} disabled={anyBusy}
                      className="text-gray-400 hover:text-red-400 disabled:opacity-40" title="Remove from project">
                      {removingId === (r.resource_id || r.id) ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Add from estate — one click per row, no checkboxes */}
          <div className="flex items-center justify-between gap-3 shrink-0">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Add resources — click <span className="text-blue-300">+ Add</span> on any row</h4>
            {filteredAvailable.length > 0 && (
              <button onClick={addAllShown} disabled={anyBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-70 disabled:cursor-wait text-white text-xs font-semibold">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                {busy ? 'Adding\u2026' : `Add all shown (${filteredAvailable.length})`}
              </button>
            )}
          </div>
          {/* Filters — help the end user narrow down to the relevant resources */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select value={subFilter} onChange={e => setSubFilter(e.target.value)} className={selectCls} title="Subscription">
              <option value="">All subscriptions</option>
              {subscriptions.map(s => <option key={s} value={s}>{subName(s)}</option>)}
            </select>
            <select value={locFilter} onChange={e => setLocFilter(e.target.value)} className={selectCls} title="Location">
              <option value="">All locations</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={selectCls} title="Resource type">
              <option value="">All resource types</option>
              {types.map(t => <option key={t} value={t}>{t.split('/').slice(-1)[0]}</option>)}
            </select>
            <select value={rgFilter} onChange={e => setRgFilter(e.target.value)} className={selectCls} title="Resource group">
              <option value="">All resource groups</option>
              {resourceGroups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} className={selectCls} title="Tag">
              <option value="">All tags</option>
              {tagPairs.map(p => <option key={p} value={p}>{p.replace('=', ': ')}</option>)}
            </select>
            {filtersActive && (
              <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 px-2 py-1.5" title="Clear all filters">
                <X size={12} /> Clear
              </button>
            )}
            <span className="ml-auto text-xs text-gray-500">{filteredAvailable.length} match{filteredAvailable.length !== 1 ? 'es' : ''}</span>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, type, resource group, location or tag…"
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 shrink-0"
          />

          <div className="flex-1 overflow-y-auto rounded-lg border border-gray-800 divide-y divide-gray-800/70">
            {shown.length === 0 && (
              <div className="p-6 text-center text-xs text-gray-500">{available.length === 0 ? 'No resources available to add.' : 'No resources match your search.'}</div>
            )}
            {shown.map(r => {
              const id = r.resource_id || r.id
              const adding = addingId === id
              return (
                <div key={id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-800/40">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-100 truncate" title={rname(r)}>{rname(r)}</div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {rtype(r)}{(r.resource_group || r.resourceGroup) ? ` · ${r.resource_group || r.resourceGroup}` : ''}{r.location ? ` · ${r.location}` : ''}
                    </div>
                  </div>
                  <button onClick={() => addOne(r)} disabled={anyBusy}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-70 disabled:cursor-wait text-white text-xs font-semibold">
                    {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    {adding ? 'Adding\u2026' : 'Add'}
                  </button>
                </div>
              )
            })}
            {filteredAvailable.length > shown.length && (
              <div className="p-3 text-center text-[11px] text-gray-500">Showing first {shown.length} of {filteredAvailable.length}. Refine your search to see more.</div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-800 flex justify-between items-center shrink-0">
          <span className="text-xs text-gray-500">{inProject.length} resource{inProject.length !== 1 ? 's' : ''} in this project</span>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white">Done</button>
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

// ── BCDR Plan: business-requirements input form ───────────────────────────────
const DATA_CLASSES = ['Public', 'Internal', 'Confidential', 'Highly Confidential', 'Restricted']
const DR_STRATEGIES = ['Backup & Restore', 'Pilot Light', 'Warm Standby (Active-Passive)', 'Active-Active (Multi-region)', 'Paired-region failover']
const SKU_STRATEGIES = ['Same as source (full-size)', 'Scaled-down (cost-optimized)', 'Minimal (pilot light)', 'Auto-scale on failover']
const BUDGETS = ['Cost-optimized', 'Balanced', 'Resilience-first']
const INDUSTRIES = ['Financial Services / Banking', 'Healthcare / Life Sciences', 'Government / Public Sector', 'Retail / E-commerce', 'Manufacturing', 'Energy / Utilities', 'Telecommunications', 'Technology / SaaS', 'Education', 'Transportation / Logistics', 'Media / Entertainment', 'Other']
const DATA_RESIDENCY = ['No constraint', 'In-country only', 'In-region (geo) only', 'EU only', 'Specific (see notes)']
const DR_MATURITY = ['None / undefined', 'Backups only', 'Partial DR (some workloads)', 'Documented DR plan (untested)', 'Tested DR (periodic)', 'Automated multi-region failover']
const DR_TEST_FREQ = ['Never', 'Ad-hoc / unplanned', 'Annually', 'Semi-annually', 'Quarterly', 'Monthly']
const OPS_MODELS = ['24×7 in-house', 'Business hours only', 'Follow-the-sun', 'Managed service (MSP)', 'Hybrid (in-house + MSP)']
const UPTIME_SLAS = ['99.9% (three nines)', '99.95%', '99.99% (four nines)', '99.999% (five nines)', 'Best effort', 'No formal SLA']
const NETWORK_TOPOLOGIES = ['Single VNet', 'Hub-and-spoke', 'Virtual WAN (vWAN)', 'Multi-region mesh', 'Isolated / standalone']
const CONNECTIVITY_TYPES = ['ExpressRoute', 'Site-to-Site VPN', 'ExpressRoute + VPN failover', 'Internet only', 'No hybrid connectivity']
const IDENTITY_MODELS = ['Microsoft Entra ID only (cloud-only)', 'Hybrid (Entra Connect + on-prem AD DS)', 'AD FS federated', 'Third-party IdP (Okta / Ping)']
// Azure regions for the primary/DR region pickers. West Europe + North Europe are pinned FIRST because
// they are NCSA- and NIA-certified regions approved for Qatar-based entities to use as DR regions.
const AZURE_REGIONS = [
  'West Europe', 'North Europe',
  'Qatar Central', 'UAE North', 'UAE Central', 'Israel Central', 'South Africa North', 'South Africa West',
  'UK South', 'UK West', 'France Central', 'France South', 'Germany West Central', 'Germany North',
  'Switzerland North', 'Switzerland West', 'Norway East', 'Norway West', 'Sweden Central', 'Sweden South',
  'Poland Central', 'Italy North', 'Spain Central',
  'East US', 'East US 2', 'East US 3', 'Central US', 'North Central US', 'South Central US',
  'West US', 'West US 2', 'West US 3', 'West Central US', 'Canada Central', 'Canada East',
  'Brazil South', 'Brazil Southeast', 'Mexico Central',
  'Southeast Asia', 'East Asia', 'Australia East', 'Australia Southeast', 'Australia Central', 'Australia Central 2',
  'Central India', 'South India', 'West India', 'Japan East', 'Japan West', 'Korea Central', 'Korea South',
]

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      {children}
      {hint ? <p className="text-[10px] text-gray-600 mt-1">{hint}</p> : null}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-gray-950/60 border border-gray-700/60 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-sky-600'

// A <select> with a built-in "Other (specify)…" escape hatch. If the stored value isn't one of the
// predefined options (or the user picks "Other"), a free-text box appears so the customer can enter
// their own value — saved straight into the same field key and fed to the plan + consultant report AI.
function SelectOrOther({ label, hint, value, onChange, options, placeholder, disabled }) {
  const [otherOpen, setOtherOpen] = useState(false)
  const isCustom = !!value && !options.includes(value)
  const showOther = otherOpen || isCustom
  return (
    <Field label={label} hint={hint}>
      <select className={inputCls} disabled={disabled}
        value={showOther ? '__other__' : (value || '')}
        onChange={e => {
          const v = e.target.value
          if (v === '__other__') { setOtherOpen(true); onChange('') }
          else { setOtherOpen(false); onChange(v) }
        }}>
        <option value="">{placeholder || 'Select…'}</option>
        {options.map(c => <option key={c} value={c}>{c}</option>)}
        <option value="__other__">Other (specify)…</option>
      </select>
      {showOther && (
        <input className={`${inputCls} mt-2`} disabled={disabled} autoFocus
          placeholder="Type your own value…"
          value={value || ''} onChange={e => onChange(e.target.value)} />
      )}
    </Field>
  )
}

function BcdrPlanInputs({ inputs, setInputs, project, disabled, canRun, running, onRun }) {
  const set = (k, v) => setInputs(prev => ({ ...prev, [k]: v }))
  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-white mb-1">Customer continuity requirements</h3>
      <p className="text-xs text-gray-500 mb-4">These frame the whole plan and are treated as authoritative for both the in-app plan and the consultant report. Per-resource tags (Criticality / RTO / RPO / DR_Tier) override these for that resource.</p>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-700/40 bg-emerald-950/30 px-3 py-2">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-400" />
        <p className="text-[11px] leading-relaxed text-emerald-200/90">
          <span className="font-semibold text-emerald-100">West Europe</span> and <span className="font-semibold text-emerald-100">North Europe</span> are
          <span className="font-semibold"> NCSA- and NIA-certified</span> Azure regions approved for Qatar-based entities to use as
          disaster-recovery regions for their workloads &mdash; both are listed first in the region drop-downs below.
        </p>
      </div>

      <h4 className="text-[11px] font-semibold text-sky-300/80 uppercase tracking-wide mb-2">Business impact &amp; criticality</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <SelectOrOther label="Industry / sector" disabled={disabled} options={INDUSTRIES}
          value={inputs.industry || ''} onChange={v => set('industry', v)} />
        <Field label="Critical business services" hint="What business processes these resources underpin">
          <input className={inputCls} disabled={disabled} placeholder="e.g. Online banking, claims processing" value={inputs.critical_services || ''} onChange={e => set('critical_services', e.target.value)} />
        </Field>
        <Field label="Cost of downtime ($/hr)" hint="Business impact of an outage">
          <input className={inputCls} disabled={disabled} placeholder="e.g. $50,000/hr" value={inputs.downtime_cost || ''} onChange={e => set('downtime_cost', e.target.value)} />
        </Field>
        <Field label="Max tolerable downtime (MTD)" hint="Absolute limit before unacceptable harm">
          <input className={inputCls} disabled={disabled} placeholder="e.g. 8 hours" value={inputs.mtd || ''} onChange={e => set('mtd', e.target.value)} />
        </Field>
        <SelectOrOther label="Data classification" disabled={disabled} options={DATA_CLASSES}
          placeholder={project.data_classification || 'Select…'}
          value={inputs.data_classification || ''} onChange={v => set('data_classification', v)} />
      </div>

      <h4 className="text-[11px] font-semibold text-sky-300/80 uppercase tracking-wide mt-5 mb-2">Recovery targets &amp; compliance</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Field label="Default target RTO" hint="Recovery Time Objective">
          <input className={inputCls} disabled={disabled} placeholder={project.rto_target || 'e.g. 4 hours'} value={inputs.default_rto || ''} onChange={e => set('default_rto', e.target.value)} />
        </Field>
        <Field label="Default target RPO" hint="Recovery Point Objective">
          <input className={inputCls} disabled={disabled} placeholder={project.rpo_target || 'e.g. 1 hour'} value={inputs.default_rpo || ''} onChange={e => set('default_rpo', e.target.value)} />
        </Field>
        <Field label="Compliance / regulatory">
          <input className={inputCls} disabled={disabled} placeholder="e.g. ISO 27001, PCI-DSS, GDPR" value={inputs.compliance || ''} onChange={e => set('compliance', e.target.value)} />
        </Field>
        <SelectOrOther label="Data residency / sovereignty" disabled={disabled} options={DATA_RESIDENCY}
          value={inputs.data_residency || ''} onChange={v => set('data_residency', v)} />
        <SelectOrOther label="Budget sensitivity" disabled={disabled} options={BUDGETS}
          value={inputs.budget_sensitivity || ''} onChange={v => set('budget_sensitivity', v)} />
      </div>

      <h4 className="text-[11px] font-semibold text-sky-300/80 uppercase tracking-wide mt-5 mb-2">DR strategy, geography &amp; operations</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <SelectOrOther label="Preferred DR strategy" disabled={disabled} options={DR_STRATEGIES}
          placeholder={project.dr_tier || 'Select…'}
          value={inputs.dr_strategy || ''} onChange={v => set('dr_strategy', v)} />
        <SelectOrOther label="Primary region" hint="Where workloads run today" disabled={disabled} options={AZURE_REGIONS}
          value={inputs.primary_region || ''} onChange={v => set('primary_region', v)} />
        <SelectOrOther label="Secondary / DR region" hint="NCSA/NIA-certified regions listed first" disabled={disabled} options={AZURE_REGIONS}
          value={inputs.secondary_region || ''} onChange={v => set('secondary_region', v)} />
        <SelectOrOther label="Target-region SKU strategy" hint="Size of the DR-region footprint" disabled={disabled} options={SKU_STRATEGIES}
          value={inputs.target_sku_strategy || ''} onChange={v => set('target_sku_strategy', v)} />
        <SelectOrOther label="Current DR maturity" hint="What exists today" disabled={disabled} options={DR_MATURITY}
          value={inputs.current_dr || ''} onChange={v => set('current_dr', v)} />
        <SelectOrOther label="DR test frequency" disabled={disabled} options={DR_TEST_FREQ}
          value={inputs.dr_test_frequency || ''} onChange={v => set('dr_test_frequency', v)} />
        <SelectOrOther label="Operational coverage" disabled={disabled} options={OPS_MODELS}
          value={inputs.ops_model || ''} onChange={v => set('ops_model', v)} />
        <Field label="Peak / blackout windows" hint="When downtime/failover is unacceptable">
          <input className={inputCls} disabled={disabled} placeholder="e.g. Month-end, Fri 18:00–22:00" value={inputs.peak_windows || ''} onChange={e => set('peak_windows', e.target.value)} />
        </Field>
      </div>

      <h4 className="text-[11px] font-semibold text-sky-300/80 uppercase tracking-wide mt-5 mb-2">Architecture, network &amp; identity</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <SelectOrOther label="Business uptime / SLA commitment" hint="Contractual availability target" disabled={disabled} options={UPTIME_SLAS}
          value={inputs.uptime_sla || ''} onChange={v => set('uptime_sla', v)} />
        <Field label="Zero-data-loss workloads (RPO≈0)" hint="Workloads that tolerate no data loss">
          <input className={inputCls} disabled={disabled} placeholder="e.g. Core banking ledger — or 'None'" value={inputs.zero_data_loss || ''} onChange={e => set('zero_data_loss', e.target.value)} />
        </Field>
        <SelectOrOther label="Network topology" hint="How the estate is connected" disabled={disabled} options={NETWORK_TOPOLOGIES}
          value={inputs.network_topology || ''} onChange={v => set('network_topology', v)} />
        <SelectOrOther label="Hybrid connectivity" hint="On-prem / cross-region link" disabled={disabled} options={CONNECTIVITY_TYPES}
          value={inputs.connectivity || ''} onChange={v => set('connectivity', v)} />
        <SelectOrOther label="Identity model" hint="Critical failover dependency" disabled={disabled} options={IDENTITY_MODELS}
          value={inputs.identity_model || ''} onChange={v => set('identity_model', v)} />
        <Field label="Backup retention requirement" hint="Operational + compliance retention">
          <input className={inputCls} disabled={disabled} placeholder="e.g. 35 days operational; 7 years compliance" value={inputs.backup_retention || ''} onChange={e => set('backup_retention', e.target.value)} />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Additional context (optional)">
          <textarea className={inputCls} rows={2} disabled={disabled} placeholder="Anything the consultant should know — audit requirements, known constraints, planned changes…"
            value={inputs.notes || ''} onChange={e => set('notes', e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {!canRun && <span className="text-xs text-amber-500">Add resources to this project first.</span>}
        <button onClick={onRun} disabled={disabled || !canRun}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50">
          {running ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
          {running ? 'Generating…' : 'Generate BCDR Plan'}
        </button>
      </div>
    </div>
  )
}

// ── BCDR Plan: consultant-document result renderer ────────────────────────────
const RR = ({ label, value }) => (
  <div className="bg-gray-950/50 rounded-lg px-2.5 py-1.5 flex-1 min-w-0">
    <div className="text-[10px] text-gray-600 uppercase tracking-wide">{label}</div>
    <div className="text-xs font-semibold text-gray-200 truncate" title={asText(value)}>{asText(value) || '—'}</div>
  </div>
)

function BcdrSection({ eyebrow, title, count, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-800/60">
        {eyebrow ? <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">{eyebrow}</span> : null}
        <h4 className="text-sm font-bold text-white">{title}</h4>
        {typeof count === 'number' ? <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-sky-900/40 text-sky-300">{count}</span> : null}
      </div>
      {children}
    </div>
  )
}

function BcdrPlanResult({ result, project, resources = [] }) {
  const [exporting, setExporting] = useState(null)
  const [exportErr, setExportErr] = useState('')
  const score = result.overall_resilience_score ?? result.overall_score ?? null
  const cs = result.critical_services || {}
  const wp = result.workload_prioritization || {}
  const mod = result.modernization || {}
  const fin = result.finops || {}
  const pillars = Array.isArray(result.pillar_scores) ? result.pillar_scores : []
  const roadmap = Array.isArray(result.roadmap) ? result.roadmap : []
  const risks = Array.isArray(result.key_risks) ? result.key_risks : []

  const exportPdf = async () => {
    setExporting('pdf'); setExportErr('')
    try {
      const { generateBcdrPlanPDF } = await import('../utils/bcdrPlanExport')
      const blob = await generateBcdrPlanPDF(result, project, resources)
      const base = `${(project?.name || 'project')}-BCDR-Plan`.replace(/[^a-z0-9-_]+/gi, '_')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${base}-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch (e) { setExportErr(e?.message || 'PDF export failed') }
    finally { setExporting(null) }
  }
  const exportXlsx = async () => {
    if (!project?.id) { setExportErr('Open this project to export Excel'); return }
    setExporting('xlsx'); setExportErr('')
    try { await api.exportBcdrPlanXlsx(project.id, result) }
    catch (e) { setExportErr(e?.message || 'Excel export failed') }
    finally { setExporting(null) }
  }

  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl overflow-hidden">
      {/* Header band */}
      <div className="flex items-center gap-5 p-5 border-b border-gray-800/60" style={{ background: `${SCORE_COLOR(score ?? 0)}10` }}>
        <DonutChart value={score ?? 0} max={100} color={SCORE_COLOR(score ?? 0)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <ShieldCheck size={18} className="text-sky-400" />
            <h3 className="text-base font-bold text-white">BCDR Planning &amp; Assessment</h3>
            <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: `${SCORE_COLOR(score ?? 0)}22`, color: SCORE_COLOR(score ?? 0) }}>
              {result.posture_label || result.score_label || '—'}
            </span>
          </div>
          <p className="text-sm text-gray-300 mt-2 leading-relaxed">{asText(result.executive_summary) || 'No summary returned.'}</p>
          {result.maturity_summary ? <p className="text-xs text-gray-500 mt-2 leading-relaxed">{asText(result.maturity_summary)}</p> : null}
          <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-gray-500">
            <span>{result.resource_count ?? 0} resources analyzed</span>
            {result.dependency_summary?.edge_count ? <span>{result.dependency_summary.edge_count} dependencies mapped</span> : null}
            {result.dependency_summary?.spof_count ? <span className="text-amber-400">{result.dependency_summary.spof_count} SPOF</span> : null}
            {typeof result.tag_coverage_pct === 'number' && <span className="flex items-center gap-1"><TagIcon size={11} /> {result.tag_coverage_pct}% tagged</span>}
            {result.model && <span className="flex items-center gap-1"><Sparkles size={11} /> {result.model}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0 self-start">
          <button onClick={exportPdf} disabled={!!exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-800 hover:bg-gray-700 border border-gray-700/60 text-gray-200 transition-colors disabled:opacity-50">
            {exporting === 'pdf' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Export PDF
          </button>
          <button onClick={exportXlsx} disabled={!!exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-50">
            {exporting === 'xlsx' ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />} Export Excel
          </button>
          {exportErr && <span className="text-[10px] text-red-400 max-w-[9rem] leading-tight text-right">{exportErr}</span>}
        </div>
      </div>

      <div className="p-5 space-y-6">
        {/* Pillars */}
        {pillars.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Resilience pillars</h4>
            <div className="space-y-2">
              {pillars.map((p, i) => {
                const ps = typeof p.score === 'number' ? p.score : 0
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-60 shrink-0 truncate" title={p.name}>{p.name}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, ps))}%`, background: SCORE_COLOR(ps) }} />
                    </div>
                    <span className="text-xs font-semibold w-9 text-right" style={{ color: SCORE_COLOR(ps) }}>{ps}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Section 1 — Critical Services */}
        <BcdrSection eyebrow="Section 1" title="Critical Services Identification">
          {cs.summary ? <p className="text-sm text-gray-400 mb-3 leading-relaxed">{asText(cs.summary)}</p> : null}
          {Array.isArray(cs.tiers) && cs.tiers.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              {cs.tiers.map((t, i) => (
                <div key={i} className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-sky-900/40 text-sky-300">{asText(t.tier)}</span>
                    <span className="text-xs text-gray-500">{t.count ?? (t.resources || []).length} resource{(t.count ?? (t.resources || []).length) !== 1 ? 's' : ''}</span>
                  </div>
                  {t.rationale ? <p className="text-xs text-gray-400 mt-1.5">{asText(t.rationale)}</p> : null}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(t.resources || []).slice(0, 10).map((r, j) => (
                      <span key={j} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-900/70 border border-gray-700/50 text-gray-400">{asText(r.resource_name || r.name || r)}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {Array.isArray(cs.key_dependencies) && cs.key_dependencies.length > 0 && (
            <div className="mb-3">
              <h5 className="text-xs font-semibold text-gray-500 mb-1.5">Key dependencies</h5>
              <div className="space-y-1.5">
                {cs.key_dependencies.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-gray-400">
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-900/30 text-blue-300 shrink-0">{asText(d.type)}</span>
                    <span className="text-gray-300">{asText(d.from)} → {asText(d.to)}</span>
                    {d.risk ? <span className="text-gray-500">— {asText(d.risk)}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          )}
          {Array.isArray(cs.bcdr_gaps) && cs.bcdr_gaps.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-gray-500 mb-1.5">BCDR gaps</h5>
              <div className="space-y-2">
                {cs.bcdr_gaps.map((g, i) => (
                  <div key={i} className="bg-gray-800/50 border border-gray-700/40 rounded-xl p-3">
                    <div className="flex items-center gap-2"><SeverityBadge severity={g.severity} /><span className="text-sm font-semibold text-white">{asText(g.title)}</span></div>
                    {g.detail ? <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{asText(g.detail)}</p> : null}
                    <AffectedResources items={g.affected_resources} count={g.affected_count} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </BcdrSection>

        {/* Section 2 — Workload Prioritization */}
        {Array.isArray(wp.workloads) && wp.workloads.length > 0 && (
          <BcdrSection eyebrow="Section 2" title="BCDR & Workload Prioritization" count={wp.workloads.length}>
            {wp.summary ? <p className="text-sm text-gray-400 mb-3 leading-relaxed">{asText(wp.summary)}</p> : null}
            <div className="space-y-2">
              {wp.workloads.map((w, i) => (
                <div key={i} className="bg-gray-800/50 border border-gray-700/40 rounded-xl p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={clsx('px-1.5 py-0.5 rounded text-xs border font-semibold', PRIORITY_STYLE[w.priority] || PRIORITY_STYLE.P3)}>{asText(w.priority) || 'P3'}</span>
                    <span className="text-sm font-semibold text-white">{asText(w.workload)}</span>
                    {w.criticality ? <span className="text-xs text-gray-500 ml-auto">{asText(w.criticality)}</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <RR label="Current RTO" value={w.current_rto} /><RR label="Current RPO" value={w.current_rpo} />
                    <RR label="Target RTO" value={w.target_rto} /><RR label="Target RPO" value={w.target_rpo} />
                  </div>
                  {w.gap ? <p className="text-xs text-gray-400 mt-2"><span className="text-gray-600">Gap:</span> {asText(w.gap)}</p> : null}
                  {w.recommended_dr_approach ? <p className="text-xs text-sky-300 mt-1.5">{asText(w.recommended_dr_approach)}</p> : null}
                  <AffectedResources items={w.affected_resources} />
                </div>
              ))}
            </div>
          </BcdrSection>
        )}

        {/* Section 3 — Modernization */}
        {Array.isArray(mod.candidates) && mod.candidates.length > 0 && (
          <BcdrSection eyebrow="Section 3" title="Infrastructure Modernization" count={mod.candidates.length}>
            {mod.summary ? <p className="text-sm text-gray-400 mb-3 leading-relaxed">{asText(mod.summary)}</p> : null}
            <div className="space-y-2">
              {mod.candidates.map((c, i) => (
                <div key={i} className="bg-gray-800/50 border border-gray-700/40 rounded-xl p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-indigo-900/40 text-indigo-300">{asText(c.disposition)}</span>
                    <span className="text-sm font-semibold text-white">{asText(c.workload)}</span>
                    {c.effort ? <span className="text-xs text-gray-500 ml-auto">Effort: {asText(c.effort)}</span> : null}
                  </div>
                  {c.current_state ? <p className="text-xs text-gray-400 mt-1.5"><span className="text-gray-600">Current:</span> {asText(c.current_state)}</p> : null}
                  {c.target_architecture ? <p className="text-xs text-gray-300 mt-1"><span className="text-gray-600">Target:</span> {asText(c.target_architecture)}</p> : null}
                  {c.benefit ? <p className="text-xs text-emerald-400 mt-1">{asText(c.benefit)}</p> : null}
                  <AffectedResources items={c.affected_resources} />
                </div>
              ))}
            </div>
          </BcdrSection>
        )}

        {/* Section 4 — FinOps */}
        {(Array.isArray(fin.cost_observations) && fin.cost_observations.length > 0) || (Array.isArray(fin.optimization_levers) && fin.optimization_levers.length > 0) ? (
          <BcdrSection eyebrow="Section 4" title="FinOps & Cost Visibility">
            {fin.summary ? <p className="text-sm text-gray-400 mb-3 leading-relaxed">{asText(fin.summary)}</p> : null}
            {Array.isArray(fin.cost_observations) && fin.cost_observations.length > 0 && (
              <ul className="space-y-1 mb-3">
                {fin.cost_observations.map((o, i) => <li key={i} className="text-sm text-gray-300 flex items-start gap-2"><span className="text-amber-400 mt-1">•</span> {asText(o)}</li>)}
              </ul>
            )}
            {Array.isArray(fin.optimization_levers) && fin.optimization_levers.length > 0 && (
              <div className="space-y-2 mb-3">
                {fin.optimization_levers.map((lv, i) => (
                  <div key={i} className="bg-gray-800/50 border border-gray-700/40 rounded-xl p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-emerald-900/40 text-emerald-300">{asText(lv.lever)}</span>
                      <span className="text-sm font-semibold text-white">{asText(lv.action)}</span>
                      {lv.est_monthly_saving ? <span className="text-xs text-emerald-400 ml-auto">{asText(lv.est_monthly_saving)}</span> : null}
                    </div>
                    <AffectedResources items={lv.affected_resources} />
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(fin.reporting_capabilities) && fin.reporting_capabilities.length > 0 && (
              <div className="bg-blue-900/15 border border-blue-800/30 rounded-xl p-3">
                <h5 className="text-xs font-semibold text-blue-300 mb-1.5">Azure Infra IQ reporting</h5>
                <ul className="space-y-1">
                  {fin.reporting_capabilities.map((cap, i) => <li key={i} className="text-xs text-gray-300 flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> {asText(cap)}</li>)}
                </ul>
              </div>
            )}
          </BcdrSection>
        ) : null}

        {/* Roadmap */}
        {roadmap.length > 0 && (
          <BcdrSection title="Remediation Roadmap" count={roadmap.length}>
            <div className="space-y-2">
              {roadmap.map((ph, i) => (
                <div key={i} className="bg-gray-800/50 border border-gray-700/40 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-sky-900/40 text-sky-300">{asText(ph.workstream)}</span>
                    <span className="text-sm font-semibold text-white">{asText(ph.phase)}</span>
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {(ph.outcomes || []).map((o, j) => <li key={j} className="text-xs text-gray-400 flex items-start gap-2"><span className="text-sky-400 mt-0.5">•</span> {asText(o)}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </BcdrSection>
        )}

        {/* Risks */}
        {risks.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Key risks &amp; data gaps</h4>
            <ul className="space-y-1">
              {risks.map((rk, i) => <li key={i} className="text-xs text-gray-400 flex items-start gap-2"><span className="text-amber-500 mt-0.5">⚠</span> {asText(rk)}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

