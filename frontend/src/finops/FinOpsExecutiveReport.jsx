/**
 * FinOpsExecutiveReport — the FinOps report studio.
 *
 * A six-step wizard (Report → Scope → Filters → Sections → Brief → Review) that builds a
 * consultant-grade report whose EVERY figure is sourced from Azure Cost Management (the
 * warehouse). The AI writes only the narrative, steered by the free-text brief the author
 * supplies in step 5 and constrained to the supplied numbers. Preview on screen, then export
 * a branded PDF (client, react-pdf, lazy) or a multi-sheet Excel workbook (server).
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  FileText, FileSpreadsheet, Sparkles, AlertCircle, Loader, DollarSign, PiggyBank,
  PieChart, ShieldCheck, Wallet, Activity, CheckCircle2, TrendingUp,
  Layers, Server, HardDrive, Network, Shield, Database, Building2, Boxes, Sliders,
  ChevronLeft, ChevronRight, Target, ListChecks, MessageSquare, ClipboardCheck,
  RotateCcw, Pencil, Rocket, Lightbulb,
} from 'lucide-react'
import { finopsApi, fmtUsd, getSubscriptions, getFilterOptions } from './finopsApi'
import { C, rechartsTooltipProps } from './finopsTheme'

// Must mirror REPORT_TYPES[*].sections in finops_report_service.py EXACTLY. The backend
// keeps only sections present in both lists, so a section offered here that the backend
// does not have silently strips real content from the report (a "paas" tick used to leave
// nothing but the spend overview). Verified by C:\Temp\pulse-shots\sectionsync.ps1.
const REPORT_SECTIONS = {
  executive:           ['spend_overview', 'subscriptions', 'movers', 'savings', 'cost_at_risk', 'commitments'],
  optimization:        ['savings', 'cost_at_risk', 'spend_overview', 'subscriptions'],
  allocation:          ['allocation', 'subscriptions', 'spend_overview'],
  commitments:         ['commitments', 'spend_overview', 'subscriptions'],
  budgets:             ['budgets', 'spend_overview', 'subscriptions'],
  anomalies:           ['anomalies', 'movers', 'spend_overview'],
  management:          ['spend_overview', 'service_categories', 'compute', 'storage', 'network', 'security_monitoring', 'environments', 'savings_roi'],
  subscriptions_mg:    ['subscriptions', 'management_groups', 'governance', 'spend_overview'],
  resource_groups:     ['resource_groups', 'environments', 'spend_overview'],
  service_categories:  ['service_categories', 'spend_overview', 'subscriptions'],
  compute:             ['compute', 'savings_roi', 'spend_overview'],
  storage:             ['storage', 'savings_roi', 'spend_overview'],
  network:             ['network', 'spend_overview'],
  paas:                ['service_categories', 'environments', 'spend_overview', 'subscriptions'],
  security_monitoring: ['security_monitoring', 'spend_overview'],
  savings_roi:         ['savings_roi', 'savings', 'spend_overview'],
  security_posture:    ['security_posture', 'resilience', 'spend_overview'],
  resilience:          ['resilience', 'security_posture', 'spend_overview'],
  modernization:       ['modernization', 'inventory', 'spend_overview'],
  inventory:           ['inventory', 'spend_overview'],
  advisor:             ['advisor', 'spend_overview'],
  well_architected:    ['well_architected', 'security_posture', 'resilience', 'spend_overview'],
}

const SECTION_LABELS = {
  spend_overview: 'Spend overview', subscriptions: 'Subscriptions', movers: 'Biggest movers',
  savings: 'Savings opportunities', cost_at_risk: 'Cost at risk', commitments: 'Commitments',
  allocation: 'Allocation & showback', budgets: 'Budgets & forecast', anomalies: 'Anomalies',
  service_categories: 'Service categories', compute: 'Compute', storage: 'Storage',
  network: 'Network', security_monitoring: 'Security & monitoring', paas: 'Platform services',
  environments: 'Environments', resource_groups: 'Resource groups',
  management_groups: 'Management groups', savings_roi: 'Savings & ROI', governance: 'Governance',
  security_posture: 'Security posture', resilience: 'Resilience & backup',
  modernization: 'Modernization', inventory: 'Estate inventory', advisor: 'Azure Advisor',
  well_architected: 'Well-Architected',
}

const REPORT_TYPES = [
  { key: 'executive',    label: 'Executive Cost Summary', Icon: DollarSign, color: '#3b82f6', group: 'Core',
    desc: 'Estate + per-subscription spend, trend, forecast, movers, savings & cost-at-risk. Board-ready for CEO / CIO / CFO.' },
  { key: 'optimization', label: 'Cost Optimization & Savings', Icon: PiggyBank, color: '#22c55e', group: 'Core',
    desc: 'Waste, idle & orphaned spend, rightsizing, reservations and modernization — prioritised savings with $ impact.' },
  { key: 'allocation',   label: 'Allocation, Showback & Chargeback', Icon: PieChart, color: '#a855f7', group: 'Core',
    desc: 'Where spend lands by subscription, resource group & tag — and what is unallocated (untagged).' },
  { key: 'commitments',  label: 'Commitment & Reservation Coverage', Icon: ShieldCheck, color: '#06b6d4', group: 'Core',
    desc: 'Reserved Instance & Savings Plan coverage, utilisation and purchase headroom.' },
  { key: 'budgets',      label: 'Budget & Forecast', Icon: Wallet, color: '#f59e0b', group: 'Core',
    desc: 'Budget performance, burn rate and forward spend projection.' },
  { key: 'anomalies',    label: 'Anomaly & Cost-Spike', Icon: Activity, color: '#ef4444', group: 'Core',
    desc: 'Detected cost spikes, their drivers and the affected spend.' },

  { key: 'management',   label: 'Management Cost & Usage Review', Icon: Building2, color: '#6366f1', group: 'Management Review',
    desc: 'The full board pack in one report — categories, compute, storage, network, security, environments and savings.' },
  { key: 'subscriptions_mg', label: 'Subscription & Management Group', Icon: Boxes, color: '#0ea5e9', group: 'Management Review',
    desc: 'Cost by management group and subscription, growth % per subscription and governance exceptions.' },
  { key: 'resource_groups', label: 'Resource Group Cost', Icon: Layers, color: '#8b5cf6', group: 'Management Review',
    desc: 'Costliest resource groups, growth, resource count vs spend and Production vs Non-Production split.' },
  { key: 'service_categories', label: 'Azure Service Category', Icon: PieChart, color: '#14b8a6', group: 'Management Review',
    desc: '% of spend by category — VMs, SQL/Cosmos, Storage, Firewall/LB, Log Analytics/Sentinel.' },
  { key: 'compute',      label: 'VM Cost & Utilization', Icon: Server, color: '#f97316', group: 'Management Review',
    desc: 'VM spend, running vs stopped, idle cost, CPU & memory utilisation and underutilised capacity.' },
  { key: 'storage',      label: 'Storage Cost & Growth', Icon: HardDrive, color: '#eab308', group: 'Management Review',
    desc: 'Cost by Hot/Cool/Archive tier, GB/month growth and orphaned disks & snapshots.' },
  { key: 'network',      label: 'Network & Data Egress', Icon: Network, color: '#ec4899', group: 'Management Review',
    desc: 'Network spend, data egress cost & volume, inter-region traffic and top VNets / gateways.' },
  { key: 'paas',         label: 'Platform Services (PaaS)', Icon: Database, color: '#84cc16', group: 'Management Review',
    desc: 'Managed-service spend by service and the Production vs Non-Production split.' },
  { key: 'security_monitoring', label: 'Security & Monitoring Cost', Icon: Shield, color: '#dc2626', group: 'Management Review',
    desc: 'Defender & Sentinel spend, GB ingested and the derived cost per GB.' },
  { key: 'savings_roi',  label: 'Savings, Realization & ROI', Icon: TrendingUp, color: '#10b981', group: 'Management Review',
    desc: 'Identified vs realized savings, capture rate and return on optimisation effort.' },

  { key: 'security_posture', label: 'Security Posture & Risk', Icon: Shield, color: '#ef4444', group: 'Workload & Platform',
    desc: 'Defender findings by severity, the named resources carrying them and the remediation order.' },
  { key: 'resilience',   label: 'Resilience & Backup Readiness', Icon: ShieldCheck, color: '#0ea5e9', group: 'Workload & Platform',
    desc: 'Backup coverage, unprotected spend and the recovery gaps that matter most.' },
  { key: 'modernization', label: 'Modernization & Cloud Adoption', Icon: Rocket, color: '#8b5cf6', group: 'Workload & Platform',
    desc: 'Migration candidates, target services, 5R disposition and the adoption gaps worth closing.' },
  { key: 'inventory',    label: 'Estate Inventory & Tagging', Icon: Boxes, color: '#14b8a6', group: 'Workload & Platform',
    desc: 'What is deployed, where it lives and what is untagged — the basis for any cost allocation.' },
  { key: 'advisor',      label: 'Azure Advisor Review', Icon: Lightbulb, color: '#f59e0b', group: 'Workload & Platform',
    desc: 'Open Advisor recommendations by category and impact, with the resources behind them.' },
  { key: 'well_architected', label: 'Well-Architected Review', Icon: Target, color: '#6366f1', group: 'Workload & Platform',
    desc: 'Pillar scores and maturity, evidenced by real findings, backup gaps and Advisor impact.' },
]

const REPORT_GROUPS = ['Core', 'Management Review', 'Workload & Platform']

// Two views share this builder. FinOps keeps the six FinOps-framework executive reports so the
// module stays about cost; Report Studio is the cross-module catalogue and carries everything.
const CATALOGS = {
  finops: {
    groups: ['Core'],
    Icon: DollarSign,
    title: 'FinOps Executive Report',
    blurb: 'The six FinOps-framework executive reports, scoped to cost. Every figure comes directly from Azure Cost Management — nothing is estimated. For security, resilience, inventory, Advisor or Well-Architected reports, use Reporting → Report Studio.',
  },
  all: {
    groups: REPORT_GROUPS,
    Icon: FileText,
    title: 'Report Studio',
    blurb: 'Consultant-grade, board-ready reports across every module — cost, security, resilience, modernization, inventory and Well-Architected. Every figure is read from your estate; nothing is estimated. Walk the six steps, then export a branded PDF or multi-sheet Excel.',
  },
}

const STEPS = [
  { key: 'type',     label: 'Report',   Icon: FileText,       hint: 'What kind of report' },
  { key: 'scope',    label: 'Scope',    Icon: Target,         hint: 'Which subscriptions' },
  { key: 'filters',  label: 'Filters',  Icon: Sliders,        hint: 'Narrow the estate' },
  { key: 'sections', label: 'Sections', Icon: ListChecks,     hint: 'What goes in' },
  { key: 'brief',    label: 'Brief',    Icon: MessageSquare,  hint: 'Context for the AI' },
  { key: 'review',   label: 'Review',   Icon: ClipboardCheck, hint: 'Confirm & generate' },
]

const inputStyle = {
  width: '100%', marginTop: 4, background: C.surface, border: `1px solid ${C.border}`,
  borderRadius: 7, padding: '8px 10px', color: C.text, fontSize: 12.5, boxSizing: 'border-box',
}
const taStyle = { ...inputStyle, minHeight: 84, resize: 'vertical', lineHeight: 1.55, fontFamily: 'inherit' }

// Option shapes differ by source: getFilterOptions() returns {value,label,count} objects,
// getSubscriptions() returns {subscription_id,subscription_name}, and some lists are plain
// strings. Normalise once so the pickers never render an object as a React child.
function optionOf(o) {
  if (o == null) return { value: '', label: '' }
  if (typeof o === 'string') return { value: o, label: o }
  const value = String(o.value ?? o.subscription_id ?? o.id ?? '')
  return { value, label: String(o.label ?? o.subscription_name ?? o.name ?? value), count: o.count }
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 700 }}>{label}</span>
      {hint && <span style={{ display: 'block', fontSize: 11, color: C.muted, marginTop: 2 }}>{hint}</span>}
      {children}
    </label>
  )
}

function Chip({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, cursor: 'pointer',
      padding: '5px 11px', borderRadius: 999, maxWidth: '100%',
      background: on ? 'rgba(59,130,246,0.16)' : 'transparent',
      border: `1px solid ${on ? C.accent : C.border}`, color: on ? C.text : C.muted,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {on && <CheckCircle2 size={12} />}{children}
    </button>
  )
}

/** Multi-select chip list. An empty selection means "everything" — the same thing the
 *  backend does with an omitted filter, so the two can never disagree. */
function MultiPick({ label, hint, options, value, onChange, allLabel, format }) {
  const [q, setQ] = useState('')
  const fmt = useMemo(() => format || (v => v), [format])
  const list = useMemo(() => {
    const all = (options || []).map(optionOf).filter(o => o.value)
      .map(o => ({ ...o, text: String(fmt(o.label)) }))
    const t = q.trim().toLowerCase()
    return t ? all.filter(o => o.text.toLowerCase().includes(t)) : all
  }, [options, q, fmt])
  const toggle = v => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 700 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{hint}</div>}
      {(options || []).length > 10 && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${options.length} options…`}
          style={{ ...inputStyle, marginBottom: 4, maxWidth: 320 }} />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8, maxHeight: 168, overflowY: 'auto' }}>
        <Chip on={value.length === 0} onClick={() => onChange([])}>{allLabel}</Chip>
        {list.map(o => (
          <Chip key={o.value} on={value.includes(o.value)} onClick={() => toggle(o.value)}>
            {o.text}{o.count != null ? ` · ${o.count}` : ''}
          </Chip>
        ))}
        {list.length === 0 && <span style={{ color: C.muted, fontSize: 11.5, padding: '5px 0' }}>No match.</span>}
      </div>
    </div>
  )
}

function Kpi({ label, value, sub }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '13px 15px' }}>
      <div style={{ color: C.muted, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
      <div style={{ color: C.text, fontSize: 20, fontWeight: 700, marginTop: 3 }}>{value}</div>
      {sub != null && <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function SummaryRow({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '9px 0', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ width: 150, flexShrink: 0, color: C.muted, fontSize: 11.5, fontWeight: 600 }}>{label}</div>
      <div style={{ color: C.textDim, fontSize: 12.5, lineHeight: 1.6, minWidth: 0 }}>{children}</div>
    </div>
  )
}

export default function FinOpsExecutiveReport({ catalog = 'all' }) {
  const cat = CATALOGS[catalog] || CATALOGS.all
  const groups = cat.groups
  const visibleTypes = useMemo(
    () => REPORT_TYPES.filter(t => groups.includes(t.group)), [groups])
  const [step, setStep] = useState(0)
  const [furthest, setFurthest] = useState(0)

  const [reportType, setReportType] = useState('executive')
  const [useAi, setUseAi] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [report, setReport] = useState(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [xlsBusy, setXlsBusy] = useState(false)
  const [exportErr, setExportErr] = useState(null)

  // Scope + filters
  const [opts, setOpts] = useState({})
  const [subs, setSubs] = useState([])
  const [rgs, setRgs] = useState([])
  const [regions, setRegions] = useState([])
  const [types, setTypes] = useState([])
  const [tagKey, setTagKey] = useState('')
  const [tagVal, setTagVal] = useState('')
  const [tagged, setTagged] = useState('')

  // Sections + author's brief
  const [pickedSections, setPickedSections] = useState(null)   // null = every section
  const [customer, setCustomer] = useState('')
  const [audience, setAudience] = useState('')
  const [context, setContext] = useState('')
  const [questions, setQuestions] = useState('')

  useEffect(() => {
    let dead = false
    Promise.all([
      getFilterOptions().catch(() => ({})),
      getSubscriptions().catch(() => []),
    ]).then(([fo, s]) => {
      if (dead) return
      setOpts({
        ...(fo || {}),
        subscriptions: Array.isArray(s) && s.length ? s : (fo?.subscriptions || []),
      })
    })
    return () => { dead = true }
  }, [])

  const availableSections = useMemo(
    () => REPORT_SECTIONS[reportType] || REPORT_SECTIONS.executive, [reportType])
  // A newly chosen report type has its own sections, so fall back to "all".
  const effectiveSections = useMemo(
    () => (pickedSections ? pickedSections.filter(s => availableSections.includes(s)) : availableSections),
    [pickedSections, availableSections])
  const toggleSection = useCallback((s) => {
    setPickedSections(prev => {
      const base = prev ? prev.filter(x => availableSections.includes(x)) : availableSections
      const next = base.includes(s) ? base.filter(x => x !== s) : [...base, s]
      return next.length ? next : base      // never allow an empty report
    })
  }, [availableSections])

  const resetAll = useCallback(() => {
    setSubs([]); setRgs([]); setRegions([]); setTypes([])
    setTagKey(''); setTagVal(''); setTagged(''); setPickedSections(null)
    setCustomer(''); setAudience(''); setContext(''); setQuestions('')
    setReport(null); setError(null); setExportErr(null)
    setStep(0); setFurthest(0)
  }, [])

  const go = useCallback((i) => {
    const n = Math.max(0, Math.min(STEPS.length - 1, i))
    setStep(n); setFurthest(f => Math.max(f, n))
  }, [])

  const subName = useCallback(
    id => (opts.subscriptions || []).map(optionOf).find(s => s.value === id)?.label || id,
    [opts.subscriptions])

  const activeFilters = useMemo(() => {
    const out = []
    if (rgs.length) out.push(`${rgs.length} resource group${rgs.length > 1 ? 's' : ''}`)
    if (regions.length) out.push(`${regions.length} region${regions.length > 1 ? 's' : ''}`)
    if (types.length) out.push(`${types.length} resource type${types.length > 1 ? 's' : ''}`)
    if (tagKey) out.push(`tag ${tagKey}${tagVal ? '=' + tagVal : ''}`)
    if (tagged === 'yes') out.push('tagged resources only')
    if (tagged === 'no') out.push('untagged resources only')
    return out
  }, [rgs, regions, types, tagKey, tagVal, tagged])

  const generate = useCallback(async () => {
    setBusy(true); setError(null); setExportErr(null)
    try {
      const rep = await finopsApi.generateExecReport({
        report_type: reportType, customer: customer.trim(), use_ai: useAi,
        sections: effectiveSections,
        scope: subs.length ? subs : undefined,
        resource_groups: rgs.length ? rgs : undefined,
        regions: regions.length ? regions : undefined,
        resource_types: types.length ? types : undefined,
        tag_key: tagKey || undefined,
        tag_value: tagVal.trim() || undefined,
        tagged: tagged === 'yes' ? true : tagged === 'no' ? false : undefined,
        audience: audience.trim() || undefined,
        context: context.trim() || undefined,
        questions: questions.trim() || undefined,
      })
      setReport(rep)
    } catch (e) {
      setError(e.message || 'Report generation failed')
    } finally { setBusy(false) }
  }, [reportType, customer, useAi, effectiveSections, subs, rgs, regions, types,
      tagKey, tagVal, tagged, audience, context, questions])

  const genPdf = useCallback(async () => {
    if (!report) return
    setPdfBusy(true); setExportErr(null)
    try {
      const mod = await import('../utils/finopsExecReportPro')
      await mod.generateFinOpsReportPDF(report)
    } catch (e) { setExportErr('PDF export failed: ' + e.message) }
    finally { setPdfBusy(false) }
  }, [report])

  const genXls = useCallback(async () => {
    if (!report) return
    setXlsBusy(true); setExportErr(null)
    try { await finopsApi.exportExecReportXlsx(report) }
    catch (e) { setExportErr('Excel export failed: ' + e.message) }
    finally { setXlsBusy(false) }
  }, [report])

  const trend = useMemo(() => (report?.spend_overview?.trend || []).map(p => ({ date: p.date, cost: p.cost })), [report])
  const es = report?.executive_summary || {}
  const meta = REPORT_TYPES.find(t => t.key === reportType) || REPORT_TYPES[0]
  // Only surface the generated report while the picker is still on the type it was generated
  // for. Selecting a different type hides the stale preview and flips the button to "Generate".
  const showReport = !!report && report.report_type === reportType
  const onReview = step === STEPS.length - 1

  const btn = (onClick, b, Icon, label, primary) => (
    <button onClick={onClick} disabled={b || busy} style={{
      display: 'flex', alignItems: 'center', gap: 7,
      background: primary ? C.accent : C.surface, border: `1px solid ${primary ? C.accent : C.border}`,
      borderRadius: 7, padding: '9px 16px', cursor: b || busy ? 'wait' : 'pointer',
      color: primary ? '#fff' : C.text, fontSize: 13, fontWeight: 600,
    }}>
      {b ? <Loader size={14} className="animate-spin" /> : <Icon size={14} />} {label}
    </button>
  )

  const sectionCounts = report ? [
    { label: 'Subscriptions', n: (report.subscriptions || []).length },
    { label: 'Services analysed', n: (report.spend_overview?.by_service || []).length },
    { label: 'Recommendations', n: (report.recommendations || []).length },
    { label: 'Key findings', n: (es.key_findings || []).length },
  ] : []

  const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }
  const stepTitle = (t, s) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: C.text, fontSize: 15, fontWeight: 700 }}>{t}</div>
      <div style={{ color: C.muted, fontSize: 12, marginTop: 3, lineHeight: 1.55 }}>{s}</div>
    </div>
  )

  return (
    <div style={{ padding: 24, maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 22, fontWeight: 700, margin: 0 }}>
          <cat.Icon size={22} style={{ color: C.accent }} /> {cat.title}
        </h1>
        <p style={{ color: C.muted, fontSize: 13, margin: '6px 0 0' }}>
          {cat.blurb}
        </p>
      </div>

      {/* ── Stepper ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {STEPS.map((s, i) => {
          const active = i === step
          const done = i < furthest
          const reachable = i <= furthest
          return (
            <button key={s.key} onClick={() => reachable && go(i)} disabled={!reachable} style={{
              flex: '1 1 150px', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
              background: active ? 'rgba(59,130,246,0.14)' : C.surface,
              border: `1.5px solid ${active ? C.accent : C.border}`,
              borderRadius: 10, padding: '9px 12px', cursor: reachable ? 'pointer' : 'not-allowed',
              opacity: reachable ? 1 : 0.5,
            }}>
              <span style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                background: active ? C.accent : done ? 'rgba(34,197,94,0.18)' : 'transparent',
                border: `1px solid ${active ? C.accent : done ? C.green : C.border}`,
                color: active ? '#fff' : done ? C.green : C.muted, fontSize: 10.5, fontWeight: 700,
              }}>
                {done ? <CheckCircle2 size={13} /> : i + 1}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', color: active ? C.text : C.textDim, fontSize: 12.5, fontWeight: 700 }}>{s.label}</span>
                <span style={{ display: 'block', color: C.muted, fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.hint}</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Step body ───────────────────────────────────────────────────────── */}
      <div style={{ ...card, marginBottom: 14 }}>
        {step === 0 && (
          <>
            {stepTitle('Which report?', 'Each type reads very differently for the same estate — different emphasis, structure and recommendations.')}
            {groups.map(group => (
              <div key={group} style={{ marginBottom: 14 }}>
                <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                  {{ Core: 'FinOps Framework reports',
                     'Management Review': 'Management cost & usage review',
                     'Workload & Platform': 'Workload & platform reports' }[group] || group}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                  {visibleTypes.filter(t => t.group === group).map(t => {
                    const active = reportType === t.key
                    return (
                      <button key={t.key} onClick={() => { setReportType(t.key); setPickedSections(null) }} style={{
                        textAlign: 'left', background: active ? 'rgba(59,130,246,0.10)' : C.surface,
                        border: `1.5px solid ${active ? t.color : C.border}`, borderRadius: 12, padding: 14, cursor: 'pointer',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
                          <t.Icon size={18} style={{ color: t.color }} />
                          <span style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{t.label}</span>
                          {active && <CheckCircle2 size={15} style={{ color: t.color, marginLeft: 'auto' }} />}
                        </div>
                        <div style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.45 }}>{t.desc}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </>
        )}

        {step === 1 && (
          <>
            {stepTitle('What does the report cover?',
              'Pick one or more subscriptions, or leave it on “All” for the whole estate. This is the only filter that also narrows the authoritative estate totals.')}
            <MultiPick
              label="Subscriptions"
              hint="Cost Management totals, per-subscription blocks and every resource table are scoped to this selection."
              options={opts.subscriptions || []}
              value={subs} onChange={setSubs}
              allLabel={`All subscriptions${(opts.subscriptions || []).length ? ` (${opts.subscriptions.length})` : ''}`}
            />
          </>
        )}

        {step === 2 && (
          <>
            {stepTitle('Narrow the estate (optional)',
              'These filters narrow the per-resource evidence — savings, cost-at-risk, allocation, anomalies and every resource table. Leave them empty to cover everything.')}
            <MultiPick label="Resource groups" options={opts.resource_groups || []} value={rgs} onChange={setRgs}
              allLabel="All resource groups" />
            <MultiPick label="Regions" options={opts.regions || []} value={regions} onChange={setRegions}
              allLabel="All regions" />
            <MultiPick label="Resource types" options={opts.resource_types || []} value={types} onChange={setTypes}
              allLabel="All resource types" format={t => String(t).split('/').pop()} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
              <Field label="Tag key">
                <select value={tagKey} onChange={e => { setTagKey(e.target.value); setTagVal('') }} style={inputStyle}>
                  <option value="">Any tag</option>
                  {(opts.tag_keys || []).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Tag value">
                <input value={tagVal} onChange={e => setTagVal(e.target.value)} disabled={!tagKey}
                  placeholder={tagKey ? 'Any value' : 'Pick a tag key first'} style={inputStyle} />
              </Field>
              <Field label="Tagging">
                <select value={tagged} onChange={e => setTagged(e.target.value)} style={inputStyle}>
                  <option value="">Tagged and untagged</option>
                  <option value="yes">Tagged resources only</option>
                  <option value="no">Untagged resources only</option>
                </select>
              </Field>
            </div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 12, lineHeight: 1.55 }}>
              Estate totals and the by-service / by-region breakdowns come from the warehouse&rsquo;s per-dimension
              rollup, which can only be scoped by subscription. The report states this on its grounding page, so a
              reader is never shown a filtered total under an estate-wide heading.
            </div>
          </>
        )}

        {step === 3 && (
          <>
            {stepTitle('What goes in the report?',
              `${meta.label} has ${availableSections.length} sections. Untick anything you do not want — the report keeps its own running order.`)}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {availableSections.map(s => (
                <Chip key={s} on={effectiveSections.includes(s)} onClick={() => toggleSection(s)}>
                  {SECTION_LABELS[s] || s}
                </Chip>
              ))}
            </div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 12 }}>
              {effectiveSections.length} of {availableSections.length} sections selected. At least one is always kept.
            </div>
          </>
        )}

        {step === 4 && (
          <>
            {stepTitle('Brief the author',
              'Everything here is optional. The AI uses it to decide what to emphasise and which questions to answer — it can never change a figure.')}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14, marginBottom: 14 }}>
              <Field label="Customer / organization" hint="Printed on the cover page.">
                <input value={customer} onChange={e => setCustomer(e.target.value)}
                  placeholder="e.g. Contoso Ltd" style={inputStyle} />
              </Field>
              <Field label="Intended audience" hint="Who is reading it, and at what altitude.">
                <input value={audience} onChange={e => setAudience(e.target.value)}
                  placeholder="e.g. CFO and the board — non-technical" style={inputStyle} />
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Field label="Business context" hint="What is going on that the narrative should reflect — a migration, a cost-cutting mandate, a new business unit, a budget cycle.">
                <textarea value={context} onChange={e => setContext(e.target.value)}
                  placeholder="e.g. We migrated two workloads to Azure in July and the board has asked why spend jumped. A 20% run-rate reduction is targeted before year end."
                  style={taStyle} />
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Field label="Questions this report must answer" hint="One per line. The narrative addresses these directly wherever the data supports it.">
                <textarea value={questions} onChange={e => setQuestions(e.target.value)}
                  placeholder={'e.g.\nWhich subscription drove the increase?\nWhere is the fastest 20% saving?\nAre we over-committed on reservations?'}
                  style={taStyle} />
              </Field>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.textDim, fontSize: 13, cursor: 'pointer', flexWrap: 'wrap' }}>
              <input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)} />
              <Sparkles size={14} style={{ color: C.purple }} />
              AI narrative
              <span style={{ color: C.muted, fontSize: 11.5 }}>
                — turning this off keeps the same numbers with a deterministic write-up, and ignores the brief.
              </span>
            </label>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 12, lineHeight: 1.55 }}>
              Your brief is editorial direction only. It cannot introduce, override or justify a figure: if it asks
              for something the data does not contain, the report says the data has not been collected rather than
              estimating it.
            </div>
          </>
        )}

        {step === 5 && (
          <>
            {stepTitle('Review', 'Everything below goes into the report. Click any step above to change it.')}
            <div>
              <SummaryRow label="Report">
                <strong style={{ color: C.text }}>{meta.label}</strong> — {meta.desc}
              </SummaryRow>
              <SummaryRow label="Scope">
                {subs.length
                  ? subs.map(subName).join(', ')
                  : `All subscriptions${(opts.subscriptions || []).length ? ` (${opts.subscriptions.length})` : ''}`}
              </SummaryRow>
              <SummaryRow label="Filters">
                {activeFilters.length ? activeFilters.join(' · ') : 'None — the whole estate'}
              </SummaryRow>
              <SummaryRow label="Sections">
                {effectiveSections.map(s => SECTION_LABELS[s] || s).join(' · ')}
              </SummaryRow>
              <SummaryRow label="Customer">{customer.trim() || <em style={{ color: C.muted }}>Not set</em>}</SummaryRow>
              <SummaryRow label="Audience">{audience.trim() || <em style={{ color: C.muted }}>Not set</em>}</SummaryRow>
              <SummaryRow label="Business context">
                {context.trim() || <em style={{ color: C.muted }}>Not set</em>}
              </SummaryRow>
              <SummaryRow label="Questions">
                {questions.trim()
                  ? <span style={{ whiteSpace: 'pre-wrap' }}>{questions.trim()}</span>
                  : <em style={{ color: C.muted }}>Not set</em>}
              </SummaryRow>
              <SummaryRow label="Narrative">
                {useAi ? 'AI-written, grounded in the figures above' : 'Deterministic (no AI)'}
              </SummaryRow>
            </div>
          </>
        )}
      </div>

      {/* ── Wizard nav ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        {step > 0 && btn(() => go(step - 1), false, ChevronLeft, 'Back')}
        {!onReview && btn(() => go(step + 1), false, ChevronRight, `Next: ${STEPS[step + 1].label}`, true)}
        {onReview && btn(generate, busy, busy ? Loader : FileText,
          busy ? 'Generating…' : (showReport ? 'Regenerate report' : 'Generate report'), true)}
        {onReview && showReport && btn(genPdf, pdfBusy, FileText, 'Export PDF')}
        {onReview && showReport && btn(genXls, xlsBusy, FileSpreadsheet, 'Export Excel')}
        <button onClick={resetAll} style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
          padding: '8px 14px', borderRadius: 7, cursor: 'pointer',
          background: 'transparent', border: `1px solid ${C.border}`, color: C.muted,
        }}><RotateCcw size={13} /> Start over</button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 16 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* What this report actually covers — printed with it, so no reader guesses. */}
      {showReport && report?.grounding?.scope_filters?.filtered && (
        <div style={{
          background: 'rgba(59,130,246,0.08)', border: `1px solid ${C.accent}`, borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, fontSize: 12, color: C.textDim, lineHeight: 1.55,
        }}>
          <strong style={{ color: C.text }}>Scoped report — </strong>
          {report.grounding.scope_filters.applied.join(' · ')}
          <span style={{ color: C.muted }}>
            {' '}({report.grounding.scope_filters.resources_in_scope} of{' '}
            {report.grounding.scope_filters.resources_total} resources).{' '}
            {report.grounding.scope_filters.note}
          </span>
        </div>
      )}

      {/* The brief that steered the narrative, echoed so a reader knows what was asked for. */}
      {showReport && report?.grounding?.author_brief_applied && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: C.purple, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
            <MessageSquare size={13} /> Written to this brief
          </div>
          {Object.entries(report.grounding.author_brief || {}).map(([k, v]) => (
            <div key={k} style={{ color: C.textDim, fontSize: 12, lineHeight: 1.6 }}>
              <span style={{ color: C.muted, textTransform: 'capitalize' }}>{k}:</span> {v}
            </div>
          ))}
          <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>
            Direction only — every figure still comes from Cost Management.
          </div>
        </div>
      )}

      {exportErr && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 16 }}>
          <AlertCircle size={16} /> {exportErr}
        </div>
      )}

      {busy && !showReport && (
        <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>
          <Loader size={26} className="animate-spin" style={{ margin: '0 auto 12px', color: C.accent }} />
          <div style={{ fontSize: 14, color: C.textDim }}>Building your {meta.label} from live Cost Management data…</div>
          {useAi && <div style={{ fontSize: 12, marginTop: 4 }}>The AI narrative can take up to a minute — every number is grounded, so it takes its time.</div>}
        </div>
      )}

      {showReport && (
        <>
          {!onReview && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 16, color: C.muted, fontSize: 12 }}>
              <Pencil size={13} />
              Showing the report you already generated. Change anything above, then
              <button onClick={() => go(STEPS.length - 1)} style={{
                background: 'transparent', border: 'none', color: C.accent, cursor: 'pointer',
                fontSize: 12, fontWeight: 600, padding: 0,
              }}>return to Review</button>
              to regenerate.
            </div>
          )}

          {/* Headline */}
          {es.headline && (
            <div style={{ background: 'rgba(59,130,246,0.08)', border: `1px solid ${C.border}`, borderLeft: `3px solid ${meta.color}`, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ color: C.text, fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>{es.headline}</div>
            </div>
          )}

          {/* KPI strip */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            {(report.kpis || []).map((k, i) => (<Kpi key={i} label={k.label} value={k.value} sub={k.sub} />))}
          </div>

          {report.grounding?.coverage_pct != null && report.grounding.coverage_pct < 80 && (
            <div style={{ color: C.muted, fontSize: 11, marginBottom: 16, lineHeight: 1.5 }}>
              Cost-at-risk &amp; savings figures use per-resource attribution, currently covering ~{report.grounding.coverage_pct}% of the
              authoritative estate total — treat them as a lower bound. Spend, subscription and service-family totals are 100% complete.
            </div>
          )}

          {/* Trend */}
          {trend.length >= 2 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: C.textDim, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                <TrendingUp size={14} style={{ color: C.accent }} /> Spend trend
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="finreppro" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickFormatter={d => String(d).slice(5)} minTickGap={24} />
                  <YAxis tick={{ fill: '#475569', fontSize: 9 }} tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
                  <Tooltip {...rechartsTooltipProps()} formatter={v => fmtUsd(v, 2)} />
                  <Area type="monotone" dataKey="cost" stroke="#3b82f6" fill="url(#finreppro)" strokeWidth={1.6} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* AI narrative */}
          {es.narrative && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: C.purple, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                <Sparkles size={15} /> Executive narrative
              </div>
              <div style={{ color: C.textDim, fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{es.narrative}</div>
            </div>
          )}

          {/* Key findings */}
          {(es.key_findings || []).length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ color: C.textDim, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Key findings</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: C.textDim, fontSize: 13, lineHeight: 1.7 }}>
                {es.key_findings.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}

          {/* Section counts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
            {sectionCounts.map((sc, i) => (
              <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ color: C.text, fontSize: 20, fontWeight: 700 }}>{sc.n}</div>
                <div style={{ color: C.muted, fontSize: 12 }}>{sc.label}</div>
              </div>
            ))}
          </div>

          <p style={{ color: C.muted, fontSize: 11 }}>
            The PDF renders in your browser (branded, multi-section, per-subscription). Excel is a multi-sheet workbook.
            {report.grounding?.data_source ? ` Source: ${report.grounding.data_source}.` : ''}
            {report.model ? ` Narrative model: ${report.model}.` : ''}
          </p>
        </>
      )}
    </div>
  )
}
