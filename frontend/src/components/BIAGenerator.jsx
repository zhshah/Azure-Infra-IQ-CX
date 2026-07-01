/**
 * BIAGenerator — consultant-grade, framework-based Business Impact Analysis.
 *
 * Reusable across the Project Workspace (scoped to a project) and the BCDR dashboard's
 * Business Impact tab (scoped to the currently filtered resources). Collects a consultant
 * BIA intake, calls POST /api/bia/generate (AI + deterministic grounding), renders the
 * result, and exports a board-ready PDF + multi-sheet Excel — parity with the BCDR
 * consultant report.
 *
 * Props (provide ONE scope):
 *   projectId    — generate for a project's resources (server resolves them)
 *   resourceIds  — explicit resource id selection (e.g. the BCDR tab's filtered set)
 *   resourceCount— optional count for the header copy
 *   defaultCustomerName — pre-fills the customer name
 */
import React, { useState } from 'react'
import {
  FileText, FileSpreadsheet, Loader2, Sparkles, ChevronDown, ChevronRight,
  AlertTriangle, ShieldAlert, Activity,
} from 'lucide-react'
import { api } from '../api/client'

const asText = (v) => {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ')
  if (typeof v === 'object') return v.action || v.name || v.text || JSON.stringify(v)
  return String(v)
}
const A = (v) => (Array.isArray(v) ? v : [])
const critColor = (n) => (n == null ? 'var(--c-94a3b8)' : n >= 70 ? '#ef4444' : n >= 45 ? '#f59e0b' : '#22c55e')
const sevColor = (s) => ({
  critical: '#ef4444', high: '#fb923c', medium: '#f59e0b', low: '#22c55e',
  p1: '#ef4444', p2: '#fb923c', p3: '#f59e0b',
}[String(s || '').toLowerCase()] || 'var(--c-94a3b8)')

// Intake field groups — the consultant BIA inputs (beyond what tags/properties provide).
// `required:true`     → hard-blocks Generate; without it the AI fabricates business context.
// `requireOneOf:'X'`  → at least ONE field in that group-of-one must be supplied (any single
//                       value satisfies the requirement for ALL fields sharing the same key).
const INTAKE_GROUPS = [
  {
    title: 'Report details', fields: [
      { key: 'customer_name', label: 'Customer / organisation', type: 'text', required: true },
      { key: 'prepared_by', label: 'Prepared by', type: 'text' },
      { key: 'report_version', label: 'Report version', type: 'text', placeholder: '1.0' },
      { key: 'industry', label: 'Industry / sector', type: 'text' },
    ],
  },
  {
    title: 'Business context', fields: [
      { key: 'critical_processes', label: 'Critical business processes / services these resources support', type: 'area', required: true,
        hint: 'A BIA must map infrastructure to business services. Without this every business-service entry is fabricated.' },
      { key: 'dependent_apps', label: 'Dependent applications / systems', type: 'area' },
      { key: 'user_base', label: 'User base / population affected', type: 'text' },
      { key: 'peak_windows', label: 'Peak / seasonal / blackout windows', type: 'text' },
    ],
  },
  {
    title: 'Recovery targets', subtitle: 'Supply at least ONE recovery target so RTO/RPO recommendations have an anchor.', fields: [
      { key: 'mtd', label: 'Maximum Tolerable Downtime (MTD/MTPD)', type: 'text', placeholder: 'e.g. 8 hours', requireOneOf: 'recovery_target' },
      { key: 'default_rto', label: 'Default target RTO', type: 'text', placeholder: 'e.g. 4 hours', requireOneOf: 'recovery_target' },
      { key: 'default_rpo', label: 'Default target RPO', type: 'text', placeholder: 'e.g. 15 minutes', requireOneOf: 'recovery_target' },
    ],
  },
  {
    title: 'Impact appetite', subtitle: 'Supply at least ONE impact signal so financial exposure is not invented.', fields: [
      { key: 'downtime_cost', label: 'Cost of downtime ($/hr)', type: 'text', placeholder: 'e.g. 50000', requireOneOf: 'impact_signal' },
      { key: 'revenue_at_risk', label: 'Revenue at risk', type: 'text', requireOneOf: 'impact_signal' },
      { key: 'operational_impact', label: 'Operational impact of an outage', type: 'area', requireOneOf: 'impact_signal' },
      { key: 'reputational_impact', label: 'Reputational / customer impact', type: 'area' },
      { key: 'regulatory_impact', label: 'Regulatory / legal / compliance impact', type: 'area' },
      { key: 'health_safety_impact', label: 'Health & safety impact', type: 'area' },
    ],
  },
  {
    title: 'Dependencies & recovery', fields: [
      { key: 'known_dependencies', label: 'Known dependencies / single points of failure', type: 'area' },
      { key: 'recovery_resources', label: 'Minimum recovery resources (people / systems)', type: 'area' },
      { key: 'vital_records', label: 'Vital records / critical data', type: 'area' },
    ],
  },
  {
    title: 'Governance', fields: [
      { key: 'data_classification', label: 'Data classification', type: 'text' },
      { key: 'compliance', label: 'Regulatory frameworks in scope', type: 'text', placeholder: 'e.g. ISO 27001, PCI-DSS, HIPAA' },
      { key: 'notes', label: 'Additional context', type: 'area' },
    ],
  },
]

const inputCls = 'w-full bg-gray-950/60 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500/70'

function Section({ title, subtitle, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-800/60 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-900/60 hover:bg-gray-900 transition-colors">
        <span className="text-sm font-semibold text-gray-200">{title}</span>
        {open ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
      </button>
      {open && (
        <div className="p-4">
          {subtitle && <p className="text-[11px] text-amber-300/80 mb-3">{subtitle}</p>}
          {children}
        </div>
      )}
    </div>
  )
}

export default function BIAGenerator({ projectId = null, resourceIds = null, resourceCount = null, defaultCustomerName = '', onSaved = null }) {
  const [intake, setIntake] = useState({ customer_name: defaultCustomerName || '', report_version: '1.0' })
  const [showIntake, setShowIntake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(null) // 'pdf' | 'xlsx'
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)

  const count = resourceCount ?? (resourceIds ? resourceIds.length : null)
  const scopeReady = !!projectId || (resourceIds && resourceIds.length > 0)
  const set = (k, v) => setIntake(s => ({ ...s, [k]: v }))

  // Compute which required inputs are still missing so we can both BLOCK Generate and
  // show the operator a precise to-do list — mirrors the deterministic gate on the backend.
  const missingRequired = (() => {
    const filled = (k) => String(intake[k] ?? '').trim().length > 0
    const out = []
    const groupSatisfied = {}
    INTAKE_GROUPS.forEach(g => g.fields.forEach(f => {
      if (f.required && !filled(f.key)) out.push({ label: f.label, group: g.title })
      if (f.requireOneOf) {
        groupSatisfied[f.requireOneOf] = groupSatisfied[f.requireOneOf] || filled(f.key)
      }
    }))
    Object.entries(groupSatisfied).forEach(([gk, ok]) => {
      if (ok) return
      const sample = INTAKE_GROUPS.flatMap(g => g.fields.filter(f => f.requireOneOf === gk).map(f => ({ ...f, group: g.title })))
      if (sample.length) {
        out.push({
          label: `At least ONE of: ${sample.map(s => s.label).join(' · ')}`,
          group: sample[0].group,
        })
      }
    })
    return out
  })()
  const canGenerate = scopeReady && missingRequired.length === 0 && !busy

  async function generate() {
    setBusy(true); setError('')
    try {
      const scope = projectId ? { project_id: projectId } : { resource_ids: resourceIds }
      const rep = await api.generateBIA(intake, scope)
      setReport(rep)
      // Refresh the project History so this freshly-saved BIA run appears immediately.
      if (projectId) onSaved?.()
    } catch (e) {
      setError(e?.message || 'BIA generation failed')
    } finally {
      setBusy(false)
    }
  }

  async function exportPdf() {
    if (!report) return
    setExportBusy('pdf'); setError('')
    try {
      const { generateBIAPDF } = await import('../utils/biaReport')
      const blob = await generateBIAPDF(report)
      const base = `${(report.cover?.customer_name) || 'Customer'}-Business-Impact-Analysis`.replace(/[^a-z0-9-_]+/gi, '_')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${base}-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch (e) {
      setError(e?.message || 'PDF export failed')
    } finally {
      setExportBusy(null)
    }
  }

  async function exportXlsx() {
    if (!report) return
    setExportBusy('xlsx'); setError('')
    try {
      await api.exportBIAXlsx(report)
    } catch (e) {
      setError(e?.message || 'Excel export failed')
    } finally {
      setExportBusy(null)
    }
  }

  const es = report?.executive_summary || {}

  return (
    <div className="space-y-5">
      {/* Header / call to action */}
      <div className="bg-gradient-to-br from-indigo-900/20 to-gray-900/40 border border-indigo-800/30 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <Activity size={20} className="text-indigo-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white">AI Business Impact Analysis</h3>
            <p className="text-xs text-gray-400 mt-1 max-w-3xl leading-relaxed">
              A consultant-grade BIA for {count != null ? <span className="text-gray-200">{count} selected resource{count !== 1 ? 's' : ''}</span> : 'the selected resources'} — aligned to
              <span className="text-indigo-300"> ISO 22301</span>, <span className="text-indigo-300">NIST SP 800-34</span>, <span className="text-indigo-300">ITIL 4</span> and <span className="text-indigo-300">ISO/IEC 27031</span>.
              It maps resources to critical business services, tiers criticality, models impact-over-time across five categories,
              derives MTD/RTO/RPO, finds single points of failure and a prioritised recovery sequence — grounded on each resource&apos;s posture,
              Azure tags and your Phase-1 classification. Add business context below for a sharper result.
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={generate}
              disabled={!canGenerate}
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg flex items-center gap-2 shadow-lg shadow-indigo-900/30"
              title={missingRequired.length ? `Supply the required inputs first (${missingRequired.length} missing)` : 'Generate the AI Business Impact Analysis'}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {report ? 'Regenerate BIA' : 'Generate BIA'}
            </button>
            <button onClick={() => setShowIntake(s => !s)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-gray-700/60 rounded-lg">
              {showIntake ? 'Hide' : (missingRequired.length ? 'Supply required inputs' : 'Add')} business context
            </button>
          </div>
        </div>
        {!scopeReady && (
          <p className="text-[11px] text-amber-400/80 mt-3">Select at least one resource to run a BIA.</p>
        )}
        {scopeReady && missingRequired.length > 0 && (
          <div className="mt-3 flex items-start gap-2 bg-amber-900/15 border border-amber-700/40 rounded-lg px-3 py-2.5">
            <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-[11px] text-amber-200 leading-relaxed">
              <span className="font-semibold">Required to produce an accurate BIA — {missingRequired.length} missing:</span>
              <ul className="mt-1 space-y-0.5">
                {missingRequired.map((m, i) => (
                  <li key={i}>• <span className="text-amber-100">{m.label}</span> <span className="text-amber-300/70">({m.group})</span></li>
                ))}
              </ul>
              <button onClick={() => setShowIntake(true)} className="mt-1.5 underline text-amber-100 hover:text-white">Open the intake form</button>
            </div>
          </div>
        )}
      </div>

      {/* Intake */}
      {showIntake && (
        <div className="space-y-3">
          {INTAKE_GROUPS.map((g, gi) => (
            <Section key={g.title} title={g.title} subtitle={g.subtitle} defaultOpen={gi < 2 || missingRequired.length > 0}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {g.fields.map(f => {
                  const filled = String(intake[f.key] ?? '').trim().length > 0
                  const showRequired = !!f.required && !filled
                  return (
                    <div key={f.key} className={f.type === 'area' ? 'md:col-span-2' : ''}>
                      <label className="block text-xs text-gray-500 mb-1">
                        {f.label}
                        {f.required && <span className="text-red-400 ml-1">*</span>}
                        {f.requireOneOf && <span className="text-amber-400 ml-1" title="At least one in this group is required">†</span>}
                      </label>
                      {f.type === 'area'
                        ? <textarea rows={2} className={`${inputCls} ${showRequired ? 'border-red-500/50' : ''}`} placeholder={f.placeholder || ''} value={intake[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
                        : <input type="text" className={`${inputCls} ${showRequired ? 'border-red-500/50' : ''}`} placeholder={f.placeholder || ''} value={intake[f.key] || ''} onChange={e => set(f.key, e.target.value)} />}
                      {f.hint && <p className="text-[10px] text-gray-500 mt-1">{f.hint}</p>}
                    </div>
                  )
                })}
              </div>
            </Section>
          ))}
        </div>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-sm text-indigo-300">
          <Loader2 size={14} className="animate-spin" />
          Running the Business Impact Analysis with AI… this can take 30–60 seconds.
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Result */}
      {report && <BIAResult report={report} es={es} exportPdf={exportPdf} exportXlsx={exportXlsx} exportBusy={exportBusy} />}
    </div>
  )
}

function Table({ cols, rows, sevKey }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800/60">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-900/80">
            {cols.map(c => <th key={c.key} className="text-left font-semibold text-gray-400 px-3 py-2 whitespace-nowrap">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {A(rows).map((r, i) => (
            <tr key={i} className="border-t border-gray-800/50">
              {cols.map(c => {
                const raw = r[c.key]
                if (sevKey && c.key === sevKey) {
                  return <td key={c.key} className="px-3 py-2"><span className="px-1.5 py-0.5 rounded text-[11px] font-semibold text-white" style={{ background: sevColor(raw) }}>{asText(raw)}</span></td>
                }
                return <td key={c.key} className="px-3 py-2 text-gray-300 align-top">{c.fmt ? c.fmt(raw, r) : asText(raw)}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function BIAResult({ report, es, exportPdf, exportXlsx, exportBusy }) {
  const score = report.overall_score
  return (
    <div className="space-y-5">
      {/* Summary header */}
      <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full border-[6px] flex flex-col items-center justify-center shrink-0" style={{ borderColor: critColor(score) }}>
              <span className="text-2xl font-bold" style={{ color: critColor(score) }}>{score ?? '—'}</span>
              <span className="text-[9px] text-gray-500">/ 100</span>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Business Criticality</div>
              <div className="text-lg font-bold text-white">{asText(report.score_label) || '—'}</div>
              <div className="text-xs text-gray-400 mt-1">
                Downtime cost: <span className="text-gray-200">{asText(es.aggregate_downtime_cost_per_hour) || 'Not supplied'}</span>
                {es.aggregate_downtime_cost_per_hour ? ' / hr' : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportPdf} disabled={!!exportBusy} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-sm rounded-lg flex items-center gap-2 border border-gray-700/60">
              {exportBusy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Export PDF
            </button>
            <button onClick={exportXlsx} disabled={!!exportBusy} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-sm rounded-lg flex items-center gap-2 border border-gray-700/60">
              {exportBusy === 'xlsx' ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Export Excel
            </button>
          </div>
        </div>
        {es.headline && <p className="text-sm text-gray-300 mt-4">{asText(es.headline)}</p>}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {A(es.frameworks).map((f, i) => <span key={i} className="px-2 py-0.5 rounded text-[11px] bg-indigo-900/30 text-indigo-300 border border-indigo-800/40">{asText(f)}</span>)}
        </div>
      </div>

      {/* Key findings */}
      {A(es.key_findings).length > 0 && (
        <Card title="Key findings">
          <ul className="space-y-1.5">{A(es.key_findings).map((f, i) => <li key={i} className="text-sm text-gray-300 flex gap-2"><span className="text-indigo-400">•</span>{asText(f)}</li>)}</ul>
        </Card>
      )}

      {/* Criticality tiers */}
      {A(report.criticality_tiers).length > 0 && (
        <Card title="Criticality tiers">
          <Table cols={[
            { key: 'tier', label: 'Tier' }, { key: 'mtd', label: 'MTD' }, { key: 'rto', label: 'RTO' }, { key: 'rpo', label: 'RPO' },
            { key: 'resource_count', label: '#' }, { key: 'examples', label: 'Examples', fmt: (v) => A(v).join(', ') },
          ]} rows={report.criticality_tiers} />
        </Card>
      )}

      {/* Impact over time */}
      {A(report.impact_over_time).length > 0 && (
        <Card title="Impact over time" icon={ShieldAlert}>
          <Table cols={[
            { key: 'duration', label: 'Outage' }, { key: 'financial', label: 'Financial' }, { key: 'operational', label: 'Operational' },
            { key: 'reputational', label: 'Reputational' }, { key: 'regulatory', label: 'Regulatory' }, { key: 'health_safety', label: 'Health & Safety' },
          ]} rows={report.impact_over_time} />
        </Card>
      )}

      {/* Recovery objectives */}
      {A(report.recovery_objectives).length > 0 && (
        <Card title="Recovery objectives (MTD / RTO / RPO)">
          <Table cols={[
            { key: 'workload', label: 'Workload' }, { key: 'criticality', label: 'Criticality' }, { key: 'mtd', label: 'MTD' },
            { key: 'current_rto', label: 'Cur RTO' }, { key: 'recommended_rto', label: 'Rec RTO' },
            { key: 'current_rpo', label: 'Cur RPO' }, { key: 'recommended_rpo', label: 'Rec RPO' },
          ]} rows={report.recovery_objectives} />
        </Card>
      )}

      {/* Single points of failure */}
      {A(report.dependency_analysis?.single_points_of_failure).length > 0 && (
        <Card title="Single points of failure">
          <Table cols={[
            { key: 'resource', label: 'Resource' }, { key: 'why', label: 'Why' }, { key: 'impact', label: 'Business impact' }, { key: 'mitigation', label: 'Mitigation' },
          ]} rows={report.dependency_analysis.single_points_of_failure} />
        </Card>
      )}

      {/* Prioritised recovery sequence */}
      {A(report.recovery_sequence).length > 0 && (
        <Card title="Prioritised recovery sequence">
          <Table cols={[
            { key: 'order', label: '#' }, { key: 'service', label: 'Service / Workload' },
            { key: 'resources', label: 'Resources', fmt: (v) => A(v).join(', ') },
            { key: 'target_rto', label: 'Target RTO' }, { key: 'rationale', label: 'Rationale' },
          ]} rows={report.recovery_sequence} />
        </Card>
      )}

      {/* Gaps & recommendations */}
      {A(report.gaps_and_recommendations).length > 0 && (
        <Card title="Gaps & recommendations">
          <Table sevKey="priority" cols={[
            { key: 'gap', label: 'Gap' }, { key: 'business_impact', label: 'Business impact' },
            { key: 'recommendation', label: 'Recommendation' }, { key: 'priority', label: 'Priority' }, { key: 'effort', label: 'Effort' },
          ]} rows={report.gaps_and_recommendations} />
        </Card>
      )}

      {/* Conclusion */}
      {report.conclusion && (report.conclusion.summary || A(report.conclusion.immediate_actions).length > 0) && (
        <Card title="Conclusion & next steps">
          {report.conclusion.summary && <p className="text-sm text-gray-300 mb-3">{asText(report.conclusion.summary)}</p>}
          {A(report.conclusion.immediate_actions).length > 0 && (
            <>
              <div className="text-xs font-semibold text-gray-400 mb-1.5">Immediate actions</div>
              <ul className="space-y-1.5 mb-3">{A(report.conclusion.immediate_actions).map((x, i) => <li key={i} className="text-sm text-gray-300 flex gap-2"><span className="text-indigo-400">•</span>{asText(x)}</li>)}</ul>
            </>
          )}
          {A(report.conclusion.next_steps).length > 0 && (
            <>
              <div className="text-xs font-semibold text-gray-400 mb-1.5">Next steps</div>
              <ul className="space-y-1.5">{A(report.conclusion.next_steps).map((x, i) => <li key={i} className="text-sm text-gray-300 flex gap-2"><span className="text-indigo-400">•</span>{asText(x)}</li>)}</ul>
            </>
          )}
        </Card>
      )}

      <p className="text-[11px] text-gray-600">
        Generated by {asText(report.model) || 'AI'} · grounded on {report.metrics?.total_resources ?? 0} resources ·
        tag coverage {report.grounding?.tagged_pct ?? 0}%. The PDF / Excel exports contain the full analysis (business services,
        methodology, financial exposure, resource requirements, risk register and the per-resource BIA matrix).
      </p>
    </div>
  )
}

function Card({ title, icon: Icon, children }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl p-5">
      <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">{Icon && <Icon size={15} className="text-indigo-400" />}{title}</h4>
      {children}
    </div>
  )
}
