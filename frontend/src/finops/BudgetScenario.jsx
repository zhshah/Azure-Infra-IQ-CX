/**
 * Budget Scenario / Burndown — set a monthly budget target and see the burndown:
 * linear budget line vs real cumulative actual spend vs projected end-of-month
 * run-rate (with an optional growth assumption). Works on live MTD data.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { Wallet, RefreshCw, AlertCircle, TrendingUp, Download } from 'lucide-react'
import { finopsApi, fmtUsd } from './finopsApi'
import FinOpsScopeBar, { scopeExportRows } from './FinOpsScopeBar'

const card      = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const miniLabel = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }
const secLabel  = { color: 'var(--c-e2e8f0)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }
const inputStyle = { background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 10px', color: 'var(--c-e2e8f0)', fontSize: 13, width: 140 }
const STATUS = { over: { c: '#ef4444', l: 'Over budget' }, at_risk: { c: '#f59e0b', l: 'At risk' }, on_track: { c: '#22c55e', l: 'On track' } }
const fmtDate = d => (typeof d === 'string' ? d.slice(5) : d)

export default function BudgetScenario() {
  const [budget, setBudget]   = useState(1000)
  const [growth, setGrowth]   = useState(0)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const run = useCallback(async (b, g) => {
    setLoading(true); setError(null)
    try { setData(await finopsApi.budgetScenario({ monthly_budget: b, growth_pct: g })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { const id = setTimeout(() => run(budget, growth), 300); return () => clearTimeout(id) /* eslint-disable-next-line */ }, [budget, growth])

  const st = STATUS[data?.status] || STATUS.on_track

  const exportXlsx = () => {
    if (!data) return
    finopsApi.exportGenericXlsx({
      title: 'Budget Scenario',
      sheets: [
        { name: 'Summary', columns: ['Metric', 'Value'], rows: [
          ...scopeExportRows(data.scope),
          ['Monthly budget (USD)', budget], ['Growth assumption %', growth],
          ['Spent so far MTD (USD)', data.mtd_spend_usd], ['Burn %', data.burn_pct],
          ['Projected EOM (USD)', data.projected_eom_usd], ['Projected %', data.projected_pct],
          ['Projected variance (USD)', data.variance_usd], ['Status', st.l],
        ] },
        { name: 'Burndown', columns: ['Date', 'Budget (USD)', 'Actual (USD)', 'Forecast (USD)'],
          rows: (data.series || []).map(s => [s.date, s.budget, s.actual, s.forecast]) },
      ],
    }).catch(() => {})
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
            <Wallet size={20} style={{ color: '#22c55e' }} /> Budget Scenario &amp; Burndown
          </h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '4px 0 0' }}>
            Set a monthly target and see this month's burndown — actual so far vs the projected end-of-month run-rate.
          </p>
        </div>
        {data && (
          <button onClick={exportXlsx} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 12 }}>
            <Download size={13} /> Export
          </button>
        )}
      </div>

      {error && (
        <div style={{ ...card, borderColor: 'var(--c-7f1d1d)', color: 'var(--c-fca5a5)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ fontSize: 12 }}>{error}</span>
        </div>
      )}

      {data?.scope && (
        <FinOpsScopeBar
          scope={data.scope}
          extra={[
            { label: 'Monthly target', value: fmtUsd(budget) },
            { label: 'Growth assumption', value: `${growth > 0 ? '+' : ''}${growth}%` },
          ]} />
      )}

      <div style={{ ...card, display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={miniLabel}>Monthly budget ($)</div>
          <input type="number" min={0} step={100} value={budget} onChange={e => setBudget(Number(e.target.value))} style={inputStyle} />
        </div>
        <div style={{ minWidth: 220, flex: 1 }}>
          <div style={miniLabel}>Growth assumption — {growth > 0 ? '+' : ''}{growth}%</div>
          <input type="range" min={-25} max={50} step={5} value={growth} onChange={e => setGrowth(Number(e.target.value))} style={{ width: '100%', accentColor: '#22c55e' }} />
        </div>
        <button onClick={() => run(budget, growth)} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 12 }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
          <div style={miniLabel}>Spent so far (MTD)</div>
          <div style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700 }}>{fmtUsd(data?.mtd_spend_usd)}</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>{data?.burn_pct ?? 0}% of budget · day {data?.day_of_month}/{data?.days_in_month}</div>
        </div>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
          <div style={miniLabel}>Projected EOM</div>
          <div style={{ color: st.c, fontSize: 20, fontWeight: 700 }}>{fmtUsd(data?.projected_eom_usd)}</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>{data?.projected_pct ?? 0}% of budget</div>
        </div>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
          <div style={miniLabel}>Projected variance</div>
          <div style={{ color: (data?.variance_usd ?? 0) >= 0 ? '#22c55e' : '#ef4444', fontSize: 20, fontWeight: 700 }}>{fmtUsd(data?.variance_usd)}</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>{(data?.variance_usd ?? 0) >= 0 ? 'under' : 'over'} budget</div>
        </div>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
          <div style={miniLabel}>Status</div>
          <div style={{ color: st.c, fontSize: 20, fontWeight: 700 }}>{st.l}</div>
        </div>
      </div>

      {/* Burndown */}
      <div style={card}>
        <div style={secLabel}><TrendingUp size={16} style={{ color: '#22c55e' }} /> Month-to-date burndown</div>
        {data?.series?.length ? (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={data.series} margin={{ top: 14, right: 20, left: 6, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--c-1e293b)" />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'var(--c-64748b)' }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--c-64748b)' }} tickFormatter={v => fmtUsd(v)} />
              <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }}
                       formatter={(v, n) => [v == null ? '—' : fmtUsd(v), n === 'budget' ? 'Budget' : n === 'actual' ? 'Actual' : 'Projected']} />
              <Legend formatter={v => (v === 'budget' ? 'Budget' : v === 'actual' ? 'Actual' : 'Projected')} />
              <ReferenceLine y={data.monthly_budget_usd} stroke="#64748b" strokeDasharray="5 4" />
              <Line type="monotone" dataKey="budget" stroke="#64748b" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
              <Area type="monotone" dataKey="actual" stroke="#3b82f6" strokeWidth={2} fill="#3b82f6" fillOpacity={0.12} connectNulls />
              <Line type="monotone" dataKey="forecast" stroke="#22c55e" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-64748b)', fontSize: 12 }}>{loading ? 'Loading…' : 'No current-month spend data yet.'}</div>
        )}
      </div>
    </div>
  )
}
