/**
 * Design System Tokens — Azure Infra IQ
 * Enterprise design system — consistent spacing, colors, and component specs.
 */

// ─── Layout Constants ─────────────────────────────────────────────────────────
export const LAYOUT = {
  sidebarWidth:      240,
  sidebarCollapsed:  60,
  headerHeight:      52,
  filterBarHeight:   44,
};

// ─── Border Radius ────────────────────────────────────────────────────────────
export const RADIUS = {
  sm: 6,    // buttons, inputs, code snippets
  md: 8,    // sub-items, alerts, vault cards
  lg: 12,   // KPI tiles, section cards, inner panels
  xl: 16,   // outer panels, main containers
};

// ─── Background Colors (Enterprise dark palette) ──────────────────────────────
export const BG = {
  page:     'var(--c-080c14)',   // deepest page background
  sidebar:  'var(--c-0c1220)',   // sidebar — slightly lighter than page
  card:     'var(--c-111827)',   // primary card (gray-900)
  cardAlt:  'var(--c-0f172a)',   // nested/alternative surface (slate-900)
  surface:  'var(--c-1a2332)',   // elevated surface (hover states)
  header:   'var(--c-0c1220)',   // header bar — matches sidebar
  modal:    'var(--c-111827)',   // modal/drawer bg
};

// ─── Brand Colors ─────────────────────────────────────────────────────────────
export const BRAND = {
  azure:      '#0078d4',   // Azure brand blue
  azureLight: '#2b88d8',   // Azure hover
  azureDark:  '#005a9e',   // Azure pressed
  accent:     '#00b7c3',   // Teal accent
  accentAlt:  '#6366f1',   // Indigo accent
  gold:       '#f59e0b',   // Amber for highlights
};

// ─── Border Colors ────────────────────────────────────────────────────────────
export const BORDER = {
  default:  'var(--c-1e293b)',   // standard border (slate-800)
  subtle:   '#1e293b80', // 50% opacity variant
  strong:   'var(--c-334155)',   // emphasized border (slate-700)
  accent:   (color) => `${color}40`, // 25% opacity accent
};

// ─── Text Colors ──────────────────────────────────────────────────────────────
export const TEXT = {
  primary:   'var(--c-f1f5f9)',  // headings, primary text (slate-100)
  secondary: 'var(--c-94a3b8)',  // body text, descriptions (slate-400)
  muted:     'var(--c-64748b)',  // secondary labels (slate-500)
  dim:       'var(--c-475569)',  // tertiary, taglines (slate-600)
  disabled:  'var(--c-334155)',  // disabled state (slate-700)
};

// ─── Status / Severity Colors ─────────────────────────────────────────────────
export const STATUS = {
  critical:  '#ef4444',
  high:      '#f97316',
  medium:    '#eab308',
  low:       '#22c55e',
  info:      '#3b82f6',
  purple:    '#a855f7',
};

// ─── KPI Tile Spec ────────────────────────────────────────────────────────────
export const KPI = {
  radius:           RADIUS.lg,
  padding:          '16px 18px',
  valueSize:        26,
  labelSize:        11,
  accentBorderWidth: 3,
  gap:              14,
  gridMin:          160,
};

// ─── Button Styles ────────────────────────────────────────────────────────────
export const BUTTON = {
  primaryBg:      '#0078d4',  // Azure blue
  primaryHover:   '#2b88d8',  // Azure lighter
  ghostBg:       'var(--c-1e293b)',  // slate-800
  ghostHover:    'var(--c-334155)',  // slate-700
};
