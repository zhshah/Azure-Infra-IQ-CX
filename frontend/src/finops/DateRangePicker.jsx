/**
 * DateRangePicker — shared component used by all FinOps panels.
 * Renders a time-range select; when "custom" is chosen, reveals two date inputs.
 *
 * Props:
 *   value          string  — current TIME_RANGE_OPTIONS value
 *   onChange       fn      — called with new value string
 *   dateFrom       string  — ISO date "YYYY-MM-DD" (only used when value === 'custom')
 *   dateTo         string  — ISO date "YYYY-MM-DD"
 *   onDateFromChange fn
 *   onDateToChange   fn
 *   style          object  — optional outer wrapper style overrides
 */
import React from 'react'
import { TIME_RANGE_OPTIONS } from './finopsApi'

const SEL_STYLE = {
  background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6,
  color: 'var(--c-e2e8f0)', padding: '5px 10px', fontSize: 12, cursor: 'pointer',
}
const DATE_STYLE = {
  background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6,
  color: 'var(--c-e2e8f0)', padding: '5px 8px', fontSize: 12,
  colorScheme: 'dark',
}

export default function DateRangePicker({
  value, onChange,
  dateFrom, dateTo,
  onDateFromChange, onDateToChange,
  style = {},
}) {
  // Default date range: last 30 days
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const from = dateFrom || thirtyDaysAgo
  const to   = dateTo   || today

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', ...style }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={SEL_STYLE}>
        {TIME_RANGE_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {value === 'custom' && (
        <>
          <input
            type="date"
            value={from}
            max={to}
            onChange={e => onDateFromChange?.(e.target.value)}
            style={DATE_STYLE}
            title="Start date"
          />
          <span style={{ color: 'var(--c-475569)', fontSize: 11 }}>→</span>
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={e => onDateToChange?.(e.target.value)}
            style={DATE_STYLE}
            title="End date"
          />
        </>
      )}
    </div>
  )
}
