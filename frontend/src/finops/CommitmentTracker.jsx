/**
 * Commitment Tracker — RI orders, utilization, expiry warnings, buy recommendations
 * Data from Azure ReservationManagementClient + ConsumptionManagementClient (Azure native)
 */
import React, { useState, useEffect, useMemo } from 'react'
import { RefreshCw, AlertCircle, AlertTriangle } from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'

function UtilGauge({ pct, label }) {
  const color = pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ position: 'relative', width: 64, height: 64 }}>
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" style={{ stroke: 'var(--c-1e293b)' }} strokeWidth="6" />
          <circle cx="32" cy="32" r="26" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${2 * Math.PI * 26 * pct / 100} ${2 * Math.PI * 26}`}
            strokeLinecap="round"
            transform="rotate(-90 32 32)" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color }}>
          {Math.round(pct)}%
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--c-64748b)', textAlign: 'center' }}>{label}</div>
    </div>
  )
}

export default function CommitmentTracker() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [tab,     setTab]     = useState('reservations')   // 'reservations' | 'recommendations'
  const [resPage,  setResPage]  = useState(0)
  const [recPage,  setRecPage]  = useState(0)
  const RES_PAGE = 20
  const REC_PAGE = 10

  const load = async () => {
    setLoading(true); setError(null)
    try { setData(await finopsApi.getCommitments()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const reservations    = data?.reservations || []
  const recommendations = data?.savings_plan_options || []

  // Memoize expiry computation — avoids recalculating dates on every render
  // NOTE: hooks must be before early returns — data/reservations will be empty arrays until loaded
  const reservationsWithExpiry = useMemo(() => (
    reservations.map(r => {
      const expDate = r.expiry_date ? r.expiry_date.slice(0, 10) : null
      const expMs   = expDate ? Date.parse(expDate + 'T00:00:00Z') : null
      const expDays = expMs != null ? Math.ceil((expMs - Date.now()) / (1000 * 60 * 60 * 24)) : null
      return { ...r, _expDate: expDate, _expMs: expMs, _expDays: expDays }
    })
  ), [reservations])

  const expiringSoon = useMemo(() => (
    reservationsWithExpiry.filter(r => r._expDays != null && r._expDays < 90 && r._expDays > 0)
  ), [reservationsWithExpiry])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 10 }}>
      <RefreshCw size={18} className="animate-spin" style={{ color: '#3b82f6' }} /><span style={{ color: 'var(--c-94a3b8)' }}>Loading commitment data…</span>
    </div>
  )
  if (error) return (
    <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 10, padding: 16, color: 'var(--c-fca5a5)', display: 'flex', gap: 8 }}>
      <AlertCircle size={16} /><span style={{ fontSize: 12 }}>{error}</span>
    </div>
  )
  if (!data) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <FinOpsExportMenu view="commitments" focusDays={30} onXlsx={() => finopsApi.downloadReport()} report={{ title: 'Commitments & Reservations', kpis: [{ label: 'Utilization', value: fmtPct(data.utilization_pct) }, { label: 'Coverage', value: fmtPct(data.coverage_pct) }, { label: 'Monthly Savings', value: fmtUsd(data.monthly_savings_usd) }] }} />
      </div>
      <FinOpsAIPanel view="commitments" data={{ utilization_pct: data.utilization_pct, coverage_pct: data.coverage_pct, monthly_savings_usd: data.monthly_savings_usd, reservation_count: (data.reservations || []).length, recommendations: (data.recommendations || data.savings_plan_options || []).slice(0, 6) }} />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Commitments & RI</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>Live from Azure ReservationManagementClient — same as Azure Portal Reservations blade</p>
        </div>
        <button onClick={load} style={{
          background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6,
          padding: '5px 10px', cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 11,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'start' }}>
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <UtilGauge pct={data.utilization_pct ?? 0} label="RI Utilization" />
        </div>
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <UtilGauge pct={data.coverage_pct ?? 0} label="RI Coverage" />
        </div>
        {[
          { label: 'Reservations', value: reservations.length, color: '#3b82f6' },
          { label: 'Expiring < 90d', value: expiringSoon.length, color: expiringSoon.length > 0 ? '#f59e0b' : '#22c55e' },
          { label: 'Monthly Savings', value: fmtUsd(data.monthly_savings_usd ?? 0), color: '#22c55e' },
          { label: 'Buy Recommendations', value: recommendations.length, color: '#8b5cf6' },
        ].map(c => (
          <div key={c.label} style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 14 }}>
            <div style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{c.label}</div>
            <div style={{ color: c.color, fontSize: 20, fontWeight: 700 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Expiry warning */}
      {expiringSoon.length > 0 && (
        <div style={{ background: 'var(--c-1c1003)', border: '1px solid #854d0e', borderRadius: 8, padding: 12, display: 'flex', gap: 8, color: 'var(--c-fbbf24)', fontSize: 12 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{expiringSoon.length} reservation(s) expire within 90 days: {expiringSoon.map(r => r.display_name || r.reservation_id).join(', ')}</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: 4, width: 'fit-content' }}>
        {[{ key: 'reservations', label: `Reservations (${reservations.length})` }, { key: 'recommendations', label: `Buy Recs (${recommendations.length})` }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: tab === t.key ? 'var(--c-1e293b)' : 'none', border: `1px solid ${tab === t.key ? 'var(--c-334155)' : 'transparent'}`,
            borderRadius: 6, padding: '5px 12px', cursor: 'pointer', color: tab === t.key ? 'var(--c-e2e8f0)' : 'var(--c-475569)', fontSize: 12,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Reservations table */}
      {tab === 'reservations' && (
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          {reservations.length === 0 ? (
            <div style={{ color: 'var(--c-334155)', fontSize: 12, textAlign: 'center', padding: 30 }}>No reservations found. This may require Reservation Reader role.</div>
          ) : (
            <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>{['Name', 'Type', 'Qty', 'State', 'Utilization', 'Expires', 'Monthly Savings'].map(h => (
                  <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {reservationsWithExpiry.slice(resPage * RES_PAGE, (resPage + 1) * RES_PAGE).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--c-0f172a)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)' }}>{r.display_name || (r.reservation_id?.slice(0, 16) + '…')}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)' }}>{r.resource_type}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)' }}>{r.quantity}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ color: r.state === 'Succeeded' ? '#4ade80' : '#f59e0b', fontSize: 10 }}>{r.state}</span>
                    </td>
                    <td style={{ padding: '6px 8px', color: (r.avg_utilization_pct ?? 100) < 60 ? '#f87171' : '#4ade80' }}>
                      {r.avg_utilization_pct != null ? fmtPct(r.avg_utilization_pct) : '—'}
                    </td>
                    <td style={{ padding: '6px 8px', color: r._expDays != null && r._expDays < 90 ? '#fbbf24' : 'var(--c-475569)', fontSize: 11 }}>
                      {r.expiry_date ? `${r.expiry_date}${r._expDays != null ? ` (${r._expDays}d)` : ''}` : '—'}
                    </td>
                    <td style={{ padding: '6px 8px', color: '#22c55e', fontWeight: 600 }}>{fmtUsd(r.monthly_savings_usd ?? 0, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reservationsWithExpiry.length > RES_PAGE && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 11, color: 'var(--c-64748b)' }}>
                <span>Showing {resPage * RES_PAGE + 1}–{Math.min((resPage + 1) * RES_PAGE, reservationsWithExpiry.length)} of {reservationsWithExpiry.length}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setResPage(p => Math.max(0, p - 1))} disabled={resPage === 0}
                    style={{ background: 'var(--c-1e293b)', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: resPage === 0 ? 'default' : 'pointer', color: resPage === 0 ? 'var(--c-334155)' : 'var(--c-94a3b8)', fontSize: 11 }}>← Prev</button>
                  <button onClick={() => setResPage(p => Math.min(Math.ceil(reservationsWithExpiry.length / RES_PAGE) - 1, p + 1))} disabled={(resPage + 1) * RES_PAGE >= reservationsWithExpiry.length}
                    style={{ background: 'var(--c-1e293b)', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: (resPage + 1) * RES_PAGE >= reservationsWithExpiry.length ? 'default' : 'pointer', color: (resPage + 1) * RES_PAGE >= reservationsWithExpiry.length ? 'var(--c-334155)' : 'var(--c-94a3b8)', fontSize: 11 }}>Next →</button>
                </div>
              </div>
            )}
            </>
          )}
        </div>
      )}

      {/* Buy recommendations */}
      {tab === 'recommendations' && (
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          {recommendations.length === 0 ? (
            <div style={{ color: 'var(--c-334155)', fontSize: 12, textAlign: 'center', padding: 30 }}>No RI recommendations from Azure. This may require Billing Reader or Consumption access.</div>
          ) : (
            <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>{['Resource Type', 'Region', 'Term', 'Qty', 'Monthly Savings', 'Savings %', 'Confidence', 'Break-even'].map(h => (
                  <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {recommendations.slice(recPage * REC_PAGE, (recPage + 1) * REC_PAGE).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--c-0f172a)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)' }}>{r.resource_type}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)' }}>{r.region}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)' }}>{r.term_label}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)' }}>{r.recommended_quantity}</td>
                    <td style={{ padding: '6px 8px', color: '#22c55e', fontWeight: 600 }}>{fmtUsd(r.monthly_savings, 2)}</td>
                    <td style={{ padding: '6px 8px', color: '#22c55e' }}>{fmtPct(r.savings_pct)}</td>
                    <td style={{ padding: '6px 8px', color: r.azure_confidence === 'High' ? '#4ade80' : '#f59e0b', fontSize: 10 }}>{r.azure_confidence}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-475569)' }}>{r.break_even_months ? `${r.break_even_months}mo` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recommendations.length > REC_PAGE && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 11, color: 'var(--c-64748b)' }}>
                <span>Showing {recPage * REC_PAGE + 1}–{Math.min((recPage + 1) * REC_PAGE, recommendations.length)} of {recommendations.length}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setRecPage(p => Math.max(0, p - 1))} disabled={recPage === 0}
                    style={{ background: 'var(--c-1e293b)', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: recPage === 0 ? 'default' : 'pointer', color: recPage === 0 ? 'var(--c-334155)' : 'var(--c-94a3b8)', fontSize: 11 }}>← Prev</button>
                  <button onClick={() => setRecPage(p => Math.min(Math.ceil(recommendations.length / REC_PAGE) - 1, p + 1))} disabled={(recPage + 1) * REC_PAGE >= recommendations.length}
                    style={{ background: 'var(--c-1e293b)', border: 'none', borderRadius: 5, padding: '4px 10px', cursor: (recPage + 1) * REC_PAGE >= recommendations.length ? 'default' : 'pointer', color: (recPage + 1) * REC_PAGE >= recommendations.length ? 'var(--c-334155)' : 'var(--c-94a3b8)', fontSize: 11 }}>Next →</button>
                </div>
              </div>
            )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
