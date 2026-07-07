/**
 * FinOpsHub — a lightweight tabbed container that consolidates several FinOps
 * capabilities under one sidebar entry. Each tab lazily renders an existing
 * component, so consolidation is parity-safe (no capability is lost or rewritten).
 *
 * Usage: <FinOpsHub title="..." icon={Icon} tabs={[{ key, label, render }]} />
 * An optional `storageKey` remembers the last active tab per hub.
 */
import React, { useState } from 'react'

const tabBtn = (on) => ({
  padding: '8px 15px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  background: 'transparent', border: 'none', borderBottom: `2px solid ${on ? '#0078d4' : 'transparent'}`,
  color: on ? 'var(--c-f1f5f9)' : 'var(--c-94a3b8)', whiteSpace: 'nowrap',
})

export default function FinOpsHub({ title, icon: Icon, subtitle, tabs = [], storageKey }) {
  const initial = (() => {
    if (storageKey) {
      try { const s = localStorage.getItem(storageKey); if (s && tabs.some(t => t.key === s)) return s } catch { /* ignore */ }
    }
    return tabs[0]?.key
  })()
  const [active, setActive] = useState(initial)
  const activeTab = tabs.find(t => t.key === active) || tabs[0]

  const pick = (k) => {
    setActive(k)
    if (storageKey) { try { localStorage.setItem(storageKey, k) } catch { /* ignore */ } }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {title && (
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
            {Icon && <Icon size={20} style={{ color: '#0078d4' }} />} {title}
          </h2>
          {subtitle && <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '4px 0 0' }}>{subtitle}</p>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--c-1e293b)', overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => pick(t.key)} style={tabBtn(t.key === active)}>{t.label}</button>
        ))}
      </div>
      <div>{activeTab?.render ? activeTab.render() : null}</div>
    </div>
  )
}
