/**
 * Entra ID (MSAL) sign-in for the SPA.
 *
 * The app registration is created by the customer; the deployment passes its
 * client id / tenant id to the backend, which exposes them at /api/auth/config.
 * We initialise MSAL from that runtime config (nothing is baked in at build
 * time), then attach the user's token to every /api call.
 *
 * To avoid editing the dozens of scattered `fetch('/api/...')` calls across the
 * app, we monkey-patch window.fetch once and inject the Authorization header for
 * same-origin /api requests. The SSE stream (EventSource, which cannot set
 * headers) uses withToken() to pass the token as ?access_token=.
 */
import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser'

let _msal = null
let _account = null
let _scopes = ['User.Read']
// True when the deployment requires sign-in. Drives STRICT, continuous enforcement:
// a lost/expired session (or any gated 401) bounces straight back to the Entra
// sign-in page — the app is never usable without a live signed-in account.
let _authRequired = false
let _authFailureHandled = false
let _watchdogStarted = false
const _AUTH_CFG_CACHE = 'auth_cfg_v1'

/** Fetch the runtime auth config from the backend. Never throws. */
export async function loadAuthConfig() {
  // Retry a few times so a transient blip fetching the gate config never silently
  // drops a gated deployment into open mode. /api/auth/config is public (no token).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('/api/auth/config', { headers: { 'Content-Type': 'application/json' } })
      if (res.ok) {
        const cfg = await res.json()
        try { localStorage.setItem(_AUTH_CFG_CACHE, JSON.stringify(cfg)) } catch { /* ignore */ }
        return cfg
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
  }
  // Could not reach the gate config. Fall back to the LAST-KNOWN config so a
  // previously-gated app stays gated (fail CLOSED) through a transient blip. The
  // backend also enforces auth on every /api call, so nothing is served signed-out.
  try {
    const cached = JSON.parse(localStorage.getItem(_AUTH_CFG_CACHE) || 'null')
    if (cached && cached.authRequired && cached.clientId) return cached
  } catch {
    /* ignore */
  }
  return { authRequired: false }
}

/**
 * Initialise MSAL and resolve the current account.
 * Returns true when a user is signed in, false otherwise.
 */
export async function initAuth(config) {
  _authRequired = !!(config && config.authRequired)
  if (Array.isArray(config.scopes) && config.scopes.length) _scopes = config.scopes
  _msal = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: config.authority,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin,
      navigateToLoginRequestUrl: true,
    },
    cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false },
  })
  await _msal.initialize()

  // Complete a redirect sign-in if we just came back from Entra.
  const redirect = await _msal.handleRedirectPromise()
  if (redirect && redirect.account) {
    _account = redirect.account
  } else {
    const accounts = _msal.getAllAccounts()
    if (accounts.length > 0) _account = accounts[0]
  }

  if (_account) {
    _msal.setActiveAccount(_account)
  }
  // Install the fetch interceptor + session watchdog whenever the deployment is
  // gated (not only once an account exists) so a session that dies mid-use is
  // caught on the next /api call and bounced to sign-in.
  if (_authRequired) {
    installFetchInterceptor()
    startAuthWatchdog()
  }
  return !!_account
}

export function getAccount() {
  return _account
}

/**
 * Redirect to the Entra sign-in page.
 * If MSAL was not initialised at boot (e.g. the app loaded in open/local mode),
 * lazily initialise it from the runtime auth config first. Returns false when
 * the deployment has no authentication configured (nothing to sign into).
 */
export async function login() {
  if (!_msal) {
    try {
      const cfg = await loadAuthConfig()
      if (cfg && cfg.authRequired && cfg.clientId) await initAuth(cfg)
    } catch {
      /* fall through to the open-access result below */
    }
  }
  if (!_msal) return false
  await _msal.loginRedirect({ scopes: _scopes })
  return true
}

/** Sign out: clears the MSAL session and returns to the app (→ login page). */
export async function logout() {
  if (!_msal) return
  await _msal.logoutRedirect({ account: _account, postLogoutRedirectUri: window.location.origin })
}

/**
 * Strict enforcement entry point: the session is no longer valid (no account, an
 * expired/again-required token, or a gated /api call returned 401). Bounce the user
 * to the Entra sign-in page — the app must never run without a live signed-in user.
 * Debounced so a burst of concurrent 401s can't trigger a redirect loop.
 */
export async function handleAuthFailure() {
  if (!_authRequired || _authFailureHandled) return
  _authFailureHandled = true
  _account = null
  try {
    if (!_msal) {
      const cfg = await loadAuthConfig()
      if (cfg && cfg.authRequired && cfg.clientId) await initAuth(cfg)
    }
    if (_msal) {
      await _msal.loginRedirect({ scopes: _scopes })
      return
    }
  } catch {
    /* fall through to a hard reload, which re-gates via main.jsx → Login */
  }
  window.location.reload()
}

/**
 * Re-validate the session when the tab regains focus / becomes visible. The 401
 * interceptor is the primary guard; this catches an account that was cleared while
 * the tab was backgrounded so the user is sent to sign-in the moment they return.
 */
export function startAuthWatchdog() {
  if (_watchdogStarted || !_authRequired) return
  _watchdogStarted = true
  const check = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (_authRequired && !_account) handleAuthFailure()
  }
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', check)
}

/** Acquire a fresh token (ID token, aud == client id) for the backend. */
export async function getToken() {
  if (!_msal || !_account) return null
  try {
    const result = await _msal.acquireTokenSilent({ account: _account, scopes: _scopes })
    return result.idToken
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      // Session expired / consent needed — bounce through interactive sign-in.
      await _msal.acquireTokenRedirect({ scopes: _scopes })
    }
    return null
  }
}

/** Acquire a Microsoft Graph access token (for /me, /me/photo, …). */
export async function getGraphToken() {
  if (!_msal || !_account) return null
  try {
    const result = await _msal.acquireTokenSilent({ account: _account, scopes: ['User.Read'] })
    return result.accessToken
  } catch {
    return null
  }
}

/**
 * Fetch the signed-in user's Microsoft 365 profile photo as an object URL.
 * Returns null when no photo is set or Graph is unavailable (caller falls back
 * to an initials avatar).
 */
export async function getProfilePhoto() {
  const token = await getGraphToken()
  if (!token) return null
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

let _patched = false
/** Inject `Authorization: Bearer <token>` into all same-origin /api fetches. */
export function installFetchInterceptor() {
  if (_patched) return
  _patched = true
  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const opts = init ? { ...init } : {}
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    const isApi = url.startsWith('/api') || url.startsWith(`${window.location.origin}/api`)
    try {
      if (isApi && _msal && _account) {
        // Defense-in-depth: never let token plumbing wedge a request. If silent
        // token acquisition stalls (e.g. a slow renewal iframe), proceed without it
        // after a short timeout — the call 401s and the app re-authenticates, instead
        // of hanging forever on "Connecting to backend…".
        const token = await Promise.race([
          getToken(),
          new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
        ])
        if (token) {
          const headers = new Headers(
            (init && init.headers) || (typeof input !== 'string' && input && input.headers) || {}
          )
          if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
          opts.headers = headers
        }
      }
    } catch {
      // never block a request because token plumbing hiccupped
    }
    const res = await original(input, opts)
    // STRICT ENFORCEMENT: a 401 on a gated /api call means the session is gone —
    // bounce to interactive sign-in instead of letting the app run signed-out.
    if (_authRequired && isApi && res && res.status === 401) {
      const publicish = url.includes('/api/auth/config') || url.includes('/api/version')
      if (!publicish) handleAuthFailure()
    }
    return res
  }
}

/** Append the token to a URL for EventSource/SSE (which can't send headers). */
export async function withToken(url) {
  if (!_msal || !_account) return url
  const token = await getToken()
  if (!token) return url
  return url + (url.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token)
}
