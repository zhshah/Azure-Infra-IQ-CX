/**
 * FinOps Alerts — Budget alerts + anomaly list with severity badges
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, RefreshCw, Bell, Plus, Trash2, Pencil, X, Settings2, Power } from 'lucide-react'
import { finopsApi, fmtUsd } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'

const SEVERITY_CONFIG = {
  critical: { color: '#ef4444', bg: '#1a0e0e', border: 'var(--c-7f1d1d)', icon: AlertCircle,   label: 'Critical' },
  high:     { color: '#f97316', bg: '#1c0f07', border: 'var(--c-9a3412)', icon: AlertTriangle, label: 'High' },
  medium:   { color: '#f59e0b', bg: 'var(--c-1c1003)', border: '#854d0e', icon: AlertTriangle, label: 'Medium' },
  low:      { color: '#3b82f6', bg: 'var(--c-0c1929)', border: '#1d4ed8', icon: Bell,          label: 'Low' },
  info:     { color: 'var(--c-64748b)', bg: 'var(--c-0f172a)', border: 'var(--c-334155)', icon: Bell,          label: 'Info' },
}

// ── Customizable rule engine ────────────────────────────────────────────────
// Metrics evaluate against the live FinOps summary KPIs (GET /finops/summary).
const METRICS = {
  forecast_eom_usd:       { label: 'Projected month-end spend', unit: 'usd',   hint: 'End-of-month forecast from month-to-date run rate.' },
  total_spend_mtd:        { label: 'Month-to-date spend',       unit: 'usd',   hint: 'Actual spend so far this month.' },
  mom_delta_pct:          { label: 'Month-over-month change',   unit: 'pct',   hint: 'MTD spend vs. last month, as a percentage.' },
  savings_identified_usd: { label: 'Identified savings',        unit: 'usd',   hint: 'Total optimization opportunities detected.' },
  budget_utilization_pct: { label: 'Budget utilization',        unit: 'pct',   hint: 'Average utilization across all budgets.' },
  budgets_exceeded:       { label: 'Budgets exceeded',          unit: 'count', hint: 'Number of budgets over 100%.' },
  ri_coverage_pct:        { label: 'Reservation coverage',      unit: 'pct',   hint: '% of eligible usage covered by reservations.' },
  ri_utilization_pct:     { label: 'Reservation utilization',   unit: 'pct',   hint: '% of purchased reservations actually used.' },
  tagging_compliance_pct: { label: 'Tag compliance',            unit: 'pct',   hint: '% of resources carrying the required tags.' },
  total_untagged:         { label: 'Untagged resources',        unit: 'count', hint: 'Resources missing one or more required tags.' },
  anomaly_count:          { label: 'Cost anomalies',            unit: 'count', hint: 'Statistically detected spend spikes.' },
}

const OPERATORS = {
  gt:  { label: 'is greater than', symbol: '>', test: (a, b) => a >  b },
  gte: { label: 'is at or above',  symbol: '\u2265', test: (a, b) => a >= b },
  lt:  { label: 'is below',        symbol: '<', test: (a, b) => a <  b },
  lte: { label: 'is at or below',  symbol: '\u2264', test: (a, b) => a <= b },
}

const fmtMetric = (unit, v) => {
  const n = Number(v) || 0
  if (unit === 'usd') return fmtUsd(n)
  if (unit === 'pct') return `${n}%`
  return n.toLocaleString()
}

const DEFAULT_RULES = [
  { id: 'r-anomaly',   name: 'Cost anomaly detected',           enabled: true, metric: 'anomaly_count',         operator: 'gt',  threshold: 0,  severity: 'high' },
  { id: 'r-mom',       name: 'Spend up more than 25% MoM',      enabled: true, metric: 'mom_delta_pct',          operator: 'gt',  threshold: 25, severity: 'high' },
  { id: 'r-budgetmax', name: 'Budget exceeded (over 100%)',     enabled: true, metric: 'budgets_exceeded',       operator: 'gt',  threshold: 0,  severity: 'critical' },
  { id: 'r-budget90',  name: 'Budget utilization at/above 90%', enabled: true, metric: 'budget_utilization_pct', operator: 'gte', threshold: 90, severity: 'critical' },
  { id: 'r-tag',       name: 'Tag compliance below 80%',        enabled: true, metric: 'tagging_compliance_pct', operator: 'lt',  threshold: 80, severity: 'medium' },
  { id: 'r-ri',        name: 'Reservation coverage below 50%',  enabled: true, metric: 'ri_coverage_pct',        operator: 'lt',  threshold: 50, severity: 'low' },
]

const RULES_KEY = 'finops:alerts:rules:v1'
const loadRules = () => {
  try { const s = localStorage.getItem(RULES_KEY); if (s) { const p = JSON.parse(s); if (Array.isArray(p)) return p } } catch { /* ignore */ }
  return DEFAULT_RULES.map(r => ({ ...r }))
}
const persistRules = (r) => { try { localStorage.setItem(RULES_KEY, JSON.stringify(r)) } catch { /* ignore */ } }

function evaluateRules(rules, kpi) {
  if (!kpi) return []
  const out = []
  for (const r of rules) {
    if (!r.enabled) continue
    const m = METRICS[r.metric]
    const op = OPERATORS[r.operator]
    if (!m || !op) continue
    const actual = Number(kpi[r.metric] ?? 0)
    const threshold = Number(r.threshold ?? 0)
    if (op.test(actual, threshold)) {
      out.push({
        source: 'rule', rule_id: r.id, title: r.name || m.label, severity: r.severity || 'medium',
        metric: r.metric, metric_label: m.label, unit: m.unit,
        actual_value: actual, operator: r.operator, threshold,
        triggered_at: new Date().toISOString(),
        message: `${m.label} ${op.label} ${fmtMetric(m.unit, threshold)} \u2014 currently ${fmtMetric(m.unit, actual)}.`,
      })
    }
  }
  return out
}

// ── shared inline styles ────────────────────────────────────────────────────
const inputStyle  = { background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 9px', color: 'var(--c-e2e8f0)', fontSize: 12, width: '100%' }
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const primaryBtn  = { background: '#4f46e5', border: '1px solid #4f46e5', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }
const ghostBtn    = { background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }
const iconBtn     = { background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '5px 7px', cursor: 'pointer', color: 'var(--c-94a3b8)', display: 'flex', alignItems: 'center' }

function AlertItem({ alert }) {
  const sev = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info
  const Icon = sev.icon
  const isRule = alert.source === 'rule'
  const op = alert.operator ? OPERATORS[alert.operator] : null
  return (
    <div style={{
      background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 8,
      padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <Icon size={16} style={{ color: sev.color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ color: 'var(--c-e2e8f0)', fontWeight: 600, fontSize: 13 }}>{alert.title || alert.budget_name || 'Alert'}</span>
            <span style={{
              background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', color: 'var(--c-64748b)',
              padding: '1px 7px', borderRadius: 10, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', flexShrink: 0, letterSpacing: 0.3,
            }}>
              {isRule ? 'Custom rule' : 'Azure budget'}
            </span>
          </div>
          <span style={{
            background: sev.bg, border: `1px solid ${sev.border}`, color: sev.color,
            padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', flexShrink: 0,
          }}>
            {sev.label}
          </span>
        </div>
        <div style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>{alert.message || alert.description}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 6, fontSize: 11, color: 'var(--c-475569)' }}>
          {alert.triggered_at && <span>Triggered: {new Date(alert.triggered_at).toLocaleString()}</span>}
          {isRule ? (
            <>
              <span>Now: <span style={{ color: sev.color }}>{fmtMetric(alert.unit, alert.actual_value)}</span></span>
              {op && <span>Rule: {op.symbol} {fmtMetric(alert.unit, alert.threshold)}</span>}
            </>
          ) : (
            <>
              {alert.actual_cost_usd != null && <span>Actual: <span style={{ color: sev.color }}>{fmtUsd(alert.actual_cost_usd, 2)}</span></span>}
              {alert.threshold_pct  != null && <span>Threshold: {alert.threshold_pct}%</span>}
              {alert.budget_amount_usd != null && <span>Budget: {fmtUsd(alert.budget_amount_usd)}</span>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, grow }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: grow ? 1 : 'none', minWidth: grow ? 180 : 'auto' }}>
      <span style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</span>
      {children}
    </label>
  )
}

function RuleEditor({ draft, onChange, onCancel, onSave }) {
  const set = (k, v) => onChange({ ...draft, [k]: v })
  const unit = METRICS[draft.metric]?.unit
  const valid = (draft.name || '').trim().length > 0
  return (
    <div style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Rule name" grow>
          <input value={draft.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Forecast over $50k" style={inputStyle} />
        </Field>
        <Field label="Severity">
          <select value={draft.severity} onChange={e => set('severity', e.target.value)} style={selectStyle}>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="When metric" grow>
          <select value={draft.metric} onChange={e => set('metric', e.target.value)} style={selectStyle}>
            {Object.entries(METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Condition">
          <select value={draft.operator} onChange={e => set('operator', e.target.value)} style={selectStyle}>
            {Object.entries(OPERATORS).map(([k, o]) => <option key={k} value={k}>{o.symbol} {o.label}</option>)}
          </select>
        </Field>
        <Field label={`Threshold${unit === 'usd' ? ' ($)' : unit === 'pct' ? ' (%)' : ''}`}>
          <input type="number" value={draft.threshold} onChange={e => set('threshold', e.target.value === '' ? '' : Number(e.target.value))} style={{ ...inputStyle, width: 120 }} />
        </Field>
      </div>
      <div style={{ color: 'var(--c-475569)', fontSize: 11 }}>{METRICS[draft.metric]?.hint}</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}><X size={12} /> Cancel</button>
        <button onClick={onSave} disabled={!valid} style={{ ...primaryBtn, opacity: valid ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed' }}>Save rule</button>
      </div>
    </div>
  )
}

function RuleRow({ rule, kpi, onToggle, onEdit, onDelete }) {
  const m = METRICS[rule.metric]
  const op = OPERATORS[rule.operator]
  const sev = SEVERITY_CONFIG[rule.severity] || SEVERITY_CONFIG.info
  const actual = kpi ? Number(kpi[rule.metric] ?? 0) : null
  const firing = rule.enabled && actual != null && op && op.test(actual, Number(rule.threshold))
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
      background: 'var(--c-0f172a)', border: `1px solid ${firing ? sev.border : 'var(--c-1e293b)'}`,
      opacity: rule.enabled ? 1 : 0.55,
    }}>
      <button onClick={onToggle} title={rule.enabled ? 'Disable rule' : 'Enable rule'} style={{
        background: rule.enabled ? 'var(--c-14321f)' : 'var(--c-1e293b)', border: `1px solid ${rule.enabled ? '#166534' : 'var(--c-334155)'}`,
        color: rule.enabled ? '#4ade80' : 'var(--c-64748b)', borderRadius: 6, padding: '3px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0,
      }}>
        <Power size={12} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--c-e2e8f0)', fontSize: 12, fontWeight: 600 }}>{rule.name || '(unnamed rule)'}</span>
          <span style={{ color: sev.color, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', border: `1px solid ${sev.border}`, borderRadius: 8, padding: '0 6px' }}>{sev.label}</span>
          {firing && <span style={{ color: '#f97316', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>\u25cf Firing</span>}
        </div>
        <div style={{ color: 'var(--c-64748b)', fontSize: 11, marginTop: 2 }}>
          {m ? m.label : rule.metric} {op ? op.symbol : '?'} {fmtMetric(m?.unit, rule.threshold)}
          {actual != null && <span style={{ color: 'var(--c-475569)' }}> \u00b7 now {fmtMetric(m?.unit, actual)}</span>}
        </div>
      </div>
      <button onClick={onEdit} title="Edit rule" style={iconBtn}><Pencil size={12} /></button>
      <button onClick={onDelete} title="Delete rule" style={{ ...iconBtn, color: '#f87171' }}><Trash2 size={12} /></button>
    </div>
  )
}

function RuleManager({ rules, kpi, editing, setEditing, onSave, onDelete, onToggle, onReset, onAdd }) {
  return (
    <div style={{ background: 'var(--c-0b1220)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Settings2 size={14} style={{ color: 'var(--c-818cf8)' }} />
          <span style={{ color: 'var(--c-e2e8f0)', fontWeight: 600, fontSize: 13 }}>Alert rules</span>
          <span style={{ color: 'var(--c-475569)', fontSize: 11 }}>Evaluated live against your FinOps KPIs \u00b7 saved in this browser</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onReset} style={ghostBtn}>Reset to defaults</button>
          <button onClick={onAdd} style={primaryBtn}><Plus size={12} /> Add rule</button>
        </div>
      </div>

      {editing && (
        <RuleEditor
          draft={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() => { if ((editing.name || '').trim()) onSave(editing) }}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rules.length === 0 && <div style={{ color: 'var(--c-475569)', fontSize: 12, padding: '8px 0' }}>No rules yet. Add one to start alerting.</div>}
        {rules.map(r => (
          <RuleRow key={r.id} rule={r} kpi={kpi}
            onToggle={() => onToggle(r.id)}
            onEdit={() => setEditing({ ...r })}
            onDelete={() => onDelete(r.id)} />
        ))}
      </div>
    </div>
  )
}

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

export default function FinOpsAlerts() {
  const [budgetAlerts, setBudgetAlerts] = useState([])
  const [kpi,     setKpi]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [filter,  setFilter]  = useState('all')
  const [rules,   setRules]   = useState(loadRules)
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [raw, summary] = await Promise.all([
        finopsApi.getBudgetAlerts().catch(() => []),
        finopsApi.getSummary().catch(() => null),
      ])
      const mapped = (raw || []).map(a => ({
        ...a,
        source:            'budget',
        budget_name:       a.budget_name       ?? 'Budget Alert',
        title:             a.budget_name       ?? 'Budget Alert',
        threshold_pct:     a.threshold_pct     ?? 0,
        actual_cost_usd:   a.actual_cost_usd   ?? null,
        budget_amount_usd: a.budget_amount_usd ?? null,
        severity: a.severity ?? (
          (a.threshold_pct ?? 0) >= 100 ? 'critical' :
          (a.threshold_pct ?? 0) >= 90  ? 'high' :
          (a.threshold_pct ?? 0) >= 75  ? 'medium' : 'low'
        ),
        message: a.message ?? `Budget "${a.budget_name ?? 'Unknown'}" reached ${a.threshold_pct ?? 0}% utilization` +
          (a.actual_cost_usd != null ? ` — actual spend ${fmtUsd(a.actual_cost_usd, 2)}` : '') +
          (a.budget_amount_usd != null ? ` of ${fmtUsd(a.budget_amount_usd)} budget` : '') + '.',
      }))
      setBudgetAlerts(mapped)
      setKpi(summary || null)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { persistRules(rules) }, [rules])

  // Live rule evaluation against the FinOps KPIs, merged with Azure budget alerts.
  const ruleAlerts = useMemo(() => evaluateRules(rules, kpi), [rules, kpi])
  const alerts = useMemo(
    () => [...ruleAlerts, ...budgetAlerts].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9)),
    [ruleAlerts, budgetAlerts],
  )

  // Rule CRUD (persisted to localStorage via the effect above).
  const upsertRule = useCallback((draft) => {
    setRules(prev => (prev.some(r => r.id === draft.id)
      ? prev.map(r => (r.id === draft.id ? { ...draft } : r))
      : [...prev, { ...draft }]))
    setEditing(null)
  }, [])
  const deleteRule = useCallback((id) => setRules(prev => prev.filter(r => r.id !== id)), [])
  const toggleRule = useCallback((id) => setRules(prev => prev.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r))), [])
  const resetRules = useCallback(() => { setEditing(null); setRules(DEFAULT_RULES.map(r => ({ ...r }))) }, [])
  const addRule    = useCallback(() => setEditing({
    id: `r-${Date.now().toString(36)}`, name: '', enabled: true,
    metric: 'forecast_eom_usd', operator: 'gt', threshold: 0, severity: 'high',
  }), [])

  const FILTERS = ['all', 'critical', 'high', 'medium', 'low']
  const visible = filter === 'all' ? alerts : alerts.filter(a => a.severity === filter)
  const countBy = (sev) => alerts.filter(a => a.severity === sev).length

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 10 }}>
      <RefreshCw size={18} className="animate-spin" style={{ color: '#3b82f6' }} />
      <span style={{ color: 'var(--c-94a3b8)' }}>Loading alerts…</span>
    </div>
  )
  if (error) return (
    <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 10, padding: 16, color: 'var(--c-fca5a5)', display: 'flex', gap: 8 }}>
      <AlertCircle size={16} /><span style={{ fontSize: 12 }}>{error}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <FinOpsExportMenu
          view="alerts"
          focusDays={30}
          onXlsx={() => finopsApi.downloadReport()}
          onCsv={() => {
            const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
            const header = ['Alert', 'Source', 'Severity', 'Metric', 'Condition', 'Threshold', 'Current', 'Message']
            const rows = alerts.map(a => [
              a.title,
              a.source === 'rule' ? 'Custom rule' : 'Azure budget',
              a.severity,
              a.source === 'rule' ? (a.metric_label || a.metric) : 'Budget utilization',
              a.source === 'rule' ? (OPERATORS[a.operator]?.symbol || '') : '\u2265',
              a.source === 'rule' ? fmtMetric(a.unit, a.threshold) : `${a.threshold_pct}%`,
              a.source === 'rule' ? fmtMetric(a.unit, a.actual_value) : (a.actual_cost_usd != null ? fmtUsd(a.actual_cost_usd, 2) : ''),
              a.message,
            ].map(esc).join(','))
            const csv = [header.map(esc).join(','), ...rows].join('\n')
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url; link.download = `azure-finops-alerts-${new Date().toISOString().slice(0, 10)}.csv`
            document.body.appendChild(link); link.click()
            setTimeout(() => { URL.revokeObjectURL(url); link.remove() }, 1000)
          }}
          report={{
            title: 'FinOps Alerts',
            kpis: [
              { label: 'Active Alerts', value: String(alerts.length) },
              { label: 'Critical', value: String(countBy('critical')) },
              { label: 'High', value: String(countBy('high')) },
              { label: 'Rules Enabled', value: String(rules.filter(r => r.enabled).length) },
            ],
            tables: [{
              title: 'Active Alerts',
              columns: ['Alert', 'Source', 'Severity', 'Detail'],
              rows: alerts.slice(0, 40).map(a => [a.title || '-', a.source === 'rule' ? 'Custom rule' : 'Azure budget', a.severity || '-', a.message || '-']),
            }],
          }}
        />
      </div>
      <FinOpsAIPanel view="alerts" data={{
        active_alerts: alerts.length,
        by_severity: { critical: countBy('critical'), high: countBy('high'), medium: countBy('medium'), low: countBy('low') },
        firing: alerts.slice(0, 15).map(a => ({ title: a.title, severity: a.severity, source: a.source, message: a.message })),
        rules: rules.map(r => ({ name: r.name, metric: r.metric, operator: r.operator, threshold: r.threshold, severity: r.severity, enabled: r.enabled })),
        kpis: kpi || {},
      }} />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>FinOps Alerts</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>Custom alert rules evaluated live against your FinOps KPIs, merged with Azure Cost Management budget alerts</p>
        </div>
        <button onClick={load} style={{
          background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6,
          padding: '5px 10px', cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 11,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Severity summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
        {[
          { sev: 'critical', label: 'Critical', color: '#ef4444' },
          { sev: 'high',     label: 'High',     color: '#f97316' },
          { sev: 'medium',   label: 'Medium',   color: '#f59e0b' },
          { sev: 'low',      label: 'Low',      color: '#3b82f6' },
        ].map(c => (
          <button
            key={c.sev}
            onClick={() => setFilter(filter === c.sev ? 'all' : c.sev)}
            style={{
              background: 'var(--c-111827)',
              border: `1px solid ${filter === c.sev ? c.color : 'var(--c-1e293b)'}`,
              borderRadius: 8, padding: '10px 14px', cursor: 'pointer', textAlign: 'center',
            }}
          >
            <div style={{ color: c.color, fontSize: 22, fontWeight: 800 }}>{countBy(c.sev)}</div>
            <div style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{c.label}</div>
          </button>
        ))}
      </div>

      {/* Customizable rule engine */}
      <RuleManager
        rules={rules} kpi={kpi} editing={editing} setEditing={setEditing}
        onSave={upsertRule} onDelete={deleteRule} onToggle={toggleRule} onReset={resetRules} onAdd={addRule}
      />

      {/* Active alerts + severity filter */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: 4, width: 'fit-content' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? 'var(--c-1e293b)' : 'none',
            border: `1px solid ${filter === f ? 'var(--c-334155)' : 'transparent'}`,
            borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
            color: filter === f ? 'var(--c-e2e8f0)' : 'var(--c-475569)', fontSize: 11, textTransform: 'capitalize',
          }}>
            {f} {f !== 'all' && `(${countBy(f)})`}
          </button>
        ))}
      </div>

      {/* Alert list */}
      {visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--c-334155)', fontSize: 13 }}>
          <CheckCircle size={32} style={{ color: 'var(--c-166534)', margin: '0 auto 10px' }} />
          {alerts.length === 0
            ? 'No alerts firing — your custom rules are within thresholds and no Azure budget alerts are active. Add or tune rules below.'
            : 'No alerts for the selected severity level.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map((a, i) => <AlertItem key={i} alert={a} />)}
        </div>
      )}
    </div>
  )
}
