/**
 * Branded Entra ID login page.
 *
 * Shown when the app is auth-gated and the user is not signed in. There is no
 * way into the application without completing sign-in here. Styled to match the
 * Microsoft / Fluent look (Segoe UI, #0078d4, light canvas, minimal chrome).
 */
import React, { useState } from 'react'
import { login } from './auth.js'

const COLORS = {
  pageBg: '#f3f5f8',
  panel: '#ffffff',
  border: '#e1dfdd',
  textStrong: '#252423',
  text: '#323130',
  muted: '#605e5c',
  primary: '#0078d4',
  primaryHover: '#106ebe',
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

export default function Login() {
  const [busy, setBusy] = useState(false)

  const onSignIn = async () => {
    setBusy(true)
    try {
      await login()
    } catch {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: COLORS.pageBg,
        fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
        color: COLORS.text,
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 4,
          boxShadow: '0 1.6px 3.6px rgba(0,0,0,.08), 0 0.3px 0.9px rgba(0,0,0,.06)',
          padding: '36px 32px',
        }}
      >
        {/* Microsoft corporate mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <MicrosoftLogo />
          <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.text }}>Microsoft</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 6,
              background: 'linear-gradient(135deg, #0078d4, #00a4ef)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 19h16" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
              <rect x="5" y="11" width="3" height="6" rx="1" fill="#fff" />
              <rect x="10.5" y="7" width="3" height="10" rx="1" fill="#fff" />
              <rect x="16" y="9" width="3" height="8" rx="1" fill="#fff" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.textStrong, lineHeight: 1.2 }}>
              Azure Infra IQ
            </div>
            <div style={{ fontSize: 12, color: COLORS.muted }}>AI Powered Azure Infrastructure Management and Insights</div>
          </div>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 600, color: COLORS.textStrong, margin: '20px 0 6px' }}>
          Sign in
        </h1>
        <p style={{ fontSize: 13, color: COLORS.muted, margin: '0 0 24px', lineHeight: 1.5 }}>
          This application is protected by Microsoft Entra ID. Please sign in with your
          organizational account to continue.
        </p>

        <button
          type="button"
          onClick={onSignIn}
          disabled={busy}
          style={{
            width: '100%',
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            background: busy ? '#b6cdf0' : COLORS.primary,
            color: '#fff',
            border: 'none',
            borderRadius: 2,
            fontSize: 14,
            fontWeight: 600,
            cursor: busy ? 'default' : 'pointer',
            fontFamily: 'inherit',
          }}
          onMouseOver={(e) => { if (!busy) e.currentTarget.style.background = COLORS.primaryHover }}
          onMouseOut={(e) => { if (!busy) e.currentTarget.style.background = COLORS.primary }}
        >
          <span
            style={{
              background: '#fff',
              borderRadius: 2,
              padding: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MicrosoftLogo />
          </span>
          {busy ? 'Redirecting to Microsoft…' : 'Sign in with Microsoft'}
        </button>

        <div
          style={{
            marginTop: 28,
            paddingTop: 16,
            borderTop: `1px solid ${COLORS.border}`,
            fontSize: 11.5,
            color: COLORS.muted,
            textAlign: 'center',
          }}
        >
          Secured by Microsoft Entra ID
        </div>
      </div>
    </div>
  )
}
