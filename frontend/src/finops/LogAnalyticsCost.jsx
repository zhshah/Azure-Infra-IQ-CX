/**
 * Sentinel & Log Analytics cost — per-TABLE ingestion drill-down.
 *
 * Azure Cost Management stops at the workspace resource. This view goes one level
 * deeper: which TABLE inside each Log Analytics / Sentinel workspace is consuming
 * ingestion, how many billable GB, and what share of the workspace bill it carries.
 *
 * Cost per table is an ALLOCATION (workspace spend apportioned by billable-GB
 * share) because Azure does not invoice per table. The basis is shown explicitly
 * so the number is never mistaken for a billed figure.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts'
import {
  RefreshCw, AlertCircle, Database, Shield, Info, HardDrive, DollarSign, Layers,
} from 'lucide-react'
import { fmtUsd, CHART_COLORS } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'

const PALETTE = CHART_COLORS && CHART_COLORS.length
  ? CHART_COLORS
  : ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']

const card = {
  background: 'var(--c-0f172a, #0f172a)',
  border: '1px solid var(--c-1e293b, #1e293b)',
  borderRadius: 10,
  padding: 16,
}

const BASIS_LABEL = {
  resource_meter: 'Workspace spend from Cost Management, split across tables by billable-GB share.',
  subscription_allocated: 'Workspace-level cost was unavailable, so subscription Log Analytics meters were split across workspaces and then across tables by billable-GB share.',
  none: 'No cost data collected yet — volumes are shown without cost.',
}

const fmtGb = (v) => {
  const n = Number(v || 0)
  if (n >= 1024) return `${(n / 1024).toFixed(2)} TB`
  if (n >= 1) return `${n.toFixed(2)} GB`
  return `${(n * 1024).toFixed(1)} MB`
}

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

function Section({ title, icon: Icon, children, note, right }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {Icon && <Icon size={15} style={{ color: '#3b82f6' }} />}
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--c-f1f5f9, #f1f5f9)' }}>{title}</h3>
        <div style={{ marginLeft: 'auto' }}>{right}</div>
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

function Badge({ children, color }) {
  return (
    <span style={{
      display: 'inline-block', borderRadius: 999, padding: '1px 7px', fontSize: 10,
      fontWeight: 600, color, border: `1px solid ${color}55`, background: `${color}18`,
    }}>{children}</span>
  )
}

const tooltipStyle = {
  contentStyle: {
    background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 8, fontSize: 12, color: '#f1f5f9',
  },
}

export default function LogAnalyticsCost() {
  const [days, setDays] = useState(30)
  const [workspaces, setWorkspaces] = useState(null)
  const [selected, setSelected] = useState('')
  const [tables, setTables] = useState(null)
  const [loading, setLoading] = useState(true)
  const [collecting, setCollecting] = useState(false)
  const [error, setError] = useState(null)
  const [warning, setWarning] = useState(null)

  const loadWorkspaces = useCallback(async () => {
    const r = await fetch(`/api/finops/log-analytics/workspaces?days=${days}`)
    if (!r.ok) throw new Error(`Workspaces API error ${r.status}`)
    return r.json()
  }, [days])

  const loadTables = useCallback(async (wsId) => {
    const q = new URLSearchParams({ days: String(days), top: '50' })
    if (wsId) q.set('workspace_id', wsId)
    const r = await fetch(`/api/finops/log-analytics/tables?${q}`)
    if (!r.ok) throw new Error(`Tables API error ${r.status}`)
    return r.json()
  }, [days])

  const load = useCallback(async (wsId) => {
    setLoading(true); setError(null)
    try {
      const [ws, tb] = await Promise.all([loadWorkspaces(), loadTables(wsId)])
      setWorkspaces(ws)
      setTables(tb)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [loadWorkspaces, loadTables])

  useEffect(() => { load(selected) }, [days])          // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (wsId) => {
    setSelected(wsId)
    setLoading(true); setError(null)
    try { setTables(await loadTables(wsId)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const collect = async () => {
    setCollecting(true); setError(null); setWarning(null)
    try {
      const r = await fetch(`/api/finops/log-analytics/collect?days=${days}`, { method: 'POST' })
      if (!r.ok) throw new Error(`Collection failed (${r.status})`)
      const res = await r.json()
      if (res.workspaces_unreadable > 0) {
        const names = (res.unreadable || []).map(u => u.workspace).join(', ')
        setWarning(`${res.workspaces_unreadable} of ${res.workspaces_found} workspaces could not be read`
          + (names ? ` (${names})` : '')
          + ' — the managed identity needs Monitoring Reader or Log Analytics Reader on them.')
      }
      await load(selected)
    } catch (e) { setError(e.message) }
    finally { setCollecting(false) }
  }

  const rows = tables?.tables || []
  const billableRows = useMemo(() => rows.filter(t => !t.is_free), [rows])

  const chartData = useMemo(
    () => billableRows.slice(0, 12).map(t => ({
      name: t.table_name.length > 22 ? `${t.table_name.slice(0, 21)}…` : t.table_name,
      full: t.table_name,
      cost: t.allocated_cost_usd,
      gb: t.billable_gb,
    })),
    [billableRows],
  )

  const trendData = useMemo(() => {
    const byDate = {}
    for (const p of (tables?.trend || [])) {
      byDate[p.date] = byDate[p.date] || { date: p.date }
      byDate[p.date][p.table_name] = p.billable_gb
    }
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
  }, [tables])

  const trendSeries = useMemo(
    () => [...new Set((tables?.trend || []).map(p => p.table_name))].slice(0, 6),
    [tables],
  )

  const totalGb = tables?.total_gb || 0
  const totalUsd = tables?.total_usd || 0
  const basis = tables?.cost_basis || 'none'
  const wsList = workspaces?.workspaces || []
  const sentinelCount = wsList.filter(w => w.sentinel_enabled).length

  const csv = async () => {
    const head = ['Table', 'Billable GB', 'Non-billable GB', 'Allocated cost USD', '% of cost', '$/GB', 'Sentinel', 'Free tier']
    const body = rows.map(t => [
      t.table_name, t.billable_gb, t.non_billable_gb, t.allocated_cost_usd,
      t.pct_of_cost, t.cost_per_gb_usd, t.is_sentinel ? 'Yes' : 'No', t.is_free ? 'Yes' : 'No',
    ])
    const text = [head, ...body]
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `sentinel-log-analytics-tables-${days}d.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const report = useMemo(() => ({
    title: 'Sentinel & Log Analytics — cost by table',
    kpis: [
      { label: 'Workspaces', value: String(wsList.length) },
      { label: 'Billable volume', value: fmtGb(totalGb) },
      { label: 'Allocated cost', value: fmtUsd(totalUsd) },
      { label: 'Effective $/GB', value: totalGb ? fmtUsd(totalUsd / totalGb) : '—' },
    ],
    tables: [{
      title: `Top tables by allocated cost (last ${days} days)`,
      columns: ['Table', 'Billable GB', 'Allocated cost', '% of cost', '$/GB'],
      rows: rows.slice(0, 40).map(t => [
        t.table_name, t.billable_gb.toFixed(2), fmtUsd(t.allocated_cost_usd),
        `${t.pct_of_cost}%`, fmtUsd(t.cost_per_gb_usd),
      ]),
    }],
    aiSummary: BASIS_LABEL[basis] || '',
  }), [wsList, rows, totalGb, totalUsd, basis, days])

  if (loading && !tables) {
    return <div style={{ padding: 24, color: 'var(--c-94a3b8, #94a3b8)', fontSize: 13 }}>Loading Log Analytics cost…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          style={{ background: 'var(--c-0f172a, #0f172a)', color: 'var(--c-f1f5f9, #f1f5f9)', border: '1px solid var(--c-1e293b, #1e293b)', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>

        <select
          value={selected}
          onChange={e => pick(e.target.value)}
          style={{ background: 'var(--c-0f172a, #0f172a)', color: 'var(--c-f1f5f9, #f1f5f9)', border: '1px solid var(--c-1e293b, #1e293b)', borderRadius: 6, padding: '6px 10px', fontSize: 12, minWidth: 240 }}
        >
          <option value="">All workspaces</option>
          {wsList.map(w => (
            <option key={w.workspace_id} value={w.workspace_id}>
              {w.workspace_name}{w.sentinel_enabled ? ' (Sentinel)' : ''}
            </option>
          ))}
        </select>

        <button
          onClick={collect}
          disabled={collecting}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: collecting ? 'default' : 'pointer', opacity: collecting ? 0.6 : 1 }}
        >
          <RefreshCw size={13} className={collecting ? 'animate-spin' : ''} />
          {collecting ? 'Collecting…' : 'Collect now'}
        </button>

        <div style={{ marginLeft: 'auto' }}>
          <FinOpsExportMenu view="sentinel-log-analytics" onCsv={csv} report={report} />
        </div>
      </div>

      {error && (
        <div style={{ ...card, borderColor: '#7f1d1d', display: 'flex', gap: 8, alignItems: 'center', color: '#fca5a5', fontSize: 12 }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {warning && (
        <div style={{ ...card, borderColor: '#78350f', display: 'flex', gap: 8, alignItems: 'flex-start', color: '#fcd34d', fontSize: 12 }}>
          <AlertCircle size={14} style={{ marginTop: 1, flexShrink: 0 }} /> {warning}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Kpi label="Workspaces" value={wsList.length} icon={Layers}
             sub={sentinelCount ? `${sentinelCount} with Sentinel` : 'No Sentinel detected'} />
        <Kpi label="Billable volume" value={fmtGb(totalGb)} icon={HardDrive} color="#06b6d4"
             sub={`Last ${days} days`} />
        <Kpi label="Allocated cost" value={fmtUsd(totalUsd)} icon={DollarSign} color="#22c55e"
             sub={basis === 'resource_meter' ? 'From workspace spend' : 'Derived'} />
        <Kpi label="Effective $/GB" value={totalGb ? fmtUsd(totalUsd / totalGb) : '—'} icon={Database}
             sub="Blended across tables" />
        <Kpi label="Tables billing" value={billableRows.length} icon={Database} color="#f59e0b"
             sub={`${rows.length - billableRows.length} free-tier`} />
      </div>

      {rows.length === 0 ? (
        <Section title="Cost by table" icon={Database}>
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--c-64748b, #64748b)', fontSize: 12 }}>
            <div style={{ marginBottom: 4 }}>No Log Analytics usage collected yet.</div>
            <div style={{ fontSize: 11 }}>
              Click <strong>Collect now</strong> to query each workspace&apos;s Usage table.
              This needs Monitoring Reader (or Log Analytics Reader) on the workspaces.
            </div>
          </div>
        </Section>
      ) : (
        <>
          <Section
            title="Top tables by allocated cost"
            icon={Database}
            note={BASIS_LABEL[basis]}
          >
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 130, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => fmtUsd(v)} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(v, n, p) => n === 'cost'
                    ? [fmtUsd(v), 'Allocated cost']
                    : [fmtGb(p?.payload?.gb), 'Billable volume']}
                  labelFormatter={(_, p) => p?.[0]?.payload?.full || ''}
                />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Section>

          {trendData.length > 1 && (
            <Section title="Daily ingestion trend — top tables" icon={HardDrive}
                     note="Billable GB per day. A step change here is usually a connector or rule change.">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `${v} GB`} />
                  <Tooltip {...tooltipStyle} formatter={v => fmtGb(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {trendSeries.map((s, i) => (
                    <Line key={s} type="monotone" dataKey={s} stroke={PALETTE[i % PALETTE.length]}
                          dot={false} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Section>
          )}

          <Section title={`All tables (${rows.length})`} icon={Layers}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--c-94a3b8, #94a3b8)', textAlign: 'left' }}>
                    {['Table', 'Billable', 'Allocated cost', '% of cost', '$/GB', ''].map((h, i) => (
                      <th key={h + i} style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b', textAlign: i > 0 && i < 5 ? 'right' : 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t, i) => (
                    <tr key={t.table_name} style={{ background: i % 2 ? 'transparent' : 'var(--c-111827, #111827)' }}>
                      <td style={{ padding: '7px 10px', color: 'var(--c-f1f5f9, #f1f5f9)' }}>{t.table_name}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: '#cbd5e1' }}>{fmtGb(t.billable_gb)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: t.allocated_cost_usd ? '#22c55e' : '#64748b' }}>
                        {t.is_free ? '—' : fmtUsd(t.allocated_cost_usd)}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: '#94a3b8' }}>{t.is_free ? '—' : `${t.pct_of_cost}%`}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: '#94a3b8' }}>{t.is_free ? '—' : fmtUsd(t.cost_per_gb_usd)}</td>
                      <td style={{ padding: '7px 10px', display: 'flex', gap: 5 }}>
                        {t.is_sentinel && <Badge color="#8b5cf6"><Shield size={9} style={{ verticalAlign: -1 }} /> Sentinel</Badge>}
                        {t.is_free && <Badge color="#22c55e">Free tier</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {wsList.length > 0 && (
            <Section title="Workspaces" icon={Layers}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: 'var(--c-94a3b8, #94a3b8)', textAlign: 'left' }}>
                      {['Workspace', 'Resource group', 'Tables', 'Billable', 'Cost', '$/GB', ''].map((h, i) => (
                        <th key={h + i} style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b', textAlign: i > 1 && i < 6 ? 'right' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {wsList.map((w, i) => (
                      <tr key={w.workspace_id}
                          onClick={() => pick(w.workspace_id)}
                          style={{ cursor: 'pointer', background: i % 2 ? 'transparent' : 'var(--c-111827, #111827)' }}>
                        <td style={{ padding: '7px 10px', color: 'var(--c-f1f5f9, #f1f5f9)' }}>{w.workspace_name}</td>
                        <td style={{ padding: '7px 10px', color: '#94a3b8' }}>{w.resource_group}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#cbd5e1' }}>{w.table_count}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#cbd5e1' }}>{fmtGb(w.billable_gb)}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#22c55e' }}>{fmtUsd(w.allocated_cost_usd)}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#94a3b8' }}>{fmtUsd(w.cost_per_gb_usd)}</td>
                        <td style={{ padding: '7px 10px' }}>
                          {w.sentinel_enabled && <Badge color="#8b5cf6"><Shield size={9} style={{ verticalAlign: -1 }} /> Sentinel</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <FinOpsAIPanel
            view="log-analytics-tables"
            title="AI analysis — ingestion cost"
            data={{
              period_days: days,
              cost_basis: basis,
              total_billable_gb: totalGb,
              total_allocated_cost_usd: totalUsd,
              workspaces: wsList.map(w => ({
                name: w.workspace_name, sentinel: w.sentinel_enabled,
                billable_gb: w.billable_gb, cost_usd: w.allocated_cost_usd,
                cost_per_gb_usd: w.cost_per_gb_usd,
              })),
              tables: rows.slice(0, 30).map(t => ({
                table: t.table_name, billable_gb: t.billable_gb,
                allocated_cost_usd: t.allocated_cost_usd, pct_of_cost: t.pct_of_cost,
                is_sentinel: t.is_sentinel, is_free: t.is_free,
              })),
            }}
          />
        </>
      )}
    </div>
  )
}
