import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Upload, Download, Server, Database, Globe, Shield, Brain, RefreshCw, ChevronRight, AlertTriangle, CheckCircle, Trash2, FileText, Copy, Settings, BarChart3, ArrowRight, Search, Wifi, Play, Square, Monitor, Clock, Calendar, Save, Power } from 'lucide-react'
import { api } from '../api/client'

/* ── small helpers ─────────────────────────────────────────────────────────── */
const pill = (bg, text, label) => (
  <span style={{ background: bg, color: text, padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600 }}>{label}</span>
)
const card = (children, style = {}) => (
  <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: 20, ...style }}>{children}</div>
)
const statCard = (label, value, icon, color = '#60a5fa') => (
  <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: 16, flex: '1 1 0', minWidth: 140 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>{icon}</div>
      <span style={{ color: '#9ca3af', fontSize: 12 }}>{label}</span>
    </div>
    <div style={{ fontSize: 24, fontWeight: 700, color: '#f1f5f9' }}>{value}</div>
  </div>
)

/* ════════════════════════════════════════════════════════════════════════════ */
/*  MAIN VIEW                                                                 */
/* ════════════════════════════════════════════════════════════════════════════ */
export default function OnPremCollectionView() {
  const [tab, setTab] = useState('overview')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try { setSummary(await api.getOnPremSummary()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const tabs = [
    { key: 'overview',   label: '📊 Overview',   icon: <BarChart3 size={14} /> },
    { key: 'discovery',  label: '🔍 Remote Discovery', icon: <Search size={14} /> },
    { key: 'schedule',   label: '⏱️ Scheduled Monitoring', icon: <Clock size={14} /> },
    { key: 'script',     label: '⚡ Script Builder', icon: <Settings size={14} /> },
    { key: 'upload',     label: '📤 Upload',      icon: <Upload size={14} /> },
    { key: 'inventory',  label: '🖥️ Inventory',  icon: <Server size={14} /> },
    { key: 'migration',  label: '🚀 Migration',   icon: <ArrowRight size={14} /> },
    { key: 'ai',         label: '🧠 AI Analysis', icon: <Brain size={14} /> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b', paddingBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: tab === t.key ? '#2563eb' : 'transparent',
              color: tab === t.key ? '#fff' : '#9ca3af',
              border: 'none', transition: 'all .15s',
            }}>{t.label}</button>
          ))}
        </div>
        <button onClick={refresh} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '5px 12px', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {error && <div style={{ background: '#7f1d1d', border: '1px solid #991b1b', borderRadius: 8, padding: 12, color: '#fca5a5', fontSize: 13 }}>{error}</div>}

      {tab === 'overview'  && <OverviewTab summary={summary} loading={loading} />}
      {tab === 'discovery' && <RemoteDiscoveryTab onCollected={refresh} />}
      {tab === 'schedule'  && <ScheduleTab />}
      {tab === 'script'    && <ScriptBuilderTab />}
      {tab === 'upload'    && <UploadTab onUploaded={refresh} />}
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'migration' && <MigrationTab />}
      {tab === 'ai'        && <AIAnalysisTab />}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*  SCHEDULED MONITORING TAB — periodic re-scan of added servers             */
/* ════════════════════════════════════════════════════════════════════════════ */
const MODULE_LABELS = {
  hardware: 'Hardware', os: 'Operating System', disks: 'Disks & Storage',
  network: 'Network', services: 'Services', applications: 'Applications',
  sql: 'SQL Server', iis: 'IIS / Web', security: 'Security Posture',
  certificates: 'Certificates', roles: 'Roles & Features',
}
const STATUS_COLORS = {
  running:   ['#1e3a5f', '#60a5fa'], completed: ['#065f46', '#34d399'],
  error:     ['#7f1d1d', '#fca5a5'], skipped:   ['#374151', '#9ca3af'],
  cancelled: ['#78350f', '#fbbf24'],
}
const fmtDate = (iso) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}
const extractForm = (s) => ({
  enabled: !!s.enabled,
  mode: s.mode || 'daily',
  time_of_day: s.time_of_day || '02:00',
  interval_hours: s.interval_hours || 24,
  target: s.target || 'all',
  servers: Array.isArray(s.servers) ? s.servers : [],
  modules: { ...(s.modules || {}) },
  max_concurrent: s.max_concurrent || 5,
  timeout_per_server: s.timeout_per_server || 180,
})

function ScheduleTab() {
  const [sched, setSched] = useState(null)
  const [form, setForm] = useState(null)
  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    let mounted = true
    api.getOnPremSchedule()
      .then(s => { if (!mounted) return; setSched(s); setForm(extractForm(s)) })
      .catch(e => mounted && setError(e.message))
      .finally(() => mounted && setLoading(false))
    api.getOnPremServers()
      .then(list => { if (mounted) setServers(Array.isArray(list) ? list : (list?.servers || [])) })
      .catch(() => {})
    pollRef.current = setInterval(() => {
      api.getOnPremSchedule().then(s => mounted && setSched(s)).catch(() => {})
    }, 8000)
    return () => { mounted = false; if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleModule = (k) => setForm(f => ({ ...f, modules: { ...f.modules, [k]: !f.modules[k] } }))
  const setAllModules = (val) => setForm(f => ({ ...f, modules: Object.keys(MODULE_LABELS).reduce((a, k) => (a[k] = val, a), {}) }))

  const save = async () => {
    setSaving(true); setError(null); setMsg(null)
    try {
      const s = await api.updateOnPremSchedule(form)
      setSched(s); setForm(extractForm(s))
      setMsg({ type: 'ok', text: 'Schedule saved' })
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const scanNow = async () => {
    setRunning(true); setError(null); setMsg(null)
    try {
      const r = await api.runOnPremScanNow(form)
      if (r.started) setMsg({ type: 'ok', text: `Scan started for ${r.total_servers} server(s)` })
      else setMsg({ type: 'warn', text: r.reason || r.error || 'Scan did not start' })
      if (r.schedule) setSched(r.schedule)
    } catch (e) { setError(e.message) }
    finally { setRunning(false) }
  }

  if (loading || !form) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
      <RefreshCw size={20} className="animate-spin" style={{ display: 'inline' }} /> Loading schedule…
    </div>
  }

  const selectedModuleCount = Object.values(form.modules).filter(Boolean).length
  const targetCount = form.target === 'all' ? (sched?.inventory_count ?? 0) : form.servers.length
  const cap = sched?.max_concurrent_cap || 20
  const lastStatus = sched?.last_status
  const [lsBg, lsFg] = STATUS_COLORS[lastStatus] || ['#374151', '#9ca3af']
  const history = sched?.history || []

  const radioBtn = (active, onClick, label, icon) => (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
      background: active ? '#2563eb' : '#0f172a', color: active ? '#fff' : '#9ca3af',
      border: `1px solid ${active ? '#2563eb' : '#1e293b'}`, transition: 'all .15s',
    }}>{icon}{label}</button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Status banner ── */}
      {card(
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: sched?.enabled ? '#065f4630' : '#37415130', color: sched?.enabled ? '#34d399' : '#6b7280' }}>
              <Power size={22} />
            </div>
            <div>
              <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 700 }}>
                Scheduled monitoring is {sched?.enabled ? 'ON' : 'OFF'}
              </div>
              <div style={{ color: '#9ca3af', fontSize: 12 }}>
                {sched?.enabled
                  ? (form.mode === 'manual' ? 'Manual mode — runs only on demand'
                    : form.mode === 'daily' ? `Every day at ${form.time_of_day}`
                    : `Every ${form.interval_hours}h`)
                  : 'Enable a schedule or use “Scan now”.'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 24, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Next run</div>
              <div style={{ color: '#60a5fa', fontSize: 13, fontWeight: 600 }}>{fmtDate(sched?.next_run)}</div>
            </div>
            <div>
              <div style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Last run</div>
              <div style={{ color: '#cbd5e1', fontSize: 13, fontWeight: 600 }}>{fmtDate(sched?.last_run)}</div>
            </div>
            {lastStatus && (
              <div>
                <div style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Last status</div>
                <span style={{ background: lsBg, color: lsFg, padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700 }}>
                  {lastStatus}{sched?.last_summary ? ` · ${sched.last_summary.succeeded}/${sched.last_summary.total}` : ''}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* running progress */}
      {sched?.is_running && sched?.last_summary && (
        <div style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 10, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: '#60a5fa', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={12} className="animate-spin" /> Scan in progress
            </span>
            <span style={{ color: '#9ca3af', fontSize: 12 }}>
              {(sched.last_summary.succeeded + sched.last_summary.failed)}/{sched.last_summary.total} done
            </span>
          </div>
          <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#2563eb', width: `${sched.last_summary.total ? Math.round((sched.last_summary.succeeded + sched.last_summary.failed) / sched.last_summary.total * 100) : 0}%`, transition: 'width .3s' }} />
          </div>
        </div>
      )}

      {msg && <div style={{ background: msg.type === 'ok' ? '#064e3b' : '#78350f', border: `1px solid ${msg.type === 'ok' ? '#065f46' : '#92400e'}`, borderRadius: 8, padding: 10, color: msg.type === 'ok' ? '#6ee7b7' : '#fcd34d', fontSize: 12 }}>{msg.text}</div>}
      {error && <div style={{ background: '#7f1d1d', border: '1px solid #991b1b', borderRadius: 8, padding: 10, color: '#fca5a5', fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {/* ── Schedule (WHEN + concurrency) ── */}
        {card(
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={15} style={{ color: '#60a5fa' }} /> When to scan
              </h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <span style={{ color: '#9ca3af', fontSize: 12 }}>Enabled</span>
                <span onClick={() => setField('enabled', !form.enabled)} style={{
                  width: 40, height: 22, borderRadius: 11, background: form.enabled ? '#2563eb' : '#374151',
                  position: 'relative', transition: 'all .2s', cursor: 'pointer', display: 'inline-block',
                }}>
                  <span style={{ position: 'absolute', top: 2, left: form.enabled ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'all .2s' }} />
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {radioBtn(form.mode === 'daily', () => setField('mode', 'daily'), 'Daily', <Clock size={13} />)}
              {radioBtn(form.mode === 'interval', () => setField('mode', 'interval'), 'Every N hours', <RefreshCw size={13} />)}
              {radioBtn(form.mode === 'manual', () => setField('mode', 'manual'), 'Manual only', <Play size={13} />)}
            </div>

            {form.mode === 'daily' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ color: '#9ca3af', fontSize: 12, display: 'block', marginBottom: 6 }}>Run every day at (server local time)</label>
                <input type="time" value={form.time_of_day} onChange={e => setField('time_of_day', e.target.value)}
                  style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '7px 10px', color: '#f1f5f9', fontSize: 13 }} />
              </div>
            )}
            {form.mode === 'interval' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ color: '#9ca3af', fontSize: 12, display: 'block', marginBottom: 6 }}>Repeat every (hours)</label>
                <input type="number" min={1} max={720} value={form.interval_hours} onChange={e => setField('interval_hours', Math.max(1, parseInt(e.target.value) || 24))}
                  style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '7px 10px', color: '#f1f5f9', fontSize: 13, width: 100 }} />
              </div>
            )}

            <div style={{ borderTop: '1px solid #1e293b', paddingTop: 14, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <label style={{ color: '#9ca3af', fontSize: 12, display: 'block', marginBottom: 6 }}>Devices scanned at once</label>
                <input type="number" min={1} max={cap} value={form.max_concurrent} onChange={e => setField('max_concurrent', Math.max(1, Math.min(cap, parseInt(e.target.value) || 5)))}
                  style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '7px 10px', color: '#f1f5f9', fontSize: 13, width: 90 }} />
                <div style={{ color: '#6b7280', fontSize: 10, marginTop: 4 }}>Parallel fan-out (max {cap})</div>
              </div>
              <div>
                <label style={{ color: '#9ca3af', fontSize: 12, display: 'block', marginBottom: 6 }}>Timeout / device (s)</label>
                <input type="number" min={30} max={600} value={form.timeout_per_server} onChange={e => setField('timeout_per_server', Math.max(30, Math.min(600, parseInt(e.target.value) || 180)))}
                  style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '7px 10px', color: '#f1f5f9', fontSize: 13, width: 90 }} />
              </div>
            </div>
          </>
        )}

        {/* ── Target (WHICH) ── */}
        {card(
          <>
            <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Server size={15} style={{ color: '#60a5fa' }} /> Which servers
            </h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {radioBtn(form.target === 'all', () => setField('target', 'all'), `All inventory (${sched?.inventory_count ?? 0})`, <Database size={13} />)}
              {radioBtn(form.target === 'selected', () => setField('target', 'selected'), `Selected (${form.servers.length})`, <CheckCircle size={13} />)}
            </div>
            {form.target === 'selected' && (
              <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #1e293b', borderRadius: 8, padding: 8 }}>
                {servers.length === 0 && <div style={{ color: '#6b7280', fontSize: 12, padding: 8 }}>No servers in inventory yet. Add servers via Remote Discovery or Upload.</div>}
                {servers.map((s, i) => {
                  const host = s.hostname || s.name || s
                  const checked = form.servers.includes(host)
                  return (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', cursor: 'pointer', fontSize: 12, color: '#cbd5e1' }}>
                      <input type="checkbox" checked={checked} onChange={() => setField('servers', checked ? form.servers.filter(h => h !== host) : [...form.servers, host])} />
                      <span>{host}</span>
                      {s.os_name && <span style={{ color: '#6b7280', fontSize: 11 }}>· {s.os_name}</span>}
                    </label>
                  )
                })}
              </div>
            )}
            {form.target === 'all' && (
              <div style={{ color: '#6b7280', fontSize: 12, lineHeight: 1.5 }}>
                Every server currently in your on-premises inventory is re-scanned on each run.
                New servers added later are picked up automatically.
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modules (WHAT) ── */}
      {card(
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Settings size={15} style={{ color: '#60a5fa' }} /> What to scan
              <span style={{ color: '#6b7280', fontSize: 12, fontWeight: 400 }}>({selectedModuleCount}/{Object.keys(MODULE_LABELS).length})</span>
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAllModules(true)} style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 6, padding: '4px 10px', color: '#9ca3af', fontSize: 11, cursor: 'pointer' }}>Select all</button>
              <button onClick={() => setAllModules(false)} style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 6, padding: '4px 10px', color: '#9ca3af', fontSize: 11, cursor: 'pointer' }}>None</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
            {Object.entries(MODULE_LABELS).map(([k, label]) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
                background: form.modules[k] ? '#1e3a5f30' : '#0f172a', border: `1px solid ${form.modules[k] ? '#2563eb40' : '#1e293b'}`, color: form.modules[k] ? '#e2e8f0' : '#9ca3af' }}>
                <input type="checkbox" checked={!!form.modules[k]} onChange={() => toggleModule(k)} />
                {label}
              </label>
            ))}
          </div>
        </>
      )}

      {/* ── Actions ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={save} disabled={saving} style={{ background: '#2563eb', border: 'none', borderRadius: 8, padding: '10px 20px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: saving ? .7 : 1 }}>
          <Save size={15} /> {saving ? 'Saving…' : 'Save schedule'}
        </button>
        <button onClick={scanNow} disabled={running || sched?.is_running} style={{ background: '#065f46', border: 'none', borderRadius: 8, padding: '10px 20px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: (running || sched?.is_running) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: (running || sched?.is_running) ? .6 : 1 }}>
          <Play size={15} /> {sched?.is_running ? 'Scan running…' : running ? 'Starting…' : 'Scan now'}
        </button>
        <div style={{ alignSelf: 'center', color: '#6b7280', fontSize: 12 }}>
          {targetCount} server{targetCount === 1 ? '' : 's'} · {selectedModuleCount} module{selectedModuleCount === 1 ? '' : 's'} · {form.max_concurrent} at a time
        </div>
      </div>

      {/* ── History ── */}
      {history.length > 0 && card(
        <>
          <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart3 size={15} style={{ color: '#60a5fa' }} /> Recent runs
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid #334155' }}>
              <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>When</th>
              <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Trigger</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>Servers</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>Result</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>Status</th>
            </tr></thead>
            <tbody>{history.map((h, i) => {
              const [bg, fg] = STATUS_COLORS[h.status] || ['#374151', '#9ca3af']
              return (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: 6, color: '#cbd5e1' }}>{fmtDate(h.at)}</td>
                  <td style={{ padding: 6 }}>{pill(h.trigger === 'manual' ? '#1e3a5f' : '#374151', h.trigger === 'manual' ? '#60a5fa' : '#9ca3af', h.trigger || 'scheduled')}</td>
                  <td style={{ padding: 6, textAlign: 'center', color: '#60a5fa', fontWeight: 600 }}>{h.total ?? '—'}</td>
                  <td style={{ padding: 6, textAlign: 'center', color: '#9ca3af' }}>{h.succeeded != null ? `${h.succeeded} ok / ${h.failed || 0} fail` : '—'}</td>
                  <td style={{ padding: 6, textAlign: 'center' }}><span style={{ background: bg, color: fg, padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600 }}>{h.status}</span></td>
                </tr>
              )
            })}</tbody>
          </table>
        </>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*  OVERVIEW TAB                                                              */
/* ════════════════════════════════════════════════════════════════════════════ */
function OverviewTab({ summary, loading }) {
  const [engineStatus, setEngineStatus] = useState(null)

  useEffect(() => {
    api.getEngineStatus().then(setEngineStatus).catch(() => {})
    const iv = setInterval(() => api.getEngineStatus().then(setEngineStatus).catch(() => {}), 10000)
    return () => clearInterval(iv)
  }, [])

  if (loading) return <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>Loading summary...</div>
  if (!summary || summary.total_servers === 0) return <EmptyState />

  const s = summary
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Discovery Engine Status */}
      {engineStatus && engineStatus.status !== 'stopped' && (
        <div style={{ background: '#0c1929', border: '1px solid #1e3a5f', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: engineStatus.status === 'collecting' ? '#22c55e' : engineStatus.status === 'discovering' ? '#eab308' : engineStatus.status === 'error' ? '#ef4444' : '#3b82f6', animation: (engineStatus.status === 'collecting' || engineStatus.status === 'discovering') ? 'pulse 1.5s infinite' : 'none' }} />
          <div style={{ flex: 1, color: '#e2e8f0' }}>
            <span style={{ fontWeight: 600 }}>Discovery Engine: </span>
            <span style={{ color: '#93c5fd' }}>{engineStatus.status}</span>
            {engineStatus.current_phase && <span style={{ color: '#9ca3af' }}> ({engineStatus.current_phase.replace(/_/g, ' ')})</span>}
            {engineStatus.current_server && <span style={{ color: '#fbbf24' }}> → {engineStatus.current_server}</span>}
          </div>
          <div style={{ color: '#9ca3af', fontSize: 11 }}>
            Discovered: {engineStatus.servers_discovered} | Reachable: {engineStatus.servers_reachable} | Collected: {engineStatus.servers_collected}
          </div>
          <button onClick={() => api.triggerEngine()} style={{ background: '#1e3a5f', border: '1px solid #2563eb', borderRadius: 6, padding: '4px 10px', color: '#60a5fa', fontSize: 11, cursor: 'pointer' }}>
            Run Now
          </button>
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {statCard('Total Servers', s.total_servers, <Server size={16} />, '#60a5fa')}
        {statCard('Total Cores', s.total_cores, <BarChart3 size={16} />, '#a78bfa')}
        {statCard('Memory (GB)', s.total_memory_gb?.toLocaleString(), <Database size={16} />, '#34d399')}
        {statCard('Storage (GB)', s.total_storage_gb?.toLocaleString(), <Database size={16} />, '#fbbf24')}
        {statCard('Migration Ready', s.migration_candidates, <ArrowRight size={16} />, '#22d3ee')}
        {statCard('Security Issues', s.security_issues, <Shield size={16} />, s.security_issues > 0 ? '#ef4444' : '#34d399')}
      </div>

      {/* Two-column details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* OS Breakdown */}
        {card(
          <>
            <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>OS Distribution</h3>
            {Object.entries(s.os_breakdown || {}).map(([os, count]) => (
              <div key={os} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e293b' }}>
                <span style={{ color: '#cbd5e1', fontSize: 13 }}>{os}</span>
                <span style={{ color: '#60a5fa', fontWeight: 600, fontSize: 13 }}>{count}</span>
              </div>
            ))}
          </>
        )}

        {/* Workload Breakdown */}
        {card(
          <>
            <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Workload Types</h3>
            {Object.entries(s.workload_breakdown || {}).map(([wt, count]) => (
              <div key={wt} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e293b' }}>
                <span style={{ color: '#cbd5e1', fontSize: 13 }}>{wt}</span>
                <span style={{ color: '#a78bfa', fontWeight: 600, fontSize: 13 }}>{count}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Quick stats row */}
      <div style={{ display: 'flex', gap: 12 }}>
        {card(
          <div style={{ display: 'flex', justifyContent: 'space-around', gap: 20 }}>
            <div style={{ textAlign: 'center' }}><div style={{ color: '#60a5fa', fontSize: 20, fontWeight: 700 }}>{s.physical_servers}</div><div style={{ color: '#9ca3af', fontSize: 11 }}>Physical</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ color: '#a78bfa', fontSize: 20, fontWeight: 700 }}>{s.virtual_servers}</div><div style={{ color: '#9ca3af', fontSize: 11 }}>Virtual</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ color: '#34d399', fontSize: 20, fontWeight: 700 }}>{s.sql_instances_count}</div><div style={{ color: '#9ca3af', fontSize: 11 }}>SQL Instances</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ color: '#fbbf24', fontSize: 20, fontWeight: 700 }}>{s.iis_sites_count}</div><div style={{ color: '#9ca3af', fontSize: 11 }}>IIS Sites</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ color: '#f87171', fontSize: 20, fontWeight: 700 }}>{s.total_applications}</div><div style={{ color: '#9ca3af', fontSize: 11 }}>Applications</div></div>
          </div>,
          { flex: 1 }
        )}
      </div>

      {/* Upload History */}
      {s.upload_batches?.length > 0 && card(
        <>
          <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Upload History</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid #334155' }}>
              <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Batch</th>
              <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Date</th>
              <th style={{ textAlign: 'center', padding: 8, color: '#9ca3af' }}>Servers</th>
              <th style={{ textAlign: 'center', padding: 8, color: '#9ca3af' }}>Status</th>
              <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>File</th>
            </tr></thead>
            <tbody>{s.upload_batches.map(b => (
              <tr key={b.batch_id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: 8, color: '#cbd5e1' }}>{b.batch_id.slice(0, 20)}...</td>
                <td style={{ padding: 8, color: '#9ca3af' }}>{b.uploaded_at?.slice(0, 16)}</td>
                <td style={{ padding: 8, textAlign: 'center', color: '#60a5fa' }}>{b.server_count}</td>
                <td style={{ padding: 8, textAlign: 'center' }}>{pill(b.status === 'completed' ? '#065f46' : '#7f1d1d', b.status === 'completed' ? '#34d399' : '#fca5a5', b.status)}</td>
                <td style={{ padding: 8, color: '#9ca3af' }}>{b.filename}</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <Server size={48} style={{ color: '#334155', margin: '0 auto 16px' }} />
      <h3 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No On-Premises Data Yet</h3>
      <p style={{ color: '#9ca3af', fontSize: 14, maxWidth: 540, margin: '0 auto 24px' }}>
        Use <strong>Remote Discovery</strong> to connect directly to your servers via AD/WMI — no scripts needed. Or use Script Builder / Upload for offline collection.
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '16px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, border: '1px solid #2563eb' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#2563eb30', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa' }}><Search size={18} /></div>
          <span style={{ color: '#60a5fa', fontSize: 13, fontWeight: 600 }}>Remote Discovery</span>
          <span style={{ color: '#6b7280', fontSize: 11, maxWidth: 140, textAlign: 'center' }}>AD integration + WMI collection. No scripts required.</span>
        </div>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '16px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}><FileText size={18} /></div>
          <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>Script Builder</span>
          <span style={{ color: '#6b7280', fontSize: 11, maxWidth: 140, textAlign: 'center' }}>Generate & run scripts offline, upload ZIP.</span>
        </div>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '16px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}><Upload size={18} /></div>
          <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>Upload ZIP</span>
          <span style={{ color: '#6b7280', fontSize: 11, maxWidth: 140, textAlign: 'center' }}>Drag & drop previously collected data.</span>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*  SCRIPT BUILDER TAB                                                        */
/* ════════════════════════════════════════════════════════════════════════════ */
function ScriptBuilderTab() {
  const [options, setOptions] = useState({
    collect_hardware: true, collect_os: true, collect_applications: true,
    collect_services: true, collect_sql: true, collect_iis: true,
    collect_security: true, collect_certificates: true, collect_performance: true,
    target_scope: 'localhost', custom_server_list: [],
    credential_method: 'current', max_concurrent: 5, timeout_per_server: 300,
  })
  const [script, setScript] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [customServers, setCustomServers] = useState('')
  const [copied, setCopied] = useState(false)

  const toggle = key => setOptions(o => ({ ...o, [key]: !o[key] }))
  const setOpt = (key, val) => setOptions(o => ({ ...o, [key]: val }))

  const generate = async () => {
    setGenerating(true)
    try {
      const opts = { ...options }
      if (opts.target_scope === 'custom_list') {
        // Use smart backend parser for flexible server list input
        const parsed = await api.parseServerList(customServers)
        if (parsed.servers?.length === 0) {
          alert('No valid server names found. Check your input.'); setGenerating(false); return
        }
        opts.custom_server_list = parsed.servers
        if (parsed.invalid?.length > 0) {
          alert(`Note: ${parsed.invalid.length} invalid entries skipped: ${parsed.invalid.slice(0, 5).join(', ')}`)
        }
      }
      const result = await api.generateOnPremScript(opts)
      setScript(result.script)
    } catch (e) { alert('Failed: ' + e.message) }
    finally { setGenerating(false) }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(script)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadScript = () => {
    const blob = new Blob([script], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'Collect-ServerInventory.ps1'; a.click()
    URL.revokeObjectURL(url)
  }

  const modules = [
    { key: 'collect_hardware', label: 'Hardware & System', icon: '🖥️' },
    { key: 'collect_os', label: 'Operating System', icon: '💻' },
    { key: 'collect_applications', label: 'Applications', icon: '📦' },
    { key: 'collect_services', label: 'Windows Services', icon: '⚙️' },
    { key: 'collect_sql', label: 'SQL Server', icon: '🗄️' },
    { key: 'collect_iis', label: 'IIS Web Sites', icon: '🌐' },
    { key: 'collect_security', label: 'Security Posture', icon: '🔒' },
    { key: 'collect_certificates', label: 'Certificates', icon: '📜' },
    { key: 'collect_performance', label: 'Performance', icon: '📊' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Target Scope */}
        {card(
          <>
            <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🎯 Target Scope</h3>
            {['localhost', 'domain', 'custom_list'].map(scope => (
              <label key={scope} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer' }}>
                <input type="radio" name="scope" checked={options.target_scope === scope}
                  onChange={() => setOpt('target_scope', scope)}
                  style={{ accentColor: '#2563eb' }} />
                <span style={{ color: '#cbd5e1', fontSize: 13 }}>
                  {scope === 'localhost' ? 'Local Machine Only' : scope === 'domain' ? 'Active Directory Discovery' : 'Custom Server List'}
                </span>
              </label>
            ))}
            {options.target_scope === 'custom_list' && (
              <textarea value={customServers} onChange={e => setCustomServers(e.target.value)}
                placeholder="Paste server names — any separator works:&#10;server1, server2, server3&#10;server4; server5&#10;server6 server7&#10;192.168.1.10"
                style={{ width: '100%', marginTop: 8, padding: 8, background: '#0f172a', border: '1px solid #334155',
                  borderRadius: 8, color: '#e2e8f0', fontSize: 12, minHeight: 80, resize: 'vertical', fontFamily: 'monospace' }} />
            )}
          </>
        )}

        {/* Collection Settings */}
        {card(
          <>
            <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>⚙️ Settings</h3>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ color: '#9ca3af', fontSize: 11 }}>Max Concurrent</label>
                <input type="number" value={options.max_concurrent} onChange={e => setOpt('max_concurrent', parseInt(e.target.value) || 5)}
                  style={{ width: '100%', padding: 6, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ color: '#9ca3af', fontSize: 11 }}>Timeout (sec)</label>
                <input type="number" value={options.timeout_per_server} onChange={e => setOpt('timeout_per_server', parseInt(e.target.value) || 300)}
                  style={{ width: '100%', padding: 6, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12 }} />
              </div>
            </div>
            <div>
              <label style={{ color: '#9ca3af', fontSize: 11 }}>Credential Method</label>
              <select value={options.credential_method} onChange={e => setOpt('credential_method', e.target.value)}
                style={{ width: '100%', padding: 6, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12 }}>
                <option value="current">Current User</option>
                <option value="prompt">Prompt for Credentials</option>
              </select>
            </div>
          </>
        )}
      </div>

      {/* Module selection */}
      {card(
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>📋 Collection Modules</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setOptions(o => {
                const newOpts = { ...o }
                modules.forEach(m => { newOpts[m.key] = true })
                return newOpts
              })} style={{ padding: '4px 10px', background: '#1e3a5f', border: '1px solid #2563eb', borderRadius: 6, color: '#60a5fa', fontSize: 11, cursor: 'pointer' }}>Select All</button>
              <button onClick={() => setOptions(o => {
                const newOpts = { ...o }
                modules.forEach(m => { newOpts[m.key] = false })
                return newOpts
              })} style={{ padding: '4px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#9ca3af', fontSize: 11, cursor: 'pointer' }}>Deselect All</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {modules.map(m => (
              <label key={m.key} onClick={() => toggle(m.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                  background: options[m.key] ? '#1e3a5f' : '#0f172a',
                  border: `1px solid ${options[m.key] ? '#2563eb' : '#334155'}`,
                  borderRadius: 8, cursor: 'pointer', transition: 'all .15s' }}>
                <span style={{ fontSize: 16 }}>{m.icon}</span>
                <span style={{ color: options[m.key] ? '#93c5fd' : '#9ca3af', fontSize: 12, fontWeight: 500 }}>{m.label}</span>
                {options[m.key] && <CheckCircle size={14} style={{ marginLeft: 'auto', color: '#34d399' }} />}
              </label>
            ))}
          </div>
        </>
      )}

      {/* Generate button */}
      <button onClick={generate} disabled={generating}
        style={{ padding: '12px 24px', background: '#2563eb', border: 'none', borderRadius: 10,
          color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', gap: 8, opacity: generating ? 0.7 : 1 }}>
        {generating ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />}
        {generating ? 'Generating...' : 'Generate Collection Script'}
      </button>

      {/* Script output */}
      {script && card(
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>Generated PowerShell Script</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={copyToClipboard} style={{ padding: '6px 14px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: copied ? '#34d399' : '#9ca3af', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Copy size={12} /> {copied ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={downloadScript} style={{ padding: '6px 14px', background: '#1e3a5f', border: '1px solid #2563eb', borderRadius: 6, color: '#60a5fa', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Download size={12} /> Download .ps1
              </button>
            </div>
          </div>
          <pre style={{ background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 8, padding: 16,
            color: '#a5f3fc', fontSize: 11, lineHeight: 1.5, maxHeight: 500, overflow: 'auto',
            fontFamily: '"Cascadia Code", "Fira Code", monospace', whiteSpace: 'pre-wrap' }}>
            {script}
          </pre>
        </>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*  UPLOAD TAB                                                                */
/* ════════════════════════════════════════════════════════════════════════════ */
function UploadTab({ onUploaded }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [batches, setBatches] = useState([])
  const fileRef = React.useRef()

  useEffect(() => { api.getOnPremBatches().then(setBatches).catch(() => {}) }, [])

  const handleUpload = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.zip')) {
      alert('Please select a ZIP file'); return
    }
    setUploading(true); setResult(null)
    try {
      const res = await api.uploadOnPremZip(file)
      setResult(res)
      onUploaded?.()
      api.getOnPremBatches().then(setBatches).catch(() => {})
    } catch (e) { alert('Upload failed: ' + e.message) }
    finally { setUploading(false) }
  }

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) handleUpload(file)
  }

  const deleteBatch = async (batchId) => {
    if (!confirm('Delete this batch and all its server data?')) return
    try {
      await api.deleteOnPremBatch(batchId)
      setBatches(bs => bs.filter(b => b.batch_id !== batchId))
      onUploaded?.()
    } catch (e) { alert('Delete failed: ' + e.message) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? '#2563eb' : '#334155'}`,
          borderRadius: 16, padding: '48px 20px', textAlign: 'center', cursor: 'pointer',
          background: dragging ? '#1e3a5f20' : '#111827', transition: 'all .2s',
        }}>
        <input ref={fileRef} type="file" accept=".zip" style={{ display: 'none' }}
          onChange={e => handleUpload(e.target.files?.[0])} />
        <Upload size={40} style={{ color: dragging ? '#60a5fa' : '#334155', margin: '0 auto 12px' }} />
        <p style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
          {uploading ? 'Uploading...' : 'Drag & drop your collection ZIP here'}
        </p>
        <p style={{ color: '#6b7280', fontSize: 12 }}>or click to browse — accepts ZIP files up to 100 MB</p>
      </div>

      {/* Upload result */}
      {result && card(
        <>
          <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
            {result.errors?.length ? '⚠️ Upload Completed with Issues' : '✅ Upload Successful'}
          </h3>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <div><span style={{ color: '#9ca3af', fontSize: 12 }}>Batch:</span> <span style={{ color: '#60a5fa', fontSize: 12 }}>{result.batch_id}</span></div>
            <div><span style={{ color: '#9ca3af', fontSize: 12 }}>Servers:</span> <span style={{ color: '#34d399', fontSize: 12, fontWeight: 700 }}>{result.server_count}</span></div>
          </div>
          {result.servers?.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Hostname</th>
                <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>OS</th>
                <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Type</th>
                <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Target</th>
              </tr></thead>
              <tbody>{result.servers.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: 6, color: '#e2e8f0' }}>{s.hostname}</td>
                  <td style={{ padding: 6, color: '#9ca3af' }}>{s.os_name}</td>
                  <td style={{ padding: 6 }}>{pill('#1e3a5f', '#60a5fa', s.workload_type)}</td>
                  <td style={{ padding: 6 }}>{pill('#064e3b', '#34d399', s.migration_target)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {result.warnings?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {result.warnings.map((w, i) => (
                <div key={i} style={{ color: '#fbbf24', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle size={12} /> {w}
                </div>
              ))}
            </div>
          )}
          {result.errors?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {result.errors.map((e, i) => (
                <div key={i} style={{ color: '#f87171', fontSize: 11 }}>❌ {e}</div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Batch history */}
      {batches.length > 0 && card(
        <>
          <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Upload History</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid #334155' }}>
              <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Batch ID</th>
              <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Date</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>Servers</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>Status</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>Actions</th>
            </tr></thead>
            <tbody>{batches.map(b => (
              <tr key={b.batch_id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: 6, color: '#cbd5e1' }}>{b.batch_id.slice(0, 25)}...</td>
                <td style={{ padding: 6, color: '#9ca3af' }}>{b.uploaded_at?.slice(0, 16)}</td>
                <td style={{ padding: 6, textAlign: 'center', color: '#60a5fa', fontWeight: 600 }}>{b.server_count}</td>
                <td style={{ padding: 6, textAlign: 'center' }}>{pill(b.status === 'completed' ? '#065f46' : '#7f1d1d', b.status === 'completed' ? '#34d399' : '#fca5a5', b.status)}</td>
                <td style={{ padding: 6, textAlign: 'center' }}>
                  <button onClick={() => deleteBatch(b.batch_id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*  REMOTE DISCOVERY TAB — AD Integration, WMI Collection, Smart Input       */
/* ════════════════════════════════════════════════════════════════════════════ */
function RemoteDiscoveryTab({ onCollected }) {
  const [step, setStep] = useState('source')  // source, servers, config, collecting, results
  const [serverList, setServerList] = useState([])
  const [selectedServers, setSelectedServers] = useState(new Set())
  const [connectivityResults, setConnectivityResults] = useState({})
  const [modules, setModules] = useState({
    hardware: true, os: true, disks: true, network: true, services: true,
    applications: true, sql: true, iis: true, security: true, certificates: true, roles: true
  })
  const [jobId, setJobId] = useState(null)
  const [jobStatus, setJobStatus] = useState(null)
  const [collectionOptions, setCollectionOptions] = useState({ max_concurrent: 5, timeout_per_server: 180 })
  const [prerequisites, setPrerequisites] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  // Check prerequisites on mount
  useEffect(() => {
    api.getOnPremPrerequisites().then(setPrerequisites).catch(() => {})
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // ── Source Step ─────────────────────────────────────────────────────────
  if (step === 'source') return <SourceStep
    prerequisites={prerequisites}
    onServersFound={(servers) => {
      setServerList(servers)
      setSelectedServers(new Set(servers.map(s => s.name || s)))
      setStep('servers')
    }}
    setError={setError}
    error={error}
    loading={loading}
    setLoading={setLoading}
  />

  // ── Server Selection Step ──────────────────────────────────────────────
  if (step === 'servers') return <ServerSelectionStep
    servers={serverList}
    selected={selectedServers}
    setSelected={setSelectedServers}
    connectivity={connectivityResults}
    onTestConnectivity={async () => {
      setLoading(true)
      try {
        const names = [...selectedServers]
        const result = await api.testConnectivity(names)
        const map = {}
        ;(result.results || []).forEach(r => { map[r.server] = r })
        setConnectivityResults(map)
      } catch (e) { setError(e.message) }
      finally { setLoading(false) }
    }}
    onNext={() => setStep('config')}
    onBack={() => { setStep('source'); setConnectivityResults({}) }}
    loading={loading}
    error={error}
  />

  // ── Config Step ────────────────────────────────────────────────────────
  if (step === 'config') return <ConfigStep
    modules={modules}
    setModules={setModules}
    options={collectionOptions}
    setOptions={setCollectionOptions}
    serverCount={selectedServers.size}
    onStart={async () => {
      setLoading(true); setError(null)
      try {
        const result = await api.startRemoteCollection(
          [...selectedServers], modules, collectionOptions
        )
        if (result.error) { setError(result.error); setLoading(false); return }
        setJobId(result.job_id)
        setStep('collecting')
        // Start polling
        pollRef.current = setInterval(async () => {
          try {
            const status = await api.getCollectionStatus(result.job_id)
            setJobStatus(status)
            if (status.status === 'completed' || status.status === 'error' || status.status === 'cancelled') {
              clearInterval(pollRef.current)
              pollRef.current = null
              onCollected?.()
            }
          } catch {}
        }, 2000)
      } catch (e) { setError(e.message) }
      finally { setLoading(false) }
    }}
    onBack={() => setStep('servers')}
  />

  // ── Collecting Step ────────────────────────────────────────────────────
  if (step === 'collecting') return <CollectingStep
    jobStatus={jobStatus}
    jobId={jobId}
    onCancel={async () => {
      try {
        await api.cancelCollection(jobId)
      } catch {}
    }}
    onDone={() => setStep('results')}
  />

  // ── Results Step ───────────────────────────────────────────────────────
  if (step === 'results') return <ResultsStep
    jobStatus={jobStatus}
    onNewCollection={() => {
      setStep('source')
      setServerList([])
      setSelectedServers(new Set())
      setConnectivityResults({})
      setJobId(null)
      setJobStatus(null)
    }}
  />

  return null
}

/* ── Source Selection ────────────────────────────────────────────────────── */
function SourceStep({ prerequisites, onServersFound, setError, error, loading, setLoading }) {
  const [inputMode, setInputMode] = useState(null) // 'ad', 'manual', 'file'
  const [manualInput, setManualInput] = useState('')
  const [adFilters, setAdFilters] = useState({ name_filter: '', os_filter: 'Server', ou_filter: '' })
  const [ldapStatus, setLdapStatus] = useState(null)
  const [ous, setOus] = useState(null)
  const [loadingOUs, setLoadingOUs] = useState(false)
  const fileRef = useRef()

  // Check LDAP status on mount
  useEffect(() => {
    api.ldapStatus().then(setLdapStatus).catch(() => {})
  }, [])

  const browseOUs = async () => {
    setLoadingOUs(true)
    try {
      const result = await api.ldapGetOUs()
      if (result.success) setOus(result.ous || [])
      else setError(result.error || 'Failed to browse OUs')
    } catch (e) { setError(e.message) }
    finally { setLoadingOUs(false) }
  }

  const discoverAD = async () => {
    setLoading(true); setError(null)
    try {
      // Use LDAP-based discovery if configured, fallback to PowerShell AD
      if (ldapStatus?.configured) {
        const params = {
          name_filter: adFilters.name_filter,
          os_filter: adFilters.os_filter,
          server_os_only: 'true',
          enabled_only: 'true',
        }
        if (adFilters.ou_filter) params.ou_filter = adFilters.ou_filter
        const result = await api.ldapDiscoverGet(params)
        if (!result.success) {
          setError(result.error || 'LDAP discovery failed')
          return
        }
        if (!result.computers?.length) {
          setError('No computers found matching the filters.')
          return
        }
        onServersFound(result.computers)
      } else {
        // Fallback to PowerShell AD module
        const result = await api.discoverADComputers(adFilters)
        if (!result.success) {
          setError(result.error + (result.hint ? `\n\n💡 ${result.hint}` : ''))
          return
        }
        if (!result.computers?.length) {
          setError('No computers found matching the filters.')
          return
        }
        onServersFound(result.computers)
      }
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const parseManualInput = async () => {
    if (!manualInput.trim()) { setError('Enter at least one server name.'); return }
    setLoading(true); setError(null)
    try {
      const result = await api.parseServerList(manualInput)
      if (!result.servers?.length) {
        setError(`No valid server names found.${result.invalid?.length ? ` Invalid entries: ${result.invalid.join(', ')}` : ''}`)
        return
      }
      onServersFound(result.servers)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleFile = async (file) => {
    if (!file) return
    setLoading(true); setError(null)
    try {
      const result = await api.uploadServerFile(file)
      if (!result.servers?.length) {
        setError(result.error || 'No valid server names found in file.')
        return
      }
      onServersFound(result.servers)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Prerequisites banner */}
      {prerequisites && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: 12, display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
          <Monitor size={16} style={{ color: '#60a5fa', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ color: '#cbd5e1' }}>Running as: </span>
            <span style={{ color: '#60a5fa', fontWeight: 500 }}>{prerequisites.username}</span>
            <span style={{ color: '#4b5563' }}> • </span>
            <span style={{ color: prerequisites.is_domain_joined ? '#34d399' : '#fbbf24' }}>
              {prerequisites.is_domain_joined ? `Domain: ${prerequisites.domain_name}` : 'Not domain-joined'}
            </span>
            <span style={{ color: '#4b5563' }}> • </span>
            <span style={{ color: prerequisites.ad_module_available ? '#34d399' : '#6b7280' }}>
              AD Module: {prerequisites.ad_module_available ? '✓' : '✗'}
            </span>
            <span style={{ color: '#4b5563' }}> • </span>
            <span style={{ color: prerequisites.is_admin ? '#34d399' : '#fbbf24' }}>
              Admin: {prerequisites.is_admin ? '✓' : '✗'}
            </span>
          </div>
        </div>
      )}

      {/* Source selection cards */}
      {!inputMode && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <button onClick={() => setInputMode('ad')} style={{
            background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: '24px 16px',
            cursor: 'pointer', textAlign: 'center', transition: 'all .15s',
          }}
            onMouseOver={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.background = '#1e293b' }}
            onMouseOut={e => { e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.background = '#111827' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: '#1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <Globe size={24} style={{ color: '#60a5fa' }} />
            </div>
            <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Active Directory</div>
            <div style={{ color: '#9ca3af', fontSize: 12 }}>Auto-discover all domain-joined machines. Requires AD RSAT module.</div>
          </button>

          <button onClick={() => setInputMode('manual')} style={{
            background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: '24px 16px',
            cursor: 'pointer', textAlign: 'center', transition: 'all .15s',
          }}
            onMouseOver={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.background = '#1e293b' }}
            onMouseOut={e => { e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.background = '#111827' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: '#1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <FileText size={24} style={{ color: '#60a5fa' }} />
            </div>
            <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Manual Input</div>
            <div style={{ color: '#9ca3af', fontSize: 12 }}>Paste server names with any separator: comma, semicolon, space, or newline.</div>
          </button>

          <button onClick={() => setInputMode('file')} style={{
            background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: '24px 16px',
            cursor: 'pointer', textAlign: 'center', transition: 'all .15s',
          }}
            onMouseOver={e => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.background = '#1e293b' }}
            onMouseOut={e => { e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.background = '#111827' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: '#1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <Upload size={24} style={{ color: '#60a5fa' }} />
            </div>
            <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Upload File</div>
            <div style={{ color: '#9ca3af', fontSize: 12 }}>Upload a .txt or .csv file with server names (one per line or delimited).</div>
          </button>
        </div>
      )}

      {/* AD Discovery form */}
      {inputMode === 'ad' && card(
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>🏢 Active Directory Discovery</h3>
            <button onClick={() => setInputMode(null)} style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 12 }}>← Back</button>
          </div>
          {/* LDAP status indicator */}
          {ldapStatus && (
            <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, display: 'flex', alignItems: 'center', gap: 8,
              background: ldapStatus.connected ? '#052e16' : ldapStatus.configured ? '#451a03' : '#1e1b4b',
              border: `1px solid ${ldapStatus.connected ? '#16a34a' : ldapStatus.configured ? '#d97706' : '#4338ca'}`,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: ldapStatus.connected ? '#22c55e' : ldapStatus.configured ? '#f59e0b' : '#6366f1' }} />
              <span style={{ color: '#e2e8f0' }}>
                {ldapStatus.connected ? 'LDAP Connected — using direct LDAP discovery' : ldapStatus.configured ? 'LDAP configured but connection failed — will use PowerShell fallback' : 'LDAP not configured — using PowerShell AD module. Configure in Settings → On-Premises for remote discovery.'}
              </span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ color: '#9ca3af', fontSize: 11 }}>Computer Name Filter (wildcard)</label>
              <input value={adFilters.name_filter} onChange={e => setAdFilters(f => ({ ...f, name_filter: e.target.value }))}
                placeholder="SRV* or leave empty for all"
                style={{ width: '100%', padding: 8, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12 }} />
            </div>
            <div>
              <label style={{ color: '#9ca3af', fontSize: 11 }}>OS Filter</label>
              <input value={adFilters.os_filter} onChange={e => setAdFilters(f => ({ ...f, os_filter: e.target.value }))}
                placeholder="Server (filters to Windows Server)"
                style={{ width: '100%', padding: 8, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12 }} />
            </div>
          </div>
          {/* OU Filter */}
          <div>
            <label style={{ color: '#9ca3af', fontSize: 11 }}>Organizational Unit (OU)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {ous ? (
                <select value={adFilters.ou_filter} onChange={e => setAdFilters(f => ({ ...f, ou_filter: e.target.value }))}
                  style={{ flex: 1, padding: 8, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12 }}>
                  <option value="">All OUs (entire domain)</option>
                  {ous.map(ou => (
                    <option key={ou.dn} value={ou.dn}>{ou.name} ({ou.computer_count} computers)</option>
                  ))}
                </select>
              ) : (
                <input value={adFilters.ou_filter} onChange={e => setAdFilters(f => ({ ...f, ou_filter: e.target.value }))}
                  placeholder="OU=Servers,DC=corp,DC=contoso,DC=com (or Browse)"
                  style={{ flex: 1, padding: 8, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12 }} />
              )}
              {ldapStatus?.configured && (
                <button onClick={browseOUs} disabled={loadingOUs}
                  style={{ padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#9ca3af', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap', opacity: loadingOUs ? 0.6 : 1 }}>
                  {loadingOUs ? '...' : 'Browse OUs'}
                </button>
              )}
            </div>
            <p style={{ color: '#6b7280', fontSize: 10, marginTop: 4 }}>Limit discovery to a specific OU. Leave empty to search entire domain.</p>
          </div>
          <button onClick={discoverAD} disabled={loading}
            style={{ padding: '10px 20px', background: '#2563eb', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', opacity: loading ? 0.7 : 1 }}>
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            {loading ? 'Discovering...' : 'Discover Computers'}
          </button>
        </div>
      )}

      {/* Manual Input form */}
      {inputMode === 'manual' && card(
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>📝 Enter Server Names</h3>
            <button onClick={() => setInputMode(null)} style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 12 }}>← Back</button>
          </div>
          <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>
            Paste server names using <strong>any separator</strong>: comma, semicolon, space, newline, tab, or pipe. Supports hostnames, FQDNs, and IP addresses.
          </p>
          <textarea value={manualInput} onChange={e => setManualInput(e.target.value)}
            placeholder="server1, server2, server3&#10;server4.domain.com; server5&#10;192.168.1.10 192.168.1.11&#10;# Lines starting with # are ignored"
            style={{ width: '100%', padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 12, minHeight: 150, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.6 }} />
          <button onClick={parseManualInput} disabled={loading || !manualInput.trim()}
            style={{ padding: '10px 20px', background: '#2563eb', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', opacity: (loading || !manualInput.trim()) ? 0.6 : 1 }}>
            {loading ? <RefreshCw size={14} /> : <ArrowRight size={14} />}
            {loading ? 'Parsing...' : 'Parse & Continue'}
          </button>
        </div>
      )}

      {/* File Upload */}
      {inputMode === 'file' && card(
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>📄 Upload Server List File</h3>
            <button onClick={() => setInputMode(null)} style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 12 }}>← Back</button>
          </div>
          <div onClick={() => fileRef.current?.click()}
            style={{ border: '2px dashed #334155', borderRadius: 12, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', background: '#0f172a' }}>
            <input ref={fileRef} type="file" accept=".txt,.csv,.text" style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files?.[0])} />
            <Upload size={28} style={{ color: '#334155', margin: '0 auto 8px' }} />
            <p style={{ color: '#e2e8f0', fontSize: 13, margin: '0 0 4px' }}>Click to select a .txt or .csv file</p>
            <p style={{ color: '#6b7280', fontSize: 11, margin: 0 }}>One server per line, or any delimiter (comma, semicolon, etc.)</p>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={{ background: '#7f1d1d', border: '1px solid #991b1b', borderRadius: 8, padding: 12, color: '#fca5a5', fontSize: 12, whiteSpace: 'pre-wrap' }}>
          <AlertTriangle size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
          {error}
        </div>
      )}
    </div>
  )
}

/* ── Server Selection Step ─────────────────────────────────────────────── */
function ServerSelectionStep({ servers, selected, setSelected, connectivity, onTestConnectivity, onNext, onBack, loading, error }) {
  const [filter, setFilter] = useState('')

  const toggleServer = (name) => {
    const s = new Set(selected)
    if (s.has(name)) s.delete(name); else s.add(name)
    setSelected(s)
  }

  const selectAll = () => setSelected(new Set(servers.map(s => typeof s === 'string' ? s : s.name || s.dns_hostname)))
  const deselectAll = () => setSelected(new Set())
  const selectReachable = () => {
    const reachable = Object.entries(connectivity).filter(([, v]) => v.ping || v.winrm || v.wmi).map(([k]) => k)
    if (reachable.length) setSelected(new Set(reachable))
  }

  const getServerName = (s) => typeof s === 'string' ? s : (s.dns_hostname || s.name || '')
  const getServerOS = (s) => typeof s === 'string' ? '' : (s.os || '')
  const getServerIP = (s) => typeof s === 'string' ? '' : (s.ip_address || '')
  const getServerLastLogon = (s) => typeof s === 'string' ? '' : (s.last_logon || '')
  const isEnabled = (s) => typeof s === 'string' ? true : (s.enabled !== false)

  const filtered = servers.filter(s => {
    if (!filter) return true
    const q = filter.toLowerCase()
    const name = getServerName(s).toLowerCase()
    const os = getServerOS(s).toLowerCase()
    return name.includes(q) || os.includes(q)
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600, margin: 0 }}>Select Servers to Scan</h3>
          <p style={{ color: '#9ca3af', fontSize: 12, margin: '4px 0 0' }}>{servers.length} discovered • {selected.size} selected</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={selectAll} style={{ padding: '5px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#9ca3af', fontSize: 11, cursor: 'pointer' }}>Select All</button>
          <button onClick={deselectAll} style={{ padding: '5px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#9ca3af', fontSize: 11, cursor: 'pointer' }}>Deselect All</button>
          {Object.keys(connectivity).length > 0 && (
            <button onClick={selectReachable} style={{ padding: '5px 12px', background: '#064e3b', border: '1px solid #065f46', borderRadius: 6, color: '#34d399', fontSize: 11, cursor: 'pointer' }}>Select Reachable</button>
          )}
        </div>
      </div>

      {/* Filter */}
      <input value={filter} onChange={e => setFilter(e.target.value)}
        placeholder="🔍 Filter servers..."
        style={{ padding: '8px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 12 }} />

      {/* Server table */}
      <div style={{ maxHeight: 400, overflow: 'auto', border: '1px solid #1e293b', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ borderBottom: '2px solid #334155', position: 'sticky', top: 0, background: '#111827' }}>
            <th style={{ padding: 8, width: 32 }}></th>
            <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Server</th>
            <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>OS</th>
            <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>IP</th>
            <th style={{ textAlign: 'center', padding: 8, color: '#9ca3af' }}>Status</th>
            <th style={{ textAlign: 'center', padding: 8, color: '#9ca3af' }}>Connectivity</th>
          </tr></thead>
          <tbody>{filtered.map((s, i) => {
            const name = getServerName(s)
            const conn = connectivity[name]
            return (
              <tr key={i}
                onClick={() => toggleServer(name)} style={{ borderBottom: '1px solid #1e293b', cursor: 'pointer' }}
                onMouseOver={e => e.currentTarget.style.background = '#1e293b'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: 8, textAlign: 'center' }}>
                  <input type="checkbox" checked={selected.has(name)} onChange={() => toggleServer(name)}
                    style={{ accentColor: '#2563eb' }} />
                </td>
                <td style={{ padding: 8, color: '#60a5fa', fontWeight: 500 }}>{name}</td>
                <td style={{ padding: 8, color: '#cbd5e1' }}>{getServerOS(s)?.replace('Microsoft ', '').slice(0, 35)}</td>
                <td style={{ padding: 8, color: '#9ca3af' }}>{getServerIP(s)}</td>
                <td style={{ padding: 8, textAlign: 'center' }}>
                  {isEnabled(s) ? pill('#065f46', '#34d399', 'Enabled') : pill('#7f1d1d', '#fca5a5', 'Disabled')}
                </td>
                <td style={{ padding: 8, textAlign: 'center' }}>
                  {conn ? (
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <span title="Ping" style={{ color: conn.ping ? '#34d399' : '#ef4444', fontSize: 10 }}>{conn.ping ? '●' : '○'}</span>
                      <span title="WinRM" style={{ color: conn.winrm ? '#34d399' : '#fbbf24', fontSize: 10 }}>{conn.winrm ? '●' : '○'}</span>
                      <span title="WMI" style={{ color: conn.wmi ? '#34d399' : '#fbbf24', fontSize: 10 }}>{conn.wmi ? '●' : '○'}</span>
                    </div>
                  ) : <span style={{ color: '#4b5563', fontSize: 11 }}>—</span>}
                </td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>

      {/* Legend for connectivity */}
      {Object.keys(connectivity).length > 0 && (
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#9ca3af' }}>
          <span>● Ping</span><span>● WinRM</span><span>● WMI/CIM</span>
          <span style={{ color: '#34d399' }}>● = OK</span>
          <span style={{ color: '#fbbf24' }}>○ = Unavailable</span>
          <span style={{ color: '#ef4444' }}>○ = Failed</span>
        </div>
      )}

      {error && <div style={{ background: '#7f1d1d', border: '1px solid #991b1b', borderRadius: 8, padding: 10, color: '#fca5a5', fontSize: 12 }}>{error}</div>}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <button onClick={onBack} style={{ padding: '8px 16px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#9ca3af', fontSize: 12, cursor: 'pointer' }}>← Back</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onTestConnectivity} disabled={loading || selected.size === 0}
            style={{ padding: '8px 16px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#fbbf24', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: loading ? 0.6 : 1 }}>
            <Wifi size={12} /> {loading ? 'Testing...' : 'Test Connectivity'}
          </button>
          <button onClick={onNext} disabled={selected.size === 0}
            style={{ padding: '8px 16px', background: '#2563eb', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: selected.size === 0 ? 0.5 : 1 }}>
            Configure Collection <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Config Step ──────────────────────────────────────────────────────── */
function ConfigStep({ modules, setModules, options, setOptions, serverCount, onStart, onBack }) {
  const toggleMod = k => setModules(m => ({ ...m, [k]: !m[k] }))

  const moduleList = [
    { key: 'hardware', label: 'Hardware & System', icon: '🖥️' },
    { key: 'os', label: 'Operating System', icon: '💻' },
    { key: 'disks', label: 'Disk Storage', icon: '💿' },
    { key: 'network', label: 'Network Config', icon: '🌐' },
    { key: 'services', label: 'Windows Services', icon: '⚙️' },
    { key: 'applications', label: 'Installed Apps', icon: '📦' },
    { key: 'sql', label: 'SQL Server', icon: '🗄️' },
    { key: 'iis', label: 'IIS Web Sites', icon: '🌍' },
    { key: 'security', label: 'Security & Firewall', icon: '🔒' },
    { key: 'certificates', label: 'Certificates', icon: '📜' },
    { key: 'roles', label: 'Server Roles', icon: '🏷️' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600, margin: 0 }}>Configure Collection — {serverCount} servers</h3>
      </div>

      {/* Module selection */}
      {card(
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, margin: 0 }}>Collection Modules</h4>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setModules(Object.fromEntries(moduleList.map(m => [m.key, true])))}
                style={{ padding: '3px 10px', background: '#1e3a5f', border: '1px solid #2563eb', borderRadius: 6, color: '#60a5fa', fontSize: 10, cursor: 'pointer' }}>All</button>
              <button onClick={() => setModules(Object.fromEntries(moduleList.map(m => [m.key, false])))}
                style={{ padding: '3px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#9ca3af', fontSize: 10, cursor: 'pointer' }}>None</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {moduleList.map(m => (
              <label key={m.key} onClick={() => toggleMod(m.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px',
                  background: modules[m.key] ? '#1e3a5f' : '#0f172a',
                  border: `1px solid ${modules[m.key] ? '#2563eb' : '#334155'}`,
                  borderRadius: 8, cursor: 'pointer', transition: 'all .15s' }}>
                <span style={{ fontSize: 14 }}>{m.icon}</span>
                <span style={{ color: modules[m.key] ? '#93c5fd' : '#9ca3af', fontSize: 11 }}>{m.label}</span>
                {modules[m.key] && <CheckCircle size={12} style={{ marginLeft: 'auto', color: '#34d399' }} />}
              </label>
            ))}
          </div>
        </>
      )}

      {/* Settings */}
      {card(
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ color: '#9ca3af', fontSize: 11 }}>Max Concurrent Connections</label>
            <input type="number" value={options.max_concurrent} onChange={e => setOptions(o => ({ ...o, max_concurrent: Math.min(20, Math.max(1, parseInt(e.target.value) || 5)) }))}
              style={{ width: '100%', padding: 6, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12 }} />
            <span style={{ color: '#6b7280', fontSize: 10 }}>Parallel servers (1-20)</span>
          </div>
          <div>
            <label style={{ color: '#9ca3af', fontSize: 11 }}>Timeout per Server (seconds)</label>
            <input type="number" value={options.timeout_per_server} onChange={e => setOptions(o => ({ ...o, timeout_per_server: Math.min(600, Math.max(30, parseInt(e.target.value) || 180)) }))}
              style={{ width: '100%', padding: 6, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12 }} />
            <span style={{ color: '#6b7280', fontSize: 10 }}>30-600 seconds</span>
          </div>
        </div>
      )}

      {/* Estimated time */}
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12, fontSize: 12, color: '#9ca3af' }}>
        ⏱️ Estimated time: ~{Math.ceil(serverCount / options.max_concurrent) * 30}–{Math.ceil(serverCount / options.max_concurrent) * 60}s
        ({serverCount} servers, {options.max_concurrent} concurrent)
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <button onClick={onBack} style={{ padding: '8px 16px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#9ca3af', fontSize: 12, cursor: 'pointer' }}>← Back</button>
        <button onClick={onStart}
          style={{ padding: '10px 24px', background: '#059669', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Play size={14} /> Start Collection
        </button>
      </div>
    </div>
  )
}

/* ── Collecting Progress ──────────────────────────────────────────────── */
function CollectingStep({ jobStatus, jobId, onCancel, onDone }) {
  if (!jobStatus) return <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>Starting collection...</div>

  const { total, completed, succeeded, failed, status, servers_status, current_server } = jobStatus
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const isRunning = status === 'running'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Progress header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>
              {isRunning ? '🔄 Collecting Data...' : status === 'completed' ? '✅ Collection Complete' : status === 'cancelled' ? '⛔ Cancelled' : '❌ Error'}
            </span>
            <span style={{ color: '#9ca3af', fontSize: 12 }}>{completed}/{total} servers ({pct}%)</span>
          </div>
          {/* Progress bar */}
          <div style={{ background: '#1e293b', borderRadius: 6, height: 8, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 6, transition: 'width 0.5s ease',
              width: `${pct}%`,
              background: status === 'completed' ? '#059669' : status === 'error' ? '#dc2626' : '#2563eb'
            }} />
          </div>
        </div>
        {isRunning && (
          <button onClick={onCancel} style={{ padding: '6px 14px', background: '#7f1d1d', border: '1px solid #991b1b', borderRadius: 8, color: '#fca5a5', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Square size={12} /> Cancel
          </button>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12 }}>
        {statCard('Succeeded', succeeded, <CheckCircle size={14} />, '#34d399')}
        {statCard('Failed', failed, <AlertTriangle size={14} />, '#ef4444')}
        {statCard('Remaining', total - completed, <RefreshCw size={14} />, '#60a5fa')}
      </div>

      {/* Current activity */}
      {isRunning && current_server && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 10, fontSize: 12, color: '#60a5fa' }}>
          ⚡ Currently collecting: <strong>{current_server}</strong>
        </div>
      )}

      {/* Per-server status grid */}
      {servers_status && (
        <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #1e293b', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ borderBottom: '1px solid #334155', position: 'sticky', top: 0, background: '#111827' }}>
              <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Server</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>Status</th>
              <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Error</th>
            </tr></thead>
            <tbody>{Object.entries(servers_status).map(([server, info]) => (
              <tr key={server} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: 6, color: '#cbd5e1' }}>{server}</td>
                <td style={{ padding: 6, textAlign: 'center' }}>
                  {info.status === 'success' && pill('#065f46', '#34d399', '✓ Done')}
                  {info.status === 'failed' && pill('#7f1d1d', '#fca5a5', '✗ Failed')}
                  {info.status === 'collecting' && pill('#1e3a5f', '#60a5fa', '⟳ Collecting')}
                  {info.status === 'queued' && pill('#1e293b', '#9ca3af', '⏳ Queued')}
                  {info.status === 'pending' && pill('#1e293b', '#6b7280', '○ Pending')}
                </td>
                <td style={{ padding: 6, color: '#f87171', fontSize: 10, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {info.error || ''}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* Done button */}
      {!isRunning && (
        <button onClick={onDone}
          style={{ padding: '10px 24px', background: '#2563eb', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 8 }}>
          View Results <ArrowRight size={14} />
        </button>
      )}
    </div>
  )
}

/* ── Results Step ─────────────────────────────────────────────────────── */
function ResultsStep({ jobStatus, onNewCollection }) {
  if (!jobStatus) return null

  const { total, succeeded, failed, batch_id, started_at, finished_at } = jobStatus
  const duration = started_at && finished_at
    ? Math.round((new Date(finished_at) - new Date(started_at)) / 1000)
    : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', padding: '40px 20px' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: succeeded > 0 ? '#065f4630' : '#7f1d1d30',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `2px solid ${succeeded > 0 ? '#34d399' : '#ef4444'}` }}>
        {succeeded > 0 ? <CheckCircle size={28} style={{ color: '#34d399' }} /> : <AlertTriangle size={28} style={{ color: '#ef4444' }} />}
      </div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, margin: 0 }}>Collection Complete</h3>
      <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
        {succeeded} of {total} servers collected successfully in {duration}s
        {failed > 0 && <span style={{ color: '#fca5a5' }}> • {failed} failed</span>}
      </p>

      <div style={{ display: 'flex', gap: 12 }}>
        {statCard('Collected', succeeded, <CheckCircle size={14} />, '#34d399')}
        {statCard('Failed', failed, <AlertTriangle size={14} />, '#ef4444')}
        {statCard('Duration', `${duration}s`, <RefreshCw size={14} />, '#60a5fa')}
      </div>

      {batch_id && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
          Data stored as batch: <span style={{ color: '#60a5fa' }}>{batch_id}</span>
          <br /><span style={{ fontSize: 11 }}>View results in the <strong>Inventory</strong>, <strong>Migration</strong>, or <strong>AI Analysis</strong> tabs.</span>
        </div>
      )}

      <button onClick={onNewCollection}
        style={{ padding: '10px 24px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
        <RefreshCw size={14} /> New Collection
      </button>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*  INVENTORY TAB                                                             */
/* ════════════════════════════════════════════════════════════════════════════ */
function InventoryTab() {
  const [data, setData] = useState({ servers: [], total: 0, total_unfiltered: 0, facets: {} })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [roles, setRoles] = useState(null)
  const [filters, setFilters] = useState({ search: '', workload_type: '', os_filter: '', complexity: '', migration_target: '', has_sql: null, has_iis: null })
  const [sortBy, setSortBy] = useState('hostname')
  const [sortDir, setSortDir] = useState('asc')
  const [view, setView] = useState('table') // table | cards | roles

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.search) params.set('search', filters.search)
      if (filters.workload_type) params.set('workload_type', filters.workload_type)
      if (filters.os_filter) params.set('os_filter', filters.os_filter)
      if (filters.complexity) params.set('complexity', filters.complexity)
      if (filters.migration_target) params.set('migration_target', filters.migration_target)
      if (filters.has_sql !== null) params.set('has_sql', filters.has_sql)
      if (filters.has_iis !== null) params.set('has_iis', filters.has_iis)
      params.set('sort_by', sortBy)
      params.set('sort_dir', sortDir)
      const resp = await fetch(`/api/onprem/inventory?${params}`)
      const json = await resp.json()
      setData(json)
    } catch { }
    finally { setLoading(false) }
  }, [filters, sortBy, sortDir])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    fetch('/api/onprem/roles').then(r => r.json()).then(setRoles).catch(() => {})
  }, [])

  if (selected) return <ServerDetail server={selected} onBack={() => setSelected(null)} />

  const facets = data.facets || {}
  const updateFilter = (key, val) => setFilters(f => ({ ...f, [key]: val }))
  const clearFilters = () => setFilters({ search: '', workload_type: '', os_filter: '', complexity: '', migration_target: '', has_sql: null, has_iis: null })
  const hasActiveFilters = filters.search || filters.workload_type || filters.os_filter || filters.complexity || filters.migration_target || filters.has_sql !== null || filters.has_iis !== null

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }
  const sortIcon = (col) => sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const selectStyle = { padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12, minWidth: 120 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* View toggle + search */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155' }}>
          {[['table', '☰'], ['cards', '◫'], ['roles', '🏷️']].map(([v, icon]) => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '6px 12px', background: view === v ? '#2563eb' : '#0f172a', border: 'none', color: view === v ? '#fff' : '#9ca3af', cursor: 'pointer', fontSize: 12 }}>
              {icon} {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <input value={filters.search} onChange={e => updateFilter('search', e.target.value)}
          placeholder="🔍 Search hostname, OS, apps..."
          style={{ flex: 1, padding: '7px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 13, minWidth: 200 }} />
        <div style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' }}>
          {data.total} of {data.total_unfiltered} servers
        </div>
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={filters.workload_type} onChange={e => updateFilter('workload_type', e.target.value)} style={selectStyle}>
          <option value="">All Workloads</option>
          {(facets.workload_types || []).map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={filters.complexity} onChange={e => updateFilter('complexity', e.target.value)} style={selectStyle}>
          <option value="">All Complexity</option>
          {(facets.complexities || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.migration_target} onChange={e => updateFilter('migration_target', e.target.value)} style={selectStyle}>
          <option value="">All Targets</option>
          {(facets.migration_targets || []).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filters.os_filter} onChange={e => updateFilter('os_filter', e.target.value)} style={selectStyle}>
          <option value="">All OS</option>
          {(facets.os_versions || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={filters.has_sql === null ? '' : filters.has_sql ? 'yes' : 'no'}
          onChange={e => updateFilter('has_sql', e.target.value === '' ? null : e.target.value === 'yes')} style={selectStyle}>
          <option value="">SQL: Any</option>
          <option value="yes">Has SQL</option>
          <option value="no">No SQL</option>
        </select>
        <select value={filters.has_iis === null ? '' : filters.has_iis ? 'yes' : 'no'}
          onChange={e => updateFilter('has_iis', e.target.value === '' ? null : e.target.value === 'yes')} style={selectStyle}>
          <option value="">IIS: Any</option>
          <option value="yes">Has IIS</option>
          <option value="no">No IIS</option>
        </select>
        {hasActiveFilters && (
          <button onClick={clearFilters} style={{ padding: '6px 12px', background: '#7f1d1d', border: 'none', borderRadius: 6, color: '#fca5a5', cursor: 'pointer', fontSize: 12 }}>✕ Clear</button>
        )}
      </div>

      {loading && <div style={{ color: '#9ca3af', padding: 20, textAlign: 'center' }}>Loading...</div>}

      {/* ─── TABLE VIEW ─── */}
      {!loading && view === 'table' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '2px solid #334155' }}>
              {[
                ['hostname', 'Hostname', 'left'],
                ['os_name', 'OS', 'left'],
                ['total_cores', 'Cores', 'center'],
                ['total_memory_gb', 'RAM (GB)', 'center'],
                ['total_storage_gb', 'Storage', 'center'],
                ['workload_type', 'Workload', 'left'],
                ['migration_target', 'Target', 'left'],
                ['complexity', 'Complexity', 'center'],
                ['app_count', 'Apps', 'center'],
                ['sql_instance_count', 'SQL', 'center'],
                ['iis_site_count', 'IIS', 'center'],
              ].map(([key, label, align]) => (
                <th key={key} onClick={() => toggleSort(key)}
                  style={{ textAlign: align, padding: 8, color: sortBy === key ? '#60a5fa' : '#9ca3af', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}>
                  {label}{sortIcon(key)}
                </th>
              ))}
            </tr></thead>
            <tbody>{data.servers.map(s => (
              <tr key={s.server_id} onClick={() => {
                  fetch(`/api/onprem/servers/${s.server_id}`).then(r => r.json()).then(full => setSelected(full)).catch(() => setSelected(s))
                }}
                style={{ borderBottom: '1px solid #1e293b', cursor: 'pointer', transition: 'background .15s' }}
                onMouseOver={e => e.currentTarget.style.background = '#1e293b'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: 8 }}>
                  <div style={{ color: '#60a5fa', fontWeight: 500 }}>{s.hostname}</div>
                  {s.ip_addresses?.[0] && <div style={{ color: '#64748b', fontSize: 10 }}>{s.ip_addresses[0]}</div>}
                </td>
                <td style={{ padding: 8, color: '#cbd5e1' }}>{(s.os_name || '').replace('Microsoft ', '').slice(0, 28)}</td>
                <td style={{ padding: 8, textAlign: 'center', color: '#e2e8f0' }}>{s.total_cores}</td>
                <td style={{ padding: 8, textAlign: 'center', color: '#e2e8f0' }}>{s.total_memory_gb}</td>
                <td style={{ padding: 8, textAlign: 'center', color: '#e2e8f0' }}>{s.total_storage_gb}</td>
                <td style={{ padding: 8 }}>{pill('#1e3a5f', '#60a5fa', s.workload_type || 'General')}</td>
                <td style={{ padding: 8 }}>{pill('#064e3b', '#34d399', s.migration_target || 'Azure VM')}</td>
                <td style={{ padding: 8, textAlign: 'center' }}>
                  {pill(
                    s.complexity === 'High' ? '#7f1d1d' : s.complexity === 'Medium' ? '#78350f' : '#064e3b',
                    s.complexity === 'High' ? '#fca5a5' : s.complexity === 'Medium' ? '#fbbf24' : '#34d399',
                    s.complexity || 'Low'
                  )}
                </td>
                <td style={{ padding: 8, textAlign: 'center', color: '#cbd5e1' }}>{s.app_count || 0}</td>
                <td style={{ padding: 8, textAlign: 'center', color: s.sql_instance_count ? '#a78bfa' : '#475569' }}>{s.sql_instance_count || '-'}</td>
                <td style={{ padding: 8, textAlign: 'center', color: s.iis_site_count ? '#34d399' : '#475569' }}>{s.iis_site_count || '-'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* ─── CARD VIEW ─── */}
      {!loading && view === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {data.servers.map(s => (
            <div key={s.server_id} onClick={() => {
                fetch(`/api/onprem/servers/${s.server_id}`).then(r => r.json()).then(full => setSelected(full)).catch(() => setSelected(s))
              }}
              style={{ background: '#1e293b', borderRadius: 12, padding: 16, cursor: 'pointer', border: '1px solid #334155', transition: 'border-color .2s' }}
              onMouseOver={e => e.currentTarget.style.borderColor = '#60a5fa'}
              onMouseOut={e => e.currentTarget.style.borderColor = '#334155'}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ color: '#60a5fa', fontWeight: 600, fontSize: 14 }}>{s.hostname}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>{(s.os_name || '').replace('Microsoft ', '').slice(0, 35)}</div>
                </div>
                {pill(
                  s.complexity === 'High' ? '#7f1d1d' : s.complexity === 'Medium' ? '#78350f' : '#064e3b',
                  s.complexity === 'High' ? '#fca5a5' : s.complexity === 'Medium' ? '#fbbf24' : '#34d399',
                  s.complexity || 'Low'
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                <div style={{ textAlign: 'center' }}><div style={{ color: '#60a5fa', fontSize: 16, fontWeight: 700 }}>{s.total_cores}</div><div style={{ color: '#64748b', fontSize: 10 }}>Cores</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ color: '#a78bfa', fontSize: 16, fontWeight: 700 }}>{s.total_memory_gb}</div><div style={{ color: '#64748b', fontSize: 10 }}>RAM GB</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ color: '#34d399', fontSize: 16, fontWeight: 700 }}>{s.total_storage_gb}</div><div style={{ color: '#64748b', fontSize: 10 }}>Storage GB</div></div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {pill('#1e3a5f', '#60a5fa', s.workload_type || 'General')}
                {pill('#064e3b', '#34d399', s.migration_target || 'Azure VM')}
                {s.sql_instance_count > 0 && pill('#312e81', '#a78bfa', `${s.sql_instance_count} SQL`)}
                {s.iis_site_count > 0 && pill('#064e3b', '#34d399', `${s.iis_site_count} IIS`)}
                {s.app_count > 0 && pill('#1e293b', '#9ca3af', `${s.app_count} apps`)}
              </div>
              {/* Security indicators */}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, fontSize: 11 }}>
                <span style={{ color: s.firewall_enabled ? '#34d399' : '#ef4444' }}>{s.firewall_enabled ? '🛡️ FW' : '⚠️ No FW'}</span>
                <span style={{ color: s.antivirus_product ? '#34d399' : '#ef4444' }}>{s.antivirus_product ? '🦠 AV' : '⚠️ No AV'}</span>
                {s.pending_updates_count > 10 && <span style={{ color: '#fbbf24' }}>🔄 {s.pending_updates_count} updates</span>}
                {s.scan_count > 1 && <span style={{ color: '#64748b' }}>📊 {s.scan_count} scans</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── ROLE VIEW ─── */}
      {!loading && view === 'roles' && roles && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Role groups */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {Object.entries(roles.role_groups || {}).map(([role, info]) => (
              <div key={role} style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>
                    {role === 'Web Server' ? '🌐' : role === 'Database Server' ? '🗄️' : role === 'Domain Controller' ? '🔑' :
                     role === 'File Server' ? '📁' : role === 'Hyper-V Host' ? '🖥️' : '📦'} {role}
                  </span>
                  <span style={{ background: '#0f172a', borderRadius: 12, padding: '2px 10px', color: '#60a5fa', fontSize: 14, fontWeight: 700 }}>{info.count}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {info.servers?.map((h, i) => <span key={i} style={{ background: '#0f172a', borderRadius: 4, padding: '2px 8px', color: '#9ca3af', fontSize: 11 }}>{h}</span>)}
                </div>
              </div>
            ))}
          </div>

          {/* Migration target groups */}
          {card(
            <>
              <h4 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🎯 Migration Targets</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                {Object.entries(roles.target_groups || {}).map(([target, info]) => (
                  <div key={target} style={{ background: '#0f172a', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                    <div style={{ color: '#34d399', fontSize: 24, fontWeight: 700 }}>{info.count}</div>
                    <div style={{ color: '#9ca3af', fontSize: 11 }}>{target}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Complexity breakdown */}
          {card(
            <>
              <h4 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>📊 Complexity Breakdown</h4>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                {Object.entries(roles.complexity_breakdown || {}).map(([level, count]) => (
                  <div key={level} style={{ textAlign: 'center', padding: '8px 24px', background: '#0f172a', borderRadius: 8 }}>
                    <div style={{ color: level === 'High' ? '#ef4444' : level === 'Medium' ? '#fbbf24' : '#34d399', fontSize: 28, fontWeight: 700 }}>{count}</div>
                    <div style={{ color: '#9ca3af', fontSize: 12 }}>{level}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Frameworks */}
          {roles.frameworks?.length > 0 && card(
            <>
              <h4 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>⚙️ Detected Frameworks</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {roles.frameworks.map(([name, count], i) => (
                  <span key={i} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '4px 10px', color: '#cbd5e1', fontSize: 11 }}>
                    {name} <span style={{ color: '#60a5fa', fontWeight: 600 }}>({count})</span>
                  </span>
                ))}
              </div>
            </>
          )}

          {/* Database engines */}
          {roles.database_engines?.length > 0 && card(
            <>
              <h4 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🗄️ Database Engines</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {roles.database_engines.map(([name, count], i) => (
                  <span key={i} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '4px 10px', color: '#a78bfa', fontSize: 11 }}>
                    {name} <span style={{ fontWeight: 600 }}>({count})</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ServerDetail({ server: s, onBack }) {
  const [activeSection, setActiveSection] = useState('overview')
  const [scanHistory, setScanHistory] = useState([])

  useEffect(() => {
    if (s.server_id) {
      fetch(`/api/onprem/servers/${s.server_id}/history`).then(r => r.json()).then(setScanHistory).catch(() => {})
    }
  }, [s.server_id])

  const sections = [
    { id: 'overview', label: '📋 Overview' },
    { id: 'apps', label: `📦 Apps (${s.installed_applications?.length || 0})` },
    { id: 'services', label: `⚙️ Services (${(s.running_services?.length || 0) + (s.stopped_services?.length || 0)})` },
    { id: 'network', label: '🌐 Network' },
    { id: 'storage', label: `💿 Storage (${s.disks?.length || 0})` },
    { id: 'security', label: '🔒 Security' },
    s.sql_instances?.length && { id: 'sql', label: `🗄️ SQL (${s.sql_instances.length})` },
    s.iis_sites?.length && { id: 'iis', label: `🌐 IIS (${s.iis_sites.length})` },
    { id: 'history', label: `📊 History (${scanHistory.length})` },
  ].filter(Boolean)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={onBack} style={{ alignSelf: 'flex-start', padding: '6px 14px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#9ca3af', cursor: 'pointer', fontSize: 12 }}>← Back to Inventory</button>

      {/* Header */}
      <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, border: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Server size={32} style={{ color: '#60a5fa' }} />
          <div style={{ flex: 1 }}>
            <h2 style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: 0 }}>{s.hostname}</h2>
            <p style={{ color: '#9ca3af', fontSize: 12, margin: '4px 0 0' }}>
              {s.fqdn || s.domain} • {s.os_name} • {s.is_virtual ? `Virtual (${s.hypervisor_type || 'VM'})` : 'Physical'}
              {s.scan_count > 1 && ` • ${s.scan_count} scans`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {pill('#1e3a5f', '#60a5fa', s.workload_type || 'General')}
            {pill('#064e3b', '#34d399', s.migration_target || 'Azure VM')}
            {pill(s.complexity === 'High' ? '#7f1d1d' : '#064e3b', s.complexity === 'High' ? '#fca5a5' : '#34d399', `${s.complexity || 'Low'} complexity`)}
            {s.migration_candidate === false && pill('#7f1d1d', '#fca5a5', 'Not Migratable')}
          </div>
        </div>
        {/* Quick stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
          {[
            ['Cores', s.total_cores || 0, '#60a5fa'],
            ['RAM', `${s.total_memory_gb || 0} GB`, '#a78bfa'],
            ['Storage', `${s.total_storage_gb || 0} GB`, '#34d399'],
            ['Uptime', s.uptime_days ? `${s.uptime_days}d` : '-', '#fbbf24'],
            ['Apps', s.installed_applications?.length || s.app_count || 0, '#f472b6'],
            ['Services', s.running_services?.length || s.running_services_count || 0, '#fb923c'],
          ].map(([label, val, color]) => (
            <div key={label} style={{ textAlign: 'center', background: '#0f172a', borderRadius: 8, padding: '8px 4px' }}>
              <div style={{ color, fontSize: 18, fontWeight: 700 }}>{val}</div>
              <div style={{ color: '#64748b', fontSize: 10 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
        {sections.map(sec => (
          <button key={sec.id} onClick={() => setActiveSection(sec.id)}
            style={{ padding: '6px 14px', background: activeSection === sec.id ? '#2563eb' : '#0f172a', border: '1px solid #334155', borderRadius: 8, color: activeSection === sec.id ? '#fff' : '#9ca3af', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>
            {sec.label}
          </button>
        ))}
      </div>

      {/* ─── OVERVIEW ─── */}
      {activeSection === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🖥️ Hardware</h4>
            <DetailRow label="Manufacturer" value={s.manufacturer} />
            <DetailRow label="Model" value={s.model} />
            <DetailRow label="Serial" value={s.serial_number} />
            <DetailRow label="CPU" value={s.cpu_model} />
            <DetailRow label="CPU Speed" value={s.cpu_speed_ghz ? `${s.cpu_speed_ghz} GHz` : '-'} />
            <DetailRow label="Logical Processors" value={s.total_logical_processors} />
            <DetailRow label="Virtual" value={s.is_virtual ? `Yes (${s.hypervisor_type || 'VM'})` : 'Physical'} />
            {s.vm_host && <DetailRow label="VM Host" value={s.vm_host} />}
            {s.is_clustered && <DetailRow label="Cluster" value={s.cluster_name || 'Yes'} />}
          </>)}
          {card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>💻 Operating System</h4>
            <DetailRow label="OS" value={s.os_name} />
            <DetailRow label="Version" value={s.os_version} />
            <DetailRow label="Build" value={s.os_build} />
            <DetailRow label="Architecture" value={s.os_architecture} />
            <DetailRow label="Install Date" value={s.install_date} />
            <DetailRow label="Last Boot" value={s.last_boot_time} />
            <DetailRow label="Uptime" value={s.uptime_days ? `${s.uptime_days} days` : '-'} />
          </>)}
          {card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>💾 Backup & Monitoring</h4>
            <DetailRow label="Backup" value={s.backup_solution || '⚠️ None'} />
            <DetailRow label="Last Backup" value={s.last_backup_date || 'N/A'} />
            <DetailRow label="Monitoring" value={s.monitoring_agent || 'None'} />
          </>)}
          {(s.avg_cpu_pct != null || s.avg_memory_pct != null) && card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📊 Performance</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {[['Avg CPU', s.avg_cpu_pct, '#60a5fa'], ['Avg Mem', s.avg_memory_pct, '#a78bfa'], ['Peak CPU', s.peak_cpu_pct, '#f87171'], ['Peak Mem', s.peak_memory_pct, '#fbbf24']].map(([l, v, c]) => (
                <div key={l} style={{ textAlign: 'center' }}><div style={{ color: c, fontSize: 18, fontWeight: 700 }}>{v ?? '-'}%</div><div style={{ color: '#9ca3af', fontSize: 10 }}>{l}</div></div>
              ))}
            </div>
          </>)}
          {/* Roles & Features */}
          {(s.server_roles?.length > 0 || s.roles_features?.length > 0 || s.server_roles_detected?.length > 0) && card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🏷️ Roles & Features</h4>
            {s.server_roles_detected?.length > 0 && <div style={{ marginBottom: 8 }}>
              <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Detected Roles:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {s.server_roles_detected.map((r, i) => <span key={i} style={{ background: '#312e81', border: '1px solid #4338ca', borderRadius: 6, padding: '3px 10px', color: '#a78bfa', fontSize: 11 }}>{r}</span>)}
              </div>
            </div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(s.roles_features || s.server_roles || []).map((r, i) => {
                const name = typeof r === 'object' ? (r.name || r.Name || '') : String(r)
                return <span key={i} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '3px 10px', color: '#cbd5e1', fontSize: 11 }}>{name}</span>
              })}
            </div>
          </>)}
          {/* Frameworks */}
          {s.frameworks_runtimes?.length > 0 && card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>⚙️ Frameworks & Runtimes</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {s.frameworks_runtimes.map((f, i) => {
                const name = typeof f === 'object' ? `${f.name || ''} ${f.version || ''}`.trim() : String(f)
                return <span key={i} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '3px 10px', color: '#34d399', fontSize: 11 }}>{name}</span>
              })}
            </div>
          </>)}
        </div>
      )}

      {/* ─── APPLICATIONS ─── */}
      {activeSection === 'apps' && (
        <div>
          {s.installed_applications?.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ borderBottom: '2px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Application</th>
                <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Version</th>
                <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Publisher</th>
                <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Install Date</th>
              </tr></thead>
              <tbody>{s.installed_applications.map((a, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: 8, color: '#e2e8f0' }}>{a.name || a.Name}</td>
                  <td style={{ padding: 8, color: '#9ca3af' }}>{a.version || a.Version || '-'}</td>
                  <td style={{ padding: 8, color: '#9ca3af' }}>{a.publisher || a.Publisher || '-'}</td>
                  <td style={{ padding: 8, color: '#9ca3af' }}>{a.install_date || a.InstallDate || '-'}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>No applications data</div>}
          {/* App categories */}
          {s.app_categories && Object.keys(s.app_categories).length > 0 && card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📂 Application Categories</h4>
            {Object.entries(s.app_categories).map(([cat, apps]) => (
              <div key={cat} style={{ marginBottom: 8 }}>
                <div style={{ color: '#60a5fa', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} ({Array.isArray(apps) ? apps.length : 0})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(Array.isArray(apps) ? apps : []).map((a, i) => <span key={i} style={{ background: '#0f172a', borderRadius: 4, padding: '2px 8px', color: '#9ca3af', fontSize: 11 }}>{typeof a === 'string' ? a : a?.name || ''}</span>)}
                </div>
              </div>
            ))}
          </>)}
        </div>
      )}

      {/* ─── SERVICES ─── */}
      {activeSection === 'services' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {s.running_services?.length > 0 && card(<>
            <h4 style={{ color: '#34d399', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>▶️ Running Services ({s.running_services.length})</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Name</th>
                <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Display Name</th>
                <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Start Type</th>
                <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Account</th>
              </tr></thead>
              <tbody>{s.running_services.slice(0, 50).map((svc, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: 6, color: '#60a5fa' }}>{svc.name || svc.Name}</td>
                  <td style={{ padding: 6, color: '#cbd5e1' }}>{svc.display_name || svc.DisplayName || '-'}</td>
                  <td style={{ padding: 6, color: '#9ca3af' }}>{svc.start_type || svc.StartType || '-'}</td>
                  <td style={{ padding: 6, color: '#9ca3af' }}>{svc.account || svc.Account || '-'}</td>
                </tr>
              ))}</tbody>
            </table>
            {s.running_services.length > 50 && <div style={{ color: '#64748b', fontSize: 11, padding: 8 }}>...and {s.running_services.length - 50} more</div>}
          </>)}
          {s.stopped_services?.length > 0 && card(<>
            <h4 style={{ color: '#fbbf24', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>⏹️ Stopped Services ({s.stopped_services.length})</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {s.stopped_services.slice(0, 30).map((svc, i) => (
                <span key={i} style={{ background: '#0f172a', borderRadius: 4, padding: '2px 8px', color: '#64748b', fontSize: 11 }}>{svc.name || svc.Name}</span>
              ))}
              {s.stopped_services.length > 30 && <span style={{ color: '#64748b', fontSize: 11 }}>+{s.stopped_services.length - 30} more</span>}
            </div>
          </>)}
        </div>
      )}

      {/* ─── NETWORK ─── */}
      {activeSection === 'network' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🔌 Network Adapters</h4>
            {(s.network_adapters || []).map((a, i) => (
              <div key={i} style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                <div style={{ color: '#60a5fa', fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{a.name || a.Name}</div>
                <DetailRow label="IP" value={a.ip_address || a.IPAddress} />
                <DetailRow label="Subnet" value={a.subnet_mask} />
                <DetailRow label="Gateway" value={a.default_gateway} />
                <DetailRow label="DNS" value={Array.isArray(a.dns_servers) ? a.dns_servers.join(', ') : a.dns_servers} />
                <DetailRow label="MAC" value={a.mac_address || a.MACAddress} />
                <DetailRow label="Speed" value={a.speed_mbps ? `${a.speed_mbps} Mbps` : '-'} />
              </div>
            ))}
            {(!s.network_adapters || s.network_adapters.length === 0) && <div style={{ color: '#64748b', fontSize: 12 }}>No adapter data</div>}
          </>)}
          {s.network_connections?.length > 0 && card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🔗 Active Connections ({s.network_connections.length})</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: 4, color: '#9ca3af' }}>Local</th>
                <th style={{ textAlign: 'left', padding: 4, color: '#9ca3af' }}>Remote</th>
                <th style={{ textAlign: 'left', padding: 4, color: '#9ca3af' }}>State</th>
                <th style={{ textAlign: 'left', padding: 4, color: '#9ca3af' }}>Process</th>
              </tr></thead>
              <tbody>{s.network_connections.slice(0, 30).map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: 4, color: '#60a5fa' }}>{c.local_address}:{c.local_port}</td>
                  <td style={{ padding: 4, color: '#cbd5e1' }}>{c.remote_address}:{c.remote_port}</td>
                  <td style={{ padding: 4, color: c.state === 'LISTEN' ? '#fbbf24' : '#34d399' }}>{c.state}</td>
                  <td style={{ padding: 4, color: '#9ca3af' }}>{c.process_name || c.owning_process}</td>
                </tr>
              ))}</tbody>
            </table>
          </>)}
          {s.dns_config && card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🌍 DNS Configuration</h4>
            <DetailRow label="DNS Servers" value={Array.isArray(s.dns_config.dns_servers) ? s.dns_config.dns_servers.join(', ') : String(s.dns_config.dns_servers || '-')} />
            <DetailRow label="Suffix" value={s.dns_config.dns_suffix} />
          </>)}
        </div>
      )}

      {/* ─── STORAGE ─── */}
      {activeSection === 'storage' && s.disks?.length > 0 && (
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '2px solid #334155' }}>
              <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Drive</th>
              <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Label</th>
              <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>FileSystem</th>
              <th style={{ textAlign: 'right', padding: 8, color: '#9ca3af' }}>Size (GB)</th>
              <th style={{ textAlign: 'right', padding: 8, color: '#9ca3af' }}>Free (GB)</th>
              <th style={{ textAlign: 'right', padding: 8, color: '#9ca3af' }}>Used %</th>
              <th style={{ padding: 8, color: '#9ca3af' }}>Usage</th>
            </tr></thead>
            <tbody>{s.disks.map((d, i) => {
              const pct = d.used_pct || (d.size_gb > 0 ? Math.round((1 - d.free_gb / d.size_gb) * 100) : 0)
              return (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: 8, color: '#60a5fa', fontWeight: 600 }}>{d.drive_letter}</td>
                  <td style={{ padding: 8, color: '#cbd5e1' }}>{d.label || '-'}</td>
                  <td style={{ padding: 8, color: '#9ca3af' }}>{d.filesystem || '-'}</td>
                  <td style={{ padding: 8, textAlign: 'right', color: '#e2e8f0' }}>{d.size_gb}</td>
                  <td style={{ padding: 8, textAlign: 'right', color: '#34d399' }}>{d.free_gb}</td>
                  <td style={{ padding: 8, textAlign: 'right', color: pct > 90 ? '#ef4444' : pct > 75 ? '#fbbf24' : '#e2e8f0' }}>{pct}%</td>
                  <td style={{ padding: 8, width: 120 }}>
                    <div style={{ background: '#0f172a', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 4, background: pct > 90 ? '#ef4444' : pct > 75 ? '#fbbf24' : '#34d399' }} />
                    </div>
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}

      {/* ─── SECURITY ─── */}
      {activeSection === 'security' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🛡️ Security Posture</h4>
            <DetailRow label="Firewall" value={s.firewall_enabled ? '✅ Enabled' : '❌ Disabled'} />
            <DetailRow label="Antivirus" value={s.antivirus_product || '⚠️ None detected'} />
            <DetailRow label="AV Status" value={s.antivirus_status} />
            <DetailRow label="Pending Updates" value={s.pending_updates_count} />
            <DetailRow label="Last Updated" value={s.last_update_date} />
            <DetailRow label="Backup Solution" value={s.backup_solution || '⚠️ None'} />
          </>)}
          {s.password_policy && card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🔑 Password Policy</h4>
            {Object.entries(s.password_policy).map(([k, v]) => (
              <DetailRow key={k} label={k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} value={String(v)} />
            ))}
          </>)}
          {s.firewall_profiles && typeof s.firewall_profiles === 'object' && Object.keys(s.firewall_profiles).length > 0 && card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🧱 Firewall Profiles</h4>
            {Object.entries(s.firewall_profiles).map(([profile, val]) => (
              <DetailRow key={profile} label={profile} value={typeof val === 'object' ? (val.enabled ? '✅ Enabled' : '❌ Disabled') : String(val)} />
            ))}
          </>)}
          {s.local_admins?.length > 0 && card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>👤 Local Administrators</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {s.local_admins.map((a, i) => <span key={i} style={{ background: '#7f1d1d20', border: '1px solid #7f1d1d', borderRadius: 6, padding: '3px 10px', color: '#fca5a5', fontSize: 11 }}>{typeof a === 'string' ? a : a.name || a.Name}</span>)}
            </div>
          </>)}
          {s.certificates?.length > 0 && card(<>
            <h4 style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📜 Certificates ({s.certificates.length})</h4>
            {s.certificates.slice(0, 10).map((c, i) => (
              <div key={i} style={{ background: '#0f172a', borderRadius: 6, padding: 8, marginBottom: 4 }}>
                <div style={{ color: '#60a5fa', fontSize: 11, fontWeight: 500 }}>{c.subject || c.Subject}</div>
                <div style={{ color: '#64748b', fontSize: 10 }}>Expires: {c.expiry_date || c.not_after || '-'} • Issuer: {(c.issuer || c.Issuer || '').slice(0, 40)}</div>
              </div>
            ))}
          </>)}
        </div>
      )}

      {/* ─── SQL ─── */}
      {activeSection === 'sql' && s.sql_instances?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {s.sql_instances.map((inst, i) => card(<div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <h4 style={{ color: '#a78bfa', fontSize: 14, fontWeight: 600, margin: 0 }}>🗄️ {inst.instance_name}</h4>
              {pill('#312e81', '#a78bfa', inst.edition || 'Unknown')}
            </div>
            <DetailRow label="Version" value={inst.version} />
            <DetailRow label="Port" value={inst.tcp_port} />
            <DetailRow label="Max Memory" value={inst.max_memory_mb ? `${inst.max_memory_mb} MB` : '-'} />
            <DetailRow label="Max DOP" value={inst.max_dop} />
            {inst.databases?.length > 0 && <>
              <h5 style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600, margin: '12px 0 6px' }}>Databases ({inst.databases.length})</h5>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr style={{ borderBottom: '1px solid #334155' }}>
                  <th style={{ textAlign: 'left', padding: 4, color: '#64748b' }}>Name</th>
                  <th style={{ textAlign: 'right', padding: 4, color: '#64748b' }}>Size (MB)</th>
                  <th style={{ textAlign: 'left', padding: 4, color: '#64748b' }}>Recovery</th>
                  <th style={{ textAlign: 'left', padding: 4, color: '#64748b' }}>State</th>
                </tr></thead>
                <tbody>{inst.databases.map((db, j) => (
                  <tr key={j} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: 4, color: '#e2e8f0' }}>{db.name}</td>
                    <td style={{ padding: 4, textAlign: 'right', color: '#9ca3af' }}>{db.size_mb}</td>
                    <td style={{ padding: 4, color: '#9ca3af' }}>{db.recovery_model}</td>
                    <td style={{ padding: 4, color: db.state === 'ONLINE' ? '#34d399' : '#ef4444' }}>{db.state}</td>
                  </tr>
                ))}</tbody>
              </table>
            </>}
          </div>))}
        </div>
      )}

      {/* ─── IIS ─── */}
      {activeSection === 'iis' && s.iis_sites?.length > 0 && (
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '2px solid #334155' }}>
              <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Site Name</th>
              <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Bindings</th>
              <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Physical Path</th>
              <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>App Pool</th>
              <th style={{ textAlign: 'center', padding: 8, color: '#9ca3af' }}>State</th>
            </tr></thead>
            <tbody>{s.iis_sites.map((site, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: 8, color: '#60a5fa', fontWeight: 500 }}>{site.name}</td>
                <td style={{ padding: 8, color: '#cbd5e1' }}>{site.bindings}</td>
                <td style={{ padding: 8, color: '#9ca3af', fontSize: 11 }}>{site.physical_path}</td>
                <td style={{ padding: 8, color: '#9ca3af' }}>{site.app_pool}</td>
                <td style={{ padding: 8, textAlign: 'center' }}>{pill(site.state === 'Started' ? '#064e3b' : '#7f1d1d', site.state === 'Started' ? '#34d399' : '#fca5a5', site.state)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* ─── SCAN HISTORY ─── */}
      {activeSection === 'history' && (
        <div>
          {scanHistory.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ borderBottom: '2px solid #334155' }}>
                <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Scan Date</th>
                <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Batch ID</th>
                <th style={{ textAlign: 'center', padding: 8, color: '#9ca3af' }}>Modules</th>
                <th style={{ textAlign: 'center', padding: 8, color: '#9ca3af' }}>Duration</th>
                <th style={{ textAlign: 'left', padding: 8, color: '#9ca3af' }}>Summary</th>
              </tr></thead>
              <tbody>{scanHistory.map((h, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: 8, color: '#60a5fa' }}>{h.collected_at?.slice(0, 19)}</td>
                  <td style={{ padding: 8, color: '#9ca3af', fontSize: 11 }}>{h.batch_id?.slice(0, 20)}</td>
                  <td style={{ padding: 8, textAlign: 'center', color: '#e2e8f0' }}>{h.modules_collected}</td>
                  <td style={{ padding: 8, textAlign: 'center', color: '#9ca3af' }}>{h.duration_sec ? `${Math.round(h.duration_sec)}s` : '-'}</td>
                  <td style={{ padding: 8, color: '#9ca3af', fontSize: 11 }}>
                    {h.payload_summary?.os || ''} • {h.payload_summary?.apps_count || 0} apps
                  </td>
                </tr>
              ))}</tbody>
            </table>
          ) : <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>No scan history available</div>}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(30,41,59,0.5)' }}>
      <span style={{ color: '#9ca3af', fontSize: 12 }}>{label}</span>
      <span style={{ color: '#e2e8f0', fontSize: 12, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || '-'}</span>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*  MIGRATION TAB                                                             */
/* ════════════════════════════════════════════════════════════════════════════ */
function MigrationTab() {
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getOnPremMigrationCandidates().then(setCandidates).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>Loading...</div>
  if (!candidates.length) return <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>No migration candidates. Upload server data first.</div>

  // Group by target
  const byTarget = {}
  candidates.forEach(c => {
    const t = c.migration_target || 'Azure VM'
    byTarget[t] = byTarget[t] || []
    byTarget[t].push(c)
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {statCard('Total Candidates', candidates.length, <ArrowRight size={16} />, '#60a5fa')}
        {Object.entries(byTarget).map(([target, servers]) =>
          statCard(target, servers.length, <Globe size={16} />, '#34d399')
        )}
      </div>

      {/* By target */}
      {Object.entries(byTarget).map(([target, servers]) => card(
        <>
          <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🎯 {target} ({servers.length} servers)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid #334155' }}>
              <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Hostname</th>
              <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>OS</th>
              <th style={{ textAlign: 'left', padding: 6, color: '#9ca3af' }}>Workload</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>Cores</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>RAM</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>Storage</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>SQL</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>IIS</th>
              <th style={{ textAlign: 'center', padding: 6, color: '#9ca3af' }}>Complexity</th>
            </tr></thead>
            <tbody>{servers.map(s => (
              <tr key={s.server_id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: 6, color: '#60a5fa' }}>{s.hostname}</td>
                <td style={{ padding: 6, color: '#cbd5e1' }}>{s.os_name?.slice(0, 25)}</td>
                <td style={{ padding: 6 }}>{pill('#1e3a5f', '#60a5fa', s.workload_type)}</td>
                <td style={{ padding: 6, textAlign: 'center', color: '#e2e8f0' }}>{s.total_cores}</td>
                <td style={{ padding: 6, textAlign: 'center', color: '#e2e8f0' }}>{s.total_memory_gb}</td>
                <td style={{ padding: 6, textAlign: 'center', color: '#e2e8f0' }}>{s.total_storage_gb}</td>
                <td style={{ padding: 6, textAlign: 'center', color: '#a78bfa' }}>{s.sql_instances}</td>
                <td style={{ padding: 6, textAlign: 'center', color: '#34d399' }}>{s.iis_sites}</td>
                <td style={{ padding: 6, textAlign: 'center' }}>{pill(
                  s.complexity === 'High' ? '#7f1d1d' : s.complexity === 'Medium' ? '#78350f' : '#064e3b',
                  s.complexity === 'High' ? '#fca5a5' : s.complexity === 'Medium' ? '#fbbf24' : '#34d399',
                  s.complexity
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        </>,
        { key: target }
      ))}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════ */
/*  AI ANALYSIS TAB                                                           */
/* ════════════════════════════════════════════════════════════════════════════ */
function AIAnalysisTab() {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError(null)
    try {
      const data = await api.getOnPremAIAnalysis(refresh)
      if (data.error) { setError(data.error); return }
      setAnalysis(data)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>🧠 Running AI analysis...</div>
  if (error) return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <AlertTriangle size={32} style={{ color: '#fbbf24', margin: '0 auto 12px' }} />
      <p style={{ color: '#fca5a5', fontSize: 13 }}>{error}</p>
      <button onClick={() => load(true)} style={{ marginTop: 12, padding: '8px 16px', background: '#2563eb', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 13 }}>Retry</button>
    </div>
  )
  if (!analysis) return null

  const a = analysis
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Score header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: a.overall_readiness_score >= 70 ? '#065f4620' : a.overall_readiness_score >= 40 ? '#78350f20' : '#7f1d1d20',
          border: `2px solid ${a.overall_readiness_score >= 70 ? '#34d399' : a.overall_readiness_score >= 40 ? '#fbbf24' : '#ef4444'}` }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: a.overall_readiness_score >= 70 ? '#34d399' : a.overall_readiness_score >= 40 ? '#fbbf24' : '#ef4444' }}>
            {a.overall_readiness_score}
          </span>
        </div>
        <div>
          <h2 style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 700, margin: 0 }}>Migration Readiness: Grade {a.overall_grade}</h2>
          <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>
            Generated: {a._meta?.generated_at?.slice(0, 16)} • Model: {a._meta?.model} • Servers: {a._meta?.server_count}
          </p>
        </div>
        <button onClick={() => load(true)} style={{ marginLeft: 'auto', padding: '6px 14px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#9ca3af', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Executive Summary */}
      {a.executive_summary && card(
        <>
          <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>📋 Executive Summary</h3>
          <p style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{a.executive_summary}</p>
        </>
      )}

      {/* Migration Waves */}
      {a.migration_assessment?.migration_waves?.length > 0 && card(
        <>
          <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🌊 Migration Waves</h3>
          {a.migration_assessment.migration_waves.map((wave, i) => (
            <div key={i} style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginBottom: 8, borderLeft: '3px solid #2563eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#60a5fa', fontWeight: 600, fontSize: 13 }}>Wave {wave.wave}: {wave.name}</span>
                <span style={{ color: '#9ca3af', fontSize: 11 }}>{wave.server_count} servers • {wave.estimated_duration_weeks} weeks</span>
              </div>
              <p style={{ color: '#cbd5e1', fontSize: 12, margin: 0 }}>{wave.description}</p>
            </div>
          ))}
        </>
      )}

      {/* Security Findings */}
      {a.security_posture?.findings?.length > 0 && card(
        <>
          <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🔒 Security Findings</h3>
          {a.security_posture.findings.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #1e293b', alignItems: 'flex-start' }}>
              {pill(
                f.severity === 'Critical' ? '#7f1d1d' : f.severity === 'High' ? '#78350f' : '#1e293b',
                f.severity === 'Critical' ? '#fca5a5' : f.severity === 'High' ? '#fbbf24' : '#9ca3af',
                f.severity
              )}
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>{f.title}</div>
                <div style={{ color: '#9ca3af', fontSize: 11 }}>{f.description} • {f.affected_servers} server(s)</div>
                <div style={{ color: '#60a5fa', fontSize: 11, marginTop: 4 }}>💡 {f.remediation}</div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Modernization Opportunities */}
      {a.modernization_opportunities?.length > 0 && card(
        <>
          <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🚀 Modernization Opportunities</h3>
          {a.modernization_opportunities.map((opp, i) => (
            <div key={i} style={{ background: '#0f172a', borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#e2e8f0', fontWeight: 500, fontSize: 13 }}>{opp.title}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {pill('#064e3b', '#34d399', opp.priority)}
                  {pill('#1e3a5f', '#60a5fa', `~${opp.estimated_savings_pct}% savings`)}
                </div>
              </div>
              <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>{opp.description}</p>
              <div style={{ color: '#a78bfa', fontSize: 11, marginTop: 4 }}>Target: {opp.target_service} • {opp.affected_servers} servers • Effort: {opp.effort}</div>
            </div>
          ))}
        </>
      )}

      {/* Top Recommendations */}
      {a.top_recommendations?.length > 0 && card(
        <>
          <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>⭐ Top Recommendations</h3>
          {a.top_recommendations.map((rec, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #1e293b' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#2563eb20', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                {rec.priority}
              </div>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>{rec.title}</div>
                <div style={{ color: '#9ca3af', fontSize: 11 }}>{rec.description}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  {pill('#064e3b', '#34d399', `Impact: ${rec.impact}`)}
                  {pill('#1e293b', '#9ca3af', `Effort: ${rec.effort}`)}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
