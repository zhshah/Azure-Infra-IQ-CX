/**
 * Lightweight app-wide toast. No provider/prop-drilling required: any module can call
 * `notify('Added 3 resources to Project X')` and the single <ToastHost/> (mounted once in
 * AppInner) renders it. Used to give visible confirmation for actions like
 * "add resources to a project" that otherwise change nothing on screen.
 */
import React, { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, X } from 'lucide-react'

const EVENT = 'app-toast'

/** Fire a toast from anywhere. type: 'success' | 'error' | 'info'. */
export function notify(message, type = 'success') {
  if (typeof window === 'undefined' || !message) return
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, type, id: Date.now() + Math.random() } }))
}

export function ToastHost() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    const onToast = (e) => {
      const t = e.detail
      setToasts(prev => [...prev, t])
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4200)
    }
    window.addEventListener(EVENT, onToast)
    return () => window.removeEventListener(EVENT, onToast)
  }, [])

  if (!toasts.length) return null

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-2xl border text-sm font-medium animate-[slideIn_0.18s_ease-out] ${
            t.type === 'error'
              ? 'bg-red-950/95 border-red-700/60 text-red-200'
              : t.type === 'info'
                ? 'bg-gray-900/95 border-gray-700/60 text-gray-200'
                : 'bg-emerald-950/95 border-emerald-700/60 text-emerald-200'
          }`}
        >
          {t.type === 'error'
            ? <AlertTriangle size={16} className="shrink-0 text-red-400" />
            : <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />}
          <span className="max-w-[360px]">{t.message}</span>
          <button
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
            className="ml-1 text-current/60 hover:text-current shrink-0"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
