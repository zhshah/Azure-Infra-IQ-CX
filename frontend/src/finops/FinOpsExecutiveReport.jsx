/**
 * FinOpsExecutiveReport — assembles a CFO-ready FinOps report from live data and
 * exports it as a branded PDF (client, react-pdf, lazy) or Excel (server report/xlsx).
 *
 * Pulls KPIs + 30-day trend + cost-by-subscription (summary), biggest movers
 * (compare), top workloads (dependency roll-up) and Advisor cost recommendations,
 * shows a preview, and can enrich the narrative with AI before exporting.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  FileText, FileSpreadsheet, Sparkles, RefreshCw, AlertCircle, DollarSign,
  TrendingUp, PiggyBank, Tag, Network, GitCompareArrows, Loader,
} from 'lucide-react'
import { finopsApi, getFilterOptions, fmtUsd, fmtPct } from './finopsApi'
import { C } from './finopsTheme'
import { rechartsTooltipProps } from './finopsTheme'

function Kpi({ label, value, sub, Icon, color = C.accent }) {
  return (
    <div style={{ flex: 1, minWidth: 170, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: C.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</span>
        {Icon && <Icon size={15} style={{ color }} />}
      </div>
      <div style={{ color: C.text, fontSize: 21, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub != null && <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function FinOpsExecutiveReport() {
  const [customer, setCustomer]   = useState('')
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [summary, setSummary]     = useState(null)
  const [movers, setMovers]       = useState([])
  const [workloads, setWorkloads] = useState([])
  const [recs, setRecs]           = useState([])
  const [aiNarrative, setAiNarrative] = useState('')
  const [aiBusy, setAiBusy]       = useState(false)
  const [pdfBusy, setPdfBusy]     = useState(false)
  const [xlsBusy, setXlsBusy]     = useState(false)
  const [exportErr, setExportErr] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [sum, cmp, wl, adv] = await Promise.all([
        finopsApi.getSummary().catch(() => null),
        finopsApi.getCompare('ResourceGroupName').catch(() => ({ rows: [] })),
        finopsApi.getWorkloads('dependency').catch(() => ({ workloads: [] })),
        finopsApi.getAdvisorCost().catch(() => ({ items: [] })),
      ])
      setSummary(sum)
      setMovers((cmp?.rows || []).slice(0, 15))
      setWorkloads((wl?.workloads || []).slice(0, 15))
      setRecs((adv?.items || []).slice(0, 20))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const trend = useMemo(() => {
    const costs = summary?.cost_trend_30d || []
    const dates = summary?.cost_trend_dates || []
    return costs.map((c, i) => ({ date: dates[i] || String(i + 1), cost: c }))
  }, [summary])

  const bySubscription = useMemo(() =>
    (summary?.by_subscription || []).map(s => ({ name: s.name || s.id || 'Subscription', cost: s.cost || 0 })),
  [summary])

  const assembleReport = useCallback(() => ({
    customer: customer || 'Azure Cost Management',
    generatedAt: new Date().toLocaleString(),
    kpis: {
      totalMtd:       summary?.total_spend_mtd || 0,
      forecastEom:    summary?.forecast_eom_usd || 0,
      momDeltaPct:    summary?.mom_delta_pct,
      savings:        summary?.savings_identified_usd || 0,
      tagCompliance:  summary?.tagging_compliance_pct || 0,
      subCount:       summary?.subscription_count || 0,
      resourceCount:  summary?.total_resource_count || 0,
      anomalyCount:   summary?.anomaly_count || 0,
    },
    trend,
    bySubscription,
    topMovers:  movers.map(m => ({ value: m.value, current: m.current, prior: m.prior, delta: m.delta_usd })),
    workloads:  workloads.map(w => ({ name: w.name, cost: w.cost, resourceCount: w.resource_count })),
    savings:    recs.map(x => ({ title: `${x.recommendation}${x.resource_name ? ` (${x.resource_name})` : ''}`, monthly: x.potential_savings_monthly })),
    recommendations: recs.map(x => ({ recommendation: x.recommendation, resource: x.resource_name, savings: x.potential_savings_monthly })),
    aiNarrative,
  }), [customer, summary, trend, bySubscription, movers, workloads, recs, aiNarrative])

  const genAi = useCallback(async () => {
    setAiBusy(true); setExportErr(null)
    try {
      const payload = {
        total_spend_mtd: summary?.total_spend_mtd, forecast_eom_usd: summary?.forecast_eom_usd,
        mom_delta_pct: summary?.mom_delta_pct, savings_identified_usd: summary?.savings_identified_usd,
        tagging_compliance_pct: summary?.tagging_compliance_pct, anomaly_count: summary?.anomaly_count,
        by_subscription: bySubscription.slice(0, 8), top_movers: movers.slice(0, 8),
        top_workloads: workloads.slice(0, 8).map(w => ({ name: w.name, cost: w.cost })),
      }
      const res = await finopsApi.aiInsights('executive-report', payload, null, false, undefined,
        'Write a concise CFO-ready executive summary of this Azure cloud spend: current run-rate, month-over-month trend, biggest cost drivers, savings opportunities, and 2-3 prioritized recommendations.')
      const txt = res?.summary || res?.analysis || res?.insights || res?.narrative || (typeof res === 'string' ? res : '')
      setAiNarrative(txt || 'AI narrative unavailable.')
    } catch (e) { setExportErr('AI narrative failed: ' + e.message) }
    finally { setAiBusy(false) }
  }, [summary, bySubscription, movers, workloads])

  const genPdf = useCallback(async () => {
    setPdfBusy(true); setExportErr(null)
    try {
      const mod = await import('../utils/finopsExecutiveReport')
      await mod.generateFinOpsExecutivePDF(assembleReport())
    } catch (e) { setExportErr('PDF export failed: ' + e.message) }
    finally { setPdfBusy(false) }
  }, [assembleReport])

  const genXls = useCallback(async () => {
    setXlsBusy(true); setExportErr(null)
    try { await finopsApi.downloadReport() }
    catch (e) { setExportErr('Excel export failed: ' + e.message) }
    finally { setXlsBusy(false) }
  }, [])

  const k = summary || {}
  const btn = (onClick, busy, Icon, label, primary) => (
    <button onClick={onClick} disabled={busy || loading} style={{
      display: 'flex', alignItems: 'center', gap: 7,
      background: primary ? C.accent : C.surface, border: `1px solid ${primary ? C.accent : C.border}`,
      borderRadius: 7, padding: '9px 16px', cursor: busy || loading ? 'wait' : 'pointer',
      color: primary ? '#fff' : C.text, fontSize: 13, fontWeight: 600,
    }}>
      {busy ? <Loader size={14} className="animate-spin" /> : <Icon size={14} />} {label}
    </button>
  )

  return (
    <div style={{ padding: 24, maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 22, fontWeight: 700, margin: 0 }}>
            <FileText size={22} style={{ color: C.accent }} /> Executive Report
          </h1>
          <p style={{ color: C.muted, fontSize: 13, margin: '6px 0 0' }}>
            A CFO-ready summary of cloud spend, trends, savings &amp; workloads — export to PDF or Excel.
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{
          display: 'flex', alignItems: 'center', gap: 6, background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 6, padding: '6px 12px', cursor: loading ? 'wait' : 'pointer', color: C.textDim, fontSize: 12, fontWeight: 600,
        }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Customer + actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Customer / organization name (optional)"
          style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: '9px 14px', color: C.text, fontSize: 13, minWidth: 300 }} />
        {btn(genAi, aiBusy, Sparkles, aiNarrative ? 'Regenerate AI summary' : 'Add AI summary')}
        {btn(genPdf, pdfBusy, FileText, 'Export PDF', true)}
        {btn(genXls, xlsBusy, FileSpreadsheet, 'Export Excel')}
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

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>
          <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 10px' }} /> Assembling report…
        </div>
      ) : (
        <>
          {/* KPI preview */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Kpi label="Spend MTD" value={fmtUsd(k.total_spend_mtd)} Icon={DollarSign} sub={`${k.subscription_count || 0} subs · ${k.total_resource_count || 0} resources`} />
            <Kpi label="Forecast EOM" value={fmtUsd(k.forecast_eom_usd)} Icon={TrendingUp} color={C.orange} sub={k.mom_delta_pct != null ? `${fmtPct(k.mom_delta_pct)} MoM` : ''} />
            <Kpi label="Savings identified" value={fmtUsd(k.savings_identified_usd)} Icon={PiggyBank} color={C.green} sub="per month" />
            <Kpi label="Tagging compliance" value={`${Number(k.tagging_compliance_pct || 0).toFixed(0)}%`} Icon={Tag} color={C.purple} sub={k.anomaly_count ? `${k.anomaly_count} anomalies` : ''} />
          </div>

          {/* Trend preview */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ color: C.textDim, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>30-day spend trend</div>
            {trend.length >= 2 ? (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="finexecg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} tickFormatter={d => String(d).slice(5)} minTickGap={24} />
                  <YAxis tick={{ fill: '#475569', fontSize: 9 }} tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
                  <Tooltip {...rechartsTooltipProps()} formatter={v => fmtUsd(v, 2)} />
                  <Area type="monotone" dataKey="cost" stroke="#3b82f6" fill="url(#finexecg)" strokeWidth={1.6} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div style={{ color: C.muted, fontSize: 12, padding: 20, textAlign: 'center' }}>Trend data unavailable — run a full dashboard scan to populate it.</div>}
          </div>

          {/* AI narrative preview */}
          {aiNarrative && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: C.purple, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                <Sparkles size={15} /> AI executive summary
              </div>
              <div style={{ color: C.textDim, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{aiNarrative}</div>
            </div>
          )}

          {/* Section preview: what the report will contain */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {[
              { Icon: GitCompareArrows, label: 'Biggest cost movers', count: movers.length, color: C.orange },
              { Icon: Network, label: 'Top workloads', count: workloads.length, color: C.accent },
              { Icon: PiggyBank, label: 'Advisor recommendations', count: recs.length, color: C.green },
              { Icon: DollarSign, label: 'Cost by subscription', count: bySubscription.length, color: C.purple },
            ].map((s, i) => (
              <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                <s.Icon size={20} style={{ color: s.color }} />
                <div>
                  <div style={{ color: C.text, fontSize: 18, fontWeight: 700 }}>{s.count}</div>
                  <div style={{ color: C.muted, fontSize: 12 }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          <p style={{ color: C.muted, fontSize: 11, marginTop: 16 }}>
            The PDF is generated in your browser (branded, multi-section). Excel uses the server FinOps report.
            All figures are live from Azure Cost Management + the resource inventory.
          </p>
        </>
      )}
    </div>
  )
}
