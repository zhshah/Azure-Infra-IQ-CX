import React, { useState, useMemo } from 'react'
import { Download, ChevronDown, ChevronRight, Filter, ChevronLeft } from 'lucide-react'
import { prettyResourceType, resourceTypeIconUrl } from '../../utils/resourceTypes'

const _stamp = () => new Date().toISOString().split('T')[0]
function _download(filename, mime, content) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

// Brand logo as a base64 data URI for Excel exports — fetched once, then cached.
let _brandLogoPromise = null
function _getBrandLogo() {
  if (!_brandLogoPromise) {
    _brandLogoPromise = fetch('/branding/logo-mark-256.png')
      .then(r => (r.ok ? r.blob() : null))
      .then(b => (b ? new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.onerror = () => res(''); fr.readAsDataURL(b) }) : ''))
      .catch(() => '')
  }
  return _brandLogoPromise
}

// ── Shared KPI Card ─────────────────────────────────────────────────────────

export function KPICard({ label, value, subtitle, color = 'blue', icon: Icon, onClick }) {
  const colors = {
    blue: 'border-blue-600/40 bg-blue-900/10',
    green: 'border-green-600/40 bg-green-900/10',
    red: 'border-red-600/40 bg-red-900/10',
    amber: 'border-amber-600/40 bg-amber-900/10',
    purple: 'border-purple-600/40 bg-purple-900/10',
    cyan: 'border-cyan-600/40 bg-cyan-900/10',
  }
  const textColors = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
    purple: 'text-purple-400',
    cyan: 'text-cyan-400',
  }
  return (
    <div className={`rounded-xl border ${colors[color]} p-4 flex flex-col gap-1 ${onClick ? 'cursor-pointer hover:brightness-110' : ''}`} onClick={onClick}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-medium">{label}</span>
        {Icon && <Icon size={14} className={textColors[color]} />}
      </div>
      <div className={`text-2xl font-bold ${textColors[color]}`}>{value}</div>
      {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
    </div>
  )
}

// ── Shared Data Table with Export ────────────────────────────────────────────

export function DataTable({ columns, data, title, emptyMsg, exportFilename, pageSize = 25 }) {
  const [sortField, setSortField] = useState('')
  const [sortDir, setSortDir] = useState('asc')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({})   // { colKey: selectedValue }
  const [page, setPage] = useState(0)

  const rows = Array.isArray(data) ? data : []
  const filterCols = columns.filter(c => c.filterable)

  // Distinct values for each filterable column (for the dropdowns).
  const distinct = useMemo(() => {
    const m = {}
    filterCols.forEach(c => {
      const vals = new Set()
      rows.forEach(r => { const v = r[c.key]; if (v !== null && v !== undefined && v !== '') vals.add(String(v)) })
      m[c.key] = [...vals].sort((a, b) => a.localeCompare(b))
    })
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns])

  const filtered = useMemo(() => rows.filter(row => {
    if (search) {
      const hit = columns.some(col => String(row[col.key] ?? '').toLowerCase().includes(search.toLowerCase()))
      if (!hit) return false
    }
    for (const [k, v] of Object.entries(filters)) {
      if (v && String(row[k] ?? '') !== v) return false
    }
    return true
  }), [rows, search, filters, columns])

  const sorted = useMemo(() => {
    if (!sortField) return filtered
    return [...filtered].sort((a, b) => {
      const av = a[sortField], bv = b[sortField]
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
      return sortDir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''))
    })
  }, [filtered, sortField, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pageRows = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize)

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
    setPage(0)
  }

  // Plain-text cell value for export (no JSX).
  const cellText = (col, row) => {
    const v = row[col.key]
    if (col.exportValue) return col.exportValue(v, row)
    if (col.kind === 'resourceType') return prettyResourceType(v)
    return v == null ? '' : String(v)
  }

  const exportCsv = () => {
    if (!sorted.length) return
    const headers = columns.map(c => c.label)
    const body = sorted.map(row => columns.map(c => {
      const t = cellText(c, row)
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }))
    _download(`${exportFilename || 'report'}-${_stamp()}.csv`, 'text/csv',
      [headers.join(','), ...body.map(r => r.join(','))].join('\n'))
  }

  const exportXls = async () => {
    if (!sorted.length) return
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const ncol = columns.length
    const logo = await _getBrandLogo()
    const brandRow = `<tr><td colspan="${ncol}" style="background:#0A66C2;padding:8px 12px;font-family:Segoe UI,Arial,sans-serif">${logo ? `<img src="${logo}" width="26" height="26" style="vertical-align:middle"/>&nbsp;&nbsp;` : ''}<span style="color:#ffffff;font-size:15pt;font-weight:bold">Azure Infra IQ</span></td></tr>`
    const subRow = `<tr><td colspan="${ncol}" style="background:#0A66C2;color:#cfe3fa;padding:0 12px 8px;font-family:Segoe UI,Arial,sans-serif;font-size:9pt">${esc(title || 'Report')} &middot; Exported ${esc(new Date().toLocaleString())}</td></tr>`
    const head = `<tr>${columns.map(c => `<th style="background:#1f2937;color:#fff;text-align:left">${esc(c.label)}</th>`).join('')}</tr>`
    const body = sorted.map(row => `<tr>${columns.map(c => `<td>${esc(cellText(c, row))}</td>`).join('')}</tr>`).join('')
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1" cellspacing="0">${brandRow}${subRow}${head}${body}</table></body></html>`
    _download(`${exportFilename || 'report'}-${_stamp()}.xls`, 'application/vnd.ms-excel', html)
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-800 flex-wrap">
        <h4 className="text-sm font-semibold text-gray-200">{title}</h4>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="text" placeholder="Search…" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 w-40" />
          <button onClick={exportCsv} disabled={!sorted.length} title="Export CSV"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50">
            <Download size={11} /> CSV
          </button>
          <button onClick={exportXls} disabled={!sorted.length} title="Export Excel"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-emerald-800/70 hover:bg-emerald-700 text-emerald-100 disabled:opacity-50">
            <Download size={11} /> Excel
          </button>
        </div>
      </div>

      {filterCols.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800/60 bg-gray-900/30 flex-wrap">
          <Filter size={12} className="text-gray-500 shrink-0" />
          {filterCols.map(c => (
            <select key={c.key} value={filters[c.key] || ''}
              onChange={e => { setFilters(f => ({ ...f, [c.key]: e.target.value })); setPage(0) }}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 max-w-[200px]">
              <option value="">{c.label}: All</option>
              {(distinct[c.key] || []).map(v => (
                <option key={v} value={v}>{c.kind === 'resourceType' ? prettyResourceType(v) : v}</option>
              ))}
            </select>
          ))}
          {activeFilterCount > 0 && (
            <button onClick={() => { setFilters({}); setPage(0) }}
              className="text-xs text-gray-400 hover:text-gray-200 underline">Clear filters</button>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-900/60">
            <tr>
              {columns.map(col => (
                <th key={col.key} onClick={() => toggleSort(col.key)}
                  className="px-3 py-2 text-left text-xs font-medium text-gray-400 cursor-pointer hover:text-gray-200 select-none whitespace-nowrap">
                  {col.label} {sortField === col.key && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {pageRows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-gray-500">{emptyMsg || 'No data'}</td></tr>
            )}
            {pageRows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-800/40 transition-colors">
                {columns.map(col => (
                  <td key={col.key} className="px-3 py-2 text-gray-300 align-top">
                    {col.kind === 'resourceType' ? (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <img src={resourceTypeIconUrl(row[col.key])} alt="" width={14} height={14}
                          onError={e => { e.currentTarget.style.display = 'none' }} />
                        {prettyResourceType(row[col.key])}
                      </span>
                    ) : col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
          <span>
            {activeFilterCount > 0 || search
              ? `${sorted.length} of ${rows.length} record${rows.length !== 1 ? 's' : ''} (filtered)`
              : `${rows.length} record${rows.length !== 1 ? 's' : ''}`}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                className="p-1 rounded hover:bg-gray-800 disabled:opacity-40"><ChevronLeft size={13} /></button>
              <span>Page {safePage + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
                className="p-1 rounded hover:bg-gray-800 disabled:opacity-40"><ChevronRight size={13} /></button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Horizontal Bar Chart ────────────────────────────────────────────────────

export function HorizontalBarChart({ data, title, valueKey = 'value', labelKey = 'label', maxBarColor = '#3b82f6' }) {
  const maxVal = Math.max(...data.map(d => d[valueKey] || 0), 1)
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <h4 className="text-sm font-semibold text-gray-200 mb-3">{title}</h4>
      <div className="space-y-2">
        {data.map((item, i) => (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400 truncate max-w-[200px]">{item[labelKey]}</span>
              <span className="text-gray-300">{item[valueKey]}</span>
            </div>
            <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${(item[valueKey] / maxVal) * 100}%`, backgroundColor: item.color || maxBarColor }} />
            </div>
          </div>
        ))}
        {data.length === 0 && <p className="text-xs text-gray-500 text-center py-4">No data available</p>}
      </div>
    </div>
  )
}

// ── Donut/Ring Chart ────────────────────────────────────────────────────────

export function DonutChart({ value, max = 100, label, color }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference
  const fillColor = color || (pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444')

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="90" height="90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#1e293b" strokeWidth="8" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke={fillColor} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
        <text x="50" y="50" textAnchor="middle" dy="4" fill={fillColor} fontSize="14" fontWeight="bold">
          {Math.round(pct)}%
        </text>
      </svg>
      {label && <span className="text-xs text-gray-400">{label}</span>}
    </div>
  )
}

// ── Severity Badge ──────────────────────────────────────────────────────────

export function SeverityBadge({ severity }) {
  const styles = {
    critical: 'bg-red-900/40 text-red-400 border-red-800/40',
    high: 'bg-orange-900/40 text-orange-400 border-orange-800/40',
    medium: 'bg-amber-900/40 text-amber-400 border-amber-800/40',
    low: 'bg-green-900/40 text-green-400 border-green-800/40',
    info: 'bg-blue-900/40 text-blue-400 border-blue-800/40',
  }
  const s = (severity || 'info').toLowerCase()
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs border ${styles[s] || styles.info}`}>
      {severity || 'Info'}
    </span>
  )
}
