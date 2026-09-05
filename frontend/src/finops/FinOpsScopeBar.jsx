/**
 * FinOpsScopeBar — states WHAT a figure or chart actually covers.
 *
 * A number without provenance ("$382 projected") is unusable in a board pack: the
 * reader cannot tell which subscriptions, which resource groups, which month or which
 * currency it refers to. Drop this under any chart header, and mirror the same fields
 * into the export via `scopeExportRows()` so the file carries its own context.
 *
 * <FinOpsScopeBar scope={data.scope} extra={[{ label: 'Budget', value: '$1,000/mo' }]} />
 */
import React from 'react'
import { Layers, Calendar, DollarSign, Database, Clock } from 'lucide-react'

const wrap = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14,
  background: 'var(--c-0b1220)', border: '1px solid var(--c-1e293b)',
  borderRadius: 8, padding: '8px 12px',
}
const item  = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--c-94a3b8)' }
const key   = { color: 'var(--c-64748b)' }
const val   = { color: 'var(--c-cbd5e1)', fontWeight: 600 }

const subsLabel = (scope) => {
  const subs = scope?.subscriptions || []
  if (!subs.length) return '—'
  if (subs.length <= 2) return subs.map(s => s.name || s.id).join(', ')
  return `${subs.length} subscriptions: ${subs.slice(0, 2).map(s => s.name || s.id).join(', ')} +${subs.length - 2}`
}

/** Same provenance as rows, for embedding at the top of any CSV/XLSX export. */
export function scopeExportRows(scope, extra = []) {
  if (!scope) return []
  const rows = [
    ['Scope — subscriptions', (scope.subscriptions || []).map(s => `${s.name || s.id} (${s.id})`).join('; ') || '—'],
    ['Scope — resource groups', scope.resource_groups || 'All'],
    ['Scope — period', scope.period || '—'],
    ['Scope — currency', scope.currency || 'USD'],
    ['Scope — data source', scope.source || '—'],
    ['Scope — generated at (UTC)', scope.generated_at || ''],
  ]
  extra.forEach(e => rows.push([e.label, String(e.value)]))
  return rows
}

export default function FinOpsScopeBar({ scope, extra = [] }) {
  if (!scope) return null
  const gen = scope.generated_at ? new Date(scope.generated_at).toLocaleString() : null
  return (
    <div style={wrap}>
      <span style={item} title={(scope.subscriptions || []).map(s => `${s.name || s.id} (${s.id})`).join('\n')}>
        <Layers size={12} style={{ color: 'var(--c-38bdf8)' }} />
        <span style={key}>Scope</span> <span style={val}>{subsLabel(scope)}</span>
      </span>
      {scope.resource_groups && (
        <span style={item}><span style={key}>Resource groups</span> <span style={val}>{scope.resource_groups}</span></span>
      )}
      <span style={item}>
        <Calendar size={12} style={{ color: 'var(--c-a78bfa)' }} />
        <span style={key}>Period</span> <span style={val}>{scope.period || '—'}</span>
      </span>
      <span style={item}>
        <DollarSign size={12} style={{ color: 'var(--c-4ade80)' }} />
        <span style={key}>Currency</span> <span style={val}>{scope.currency || 'USD'}</span>
      </span>
      {scope.source && (
        <span style={item} title={scope.source}>
          <Database size={12} style={{ color: 'var(--c-64748b)' }} />
          <span style={key}>Source</span> <span style={val}>{scope.source}</span>
        </span>
      )}
      {extra.map(e => (
        <span key={e.label} style={item}><span style={key}>{e.label}</span> <span style={val}>{e.value}</span></span>
      ))}
      {gen && (
        <span style={{ ...item, marginLeft: 'auto' }}>
          <Clock size={12} style={{ color: 'var(--c-64748b)' }} />
          <span style={key}>Generated</span> <span style={val}>{gen}</span>
        </span>
      )}
    </div>
  )
}
