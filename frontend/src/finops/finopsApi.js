/**
 * FinOps shared API helper — thin wrappers around the existing api/client.js
 * All requests go to /api/finops/* which proxies to Azure Cost Management.
 *
 * AbortController: every exported function accepts an optional `signal` param.
 * Pass an AbortController.signal to cancel in-flight requests on unmount/re-run.
 *
 * Filter options cache: module-level 5-min TTL cache eliminates repeated fetches
 * every time CostExplorer / Dashboard / AdvancedFilterBar mounts.
 */

const BASE = '/api/finops'

// ─── Module-level filter options cache (5-minute TTL) ────────────────────────
let _filterOptionsCache = null
let _filterOptionsTTL   = 0
const FILTER_CACHE_MS   = 5 * 60 * 1000

async function request(path, opts = {}, signal) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    signal,
    ...opts,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`FinOps API error ${res.status}: ${text}`)
  }
  return res.json()
}

/** Fetch subscription list (with names) — instant from dashboard cache */
export const getSubscriptions = (signal) =>
  fetch('/api/subscriptions', { signal }).then(r => r.ok ? r.json() : Promise.resolve([]))

/** Fetch filter options (RGs, regions, types, tag keys) — cached 5 min at module level */
export async function getFilterOptions(signal) {
  const now = Date.now()
  if (_filterOptionsCache && now < _filterOptionsTTL) return _filterOptionsCache
  const r = await fetch('/api/finops/filter-options', { signal })
  const data = r.ok ? await r.json() : {
    subscriptions: [], resource_groups: [], resource_types: [],
    regions: [], tag_keys: [],
  }
  _filterOptionsCache = data
  _filterOptionsTTL   = now + FILTER_CACHE_MS
  return data
}

/** Force-invalidate the filter options cache (call after subscription changes) */
export function invalidateFilterCache() {
  _filterOptionsCache = null
  _filterOptionsTTL   = 0
}

/**
 * Drill into Cost Explorer pre-filtered. Stashes a pending drill in sessionStorage
 * and fires the app-level 'navigate' event so any chart bar / table row can deep-
 * link into a filtered Cost Explorer view.
 */
export function drillToExplorer({ groupBy, timeRange, advFilters } = {}) {
  try {
    sessionStorage.setItem('finops:drill', JSON.stringify({
      groupBy: groupBy || null, timeRange: timeRange || null, advFilters: advFilters || null, ts: Date.now(),
    }))
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('navigate', { detail: 'cost-explorer' }))
}

/** Consume a pending Cost Explorer drill (called once by CostExplorer on mount). */
export function consumeDrill() {
  try {
    const raw = sessionStorage.getItem('finops:drill')
    if (!raw) return null
    sessionStorage.removeItem('finops:drill')
    const d = JSON.parse(raw)
    if (Date.now() - (d.ts || 0) > 15000) return null   // stale
    return d
  } catch { return null }
}

/** Fetch available scopes (subscriptions + management groups) */
export const getScopes = (signal) =>
  fetch('/api/finops/scopes', { signal }).then(r => r.ok ? r.json() : Promise.resolve({ subscriptions: [], management_groups: [] }))

/** Fetch Azure Advisor cost recommendations from dashboard cache */
export const getAdvisorCost = (signal) =>
  fetch('/api/finops/advisor-cost', { signal }).then(r => r.ok ? r.json() : Promise.resolve({ items: [], total_savings_monthly: 0, item_count: 0 }))

/** Fetch oversized / underutilized resource analysis */
export const getResourceOptimization = (signal) =>
  fetch('/api/finops/resource-optimization', { signal }).then(r => r.ok ? r.json() : Promise.resolve({
    oversized: [], underutilized: [], orphaned: [],
    oversized_count: 0, underutilized_count: 0, orphaned_count: 0, total_oversized_savings: 0,
  }))

export const finopsApi = {
  getSummary:    (signal)       => request('/summary', {}, signal),
  /**
   * Metrics Service — THE single source of truth for headline numbers
   * (GET /api/metrics/summary). Every KPI card / dashboard tile / Cost Studio
   * strip / AI narrative should read from here so a metric is never computed two
   * different ways. Returns { spend, forecast, resources, reservations, budgets,
   * savings, anomalies, trend, dataThroughDate, currency }.
   */
  getMetrics: (scope, signal) => {
    const qs = scope ? `?scope=${encodeURIComponent(scope)}` : ''
    return fetch(`/api/metrics/summary${qs}`, { signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`metrics ${r.status}`)))
  },
  getDashboardData: (params = {}, signal) => {
    const qs = new URLSearchParams()
    if (params.subscription_id) qs.set('subscription_id', params.subscription_id)
    if (params.resource_group)  qs.set('resource_group', params.resource_group)
    if (params.time_range)      qs.set('time_range', params.time_range)
    if (params.group_by)        qs.set('group_by', params.group_by)
    return request(`/dashboard-data?${qs.toString()}`, {}, signal)
  },
  getAdvisorCost: (signal)     => request('/advisor-cost', {}, signal),
  getResourceOptimization: (signal) => request('/resource-optimization', {}, signal),
  costExplorer:  (query, signal)  => request('/cost-explorer', { method: 'POST', body: JSON.stringify(query) }, signal),
  getAllocation:  (dim, tr, dateFrom, dateTo, signal) => {
    let url = `/allocation?dimension=${encodeURIComponent(dim)}&time_range=${tr}`
    if (tr === 'custom' && dateFrom) url += `&date_from=${dateFrom}&date_to=${dateTo || dateFrom}`
    return request(url, {}, signal)
  },
  getChargeback: (tr, dateFrom, dateTo, signal) => {
    let url = `/chargeback?time_range=${tr}`
    if (tr === 'custom' && dateFrom) url += `&date_from=${dateFrom}&date_to=${dateTo || dateFrom}`
    return request(url, {}, signal)
  },
  /** Real chargeback engine — POST the allocation model (cost centers + rules +
   *  shared-allocation method + markup); returns the computed chargeback statement. */
  computeChargeback: (model, signal) =>
    request('/chargeback/compute', { method: 'POST', body: JSON.stringify(model || {}) }, signal),
  /** Unit economics — POST scope + value drivers; returns cost-per-unit per driver. */
  computeUnitEconomics: (model, signal) =>
    request('/unit-economics', { method: 'POST', body: JSON.stringify(model || {}) }, signal),
  /** Recommendation Studio — POST scope filters + goals + constraints + priority + business
   *  context; returns deterministic grounded actions + an AI-personalized phased roadmap. */
  getRecommendations: (model, signal) =>
    request('/recommendations', { method: 'POST', body: JSON.stringify(model || {}) }, signal),
  /** Generic multi-sheet XLSX export for any module. payload = {title, sheets:[{name,columns,rows}]}. */
  exportGenericXlsx: async (payload) => {
    const res = await fetch(BASE + '/export/generic-xlsx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}),
    })
    if (!res.ok) throw new Error(`XLSX export failed (${res.status})`)
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') || ''
    const m = cd.match(/filename="?([^"]+)"?/)
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = m ? m[1] : 'finops-export.xlsx'
    document.body.appendChild(a); a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
  },
  getForecast:   (h, signal)      => request(`/forecast?horizon=${h}`, {}, signal),
  getCommitments: (signal)        => request('/commitments', {}, signal),
  getSavings:    (signal)         => request('/savings', {}, signal),
  getTagAnalytics: (tr, dateFrom, dateTo, signal) => {
    let url = `/tag-analytics?time_range=${tr}`
    if (tr === 'custom' && dateFrom) url += `&date_from=${dateFrom}&date_to=${dateTo || dateFrom}`
    return request(url, {}, signal)
  },
  getTagCostMatrix: (key, tr, signal) => request(`/tag-analytics/${encodeURIComponent(key)}?time_range=${tr}`, {}, signal),
  getTopMovers:  (dim, lim, signal) => request(`/top-movers?dimension=${encodeURIComponent(dim)}&limit=${lim}`, {}, signal),

  // Budgets
  listBudgets:      (sync, signal) => request(`/budgets${sync ? '?sync_azure=true' : ''}`, {}, signal),
  createBudget:     (b)    => request('/budgets', { method: 'POST', body: JSON.stringify(b) }),
  getBudget:        (id, signal)   => request(`/budgets/${id}`, {}, signal),
  updateBudget:     (id, b) => request(`/budgets/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteBudget:     (id)   => fetch(BASE + `/budgets/${id}`, { method: 'DELETE' }),
  getBudgetVariance: (id, signal)  => request(`/budgets/${id}/variance`, {}, signal),
  getBudgetAlerts:  (signal)       => request('/budgets/alerts', {}, signal),

  // Export
  exportCsv:        (dim, tr) => `${BASE}/export/csv?dimension=${encodeURIComponent(dim)}&time_range=${tr}`,
  exportChargeback: (tr)      => `${BASE}/export/chargeback-csv?time_range=${tr}`,

  // Blob-based CSV downloads — surface errors instead of opening a blank tab.
  downloadCsv: async (dim, tr) => {
    const res = await fetch(`${BASE}/export/csv?dimension=${encodeURIComponent(dim)}&time_range=${tr}`)
    if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`CSV export failed (${res.status}): ${t}`) }
    const blob = await res.blob()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    const cd = res.headers.get('content-disposition') || ''
    a.download = cd.match(/filename="?([^"]+)"?/)?.[1] || `azure-cost-${dim}-${tr}.csv`
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
  },
  downloadChargebackCsv: async (tr) => {
    const res = await fetch(`${BASE}/export/chargeback-csv?time_range=${tr}`)
    if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`CSV export failed (${res.status}): ${t}`) }
    const blob = await res.blob()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    const cd = res.headers.get('content-disposition') || ''
    a.download = cd.match(/filename="?([^"]+)"?/)?.[1] || `azure-chargeback-${tr}.csv`
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
  },

  // FOCUS 1.2 (FinOps Open Cost and Usage Specification)
  getFocus: (days = 30, limit = 2000, signal) => request(`/focus?days=${days}&limit=${limit}`, {}, signal),
  downloadFocusCsv: async (days = 30) => {
    const res = await fetch(`${BASE}/export/focus-csv?days=${days}`)
    if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`FOCUS export failed (${res.status}): ${t}`) }
    const blob = await res.blob()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `azure-focus-1.2-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
  },

  // AI insights for a FinOps view (cached server-side per data fingerprint).
  // `scope` is an optional free-text focus area that narrows the analysis.
  aiInsights: (view, data, filters, forceRefresh, signal, scope, context) =>
    request('/ai/insights', {
      method: 'POST',
      body: JSON.stringify({ view, data, filters: filters || null, force_refresh: !!forceRefresh, scope: scope || null, context: context || null }),
    }, signal),

  // XLSX exports (blob downloads — no AbortController needed, short-lived)
  exportXlsx: async (query) => {
    const res = await fetch(BASE + '/export/xlsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`XLSX export failed (${res.status}): ${text}`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    const cd = res.headers.get('content-disposition') || ''
    a.download = cd.match(/filename="?([^"]+)"?/)?.[1] || 'azure-cost.xlsx'
    document.body.appendChild(a); a.click()
    setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 1000)
  },
  exportAllocationXlsx: (dim, tr, dateFrom, dateTo) => {
    const url = `${BASE}/export/xlsx`
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_range: tr, date_from: dateFrom || null, date_to: dateTo || null, granularity: 'None', group_by: [dim], cost_type: 'ActualCost' }),
    }).then(async r => {
      if (!r.ok) {
        const text = await r.text().catch(() => r.statusText)
        throw new Error(`XLSX export failed (${r.status}): ${text}`)
      }
      const blob = await r.blob()
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      const cd = r.headers.get('content-disposition') || ''
      a.download = cd.match(/filename="?([^"]+)"?/)?.[1] || 'azure-allocation.xlsx'
      document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000)
    })
  },
  downloadReport: async (signal) => {
    const res = await fetch(BASE + '/report/xlsx', { signal })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`Report download failed (${res.status}): ${text}`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    const cd = res.headers.get('content-disposition') || ''
    a.download = cd.match(/filename="?([^"]+)"?/)?.[1] || `finops-report-${new Date().toISOString().slice(0,10)}.xlsx`
    document.body.appendChild(a); a.click()
    setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 1000)
  },

  clearCache: () => fetch(BASE + '/cache/clear', { method: 'POST' }).then(r => r.json()),

  // ── Advanced: cost drill-down · dependencies/workloads · period comparison ──
  /** Resources behind a cost slice (drill-down leaf). params: subscription_id,
   *  resource_group, resource_type, region, tag_key, tag_value, environment,
   *  search, min_cost, max_cost, limit. */
  getCostResources: (params = {}, signal) => {
    const qs = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') qs.set(k, v) })
    return request(`/cost-resources?${qs.toString()}`, {}, signal)
  },
  /** Workload / dependency cost roll-up. groupBy = dependency | resource_group | tag.
   *  opts = { subscription_id, region } scope filters. */
  getWorkloads: (groupBy = 'dependency', tagKey = null, opts = {}, signal) => {
    const qs = new URLSearchParams({ group_by: groupBy })
    if (tagKey) qs.set('tag_key', tagKey)
    if (opts && opts.subscription_id) qs.set('subscription_id', opts.subscription_id)
    if (opts && opts.region) qs.set('region', opts.region)
    return request(`/workloads?${qs.toString()}`, {}, signal)
  },
  /** Period-over-period comparison (this month MTD vs last month) by dimension. */
  getCompare: (dimension = 'ResourceGroupName', tagKey = null, signal) => {
    const qs = new URLSearchParams({ dimension })
    if (tagKey) qs.set('tag_key', tagKey)
    return request(`/compare?${qs.toString()}`, {}, signal)
  },
  /** Multi-level cost flow for a Sankey diagram (subscription → RG → service). */
  getCostFlow: (opts = {}, signal) => {
    const qs = new URLSearchParams({ levels: opts.levels || 'subscription,resource_group,service' })
    if (opts.subscription_id) qs.set('subscription_id', opts.subscription_id)
    if (opts.resource_group) qs.set('resource_group', opts.resource_group)
    if (opts.region) qs.set('region', opts.region)
    if (opts.top_per_level) qs.set('top_per_level', opts.top_per_level)
    return request(`/cost-flow?${qs.toString()}`, {}, signal)
  },
  /** Cost anomaly intelligence — rolling-baseline detection + AI root-cause. */
  getAnomalies: (opts = {}, signal) => {
    const qs = new URLSearchParams()
    if (opts.days) qs.set('days', opts.days)
    if (opts.z != null) qs.set('z', opts.z)
    if (opts.include_ai === false) qs.set('include_ai', 'false')
    return request(`/anomalies?${qs.toString()}`, {}, signal)
  },
  /** Cross-domain Cost Lens — spend tied to resiliency / security / governance signals. */
  getCostLens: (lens = 'resiliency', signal) => request(`/cost-lens?lens=${encodeURIComponent(lens)}`, {}, signal),
  /** Reservation / Savings-Plan what-if simulator. */
  simulateCommitment: (model, signal) =>
    request('/commitments/simulate', { method: 'POST', body: JSON.stringify(model || {}) }, signal),
  /** Budget burndown / scenario for the current month (user-set target + growth). */
  budgetScenario: (model, signal) =>
    request('/budget-scenario', { method: 'POST', body: JSON.stringify(model || {}) }, signal),
}

export const TIME_RANGE_OPTIONS = [
  { value: 'last_7d',    label: 'Last 7 days' },
  { value: 'last_14d',   label: 'Last 14 days' },
  { value: 'last_30d',   label: 'Last 30 days' },
  { value: 'last_60d',   label: 'Last 60 days' },
  { value: 'last_90d',   label: 'Last 90 days' },
  { value: 'mtd',        label: 'Month to date' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_3mo',   label: 'Last 3 months' },
  { value: 'last_6mo',   label: 'Last 6 months' },
  { value: 'last_12mo',  label: 'Last 12 months' },
  { value: 'ytd',        label: 'Year to date' },
  { value: 'custom',     label: '📅 Custom range…' },
]

export const DIMENSION_OPTIONS = [
  { value: 'SubscriptionId',    label: 'Subscription' },
  { value: 'ResourceGroupName', label: 'Resource Group' },
  { value: 'ResourceType',      label: 'Resource Type' },
  { value: 'ServiceFamily',     label: 'Service Family' },
  { value: 'ServiceName',       label: 'Service Name' },
  { value: 'MeterCategory',     label: 'Meter Category' },
  { value: 'ResourceLocation',  label: 'Region' },
  { value: 'TagKey:CostCenter', label: 'Tag: CostCenter' },
  { value: 'TagKey:Environment','label': 'Tag: Environment' },
  { value: 'TagKey:Application', label: 'Tag: Application' },
  { value: 'TagKey:Department',  label: 'Tag: Department' },
  { value: 'TagKey:Owner',       label: 'Tag: Owner' },
]

/** Format a USD number into a human-readable string */
export function fmtUsd(v, decimals = 0) {
  if (v == null || isNaN(v)) return '$0'
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** Format a percentage */
export function fmtPct(v, decimals = 1) {
  if (v == null || isNaN(v)) return '0%'
  return Number(v).toFixed(decimals) + '%'
}

/** Status color for budget utilization */
export function budgetStatusColor(status) {
  if (status === 'exceeded')  return '#ef4444'
  if (status === 'at_risk')   return '#f97316'
  return '#22c55e'
}

/** Trend arrow + color */
export function trendBadge(pct) {
  if (pct == null) return { arrow: '→', color: 'var(--c-64748b)' }
  if (pct >  5)   return { arrow: '↑', color: '#ef4444' }
  if (pct < -5)   return { arrow: '↓', color: '#22c55e' }
  return { arrow: '→', color: 'var(--c-64748b)' }
}

/** Chart color palette */
export const CHART_COLORS = [
  '#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b',
  '#ec4899','#14b8a6','#f97316','#6366f1','#84cc16',
  '#e11d48','#0ea5e9','#a855f7','#22c55e','#fb923c',
]
