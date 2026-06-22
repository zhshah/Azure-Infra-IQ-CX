/**
 * VersionWatcher — keeps open tabs from running a stale (possibly buggy) bundle.
 *
 * The backend exposes /api/version returning the hashed build id of the bundle
 * currently in frontend/dist. This component captures the build id at boot, then
 * polls it. When the deployed build changes (i.e. you rebuilt / redeployed), it:
 *   • auto-reloads the tab once the user has been idle (no surprise interruption), and
 *   • otherwise shows a dismissible "new version" banner with a manual Reload.
 *
 * This is the permanent guard against the "open SPA tab keeps executing old JS
 * after a rebuild" problem that surfaced the React #310 crash.
 *
 * NOTE: every hook below runs unconditionally before the early return, per the
 * React Rules of Hooks (a hook after an early return is exactly what caused #310).
 */
import React, { useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'

const POLL_MS = 20_000   // how often to check for a newer build
const IDLE_MS = 10_000   // auto-reload only after this much user inactivity

function hardReload() {
  // index.html is served no-cache, so a reload already fetches the new bundle.
  // The cache-bust param is belt-and-suspenders against any intermediary cache.
  try {
    const u = new URL(window.location.href)
    u.searchParams.set('_v', Date.now().toString(36))
    window.location.replace(u.toString())
  } catch {
    window.location.reload()
  }
}

export default function VersionWatcher() {
  const [bootBuild, setBootBuild] = useState(null)
  const [newBuild, setNewBuild]   = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const lastActivityRef = useRef(Date.now())
  const reloadingRef     = useRef(false)

  // Track user activity so we only auto-reload when the tab is idle.
  useEffect(() => {
    const mark = () => { lastActivityRef.current = Date.now() }
    const evs = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    evs.forEach(e => window.addEventListener(e, mark, { passive: true }))
    return () => evs.forEach(e => window.removeEventListener(e, mark))
  }, [])

  // Capture the build id this tab booted with.
  useEffect(() => {
    let alive = true
    fetch('/api/version', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.build) setBootBuild(j.build) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Poll for a newer deployed build.
  useEffect(() => {
    if (!bootBuild) return undefined
    const check = async () => {
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json()
        if (j?.build && j.build !== bootBuild) setNewBuild(j.build)
      } catch { /* offline / transient — ignore */ }
    }
    const id = setInterval(check, POLL_MS)
    return () => clearInterval(id)
  }, [bootBuild])

  // FAST PATH for multi-tab users: the instant this tab regains focus / becomes visible,
  // check the live build DIRECTLY and upgrade immediately if it's stale — so a tab you
  // switch back to never keeps running old (possibly buggy) code while you wait for the
  // slow poll. This is what stops the recurring "I clicked but nothing happened" on a tab
  // that booted before the latest rebuild.
  useEffect(() => {
    if (!bootBuild) return undefined
    const checkNow = async () => {
      if (reloadingRef.current || document.visibilityState !== 'visible') return
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json()
        if (j?.build && j.build !== bootBuild) { reloadingRef.current = true; hardReload() }
      } catch { /* offline / transient — ignore */ }
    }
    window.addEventListener('focus', checkNow)
    document.addEventListener('visibilitychange', checkNow)
    return () => {
      window.removeEventListener('focus', checkNow)
      document.removeEventListener('visibilitychange', checkNow)
    }
  }, [bootBuild])

  // Once a new build is live, upgrade this tab automatically so a stale (possibly
  // buggy / old-branding) bundle can never linger in front of a customer:
  //   • the instant the user returns to the tab (window focus / tab becomes visible), or
  //   • after the tab has been idle for IDLE_MS.
  // Returning to the tab is a natural, non-disruptive reload point, so a stale tab
  // refreshes itself the moment the user looks at it — no manual hard-refresh needed.
  useEffect(() => {
    if (!newBuild) return undefined
    const reloadNow = () => {
      if (reloadingRef.current) return
      reloadingRef.current = true
      hardReload()
    }
    const onVisible = () => { if (document.visibilityState === 'visible') reloadNow() }
    window.addEventListener('focus', reloadNow)
    document.addEventListener('visibilitychange', onVisible)
    const tick = setInterval(() => {
      if (reloadingRef.current) return
      if (Date.now() - lastActivityRef.current >= IDLE_MS) reloadNow()
    }, 5_000)
    return () => {
      window.removeEventListener('focus', reloadNow)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(tick)
    }
  }, [newBuild])

  if (!newBuild || dismissed) return null

  return (
    <div style={{
      position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)',
      zIndex: 99999, display: 'flex', alignItems: 'center', gap: 12,
      background: '#0f172a', border: '1px solid #1d4ed8', borderRadius: 10,
      padding: '10px 14px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <RefreshCw size={15} style={{ color: '#60a5fa' }} />
      <span style={{ color: '#e2e8f0', fontSize: 13 }}>
        A new version of the portal is available.
      </span>
      <button onClick={hardReload} style={{
        background: '#1d4ed8', border: 'none', borderRadius: 6, color: '#fff',
        fontSize: 12, fontWeight: 600, padding: '5px 12px', cursor: 'pointer',
      }}>
        Reload now
      </button>
      <button onClick={() => setDismissed(true)} title="Dismiss" style={{
        background: 'none', border: 'none', color: '#64748b', cursor: 'pointer',
        display: 'flex', alignItems: 'center',
      }}>
        <X size={15} />
      </button>
    </div>
  )
}
