/**
 * DetailTable — the one way this product renders "a list of resources".
 *
 * Anywhere a panel shows resources it must give the user the same three things, or the
 * number on screen is a dead end: real columns, a row that opens the 360° resource blade,
 * and an export. Dropping this in guarantees all three.
 *
 *   <DetailTable
 *     title="Savings opportunities"
 *     rows={items}
 *     columns={[{ label: 'Resource', value: r => r.resource_name }, …]}
 *   />
 *
 * `View all` hands the full set to ResourceListDrawer (search + CSV + click-through), so
 * a capped preview never hides rows.
 */
import React from 'react'
import { Download } from 'lucide-react'
import { useDrill } from '../../drill/DrillContext'

export function csvDownload(name, columns, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const body = rows.map(r => columns.map(c => esc(c.csv ? c.csv(r) : c.value(r))).join(','))
  const blob = new Blob([columns.map(c => esc(c.label)).join(',') + '\n' + body.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${String(name || 'export').replace(/[^a-z0-9-_]+/gi, '_')}.csv`
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

/** Map the many row shapes in this app onto the fields the drill drawers expect. */
export const asResource = (r = {}) => ({
  ...r,
  resource_id: r.resource_id || r.id || '',
  resource_name: r.resource_name || r.name || r.title || '—',
  resource_type: r.resource_type || r.type || '',
  cost_current_month: r.cost_current_month ?? r.current_monthly_cost ?? r.cost ?? r.cost_usd ?? r.cost_latest ?? 0,
})

export default function DetailTable({
  title, rows, columns, limit = 10, emptyMsg = 'Nothing to show', dense = false,
}) {
  const { openResourceDrill, openResourceDetail } = useDrill()
  const all = Array.isArray(rows) ? rows : []

  if (!all.length) {
    return (
      <div style={{ minHeight: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--c-475569)', fontSize: 11, textAlign: 'center', padding: 12 }}>
        {emptyMsg}
      </div>
    )
  }

  const shown = all.slice(0, limit)
  const th = { padding: dense ? '3px 5px' : '4px 6px', borderBottom: '1px solid var(--c-1e293b)', color: 'var(--c-64748b)', fontWeight: 600, whiteSpace: 'nowrap' }
  const td = { padding: dense ? '4px 5px' : '5px 6px', borderBottom: '1px solid #1e293b22', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  const btn = { display: 'flex', alignItems: 'center', gap: 4, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, color: 'var(--c-94a3b8)', fontSize: 10, padding: '3px 8px', cursor: 'pointer' }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: 'var(--c-475569)', fontSize: 10, marginRight: 'auto' }}>
          {shown.length < all.length ? `${shown.length} of ${all.length}` : `${all.length} item${all.length === 1 ? '' : 's'}`}
          {' · click a row for full details'}
        </span>
        <button onClick={() => csvDownload(title, columns, all)} title="Export every row as CSV" style={btn}>
          <Download size={10} /> CSV
        </button>
        <button onClick={() => openResourceDrill(title, all.map(asResource))}
          title="Open every row in the resource explorer" style={btn}>
          View all {all.length}
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              {columns.map(c => <th key={c.label} style={{ ...th, textAlign: c.align || 'left' }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const res = asResource(r)
              const clickable = !!res.resource_id
              return (
                <tr key={res.resource_id || i}
                  onClick={() => clickable && openResourceDetail(res)}
                  title={clickable ? 'Open full resource details' : 'This row carries no resource id'}
                  style={{ color: 'var(--c-cbd5e1)', cursor: clickable ? 'pointer' : 'default' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1e293b40')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  {columns.map(c => (
                    <td key={c.label} style={{
                      ...td, textAlign: c.align || 'left', maxWidth: c.maxWidth || 200,
                      color: c.color || 'var(--c-cbd5e1)', fontWeight: c.bold ? 600 : 400,
                    }}>
                      {c.render ? c.render(r) : (c.value(r) ?? '—')}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
