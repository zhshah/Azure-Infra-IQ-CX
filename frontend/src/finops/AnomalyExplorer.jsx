/**
 * Anomaly explorer.
 *
 * The detector already found spikes; what was missing was any way to steer it. Filters
 * narrow by subscription, resource group, type, severity, date and name, the chart
 * redraws for whichever anomaly is selected, and the AI explanation is grounded on that
 * one resource's daily series rather than the estate at large.
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts'
import { RefreshCw, AlertCircle, Filter, Sparkles, X } from 'lucide-react'
import { fmtUsd } from './finopsApi'

const card = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const sel = {
  background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6,
  padding: '5px 9px', color: 'var(--c-e2e8f0)', fontSize: 12,
}
const SEV = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' }

export default function AnomalyExplorer() {
  const [facets, setFacets] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sel_, setSel] = useState(null)          // selected anomaly detail
  const [ai, setAi] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [f, setF] = useState({
    subscription_id: '', resource_group: '', resource_type: '',
    severity: '', date_from: '', date_to: '', search: '',
  })

  useEffect(() => {
    fetch('/api/finops/warehouse/anomalies/facets')
      .then(r => r.json()).then(setFacets).catch(() => {})
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    const q = new URLSearchParams()
    Object.entries(f).forEach(([k, v]) => { if (v) q.set(k, v) })
    q.set('limit', '100')
    fetch(`/api/finops/warehouse/anomalies?${q}`)
      .then(r => r.json())
      .then(d => { setRows(Array.isArray(d) ? d : []); setError(null) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [f])
  useEffect(() => load(), [load])

  const open = (a) => {
    setAi(null)
    setSel({ loading: true, anomaly: a })
    fetch(`/api/finops/warehouse/anomalies/${encodeURIComponent(a.anomaly_id)}`)
      .then(r => r.json()).then(d => setSel(d)).catch(e => setSel({ available: false, reason: e.message }))
  }

  const analyze = () => {
    if (!sel_?.anomaly) return
    setAiBusy(true); setAi(null)
    fetch(`/api/finops/warehouse/anomalies/${encodeURIComponent(sel_.anomaly.anomaly_id)}/analyze`, { method: 'POST' })
      .then(r => r.json()).then(setAi)
      .catch(e => setAi({ available: false, reason: e.message }))
      .finally(() => setAiBusy(false))
  }

  const active = Object.values(f).filter(Boolean).length
  const opt = (list, label) => [
    <option key="" value="">{label} (all)</option>,
    ...(list || []).map(o => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Anomaly explorer</h2>
        <div style={{ fontSize: 12, color: 'var(--c-64748b)', marginTop: 3 }}>
          Narrow to what you care about, then open a spike to see its daily shape and why it happened.
        </div>
      </div>

      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={15} style={{ color: '#0078d4' }} />
        <select style={sel} value={f.subscription_id} onChange={e => setF({ ...f, subscription_id: e.target.value })}>
          {opt(facets?.subscriptions, 'Subscription')}
        </select>
        <select style={sel} value={f.resource_group} onChange={e => setF({ ...f, resource_group: e.target.value })}>
          {opt(facets?.resource_groups, 'Resource group')}
        </select>
        <select style={sel} value={f.resource_type} onChange={e => setF({ ...f, resource_type: e.target.value })}>
          {opt(facets?.resource_types, 'Type')}
        </select>
        <select style={sel} value={f.severity} onChange={e => setF({ ...f, severity: e.target.value })}>
          {opt(facets?.severities, 'Severity')}
        </select>
        <input type="date" style={sel} value={f.date_from} min={facets?.date_min} max={facets?.date_max}
               onChange={e => setF({ ...f, date_from: e.target.value })} />
        <input type="date" style={sel} value={f.date_to} min={facets?.date_min} max={facets?.date_max}
               onChange={e => setF({ ...f, date_to: e.target.value })} />
        <input placeholder="resource name…" style={{ ...sel, minWidth: 150 }} value={f.search}
               onChange={e => setF({ ...f, search: e.target.value })} />
        {active > 0 && (
          <button onClick={() => setF({ subscription_id: '', resource_group: '', resource_type: '', severity: '', date_from: '', date_to: '', search: '' })}
                  style={{ ...sel, cursor: 'pointer', color: 'var(--c-94a3b8)' }}>
            Clear {active}
          </button>
        )}
        {loading && <RefreshCw size={13} className="animate-spin" style={{ color: '#3b82f6' }} />}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-64748b)' }}>
          {rows.length} of {facets?.total ?? '—'} anomalies
        </span>
      </div>

      {error && (
        <div style={{ ...card, color: 'var(--c-fca5a5)', fontSize: 12, display: 'flex', gap: 8 }}>
          <AlertCircle size={15} /><span>{error}</span>
        </div>
      )}

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: 'var(--c-64748b)', textAlign: 'left', background: 'var(--c-0f172a)' }}>
              {['Resource', 'Resource group', 'Detected', 'Baseline', 'On the day', 'Spike', 'Severity'].map(h => (
                <th key={h} style={{ padding: '8px 10px', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.anomaly_id} onClick={() => open(a)}
                  style={{ borderTop: '1px solid var(--c-1e293b)', cursor: 'pointer',
                           background: sel_?.anomaly?.anomaly_id === a.anomaly_id ? 'rgba(var(--rgb-slate), .30)' : 'transparent' }}>
                <td style={{ padding: '8px 10px', color: 'var(--c-e2e8f0)' }}>{a.resource_name}</td>
                <td style={{ padding: '8px 10px', color: 'var(--c-94a3b8)' }}>{a.resource_group}</td>
                <td style={{ padding: '8px 10px', color: 'var(--c-94a3b8)' }}>{a.detected_date}</td>
                <td style={{ padding: '8px 10px', color: 'var(--c-94a3b8)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(a.cost_7d_avg, 2)}</td>
                <td style={{ padding: '8px 10px', color: 'var(--c-f1f5f9)', fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(a.cost_latest, 2)}</td>
                <td style={{ padding: '8px 10px', color: SEV[a.severity] || '#94a3b8', fontWeight: 600 }}>+{a.spike_pct}%</td>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999,
                                 color: SEV[a.severity] || '#94a3b8',
                                 border: `1px solid ${SEV[a.severity] || '#94a3b8'}55` }}>{a.severity}</span>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={7} style={{ padding: 22, textAlign: 'center', color: 'var(--c-64748b)' }}>
                {active ? 'No anomalies match these filters.' : 'No open anomalies.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {sel_ && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ color: 'var(--c-f1f5f9)', fontSize: 14, fontWeight: 700 }}>
              {sel_.anomaly?.resource_name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--c-64748b)' }}>
              {sel_.anomaly?.resource_type} · {sel_.anomaly?.resource_group}
            </span>
            <button onClick={analyze} disabled={aiBusy || !sel_.available}
                    style={{ ...sel, marginLeft: 'auto', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                             color: '#c4b5fd', borderColor: '#6d28d9' }}>
              {aiBusy ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {aiBusy ? 'Analysing…' : 'Explain this spike'}
            </button>
            <button onClick={() => { setSel(null); setAi(null) }} style={{ ...sel, cursor: 'pointer' }}><X size={12} /></button>
          </div>

          {sel_.available === false && (
            <div style={{ fontSize: 12, color: 'var(--c-64748b)' }}>{sel_.reason || 'No detail available.'}</div>
          )}

          {sel_.available && (
            <>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--c-94a3b8)', marginBottom: 8 }}>
                <span>Baseline (7-day avg) <strong style={{ color: 'var(--c-e2e8f0)' }}>{fmtUsd(sel_.baseline_usd, 2)}</strong></span>
                <span>On {sel_.anomaly.detected_date} <strong style={{ color: 'var(--c-e2e8f0)' }}>{fmtUsd(sel_.anomaly.cost_latest, 2)}</strong></span>
                <span>Excess <strong style={{ color: '#ef4444' }}>{fmtUsd(sel_.excess_usd, 2)}</strong></span>
                <span>Spike <strong style={{ color: SEV[sel_.anomaly.severity] }}>+{sel_.anomaly.spike_pct}%</strong></span>
              </div>
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={sel_.series} margin={{ top: 8, right: 18, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtUsd(v, 0)} />
                  <Tooltip formatter={v => [fmtUsd(v, 2), 'Cost']}
                           contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 8, fontSize: 12 }} />
                  {/* The baseline is what makes the spike legible as a deviation. */}
                  <ReferenceLine y={sel_.baseline_usd} stroke="#64748b" strokeDasharray="4 4"
                                 label={{ value: 'baseline', position: 'insideTopLeft', fontSize: 9, fill: '#64748b' }} />
                  <Line type="monotone" dataKey="cost" stroke="#38bdf8" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                  <ReferenceDot x={sel_.anomaly.detected_date} y={sel_.anomaly.cost_latest}
                                r={5} fill={SEV[sel_.anomaly.severity] || '#ef4444'} stroke="#fff" strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
              {!sel_.series?.length && (
                <div style={{ fontSize: 11, color: 'var(--c-64748b)', marginTop: 6 }}>
                  No daily rows for this resource in the window — the anomaly figures above still stand.
                </div>
              )}
            </>
          )}

          {ai && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--c-1e293b)', paddingTop: 10 }}>
              {ai.available ? (
                <div style={{ fontSize: 12, color: 'var(--c-e2e8f0)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                  {ai.analysis}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--c-fca5a5)' }}>AI analysis unavailable: {ai.reason}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
