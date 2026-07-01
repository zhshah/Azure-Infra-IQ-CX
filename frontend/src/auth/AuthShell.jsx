/**
 * Authenticated shell. Wraps the app once the user is signed in and shows an
 * account card (display name, email, Microsoft 365 profile photo) plus a Logout
 * control at the top-right. Signing out clears the Entra session and returns to
 * the login page.
 */
import React, { useState, useEffect } from 'react'
import { getAccount, logout, getProfilePhoto } from './auth.js'

const COLORS = {
  nameText: 'var(--c-f1f5f9)',
  emailText: 'var(--c-94a3b8)',
  avatarBorder: 'rgba(255,255,255,0.25)',
  btnText: 'var(--c-e2e8f0)',
  btnBorder: 'rgba(255,255,255,0.28)',
  btnHover: 'rgba(255,255,255,0.12)',
  primary: '#0078d4',
}

export default function AuthShell({ children }) {
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState(null)
  const account = getAccount()
  const name = (account && account.name) || 'Signed in'
  const email = (account && account.username) || ''
  const initial = (name || '?').trim().charAt(0).toUpperCase()

  useEffect(() => {
    let active = true
    let createdUrl = null
    getProfilePhoto().then((url) => {
      if (active && url) {
        createdUrl = url
        setPhoto(url)
      } else if (url) {
        URL.revokeObjectURL(url)
      }
    })
    return () => {
      active = false
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [])

  const onSignOut = async () => {
    setBusy(true)
    try {
      await logout()
    } catch {
      setBusy(false)
    }
  }

  return (
    <>
      {children}
      <div
        style={{
          position: 'fixed',
          top: 12,
          right: 16,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, textAlign: 'right' }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: COLORS.nameText,
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </span>
          <span
            style={{
              fontSize: 12,
              color: COLORS.emailText,
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {email}
          </span>
        </div>

        {photo ? (
          <img
            src={photo}
            alt=""
            style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', border: `1px solid ${COLORS.avatarBorder}` }}
          />
        ) : (
          <span
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: COLORS.primary,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {initial}
          </span>
        )}

        <button
          type="button"
          onClick={onSignOut}
          disabled={busy}
          style={{
            border: `1px solid ${COLORS.btnBorder}`,
            background: 'transparent',
            color: COLORS.btnText,
            fontSize: 13,
            fontWeight: 600,
            cursor: busy ? 'default' : 'pointer',
            padding: '7px 16px',
            borderRadius: 8,
            fontFamily: 'inherit',
          }}
          onMouseOver={(e) => { if (!busy) e.currentTarget.style.background = COLORS.btnHover }}
          onMouseOut={(e) => { if (!busy) e.currentTarget.style.background = 'transparent' }}
        >
          {busy ? 'Signing out…' : 'Logout'}
        </button>
      </div>
    </>
  )
}
