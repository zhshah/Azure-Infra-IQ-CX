/**
 * Management Cost & Usage Dashboard
 *
 * The executive-facing cost review: service categories, VM cost vs utilisation,
 * storage tiers & growth, network egress, security & monitoring spend,
 * Prod vs Non-Prod, resource-group economics, management-group rollup,
 * subscription governance and realized savings / ROI.
 *
 * Every section reads from the FinOps warehouse, so the view paints from stored
 * data instead of waiting on Cost Management at render time.
 */
import React, { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  RefreshCw, AlertCircle, Server, HardDrive, Network, Shield, Layers,
  DollarSign, TrendingUp, Database, CheckCircle2, Info,
} from 'lucide-react'
import { fmtUsd, fmtPct, CHART_COLORS } from './finopsApi'

const PALETTE = CHART_COLORS && CHART_COLORS.length
  ? CHART_COLORS
  : ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']

const ENV_COLORS = {
  'Production': '#ef4444',
  'Non-Production': '#3b82f6',
  'Unclassified': '#64748b',
}

const card = {
  background: 'var(--c-0f172a, #0f172a)',
  border: '1px solid var(--c-1e293b, #1e293b)',
  borderRadius: 10,
  padding: 16,
}

const num = (v) => (v === null || v === undefined ? '—' : v)

function Kpi({ label, value, sub, color, icon: Icon }) {
  return (
    <div style={{ ...card, flex: '1 1 180px', minWidth: 170 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {Icon && <Icon size={13} style={{ color: color || 'var(--c-94a3b8, #94a3b8)' }} />}
        <span style={{ fontSize: 11, color: 'var(--c-94a3b8, #94a3b8)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--c-f1f5f9, #f1f5f9)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--c-64748b, #64748b)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function Section({ title, icon: Icon, children, note }) {
  return (
    <div style={{ ...card }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {Icon && <Icon size={15} style={{ color: '#3b82f6' }} />}
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--c-f1f5f9, #f1f5f9)' }}>{title}</h3>
      </div>
      {note && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 12, color: 'var(--c-64748b, #64748b)', fontSize: 11 }}>
          <Info size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{note}</span>
        </div>
      )}
      {children}
    </div>
  )
}

function NoData({ what, hint }) {
  return (
    <div style={{ padding: 20, textAlign: 'center', color: 'var(--c-64748b, #64748b)', fontSize: 12 }}>
      <div style={{ marginBottom: 4 }}>No {what} data collected yet.</div>
      {hint && <div style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  )
}

const tooltipStyle = {
  contentStyle: {
    background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 8, fontSize: 12, color: '#f1f5f9',
  },
}

export default function ManagementDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [collecting, setCollecting] = useState(false)
  const [days, setDays] = useState(30)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(`/api/finops/mgmt/overview?days=${days}`)
      if (!r.ok) throw new Error(`API error ${r.status}`)
      setData(await r.json())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [days])

  const collect = async () => {
    setCollecting(true)
    try {
      await fetch(`/api/finops/mgmt/collect?days=${days}`, { method: 'POST' })
      await load()
    } catch (e) { setError(e.message) }
    finally { setCollecting(false) }
  }

  const vmScatter = useMemo(() => {
    const vms = data?.vm?.vms || []
    return vms
      .filter(v => v.utilization_pct !== null && v.utilization_pct !== undefined)
      .map(v => ({
        x: v.utilization_pct,
        y: v.cost_month_usd,
        z: Math.max(50, Math.min(v.cost_month_usd * 2, 500)),
        name: v.resource_name,
        sku: v.sku,
      }))
  }, [data])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 10 }}>
      <RefreshCw size={18} className="animate-spin" style={{ color: '#3b82f6' }} />
      <span style={{ color: 'var(--c-94a3b8, #94a3b8)' }}>Loading management dashboard…</span>
    </div>
  )
  if (error) return (
    <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d, #7f1d1d)', borderRadius: 10, padding: 16, color: 'var(--c-fca5a5, #fca5a5)', display: 'flex', gap: 8 }}>
      <AlertCircle size={16} /><span style={{ fontSize: 12 }}>{error}</span>
    </div>
  )
  if (!data) return null

  const { vm = {}, storage_tiers = {}, storage_growth = {}, network = {},
    security = {}, ingestion = {}, environments = {}, resource_groups = {},
    management_groups = {}, savings = {}, service_categories = {} } = data

  const prodCost = (environments.environments || []).find(e => e.environment === 'Production')?.cost_usd || 0
  const nonProdCost = (environments.environments || []).find(e => e.environment === 'Non-Production')?.cost_usd || 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9, #f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>
            Management Cost &amp; Usage Review
          </h2>
          <div style={{ fontSize: 12, color: 'var(--c-64748b, #64748b)', marginTop: 3 }}>
            Executive view across categories, compute, storage, network, security and savings
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            style={{ background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button onClick={load} style={{ background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {!data.meter_data_available && (
        <div style={{ background: '#1a1508', border: '1px solid #78350f', borderRadius: 10, padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <AlertCircle size={16} style={{ color: '#fbbf24' }} />
          <span style={{ fontSize: 12, color: '#fde68a', flex: 1 }}>
            Meter-level data has not been collected yet. Storage tiers, data egress, inter-region
            transfer and cost-per-GB need it. The nightly ETL collects it automatically — or run it now.
          </span>
          <button onClick={collect} disabled={collecting}
            style={{ background: '#78350f', color: '#fde68a', border: '1px solid #92400e', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: collecting ? 'wait' : 'pointer' }}>
            {collecting ? 'Collecting…' : 'Collect now'}
          </button>
        </div>
      )}

      {/* ── Service categories ─────────────────────────────────────────────── */}
      <Section title="Spend by Service Category" icon={Layers}>
        {(service_categories.categories || []).length === 0 ? (
          <NoData what="service category" hint="Requires meter-level collection." />
        ) : (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={service_categories.categories} dataKey="cost_usd" nameKey="category"
                    cx="50%" cy="50%" outerRadius={95} label={(e) => `${e.cost_pct}%`}>
                    {(service_categories.categories || []).map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} formatter={(v) => fmtUsd(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: '1 1 320px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--c-94a3b8, #94a3b8)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>Category</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cost</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(service_categories.categories || []).map((c, i) => (
                    <tr key={c.category} style={{ borderTop: '1px solid var(--c-1e293b, #1e293b)' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0, #e2e8f0)' }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: PALETTE[i % PALETTE.length], marginRight: 8 }} />
                        {c.category}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{fmtUsd(c.cost_usd)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-94a3b8, #94a3b8)' }}>{c.cost_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* ── VM cost & utilisation ──────────────────────────────────────────── */}
      <Section title="Virtual Machines — Cost &amp; Utilisation" icon={Server}
        note={vm.available && vm.metrics_note
          ? vm.metrics_note
          : (vm.available && vm.memory_coverage_pct < 100
            ? `Memory is reported for ${vm.memory_coverage_pct}% of running VMs. Memory comes from the host-level "Available Memory Bytes" metric combined with the SKU's RAM; VMs whose size is not in the catalogue show no memory figure.`
            : null)}>
        {!vm.available ? (
          <NoData what="VM utilisation" hint="Populated after the next resource scan." />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              <Kpi label="Total VM Spend" value={fmtUsd(vm.total_vm_cost_usd)} sub={`${vm.vm_count} VMs`} icon={DollarSign} />
              <Kpi label="Running" value={vm.running_count} sub={fmtUsd(vm.running_cost_usd)} color="#22c55e" />
              <Kpi label="Stopped" value={vm.stopped_count} sub={fmtUsd(vm.stopped_cost_usd)} color="#f59e0b" />
              <Kpi label="Idle VM Cost" value={fmtUsd(vm.idle_cost_usd)} sub="deallocated or inactive 30d+" color="#ef4444" />
              <Kpi label="Avg CPU" value={vm.avg_cpu_pct !== null && vm.avg_cpu_pct !== undefined ? `${vm.avg_cpu_pct}%` : '—'}
                sub={vm.running_count ? `across ${vm.running_count} running` : 'no running VMs'} />
              <Kpi label="Avg Memory" value={vm.avg_memory_pct !== null && vm.avg_memory_pct !== undefined ? `${vm.avg_memory_pct}%` : '—'}
                sub={vm.running_count ? `${vm.memory_coverage_pct}% coverage` : 'no running VMs'} />
              <Kpi label="% Underutilised" value={`${vm.underutilized_pct}%`} sub={`${vm.underutilized_count} of ${vm.running_count} running`} color="#f59e0b" />
            </div>

            {vmScatter.length > 0 && (
              <div style={{ height: 280, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--c-94a3b8, #94a3b8)', marginBottom: 6 }}>Cost vs Utilisation — bottom-right is waste</div>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                    <CartesianGrid stroke="#1e293b" />
                    <XAxis type="number" dataKey="x" name="Utilisation" unit="%" domain={[0, 100]}
                      tick={{ fill: '#94a3b8', fontSize: 11 }} label={{ value: 'Utilisation %', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 11 }} />
                    <YAxis type="number" dataKey="y" name="Cost" tick={{ fill: '#94a3b8', fontSize: 11 }}
                      label={{ value: 'Monthly cost', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }} />
                    <ZAxis type="number" dataKey="z" range={[40, 400]} />
                    <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: '3 3' }}
                      formatter={(v, n) => n === 'Cost' ? fmtUsd(v) : `${v}%`}
                      labelFormatter={() => ''}
                      content={({ payload }) => {
                        if (!payload || !payload.length) return null
                        const p = payload[0].payload
                        return (
                          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 10, fontSize: 12, color: '#f1f5f9' }}>
                            <div style={{ fontWeight: 600 }}>{p.name}</div>
                            <div style={{ color: '#94a3b8' }}>{p.sku}</div>
                            <div>Utilisation: {p.x}%</div>
                            <div>Cost: {fmtUsd(p.y)}</div>
                          </div>
                        )
                      }} />
                    <Scatter data={vmScatter}>
                      {vmScatter.map((d, i) => (
                        <Cell key={i} fill={d.x < 20 ? '#ef4444' : d.x < 50 ? '#f59e0b' : '#22c55e'} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}

            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#0f172a' }}>
                  <tr style={{ color: 'var(--c-94a3b8, #94a3b8)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>VM</th>
                    <th style={{ padding: '6px 8px' }}>Size</th>
                    <th style={{ padding: '6px 8px' }}>State</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cost</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>CPU</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Memory</th>
                    <th style={{ padding: '6px 8px' }}>Environment</th>
                  </tr>
                </thead>
                <tbody>
                  {(vm.vms || []).slice(0, 200).map(v => (
                    <tr key={v.resource_id} style={{ borderTop: '1px solid var(--c-1e293b, #1e293b)' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{v.resource_name}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8, #94a3b8)' }}>{v.sku || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{ color: v.power_state === 'running' ? '#22c55e' : '#f59e0b' }}>{v.power_state}</span>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{fmtUsd(v.cost_month_usd)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: (v.avg_cpu_pct ?? 100) < 20 ? '#ef4444' : 'var(--c-e2e8f0, #e2e8f0)' }}>
                        {v.avg_cpu_pct !== null ? `${v.avg_cpu_pct}%` : '—'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-e2e8f0, #e2e8f0)' }}>
                        {v.avg_memory_pct !== null ? `${v.avg_memory_pct}%` : '—'}
                      </td>
                      <td style={{ padding: '6px 8px', color: ENV_COLORS[v.environment] || '#64748b' }}>{v.environment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {/* ── Storage ────────────────────────────────────────────────────────── */}
      <Section title="Storage — Cost by Tier &amp; Growth" icon={HardDrive}
        note="Managed disks and snapshots have no blob access tier, so they are shown as separate lines rather than being counted as a tier.">
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ fontSize: 12, color: 'var(--c-94a3b8, #94a3b8)', marginBottom: 8 }}>Storage cost breakdown</div>
            {(storage_tiers.tiers || []).length === 0 ? (
              <NoData what="storage tier" hint="Requires meter-level collection." />
            ) : (
              <>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <Kpi label="Total Storage" value={fmtUsd(storage_tiers.total_usd)} />
                  <Kpi label="Access-Tiered" value={fmtUsd(storage_tiers.tiered_total_usd)} sub="Hot / Cool / Cold / Archive" />
                  <Kpi label="Managed Disks" value={fmtUsd(storage_tiers.disk_usd)} sub="no access tier" color="#8b5cf6" />
                  <Kpi label="Snapshots" value={fmtUsd(storage_tiers.snapshot_usd)} sub="reclaimable" color="#f59e0b" />
                </div>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={storage_tiers.tiers}>
                      <CartesianGrid stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="tier" tick={{ fill: '#94a3b8', fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <Tooltip {...tooltipStyle} formatter={(v) => fmtUsd(v)} />
                      <Bar dataKey="cost_usd" name="Cost" radius={[4, 4, 0, 0]}>
                        {(storage_tiers.tiers || []).map((t, i) => (
                          <Cell key={i} fill={t.is_access_tier ? PALETTE[i % PALETTE.length] : '#475569'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--c-64748b, #64748b)', marginTop: 4 }}>
                  Grey bars are untiered (managed disks, snapshots, other storage).
                </div>
              </>
            )}
          </div>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ fontSize: 12, color: 'var(--c-94a3b8, #94a3b8)', marginBottom: 8 }}>Capacity growth</div>
            {!storage_growth.available ? (
              <NoData what="capacity" hint={storage_growth.note || 'Needs two or more daily snapshots.'} />
            ) : (
              <>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <Kpi label="Current" value={`${storage_growth.current_gb} GB`} />
                  <Kpi label="Growth" value={`${storage_growth.growth_gb_per_month} GB/mo`}
                    sub={`${storage_growth.growth_pct}% over ${storage_growth.span_days}d`}
                    color={storage_growth.growth_gb_per_month > 0 ? '#f59e0b' : '#22c55e'} />
                </div>
                <div style={{ height: 150 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={storage_growth.series}>
                      <CartesianGrid stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <Tooltip {...tooltipStyle} formatter={(v) => `${v} GB`} />
                      <Line type="monotone" dataKey="capacity_gb" stroke="#3b82f6" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        </div>
      </Section>

      {/* ── Network ────────────────────────────────────────────────────────── */}
      <Section title="Network &amp; Data Egress" icon={Network}>
        {!network.available ? (
          <NoData what="network meter" hint="Requires meter-level collection." />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <Kpi label="Total Network" value={fmtUsd(network.total_usd)} icon={Network} />
              <Kpi label="Data Egress" value={fmtUsd(network.egress_usd)} sub={`${network.egress_gb} GB`} color="#f59e0b" />
              <Kpi label="Inter-Region" value={fmtUsd(network.inter_region_usd)} sub={`${network.inter_region_gb} GB`} color="#8b5cf6" />
              <Kpi label="Other Network" value={fmtUsd(network.other_network_usd)} />
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 300px' }}>
                <div style={{ fontSize: 12, color: 'var(--c-94a3b8, #94a3b8)', marginBottom: 6 }}>Top meters</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <tbody>
                    {(network.top_meters || []).slice(0, 10).map((m, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--c-1e293b, #1e293b)' }}>
                        <td style={{ padding: '5px 8px', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{m.meter_name}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--c-94a3b8, #94a3b8)' }}>{m.quantity_gb} GB</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{fmtUsd(m.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ flex: '1 1 300px' }}>
                <div style={{ fontSize: 12, color: 'var(--c-94a3b8, #94a3b8)', marginBottom: 6 }}>Top VNets / gateways by cost</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <tbody>
                    {(network.top_resources || []).slice(0, 10).map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--c-1e293b, #1e293b)' }}>
                        <td style={{ padding: '5px 8px', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{r.resource_name}</td>
                        <td style={{ padding: '5px 8px', color: 'var(--c-64748b, #64748b)', fontSize: 11 }}>{(r.resource_type || '').split('/').pop()}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{fmtUsd(r.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* ── Security & monitoring ──────────────────────────────────────────── */}
      <Section title="Security &amp; Monitoring Spend" icon={Shield}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <Kpi label="Total Security" value={fmtUsd(security.total_usd || 0)} icon={Shield} color="#ef4444" />
          <Kpi label="Ingestion Cost" value={fmtUsd(ingestion.ingestion_cost_usd || 0)} sub={`${ingestion.ingested_gb || 0} GB ingested`} />
          <Kpi label="Cost per GB" value={ingestion.cost_per_gb_usd ? `$${ingestion.cost_per_gb_usd}` : '—'} sub="Log Analytics / Sentinel" color="#06b6d4" />
          <Kpi label="Retention Cost" value={fmtUsd(ingestion.retention_cost_usd || 0)} />
        </div>
        {(security.by_service || []).length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--c-94a3b8, #94a3b8)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Service</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cost</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {security.by_service.map((s, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--c-1e293b, #1e293b)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{s.service}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{fmtUsd(s.cost_usd)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-94a3b8, #94a3b8)' }}>{s.cost_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Environment + resource groups ──────────────────────────────────── */}
      <Section title="Production vs Non-Production" icon={Database}
        note="Environment is normalised from the Environment tag, falling back to resource-group naming, so inconsistent tag values (prod / PRD / Production) roll into one bucket.">
        {!environments.available ? (
          <NoData what="environment" hint="Populated after the next resource scan." />
        ) : (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Kpi label="Production" value={fmtUsd(prodCost)} color={ENV_COLORS.Production} />
              <Kpi label="Non-Production" value={fmtUsd(nonProdCost)} color={ENV_COLORS['Non-Production']} />
              <Kpi label="Non-Prod Share"
                value={prodCost + nonProdCost > 0 ? `${Math.round(nonProdCost / (prodCost + nonProdCost) * 100)}%` : '—'}
                sub="of classified spend" />
            </div>
            <div style={{ flex: '1 1 300px', height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={environments.environments} dataKey="cost_usd" nameKey="environment"
                    cx="50%" cy="50%" outerRadius={75} label={(e) => `${e.cost_pct}%`}>
                    {(environments.environments || []).map((e, i) => (
                      <Cell key={i} fill={ENV_COLORS[e.environment] || PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} formatter={(v) => fmtUsd(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Section>

      <Section title="Resource Group Economics" icon={Layers}
        note="Cost-per-resource highlights groups where spend is concentrated in a few expensive resources.">
        {!resource_groups.available ? (
          <NoData what="resource group" hint="Populated after the next resource scan." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--c-94a3b8, #94a3b8)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Resource Group</th>
                <th style={{ padding: '6px 8px' }}>Environment</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Resources</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cost</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cost / Resource</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Idle Cost</th>
              </tr>
            </thead>
            <tbody>
              {(resource_groups.resource_groups || []).map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--c-1e293b, #1e293b)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{r.resource_group}</td>
                  <td style={{ padding: '6px 8px', color: ENV_COLORS[r.environment] || '#64748b' }}>{r.environment}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-94a3b8, #94a3b8)' }}>{r.resource_count}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{fmtUsd(r.cost_usd)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-94a3b8, #94a3b8)' }}>{fmtUsd(r.cost_per_resource_usd)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: r.idle_cost_usd > 0 ? '#ef4444' : 'var(--c-64748b, #64748b)' }}>{fmtUsd(r.idle_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Management groups ──────────────────────────────────────────────── */}
      <Section title="Cost by Management Group" icon={Layers}
        note="Rollup cost includes every descendant subscription; direct cost counts only subscriptions not claimed by a deeper group.">
        {!management_groups.available ? (
          <NoData what="management group" hint="Collected by the nightly ETL; needs Management Group Reader." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--c-94a3b8, #94a3b8)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Management Group</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Subscriptions</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Direct</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Rollup</th>
              </tr>
            </thead>
            <tbody>
              {(management_groups.management_groups || []).map((m, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--c-1e293b, #1e293b)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{m.mg_name}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-94a3b8, #94a3b8)' }}>{m.subscription_count}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-94a3b8, #94a3b8)' }}>{fmtUsd(m.direct_cost_usd)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{fmtUsd(m.rollup_cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── Savings & ROI ──────────────────────────────────────────────────── */}
      <Section title="Savings &amp; ROI" icon={TrendingUp}
        note="Realized savings compares each implemented recommendation's baseline cost against the resource's measured cost afterwards. ROI prices implementation effort at the configured hourly rate.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <Kpi label="Identified" value={fmtUsd(savings.identified_monthly_usd || 0)} sub="per month" icon={DollarSign} />
          <Kpi label="Potential (open)" value={fmtUsd(savings.potential_monthly_usd || 0)} color="#3b82f6" />
          <Kpi label="Accepted" value={fmtUsd(savings.accepted_monthly_usd || 0)} color="#8b5cf6" />
          <Kpi label="Realized" value={fmtUsd(savings.realized_monthly_usd || 0)} sub="measured" color="#22c55e" icon={CheckCircle2} />
          <Kpi label="ROI"
            value={savings.roi_available ? `${savings.roi_pct}%` : 'Not measured'}
            sub={savings.roi_available ? `impl. cost ${fmtUsd(savings.implementation_cost_usd)}` : 'implement a recommendation first'}
            color={savings.roi_available && savings.roi_pct > 0 ? '#22c55e' : '#64748b'} />
          <Kpi label="Capture Rate" value={`${savings.capture_rate_pct || 0}%`} sub="realized ÷ identified" />
        </div>
        {(savings.ledger_months || []).length > 0 && (
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={savings.ledger_months}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="billing_month" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip {...tooltipStyle} formatter={(v) => fmtUsd(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="expected_usd" name="Expected" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="realized_usd" name="Realized" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {(savings.by_category || []).length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 12 }}>
            <thead>
              <tr style={{ color: 'var(--c-94a3b8, #94a3b8)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Category</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Count</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Monthly savings</th>
              </tr>
            </thead>
            <tbody>
              {savings.by_category.map((c, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--c-1e293b, #1e293b)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{c.category}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-94a3b8, #94a3b8)' }}>{c.count}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{fmtUsd(c.monthly_savings_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}
