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

/** Fetch the runtime auth config from the backend. Never throws. */
export async function loadAuthConfig() {
  try {
    const res = await fetch('/api/auth/config', { headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) return { authRequired: false }
    return await res.json()
  } catch {
    // If the backend is unreachable we fail open to the app, which will surface
    // its own "backend unavailable" message rather than a blank login screen.
    return { authRequired: false }
  }
}

/**
 * Initialise MSAL and resolve the current account.
 * Returns true when a user is signed in, false otherwise.
 */
export async function initAuth(config) {
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
    installFetchInterceptor()
  }
  return !!_account
}

export function getAccount() {
  return _account
}

/** Redirect to the Entra sign-in page. */
export async function login() {
  if (!_msal) return
  await _msal.loginRedirect({ scopes: _scopes })
}

/** Sign out: clears the MSAL session and returns to the app (→ login page). */
export async function logout() {
  if (!_msal) return
  await _msal.logoutRedirect({ account: _account, postLogoutRedirectUri: window.location.origin })
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
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      const isApi = url.startsWith('/api') || url.startsWith(`${window.location.origin}/api`)
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
    return original(input, opts)
  }
}

/** Append the token to a URL for EventSource/SSE (which can't send headers). */
export async function withToken(url) {
  if (!_msal || !_account) return url
  const token = await getToken()
  if (!token) return url
  return url + (url.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token)
}
