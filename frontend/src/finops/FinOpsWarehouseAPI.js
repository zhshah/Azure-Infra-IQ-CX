/**
 * FinOps Warehouse API — wrappers for the offline-first nightly data warehouse.
 * All calls hit /api/finops/warehouse/* which reads from Azure SQL.
 * Zero live Azure Cost Management calls — no throttling.
 */

const BASE = '/api/finops/warehouse'

async function request(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Warehouse API ${res.status}: ${text}`)
  }
  return res.json()
}

function buildQS(params) {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  })
  const s = qs.toString()
  return s ? `?${s}` : ''
}

/** ETL job status + data freshness */
export const getWarehouseStatus = () => request('/status')

/** Manually trigger data collection (runs ETL now) */
export const triggerWarehouseETL = () =>
  request('/trigger', { method: 'POST' })

/**
 * Main dashboard — KPIs, daily trend, by-subscription, by-service, top resources,
 * anomalies, monthly service trend, by-environment tag.
 * @param {object} filters  { subscription_id, resource_group, days }
 */
export const getWarehouseDashboard = (filters = {}) =>
  request(`/dashboard${buildQS(filters)}`)

/**
 * Paginated, filterable resource cost table.
 * @param {object} opts  { subscription_id, resource_group, resource_type, service_family, days, page, page_size, sort_by, sort_dir }
 */
export const getWarehouseResources = (opts = {}) =>
  request(`/resources${buildQS(opts)}`)

/**
 * Detected cost anomalies.
 * @param {object} opts  { severity, status, limit }
 */
export const getWarehouseAnomalies = (opts = {}) =>
  request(`/anomalies${buildQS(opts)}`)

/**
 * Monthly cost by service family.
 * @param {object} opts  { subscription_id, months }
 */
export const getWarehouseByService = (opts = {}) =>
  request(`/by-service${buildQS(opts)}`)

/**
 * Monthly cost by tag key/value.
 * @param {object} opts  { tag_key, subscription_id, months }
 */
export const getWarehouseByTag = (opts = {}) =>
  request(`/by-tag${buildQS(opts)}`)

// ── Formatting helpers (shared across warehouse components) ──────────────────

export function fmtUsd(v, compact = false) {
  if (v === null || v === undefined || isNaN(v)) return '$0'
  if (compact && Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (compact && Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

export function fmtPct(v) {
  if (v === null || v === undefined || isNaN(v)) return '0%'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

export function severityColor(s) {
  return { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#22c55e' }[s] || 'var(--c-64748b)'
}

export function ageLabel(hours) {
  if (hours === null || hours === undefined) return 'Unknown'
  if (hours < 1) return 'Less than 1 hour ago'
  if (hours < 24) return `${Math.round(hours)} hours ago`
  return `${Math.round(hours / 24)} days ago`
}

export const CHART_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
  '#14b8a6', '#a78bfa', '#fb7185', '#34d399', '#fbbf24',
]

export const SERVICE_COLORS = {
  'Compute': '#3b82f6',
  'Networking': '#10b981',
  'Storage': '#f59e0b',
  'Databases': '#8b5cf6',
  'AI + Machine Learning': '#06b6d4',
  'Analytics': '#f97316',
  'Security': '#ef4444',
  'Management and Governance': '#6366f1',
  'Developer Tools': '#84cc16',
  'Integration': '#ec4899',
  'Identity': '#14b8a6',
  'IoT': '#34d399',
  'Other': 'var(--c-64748b)',
}

export function serviceColor(name) {
  return SERVICE_COLORS[name] || CHART_PALETTE[
    [...(name || '')].reduce((acc, c) => acc + c.charCodeAt(0), 0) % CHART_PALETTE.length
  ]
}
