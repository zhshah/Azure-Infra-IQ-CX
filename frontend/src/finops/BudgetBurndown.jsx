/**
 * Budget burn-down.
 *
 * Budgets, amounts and alert thresholds come from Azure (Consumption budgets API) and
 * actuals from the cost warehouse — nothing here is modelled. The straight line is the
 * pace Azure's own percentage thresholds imply; the dashed line is where today's
 * run-rate lands by period end.
 */
import React, { useState, useEffect } from 'react'
import {
  AreaChart, Area, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { RefreshCw, AlertCircle, TrendingUp, Wallet } from 'lucide-react'
import { fmtUsd } from './finopsApi'

const card = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }

export default function BudgetBurndown() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/finops/budgets/burndown')
      .then(r => r.json()).then(d => { setData(d); setError(null) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 30, color: 'var(--c-94a3b8)', fontSize: 12 }}>
      <RefreshCw size={16} className="animate-spin" style={{ color: '#3b82f6' }} /> Loading budget burn-down…
    </div>
  )
  if (error) return (
    <div style={{ ...card, color: 'var(--c-fca5a5)', fontSize: 12, display: 'flex', gap: 8 }}>
      <AlertCircle size={15} /><span>{error}</span>
    </div>
  )
  if (!data?.available) return (
    <div style={{ ...card, fontSize: 12, color: 'var(--c-64748b)' }}>
      No Azure budgets found. Budgets are read from Azure Cost Management — create one in the
      portal, or run a collection to sync.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Budget burn-down</h2>
        <div style={{ fontSize: 12, color: 'var(--c-64748b)', marginTop: 3 }}>
          {data.count} Azure budget{data.count === 1 ? '' : 's'} · {data.over_forecast} forecast to exceed.
          Amounts and thresholds come from Azure; actuals from the cost warehouse.
        </div>
      </div>

      {data.budgets.map(b => <BudgetCard key={`${b.name}-${b.subscription_id}`} b={b} />)}
    </div>
  )
}

function BudgetCard({ b }) {
  const over = b.forecast === 'over'
  const accent = over ? '#ef4444' : '#22c55e'
  // Only thresholds inside the plotted range are worth drawing; a 200% line flattens
  // the series against the top of the chart.
  const maxY = Math.max(b.amount_usd, b.projected_total_usd, b.spent_usd) * 1.08
  const lines = (b.thresholds || []).filter(t => t.amount_usd <= maxY)

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <Wallet size={15} style={{ color: '#0078d4' }} />
        <span style={{ color: 'var(--c-f1f5f9)', fontSize: 14, fontWeight: 700 }}>{b.name}</span>
        <span style={{ fontSize: 10.5, color: 'var(--c-64748b)' }}>
          {b.period} · {b.period_start} → {b.period_end}
          {b.subscription_id ? ` · sub ${String(b.subscription_id).slice(0, 8)}` : ''}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: accent,
                       border: `1px solid ${accent}55`, borderRadius: 999, padding: '2px 10px' }}>
          {over ? `Forecast over by ${fmtUsd(b.projected_variance_usd)}` : `Forecast under by ${fmtUsd(Math.abs(b.projected_variance_usd))}`}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stat label="Budget" value={fmtUsd(b.amount_usd)} />
        <Stat label="Spent" value={fmtUsd(b.spent_usd)} sub={`${b.spent_pct}% · day ${b.days_elapsed}/${b.days_total}`} />
        <Stat label="Run rate" value={`${fmtUsd(b.run_rate_usd_per_day, 2)}/day`} icon={TrendingUp} />
        <Stat label="Projected" value={fmtUsd(b.projected_total_usd)} sub={`${b.projected_pct_of_budget}% of budget`} color={accent} />
        <Stat label="Budget exhausted" value={b.exhaustion_date || '—'}
              sub={b.exhaustion_date ? 'at current rate' : 'not within this period'}
              color={b.exhaustion_date ? '#ef4444' : undefined} />
      </div>

      {!b.has_actuals && (
        <div style={{ fontSize: 11, color: 'var(--c-fbbf24)', marginBottom: 8 }}>
          No daily cost rows for this scope yet — the curve will fill once collection runs.
        </div>
      )}

      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart data={b.series} margin={{ top: 8, right: 20, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={Math.ceil(b.series.length / 10)} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtUsd(v, 0)} domain={[0, maxY]} />
          <Tooltip formatter={(v, n) => [fmtUsd(v, 2), n === 'actual_cumulative' ? 'Actual'
                                        : n === 'budget_pace' ? 'Budget pace' : 'Projected']}
                   contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 8, fontSize: 12 }} />
          {lines.map(t => (
            <ReferenceLine key={t.threshold_pct} y={t.amount_usd}
                           stroke={t.status === 'breached' ? '#ef4444' : t.status === 'projected' ? '#f59e0b' : '#475569'}
                           strokeDasharray="3 3"
                           label={{ value: `${t.threshold_pct}%`, position: 'right', fontSize: 9,
                                    fill: t.status === 'breached' ? '#ef4444' : '#64748b' }} />
          ))}
          <Area type="monotone" dataKey="actual_cumulative" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.18}
                strokeWidth={2} isAnimationActive={false} connectNulls={false} />
          <Line type="monotone" dataKey="projected_cumulative" stroke={accent} strokeWidth={1.8}
                strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="budget_pace" stroke="#64748b" strokeWidth={1.2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--c-64748b)', marginTop: 6 }}>
        <Legend c="#38bdf8" t="Actual (cumulative)" />
        <Legend c={accent} t="Projected at current run rate" dash />
        <Legend c="#64748b" t="Even budget pace" />
      </div>

      <div style={{ marginTop: 10, borderTop: '1px solid var(--c-1e293b)', paddingTop: 8 }}>
        <div style={{ fontSize: 10.5, color: 'var(--c-64748b)', marginBottom: 5 }}>
          Azure alert thresholds on this budget
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(b.thresholds || []).map(t => {
            const col = t.status === 'breached' ? '#ef4444' : t.status === 'projected' ? '#f59e0b' : '#22c55e'
            return (
              <span key={t.threshold_pct} style={{ fontSize: 10.5, border: `1px solid ${col}55`, color: col,
                                                   borderRadius: 6, padding: '3px 9px' }}>
                {t.threshold_pct}% · {fmtUsd(t.amount_usd)} ·{' '}
                {t.status === 'breached' ? `breached ${t.breached_on}`
                  : t.status === 'projected' ? `projected ${t.projected_breach}` : 'clear'}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, color, icon: Icon }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 140, background: 'var(--c-0f172a)',
                  border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: '9px 11px' }}>
      <div style={{ fontSize: 9.5, color: 'var(--c-64748b)', textTransform: 'uppercase', letterSpacing: 0.4,
                    display: 'flex', alignItems: 'center', gap: 4 }}>
        {Icon && <Icon size={11} />}{label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || 'var(--c-f1f5f9)', marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--c-64748b)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

function Legend({ c, t, dash }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 14, height: 0, borderTop: `2px ${dash ? 'dashed' : 'solid'} ${c}` }} />{t}
    </span>
  )
}
