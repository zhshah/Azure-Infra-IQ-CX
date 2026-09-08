/**
 * Data Ingestion — what is actually in the database, and a way to force a collection.
 *
 * A fresh deployment fills the warehouse from a first-run warm-up chained off a scan
 * and reports nothing while it does, so empty charts are indistinguishable from a
 * broken pipeline. This view answers both halves plainly: a per-dataset census
 * (rows, coverage window, freshness, owning subscription, and HOW it gets filled)
 * and a force-collect run that streams its own progress step by step.
 *
 * Theme note: every surface uses a --c-* token. Hardcoding a dark hex behind
 * token-coloured text renders dark-on-dark in the light theme, because the ink
 * tokens invert while a literal does not.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  RefreshCw, AlertCircle, Database, PlayCircle, CheckCircle2, XCircle,
  Clock, ChevronRight, ChevronDown, HardDrive, Layers, Info, MinusCircle,
  Download, Search, CalendarClock, Wrench, UserPlus, Sigma, Activity, History, Zap,
} from 'lucide-react'
import { getJSON } from '../components/mgmt/MgmtWidgets'

const card = {
  background: 'var(--c-0f172a, #0f172a)',
  border: '1px solid var(--c-1e293b, #1e293b)',
  borderRadius: 10,
  padding: 16,
}

const btn = (bg, fg, border) => ({
  background: bg, color: fg, border: `1px solid ${border}`,
  borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
})

const SOURCE_LABEL = {
  azure_sql_warehouse: 'Cost warehouse (ETL → Azure SQL)',
  scan_cache: 'Estate scan (→ Azure SQL)',
  user_input: 'Entered in the product',
  live_azure_api: 'Live Azure API (never stored)',
}

const STATUS_STYLE = {
  ok:                { bg: 'var(--c-052e16, #052e16)', fg: '#22c55e', border: 'var(--c-166534, #166534)', label: 'Populated' },
  empty:             { bg: 'var(--c-3f1d1d, #3f1d1d)', fg: '#ef4444', border: 'var(--c-7f1d1d, #7f1d1d)', label: 'Empty' },
  not_applicable:    { bg: 'var(--c-1e293b, #1e293b)', fg: 'var(--c-94a3b8, #94a3b8)', border: 'var(--c-334155, #334155)', label: 'Awaiting trigger' },
  collection_failed: { bg: 'var(--c-3f1d1d, #3f1d1d)', fg: '#ef4444', border: 'var(--c-7f1d1d, #7f1d1d)', label: 'Collection failed' },
  missing:           { bg: 'var(--c-422006, #422006)', fg: '#d97706', border: 'var(--c-854d0e, #854d0e)', label: 'Table missing' },
}

const FILL_META = {
  collection:  { label: 'Collected',  icon: Download, color: '#3b82f6',
                 hint: 'A collection run pulls this from Azure.' },
  derived:     { label: 'Derived',    icon: Sigma,    color: '#8b5cf6',
                 hint: 'Computed once a condition is met — cannot be downloaded.' },
  user_action: { label: 'You supply', icon: UserPlus, color: '#d97706',
                 hint: 'Only you can provide this; no Azure API returns it.' },
}

const STEP_ICON = {
  ok:      <CheckCircle2 size={14} style={{ color: '#22c55e' }} />,
  failed:  <XCircle size={14} style={{ color: '#ef4444' }} />,
  running: <RefreshCw size={14} className="animate-spin" style={{ color: '#3b82f6' }} />,
  skipped: <MinusCircle size={14} style={{ color: 'var(--c-64748b, #64748b)' }} />,
  pending: <Clock size={14} style={{ color: 'var(--c-475569, #475569)' }} />,
}

const fmtNum = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString())

function fmtAge(hours) {
  if (hours === null || hours === undefined) return '—'
  if (hours < 1) return `${Math.round(hours * 60)}m ago`
  if (hours < 48) return `${hours.toFixed(1)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function stepSeconds(s) {
  if (!s.started_at) return null
  const end = s.finished_at ? new Date(s.finished_at) : new Date()
  return (end - new Date(s.started_at)) / 1000
}

function Pill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.not_applicable
  return (
    <span style={{
      background: s.bg, color: s.fg, border: `1px solid ${s.border}`,
      borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  )
}

function FillBadge({ method }) {
  const m = FILL_META[method] || FILL_META.collection
  const Icon = m.icon
  return (
    <span title={m.hint} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
      color: m.color, fontSize: 10.5, fontWeight: 600,
    }}>
      <Icon size={11} /> {m.label}
    </span>
  )
}

export default function DataIngestion() {
  const [inv, setInv] = useState(null)
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [tick, setTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const pollRef = useRef(null)

  const loadInventory = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    try {
      const d = await getJSON(`/api/finops/ingestion/inventory${refresh ? '?refresh=true' : ''}`)
      setInv(d)
      setError(d.error || null)
    } catch (e) { setError(e.message) } finally { if (refresh) setRefreshing(false) }
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const s = await getJSON('/api/finops/ingestion/status')
      setJob(s)
      return s
    } catch { return null }
  }, [])

  useEffect(() => {
    (async () => {
      setLoading(true)
      await Promise.all([loadInventory(), loadStatus()])
      setLoading(false)
    })()
  }, [loadInventory, loadStatus])

  // While a run is in flight, poll status; refresh the census once it lands so the
  // row counts the user is watching actually move.
  useEffect(() => {
    if (!job?.running) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    pollRef.current = setInterval(async () => {
      const s = await loadStatus()
      setTick(t => t + 1)
      if (s && !s.running) {
        clearInterval(pollRef.current); pollRef.current = null
        loadInventory(true)
      }
    }, 4000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [job?.running, loadStatus, loadInventory])

  async function startRun(mode = 'full') {
    setStarting(true); setError(null)
    try {
      const res = await fetch(`/api/finops/ingestion/run?mode=${mode}`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || `HTTP ${res.status}`)
      if (d.job) setJob(d.job)
      if (!d.ok) setError(d.message)
      await loadStatus()
    } catch (e) { setError(e.message) } finally { setStarting(false) }
  }

  function exportCsv() {
    const rows = (inv?.datasets || []).map(d => ({
      dataset: d.label, table: d.table, source: d.source, status: d.status,
      fill_method: d.fill_method, rows: d.rows,
      earliest: d.earliest || '', latest: d.latest || '',
      age_hours: d.age_hours ?? '', modules: (d.modules || []).join('; '),
      how_to_fill: d.how_to_fill || '',
    }))
    if (!rows.length) return
    const cols = Object.keys(rows[0])
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `data-ingestion-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const datasets = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (inv?.datasets || []).filter(d => {
      if (statusFilter === 'populated' && d.status !== 'ok') return false
      if (statusFilter === 'attention' && !['empty', 'collection_failed', 'missing'].includes(d.status)) return false
      if (statusFilter === 'awaiting' && d.status !== 'not_applicable') return false
      if (!q) return true
      return `${d.label} ${d.table} ${(d.modules || []).join(' ')}`.toLowerCase().includes(q)
    })
  }, [inv, query, statusFilter])

  const groups = useMemo(() => datasets.reduce((acc, d) => {
    (acc[d.source] = acc[d.source] || []).push(d); return acc
  }, {}), [datasets])

  // Weighted so a long ETL does not sit at "16%" for half an hour.
  const progress = useMemo(() => {
    void tick
    const steps = job?.steps || []
    if (!steps.length) return null
    const total = steps.reduce((a, s) => a + (s.weight || 1), 0)
    const done = steps.filter(s => ['ok', 'failed', 'skipped'].includes(s.status))
    const doneWeight = done.reduce((a, s) => a + (s.weight || 1), 0)
    const runningStep = steps.find(s => s.status === 'running')
    const half = runningStep ? Math.round(((runningStep.weight || 1) / total) * 50) : 0
    return {
      pct: job?.running ? Math.min(99, Math.round((doneWeight / total) * 100) + half) : 100,
      doneCount: done.length,
      total: steps.length,
      index: runningStep ? steps.indexOf(runningStep) + 1 : done.length,
      runningStep,
    }
  }, [job, tick])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, gap: 10 }}>
      <RefreshCw size={18} className="animate-spin" style={{ color: '#3b82f6' }} />
      <span style={{ color: 'var(--c-94a3b8, #94a3b8)' }}>Reading database inventory…</span>
    </div>
  )

  const etl = inv?.last_etl || {}
  const running = !!job?.running
  const gaps = inv?.actionable_gaps || []
  const sched = inv?.schedule || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div style={{ background: 'var(--c-3f1d1d, #1a0e0e)', border: '1px solid var(--c-7f1d1d, #7f1d1d)', borderRadius: 10, padding: 12, color: '#ef4444', display: 'flex', gap: 8, fontSize: 12 }}>
          <AlertCircle size={15} /><span>{error}</span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9, #f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Data Ingestion</h2>
          <div style={{ fontSize: 12, color: 'var(--c-64748b, #64748b)', marginTop: 3 }}>
            What has been collected into Azure SQL, and a way to force a full collection now
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={exportCsv} style={btn('var(--c-1e293b, #1e293b)', 'var(--c-f1f5f9, #f1f5f9)', 'var(--c-334155, #334155)')}>
            <Download size={12} /> Export CSV
          </button>
          <button onClick={() => loadInventory(true)} disabled={refreshing}
            style={{ ...btn('var(--c-1e293b, #1e293b)', 'var(--c-f1f5f9, #f1f5f9)', 'var(--c-334155, #334155)'),
              cursor: refreshing ? 'wait' : 'pointer' }}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : undefined} />
            {refreshing ? 'Reading database…' : 'Refresh inventory'}
          </button>
          <button onClick={() => startRun('quick')} disabled={running || starting}
            title="Top up the last few days only — same collectors, a fraction of the time."
            style={{
              ...btn('var(--c-1e293b, #1e293b)',
                running ? 'var(--c-64748b, #64748b)' : '#3b82f6', 'var(--c-334155, #334155)'),
              cursor: running ? 'not-allowed' : 'pointer',
            }}>
            <Zap size={12} /> Quick top-up
          </button>
          <button onClick={() => startRun('full')} disabled={running || starting}
            title="Pull the maximum history Azure will serve (~13 months). Takes tens of minutes."
            style={{
              ...btn(running ? 'var(--c-1e293b, #1e293b)' : 'var(--c-052e16, #052e16)',
                running ? 'var(--c-64748b, #64748b)' : '#22c55e',
                running ? 'var(--c-334155, #334155)' : 'var(--c-166534, #166534)'),
              cursor: running ? 'not-allowed' : 'pointer',
            }}>
            {running ? <RefreshCw size={12} className="animate-spin" /> : <PlayCircle size={12} />}
            {running ? 'Collection running…' : starting ? 'Starting…' : 'Collect max history'}
          </button>
        </div>
      </div>

      {/* Headline: is there data, how much, and how fresh */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          ['Rows in database', fmtNum(inv?.total_rows), '#3b82f6', <Database size={13} key="i" />],
          ['Database size', inv?.database?.used_mb ? `${inv.database.used_mb} MB` : '—', null, <HardDrive size={13} key="i" />],
          ['Datasets populated', `${inv?.summary?.ok ?? 0} / ${inv?.summary?.total ?? 0}`, '#22c55e', <Layers size={13} key="i" />],
          ['Gaps a collection can fix', fmtNum(gaps.length), gaps.length ? '#d97706' : '#22c55e', <Wrench size={13} key="i" />],
          ['Last ETL', etl.status || 'never run',
            etl.status === 'completed' ? '#22c55e' : etl.status === 'failed' ? '#ef4444' : null,
            <Clock size={13} key="i" />],
          ['Next scheduled', sched.next_refresh_at
            ? new Date(sched.next_refresh_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : sched.auto_refresh_interval_hours ? `every ${sched.auto_refresh_interval_hours}h` : '—',
            null, <CalendarClock size={13} key="i" />],
        ].map(([label, value, color, icon]) => (
          <div key={label} style={{ ...card, flex: '1 1 150px', minWidth: 150 }}>
            <div style={{ fontSize: 11, color: 'var(--c-94a3b8, #94a3b8)', textTransform: 'uppercase', letterSpacing: 0.4, display: 'flex', alignItems: 'center', gap: 5 }}>
              {icon} {label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--c-f1f5f9, #f1f5f9)', marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>

      {etl.error_message && (
        <div style={{ background: 'var(--c-3f1d1d, #1a0e0e)', border: '1px solid var(--c-7f1d1d, #7f1d1d)', borderRadius: 10, padding: 12, color: '#ef4444', display: 'flex', gap: 8, fontSize: 12 }}>
          <AlertCircle size={15} />
          <span><strong>Last ETL reported:</strong> {etl.error_message}</span>
        </div>
      )}

      {/* Only real gaps — datasets a collection run can actually fill */}
      {gaps.length > 0 && (
        <div style={{ ...card, borderColor: 'var(--c-854d0e, #854d0e)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Wrench size={14} style={{ color: '#d97706' }} />
            <span style={{ color: 'var(--c-f1f5f9, #f1f5f9)', fontSize: 13, fontWeight: 700 }}>
              {gaps.length} dataset{gaps.length === 1 ? '' : 's'} a collection run can fill
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {gaps.map(g => (
              <div key={g.key} style={{ fontSize: 11.5, color: 'var(--c-cbd5e1, #cbd5e1)' }}>
                <strong>{g.label}</strong> — <span style={{ color: 'var(--c-94a3b8, #94a3b8)' }}>{g.how_to_fill}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Force-collection progress */}
      {job && job.status !== 'idle' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ color: 'var(--c-f1f5f9, #f1f5f9)', fontSize: 13, fontWeight: 700 }}>
              Collection run
              {job.run_id ? <span style={{ color: 'var(--c-64748b, #64748b)', fontWeight: 400, fontSize: 11 }}> · {job.run_id}</span> : null}
              {progress && (
                <span style={{ color: 'var(--c-64748b, #64748b)', fontWeight: 400, fontSize: 11 }}>
                  {' '}· step {Math.max(1, progress.index)} of {progress.total}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, color: 'var(--c-94a3b8, #94a3b8)', flexWrap: 'wrap' }}>
              <span>Status: <strong style={{
                color: job.status === 'completed' ? '#22c55e'
                  : job.status === 'running' ? '#3b82f6'
                  : job.status === 'partial' ? '#d97706' : '#ef4444',
              }}>{job.status}</strong></span>
              <span>Elapsed: {fmtDuration(job.elapsed_seconds)}</span>
              {job.rows_written_total != null && (
                <span>Rows written: <strong style={{ color: '#22c55e' }}>{fmtNum(job.rows_written_total)}</strong></span>
              )}
            </div>
          </div>

          {progress && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ height: 6, background: 'var(--c-1e293b, #1e293b)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  width: `${progress.pct}%`, height: '100%', borderRadius: 999,
                  background: job.status === 'failed' ? '#ef4444' : job.status === 'partial' ? '#d97706' : '#3b82f6',
                  transition: 'width .6s ease',
                }} />
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--c-64748b, #64748b)', marginTop: 5 }}>
                {running ? (
                  <>Running <strong style={{ color: 'var(--c-cbd5e1, #cbd5e1)' }}>{progress.runningStep?.label}</strong>
                    {progress.runningStep?.typical ? ` — typically ${progress.runningStep.typical}` : ''}
                    . Collection continues in the background; you can leave this page.</>
                ) : (
                  <>Finished {progress.doneCount} of {progress.total} steps.</>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(job.steps || []).map(s => {
              const isRunning = s.status === 'running'
              return (
                <div key={s.key} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 10px',
                  // Token, not a literal: a hardcoded dark hex renders the token-coloured
                  // label dark-on-dark in the light theme.
                  background: isRunning ? 'var(--c-0c1a2e, #0c1a2e)' : 'var(--c-1e293b, #1e293b)',
                  border: `1px solid ${isRunning ? '#3b82f6' : 'transparent'}`,
                  borderRadius: 8,
                }}>
                  <div style={{ marginTop: 1 }}>{STEP_ICON[s.status] || STEP_ICON.pending}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--c-e2e8f0, #e2e8f0)' }}>
                      {s.label}
                      {s.typical && s.status === 'pending' && (
                        <span style={{ color: 'var(--c-64748b, #64748b)', fontSize: 10.5 }}> · typically {s.typical}</span>
                      )}
                    </div>
                    {isRunning && s.progress && (
                      <div style={{ fontSize: 10.5, color: '#3b82f6', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Activity size={11} /> {s.progress}
                      </div>
                    )}
                    {s.detail && (
                      <div style={{ fontSize: 10.5, color: s.status === 'failed' ? '#ef4444' : 'var(--c-64748b, #64748b)', marginTop: 2, wordBreak: 'break-word' }}>
                        {s.detail}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {s.rows != null && (
                      <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>+{fmtNum(s.rows)}</div>
                    )}
                    {stepSeconds(s) != null && (
                      <div style={{ fontSize: 10, color: 'var(--c-64748b, #64748b)' }}>{fmtDuration(stepSeconds(s))}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {job.rows_written && Object.keys(job.rows_written).length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--c-1e293b, #1e293b)' }}>
              <div style={{ fontSize: 11, color: 'var(--c-94a3b8, #94a3b8)', marginBottom: 6 }}>Net rows added, by table</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(job.rows_written).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                  <span key={t} style={{
                    background: 'var(--c-1e293b, #1e293b)', border: '1px solid var(--c-334155, #334155)',
                    borderRadius: 6, padding: '3px 8px', fontSize: 10.5, color: 'var(--c-cbd5e1, #cbd5e1)',
                  }}>
                    {t} <strong style={{ color: n > 0 ? '#22c55e' : '#ef4444' }}>{n > 0 ? '+' : ''}{fmtNum(n)}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {job.error && <div style={{ marginTop: 10, fontSize: 11, color: '#ef4444' }}>{job.error}</div>}
        </div>
      )}

      {/* Coverage by subscription, across every dataset that names one */}
      {(inv?.by_subscription || []).length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Layers size={14} style={{ color: '#3b82f6' }} />
            <span style={{ color: 'var(--c-f1f5f9, #f1f5f9)', fontSize: 13, fontWeight: 700 }}>Rows by subscription</span>
            <span style={{ color: 'var(--c-64748b, #64748b)', fontSize: 11 }}>across every attributed dataset</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {inv.by_subscription.map(s => {
              const max = inv.by_subscription[0].rows || 1
              return (
                <div key={s.subscription_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 10.5, color: 'var(--c-cbd5e1, #cbd5e1)', width: 300, flexShrink: 0 }}>
                    {s.subscription_id}
                  </span>
                  <div style={{ flex: 1, height: 8, background: 'var(--c-1e293b, #1e293b)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${(s.rows / max) * 100}%`, height: '100%', background: '#3b82f6', borderRadius: 999 }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#22c55e', width: 70, textAlign: 'right' }}>{fmtNum(s.rows)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 340 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--c-64748b, #64748b)' }} />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search dataset, table or module…"
            style={{
              width: '100%', background: 'var(--c-1e293b, #1e293b)', color: 'var(--c-f1f5f9, #f1f5f9)',
              border: '1px solid var(--c-334155, #334155)', borderRadius: 6,
              padding: '6px 10px 6px 28px', fontSize: 12,
            }} />
        </div>
        {[
          ['all', `All (${inv?.datasets?.length || 0})`],
          ['populated', `Populated (${inv?.summary?.ok ?? 0})`],
          ['attention', `Needs attention (${gaps.length})`],
          ['awaiting', `Awaiting trigger (${inv?.summary?.not_applicable ?? 0})`],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setStatusFilter(k)}
            style={btn(
              statusFilter === k ? 'var(--c-0c1a2e, #0c1a2e)' : 'var(--c-1e293b, #1e293b)',
              statusFilter === k ? '#3b82f6' : 'var(--c-94a3b8, #94a3b8)',
              statusFilter === k ? '#3b82f6' : 'var(--c-334155, #334155)')}>
            {label}
          </button>
        ))}
      </div>

      {/* Per-dataset census */}
      {Object.entries(groups).map(([source, rows]) => (
        <div key={source} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Database size={14} style={{ color: '#3b82f6' }} />
            <span style={{ color: 'var(--c-f1f5f9, #f1f5f9)', fontSize: 13, fontWeight: 700 }}>
              {SOURCE_LABEL[source] || source}
            </span>
            <span style={{ color: 'var(--c-64748b, #64748b)', fontSize: 11 }}>
              {rows.length} dataset{rows.length === 1 ? '' : 's'} ·{' '}
              {fmtNum(rows.reduce((a, r) => a + (r.rows || 0), 0))} rows
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ color: 'var(--c-64748b, #64748b)', textAlign: 'left' }}>
                  {['', 'Dataset', 'Table', 'Status', 'How it fills', 'Rows', 'Coverage', 'Updated', 'Used by'].map((h, i) => (
                    <th key={i} style={{ padding: '6px 8px', fontWeight: 600, borderBottom: '1px solid var(--c-1e293b, #1e293b)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(d => {
                  const canExpand = (d.by_subscription || []).length > 0
                  const isOpen = !!expanded[d.key]
                  return (
                    <React.Fragment key={d.key}>
                      <tr style={{ borderBottom: '1px solid var(--c-1e293b, #1e293b)' }}>
                        <td style={{ padding: '6px 4px', width: 20 }}>
                          {canExpand && (
                            <button onClick={() => setExpanded(p => ({ ...p, [d.key]: !p[d.key] }))}
                              style={{ background: 'none', border: 'none', color: 'var(--c-64748b, #64748b)', cursor: 'pointer', padding: 0 }}>
                              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0, #e2e8f0)' }}>
                          {d.label}
                          {d.status !== 'ok' && d.how_to_fill && (
                            <div style={{ fontSize: 10, color: 'var(--c-64748b, #64748b)', marginTop: 2, maxWidth: 320 }}>
                              {d.how_to_fill}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--c-64748b, #64748b)', fontFamily: 'monospace', fontSize: 10.5 }}>{d.table}</td>
                        <td style={{ padding: '6px 8px' }}><Pill status={d.status} /></td>
                        <td style={{ padding: '6px 8px' }}><FillBadge method={d.fill_method} /></td>
                        <td style={{ padding: '6px 8px', color: d.rows ? '#22c55e' : 'var(--c-64748b, #64748b)', fontWeight: 600, textAlign: 'right' }}>{fmtNum(d.rows)}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8, #94a3b8)', whiteSpace: 'nowrap' }}>
                          {d.earliest ? `${d.earliest} → ${d.latest}` : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8, #94a3b8)', whiteSpace: 'nowrap' }}>{fmtAge(d.age_hours)}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--c-64748b, #64748b)', maxWidth: 240 }}>
                          {(d.modules || []).join(', ')}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td />
                          <td colSpan={8} style={{ padding: '4px 8px 10px' }}>
                            <div style={{ fontSize: 10.5, color: 'var(--c-64748b, #64748b)', marginBottom: 4 }}>Rows by subscription</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {d.by_subscription.map(s => (
                                <span key={s.subscription_id} style={{
                                  background: 'var(--c-1e293b, #1e293b)', border: '1px solid var(--c-334155, #334155)',
                                  borderRadius: 6, padding: '3px 8px', fontSize: 10.5, color: 'var(--c-cbd5e1, #cbd5e1)',
                                }}>
                                  <span style={{ fontFamily: 'monospace' }}>{s.subscription_id}</span>
                                  {' '}<strong style={{ color: '#22c55e' }}>{fmtNum(s.rows)}</strong>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {datasets.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: 'var(--c-64748b, #64748b)', fontSize: 12, padding: 24 }}>
          No dataset matches this filter.
        </div>
      )}

      {/* How far back each grain is pulled — answers "why does this chart start in June?" */}
      {(inv?.collection_windows || []).length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <History size={14} style={{ color: '#3b82f6' }} />
            <span style={{ color: 'var(--c-f1f5f9, #f1f5f9)', fontSize: 13, fontWeight: 700 }}>How far back each grain is collected</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b, #64748b)', marginBottom: 8 }}>
            Azure Cost Management serves at most ~13 months of history. Retention is tied to
            these same windows, so nothing is downloaded only to be purged.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ color: 'var(--c-64748b, #64748b)', textAlign: 'left' }}>
                  {['Grain', 'History pulled', 'Override', 'Note'].map((h, i) => (
                    <th key={i} style={{ padding: '6px 8px', fontWeight: 600, borderBottom: '1px solid var(--c-1e293b, #1e293b)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inv.collection_windows.map(w => (
                  <tr key={w.grain} style={{ borderBottom: '1px solid var(--c-1e293b, #1e293b)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0, #e2e8f0)' }}>{w.grain}</td>
                    <td style={{ padding: '6px 8px', color: '#22c55e', fontWeight: 600, whiteSpace: 'nowrap' }}>{w.window}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-64748b, #64748b)', fontFamily: 'monospace', fontSize: 10 }}>{w.env}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8, #94a3b8)' }}>{w.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modules that never store anything, so an empty table is not the explanation */}
      {inv?.live_only_modules && Object.keys(inv.live_only_modules).length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Info size={14} style={{ color: 'var(--c-64748b, #64748b)' }} />
            <span style={{ color: 'var(--c-f1f5f9, #f1f5f9)', fontSize: 13, fontWeight: 700 }}>Served live from Azure — never stored</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--c-64748b, #64748b)', marginBottom: 8 }}>
            These modules query Azure on every request, so they have no table here and are unaffected by a collection run.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(inv.live_only_modules).map(([mod, src]) => (
              <span key={mod} title={src} style={{
                background: 'var(--c-1e293b, #1e293b)', border: '1px solid var(--c-334155, #334155)',
                borderRadius: 6, padding: '3px 8px', fontSize: 10.5, color: 'var(--c-cbd5e1, #cbd5e1)',
              }}>{mod}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
