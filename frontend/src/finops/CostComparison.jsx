/**
 * CostComparison — Advanced FinOps: period-over-period (this month vs last month).
 *
 * Groups spend by any dimension (subscription / resource group / resource type /
 * region / tag) and shows current vs prior month, the $ and % delta, and the
 * biggest risers / fallers. Every row drills into the underlying resources.
 *
 * A "project current month to full month" toggle scales the partial (MTD) current
 * month by day-of-month so the comparison is like-for-like against the full prior
 * month. Data: GET /api/finops/compare (+ /cost-resources for drill). No mock data.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  GitCompareArrows, RefreshCw, AlertCircle, TrendingUp, TrendingDown,
  ArrowRight, Info, Calendar,
} from 'lucide-react'
import { finopsApi, getFilterOptions, fmtUsd, fmtPct } from './finopsApi'
import { C } from './finopsTheme'
import { useDrill } from '../drill/DrillContext'
import SearchableSelect from '../components/shared/SearchableSelect'
import FinOpsExportMenu from './FinOpsExportMenu'

const DIMS = [
  { value: 'ResourceGroupName', label: 'Resource Group' },
  { value: 'SubscriptionId',    label: 'Subscription' },
  { value: 'ResourceType',      label: 'Resource Type' },
  { value: 'ResourceLocation',  label: 'Region' },
  { value: 'Tag',               label: 'Tag' },
]

function Kpi({ label, value, sub, Icon, color = C.accent }) {
  return (
    <div style={{ flex: 1, minWidth: 160, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: C.muted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</span>
        {Icon && <Icon size={15} style={{ color }} />}
      </div>
      <div style={{ color: C.text, fontSize: 21, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub != null && <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function CostComparison() {
  const { openResourceDrill } = useDrill()
  const [dimension, setDimension] = useState('ResourceGroupName')
  const [tagKey, setTagKey]   = useState('Application')
  const [tagKeys, setTagKeys] = useState([])
  const [projected, setProjected] = useState(false)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [drilling, setDrilling] = useState(null)
  const abortRef = useRef(null)

  useEffect(() => { getFilterOptions().then(o => setTagKeys(o.tag_keys || [])).catch(() => {}) }, [])

  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController(); abortRef.current = ctrl
    setLoading(true); setError(null)
    try {
      const res = await finopsApi.getCompare(dimension, dimension === 'Tag' ? tagKey : null, ctrl.signal)
      if (!ctrl.signal.aborted) setData(res)
    } catch (e) { if (e.name !== 'AbortError') setError(e.message) }
    finally { if (!ctrl.signal.aborted) setLoading(false) }
  }, [dimension, tagKey])

  useEffect(() => { load(); return () => { if (abortRef.current) abortRef.current.abort() } }, [load])

  const pf = data?.projection_factor || 1
  const rows = data?.rows || []
  const cur = (r) => projected ? +(r.current * pf).toFixed(2) : r.current
  const delta = (r) => +(cur(r) - r.prior).toFixed(2)

  const view = useMemo(() => {
    const rr = rows.map(r => ({ ...r, _cur: cur(r), _delta: delta(r) }))
    rr.sort((a, b) => Math.abs(b._delta) - Math.abs(a._delta))
    return rr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, projected, pf])

  const totalCur   = view.reduce((s, r) => s + r._cur, 0)
  const totalPrior = data?.total_prior || 0
  const totalDelta = totalCur - totalPrior
  const risers  = view.filter(r => r._delta > 0)
  const fallers = view.filter(r => r._delta < 0)
  const topRiser  = risers[0]
  const topFaller = [...fallers].sort((a, b) => a._delta - b._delta)[0]
  const maxAbs = Math.max(1, ...view.map(r => Math.abs(r._delta)))

  const tagKeyOptions = useMemo(() => {
    const base = ['Application', 'Workload', 'CostCenter', 'Environment', 'Project', 'Department', 'Owner', 'Team']
    return [...new Set([...base, ...(tagKeys || [])])].map(k => ({ value: k, label: k }))
  }, [tagKeys])

  const drill = useCallback(async (row) => {
    const params = { limit: 1000 }
    if (dimension === 'ResourceGroupName') params.resource_group = row.key
    else if (dimension === 'SubscriptionId') params.subscription_id = row.key
    else if (dimension === 'ResourceType') params.resource_type = row.key
    else if (dimension === 'ResourceLocation') params.region = row.key
    else if (dimension === 'Tag') { params.tag_key = tagKey; params.tag_value = row.key }
    setDrilling(row.key)
    try {
      const res = await finopsApi.getCostResources(params)
      openResourceDrill(`${row.value} — resources`, res.resources || [], { subtitle: `${res.count} resources · ${fmtUsd(res.total_cost)} this month` })
    } catch { /* ignore */ }
    finally { setDrilling(null) }
  }, [dimension, tagKey, openResourceDrill])

  const exportCsv = useCallback(async () => {
    const hdr = [DIMS.find(d => d.value === dimension)?.label || 'Value', 'Current (USD)', 'Prior (USD)', 'Delta (USD)', 'Delta %', 'Resources']
    const lines = [hdr.join(',')]
    for (const r of view) {
      lines.push([`"${(r.value || '').replace(/"/g, '""')}"`, r._cur, r.prior, r._delta, r.delta_pct, r.resource_count].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `azure-cost-comparison-${dimension}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
  }, [view, dimension])

  const report = useMemo(() => ({
    title: 'Azure Cost — Period-over-Period Comparison',
    kpis: [
      { label: projected ? 'Current (projected)' : 'Current (MTD)', value: fmtUsd(totalCur) },
      { label: 'Prior month', value: fmtUsd(totalPrior) },
      { label: 'Change', value: `${totalDelta >= 0 ? '+' : ''}${fmtUsd(totalDelta)}` },
      { label: 'Biggest riser', value: topRiser ? `${topRiser.value} (+${fmtUsd(topRiser._delta)})` : '—' },
    ],
    tables: [{
      title: `By ${DIMS.find(d => d.value === dimension)?.label || dimension}`,
      columns: ['Value', 'Current', 'Prior', 'Δ $', 'Δ %'],
      rows: view.slice(0, 60).map(r => [r.value, fmtUsd(r._cur), fmtUsd(r.prior), fmtUsd(r._delta), fmtPct(r.delta_pct)]),
    }],
  }), [view, totalCur, totalPrior, totalDelta, topRiser, projected, dimension])

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.text, fontSize: 22, fontWeight: 700, margin: 0 }}>
            <GitCompareArrows size={22} style={{ color: C.accent }} /> Cost Comparison
          </h1>
          <p style={{ color: C.muted, fontSize: 13, margin: '6px 0 0' }}>
            This month vs last month by any dimension — spot what changed and drill into the resources behind it.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={load} disabled={loading} style={{
            display: 'flex', alignItems: 'center', gap: 6, background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: '6px 12px', cursor: loading ? 'wait' : 'pointer', color: C.textDim, fontSize: 12, fontWeight: 600,
          }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <FinOpsExportMenu view="comparison" onCsv={exportCsv} report={report} />
        </div>
      </div>

      {/* Value explainer */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'rgba(59,130,246,0.07)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
        <Info size={16} style={{ color: C.accent, flexShrink: 0, marginTop: 1 }} />
        <span style={{ color: C.textDim, fontSize: 12.5, lineHeight: 1.5 }}>
          Compares this month against last month for any dimension (subscription, resource group, resource type, region or tag). Use it in monthly cost reviews to answer <b style={{ color: C.text }}>“what changed and why”</b> — biggest risers and savers are ranked, and every row drills into the exact resources behind the change. Toggle <b style={{ color: C.text }}>Projected full month</b> for a like-for-like comparison; export to CSV or a branded PDF.
        </span>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ minWidth: 200 }}>
          <SearchableSelect options={DIMS} value={dimension} onChange={setDimension} placeholder="Group by…" />
        </div>
        {dimension === 'Tag' && (
          <div style={{ minWidth: 190 }}>
            <SearchableSelect options={tagKeyOptions} value={tagKey} onChange={setTagKey} placeholder="Tag key…" />
          </div>
        )}
        <button onClick={() => setProjected(p => !p)} title="Scale the partial current month up to a full month for a like-for-like comparison"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: projected ? C.accentDim : C.surface,
            border: `1px solid ${projected ? C.accent : C.border}`, borderRadius: 6, padding: '7px 12px',
            cursor: 'pointer', color: projected ? C.text : C.textDim, fontSize: 12, fontWeight: 600,
          }}>
          <Calendar size={13} /> {projected ? 'Projected full month' : 'MTD (actual)'}
        </button>
        {data && (
          <span style={{ color: C.muted, fontSize: 11 }}>
            <Info size={11} style={{ display: 'inline', marginRight: 3 }} />
            Day {data.day_of_month}/{data.days_in_month}{projected ? ` · ×${pf.toFixed(2)} projection` : ''}
          </span>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Kpi label={projected ? 'Current (projected)' : 'Current (MTD)'} value={loading ? '…' : fmtUsd(totalCur)} Icon={TrendingUp} />
        <Kpi label="Prior month" value={loading ? '…' : fmtUsd(totalPrior)} color={C.muted} />
        <Kpi label="Change" value={loading ? '…' : `${totalDelta >= 0 ? '+' : ''}${fmtUsd(totalDelta)}`} color={totalDelta > 0 ? C.red : C.green} Icon={totalDelta > 0 ? TrendingUp : TrendingDown}
          sub={totalPrior > 0 ? `${totalDelta >= 0 ? '+' : ''}${fmtPct(totalDelta / totalPrior * 100)}` : ''} />
        <Kpi label="Biggest riser" value={loading ? '…' : (topRiser ? `+${fmtUsd(topRiser._delta)}` : '—')} color={C.red} Icon={TrendingUp} sub={topRiser?.value} />
        <Kpi label="Biggest saver" value={loading ? '…' : (topFaller ? fmtUsd(topFaller._delta) : '—')} color={C.green} Icon={TrendingDown} sub={topFaller?.value} />
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 16 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>
          <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 10px' }} /> Loading comparison…
        </div>
      ) : view.length === 0 ? (
        <div style={{ padding: 50, textAlign: 'center', color: C.muted, background: C.surface2, border: `1px dashed ${C.border}`, borderRadius: 12 }}>
          <Info size={22} style={{ margin: '0 auto 8px' }} />
          No cost data yet. Load your Azure resources (run a scan on the dashboard) — comparison uses current vs previous month cost.
        </div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.surface2, color: C.muted, textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', fontWeight: 600 }}>{DIMS.find(d => d.value === dimension)?.label}</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>{projected ? 'Projected' : 'Current (MTD)'}</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>Prior month</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'center' }}>Change</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>Δ %</th>
                <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {view.map((r, i) => {
                const up = r._delta > 0
                const barW = Math.abs(r._delta) / maxAbs * 100
                const color = up ? C.red : C.green
                return (
                  <tr key={r.key || i} onClick={() => drill(r)} style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = C.surface2}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '9px 14px', color: C.text, fontWeight: 600 }}>
                      {r.value}
                      <span style={{ color: C.muted, fontWeight: 400, fontSize: 11 }}> · {r.resource_count} res</span>
                    </td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: C.text }}>{fmtUsd(r._cur)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: C.textDim }}>{fmtUsd(r.prior)}</td>
                    <td style={{ padding: '9px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, display: 'flex', justifyContent: up ? 'flex-start' : 'flex-end' }}>
                          <div style={{ width: `${barW}%`, height: 8, background: color, borderRadius: 3, minWidth: r._delta !== 0 ? 2 : 0 }} />
                        </div>
                        <span style={{ color, fontSize: 12, fontWeight: 600, minWidth: 78, textAlign: 'right' }}>
                          {up ? '+' : ''}{fmtUsd(r._delta)}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color, fontWeight: 600 }}>
                      {up ? '+' : ''}{fmtPct(r.delta_pct)}
                    </td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                      {drilling === r.key
                        ? <RefreshCw size={13} className="animate-spin" style={{ color: C.muted }} />
                        : <ArrowRight size={14} style={{ color: C.muted }} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ color: C.muted, fontSize: 11, marginTop: 12 }}>
        Current-month figures are month-to-date from the live resource cost cache; prior is the full previous month.
        Use “Projected full month” for a like-for-like comparison. Click any row to drill into its resources.
      </p>
    </div>
  )
}
