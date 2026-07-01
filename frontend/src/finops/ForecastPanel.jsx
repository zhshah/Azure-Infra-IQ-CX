/**
 * Forecast Panel — Azure Cost Management Forecast API (same ML as Azure Portal)
 * Displays historical + forecast in a combined chart with confidence band
 */
import React, { useState, useEffect } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'
import SearchableSelect from '../components/shared/SearchableSelect'

export default function ForecastPanel() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [horizon, setHorizon] = useState(90)

  const load = async () => {
    setLoading(true); setError(null)
    try { setData(await finopsApi.getForecast(horizon)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [horizon])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, gap: 10 }}>
      <RefreshCw size={18} className="animate-spin" style={{ color: '#3b82f6' }} />
      <span style={{ color: 'var(--c-94a3b8)' }}>Loading Azure forecast…</span>
    </div>
  )
  if (error) return (
    <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 10, padding: 16, color: 'var(--c-fca5a5)', display: 'flex', gap: 8 }}>
      <AlertCircle size={16} /><span style={{ fontSize: 12 }}>{error}</span>
    </div>
  )
  if (!data) return null

  // Merge history + forecast into one series for chart
  const today = data.history?.[data.history.length - 1]?.date
  const allPoints = [
    ...(data.history || []).map(p => ({ date: p.date, actual: p.cost_usd })),
    ...(data.forecast || []).map(p => ({
      date: p.date,
      forecast: p.cost_usd,
      upper: p.confidence_upper ?? p.cost_usd * 1.1,
      lower: p.confidence_lower ?? p.cost_usd * 0.9,
    })),
  ]

  const trendColor = data.trend_direction === 'up' ? '#ef4444' : data.trend_direction === 'down' ? '#22c55e' : 'var(--c-64748b)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <FinOpsExportMenu view="forecast" focusDays={30} onXlsx={() => finopsApi.downloadReport()} report={{ title: 'Spend Forecast', kpis: [{ label: 'EOM Forecast', value: fmtUsd(data.eom_forecast_usd) }, { label: 'EOQ Forecast', value: fmtUsd(data.eoq_forecast_usd) }, { label: 'Confidence', value: fmtPct(data.confidence_pct) }, { label: 'Trend', value: String(data.trend_direction || '-') }] }} />
      </div>
      <FinOpsAIPanel view="forecast" data={{ method: data.method, trend_direction: data.trend_direction, eom_forecast_usd: data.eom_forecast_usd, eoq_forecast_usd: data.eoq_forecast_usd, confidence_pct: data.confidence_pct, horizon, cost_drivers: (data.cost_drivers || []).slice(0, 6), by_subscription: (data.by_subscription || []).slice(0, 6) }} />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Spend Forecast</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>
            {data.method === 'azure_forecast_api'
              ? 'Azure Cost Management Forecast API — same ML model as Azure Portal'
              : 'Linear regression forecast (Azure Forecast API unavailable for this billing scope)'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 160 }}>
            <SearchableSelect
              value={String(horizon)}
              onChange={v => setHorizon(Number(v))}
              options={[30,60,90,180,365].map(h => ({value:String(h),label:`${h}-day forecast`}))}
              compact
            />
          </div>
          <button onClick={load} style={{
            background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6,
            padding: '5px 10px', cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 11,
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Combined chart */}
      <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
        <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
          Historical vs Forecast — dashed line marks today
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={allPoints}>
            <defs>
              <linearGradient id="confBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
            <Tooltip
              contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }}
              formatter={(v, name) => [fmtUsd(v, 2), name]}
            />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: 'var(--c-94a3b8)' }} />
            {today && <ReferenceLine x={today} stroke="#3b82f6" strokeDasharray="4 4" label={{ value: 'Today', fill: '#3b82f6', fontSize: 10, position: 'top' }} />}
            {/* Confidence band */}
            <Area type="monotone" dataKey="upper" stroke="none" fill="url(#confBand)" legendType="none" />
            <Area type="monotone" dataKey="lower" stroke="none" fill="#0f172a" legendType="none" />
            <Line type="monotone" dataKey="actual"   stroke="#3b82f6" strokeWidth={2} dot={false} name="Actual" />
            <Line type="monotone" dataKey="forecast" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Forecast" />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 10, color: 'var(--c-334155)', textAlign: 'right', marginTop: 6 }}>
          Shaded area = confidence interval · Method: {data.method}
        </div>
      </div>

      {/* ── Cost Drivers table ── */}
      {(data.cost_drivers?.length > 0 || data.by_subscription?.length > 0) && (
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600, marginBottom: 12 }}>Forecast Cost Drivers</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>{['Category', 'Forecast Amount', '% of Total', 'Trend'].map(h => (
                <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {(data.cost_drivers || data.by_subscription || []).map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--c-0f172a)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: ['#3b82f6','#8b5cf6','#22c55e','#f59e0b','#ef4444'][i % 5], flexShrink: 0 }} />
                    {d.name || d.label || d.category || '—'}
                  </td>
                  <td style={{ padding: '6px 8px', color: '#8b5cf6', fontWeight: 600 }}>{fmtUsd(d.forecast_usd ?? d.cost ?? d.amount ?? 0, 2)}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--c-64748b)' }}>{d.pct != null ? `${d.pct}%` : '—'}</td>
                  <td style={{ padding: '6px 8px', color: (d.mom_delta_pct ?? 0) > 0 ? '#f87171' : '#4ade80', fontSize: 11 }}>
                    {d.mom_delta_pct != null ? `${d.mom_delta_pct > 0 ? '+' : ''}${d.mom_delta_pct}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Forecast summary ── */}
      <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {[
          { label: 'End of Month',    value: fmtUsd(data.eom_forecast_usd, 0),  color: '#3b82f6' },
          { label: 'End of Quarter',  value: fmtUsd(data.eoq_forecast_usd, 0),  color: '#8b5cf6' },
          { label: 'MoM Trend',       value: `${data.trend_direction === 'up' ? '↑' : data.trend_direction === 'down' ? '↓' : '→'} ${data.trend_direction}`, color: data.trend_direction === 'up' ? '#ef4444' : data.trend_direction === 'down' ? '#22c55e' : 'var(--c-64748b)' },
          { label: 'Model Confidence',value: fmtPct(data.confidence_pct),        color: '#22c55e' },
        ].map(c => (
          <div key={c.label}>
            <div style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>{c.label}</div>
            <div style={{ color: c.color, fontSize: 16, fontWeight: 700 }}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
