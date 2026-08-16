/**
 * FinOpsExecutiveReport — the FinOps report studio.
 *
 * Pick a report type (Executive Cost Summary, Optimization & Savings, Allocation /
 * Showback, Commitment Coverage, Budget & Forecast, Anomaly), generate a consultant-
 * grade report whose EVERY figure is sourced from Azure Cost Management (the warehouse)
 * with an AI-written narrative, preview it, then export a branded PDF (client, react-pdf,
 * lazy) or a multi-sheet Excel workbook (server).
 */
import React, { useState, useMemo, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  FileText, FileSpreadsheet, Sparkles, AlertCircle, Loader, DollarSign, PiggyBank,
  PieChart, ShieldCheck, Wallet, Activity, CheckCircle2, TrendingUp,
  Layers, Server, HardDrive, Network, Shield, Database, Building2, Boxes,
} from 'lucide-react'
import { finopsApi, fmtUsd } from './finopsApi'
import { C, rechartsTooltipProps } from './finopsTheme'

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
]

const REPORT_GROUPS = ['Core', 'Management Review']

function Kpi({ label, value, sub }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '13px 15px' }}>
      <div style={{ color: C.muted, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
      <div style={{ color: C.text, fontSize: 20, fontWeight: 700, marginTop: 3 }}>{value}</div>
      {sub != null && <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function FinOpsExecutiveReport() {
  const [reportType, setReportType] = useState('executive')
  const [customer, setCustomer] = useState('')
  const [useAi, setUseAi] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [report, setReport] = useState(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [xlsBusy, setXlsBusy] = useState(false)
  const [exportErr, setExportErr] = useState(null)

  const generate = useCallback(async () => {
    setBusy(true); setError(null); setExportErr(null)
    try {
      const rep = await finopsApi.generateExecReport({
        report_type: reportType, customer: customer.trim(), use_ai: useAi,
      })
      setReport(rep)
    } catch (e) {
      setError(e.message || 'Report generation failed')
    } finally { setBusy(false) }
  }, [reportType, customer, useAi])

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

  return (
    <div style={{ padding: 24, maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 22, fontWeight: 700, margin: 0 }}>
          <FileText size={22} style={{ color: C.accent }} /> FinOps Report Studio
        </h1>
        <p style={{ color: C.muted, fontSize: 13, margin: '6px 0 0' }}>
          Consultant-grade, board-ready reports. Every figure comes directly from Azure Cost Management — nothing is estimated.
          Export a branded PDF or multi-sheet Excel.
        </p>
      </div>

      {/* Report type picker */}
      {REPORT_GROUPS.map(group => (
        <div key={group} style={{ marginBottom: 16 }}>
          <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
            {group === 'Core' ? 'FinOps Framework reports' : 'Management cost & usage review'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {REPORT_TYPES.filter(t => t.group === group).map(t => {
              const active = reportType === t.key
              return (
                <button key={t.key} onClick={() => setReportType(t.key)} style={{
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

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Customer / organization name (optional)"
          style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: '9px 14px', color: C.text, fontSize: 13, minWidth: 280 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: C.textDim, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)} />
          <Sparkles size={14} style={{ color: C.purple }} /> AI narrative
        </label>
        {btn(generate, busy, busy ? Loader : FileText, busy ? 'Generating…' : (showReport ? 'Regenerate' : 'Generate report'), true)}
        {showReport && btn(genPdf, pdfBusy, FileText, 'Export PDF')}
        {showReport && btn(genXls, xlsBusy, FileSpreadsheet, 'Export Excel')}
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 16 }}>
          <AlertCircle size={16} /> {error}
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
