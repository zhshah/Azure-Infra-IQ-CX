import React, { useState } from 'react'
import { Download, ChevronDown, ChevronRight, Filter } from 'lucide-react'

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

export function DataTable({ columns, data, title, emptyMsg, exportFilename }) {
  const [sortField, setSortField] = useState(columns[0]?.key || '')
  const [sortDir, setSortDir] = useState('asc')
  const [search, setSearch] = useState('')

  const filtered = data.filter(row => {
    if (!search) return true
    return columns.some(col => String(row[col.key] || '').toLowerCase().includes(search.toLowerCase()))
  })

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortField], bv = b[sortField]
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc' ? String(av || '').localeCompare(String(bv || '')) : String(bv || '').localeCompare(String(av || ''))
  })

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const handleExport = () => {
    if (!sorted.length) return
    const headers = columns.map(c => c.label)
    const rows = sorted.map(row => columns.map(c => {
      const v = row[c.key]
      return typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v ?? '')
    }))
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${exportFilename || 'report'}-${new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h4 className="text-sm font-semibold text-gray-200">{title}</h4>
        <div className="flex items-center gap-2">
          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 w-36" />
          <button onClick={handleExport} disabled={!sorted.length}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50">
            <Download size={11} /> CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-900/60">
            <tr>
              {columns.map(col => (
                <th key={col.key} onClick={() => toggleSort(col.key)}
                  className="px-3 py-2 text-left text-xs font-medium text-gray-400 cursor-pointer hover:text-gray-200 select-none">
                  {col.label} {sortField === col.key && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {sorted.length === 0 && (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-gray-500">{emptyMsg || 'No data'}</td></tr>
            )}
            {sorted.map((row, i) => (
              <tr key={i} className="hover:bg-gray-800/40 transition-colors">
                {columns.map(col => (
                  <td key={col.key} className="px-3 py-2 text-gray-300">
                    {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
          {sorted.length} of {data.length} record{data.length !== 1 ? 's' : ''}
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
