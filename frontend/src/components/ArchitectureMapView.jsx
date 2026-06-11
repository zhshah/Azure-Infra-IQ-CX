import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ExternalLink, RefreshCw, AlertTriangle, Network } from 'lucide-react'
import { BG, BORDER, TEXT, BUTTON, RADIUS } from '../styles/tokens'

/* ─── Dark-theme CSS injected into the ZureMap iframe (same-origin) ──────── */
const ZUREMAP_DARK_CSS = `
/* ── Base overrides ── */
html, body, .mat-app-background, .mat-sidenav-container {
  background: ${BG.page} !important;
  color: ${TEXT.primary} !important;
}

/* ── Toolbar / header / nav ── */
mat-toolbar, .mat-toolbar, header, nav, .navbar,
.mat-sidenav, .sidebar, .mat-drawer {
  background: ${BG.sidebar} !important;
  border-color: ${BORDER.default} !important;
  color: ${TEXT.primary} !important;
}

/* ── Cards / panels / expansion ── */
.mat-card, mat-card, .mat-expansion-panel, .mat-dialog-container,
.card, .panel, .mat-menu-panel, .mat-select-panel, .cdk-overlay-pane,
.mat-autocomplete-panel {
  background: ${BG.card} !important;
  border: 1px solid ${BORDER.default} !important;
  color: ${TEXT.primary} !important;
}

/* ── Elevated surfaces ── */
.mat-raised-button, .mat-flat-button, .mat-stroked-button,
.mat-button-toggle, .mat-chip, .mat-tab-header,
.mat-tab-label, .mat-tab-group, .mat-paginator {
  background: ${BG.surface} !important;
  color: ${TEXT.secondary} !important;
  border-color: ${BORDER.default} !important;
}

/* ── Primary buttons ── */
.mat-raised-button[color=primary], .mat-flat-button[color=primary],
.mat-fab[color=primary], .mat-mini-fab[color=primary],
button[color=primary], .btn-primary, .mat-button-toggle-checked {
  background: ${BUTTON.primaryBg} !important;
  color: #ffffff !important;
}

/* ── Form fields ── */
.mat-form-field, .mat-input-element, .mat-select,
input, textarea, select {
  background: ${BG.cardAlt} !important;
  color: ${TEXT.primary} !important;
  border-color: ${BORDER.default} !important;
}
.mat-form-field-label, .mat-label, label {
  color: ${TEXT.secondary} !important;
}
.mat-form-field-underline, .mat-form-field-ripple {
  background-color: ${BORDER.strong} !important;
}

/* ── Text ── */
h1, h2, h3, h4, h5, h6, .mat-headline, .mat-title, .mat-subheading-1,
.mat-subheading-2, .mat-body-1, .mat-body-2 {
  color: ${TEXT.primary} !important;
}
p, span, div, li, td, th, .mat-cell, .mat-header-cell {
  color: ${TEXT.secondary} !important;
}
.text-muted, .mat-hint, .mat-caption, small {
  color: ${TEXT.muted} !important;
}

/* ── Table / list ── */
.mat-table, .mat-header-row, .mat-row, table, tr, thead {
  background: ${BG.card} !important;
  border-color: ${BORDER.default} !important;
}
.mat-header-cell, th {
  color: ${TEXT.muted} !important;
  border-color: ${BORDER.default} !important;
}

/* ── Dividers / borders ── */
.mat-divider, hr, .mat-list-item {
  border-color: ${BORDER.default} !important;
}

/* ── Icons ── */
.mat-icon {
  color: ${TEXT.secondary} !important;
}

/* ── Tooltip ── */
.mat-tooltip {
  background: ${BG.surface} !important;
  color: ${TEXT.primary} !important;
}

/* ── Canvas background (the diagram area) ── */
.canvas-container, .diagram-container, #canvas, canvas {
  background: ${BG.page} !important;
}

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #111827; }
::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #4b5563; }

/* ── Angular Material dark-mode specific ── */
.mat-drawer-backdrop { background: rgba(0,0,0,0.6) !important; }
.mat-progress-bar-fill::after { background-color: ${BUTTON.primaryBg} !important; }
.mat-progress-spinner circle { stroke: ${BUTTON.primaryBg} !important; }
.mat-slide-toggle.mat-checked .mat-slide-toggle-bar { background: ${BUTTON.primaryBg}80 !important; }
.mat-slide-toggle.mat-checked .mat-slide-toggle-thumb { background: ${BUTTON.primaryBg} !important; }
.mat-checkbox-checked .mat-checkbox-background { background: ${BUTTON.primaryBg} !important; }
.mat-radio-checked .mat-radio-outer-circle { border-color: ${BUTTON.primaryBg} !important; }
.mat-radio-checked .mat-radio-inner-circle { background: ${BUTTON.primaryBg} !important; }

/* ── Hide third-party branding ── */
img[alt="ZureMap"] { display: none !important; }
.font-bold.text-lg.tracking-tight { font-size: 0 !important; visibility: hidden !important; width: 0 !important; overflow: hidden !important; }
.text-2xl.font-bold.text-gray-900 { font-size: 0 !important; }
.text-2xl.font-bold.text-gray-900::after {
  content: 'Azure Architecture Map';
  font-size: 1.5rem; font-weight: 700; visibility: visible;
  color: ${TEXT.primary};
}
.text-sm.text-gray-500 { visibility: visible; }
header .h-4.w-px { display: none !important; }
`

/* ─── ZureMap URL (same-origin via NGINX, with local dev fallback) ───────── */
const ZUREMAP_PROXY_URL = '/zuremap/#/scan'
const ZUREMAP_LOCAL_URL = 'http://localhost:3001/#/scan'

export default function ArchitectureMapView() {
  const [status, setStatus]     = useState('checking')  // 'checking' | 'online' | 'offline'
  const [useLocal, setUseLocal] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const iframeRef = useRef(null)

  // Check ZureMap availability
  const checkStatus = useCallback(async () => {
    setStatus('checking')
    try {
      // Try same-origin proxy first
      const res = await fetch('/api/zuremap/status', { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = await res.json()
        if (data.available) {
          // The engine self-authenticates at startup via its service principal, so we
          // do NOT trigger a login here (that raced the engine's own `az` token cache
          // and can't run in Container Apps).
          const proxied = data.mode !== 'local'
          if (proxied) {
            // Deployed: the engine is served same-origin under /zuremap/ behind the
            // backend's auth-gated proxy. Prime the short-lived cookie that gates it
            // BEFORE the iframe loads — the iframe can't send our Bearer header.
            try { await fetch('/api/zuremap/session', { method: 'POST' }) } catch { /* best effort */ }
          } else {
            // Local dev (direct localhost:3001): re-apply the brand skin best-effort.
            fetch('/api/zuremap/rebrand', { method: 'POST', signal: AbortSignal.timeout(12000) }).catch(() => {})
          }
          setUseLocal(!proxied)
          setReloadKey(k => k + 1)   // force a clean iframe remount
          setStatus('online')
          return
        }
        setStatus('offline')
        return
      }
    } catch { /* fall through */ }
    // Try direct local connection
    try {
      await fetch('http://localhost:3001', { mode: 'no-cors', signal: AbortSignal.timeout(3000) })
      setUseLocal(true)
      setReloadKey(k => k + 1)
      setStatus('online')
    } catch {
      setStatus('offline')
    }
  }, [])

  useEffect(() => { checkStatus() }, [checkStatus])

  // Inject dark-theme CSS into ZureMap iframe on load
  const handleIframeLoad = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument
      if (doc) {
        const style = doc.createElement('style')
        style.id = 'zuremap-dark-override'
        style.textContent = ZUREMAP_DARK_CSS
        doc.head.appendChild(style)
        // Override page title
        doc.title = 'Architecture Map'
        // Replace branding text nodes
        const allSpans = doc.querySelectorAll('span.font-bold.text-lg.tracking-tight, h1.text-2xl.font-bold')
        allSpans.forEach(el => {
          if (el.textContent?.includes('ZureMap') || el.textContent?.includes('Zuremap')) {
            el.textContent = 'Azure Architecture Map'
            el.style.visibility = 'visible'
            el.style.fontSize = ''
          }
        })
      }
    } catch {
      // Cross-origin (direct localhost): the engine serves its own baked-in dark
      // skin, so no parent-side theming is required here.
      if (iframeRef.current) iframeRef.current.style.background = BG.page
    }
  }, [])

  // Only ever use the direct localhost:3001 engine URL when the BROWSER itself is on
  // localhost (true local dev). In a deployed app the browser is remote, so localhost
  // would resolve to the client's own machine — always use the same-origin /zuremap/ proxy.
  const browserIsLocal = typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const iframeSrc = (useLocal && browserIsLocal) ? ZUREMAP_LOCAL_URL : ZUREMAP_PROXY_URL

  // ── Offline state ──
  if (status === 'offline') {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: `${BUTTON.primaryBg}20` }}>
              <Network size={20} style={{ color: BUTTON.primaryBg }} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-100">Architecture Map</h2>
              <p className="text-xs text-gray-500">Live Azure topology visualization</p>
            </div>
          </div>
          <button onClick={checkStatus} className="btn-ghost flex items-center gap-1.5">
            <RefreshCw size={13} /> Retry
          </button>
        </div>

        {/* Offline info card */}
        <div className="card p-8 text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-4 rounded-full" style={{ background: '#f9731620' }}>
              <AlertTriangle size={32} className="text-orange-400" />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-gray-200">Architecture Engine Not Available</h3>
          <p className="text-sm text-gray-400 max-w-lg mx-auto">
            The Architecture Map is powered by an internal diagram engine that renders
            interactive Azure topology with auto-layout, official Azure icons, and FinOps
            cost overlays. It isn't responding right now.
          </p>
          <div className="text-left max-w-lg mx-auto space-y-2 pt-2">
            <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">How to enable</p>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs text-gray-400 space-y-2 text-left">
              <p>The diagram engine runs as an internal service alongside the platform.
                 Bring the application stack online and it is detected automatically —
                 authentication uses the service principal configured in Settings.</p>
              <p className="text-gray-500">Once the stack is up, click
                 <span className="text-blue-400"> Check Again</span> — the engine comes
                 online within a few seconds. For internal use only.</p>
            </div>
          </div>
          <button onClick={checkStatus} className="btn-primary mt-4">
            <RefreshCw size={14} className="inline mr-1.5" /> Check Again
          </button>
        </div>
      </div>
    )
  }

  // ── Loading / Online state ──
  return (
    <div className="space-y-0 flex flex-col" style={{ height: 'calc(100vh - 80px)' }}>
      {/* Header toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b"
           style={{ background: BG.card, borderColor: BORDER.default }}>
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg" style={{ background: `${BUTTON.primaryBg}20` }}>
            <Network size={16} style={{ color: BUTTON.primaryBg }} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-100">Architecture Map</h2>
            <p className="text-[10px] text-gray-500">Live Azure topology &middot; Auto-layout diagrams</p>
          </div>
          {/* Status dot */}
          <div className="flex items-center gap-1.5 ml-3">
            <span className={`w-2 h-2 rounded-full ${status === 'online' ? 'bg-green-500' : status === 'checking' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[10px] text-gray-500">
              {status === 'online' ? 'Connected' : status === 'checking' ? 'Connecting...' : 'Offline'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={checkStatus} className="btn-ghost flex items-center gap-1.5 text-xs">
            <RefreshCw size={12} /> Refresh
          </button>
          <a href={iframeSrc} target="_blank" rel="noopener noreferrer"
             className="btn-ghost flex items-center gap-1.5 text-xs">
            <ExternalLink size={12} /> Open in New Tab
          </a>
        </div>
      </div>

      {/* ZureMap iframe */}
      <div className="flex-1 relative" style={{ background: BG.page }}>
        {status === 'checking' && (
          <div className="absolute inset-0 flex items-center justify-center z-10"
               style={{ background: BG.page }}>
            <div className="text-center space-y-3">
              <RefreshCw size={24} className="animate-spin text-blue-500 mx-auto" />
              <p className="text-sm text-gray-400">Connecting to Architecture Engine...</p>
            </div>
          </div>
        )}
        <iframe
          key={reloadKey}
          ref={iframeRef}
          src={status === 'online' ? iframeSrc : 'about:blank'}
          onLoad={handleIframeLoad}
          title="Architecture Diagram"
          className="w-full h-full border-0"
          style={{ background: BG.page, borderRadius: `0 0 ${RADIUS.lg}px ${RADIUS.lg}px` }}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
        />
      </div>
    </div>
  )
}
