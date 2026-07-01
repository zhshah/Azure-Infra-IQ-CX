/**
 * Microsoft 365 Security Operations dashboard.
 *
 * Blends the open-source Vigil365 (sameerk27/vigil365) approach into our UI: it renders
 * Microsoft Graph-sourced M365 security signals — Microsoft Secure Score, Defender XDR
 * incidents & alerts, Entra ID Protection (risky users / risk detections / MFA), Intune
 * device compliance and Conditional Access — styled in our dark theme. The backend
 * (/api/security/m365) is read-only and degrades each card to a labelled sample when the
 * matching Graph permission or license isn't available, so the view always renders.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import {
  ShieldCheck, ShieldAlert, UserX, Smartphone, AlertTriangle, Lock, KeyRound,
  Loader2, RefreshCw, ExternalLink, Activity, Fingerprint, Server, ArrowRight,
} from 'lucide-react'

const SEV = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e', unknown: 'var(--c-64748b)' }
const sevColor = (s) => SEV[String(s || '').toLowerCase()] || SEV.unknown
const fmtTime = (t) => { try { return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return t || '—' } }

function SourceBadge({ source }) {
  const live = source === 'live'
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: live ? 'var(--c-06351f)' : 'var(--c-3a2c08)', color: live ? '#4ade80' : '#fbbf24', border: `1px solid ${live ? '#15803d55' : '#a1620855'}` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: live ? '#22c55e' : '#f59e0b' }} />
      {live ? 'Live' : 'Sample data'}
    </span>
  )
}

function Card({ title, icon: Icon, accent = '#3b82f6', source, action, children }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800/60">
        {Icon && <Icon size={15} style={{ color: accent }} />}
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {source && <span className="ml-1"><SourceBadge source={source} /></span>}
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function Sparkline({ points = [], color = '#38bdf8', w = 120, h = 34 }) {
  if (!points.length) return null
  const min = Math.min(...points), max = Math.max(...points)
  const span = max - min || 1
  const step = w / Math.max(1, points.length - 1)
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - ((p - min) / span) * (h - 4) - 2).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(points.length - 1) * step} cy={h - ((points[points.length - 1] - min) / span) * (h - 4) - 2} r="2.5" fill={color} />
    </svg>
  )
}

function ScoreRing({ pct = 0, size = 96 }) {
  const r = (size - 12) / 2, c = 2 * Math.PI * r
  const col = pct >= 70 ? '#22c55e' : pct >= 45 ? '#eab308' : '#ef4444'
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--c-1e293b)' }} strokeWidth="8" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${c}`} strokeDashoffset={`${c * (1 - pct / 100)}`} />
      <text x="50%" y="50%" dy="0.1em" textAnchor="middle" className="rotate-90" style={{ transformOrigin: 'center' }}
        style={{ fill: 'var(--c-f1f5f9)' }} fontSize="20" fontWeight="700">{pct}%</text>
    </svg>
  )
}

function Kpi({ label, value, sub, icon: Icon, color = '#38bdf8' }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-3.5" style={{ borderTop: `2px solid ${color}` }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={13} style={{ color }} />}
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white leading-none tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

const SevPill = ({ sev }) => (
  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase" style={{ background: `${sevColor(sev)}22`, color: sevColor(sev) }}>{sev}</span>
)

const PORTAL = {
  identity: 'https://entra.microsoft.com/#view/Microsoft_AAD_IAM/IdentityProtectionMenuBlade',
  incidents: 'https://security.microsoft.com/incidents',
  devices: 'https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesMenu',
  ca: 'https://entra.microsoft.com/#view/Microsoft_AAD_ConditionalAccess/ConditionalAccessBlade',
  score: 'https://security.microsoft.com/securescore',
}
const PortalLink = ({ href }) => (
  <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300">
    Open in portal <ExternalLink size={11} />
  </a>
)

export default function M365SecurityDashboard({ compact = false, onOpen }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    setLoading(true); setErr('')
    api._request('/security/m365')
      .then(setData)
      .catch(e => setErr(e?.message || 'Failed to load M365 security data'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  if (loading && !data) {
    return compact ? (
      <div className="flex items-center gap-2 px-5 py-5 rounded-2xl bg-gray-900/40 border border-gray-800/60 text-gray-500 text-sm">
        <Loader2 className="animate-spin" size={18} /> Loading Microsoft 365 security signals…
      </div>
    ) : (
      <div className="p-12 text-center text-gray-400">
        <Loader2 className="inline-block animate-spin mb-3" size={26} />
        <p className="text-sm">Aggregating Microsoft 365 security signals via Microsoft Graph…</p>
      </div>
    )
  }
  if (err) {
    return (
      <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 text-sm text-red-300 flex items-center gap-2">
        <AlertTriangle size={16} /> {err}
        <button onClick={load} className="ml-auto px-3 py-1 rounded-lg bg-red-600/30 hover:bg-red-600/50 text-xs">Retry</button>
      </div>
    )
  }
  const d = data || {}
  const k = d.kpis || {}
  const ss = d.secure_score || {}
  const id = d.identity || {}
  const dev = d.devices || {}
  const inc = d.incidents || {}
  const alr = d.alerts || {}
  const ca = d.conditional_access || {}
  const devPct = dev.total ? Math.round(100 * (dev.compliant || 0) / dev.total) : 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-sky-950/40 to-indigo-950/30 border border-sky-900/40 rounded-2xl px-5 py-4">
        <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
          <ShieldCheck size={20} className="text-sky-400" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-white">Microsoft 365 Security Operations</h2>
          <p className="text-xs text-gray-400">Defender XDR · Entra ID Protection · Intune · Conditional Access — via Microsoft Graph</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-gray-500 hidden sm:inline">
            {d.graph_connected ? 'Graph connected' : 'Graph not configured'}{d.all_sample ? ' · showing sample data' : d.live_any ? ' · live + sample' : ''}
          </span>
          {compact ? (
            <button onClick={onOpen}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white">
              Open dashboard <ArrowRight size={13} />
            </button>
          ) : (
            <button onClick={load} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 border border-gray-700/60 text-gray-300 hover:bg-gray-700">
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
            </button>
          )}
        </div>
      </div>

      {/* Secure score + KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3">
          <Card title="Microsoft Secure Score" icon={ShieldCheck} accent="#22c55e" source={ss.source} action={<PortalLink href={PORTAL.score} />}>
            <div className="flex items-center gap-4">
              <ScoreRing pct={ss.percent || 0} />
              <div>
                <div className="text-2xl font-bold text-white tabular-nums">{ss.current ?? '—'}<span className="text-sm text-gray-500"> / {ss.max ?? '—'}</span></div>
                <div className="text-[11px] text-gray-500 mb-1">7-period trend</div>
                <Sparkline points={ss.trend || []} />
              </div>
            </div>
          </Card>
        </div>
        <div className="lg:col-span-9 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Risky Users" value={k.risky_users ?? 0} sub={`${k.risky_users_high ?? 0} high risk`} icon={UserX} color="#ef4444" />
          <Kpi label="Risk Detections" value={k.risk_detections ?? 0} sub="last 30 days" icon={Fingerprint} color="#f97316" />
          <Kpi label="Open Incidents" value={k.open_incidents ?? 0} sub={`${k.high_alerts ?? 0} high alerts`} icon={ShieldAlert} color="#ef4444" />
          <Kpi label="Non-compliant" value={k.noncompliant_devices ?? 0} sub="Intune devices" icon={Smartphone} color="#eab308" />
          <Kpi label="MFA Coverage" value={`${k.mfa_coverage_pct ?? 0}%`} sub="registered" icon={KeyRound} color="#22c55e" />
          <Kpi label="CA Policies" value={k.ca_enabled ?? 0} sub="enabled" icon={Lock} color="#3b82f6" />
        </div>
      </div>

      {!compact && (<>
      {/* Identity + Devices */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Entra ID Protection — Identity Risk" icon={Fingerprint} accent="#f97316" source={id.source} action={<PortalLink href={PORTAL.identity} />}>
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-400">MFA registration coverage</span>
              <span className="text-gray-200 font-semibold">{id.mfa?.registered ?? 0} / {id.mfa?.total ?? 0} ({id.mfa?.pct ?? 0}%)</span>
            </div>
            <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${id.mfa?.pct ?? 0}%`, background: (id.mfa?.pct ?? 0) >= 90 ? '#22c55e' : (id.mfa?.pct ?? 0) >= 70 ? '#eab308' : '#ef4444' }} />
            </div>
          </div>
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Risky users ({(id.risky_users || []).length})</div>
          <div className="space-y-1 mb-3 max-h-44 overflow-auto">
            {(id.risky_users || []).slice(0, 6).map((u, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-950/40 text-xs">
                <span className="text-gray-200 truncate flex-1" title={u.upn}>{u.user}</span>
                <span className="text-gray-600 hidden sm:inline">{u.risk_state}</span>
                <SevPill sev={u.risk_level} />
              </div>
            ))}
            {(id.risky_users || []).length === 0 && <div className="text-xs text-gray-600">No risky users.</div>}
          </div>
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Recent risk detections</div>
          <div className="space-y-1 max-h-44 overflow-auto">
            {(id.risk_detections || []).slice(0, 6).map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-950/40 text-xs">
                <SevPill sev={r.risk_level} />
                <span className="text-gray-200 truncate flex-1" title={`${r.type} — ${r.upn}`}>{r.type}</span>
                <span className="text-gray-500 hidden md:inline truncate max-w-[10rem]">{r.location || r.ip}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Intune — Device Compliance" icon={Smartphone} accent="#eab308" source={dev.source} action={<PortalLink href={PORTAL.devices} />}>
          <div className="flex items-center gap-4 mb-3">
            <div className="flex items-center gap-2">
              <div className="text-3xl font-bold text-white tabular-nums">{devPct}%</div>
              <div className="text-[11px] text-gray-500 leading-tight">compliant<br />{dev.compliant ?? 0} / {dev.total ?? 0}</div>
            </div>
            <div className="flex-1 flex gap-3 text-center">
              <div><div className="text-lg font-bold text-amber-400 tabular-nums">{dev.noncompliant ?? 0}</div><div className="text-[10px] text-gray-500">non-compliant</div></div>
              <div><div className="text-lg font-bold text-gray-400 tabular-nums">{dev.stale ?? 0}</div><div className="text-[10px] text-gray-500">stale ≥14d</div></div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {Object.entries(dev.by_os || {}).map(([os, n]) => (
              <span key={os} className="px-2 py-0.5 rounded-full text-[10px] bg-gray-800 border border-gray-700/40 text-gray-300">{os} <span className="text-gray-500">×{n}</span></span>
            ))}
          </div>
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Non-compliant devices</div>
          <div className="space-y-1 max-h-52 overflow-auto">
            {(dev.noncompliant_list || []).slice(0, 8).map((m, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-950/40 text-xs">
                <Server size={12} className="text-gray-500 shrink-0" />
                <span className="text-gray-200 truncate flex-1" title={m.user}>{m.device}</span>
                <span className="text-gray-600">{m.os}</span>
                <span className="text-amber-400/80">{m.state}</span>
              </div>
            ))}
            {(dev.noncompliant_list || []).length === 0 && <div className="text-xs text-gray-600">All devices compliant.</div>}
          </div>
        </Card>
      </div>

      {/* Incidents/Alerts + Conditional Access */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Defender XDR — Incidents & Alerts" icon={ShieldAlert} accent="#ef4444" source={inc.source} action={<PortalLink href={PORTAL.incidents} />}>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {['critical', 'high', 'medium', 'low'].map(s => (
              <div key={s} className="rounded-lg bg-gray-950/50 p-2 text-center" style={{ borderBottom: `2px solid ${sevColor(s)}` }}>
                <div className="text-lg font-bold tabular-nums" style={{ color: sevColor(s) }}>
                  {(inc.by_severity?.[s] || 0) + (alr.by_severity?.[s] || 0)}
                </div>
                <div className="text-[9px] uppercase text-gray-500">{s}</div>
              </div>
            ))}
          </div>
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Active incidents</div>
          <div className="space-y-1 mb-3 max-h-40 overflow-auto">
            {(inc.list || []).slice(0, 5).map((it, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-950/40 text-xs">
                <SevPill sev={it.severity} />
                <span className="text-gray-200 truncate flex-1" title={it.title}>{it.title}</span>
                <span className="text-gray-600 hidden md:inline">{fmtTime(it.created)}</span>
              </div>
            ))}
          </div>
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Recent alerts</div>
          <div className="space-y-1 max-h-40 overflow-auto">
            {(alr.list || []).slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-950/40 text-xs">
                <SevPill sev={a.severity} />
                <span className="text-gray-200 truncate flex-1" title={a.title}>{a.title}</span>
                <span className="text-gray-600 hidden md:inline truncate max-w-[9rem]">{(a.service || '').replace('microsoftDefenderFor', 'MDfor ')}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Conditional Access" icon={Lock} accent="#3b82f6" source={ca.source} action={<PortalLink href={PORTAL.ca} />}>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded-lg bg-gray-950/50 p-2.5 text-center"><div className="text-xl font-bold text-green-400 tabular-nums">{ca.enabled ?? 0}</div><div className="text-[10px] text-gray-500">Enabled</div></div>
            <div className="rounded-lg bg-gray-950/50 p-2.5 text-center"><div className="text-xl font-bold text-amber-400 tabular-nums">{ca.report_only ?? 0}</div><div className="text-[10px] text-gray-500">Report-only</div></div>
            <div className="rounded-lg bg-gray-950/50 p-2.5 text-center"><div className="text-xl font-bold text-gray-500 tabular-nums">{ca.disabled ?? 0}</div><div className="text-[10px] text-gray-500">Disabled</div></div>
          </div>
          <div className="space-y-1 max-h-72 overflow-auto">
            {(ca.policies || []).map((p, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-950/40 text-xs">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.state === 'enabled' ? '#22c55e' : p.state === 'report_only' ? '#eab308' : 'var(--c-64748b)' }} />
                <span className="text-gray-200 truncate flex-1" title={p.name}>{p.name}</span>
                <span className="text-gray-600 capitalize">{String(p.state).replace('_', '-')}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <p className="text-[10px] text-gray-600 text-center pt-1">
        Read-only Microsoft Graph aggregation · cards marked “Sample data” populate live once the app registration is granted the matching <code>*.Read.All</code> permission. Approach inspired by the open-source Vigil365 project.
      </p>
      </>)}
    </div>
  )
}
