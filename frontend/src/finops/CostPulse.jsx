/**
 * Cost Pulse — the interactive, scrubbable FinOps explorer.
 *
 * Every control re-queries the WAREHOUSE (finops_daily_dimension_costs), not live Cost
 * Management, so dragging the period feels instant. Live Cost Management is throttled
 * (sustained 429s, 40-180s per call) and would make scrubbing unusable.
 *
 * Deliberately 2D: 3D perspective distorts financial comparison (occlusion +
 * foreshortening make bars uncomparable), so depth here comes from gradients, layered
 * shadows and motion instead of WebGL — and it adds no bundle weight.
 *
 * Rules of Hooks: every hook is declared unconditionally before any early return.
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'
import {
  Activity, Play, Pause, Layers, TrendingUp, BarChart3, LineChart as LineIcon,
  Sparkles, RefreshCw, CalendarRange, SkipBack, Flame, X,
} from 'lucide-react'
import { finopsApi, fmtUsd, CHART_COLORS } from './finopsApi'
import FinOpsScopeBar, { scopeExportRows } from './FinOpsScopeBar'
import FinOpsExportMenu from './FinOpsExportMenu'
import FinOpsAIPanel from './FinOpsAIPanel'

const glass = {
  background: 'linear-gradient(160deg, rgba(23,33,54,.92), rgba(13,19,33,.92))',
  border: '1px solid var(--c-1e293b)',
  borderRadius: 14,
  padding: 16,
  boxShadow: '0 1px 0 rgba(255,255,255,.03) inset, 0 10px 30px -12px rgba(0,0,0,.6)',
}
const miniLabel = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }

const COST_TYPES = [{ v: 'actual', l: 'Actual' }, { v: 'amortized', l: 'Amortized' }]
const MODES = [
  { v: 'stack', l: 'Composition', icon: Layers },
  { v: 'trend', l: 'Trend',       icon: LineIcon },
  { v: 'bars',  l: 'Daily',       icon: BarChart3 },
]

// The warehouse is a fixed historical window, so the scrubber anchors to the last day
// of collected data rather than "today" — otherwise short windows land on empty dates.
const isoDay = (d) => d.toISOString().slice(0, 10)
const shiftDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return isoDay(d)
}
const PRESETS = [7, 14, 30, 60, 90, 180]

/** Count-up so KPI changes read as motion rather than a jump. */
function useCountUp(target, ms = 550) {
  const [v, setV] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const to = Number(target || 0)
    if (from === to) return undefined
    let raf = 0
    const t0 = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      setV(from + (to - from) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

function Kpi({ label, value, sub, tone = 'var(--c-e2e8f0)', money = true }) {
  const n = useCountUp(value)
  return (
    <div className="pulse-card" style={{ ...glass, flex: 1, minWidth: 165, padding: '13px 16px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(120% 80% at 0% 0%, ${tone}14, transparent 60%)`, pointerEvents: 'none' }} />
      <div style={miniLabel}>{label}</div>
      <div style={{ color: tone, fontSize: 23, fontWeight: 800, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>
        {money ? fmtUsd(n) : `${n.toFixed(1)}%`}
      </div>
      {sub && <div style={{ color: 'var(--c-64748b)', fontSize: 10.5, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Stat({ label, value, hint, tone = 'var(--c-e2e8f0)' }) {
  return (
    <div>
      <div style={miniLabel}>{label}</div>
      <div style={{ color: tone, fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{value}</div>
      {hint && <div style={{ color: 'var(--c-64748b)', fontSize: 10.5, marginTop: 1 }}>{hint}</div>}
    </div>
  )
}

export default function CostPulse() {
  const [meta, setMeta]         = useState(null)
  const [dim, setDim]           = useState('service_name')
  const [costType, setCostType] = useState('actual')
  const [mode, setMode]         = useState('stack')
  const [days, setDays]         = useState(30)
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [hoverKey, setHoverKey] = useState(null)
  const [playing, setPlaying]   = useState(false)
  const [speed, setSpeed]       = useState(220)   // ms per DAY of playback
  // Playback is a cursor over the loaded period, not a change of period. -1 = whole
  // window shown. `selected` is the day the user drilled into.
  const [playhead, setPlayhead] = useState(-1)
  const [selected, setSelected] = useState(null)
  const [subFilter, setSubFilter] = useState('')  // '' = all configured subscriptions
  const abortRef = useRef(null)
  const reqSeqRef = useRef(0)

  useEffect(() => {
    let dead = false
    finopsApi.getAnalyzeMeta()
      .then(m => { if (!dead) setMeta(m) })
      .catch(() => {})
    return () => { dead = true }
  }, [])

  // Anchor the window to the newest day the warehouse actually holds. Falls back to
  // today until /analyze/meta resolves, then refetches with the correct anchor.
  const anchor   = meta?.coverage?.date_to || isoDay(new Date())
  const dateTo   = anchor
  const dateFrom = shiftDays(anchor, -(days - 1))

  // Never let the scrubber run past the data we actually hold.
  const maxDays = (() => {
    const a = meta?.coverage?.date_from, b = meta?.coverage?.date_to
    if (!a || !b) return 180
    const span = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1
    return Math.max(7, Math.min(span, 400))
  })()

  // Debounced so dragging the scrubber does not fire a request per pixel.
  useEffect(() => {
    const id = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      // Responses can land out of order (abort does not guarantee the in-flight one
      // is dropped), which showed the previous dimension's data under the new title.
      const seq = ++reqSeqRef.current
      setLoading(true); setError(null)
      finopsApi.analyze({
        group_by: dim, date_from: dateFrom, date_to: dateTo, cost_type: costType,
        ...(subFilter ? { subscription_ids: [subFilter] } : {}),
      }, ctrl.signal)
        .then(r => { if (seq === reqSeqRef.current) setData(r) })
        .catch(e => { if (e.name !== 'AbortError' && seq === reqSeqRef.current) setError(e.message) })
        .finally(() => { if (seq === reqSeqRef.current) setLoading(false) })
    }, 220)
    return () => clearTimeout(id)
  }, [dim, dateFrom, dateTo, costType, subFilter])

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort() }, [])

  const keys     = useMemo(() => (data?.series_keys || []).slice(0, 14), [data])
  // Stable references — the playback memos below key off these every frame.
  const stacked  = useMemo(() => data?.stacked || [], [data])
  const series   = useMemo(() => data?.series || [], [data])
  const dayCount = series.length

  // A new window invalidates any cursor into the old one.
  useEffect(() => { setPlaying(false); setPlayhead(-1); setSelected(null) }, [dim, dateFrom, dateTo, costType, subFilter])

  // Play walks a cursor from the first day of the chosen period to the last. It never
  // changes the period and never re-queries — the whole window is already loaded, so
  // playback is smooth instead of firing a request per frame.
  useEffect(() => {
    if (!playing || dayCount === 0) return undefined
    const id = setTimeout(() => {
      const next = (playhead < 0 ? 0 : playhead) + 1
      if (next >= dayCount - 1) {
        setPlayhead(dayCount - 1)
        setPlaying(false)
        setSelected(dayCount - 1)   // land on the final day with the drill-down open
      } else {
        setPlayhead(next)
      }
    }, speed)
    return () => clearTimeout(id)
  }, [playing, playhead, dayCount, speed])

  const cursor = playhead < 0 || playhead >= dayCount - 1 ? dayCount - 1 : playhead
  const atEnd  = cursor >= dayCount - 1

  const startPlay = () => {
    if (dayCount === 0) return
    setSelected(null)
    setPlayhead(atEnd ? 0 : cursor)   // replay from the top once it has finished
    setPlaying(true)
  }

  const breakdown = data?.breakdown || []
  const total    = Number(data?.total_cost || 0)
  const dailyAvg = series.length ? total / series.length : 0
  const peak     = series.reduce((m, s) => (Number(s.cost || 0) > Number(m?.cost || 0) ? s : m), null)

  // Spend revealed so far — what the KPI row reports while the cursor is mid-window.
  const spendToCursor = useMemo(
    () => series.slice(0, cursor + 1).reduce((s, x) => s + Number(x.cost || 0), 0),
    [series, cursor])

  // Freeze the axes to the FULL window so playback reveals the shape instead of
  // rescaling under the viewer — a moving y-axis makes days look comparable when
  // they are not. Values past the cursor become null, which stops the line/area.
  const yMax = useMemo(() => {
    if (!stacked.length) return undefined
    let m = 0
    for (const row of stacked) {
      let s = 0
      for (const k of keys) s += Number(row[k] || 0)
      if (s > m) m = s
    }
    for (const s of series) m = Math.max(m, Number(s.cost || 0))
    return m > 0 ? Math.ceil(m * 1.08) : undefined
  }, [stacked, series, keys])

  const blank = (row, fields) => {
    const out = { date: row.date }
    for (const f of fields) out[f] = null
    return out
  }
  const stackedView = useMemo(
    () => (atEnd ? stacked : stacked.map((r, i) => (i <= cursor ? r : blank(r, keys)))),
    [stacked, keys, cursor, atEnd])
  const seriesView = useMemo(
    () => (atEnd ? series : series.map((r, i) => (i <= cursor ? r : blank(r, ['cost', 'accumulated'])))),
    [series, cursor, atEnd])

  // ── Drill-down: everything known about one day ────────────────────────────
  const selectDay = useCallback((i) => {
    if (i == null || i < 0 || i >= dayCount) return
    setPlaying(false)
    setPlayhead(i)
    setSelected(i)
  }, [dayCount])

  // First half vs second half of the window — a direction the eye can trust.
  const trendPct = useMemo(() => {
    if (series.length < 4) return 0
    const half = Math.floor(series.length / 2)
    const a = series.slice(0, half).reduce((s, x) => s + Number(x.cost || 0), 0)
    const b = series.slice(half).reduce((s, x) => s + Number(x.cost || 0), 0)
    return a > 0 ? ((b - a) / a) * 100 : 0
  }, [series])

  const colorOf = useCallback((i) => CHART_COLORS[i % CHART_COLORS.length], [])
  // Grouping by subscription returns GUIDs; the response's scope block carries the names.
  const keyLabel = useCallback((k) => {
    const subs = data?.scope?.subscriptions
    if (!Array.isArray(subs)) return k
    const hit = subs.find(s => String(s.id).toLowerCase() === String(k).toLowerCase())
    return hit?.name || k
  }, [data])
  // Label from the DATA's own grouping, never from local state — otherwise a lagging
  // response renders the previous dimension's bars under the new dimension's title.
  const dimLabel = (meta?.dimensions || []).find(d => d.value === (data?.group_by || dim))?.label
    || (data?.group_by || dim)

  // Everything known about the day the user stopped on.
  const dayDetail = useMemo(() => {
    if (selected == null || !series[selected]) return null
    const row  = series[selected]
    const cost = Number(row.cost || 0)
    const prev = selected > 0 ? Number(series[selected - 1].cost || 0) : null
    const st   = stacked[selected] || {}
    const parts = keys
      .map(k => ({ key: k, label: keyLabel(k), cost: Number(st[k] || 0) }))
      .filter(p => p.cost > 0)
      .sort((a, b) => b.cost - a.cost)
    const cum = series.slice(0, selected + 1).reduce((s, x) => s + Number(x.cost || 0), 0)
    // Flag a day the eye should not skip: well above this window's own daily mean.
    const sd = series.length
      ? Math.sqrt(series.reduce((s, x) => s + Math.pow(Number(x.cost || 0) - dailyAvg, 2), 0) / series.length)
      : 0
    return {
      idx: selected, date: row.date, cost, parts,
      deltaAbs: prev == null ? null : cost - prev,
      deltaPct: prev ? ((cost - prev) / prev) * 100 : null,
      vsAvgPct: dailyAvg ? ((cost - dailyAvg) / dailyAvg) * 100 : null,
      cumulative: cum,
      shareOfPeriod: total ? (cum / total) * 100 : 0,
      spike: sd > 0 && cost > dailyAvg + 2 * sd,
    }
  }, [selected, series, stacked, keys, keyLabel, dailyAvg, total])

  // Provenance comes from the API (it resolves real subscription names); the local
  // shape is only a fallback for older builds that predate the scope block.
  const scope = useMemo(() => {
    if (!data) return null
    if (data.scope) {
      return { ...data.scope, source: `${data.scope.source} · showing ${dimLabel}` }
    }
    return {
      subscriptions: (data.subscription_ids || []).map(id => ({ id, name: id })),
      resource_groups: data.resource_group || 'All resource groups (no filter applied)',
      period: `${data.date_from} → ${data.date_to} (${series.length} days)`,
      currency: data.currency || 'USD',
      source: `${data.data_source === 'warehouse' ? 'Cost warehouse' : data.data_source} · ${costType} cost · grouped by ${dimLabel}`,
      generated_at: data.generated_at,
    }
  }, [data, series, costType, dimLabel])

  const csv = () => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Date', ...keys]
    const body = stacked.map(row => [row.date, ...keys.map(k => row[k] ?? 0)])
    const provenance = scopeExportRows(scope).map(r => [r[0], r[1], ...keys.slice(1).map(() => '')])
    const text = [...provenance, [], head, ...body].map(r => r.map(esc).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `cost-pulse-${dim}-${days}d-${costType}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const chartHeight = 330
  const dimOn = (k) => !hoverKey || hoverKey === k

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Hero header */}
      <div className="pulse-hero" style={{
        ...glass, padding: '18px 20px', position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(105deg, rgba(10,16,32,.96), rgba(18,35,61,.96) 45%, rgba(11,63,117,.9))',
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', opacity: .5,
          backgroundImage: 'linear-gradient(rgba(148,163,184,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.07) 1px, transparent 1px)',
          backgroundSize: '34px 34px',
          maskImage: 'linear-gradient(105deg, #000, transparent 72%)',
          WebkitMaskImage: 'linear-gradient(105deg, #000, transparent 72%)',
        }} />
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ color: 'var(--c-f8fafc)', fontSize: 21, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 9, letterSpacing: -0.3 }}>
              <Activity size={20} style={{ color: '#38bdf8' }} /> Cost Pulse
            </h2>
            <p style={{ color: 'var(--c-94a3b8)', fontSize: 12, margin: '5px 0 0', maxWidth: 640 }}>
            Answers <strong style={{ color: '#e2e8f0' }}>&ldquo;what changed, and when?&rdquo;</strong> &mdash; the only FinOps view
            that replays a period. Pick how far back to look, hit Play to watch the spend build from the
            first day to the last, then stop on any day to see what drove it. Served from the cost
            warehouse, so scrubbing is instant and never rate-limited.
            {' '}{meta?.coverage?.rows
                ? `${meta.coverage.rows.toLocaleString()} daily rows from ${meta.coverage.date_from} to ${meta.coverage.date_to}.`
                : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {loading && <RefreshCw size={13} className="animate-spin" style={{ color: 'var(--c-38bdf8)' }} />}
            <FinOpsExportMenu
              view="cost-pulse"
              onCsv={csv}
              report={{
                title: `Cost Pulse — ${dimLabel} (${days}d, ${costType})`,
                kpis: [
                  { label: 'Total', value: fmtUsd(total) },
                  { label: 'Daily average', value: fmtUsd(dailyAvg) },
                  { label: 'Peak day', value: peak ? `${fmtUsd(peak.cost)} on ${peak.date}` : '—' },
                  { label: 'Trend (2nd half vs 1st)', value: `${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(1)}%` },
                ],
                tables: [{
                  title: `Cost by ${dimLabel}`,
                  columns: [dimLabel, 'Cost (USD)', '% of total'],
                  rows: breakdown.map(b => [keyLabel(b.key), fmtUsd(b.cost), total ? `${((b.cost / total) * 100).toFixed(1)}%` : '—']),
                }],
              }} />
          </div>
        </div>
      </div>

      {scope && <FinOpsScopeBar scope={scope} />}

      {error && (
        <div className="pulse-card" style={{ ...glass, borderColor: 'var(--c-7f1d1d)', color: 'var(--c-fca5a5)', fontSize: 12 }}>{error}</div>
      )}

      {/* Controls */}
      <div className="pulse-card" style={{ ...glass, display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div style={miniLabel}>Group by</div>
            <div style={{ display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
              {(meta?.dimensions || []).map(d => (
                <button key={d.value} onClick={() => setDim(d.value)} style={{
                  fontSize: 11, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', transition: 'all .18s',
                  background: dim === d.value ? 'linear-gradient(135deg,#1d4ed8,#0ea5e9)' : 'var(--c-0f172a)',
                  border: `1px solid ${dim === d.value ? '#38bdf8' : 'var(--c-1e293b)'}`,
                  color: dim === d.value ? '#fff' : 'var(--c-94a3b8)',
                  boxShadow: dim === d.value ? '0 4px 14px -4px rgba(56,189,248,.6)' : 'none',
                }}>{d.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={miniLabel}>Cost type</div>
            <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
              {COST_TYPES.map(c => (
                <button key={c.v} onClick={() => setCostType(c.v)} style={{
                  fontSize: 11, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', transition: 'all .18s',
                  background: costType === c.v ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : 'var(--c-0f172a)',
                  border: `1px solid ${costType === c.v ? '#a855f7' : 'var(--c-1e293b)'}`,
                  color: costType === c.v ? '#fff' : 'var(--c-94a3b8)',
                }}>{c.l}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={miniLabel}>View</div>
            <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
              {MODES.map(m => {
                const Icon = m.icon
                return (
                  <button key={m.v} onClick={() => setMode(m.v)} title={m.l} style={{
                    display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '5px 11px',
                    borderRadius: 999, cursor: 'pointer', transition: 'all .18s',
                    background: mode === m.v ? 'var(--c-1e293b)' : 'var(--c-0f172a)',
                    border: `1px solid ${mode === m.v ? '#64748b' : 'var(--c-1e293b)'}`,
                    color: mode === m.v ? 'var(--c-e2e8f0)' : 'var(--c-94a3b8)',
                  }}><Icon size={12} /> {m.l}</button>
                )
              })}
            </div>
          </div>

          {/* Scope — which subscription these numbers cover */}
          <div>
            <div style={miniLabel}>Scope</div>
            <select
              value={subFilter}
              onChange={e => { setPlaying(false); setSubFilter(e.target.value) }}
              style={{
                marginTop: 6, fontSize: 11, padding: '5px 9px', borderRadius: 999,
                background: subFilter ? 'var(--c-1e293b)' : 'var(--c-0f172a)',
                border: `1px solid ${subFilter ? '#38bdf8' : 'var(--c-1e293b)'}`,
                color: subFilter ? 'var(--c-e2e8f0)' : 'var(--c-94a3b8)', cursor: 'pointer',
              }}>
              <option value="">All subscriptions</option>
              {(data?.scope?.subscriptions || []).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Period — how far back to review. Play never changes this. */}
        <div style={{ borderTop: '1px solid var(--c-1e293b)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ ...miniLabel, display: 'flex', alignItems: 'center', gap: 5 }}>
              <CalendarRange size={12} style={{ color: '#38bdf8' }} /> Period to review — last {days} days
            </div>
            <span style={{ color: 'var(--c-64748b)', fontSize: 10.5 }}>{dateFrom} → {dateTo}</span>
            <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
              {PRESETS.filter(p => p <= maxDays).map(p => (
                <button key={p} onClick={() => setDays(p)} style={{
                  fontSize: 10.5, padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                  background: days === p ? 'var(--c-1e293b)' : 'transparent',
                  border: `1px solid ${days === p ? '#64748b' : 'var(--c-1e293b)'}`,
                  color: days === p ? 'var(--c-e2e8f0)' : 'var(--c-64748b)',
                }}>{p}d</button>
              ))}
            </div>
          </div>
          <input
            type="range" min={7} max={maxDays} step={1} value={days}
            onChange={e => setDays(Number(e.target.value))}
            style={{ width: '100%', accentColor: '#38bdf8', marginTop: 9, cursor: 'ew-resize' }} />
        </div>

        {/* Timeline — replays the chosen period day by day, first day to last. */}
        <div style={{ borderTop: '1px solid var(--c-1e293b)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => (playing ? setPlaying(false) : startPlay())}
              disabled={dayCount === 0}
              title={playing ? 'Pause' : 'Replay the period day by day from the first day'}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 12px', borderRadius: 999,
                cursor: dayCount === 0 ? 'not-allowed' : 'pointer', background: playing ? '#0e7490' : 'var(--c-0f172a)',
                border: `1px solid ${playing ? '#22d3ee' : 'var(--c-1e293b)'}`,
                color: playing ? '#fff' : 'var(--c-94a3b8)', opacity: dayCount === 0 ? 0.5 : 1,
              }}>
              {playing ? <Pause size={11} /> : <Play size={11} />} {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
            </button>
            <button onClick={() => { setPlaying(false); setPlayhead(-1); setSelected(null) }}
              title="Back to the whole period"
              style={{
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, padding: '4px 10px', borderRadius: 999,
                cursor: 'pointer', background: 'transparent', border: '1px solid var(--c-1e293b)', color: 'var(--c-64748b)',
              }}>
              <SkipBack size={10} /> Full period
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Playback speed">
              <span style={{ ...miniLabel, fontSize: 9 }}>Speed</span>
              {[[500, '2 d/s'], [220, '4 d/s'], [110, '9 d/s'], [45, '22 d/s']].map(([ms, l]) => (
                <button key={ms} onClick={() => setSpeed(ms)} style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 6, cursor: 'pointer',
                  background: speed === ms ? 'var(--c-1e293b)' : 'transparent',
                  border: `1px solid ${speed === ms ? '#38bdf8' : 'var(--c-1e293b)'}`,
                  color: speed === ms ? 'var(--c-e2e8f0)' : 'var(--c-64748b)',
                }}>{l}</button>
              ))}
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ color: 'var(--c-e2e8f0)', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {series[cursor]?.date || '—'}
              </span>
              <span style={{ color: 'var(--c-64748b)', fontSize: 10.5 }}>
                day {dayCount ? cursor + 1 : 0} of {dayCount}
              </span>
            </div>
          </div>
          <input
            type="range" min={0} max={Math.max(dayCount - 1, 0)} step={1} value={cursor}
            disabled={dayCount === 0}
            onChange={e => selectDay(Number(e.target.value))}
            title="Scrub to a day — release to drill into it"
            style={{ width: '100%', accentColor: '#22d3ee', marginTop: 9, cursor: 'ew-resize' }} />
          <div style={{ color: 'var(--c-64748b)', fontSize: 10, marginTop: 2 }}>
            Scrub or click any day on the chart to drill into it.
          </div>
        </div>
      </div>

      {/* KPIs — cumulative figures follow the cursor, so they always match the chart. */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi label={atEnd ? `Total — last ${days}d` : `Spend to ${series[cursor]?.date || ''}`}
          value={atEnd ? total : spendToCursor} tone="#38bdf8"
          sub={atEnd ? `${series.length} days of warehouse data`
                     : `${((spendToCursor / (total || 1)) * 100).toFixed(0)}% of ${fmtUsd(total)} period total`} />
        <Kpi label="Daily average" value={dailyAvg} tone="#a855f7" sub="mean daily burn in window" />
        <Kpi label="Peak day" value={peak?.cost || 0} tone="#f59e0b" sub={peak ? peak.date : '—'} />
        <Kpi label="Trend" value={trendPct} money={false} tone={trendPct > 0 ? '#ef4444' : '#22c55e'}
          sub="2nd half vs 1st half of window" />
      </div>

      {/* Day drill-down */}
      {dayDetail && (
        <div className="pulse-card" style={{ ...glass, borderColor: dayDetail.spike ? '#f59e0b' : 'var(--c-1e293b)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10, flexWrap: 'wrap' }}>
            <CalendarRange size={15} style={{ color: '#22d3ee' }} />
            <span style={{ color: 'var(--c-e2e8f0)', fontSize: 13.5, fontWeight: 700 }}>{dayDetail.date}</span>
            {dayDetail.spike && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '2px 8px', borderRadius: 999,
                background: 'rgba(245,158,11,.14)', border: '1px solid #f59e0b', color: '#fbbf24',
              }}><Flame size={10} /> Spike — more than 2σ above this window&rsquo;s daily mean</span>
            )}
            <button onClick={() => setSelected(null)} title="Close"
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--c-64748b)', display: 'flex' }}>
              <X size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat label="Spend on this day" value={fmtUsd(dayDetail.cost)} tone="#38bdf8" />
            <Stat label="vs previous day"
              value={dayDetail.deltaAbs == null ? '—'
                : `${dayDetail.deltaAbs >= 0 ? '+' : '−'}${fmtUsd(Math.abs(dayDetail.deltaAbs))}`}
              hint={dayDetail.deltaPct == null ? 'first day in window' : `${dayDetail.deltaPct >= 0 ? '+' : ''}${dayDetail.deltaPct.toFixed(1)}%`}
              tone={dayDetail.deltaAbs == null ? 'var(--c-94a3b8)' : dayDetail.deltaAbs >= 0 ? '#ef4444' : '#22c55e'} />
            <Stat label="vs daily average"
              value={dayDetail.vsAvgPct == null ? '—' : `${dayDetail.vsAvgPct >= 0 ? '+' : ''}${dayDetail.vsAvgPct.toFixed(1)}%`}
              hint={`window mean ${fmtUsd(dailyAvg)}`}
              tone={(dayDetail.vsAvgPct || 0) >= 0 ? '#f59e0b' : '#22c55e'} />
            <Stat label="Cumulative to date" value={fmtUsd(dayDetail.cumulative)}
              hint={`${dayDetail.shareOfPeriod.toFixed(0)}% of period total`} tone="#a855f7" />
          </div>
          <div style={{ ...miniLabel, marginBottom: 6 }}>What drove it — by {dimLabel}</div>
          {dayDetail.parts.length === 0 ? (
            <div style={{ color: 'var(--c-64748b)', fontSize: 11.5 }}>No attributed cost on this day.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dayDetail.parts.slice(0, 10).map((p) => {
                const share = dayDetail.cost ? (p.cost / dayDetail.cost) * 100 : 0
                const ci = keys.indexOf(p.key)
                return (
                  <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 190, color: 'var(--c-cbd5e1)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.label}>{p.label}</div>
                    <div style={{ flex: 1, height: 8, background: 'var(--c-0f172a)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.max(share, 0.6)}%`, height: '100%', borderRadius: 999,
                        background: `linear-gradient(90deg, ${colorOf(ci)}, ${colorOf(ci)}99)`,
                      }} />
                    </div>
                    <div style={{ width: 92, textAlign: 'right', color: 'var(--c-e2e8f0)', fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(p.cost)}</div>
                    <div style={{ width: 48, textAlign: 'right', color: 'var(--c-64748b)', fontSize: 11 }}>{share.toFixed(1)}%</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Main chart */}
      <div className="pulse-card" style={{ ...glass, opacity: loading ? 0.65 : 1, transition: 'opacity .2s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <TrendingUp size={15} style={{ color: '#38bdf8' }} />
          <span style={{ color: 'var(--c-e2e8f0)', fontSize: 13.5, fontWeight: 700 }}>
            Daily cost by {dimLabel}
          </span>
          <span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>
            {data?.breakdown_coverage_pct != null ? `${data.breakdown_coverage_pct}% attributed` : ''}
          </span>
        </div>
        {stacked.length === 0 ? (
          <div style={{ color: 'var(--c-475569)', fontSize: 12, padding: '30px 0', textAlign: 'center' }}>
            {loading ? 'Reading the cost warehouse…' : 'No warehouse data in this window.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={chartHeight}>
            {mode === 'bars' ? (
              <BarChart data={seriesView} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
                onClick={e => selectDay(e?.activeTooltipIndex)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--c-1e293b)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'var(--c-64748b)', fontSize: 10 }} tickFormatter={d => String(d).slice(5)} />
                <YAxis tick={{ fill: 'var(--c-64748b)', fontSize: 10 }} tickFormatter={v => `$${v}`}
                  domain={[0, yMax ?? 'auto']} allowDataOverflow />
                <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 8, fontSize: 12 }}
                  formatter={v => fmtUsd(v)} />
                {dayDetail && <ReferenceLine x={dayDetail.date} stroke="#22d3ee" strokeWidth={1.5} />}
                <Bar dataKey="cost" fill="#38bdf8" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            ) : mode === 'trend' ? (
              <LineChart data={seriesView} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
                onClick={e => selectDay(e?.activeTooltipIndex)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--c-1e293b)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'var(--c-64748b)', fontSize: 10 }} tickFormatter={d => String(d).slice(5)} />
                <YAxis tick={{ fill: 'var(--c-64748b)', fontSize: 10 }} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 8, fontSize: 12 }}
                  formatter={v => fmtUsd(v)} />
                {dayDetail && <ReferenceLine x={dayDetail.date} stroke="#22d3ee" strokeWidth={1.5} />}
                <Line type="monotone" dataKey="cost" stroke="#38bdf8" strokeWidth={2.4} dot={false} isAnimationActive={false} connectNulls={false} />
                <Line type="monotone" dataKey="accumulated" stroke="#a855f7" strokeWidth={1.6} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls={false} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </LineChart>
            ) : (
              <AreaChart data={stackedView} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
                onClick={e => selectDay(e?.activeTooltipIndex)}>
                <defs>
                  {keys.map((k, i) => (
                    <linearGradient key={k} id={`pulse-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colorOf(i)} stopOpacity={0.85} />
                      <stop offset="100%" stopColor={colorOf(i)} stopOpacity={0.12} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--c-1e293b)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'var(--c-64748b)', fontSize: 10 }} tickFormatter={d => String(d).slice(5)} />
                <YAxis tick={{ fill: 'var(--c-64748b)', fontSize: 10 }} tickFormatter={v => `$${v}`}
                  domain={[0, yMax ?? 'auto']} allowDataOverflow />
                <Tooltip contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 8, fontSize: 11.5 }}
                  formatter={v => fmtUsd(v)} itemSorter={it => -it.value} />
                <Legend wrapperStyle={{ fontSize: 10.5 }}
                  onMouseEnter={e => setHoverKey(e.dataKey)} onMouseLeave={() => setHoverKey(null)} />
                {dayDetail && <ReferenceLine x={dayDetail.date} stroke="#22d3ee" strokeWidth={1.5} />}
                {keys.map((k, i) => (
                  <Area key={k} type="monotone" dataKey={k} name={keyLabel(k)} stackId="1"
                    stroke={colorOf(i)} fill={`url(#pulse-${i})`} strokeWidth={1}
                    fillOpacity={dimOn(k) ? 1 : 0.15} strokeOpacity={dimOn(k) ? 1 : 0.2}
                    isAnimationActive={false} connectNulls={false} />
                ))}
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </div>

      {/* Breakdown leaderboard */}
      <div className="pulse-card" style={glass}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Sparkles size={15} style={{ color: '#a855f7' }} />
          <span style={{ color: 'var(--c-e2e8f0)', fontSize: 13.5, fontWeight: 700 }}>Where the money goes — by {dimLabel}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {breakdown.slice(0, 14).map((b, i) => {
            const pct = total ? (b.cost / total) * 100 : 0
            return (
              <div key={b.key} onMouseEnter={() => setHoverKey(b.key)} onMouseLeave={() => setHoverKey(null)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'default' }}>
                    <div style={{ width: 190, color: 'var(--c-cbd5e1)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={keyLabel(b.key)}>{keyLabel(b.key)}</div>
                <div style={{ flex: 1, height: 9, background: 'var(--c-0f172a)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.max(pct, 0.6)}%`, height: '100%', borderRadius: 999,
                    background: `linear-gradient(90deg, ${colorOf(i)}, ${colorOf(i)}99)`,
                    boxShadow: `0 0 12px -2px ${colorOf(i)}`,
                    transition: 'width .5s cubic-bezier(.22,1,.36,1)',
                    opacity: dimOn(b.key) ? 1 : 0.3,
                  }} />
                </div>
                <div style={{ width: 92, textAlign: 'right', color: 'var(--c-e2e8f0)', fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(b.cost)}</div>
                <div style={{ width: 48, textAlign: 'right', color: 'var(--c-64748b)', fontSize: 11 }}>{pct.toFixed(1)}%</div>
              </div>
            )
          })}
        </div>
      </div>

      <FinOpsAIPanel
        view="cost-pulse"
        title="AI analysis — Cost Pulse"
        data={{
          grouped_by: dimLabel, cost_type: costType, window_days: days,
          total_usd: Number(total.toFixed(2)), daily_avg_usd: Number(dailyAvg.toFixed(2)),
          trend_pct: Number(trendPct.toFixed(1)),
          peak_day: peak ? { date: peak.date, cost: peak.cost } : null,
          breakdown: breakdown.slice(0, 15),
        }} />
    </div>
  )
}
