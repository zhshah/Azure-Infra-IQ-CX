/**
 * FinOpsComplianceView — maps this tool's capabilities to the FinOps Framework
 * (finops.org) domains & capabilities, shows a Crawl/Walk/Run maturity scorecard,
 * a FOCUS 1.2 compliance badge (live from /api/finops/focus), and AI-generated
 * maturity recommendations.
 *
 * Rules of Hooks: all hooks unconditional, before any early return.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ShieldCheck, CheckCircle2, CircleDashed, Circle, RefreshCw, Database, Award } from 'lucide-react'
import { finopsApi, fmtUsd } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'

// status: 'full' | 'partial' | 'none'
const DOMAINS = [
  {
    domain: 'Understand Usage & Cost',
    capabilities: [
      { name: 'Data Ingestion', status: 'full', note: 'Cost warehouse (Azure SQL) + Redis cache + FOCUS export' },
      { name: 'Allocation', status: 'full', note: 'Cost allocation by sub/RG/service/tag + chargeback' },
      { name: 'Reporting & Analytics', status: 'full', note: 'Dashboards, Cost Explorer, drill-down, exports' },
      { name: 'Anomaly Management', status: 'full', note: 'Warehouse anomaly detection (7-day spike)' },
    ],
  },
  {
    domain: 'Quantify Business Value',
    capabilities: [
      { name: 'Planning & Estimating', status: 'partial', note: 'Forecast-driven; pricing estimator planned' },
      { name: 'Forecasting', status: 'full', note: 'EOM + horizon forecast with confidence bands' },
      { name: 'Budgeting', status: 'full', note: 'Budget Manager (Azure budgets) + alerts' },
      { name: 'KPIs & Benchmarking', status: 'full', note: 'KPI cards + industry benchmark panel' },
      { name: 'Unit Economics', status: 'partial', note: 'Cost-per-resource; custom unit metrics planned' },
    ],
  },
  {
    domain: 'Optimize Usage & Cost',
    capabilities: [
      { name: 'Rate Optimization', status: 'full', note: 'Reservations / Savings Plans (Commitments & RI)' },
      { name: 'Workload Optimization', status: 'full', note: 'Rightsizing, waste & orphan detection' },
      { name: 'Licensing & SaaS', status: 'full', note: 'Licensing & Reservation module' },
      { name: 'Cloud Sustainability', status: 'full', note: 'Carbon footprint estimate' },
    ],
  },
  {
    domain: 'Manage the FinOps Practice',
    capabilities: [
      { name: 'FinOps Practice Operations', status: 'full', note: 'AI insights in every view + recommendations' },
      { name: 'Cost Policy & Governance', status: 'partial', note: 'Tag compliance; policy engine planned' },
      { name: 'Invoicing & Chargeback', status: 'full', note: 'Chargeback report + CSV/XLSX export' },
      { name: 'FinOps Tools & Services', status: 'full', note: 'FOCUS 1.2 export, Microsoft FinOps toolkit aligned' },
    ],
  },
]

const STATUS_META = {
  full:    { icon: CheckCircle2, color: '#22c55e', label: 'Implemented' },
  partial: { icon: CircleDashed, color: '#f59e0b', label: 'Partial' },
  none:    { icon: Circle,       color: 'var(--c-475569)', label: 'Planned' },
}

function maturityFromScore(pct) {
  if (pct >= 85) return { label: 'Run', color: '#22c55e' }
  if (pct >= 55) return { label: 'Walk', color: '#3b82f6' }
  return { label: 'Crawl', color: '#f59e0b' }
}

export default function FinOpsComplianceView() {
  const [focus, setFocus]     = useState(null)
  const [loading, setLoading] = useState(true)
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController(); abortRef.current = ctrl
    setLoading(true)
    try {
      const f = await finopsApi.getFocus(30, 1, ctrl.signal)
      if (!ctrl.signal.aborted) setFocus(f?.summary || null)
    } catch { /* non-critical */ }
    finally { if (!ctrl.signal.aborted) setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort() }, [])

  const { score, counts } = useMemo(() => {
    let full = 0, partial = 0, total = 0
    for (const d of DOMAINS) for (const c of d.capabilities) {
      total += 1
      if (c.status === 'full') full += 1
      else if (c.status === 'partial') partial += 1
    }
    const pct = total ? Math.round(((full + partial * 0.5) / total) * 100) : 0
    return { score: pct, counts: { full, partial, total } }
  }, [])

  const maturity = maturityFromScore(score)

  const aiData = useMemo(() => ({
    finops_maturity_pct: score,
    maturity_stage: maturity.label,
    capabilities_implemented: counts.full,
    capabilities_partial: counts.partial,
    capabilities_total: counts.total,
    focus_records: focus?.record_count || 0,
    focus_version: focus?.focus_version || '1.2',
    domains: DOMAINS.map(d => ({
      domain: d.domain,
      implemented: d.capabilities.filter(c => c.status === 'full').length,
      partial: d.capabilities.filter(c => c.status === 'partial').length,
      total: d.capabilities.length,
    })),
  }), [score, counts, maturity.label, focus])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={20} style={{ color: '#22c55e' }} /> FinOps Framework Compliance
          </h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>
            Mapped to the FinOps Foundation Framework · FOCUS 1.2 · Microsoft FinOps toolkit aligned
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{
          background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 12px',
          cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Scorecard */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
        <ScoreCard label="FinOps Maturity" value={`${score}/100`} sub={<span style={{ color: maturity.color }}>{maturity.label} stage</span>} accent={maturity.color} icon={Award} />
        <ScoreCard label="Capabilities" value={`${counts.full}/${counts.total}`} sub={`${counts.partial} partial`} icon={CheckCircle2} accent="#22c55e" />
        <ScoreCard label="FOCUS 1.2" value={focus ? 'Compliant' : '—'} sub={focus ? `${focus.record_count} records` : 'warehouse pending'} icon={Database} accent="#3b82f6" />
        <ScoreCard label="FOCUS Billed Cost" value={focus ? fmtUsd(focus.total_billed_cost) : '—'} sub="normalized dataset" icon={Database} accent="#8b5cf6" />
      </div>

      {/* AI maturity recommendations */}
      <FinOpsAIPanel view="compliance" data={aiData} title="AI FinOps Maturity Recommendations" />

      {/* Domains */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        {DOMAINS.map(d => (
          <div key={d.domain} style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
            <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{d.domain}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {d.capabilities.map(c => {
                const m = STATUS_META[c.status]
                const Icon = m.icon
                return (
                  <div key={c.name} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <Icon size={15} style={{ color: m.color, flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <div style={{ color: 'var(--c-cbd5e1)', fontSize: 12, fontWeight: 600 }}>{c.name}</div>
                      <div style={{ color: 'var(--c-64748b)', fontSize: 11 }}>{c.note}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ color: 'var(--c-475569)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
        <CircleDashed size={12} style={{ color: '#f59e0b' }} /> Partial &nbsp;·&nbsp;
        <CheckCircle2 size={12} style={{ color: '#22c55e' }} /> Implemented &nbsp;·&nbsp;
        Framework © FinOps Foundation (CC BY 4.0)
      </div>
    </div>
  )
}

function ScoreCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <div style={{ background: 'var(--c-111827)', border: `1px solid ${accent || 'var(--c-1e293b)'}55`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
        {Icon && <Icon size={15} style={{ color: accent || '#3b82f6' }} />}
      </div>
      <div style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--c-64748b)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
