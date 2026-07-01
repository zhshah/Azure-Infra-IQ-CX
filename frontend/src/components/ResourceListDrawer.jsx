/**
 * ResourceListDrawer — the universal "show me the resources behind this number" drawer.
 *
 * Any dashboard card / KPI / AI finding count can call openResourceDrill(title, resources)
 * (see drill/DrillContext) to slide this open with the exact resources that make up the
 * number. Every row is clickable and opens the full ResourceDetailDrawer (360° view), so a
 * count like "10 VMs not backed up" becomes 10 explorable resources with all their details.
 *
 * Self-contained, dark-themed to match the app, with live search + CSV export. Renders the
 * key resource fields (name+icon, type, resource group, location, monthly cost, score) and
 * a few protection flags so the list is immediately useful without opening each row.
 */
import React, { useState, useMemo } from 'react'
import { X, Search, Download, ChevronRight, Shield, ShieldOff, Lock } from 'lucide-react'
import { ResourceIconImg } from '../utils/resourceIcons'
import { prettyResourceType } from '../utils/resourceTypes'

const money = (v) => {
  const n = Number(v)
  return (v == null || !isFinite(n)) ? '—' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 2 })
}
const rid = (r) => r?.resource_id || r?.id || ''
const rname = (r) => r?.resource_name || r?.name || (rid(r).split('/').pop()) || '—'
const rtype = (r) => r?.resource_type || r?.type || ''
const scoreColor = (s) => (s == null ? 'var(--c-64748b)' : s >= 70 ? '#22c55e' : s >= 50 ? '#f59e0b' : s >= 30 ? '#fb923c' : '#ef4444')

export default function ResourceListDrawer({ title, subtitle, resources = [], onClose, onRowClick }) {
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const arr = Array.isArray(resources) ? resources : []
    if (!search) return arr
    const q = search.toLowerCase()
    return arr.filter((r) =>
      [rname(r), rtype(r), r?.resource_group, r?.location].some((v) => String(v ?? '').toLowerCase().includes(q))
    )
  }, [resources, search])

  const exportCSV = () => {
    const cols = ['Resource', 'Type', 'Resource Group', 'Location', 'Subscription', 'Monthly Cost', 'Score', 'Backup', 'Lock', 'Resource ID']
    const line = (vals) => vals.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
    const body = rows.map((r) => line([
      rname(r), prettyResourceType(rtype(r)) || rtype(r).split('/').pop(), r?.resource_group, r?.location,
      r?.subscription_id, r?.cost_current_month ?? '', r?.final_score ?? '',
      r?.has_backup ? 'Yes' : 'No', r?.has_lock ? 'Yes' : 'No', rid(r),
    ]))
    const blob = new Blob([line(cols) + '\n' + body.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `${(title || 'resources').replace(/[^a-z0-9-_]+/gi, '_')}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }} />
      <div style={{
        position: 'relative', width: 'min(720px, 95vw)', height: '100vh', background: 'var(--c-0d1117)',
        borderLeft: '2px solid #3b82f650', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'rldSlideIn 0.2s ease-out',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--c-1e293b)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ color: 'var(--c-93c5fd)', margin: 0, fontSize: 16, fontWeight: 700 }}>{title || 'Resources'}</h3>
              <p style={{ color: 'var(--c-64748b)', margin: '2px 0 0', fontSize: 12 }}>
                {subtitle || `${rows.length} resource${rows.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--c-64748b)', cursor: 'pointer', padding: 4 }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--c-475569)' }} />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter resources…"
                style={{ width: '100%', background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 8, color: 'var(--c-e2e8f0)', fontSize: 12, padding: '7px 10px 7px 30px', outline: 'none' }}
              />
            </div>
            <button onClick={exportCSV} disabled={!rows.length} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 8, color: 'var(--c-94a3b8)', fontSize: 11, padding: '7px 12px', cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.5 }}>
              <Download size={12} /> CSV
            </button>
          </div>
        </div>

        {/* Column header */}
        <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.3fr 1.3fr 0.9fr 0.8fr 0.5fr', gap: 8, padding: '8px 20px', borderBottom: '1px solid var(--c-1e293b)', background: 'var(--c-0f172a)', flexShrink: 0 }}>
          {['Resource', 'Type', 'Resource Group', 'Location', 'Cost/mo', 'Score'].map((h, i) => (
            <div key={h} style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: i >= 4 ? 'right' : 'left' }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {rows.map((r, idx) => {
            const score = r?.final_score
            return (
              <div key={rid(r) || idx}
                onClick={() => onRowClick && onRowClick(r)}
                title="Open full resource details"
                style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.3fr 1.3fr 0.9fr 0.8fr 0.5fr', gap: 8, padding: '10px 20px', borderBottom: '1px solid #1e293b30', cursor: 'pointer', alignItems: 'center' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#1e293b40')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <ResourceIconImg type={rtype(r)} size={18} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: 'var(--c-e2e8f0)', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rname(r)}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      {r?.has_backup ? <Shield size={10} color="#22c55e" /> : <ShieldOff size={10} color="#64748b" />}
                      {r?.has_lock ? <Lock size={10} color="#60a5fa" /> : null}
                      {r?.power_state ? <span style={{ fontSize: 9, color: 'var(--c-64748b)' }}>{r.power_state}</span> : null}
                    </div>
                  </div>
                </div>
                <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prettyResourceType(rtype(r)) || rtype(r).split('/').pop()}</div>
                <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r?.resource_group || '—'}</div>
                <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r?.location || '—'}</div>
                <div style={{ color: 'var(--c-cbd5e1)', fontSize: 11, textAlign: 'right' }}>{money(r?.cost_current_month)}</div>
                <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                  <span style={{ color: scoreColor(score), fontSize: 12, fontWeight: 700 }}>{score != null ? Math.round(score) : '—'}</span>
                  <ChevronRight size={12} style={{ color: 'var(--c-475569)' }} />
                </div>
              </div>
            )
          })}
          {rows.length === 0 && (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--c-475569)', fontSize: 13 }}>No resources to show</div>
          )}
        </div>
      </div>
      <style>{`@keyframes rldSlideIn { from { transform: translateX(100%); opacity: 0.8; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  )
}
