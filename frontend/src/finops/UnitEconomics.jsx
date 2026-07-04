/**
 * Unit Economics & Business Value — the "understanding the value" FinOps pillar.
 *
 * The user defines value drivers (active customers, transactions, revenue, …) and
 * an optional cost scope (subscription / resource group / tag). The backend divides
 * the scoped cloud cost by each driver to produce cost-per-unit, its month-over-month
 * change, and variance vs a target. Azure Portal has no equivalent — this reframes
 * raw spend as efficiency and business value. Model is saved to localStorage.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts'
import {
  Calculator, Plus, Trash2, Play, RefreshCw, AlertCircle, Target, TrendingUp,
  TrendingDown, DollarSign, Gauge, Sparkles, Filter,
} from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct, getSubscriptions, getFilterOptions } from './finopsApi'
import SearchableSelect from '../components/shared/SearchableSelect'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'

const STORAGE_KEY = 'finops:unitecon:model:v1'
const uid = () => Math.random().toString(36).slice(2, 9)
const DEFAULT_MODEL = { scope: { subscription_id: '', resource_group: '', tag_key: '', tag_value: '' }, drivers: [] }
const SAMPLE_DRIVERS = [
  { name: 'Active customers',        unit: 'customer',      value: 1000, previous_value: 900,  target_cpu: 0 },
  { name: 'Transactions (per 1,000)', unit: '1k txns',      value: 5000, previous_value: 4200, target_cpu: 0 },
  { name: 'Monthly revenue',          unit: '$ revenue',    value: 500000, previous_value: 460000, target_cpu: 0 },
]

// ── Shared styles ──────────────────────────────────────────────────────────
const card       = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const inputStyle = { background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 9px', color: 'var(--c-e2e8f0)', fontSize: 12, width: '100%', boxSizing: 'border-box' }
const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#4f46e5', border: '1px solid #4f46e5', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 600 }
const btnGhost   = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 11 }
const iconBtn    = { background: 'none', border: 'none', color: 'var(--c-64748b)', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }
const secLabel   = { color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }
const miniLabel  = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }

/** Format a cost-per-unit — adaptive precision for small values. */
const fmtCpu = (v) => {
  const n = Number(v) || 0
  if (n === 0) return '$0'
  if (n < 0.01) return `$${n.toFixed(5)}`
  if (n < 1) return `$${n.toFixed(4)}`
  if (n < 100) return `$${n.toFixed(2)}`
  return fmtUsd(n)
}

function toApiModel(m) {
  return {
    scope: {
      subscription_id: m.scope.subscription_id || '',
      resource_group: m.scope.resource_group || '',
      tag_key: m.scope.tag_key || '',
      tag_value: m.scope.tag_value || '',
    },
    drivers: (m.drivers || []).map(d => ({
      id: d.id, name: d.name, unit: d.unit,
      value: Number(d.value) || 0, previous_value: Number(d.previous_value) || 0, target_cpu: Number(d.target_cpu) || 0,
    })),
  }
}

export default function UnitEconomics() {
  const [model, setModel] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) return { ...DEFAULT_MODEL, ...JSON.parse(s) } } catch { /* ignore */ }
    return DEFAULT_MODEL
  })
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [subOpts, setSubOpts] = useState([])
  const [rgOpts,  setRgOpts]  = useState([])
  const [tagKeys, setTagKeys] = useState([])
  const [tagVals, setTagVals] = useState([])

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(model)) } catch { /* ignore */ } }, [model])

  useEffect(() => {
    getSubscriptions().then(s => setSubOpts((s || []).map(x => ({ value: x.subscription_id, label: x.subscription_name || x.subscription_id })))).catch(() => {})
    getFilterOptions().then(o => {
      setRgOpts((o.resource_groups || []).map(v => (typeof v === 'string' ? { value: v, label: v } : { value: v.value, label: v.label ?? v.value })))
      setTagKeys(o.tag_keys || [])
    }).catch(() => {})
  }, [])

  // Load tag values when a tag key is chosen for scope
  useEffect(() => {
    const key = model.scope.tag_key
    if (!key) { setTagVals([]); return }
    let cancelled = false
    fetch(`/api/tags/values/${encodeURIComponent(key)}`)
      .then(r => r.ok ? r.json() : { values: [] })
      .then(d => { if (!cancelled) setTagVals(d.values || []) })
      .catch(() => { if (!cancelled) setTagVals([]) })
    return () => { cancelled = true }
  }, [model.scope.tag_key])

  const compute = useCallback(async (m) => {
    const mdl = m || model
    if (!(mdl.drivers || []).length) { setResult(null); return }
    setLoading(true); setError(null)
    try { setResult(await finopsApi.computeUnitEconomics(toApiModel(mdl))) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [model])

  useEffect(() => { if ((model.drivers || []).length) compute(model) /* eslint-disable-next-line */ }, [])

  // ── Mutators ──
  const setScope = (patch) => setModel(m => ({ ...m, scope: { ...m.scope, ...patch } }))
  const addDriver = () => setModel(m => ({ ...m, drivers: [...m.drivers, { id: uid(), name: '', unit: 'unit', value: 0, previous_value: 0, target_cpu: 0 }] }))
  const updateDriver = (id, patch) => setModel(m => ({ ...m, drivers: m.drivers.map(d => d.id === id ? { ...d, ...patch } : d) }))
  const removeDriver = (id) => setModel(m => ({ ...m, drivers: m.drivers.filter(d => d.id !== id) }))
  const seedSamples = () => {
    const next = { ...model, drivers: SAMPLE_DRIVERS.map(d => ({ id: uid(), ...d })) }
    setModel(next); compute(next)
  }

  const anyScope = model.scope.subscription_id || model.scope.resource_group || model.scope.tag_key
  const chartData = useMemo(() => (result?.drivers || []).map(d => ({
    name: d.name || '(unnamed)', cpu: d.cost_per_unit, target: d.target_cpu, unit: d.unit,
  })), [result])

  const aiData = result ? {
    scope: model.scope,
    scope_current_usd: result.scope_current_usd, scope_previous_usd: result.scope_previous_usd, scope_mom_pct: result.scope_mom_pct,
    drivers: (result.drivers || []).map(d => ({ name: d.name, unit: d.unit, value: d.value, cost_per_unit: d.cost_per_unit, mom_pct: d.mom_pct, target: d.target_cpu, vs_target_pct: d.vs_target_pct })),
  } : {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calculator size={18} style={{ color: '#818cf8' }} /> Unit Economics &amp; Business Value
          </h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '2px 0 0 0' }}>
            Turn raw spend into cost-per-unit — cost per customer, per transaction, as a % of revenue. Model saved locally.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => compute()} disabled={loading || !(model.drivers || []).length} style={{ ...btnPrimary, opacity: (loading || !(model.drivers || []).length) ? 0.55 : 1 }}>
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />} Compute
          </button>
          {result && (result.drivers || []).length > 0 && (
            <FinOpsExportMenu view="unit-economics" report={{
              title: 'Unit Economics & Business Value',
              kpis: [
                { label: 'Scoped spend (MTD)', value: fmtUsd(result.scope_current_usd) },
                { label: 'Scoped spend (prev)', value: fmtUsd(result.scope_previous_usd) },
                { label: 'MoM',                 value: fmtPct(result.scope_mom_pct) },
                { label: 'Resources in scope',  value: String(result.resource_count) },
              ],
              tables: [{
                title: 'Cost per unit by value driver',
                columns: ['Driver', 'Unit', 'Value', 'Cost / unit', 'Prev cost / unit', 'MoM %', 'Target', 'vs Target %'],
                rows: (result.drivers || []).map(d => [d.name, d.unit, d.value, fmtCpu(d.cost_per_unit), fmtCpu(d.cost_per_unit_prev), fmtPct(d.mom_pct), d.target_cpu ? fmtCpu(d.target_cpu) : '—', d.target_cpu ? fmtPct(d.vs_target_pct) : '—']),
              }],
            }} />
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 8, padding: 12, color: 'var(--c-fca5a5)', fontSize: 12, display: 'flex', gap: 8 }}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} />{error}
        </div>
      )}

      <FinOpsAIPanel view="unit-economics" title="AI value narrative" data={aiData} />

      {/* Scope */}
      <div style={card}>
        <div style={secLabel}><Filter size={15} style={{ color: anyScope ? '#60a5fa' : '#818cf8' }} /> Cost scope <span style={{ color: 'var(--c-475569)', fontWeight: 400, fontSize: 11 }}>— which spend to divide (leave blank for entire estate)</span></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 210 }}>
            <div style={miniLabel}>Subscription</div>
            <SearchableSelect value={model.scope.subscription_id} onChange={v => setScope({ subscription_id: v || '' })} options={subOpts} placeholder="All subscriptions" compact />
          </div>
          <div style={{ minWidth: 190 }}>
            <div style={miniLabel}>Resource group</div>
            <SearchableSelect value={model.scope.resource_group} onChange={v => setScope({ resource_group: v || '' })} options={rgOpts} placeholder="All resource groups" compact />
          </div>
          <div style={{ minWidth: 150 }}>
            <div style={miniLabel}>Tag key</div>
            <SearchableSelect value={model.scope.tag_key} onChange={v => setScope({ tag_key: v || '', tag_value: '' })} options={tagKeys.map(k => ({ value: k, label: k }))} placeholder="(optional)" compact />
          </div>
          <div style={{ minWidth: 150 }}>
            <div style={miniLabel}>Tag value</div>
            <SearchableSelect value={model.scope.tag_value} onChange={v => setScope({ tag_value: v || '' })} options={tagVals.map(v => ({ value: v, label: v }))} placeholder={model.scope.tag_key ? 'value…' : 'pick key first'} disabled={!model.scope.tag_key} compact />
          </div>
          {anyScope && (
            <button onClick={() => setScope({ subscription_id: '', resource_group: '', tag_key: '', tag_value: '' })} style={btnGhost}>Clear scope</button>
          )}
        </div>
        {result && (
          <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>Scoped spend this month: <b style={{ color: '#60a5fa' }}>{fmtUsd(result.scope_current_usd)}</b></span>
            <span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>Last month: <b style={{ color: 'var(--c-cbd5e1)' }}>{fmtUsd(result.scope_previous_usd)}</b></span>
            <span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>MoM: <b style={{ color: result.scope_mom_pct > 0 ? '#ef4444' : '#22c55e' }}>{fmtPct(result.scope_mom_pct)}</b></span>
            <span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>Resources: <b style={{ color: 'var(--c-cbd5e1)' }}>{result.resource_count}</b></span>
          </div>
        )}
      </div>

      {/* Value drivers */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={secLabel}><Gauge size={15} style={{ color: '#22c55e' }} /> Value drivers ({model.drivers.length})</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {model.drivers.length === 0 && <button onClick={seedSamples} style={btnGhost}><Sparkles size={12} /> Add sample drivers</button>}
            <button onClick={addDriver} style={btnGhost}><Plus size={12} /> Add driver</button>
          </div>
        </div>
        {model.drivers.length === 0 && (
          <div style={{ color: 'var(--c-475569)', fontSize: 12, padding: '10px 0' }}>
            No value drivers yet. Add the business metrics your spend supports (customers, transactions, revenue…) to see cost-per-unit.
          </div>
        )}
        {model.drivers.map(d => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <div style={miniLabel}>Driver name</div>
              <input value={d.name} onChange={e => updateDriver(d.id, { name: e.target.value })} placeholder="e.g. Active customers" style={inputStyle} />
            </div>
            <div style={{ width: 110 }}>
              <div style={miniLabel}>Unit label</div>
              <input value={d.unit} onChange={e => updateDriver(d.id, { unit: e.target.value })} placeholder="customer" style={inputStyle} />
            </div>
            <div style={{ width: 120 }}>
              <div style={miniLabel}>Value (this mo.)</div>
              <input type="number" min="0" value={d.value} onChange={e => updateDriver(d.id, { value: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ width: 120 }}>
              <div style={miniLabel}>Value (last mo.)</div>
              <input type="number" min="0" value={d.previous_value} onChange={e => updateDriver(d.id, { previous_value: e.target.value })} style={inputStyle} />
            </div>
            <div style={{ width: 120 }}>
              <div style={miniLabel}>Target $/unit</div>
              <input type="number" min="0" step="0.01" value={d.target_cpu} onChange={e => updateDriver(d.id, { target_cpu: e.target.value })} placeholder="optional" style={inputStyle} />
            </div>
            <button onClick={() => removeDriver(d.id)} style={{ ...iconBtn, marginBottom: 5 }} title="Remove driver"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>

      {loading && !result && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20 }}>
          <RefreshCw size={16} className="animate-spin" style={{ color: '#3b82f6' }} />
          <span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>Computing unit economics…</span>
        </div>
      )}

      {/* Results */}
      {result && (result.drivers || []).length > 0 && (
        <>
          {/* Cost-per-unit KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {result.drivers.map(d => {
              const up = d.mom_pct > 0
              const Trend = up ? TrendingUp : TrendingDown
              return (
                <div key={d.id} style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    <DollarSign size={13} style={{ color: '#818cf8' }} /> {d.name || '(unnamed)'}
                  </div>
                  <div style={{ color: '#f1f5f9', fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{fmtCpu(d.cost_per_unit)}</div>
                  <div style={{ color: 'var(--c-64748b)', fontSize: 11, marginTop: 3 }}>per {d.unit}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: up ? '#ef4444' : '#22c55e' }}>
                      <Trend size={12} /> {fmtPct(d.mom_pct)} MoM
                    </span>
                    {d.target_cpu > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: d.status === 'over' ? '#f59e0b' : '#22c55e' }}>
                        <Target size={12} /> {d.status === 'over' ? '+' : ''}{fmtPct(d.vs_target_pct)} vs target
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Cost-per-unit vs target chart */}
          <div style={card}>
            <div style={secLabel}><Gauge size={15} style={{ color: '#3b82f6' }} /> Cost per unit vs target</div>
            <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 52 + 40)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke="#475569" fontSize={10} tickFormatter={v => fmtCpu(v)} />
                <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={11} width={150} />
                <Tooltip formatter={(v, n) => [fmtCpu(v), n === 'cpu' ? 'Cost / unit' : 'Target']} contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }} cursor={{ fill: '#1e293b55' }} />
                <Legend iconSize={9} wrapperStyle={{ fontSize: 11, color: 'var(--c-94a3b8)' }} formatter={(v) => v === 'cpu' ? 'Cost / unit' : 'Target'} />
                <Bar dataKey="cpu" name="cpu" radius={[0, 3, 3, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.target > 0 && d.cpu > d.target ? '#f59e0b' : '#3b82f6'} />)}
                </Bar>
                <Bar dataKey="target" name="target" fill="#334155" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div style={card}>
            <div style={secLabel}><Calculator size={15} style={{ color: '#818cf8' }} /> Detail</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>{['Driver', 'Unit', 'Value', 'Cost / unit', 'Prev', 'MoM', 'Target', 'vs Target'].map((h, i) => (
                    <th key={h} style={{ textAlign: i >= 2 ? 'right' : 'left', color: 'var(--c-475569)', padding: '6px 10px', borderBottom: '1px solid var(--c-1e293b)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {result.drivers.map((d, i) => (
                    <tr key={d.id || i} style={{ borderBottom: '1px solid var(--c-0f172a)' }}>
                      <td style={{ padding: '7px 10px', color: 'var(--c-e2e8f0)', fontWeight: 600 }}>{d.name || '(unnamed)'}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--c-64748b)' }}>{d.unit}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--c-94a3b8)', textAlign: 'right' }}>{(d.value || 0).toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', color: '#f1f5f9', fontWeight: 700, textAlign: 'right' }}>{fmtCpu(d.cost_per_unit)}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--c-64748b)', textAlign: 'right' }}>{fmtCpu(d.cost_per_unit_prev)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: d.mom_pct > 0 ? '#ef4444' : '#22c55e' }}>{fmtPct(d.mom_pct)}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--c-64748b)', textAlign: 'right' }}>{d.target_cpu > 0 ? fmtCpu(d.target_cpu) : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: d.target_cpu > 0 ? (d.status === 'over' ? '#f59e0b' : '#22c55e') : 'var(--c-475569)' }}>{d.target_cpu > 0 ? fmtPct(d.vs_target_pct) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
