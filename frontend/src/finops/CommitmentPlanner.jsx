/**
 * Commitment (Reservation / Savings Plan) What-if Planner.
 * Simulate covering X% of eligible on-demand compute & DB spend for 1 or 3 years
 * and see projected savings, committed run-rate and the savings curve.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { PiggyBank, RefreshCw, AlertCircle, TrendingDown, Percent } from 'lucide-react'
import { finopsApi, fmtUsd } from './finopsApi'

const card      = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const miniLabel = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }
const secLabel  = { color: 'var(--c-e2e8f0)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }

export default function CommitmentPlanner() {
  const [term, setTerm]         = useState('3yr')
  const [coverage, setCoverage] = useState(75)
  const [payment, setPayment]   = useState('no_upfront')
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const run = useCallback(async (t, cov, pay) => {
    setLoading(true); setError(null)
    try { setData(await finopsApi.simulateCommitment({ term: t, coverage_target_pct: cov, payment: pay })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { run(term, coverage, payment) /* eslint-disable-next-line */ }, [term, payment])
  // Debounce coverage slider.
  useEffect(() => { const id = setTimeout(() => run(term, coverage, payment), 250); return () => clearTimeout(id) /* eslint-disable-next-line */ }, [coverage])

  const sel = data?.selected || {}
  const curve = data?.savings_curve || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
          <PiggyBank size={20} style={{ color: '#06b6d4' }} /> Commitment Planner
        </h2>
        <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '4px 0 0' }}>
          Model reservation / savings-plan coverage over your real eligible on-demand spend and see the savings.
        </p>
      </div>

      {error && (
        <div style={{ ...card, borderColor: 'var(--c-7f1d1d)', color: 'var(--c-fca5a5)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ fontSize: 12 }}>{error}</span>
        </div>
      )}

      {/* Controls */}
      <div style={{ ...card, display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={miniLabel}>Term</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ v: '1yr', l: '1 year' }, { v: '3yr', l: '3 years' }].map(o => (
              <button key={o.v} onClick={() => setTerm(o.v)} style={{ borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: term === o.v ? '#06b6d4' : 'var(--c-0b1220)', border: `1px solid ${term === o.v ? '#06b6d4' : 'var(--c-334155)'}`, color: term === o.v ? '#012' : 'var(--c-94a3b8)' }}>{o.l}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={miniLabel}>Payment</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ v: 'no_upfront', l: 'No upfront' }, { v: 'partial_upfront', l: 'Partial' }, { v: 'all_upfront', l: 'All upfront' }].map(o => (
              <button key={o.v} onClick={() => setPayment(o.v)} style={{ borderRadius: 6, padding: '6px 11px', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: payment === o.v ? '#4f46e5' : 'var(--c-0b1220)', border: `1px solid ${payment === o.v ? '#4f46e5' : 'var(--c-334155)'}`, color: payment === o.v ? '#fff' : 'var(--c-94a3b8)' }}>{o.l}</button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={miniLabel}>Coverage target — {coverage}%</div>
          <input type="range" min={0} max={100} step={5} value={coverage} onChange={e => setCoverage(Number(e.target.value))} style={{ width: '100%', accentColor: '#06b6d4' }} />
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
          <div style={miniLabel}>Eligible on-demand</div>
          <div style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700 }}>{fmtUsd(data?.eligible_monthly_spend_usd)}/mo</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>compute &amp; databases</div>
        </div>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
          <div style={miniLabel}>Est. monthly savings</div>
          <div style={{ color: '#22c55e', fontSize: 20, fontWeight: 700 }}>{fmtUsd(sel.monthly_savings_usd)}</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>{sel.discount_pct}% discount</div>
        </div>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
          <div style={miniLabel}>Term savings</div>
          <div style={{ color: '#22c55e', fontSize: 20, fontWeight: 700 }}>{fmtUsd(sel.term_savings_usd)}</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>over {term === '3yr' ? '3 years' : '1 year'}</div>
        </div>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
          <div style={miniLabel}>New monthly run-rate</div>
          <div style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700 }}>{fmtUsd(sel.new_monthly_run_rate_usd)}</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>committed + uncovered</div>
        </div>
      </div>

      {/* Savings curve */}
      <div style={card}>
        <div style={secLabel}><TrendingDown size={16} style={{ color: '#06b6d4' }} /> Monthly savings vs coverage</div>
        {loading && !curve.length ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-64748b)' }}><RefreshCw size={16} className="animate-spin" /> Loading…</div>
        ) : curve.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={curve} margin={{ top: 14, right: 20, left: 6, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--c-1e293b)" />
              <XAxis dataKey="coverage_pct" tick={{ fontSize: 11, fill: 'var(--c-64748b)' }} tickFormatter={v => `${v}%`} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--c-64748b)' }} tickFormatter={v => fmtUsd(v)} />
              <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }} formatter={(v, n) => [fmtUsd(v), n === 'savings_1yr' ? '1-year' : '3-year']} labelFormatter={l => `${l}% coverage`} />
              <Legend formatter={v => (v === 'savings_1yr' ? '1-year' : '3-year')} />
              <ReferenceLine x={coverage} stroke="#06b6d4" strokeDasharray="4 3" />
              <Line type="monotone" dataKey="savings_1yr" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="savings_3yr" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-64748b)', fontSize: 12 }}>No eligible on-demand compute detected in scope.</div>
        )}
        {data?.assumptions?.note && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--c-475569)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <Percent size={12} style={{ marginTop: 2, flexShrink: 0 }} /> {data.assumptions.note}
          </div>
        )}
      </div>
    </div>
  )
}
