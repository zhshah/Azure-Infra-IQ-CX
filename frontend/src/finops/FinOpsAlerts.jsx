/**
 * FinOps Alerts — Budget alerts + anomaly list with severity badges
 */
import React, { useState, useEffect } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, RefreshCw, Bell } from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'

const SEVERITY_CONFIG = {
  critical: { color: '#ef4444', bg: '#1a0e0e', border: 'var(--c-7f1d1d)', icon: AlertCircle,   label: 'Critical' },
  high:     { color: '#f97316', bg: '#1c0f07', border: 'var(--c-9a3412)', icon: AlertTriangle, label: 'High' },
  medium:   { color: '#f59e0b', bg: 'var(--c-1c1003)', border: '#854d0e', icon: AlertTriangle, label: 'Medium' },
  low:      { color: '#3b82f6', bg: 'var(--c-0c1929)', border: '#1d4ed8', icon: Bell,          label: 'Low' },
  info:     { color: 'var(--c-64748b)', bg: 'var(--c-0f172a)', border: 'var(--c-334155)', icon: Bell,          label: 'Info' },
}

function AlertItem({ alert }) {
  const sev = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info
  const Icon = sev.icon
  return (
    <div style={{
      background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 8,
      padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <Icon size={16} style={{ color: sev.color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
          <div style={{ color: 'var(--c-e2e8f0)', fontWeight: 600, fontSize: 13 }}>{alert.budget_name || alert.title || 'Alert'}</div>
          <span style={{
            background: sev.bg, border: `1px solid ${sev.border}`, color: sev.color,
            padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', flexShrink: 0,
          }}>
            {sev.label}
          </span>
        </div>
        <div style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>{alert.message || alert.description}</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, color: 'var(--c-475569)' }}>
          {alert.triggered_at && <span>Triggered: {new Date(alert.triggered_at).toLocaleString()}</span>}
          {alert.actual_cost_usd != null && <span>Actual: <span style={{ color: sev.color }}>{fmtUsd(alert.actual_cost_usd, 2)}</span></span>}
          {alert.threshold_pct  != null && <span>Threshold: {alert.threshold_pct}%</span>}
          {alert.budget_amount_usd != null && <span>Budget: {fmtUsd(alert.budget_amount_usd)}</span>}
        </div>
      </div>
    </div>
  )
}

export default function FinOpsAlerts() {
  const [alerts,  setAlerts]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [filter,  setFilter]  = useState('all')

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const raw = await finopsApi.getBudgetAlerts()
      // Map raw alerts to common shape; use backend severity if provided
      const mapped = (raw || []).map(a => ({
        ...a,
        budget_name:       a.budget_name       ?? 'Budget Alert',
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
      setAlerts(mapped)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

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
        <FinOpsExportMenu view="alerts" focusDays={30} onXlsx={() => finopsApi.downloadReport()} report={{ title: 'FinOps Alerts', kpis: [{ label: 'Active Alerts', value: String((alerts || []).length) }], tables: [{ title: 'Alerts', columns: ['Budget', 'Severity', 'Threshold %', 'Actual'], rows: (alerts || []).slice(0, 40).map(a => [a.budget_name || '-', a.severity || '-', fmtPct(a.threshold_pct), fmtUsd(a.actual_cost_usd)]) }] }} />
      </div>
      <FinOpsAIPanel view="alerts" data={{ alert_count: (alerts || []).length, alerts: (alerts || []).slice(0, 15).map(a => ({ budget: a.budget_name, severity: a.severity, threshold: a.threshold_pct, actual: a.actual_cost_usd, budget_amount: a.budget_amount_usd })) }} />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>FinOps Alerts</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>Budget threshold alerts from Azure Cost Management</p>
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

      {/* Filter tabs */}
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
            ? 'No budget alerts triggered. Configure budgets to start tracking spend thresholds.'
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
