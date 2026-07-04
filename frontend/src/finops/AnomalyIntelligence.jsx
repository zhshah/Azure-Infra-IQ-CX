/**
 * Anomaly Intelligence — statistical cost-spike detection with AI root-cause.
 *
 * Renders the daily spend series with its rolling baseline band, marks anomalies,
 * lists them by severity, and shows a grounded AI root-cause narrative. All from
 * aggregate daily data (throttle-immune).
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  ComposedChart, Area, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { Activity, AlertTriangle, RefreshCw, AlertCircle, Sparkles, TrendingUp, TrendingDown } from 'lucide-react'
import { finopsApi, fmtUsd } from './finopsApi'

const card      = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const miniLabel = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }
const secLabel  = { color: 'var(--c-e2e8f0)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }
const SEV_COLOR = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b' }
const fmtDate = d => (typeof d === 'string' ? d.slice(5) : d)

export default function AnomalyIntelligence() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [sensitivity, setSensitivity] = useState(2.5)

  const load = useCallback(async (z) => {
    setLoading(true); setError(null)
    try { setData(await finopsApi.getAnomalies({ days: 60, z: z ?? sensitivity })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [sensitivity])

  useEffect(() => { load(sensitivity) /* eslint-disable-next-line */ }, [])

  const series = data?.series || []
  const anomalies = data?.anomalies || []
  const ai = data?.ai
  // Chart rows: cost line, baseline (expected), and anomaly scatter (only anomalous days).
  const chartData = series.map(p => ({
    date: p.date, cost: p.cost, expected: p.expected,
    anomaly: p.is_anomaly ? p.cost : null,
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
            <Activity size={20} style={{ color: '#f97316' }} /> Anomaly Intelligence
          </h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '4px 0 0' }}>
            Rolling-baseline detection over daily spend, with AI root-cause. Flags unexpected spikes &amp; drops.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--c-64748b)' }}>Sensitivity</span>
            {[{ z: 2.0, l: 'High' }, { z: 2.5, l: 'Medium' }, { z: 3.0, l: 'Low' }].map(o => (
              <button key={o.z} onClick={() => { setSensitivity(o.z); load(o.z) }} style={{
                borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                background: sensitivity === o.z ? '#4f46e5' : 'var(--c-0b1220)', border: `1px solid ${sensitivity === o.z ? '#4f46e5' : 'var(--c-334155)'}`, color: sensitivity === o.z ? '#fff' : 'var(--c-94a3b8)',
              }}>{o.l}</button>
            ))}
          </div>
          <button onClick={() => load(sensitivity)} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 12 }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ ...card, borderColor: 'var(--c-7f1d1d)', color: 'var(--c-fca5a5)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ fontSize: 12 }}>{error}</span>
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
          <div style={miniLabel}>Anomalies detected</div>
          <div style={{ color: anomalies.length ? '#f97316' : '#22c55e', fontSize: 22, fontWeight: 700 }}>{data?.anomaly_count ?? 0}</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>over {data?.days ?? 0} days</div>
        </div>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
          <div style={miniLabel}>Critical / high</div>
          <div style={{ color: 'var(--c-f1f5f9)', fontSize: 22, fontWeight: 700 }}>{anomalies.filter(a => a.severity === 'critical' || a.severity === 'high').length}</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>need attention</div>
        </div>
        <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
          <div style={miniLabel}>Largest deviation</div>
          <div style={{ color: 'var(--c-f1f5f9)', fontSize: 22, fontWeight: 700 }}>{anomalies.length ? `${Math.round(Math.max(...anomalies.map(a => Math.abs(a.deviation_pct))))}%` : '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b)' }}>vs baseline</div>
        </div>
      </div>

      {/* Timeline */}
      <div style={card}>
        <div style={secLabel}><TrendingUp size={16} style={{ color: '#f97316' }} /> Daily spend &amp; baseline</div>
        {loading && !series.length ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-64748b)' }}><RefreshCw size={16} className="animate-spin" /> Loading…</div>
        ) : series.length ? (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 14, right: 16, left: 6, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--c-1e293b)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'var(--c-64748b)' }} minTickGap={24} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--c-64748b)' }} tickFormatter={v => fmtUsd(v)} />
              <Tooltip
                contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }}
                formatter={(v, n) => [v == null ? '—' : fmtUsd(v), n === 'cost' ? 'Actual' : n === 'expected' ? 'Baseline' : 'Anomaly']}
              />
              <Area type="monotone" dataKey="expected" stroke="#475569" strokeDasharray="4 3" fill="#475569" fillOpacity={0.08} name="expected" />
              <Line type="monotone" dataKey="cost" stroke="#3b82f6" strokeWidth={2} dot={false} name="cost" />
              <Scatter dataKey="anomaly" name="anomaly" fill="#ef4444">
                {chartData.map((d, i) => <Cell key={i} fill="#ef4444" />)}
              </Scatter>
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-64748b)', fontSize: 12 }}>No daily spend history available yet.</div>
        )}
      </div>

      {/* AI root-cause */}
      {ai?.summary && (
        <div style={{ ...card, borderColor: '#f97316', background: 'linear-gradient(180deg, rgba(249,115,22,0.07), var(--c-111827))' }}>
          <div style={secLabel}><Sparkles size={15} style={{ color: '#fb923c' }} /> AI root-cause analysis</div>
          <p style={{ color: 'var(--c-e2e8f0)', fontSize: 13, lineHeight: 1.6, margin: '10px 0 0' }}>{ai.summary}</p>
          {(ai.key_findings || []).length > 0 && (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--c-cbd5e1)', fontSize: 12, lineHeight: 1.7 }}>
              {ai.key_findings.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Anomaly list */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-1e293b)' }}>
          <div style={secLabel}><AlertTriangle size={15} style={{ color: '#f97316' }} /> Detected anomalies</div>
        </div>
        {anomalies.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-64748b)', fontSize: 12 }}>
            {loading ? 'Analyzing…' : 'No anomalies at this sensitivity — spend is within its expected band.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--c-0b1220)', color: 'var(--c-64748b)', textAlign: 'left' }}>
                {['Date', 'Type', 'Actual', 'Baseline', 'Deviation', 'Severity'].map((h, i) => (
                  <th key={i} style={{ padding: '9px 14px', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {anomalies.map((a, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--c-1e293b)' }}>
                  <td style={{ padding: '9px 14px', color: 'var(--c-e2e8f0)' }}>{a.date}</td>
                  <td style={{ padding: '9px 14px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: a.direction === 'spike' ? '#ef4444' : '#22c55e' }}>
                      {a.direction === 'spike' ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {a.direction}
                    </span>
                  </td>
                  <td style={{ padding: '9px 14px', color: 'var(--c-f1f5f9)', fontWeight: 600 }}>{fmtUsd(a.cost)}</td>
                  <td style={{ padding: '9px 14px', color: 'var(--c-94a3b8)' }}>{a.expected != null ? fmtUsd(a.expected) : '—'}</td>
                  <td style={{ padding: '9px 14px', color: a.deviation_pct >= 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{a.deviation_pct > 0 ? '+' : ''}{a.deviation_pct}%</td>
                  <td style={{ padding: '9px 14px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: SEV_COLOR[a.severity], border: `1px solid ${SEV_COLOR[a.severity]}55`, borderRadius: 4, padding: '2px 7px' }}>{a.severity}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
