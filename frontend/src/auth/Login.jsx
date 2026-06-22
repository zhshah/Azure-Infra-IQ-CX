/**
 * Branded Entra ID login page.
 *
 * Shown when the app is auth-gated and the user is not signed in. There is no
 * way into the application without completing sign-in here. Modern dark design
 * that matches the Azure Infra IQ app shell, with a feature showcase alongside
 * the Microsoft Entra ID sign-in card.
 */
import React, { useState } from 'react'
import { login } from './auth.js'
import { Sparkles, Wallet, ShieldCheck, Network, Rocket, ArrowRightLeft, Lock, Activity, Loader2, ArrowRight } from 'lucide-react'

function MicrosoftLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

const FEATURES = [
  { icon: Sparkles, title: 'AI-Powered Insights', desc: 'AI-generated briefings and recommendations across your live estate.' },
  { icon: Wallet, title: 'Cost & FinOps', desc: 'Track spend, allocation, and usage trends across subscriptions.' },
  { icon: ShieldCheck, title: 'BCDR & DR Planning', desc: 'Assess backup and disaster-recovery posture for your workloads.' },
  { icon: Network, title: 'Architecture Mapping', desc: 'Visualize resources and dependencies across subscriptions.' },
  { icon: Rocket, title: 'Modernization', desc: 'Identify workloads and patterns for platform modernization.' },
  { icon: ArrowRightLeft, title: 'Migration', desc: 'Assess and plan migrations to Azure services.' },
  { icon: Lock, title: 'Security', desc: 'Review security posture, identity, and configuration findings.' },
  { icon: Activity, title: 'Resiliency', desc: 'Evaluate availability, zone redundancy, and reliability design.' },
]

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
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-slate-950 text-slate-200">
      {/* Ambient gradient glows */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-sky-600/20 blur-3xl" />
        <div className="absolute -right-40 top-1/4 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-blue-700/10 blur-3xl" />
      </div>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-12 px-6 py-12">
        {/* Hero — value proposition (left) + sign-in (right), aligned at the same height */}
        <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <section className="w-full max-w-xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
              <MicrosoftLogo size={14} /> Microsoft
            </div>

            <div className="mb-6 flex items-center gap-3">
              <img src="/branding/logo-mark.svg" alt="" width={48} height={48} className="h-12 w-12 rounded-xl shadow-lg shadow-sky-900/40" />
              <div>
                <div className="text-2xl font-bold tracking-tight text-white">Azure Infra IQ</div>
                <div className="text-xs text-slate-400">AI-Powered Azure Infrastructure Management &amp; Insights</div>
              </div>
            </div>

            <h1 className="mb-3 text-3xl font-bold leading-tight text-white sm:text-4xl">
              Discover, govern &amp; manage your{' '}
              <span className="bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">Azure estate</span>
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-slate-400">
              A unified view across cost, resilience, governance and architecture — grounded in your live Azure resources.
            </p>
          </section>

          <section className="w-full max-w-md lg:w-[360px] lg:shrink-0">
            <div className="w-full rounded-2xl border border-white/10 bg-slate-900/70 p-8 shadow-2xl shadow-black/50 backdrop-blur-xl">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                <MicrosoftLogo size={16} /> Microsoft Entra ID
              </div>
              <h2 className="mt-5 text-2xl font-bold text-white">Sign in</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                This application is protected by Microsoft Entra ID. Use your organizational account to continue.
              </p>

              <button
                type="button"
                onClick={onSignIn}
                disabled={busy}
                className="group mt-6 flex w-full items-center justify-center gap-3 rounded-lg bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-900/40 transition-colors hover:bg-sky-500 disabled:cursor-default disabled:opacity-70"
              >
                {busy ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Redirecting to Microsoft…
                  </>
                ) : (
                  <>
                    <span className="flex items-center justify-center rounded bg-white p-1">
                      <MicrosoftLogo size={14} />
                    </span>
                    Sign in with Microsoft
                    <ArrowRight size={16} className="opacity-70 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>

              <div className="mt-6 flex items-center justify-center gap-2 border-t border-white/10 pt-4 text-[11px] text-slate-500">
                <ShieldCheck size={13} className="text-emerald-400/80" />
                Secured by Microsoft Entra ID · Single sign-on
              </div>
            </div>

            <p className="mt-4 text-center text-[11px] text-slate-500">
              Need access? Contact your Azure administrator.
            </p>
          </section>
        </div>

        {/* Capabilities — full-width card grid below the hero */}
        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">Platform capabilities</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-sky-500/40 hover:bg-white/10"
              >
                <div className="mb-2.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400 ring-1 ring-inset ring-sky-500/20">
                  <Icon size={18} />
                </div>
                <div className="text-sm font-semibold text-white">{title}</div>
                <div className="mt-1 text-xs leading-relaxed text-slate-400">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="relative z-10 pb-6 text-center text-[11px] text-slate-600">
        © {new Date().getFullYear()} Azure Infra IQ
      </footer>
    </div>
  )
}
