/**
 * Compact account control for the top header banner: profile photo + name/email
 * and a Logout button, styled for the dark header. Renders nothing when no user
 * is signed in (e.g. local open mode), so it is safe to mount unconditionally.
 */
import React, { useState, useEffect } from 'react'
import { getAccount, logout, getProfilePhoto } from './auth.js'

export default function HeaderAccount() {
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState(null)
  const account = getAccount()

  useEffect(() => {
    if (!account) return undefined
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
  }, [account])

  if (!account) return null

  const name = account.name || account.username || 'Signed in'
  const email = account.username || ''
  const initial = (name || '?').trim().charAt(0).toUpperCase()

  const onSignOut = async () => {
    setBusy(true)
    try {
      await logout()
    } catch {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif' }}>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, textAlign: 'right', maxWidth: 190 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ fontSize: 10.5, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
      </div>
      {photo ? (
        <img src={photo} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.2)' }} />
      ) : (
        <span
          aria-hidden="true"
          style={{ width: 30, height: 30, borderRadius: '50%', background: '#0078d4', color: '#fff', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {initial}
        </span>
      )}
      <button
        type="button"
        onClick={onSignOut}
        disabled={busy}
        title="Sign out"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 8,
          border: '1px solid rgba(148, 163, 184, 0.25)',
          background: 'rgba(30, 41, 59, 0.4)',
          color: '#e2e8f0', fontSize: 12, fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = 'rgba(30, 41, 59, 0.7)' }}
        onMouseLeave={(e) => { if (!busy) e.currentTarget.style.background = 'rgba(30, 41, 59, 0.4)' }}
      >
        {busy ? 'Signing out…' : 'Logout'}
      </button>
    </div>
  )
}
