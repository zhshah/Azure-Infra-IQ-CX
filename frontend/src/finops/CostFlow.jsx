/**
 * Cost Flow — executive-grade visuals of where the money goes.
 *
 *   • Sankey: money flowing subscription → resource group → service (aggregate,
 *     throttle-immune, run-rate cost).
 *   • Month-over-month Waterfall: prior-month total → per-dimension increases /
 *     decreases → current-month total (the "cost bridge" execs expect).
 *
 * Both are built from existing endpoints (/finops/cost-flow and /finops/compare).
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, ReferenceLine,
} from 'recharts'
import { GitBranch, TrendingUp, RefreshCw, AlertCircle, Filter, Waypoints } from 'lucide-react'
import { finopsApi, fmtUsd, getSubscriptions, getFilterOptions } from './finopsApi'
import SearchableSelect from '../components/shared/SearchableSelect'

const card      = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const miniLabel = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }
const secLabel  = { color: 'var(--c-e2e8f0)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }

const LEVEL_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b']
const WATERFALL_DIMS = [
  { value: 'ResourceGroupName', label: 'Resource group' },
  { value: 'ServiceName',       label: 'Service' },
  { value: 'SubscriptionId',    label: 'Subscription' },
  { value: 'ResourceLocation',  label: 'Region' },
]

/* ── Custom Sankey node (color by level + $ label) ── */
function FlowNode({ x, y, width, height, index, payload }) {
  const color = LEVEL_COLORS[(payload.level ?? 0) % LEVEL_COLORS.length]
  const isRight = (payload.level ?? 0) >= 2
  return (
    <Layer key={`node-${index}`}>
      <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.9} radius={2} />
      {height > 10 && (
        <text
          x={isRight ? x - 6 : x + width + 6}
          y={y + height / 2}
          textAnchor={isRight ? 'end' : 'start'}
          dominantBaseline="middle"
          fontSize={11}
          fill="var(--c-cbd5e1)"
        >
          {payload.name}
          <tspan fill="var(--c-64748b)" fontSize={10}> · {fmtUsd(payload.value)}</tspan>
        </text>
      )}
    </Layer>
  )
}

export default function CostFlow() {
  const [flow, setFlow]       = useState(null)
  const [compare, setCompare] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [scope, setScope]     = useState({ subscription_id: '', resource_group: '', region: '' })
  const [wfDim, setWfDim]     = useState('ResourceGroupName')
  const [subOpts, setSubOpts] = useState([])
  const [rgOpts, setRgOpts]   = useState([])
  const [regionOpts, setRegionOpts] = useState([])

  useEffect(() => {
    getSubscriptions().then(s => setSubOpts((s || []).map(x => ({ value: x.subscription_id, label: x.subscription_name || x.subscription_id })))).catch(() => {})
    getFilterOptions().then(o => {
      setRgOpts((o.resource_groups || []).map(v => (typeof v === 'string' ? { value: v, label: v } : { value: v.value, label: v.label ?? v.value })))
      setRegionOpts((o.regions || []).map(v => (typeof v === 'string' ? { value: v, label: v } : { value: v.value, label: v.label ?? v.value })))
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [f, c] = await Promise.all([
        finopsApi.getCostFlow({ ...scope }),
        finopsApi.getCompare(wfDim).catch(() => null),
      ])
      setFlow(f); setCompare(c)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [scope, wfDim])

  useEffect(() => { load() }, [load])

  const sankeyData = useMemo(() => {
    if (!flow?.nodes?.length || !flow?.links?.length) return null
    return { nodes: flow.nodes.map(n => ({ name: n.name, level: n.level, value: n.value })), links: flow.links }
  }, [flow])

  // Build waterfall bars: prior total → top movers → current total.
  const waterfall = useMemo(() => {
    if (!compare?.rows?.length) return null
    const prior = compare.total_prior || 0
    const current = compare.total_current || 0
    const movers = [...compare.rows].filter(r => Math.abs(r.delta_usd) > 0).slice(0, 10)
    let running = prior
    const bars = [{ name: 'Prior month', base: 0, val: prior, type: 'total' }]
    for (const m of movers) {
      const d = m.delta_usd
      let base, val
      if (d >= 0) { base = running; val = d; running += d }
      else { running += d; base = running; val = -d }
      bars.push({ name: m.value || m.key, base, val, type: d >= 0 ? 'up' : 'down', delta: d })
    }
    bars.push({ name: 'Current month', base: 0, val: current, type: 'total' })
    return bars
  }, [compare])

  const WF_COLOR = { total: '#3b82f6', up: '#ef4444', down: '#22c55e' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
            <Waypoints size={20} style={{ color: '#8b5cf6' }} /> Cost Flow
          </h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '4px 0 0' }}>
            Where the money flows (subscription → resource group → service) and the month-over-month cost bridge.
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 12 }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Scope */}
      <div style={{ ...card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--c-94a3b8)', fontSize: 12 }}><Filter size={14} /> Scope</div>
        <div style={{ minWidth: 190 }}>
          <div style={miniLabel}>Subscription</div>
          <SearchableSelect value={scope.subscription_id} onChange={v => setScope(s => ({ ...s, subscription_id: v }))} options={[{ value: '', label: 'All subscriptions' }, ...subOpts]} placeholder="All subscriptions" />
        </div>
        <div style={{ minWidth: 190 }}>
          <div style={miniLabel}>Resource group</div>
          <SearchableSelect value={scope.resource_group} onChange={v => setScope(s => ({ ...s, resource_group: v }))} options={[{ value: '', label: 'All resource groups' }, ...rgOpts]} placeholder="All resource groups" />
        </div>
        <div style={{ minWidth: 170 }}>
          <div style={miniLabel}>Region</div>
          <SearchableSelect value={scope.region} onChange={v => setScope(s => ({ ...s, region: v }))} options={[{ value: '', label: 'All regions' }, ...regionOpts]} placeholder="All regions" />
        </div>
      </div>

      {error && (
        <div style={{ ...card, borderColor: 'var(--c-7f1d1d)', color: 'var(--c-fca5a5)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ fontSize: 12 }}>{error}</span>
        </div>
      )}

      {/* Sankey */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={secLabel}><GitBranch size={16} style={{ color: '#8b5cf6' }} /> Cost flow</div>
          {flow?.total_usd != null && <span style={{ fontSize: 12, color: 'var(--c-64748b)' }}>{fmtUsd(flow.total_usd)} across {flow.resource_count} resources</span>}
        </div>
        {loading && !sankeyData ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--c-64748b)' }}><RefreshCw size={16} className="animate-spin" /> Loading…</div>
        ) : sankeyData ? (
          <ResponsiveContainer width="100%" height={Math.max(360, (sankeyData.nodes.length) * 16)}>
            <Sankey
              data={sankeyData}
              node={<FlowNode />}
              nodePadding={26}
              nodeWidth={12}
              linkCurvature={0.5}
              iterations={64}
              link={{ stroke: '#475569', strokeOpacity: 0.25 }}
              margin={{ top: 10, bottom: 10, left: 10, right: 140 }}
            >
              <Tooltip formatter={(v) => fmtUsd(v)} contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }} />
            </Sankey>
          </ResponsiveContainer>
        ) : (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-64748b)', fontSize: 12 }}>No cost data in scope yet.</div>
        )}
      </div>

      {/* MoM Waterfall */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={secLabel}><TrendingUp size={16} style={{ color: '#22c55e' }} /> Month-over-month cost bridge</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {WATERFALL_DIMS.map(d => (
              <button key={d.value} onClick={() => setWfDim(d.value)} style={{
                borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                background: wfDim === d.value ? '#4f46e5' : 'var(--c-0b1220)', border: `1px solid ${wfDim === d.value ? '#4f46e5' : 'var(--c-334155)'}`, color: wfDim === d.value ? '#fff' : 'var(--c-94a3b8)',
              }}>{d.label}</button>
            ))}
          </div>
        </div>
        {waterfall ? (
          <>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={waterfall} margin={{ top: 10, right: 20, left: 10, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--c-1e293b)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--c-64748b)' }} angle={-35} textAnchor="end" interval={0} height={70} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--c-64748b)' }} tickFormatter={v => fmtUsd(v)} />
                <Tooltip
                  contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12 }}
                  formatter={(v, n, p) => [fmtUsd(p.payload.type === 'total' ? p.payload.val : (p.payload.delta ?? p.payload.val)), p.payload.type === 'total' ? 'Total' : (p.payload.delta >= 0 ? 'Increase' : 'Decrease')]}
                />
                <Bar dataKey="base" stackId="wf" fill="transparent" />
                <Bar dataKey="val" stackId="wf" radius={[3, 3, 0, 0]}>
                  {waterfall.map((b, i) => <Cell key={i} fill={WF_COLOR[b.type]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: 11, color: 'var(--c-64748b)' }}>
              <span><span style={{ color: '#3b82f6' }}>■</span> Total</span>
              <span><span style={{ color: '#ef4444' }}>■</span> Increase</span>
              <span><span style={{ color: '#22c55e' }}>■</span> Decrease</span>
            </div>
          </>
        ) : (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-64748b)', fontSize: 12 }}>No month-over-month data yet.</div>
        )}
      </div>
    </div>
  )
}
