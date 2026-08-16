/**
 * Savings Ledger — recommendation lifecycle and realized-savings tracking.
 *
 * Recommendations are recomputed on every scan, so without persistence there is
 * no way to answer "what did we actually save?". This view gives each finding a
 * durable identity and an accept -> implement workflow. Accepting snapshots the
 * resource's trailing 30-day cost as the baseline; the ETL later measures the
 * resource's real cost and records the difference as realized savings.
 */
import React, { useState, useEffect } from 'react'
import { RefreshCw, AlertCircle, CheckCircle2, XCircle, PlayCircle, RotateCw } from 'lucide-react'
import { fmtUsd } from './finopsApi'

const STATUS_META = {
  open:        { label: 'Open',        color: '#3b82f6' },
  accepted:    { label: 'Accepted',    color: '#8b5cf6' },
  implemented: { label: 'Implemented', color: '#22c55e' },
  dismissed:   { label: 'Dismissed',   color: '#64748b' },
}

const card = {
  background: 'var(--c-0f172a, #0f172a)',
  border: '1px solid var(--c-1e293b, #1e293b)',
  borderRadius: 10,
  padding: 16,
}

const btn = (bg, fg, border) => ({
  background: bg, color: fg, border: `1px solid ${border}`,
  borderRadius: 6, padding: '4px 9px', fontSize: 11, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 4,
})

export default function SavingsLedger() {
  const [recos, setRecos] = useState([])
  const [rollup, setRollup] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('open')

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const q = filter === 'all' ? '' : `?status=${filter}`
      const [r1, r2] = await Promise.all([
        fetch(`/api/finops/mgmt/recommendations${q}`).then(r => r.json()),
        fetch('/api/finops/mgmt/savings').then(r => r.json()),
      ])
      setRecos(r1.recommendations || [])
      setRollup(r2)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [filter])

  const sync = async () => {
    setBusy('sync')
    try {
      await fetch('/api/finops/mgmt/recommendations/sync', { method: 'POST' })
      await load()
    } catch (e) { setError(e.message) }
    finally { setBusy(null) }
  }

  const measure = async () => {
    setBusy('measure')
    try {
      await fetch('/api/finops/mgmt/savings/measure', { method: 'POST' })
      await load()
    } catch (e) { setError(e.message) }
    finally { setBusy(null) }
  }

  const setStatus = async (fp, status) => {
    setBusy(fp)
    try {
      const r = await fetch(
        `/api/finops/mgmt/recommendations/${fp}/status?status=${status}&changed_by=portal`,
        { method: 'POST' })
      if (!r.ok) throw new Error(`Update failed (${r.status})`)
      await load()
    } catch (e) { setError(e.message) }
    finally { setBusy(null) }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, gap: 10 }}>
      <RefreshCw size={18} className="animate-spin" style={{ color: '#3b82f6' }} />
      <span style={{ color: 'var(--c-94a3b8, #94a3b8)' }}>Loading savings ledger…</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div style={{ background: '#1a0e0e', border: '1px solid #7f1d1d', borderRadius: 10, padding: 12, color: '#fca5a5', display: 'flex', gap: 8, fontSize: 12 }}>
          <AlertCircle size={15} /><span>{error}</span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9, #f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Savings Ledger</h2>
          <div style={{ fontSize: 12, color: 'var(--c-64748b, #64748b)', marginTop: 3 }}>
            Track recommendations from identified through implemented, and measure what was actually saved
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="accepted">Accepted</option>
            <option value="implemented">Implemented</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <button onClick={sync} disabled={busy === 'sync'} style={btn('#1e293b', '#f1f5f9', '#334155')}>
            <RotateCw size={12} /> {busy === 'sync' ? 'Syncing…' : 'Sync from scan'}
          </button>
          <button onClick={measure} disabled={busy === 'measure'} style={btn('#052e16', '#86efac', '#166534')}>
            <PlayCircle size={12} /> {busy === 'measure' ? 'Measuring…' : 'Measure realized'}
          </button>
        </div>
      </div>

      {rollup && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            ['Identified / mo', fmtUsd(rollup.identified_monthly_usd), null],
            ['Potential (open)', fmtUsd(rollup.potential_monthly_usd), '#3b82f6'],
            ['Accepted', fmtUsd(rollup.accepted_monthly_usd), '#8b5cf6'],
            ['Realized / mo', fmtUsd(rollup.realized_monthly_usd), '#22c55e'],
            ['ROI', rollup.roi_available ? `${rollup.roi_pct}%` : 'Not measured', rollup.roi_available ? '#22c55e' : '#64748b'],
            ['Capture rate', `${rollup.capture_rate_pct || 0}%`, null],
          ].map(([label, value, color]) => (
            <div key={label} style={{ ...card, flex: '1 1 150px', minWidth: 140 }}>
              <div style={{ fontSize: 11, color: 'var(--c-94a3b8, #94a3b8)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--c-f1f5f9, #f1f5f9)', marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...card }}>
        {recos.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-64748b, #64748b)', fontSize: 12 }}>
            No recommendations in this state. Use <strong>Sync from scan</strong> to persist the
            recommendations detected by the latest scan.
          </div>
        ) : (
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                <tr style={{ color: 'var(--c-94a3b8, #94a3b8)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Resource</th>
                  <th style={{ padding: '6px 8px' }}>Category</th>
                  <th style={{ padding: '6px 8px' }}>Recommendation</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Savings / mo</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Baseline</th>
                  <th style={{ padding: '6px 8px' }}>Status</th>
                  <th style={{ padding: '6px 8px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recos.map(r => {
                  const meta = STATUS_META[r.status] || STATUS_META.open
                  return (
                    <tr key={r.fingerprint} style={{ borderTop: '1px solid var(--c-1e293b, #1e293b)' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0, #e2e8f0)' }}>
                        {r.resource_name}
                        <div style={{ fontSize: 10, color: 'var(--c-64748b, #64748b)' }}>{r.resource_group}</div>
                      </td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8, #94a3b8)' }}>{r.category}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8, #94a3b8)', maxWidth: 260 }}>
                        {r.title}
                        {r.target_sku && <div style={{ fontSize: 10, color: '#64748b' }}>{r.current_sku} → {r.target_sku}</div>}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: '#22c55e' }}>{fmtUsd(r.monthly_savings_usd)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-94a3b8, #94a3b8)' }}>
                        {r.baseline_cost_usd > 0 ? fmtUsd(r.baseline_cost_usd) : '—'}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {r.status === 'open' && (
                            <button onClick={() => setStatus(r.fingerprint, 'accepted')} disabled={busy === r.fingerprint}
                              style={btn('#1e1b4b', '#c4b5fd', '#4c1d95')}>Accept</button>
                          )}
                          {(r.status === 'open' || r.status === 'accepted') && (
                            <button onClick={() => setStatus(r.fingerprint, 'implemented')} disabled={busy === r.fingerprint}
                              style={btn('#052e16', '#86efac', '#166534')}>
                              <CheckCircle2 size={11} /> Implemented
                            </button>
                          )}
                          {r.status !== 'dismissed' && (
                            <button onClick={() => setStatus(r.fingerprint, 'dismissed')} disabled={busy === r.fingerprint}
                              style={btn('#1e293b', '#94a3b8', '#334155')}>
                              <XCircle size={11} /> Dismiss
                            </button>
                          )}
                          {r.status === 'dismissed' && (
                            <button onClick={() => setStatus(r.fingerprint, 'open')} disabled={busy === r.fingerprint}
                              style={btn('#1e293b', '#94a3b8', '#334155')}>Reopen</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
