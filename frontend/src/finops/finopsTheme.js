/**
 * Shared FinOps theme constants.
 * Import from any FinOps component to stay visually consistent.
 */

// ─── Base palette ─────────────────────────────────────────────────────────────
export const FINOPS_COLORS = {
  bg:       'var(--c-0a0f1e)',
  surface:  'var(--c-111827)',
  surface2: 'var(--c-0d1424)',
  border:   'var(--c-1e293b)',
  accent:   '#3b82f6',
  accentDim:'rgba(59,130,246,0.15)',
  green:    '#22c55e',
  red:      '#ef4444',
  yellow:   '#f59e0b',
  orange:   '#f97316',
  purple:   '#8b5cf6',
  cyan:     '#06b6d4',
  muted:    'var(--c-64748b)',
  text:     'var(--c-e2e8f0)',
  textDim:  'var(--c-94a3b8)',
}

// Shorthand alias used in inline styles (mirrors the `C` object pattern already in components)
export const C = FINOPS_COLORS

// ─── Chart color series ───────────────────────────────────────────────────────
export const CHART_COLORS = [
  '#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b',
  '#ec4899','#14b8a6','#f97316','#6366f1','#84cc16',
  '#e11d48','#0ea5e9','#a855f7','#22c55e','#fb923c',
]

// ─── Recharts tooltip style ───────────────────────────────────────────────────
export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--c-1e293b)',
    border: '1px solid var(--c-334155)',
    borderRadius: 10,
    color: 'var(--c-e2e8f0)',
    fontSize: 13,
  },
  labelStyle: { color: 'var(--c-94a3b8)', marginBottom: 4 },
  itemStyle:  { color: 'var(--c-e2e8f0)' },
  cursor:     { fill: 'rgba(59,130,246,0.06)' },
}

// Convenience: destructure the CHART_TOOLTIP_STYLE for Recharts
export function rechartsTooltipProps() {
  return {
    contentStyle: CHART_TOOLTIP_STYLE.contentStyle,
    labelStyle:   CHART_TOOLTIP_STYLE.labelStyle,
    itemStyle:    CHART_TOOLTIP_STYLE.itemStyle,
    cursor:       CHART_TOOLTIP_STYLE.cursor,
  }
}

// ─── Time range options ───────────────────────────────────────────────────────
export const TIME_RANGE_OPTIONS = [
  { value: 'last_7_days',   label: 'Last 7 Days' },
  { value: 'last_30_days',  label: 'Last 30 Days' },
  { value: 'last_60_days',  label: 'Last 60 Days' },
  { value: 'last_90_days',  label: 'Last 90 Days' },
  { value: 'this_month',    label: 'This Month' },
  { value: 'last_month',    label: 'Last Month' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'last_year',     label: 'Last 12 Months' },
  { value: 'custom',        label: 'Custom Range' },
]

// ─── Granularity options ──────────────────────────────────────────────────────
export const GRANULARITY_OPTIONS = [
  { value: 'Daily',   label: 'Daily' },
  { value: 'Monthly', label: 'Monthly' },
  { value: 'None',    label: 'Total' },
]

// ─── Group-by dimension options ───────────────────────────────────────────────
export const DIMENSION_OPTIONS = [
  { value: 'SubscriptionId',    label: 'Subscription' },
  { value: 'ResourceGroupName', label: 'Resource Group' },
  { value: 'ResourceType',      label: 'Resource Type' },
  { value: 'ServiceFamily',     label: 'Service Family' },
  { value: 'ServiceName',       label: 'Service Name' },
  { value: 'MeterCategory',     label: 'Meter Category' },
  { value: 'ResourceLocation',  label: 'Region' },
  { value: 'TagKey:CostCenter', label: 'Tag: CostCenter' },
  { value: 'TagKey:Environment', label: 'Tag: Environment' },
  { value: 'TagKey:Application', label: 'Tag: Application' },
  { value: 'TagKey:Department',  label: 'Tag: Department' },
  { value: 'TagKey:Owner',       label: 'Tag: Owner' },
]

// ─── Currency formatters ──────────────────────────────────────────────────────
export function fmtUsd(v, decimals = 0) {
  if (v == null || isNaN(v)) return '$0'
  return '$' + Number(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtPct(v, decimals = 1) {
  if (v == null || isNaN(v)) return '0%'
  return Number(v).toFixed(decimals) + '%'
}

// ─── Status helpers ───────────────────────────────────────────────────────────
export function budgetStatusColor(status) {
  if (status === 'exceeded') return FINOPS_COLORS.red
  if (status === 'at_risk')  return FINOPS_COLORS.orange
  return FINOPS_COLORS.green
}

export function trendBadge(pct) {
  if (pct == null)  return { arrow: '→', color: FINOPS_COLORS.muted }
  if (pct >  5)     return { arrow: '↑', color: FINOPS_COLORS.red }
  if (pct < -5)     return { arrow: '↓', color: FINOPS_COLORS.green }
  return { arrow: '→', color: FINOPS_COLORS.muted }
}

// ─── Shared card style ────────────────────────────────────────────────────────
export const CARD_STYLE = {
  background:   FINOPS_COLORS.surface,
  border:       `1px solid ${FINOPS_COLORS.border}`,
  borderRadius: 12,
  padding:      '20px 18px',
}

// ─── Shared input style ───────────────────────────────────────────────────────
export const INPUT_STYLE = {
  background:  'var(--c-0d1424)',
  border:      `1px solid ${FINOPS_COLORS.border}`,
  color:       FINOPS_COLORS.text,
  borderRadius: 7,
  padding:     '7px 10px',
  fontSize:    13,
  outline:     'none',
  transition:  'border-color 0.15s',
}

export const INPUT_FOCUS_STYLE = {
  ...INPUT_STYLE,
  borderColor: FINOPS_COLORS.accent,
}
