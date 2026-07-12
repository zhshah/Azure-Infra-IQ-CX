/**
 * FinOps Report — consultant-grade, board-ready PDF (dark navy, matches the BIA / BCDR
 * consultant exports). Rendered from the structured report produced by backend
 * services/finops_report_service.generate_finops_report, which grounds every figure in
 * Azure Cost Management (the cost warehouse) and layers an AI narrative on top.
 *
 * One generator renders all report types (Executive Cost Summary, Optimization & Savings,
 * Allocation / Showback, Commitment Coverage, Budget & Forecast, Anomaly) by rendering the
 * blocks present in report.sections plus the always-on executive summary + recommendations.
 *
 * Lazy-loaded so the heavy PDF engine stays out of the main bundle (dynamic import only).
 */
import React from 'react'
import { pdf, Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer'
import { BrandMark } from './pdfBrand'

Font.registerHyphenationCallback((word) => {
  if (typeof word !== 'string' || word.length <= 14) return [word]
  const parts = []
  for (let i = 0; i < word.length; i += 9) parts.push(word.slice(i, i + 9))
  return parts
})

const C = {
  bg: '#0f172a', bgCard: '#1e293b', bgLight: '#334155',
  ink: '#f8fafc', body: '#cbd5e1', muted: '#94a3b8', faint: '#64748b',
  blue: '#3b82f6', blueSoft: '#60a5fa', blueDk: '#93c5fd',
  accent: '#3b82f6',
  line: '#334155', panel: '#1e293b', headBg: '#334155', white: '#ffffff',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', orange: '#fb923c', purple: '#a855f7',
}

function pdfSafe(str) {
  if (typeof str !== 'string') return str
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/[\u2192\u21D2\u27A1\u2794\u279C\u279E]/g, '->')
    .replace(/[\u2190\u21D0]/g, '<-')
    .replace(/[\u2194\u21D4]/g, '<->')
    .replace(/[\u2191\u2193\u2195\u2502]/g, '|')
    .replace(/[\u2022\u25CF\u25AA\u25E6\u2023\u2043\u00B7]/g, '-')
    .replace(/[\u2713\u2714]/g, 'Y')
    .replace(/[\u2717\u2718\u2715\u2716\u2573]/g, 'X')
    .replace(/\u2026/g, '...')
    .replace(/\u2212/g, '-')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '')
}

export function sanitizeDeep(v) {
  if (typeof v === 'string') return pdfSafe(v)
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (Array.isArray(v)) return v.map(sanitizeDeep)
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v)) o[k] = sanitizeDeep(v[k])
    return o
  }
  return v
}

const asText = (v) => {
  if (v == null) return ''
  if (typeof v === 'string') return pdfSafe(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ')
  if (typeof v === 'object') return pdfSafe(v.title || v.name || v.text || JSON.stringify(v))
  return pdfSafe(String(v))
}
const A = (v) => (Array.isArray(v) ? v : [])
const money = (v) => {
  const n = Number(v)
  if (v == null || !isFinite(n)) return '-'
  if (Math.abs(n) >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + n.toFixed(2)
}
const pctTxt = (v) => (v == null || !isFinite(Number(v)) ? '-' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`)
const deltaColor = (v) => (v == null ? C.muted : Number(v) > 0 ? C.red : Number(v) < 0 ? C.green : C.muted)
const prioColor = (p) => ({ high: C.red, medium: C.amber, low: C.green }[String(p || '').toLowerCase()] || C.muted)

const s = StyleSheet.create({
  page: { backgroundColor: C.bg, color: C.body, fontFamily: 'Helvetica', fontSize: 9.5, paddingTop: 54, paddingBottom: 48, paddingHorizontal: 46, lineHeight: 1.5 },
  cover: { backgroundColor: C.bg, paddingTop: 70, paddingBottom: 48, paddingHorizontal: 54, flex: 1, justifyContent: 'space-between' },
  cTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cBrand: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.ink },
  cTagline: { fontSize: 8, color: C.faint },
  cBar: { height: 4, backgroundColor: C.blue, width: 90, marginTop: 26, marginBottom: 18 },
  cEyebrow: { fontSize: 10, color: C.blue, fontFamily: 'Helvetica-Bold', letterSpacing: 2, textTransform: 'uppercase' },
  cTitle: { fontSize: 30, fontFamily: 'Helvetica-Bold', color: C.ink, marginTop: 10, lineHeight: 1.15 },
  cSub: { fontSize: 12, color: C.muted, marginTop: 10 },
  cMeta: { marginTop: 28, backgroundColor: C.bgCard, borderRadius: 8, padding: 18, borderLeft: `3px solid ${C.accent}` },
  cRow: { flexDirection: 'row', paddingVertical: 4, alignItems: 'flex-start' },
  cKey: { width: 140, fontSize: 10, color: C.faint },
  cVal: { flex: 1, fontSize: 10, color: C.ink, fontFamily: 'Helvetica-Bold' },
  confidential: { fontSize: 8, color: C.red, fontFamily: 'Helvetica-Bold' },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.white, marginBottom: 5 },
  h1bar: { height: 2, backgroundColor: C.accent, marginBottom: 12, marginTop: 1 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.blueDk, marginTop: 12, marginBottom: 5 },
  p: { fontSize: 9.5, color: C.body, marginBottom: 6, lineHeight: 1.6 },
  bullet: { flexDirection: 'row', gap: 6, marginBottom: 3 },
  bDot: { fontSize: 9, color: C.blue },
  bTxt: { fontSize: 9.5, color: C.body, flex: 1, lineHeight: 1.55 },
  table: { marginTop: 4, marginBottom: 10 },
  tr: { flexDirection: 'row' },
  th: { backgroundColor: C.headBg, fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.ink, padding: 5, borderTop: `1px solid ${C.line}`, borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` },
  td: { fontSize: 8, color: C.body, padding: 5, borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  kpi: { width: '31.5%', backgroundColor: C.bgCard, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, borderTop: `3px solid ${C.blue}` },
  kpiV: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.ink },
  kpiL: { fontSize: 7.5, color: C.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiS: { fontSize: 7.5, color: C.faint, marginTop: 3 },
  callout: { backgroundColor: C.panel, borderRadius: 8, padding: 11, borderLeft: `3px solid ${C.blue}`, marginBottom: 10 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 6 },
  barLabel: { width: 130, fontSize: 8.5, color: C.body },
  barTrack: { flex: 1, height: 9, backgroundColor: '#0b1220', borderRadius: 2 },
  barFill: { height: 9, borderRadius: 2, backgroundColor: C.blue },
  barVal: { width: 62, fontSize: 8.5, color: C.ink, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 22, left: 46, right: 46, height: 18 },
  footerInner: { flexDirection: 'row', justifyContent: 'space-between', borderTop: `1px solid ${C.line}`, paddingTop: 6 },
  fT: { fontSize: 7.5, color: C.faint },
  secHead: { position: 'absolute', top: 22, left: 46, right: 46, flexDirection: 'row', justifyContent: 'space-between' },
  secHeadT: { fontSize: 7.5, color: C.faint },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  metric: { width: '31.5%', backgroundColor: C.bgCard, borderRadius: 7, padding: 9, borderLeft: `3px solid ${C.blue}` },
  metricV: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.ink },
  metricL: { fontSize: 7.5, color: C.muted, marginTop: 2 },
})

function Footer({ customer, title }) {
  return (
    <View style={s.footer} fixed>
      <View style={s.footerInner}>
        <Text style={s.fT}>{asText(customer) || 'Customer'} — {asText(title)}</Text>
        <Text style={s.confidential}>CONFIDENTIAL</Text>
        <Text style={s.fT} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </View>
  )
}
const RunningHead = ({ label, title }) => (
  <View style={s.secHead} fixed><Text style={s.secHeadT}>{asText(label)}</Text><Text style={s.secHeadT}>{asText(title)}</Text></View>
)
const Bullets = ({ items }) => (
  <View>{A(items).map((x, i) => (<View key={i} style={s.bullet}><Text style={s.bDot}>-</Text><Text style={s.bTxt}>{asText(x)}</Text></View>))}</View>
)
const Para = ({ children }) => (children ? <Text style={s.p}>{asText(children)}</Text> : null)

function Table({ cols, rows }) {
  return (
    <View style={s.table}>
      <View style={s.tr} wrap={false}>
        {cols.map((c, i) => (<Text key={i} style={[s.th, { width: c.w, textAlign: c.align || 'left' }]}>{c.label}</Text>))}
      </View>
      {A(rows).map((r, ri) => (
        <View key={ri} style={s.tr} wrap={false}>
          {cols.map((c, ci) => {
            const raw = r[c.key]
            return (
              <Text key={ci} style={[s.td, { width: c.w, textAlign: c.align || 'left' },
                c.color ? { color: c.color(raw, r) } : {}, ri % 2 ? { backgroundColor: '#ffffff08' } : {}]}>
                {c.fmt ? c.fmt(raw, r) : asText(raw)}
              </Text>
            )
          })}
        </View>
      ))}
    </View>
  )
}

function Bars({ data, valueKey = 'cost', labelKey = 'name', color = C.blue, max }) {
  const rows = A(data).filter((d) => Number(d[valueKey]) > 0)
  const hi = max || Math.max(1, ...rows.map((d) => Number(d[valueKey]) || 0))
  return (
    <View style={{ marginBottom: 8 }}>
      {rows.map((d, i) => (
        <View key={i} style={s.barRow} wrap={false}>
          <Text style={s.barLabel}>{asText(d[labelKey])}</Text>
          <View style={s.barTrack}><View style={[s.barFill, { width: `${Math.max(2, (Number(d[valueKey]) / hi) * 100)}%`, backgroundColor: color }]} /></View>
          <Text style={s.barVal}>{money(d[valueKey])}</Text>
        </View>
      ))}
    </View>
  )
}

function Ring({ score, size = 86 }) {
  const sc = Number(score)
  const safe = Number.isFinite(sc) ? Math.max(0, Math.min(100, sc)) : null
  const col = safe == null ? C.muted : safe >= 70 ? C.green : safe >= 45 ? C.amber : C.red
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 6, borderColor: col, backgroundColor: C.bgCard, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 24, fontFamily: 'Helvetica-Bold', color: col, lineHeight: 1 }}>{safe == null ? '-' : Math.round(safe)}</Text>
      <Text style={{ fontSize: 7, color: C.muted, marginTop: 2 }}>/ 100</Text>
    </View>
  )
}

const Metric = ({ label, value, color = C.blue }) => (
  <View style={[s.metric, { borderLeftColor: color }]}><Text style={s.metricV}>{value}</Text><Text style={s.metricL}>{label}</Text></View>
)

// Small caveat shown under per-resource-derived blocks (savings / cost-at-risk) when the
// per-resource cost attribution covers only part of the authoritative estate total.
function CoverageNote({ report }) {
  const cov = report?.grounding?.coverage_pct
  if (cov == null || cov >= 80) return null
  return (
    <Text style={{ fontSize: 7.5, color: C.faint, marginTop: 2, marginBottom: 6 }}>
      Note: these figures are derived from per-resource cost attribution, which currently covers ~{cov}% of the
      authoritative estate total (the remainder is not yet attributable at resource level). Treat them as a lower bound.
    </Text>
  )
}

// ── Cover ──────────────────────────────────────────────────────────────────
function CoverPage({ report }) {
  const c = report.cover || {}
  const g = report.grounding || {}
  return (
    <Page size="A4" style={s.page}>
      <View style={s.cover}>
        <View>
          <View style={s.cTop}>
            <BrandMark size={44} />
            <View><Text style={s.cBrand}>Azure Infra IQ</Text><Text style={s.cTagline}>FinOps Advisory · AI-Powered</Text></View>
          </View>
          <View style={s.cBar} />
          <Text style={s.cEyebrow}>FinOps · Cost Intelligence</Text>
          <Text style={s.cTitle}>{asText(c.title) || 'FinOps Report'}</Text>
          <Text style={s.cSub}>{asText(c.subtitle)}</Text>
          <View style={s.cMeta}>
            {[['Customer', c.customer_name], ['Reporting Period', c.period_label], ['Prepared By', c.prepared_by],
              ['Report Version', c.report_version], ['Date', c.date],
              ['Data Source', g.data_source || 'Azure Cost Management']].map(([k, v], i) => (
              <View key={i} style={s.cRow}><Text style={s.cKey}>{k}</Text><Text style={s.cVal}>{asText(v) || '-'}</Text></View>
            ))}
          </View>
        </View>
        <View>
          <Text style={{ fontSize: 8, color: C.faint, marginBottom: 4 }}>
            All monetary figures are sourced directly from Azure Cost Management (cost warehouse). No figure is estimated or fabricated.
          </Text>
          <Text style={s.confidential}>CONFIDENTIAL — prepared for the named customer only.</Text>
        </View>
      </View>
    </Page>
  )
}

// ── Section blocks (rendered when data present) ──────────────────────────────
function SpendOverviewBlock({ report }) {
  const so = report.spend_overview || {}
  const n = report.section_narratives || {}
  if (!so.total_30d && !(so.by_service || []).length) return null
  return (
    <View>
      <Text style={s.h2}>Spend Overview</Text>
      <Para>{n.spend_overview}</Para>
      <View style={s.metricRow}>
        <Metric label="Estate spend (30d)" value={money(so.total_30d)} />
        <Metric label="Prior 30 days" value={money(so.prior_30d)} color={C.faint} />
        <Metric label={`Change MoM (${pctTxt(so.delta_pct)})`} value={money(so.delta_usd)} color={deltaColor(so.delta_usd)} />
        <Metric label="Forecast (run-rate)" value={money(so.forecast_eom)} color={C.amber} />
      </View>
      {A(so.by_service).length > 0 && (<>
        <Text style={s.h2}>Top Services by Spend (by service family)</Text>
        <Bars data={so.by_service} />
        <Table
          cols={[
            { key: 'name', label: 'Service family', w: '40%' },
            { key: 'cost', label: 'Cost (30d)', w: '20%', align: 'right', fmt: money },
            { key: 'prev', label: 'Previous 30d', w: '20%', align: 'right', fmt: money },
            { key: 'delta_usd', label: 'Change (MoM)', w: '20%', align: 'right', fmt: (v) => money(v), color: deltaColor },
          ]}
          rows={A(so.by_service).slice(0, 12)}
        />
        <Text style={{ fontSize: 7.5, color: C.faint, marginTop: 2, lineHeight: 1.5 }}>
          Cost (30d) = spend in the last 30 days.  Previous 30d = spend in the preceding 30-day period.
          Change (MoM) = month-over-month difference (red = spend increased, green = spend decreased). Figures reconcile to the estate total.
        </Text>
      </>)}
      {A(so.by_region).length > 0 && (<>
        <Text style={s.h2}>Spend by Region</Text>
        <Bars data={so.by_region} color={C.purple} />
      </>)}
      {A(so.by_resource_group).length > 0 && (<>
        <Text style={s.h2}>Top Resource Groups</Text>
        <Bars data={A(so.by_resource_group).slice(0, 10)} color={C.blueSoft} />
      </>)}
    </View>
  )
}

function SubscriptionsBlock({ report }) {
  const subs = A(report.subscriptions)
  const n = report.section_narratives || {}
  if (!subs.length) return null
  return (
    <View break>
      <Text style={s.h1}>Cost by Subscription</Text>
      <View style={s.h1bar} />
      <Para>{n.subscriptions}</Para>
      <Table
        cols={[
          { key: 'name', label: 'Subscription', w: '26%' },
          { key: 'management_group', label: 'Management group', w: '20%', fmt: (v) => asText(v) || '-' },
          { key: 'total', label: 'Spend (30d)', w: '16%', align: 'right', fmt: money },
          { key: 'delta_pct', label: 'MoM', w: '11%', align: 'right', fmt: pctTxt, color: (v) => deltaColor(v) },
          { key: 'share_pct', label: 'Share', w: '9%', align: 'right', fmt: (v) => (v == null ? '-' : `${v}%`) },
          { key: 'top_services', label: 'Top services', w: '18%', fmt: (v) => A(v).slice(0, 3).map((x) => x.name).join(', ') },
        ]}
        rows={subs}
      />
      <Text style={{ fontSize: 7.5, color: C.faint, marginTop: 2, lineHeight: 1.5 }}>
        Spend (30d) = the subscription's spend in the last 30 days.  MoM = change vs the preceding 30 days.
        Share = the subscription's share of total estate spend.  Management group = the group the subscription sits under.
      </Text>
      {subs.slice(0, 8).map((sub, i) => (
        A(sub.top_services).length > 0 ? (
          <View key={i} wrap={false} style={{ marginTop: 6 }}>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.ink, marginBottom: 3 }}>
              {asText(sub.name)}  ·  MG: {asText(sub.management_group) || '-'}  —  {money(sub.total)} ({sub.share_pct == null ? '' : `${sub.share_pct}% of estate`})
            </Text>
            <Bars data={sub.top_services} />
          </View>
        ) : null
      ))}
    </View>
  )
}

function MoversBlock({ report }) {
  const mv = report.movers || {}
  const n = report.section_narratives || {}
  const up = A(mv.up), down = A(mv.down)
  if (!up.length && !down.length) return null
  const fmtRows = (arr) => arr.map((x) => ({ name: x.name, cost: x.cost, delta_usd: x.delta_usd, delta_pct: x.delta_pct }))
  return (
    <View>
      <Text style={s.h2}>Month-over-Month Movers</Text>
      <Para>{n.movers}</Para>
      {up.length > 0 && (<>
        <Text style={{ fontSize: 9, color: C.red, fontFamily: 'Helvetica-Bold', marginBottom: 3 }}>Largest increases</Text>
        <Table cols={[
          { key: 'name', label: 'Service', w: '46%' },
          { key: 'cost', label: 'Cost', w: '18%', align: 'right', fmt: money },
          { key: 'delta_usd', label: 'Increase', w: '18%', align: 'right', fmt: money, color: () => C.red },
          { key: 'delta_pct', label: '%', w: '18%', align: 'right', fmt: pctTxt, color: () => C.red },
        ]} rows={fmtRows(up)} />
      </>)}
      {down.length > 0 && (<>
        <Text style={{ fontSize: 9, color: C.green, fontFamily: 'Helvetica-Bold', marginBottom: 3 }}>Largest decreases</Text>
        <Table cols={[
          { key: 'name', label: 'Service', w: '46%' },
          { key: 'cost', label: 'Cost', w: '18%', align: 'right', fmt: money },
          { key: 'delta_usd', label: 'Decrease', w: '18%', align: 'right', fmt: money, color: () => C.green },
          { key: 'delta_pct', label: '%', w: '18%', align: 'right', fmt: pctTxt, color: () => C.green },
        ]} rows={fmtRows(down)} />
      </>)}
    </View>
  )
}

function SavingsBlock({ report }) {
  const sv = report.savings || {}
  const n = report.section_narratives || {}
  const has = Object.values(sv).some((v) => Number(v) > 0)
  if (!has) return null
  const topRes = A(sv.top_resources)
  return (
    <View>
      <Text style={s.h2}>Savings Opportunities</Text>
      <Para>{n.savings}</Para>
      <View style={s.metricRow}>
        <Metric label="Monthly run-rate" value={money(sv.monthly_run_rate)} color={C.green} />
        <Metric label="Annualised potential" value={money(sv.annualized_potential)} color={C.green} />
        <Metric label="Waste (idle/over)" value={money(sv.waste_usd)} color={C.amber} />
        <Metric label="Rightsize (monthly)" value={money(sv.rightsize_monthly)} color={C.blue} />
        <Metric label={`Orphaned (${sv.orphaned_count || 0})`} value={money(sv.orphaned_monthly)} color={C.orange} />
        <Metric label="Modernization (monthly)" value={money(sv.modernization_monthly)} color={C.purple} />
      </View>
      <Text style={{ fontSize: 8, color: C.muted, marginBottom: 4 }}>
        Scope: identified across all in-scope subscriptions. Advisor, rightsize and orphaned figures are estate-level
        rollups; modernization and the resources below are attributed per resource (subscription and resource group named).
      </Text>
      {topRes.length > 0 && (<>
        <Text style={s.h2}>Resources with the largest savings opportunity</Text>
        <Table cols={[
          { key: 'name', label: 'Resource', w: '24%' },
          { key: 'type', label: 'Type', w: '18%' },
          { key: 'resource_group', label: 'Resource group', w: '20%' },
          { key: 'subscription', label: 'Subscription', w: '16%' },
          { key: 'monthly', label: 'Save/mo', w: '10%', align: 'right', fmt: money, color: () => C.green },
          { key: 'action', label: 'Action', w: '12%' },
        ]} rows={topRes} />
      </>)}
      <CoverageNote report={report} />
    </View>
  )
}

function CostAtRiskBlock({ report }) {
  const car = report.cost_at_risk || {}
  const n = report.section_narratives || {}
  const bySub = A(car.by_subscription)
  const topRes = A(car.top_resources)
  const has = Number(car.unprotected_usd) > 0 || Number(car.non_zone_redundant_usd) > 0 ||
    Number(car.untagged_usd) > 0 || Number(car.idle_orphaned_usd) > 0
  if (!has) return null
  return (
    <View>
      <Text style={s.h2}>Cost at Risk</Text>
      <Para>{n.cost_at_risk}</Para>
      <View style={s.metricRow}>
        <Metric label="Unprotected (no backup)" value={money(car.unprotected_usd)} color={C.red} />
        <Metric label="Not zone-redundant" value={money(car.non_zone_redundant_usd)} color={C.amber} />
        <Metric label="Untagged (unallocated)" value={money(car.untagged_usd)} color={C.purple} />
        <Metric label="Idle / orphaned" value={money(car.idle_orphaned_usd)} color={C.faint} />
      </View>
      <Text style={{ fontSize: 8, color: C.muted, marginBottom: 4 }}>
        Scope: evaluated {car.resources_evaluated || 0} resources across all in-scope subscriptions. The tables below
        show which subscriptions and resources carry the exposure.
      </Text>
      {bySub.length > 0 && (<>
        <Text style={s.h2}>Cost at risk by subscription</Text>
        <Table cols={[
          { key: 'subscription', label: 'Subscription', w: '24%' },
          { key: 'management_group', label: 'Management group', w: '20%', fmt: (v) => asText(v) || '-' },
          { key: 'unprotected_usd', label: 'Unprotected', w: '15%', align: 'right', fmt: money, color: () => C.red },
          { key: 'non_zone_redundant_usd', label: 'Not zone-red.', w: '15%', align: 'right', fmt: money, color: () => C.amber },
          { key: 'untagged_usd', label: 'Untagged', w: '13%', align: 'right', fmt: money, color: () => C.purple },
          { key: 'idle_orphaned_usd', label: 'Idle', w: '13%', align: 'right', fmt: money },
        ]} rows={bySub} />
      </>)}
      {topRes.length > 0 && (<>
        <Text style={s.h2}>Resources driving the risk</Text>
        <Table cols={[
          { key: 'name', label: 'Resource', w: '22%' },
          { key: 'type', label: 'Type', w: '16%' },
          { key: 'resource_group', label: 'Resource group', w: '18%' },
          { key: 'subscription', label: 'Subscription', w: '15%' },
          { key: 'cost', label: 'Cost', w: '10%', align: 'right', fmt: money },
          { key: 'reason', label: 'Why at risk', w: '19%' },
        ]} rows={topRes} />
      </>)}
      <CoverageNote report={report} />
    </View>
  )
}

function AllocationBlock({ report }) {
  const al = report.allocation || {}
  const n = report.section_narratives || {}
  if (!A(al.by_subscription).length && !A(al.by_resource_group).length) return null
  return (
    <View break>
      <Text style={s.h1}>Cost Allocation & Showback</Text>
      <View style={s.h1bar} />
      <Para>{n.allocation}</Para>
      <View style={s.callout}>
        <Text style={{ fontSize: 9.5, color: C.blueDk, fontFamily: 'Helvetica-Bold' }}>Unallocated (untagged) spend: {money(al.untagged_usd)}</Text>
        <Text style={{ fontSize: 8.5, color: C.body, marginTop: 2 }}>Spend on resources without required tags cannot be charged back to a cost centre. Tag these first to close the allocation gap.</Text>
      </View>
      {A(al.by_subscription).length > 0 && (<>
        <Text style={s.h2}>By Subscription</Text>
        <Bars data={al.by_subscription} />
      </>)}
      {A(al.by_resource_group).length > 0 && (<>
        <Text style={s.h2}>By Resource Group</Text>
        <Bars data={A(al.by_resource_group).slice(0, 12)} color={C.blueSoft} />
      </>)}
      {A(al.by_service).length > 0 && (<>
        <Text style={s.h2}>By Service</Text>
        <Bars data={A(al.by_service).slice(0, 12)} color={C.purple} />
      </>)}
    </View>
  )
}

function CommitmentsBlock({ report }) {
  const co = report.commitments || {}
  const n = report.section_narratives || {}
  if (!co && !n.commitments) return null
  return (
    <View>
      <Text style={s.h2}>Commitment & Reservation Coverage</Text>
      <Para>{n.commitments}</Para>
      <View style={s.metricRow}>
        <Metric label="RI coverage" value={`${co.coveragePct || 0}%`} color={(co.coveragePct || 0) < 60 ? C.amber : C.green} />
        <Metric label="Utilisation" value={`${co.utilizationPct || 0}%`} color={(co.utilizationPct || 0) < 70 ? C.amber : C.green} />
        <Metric label="Active commitments" value={String(co.count || 0)} color={C.blue} />
        <Metric label="Savings (monthly)" value={money(co.savingsMonthly)} color={C.green} />
        <Metric label="Savings plans (monthly)" value={money(co.savingsPlansMonthly)} color={C.green} />
        <Metric label="Expiring (30d)" value={String(co.expiring30d || 0)} color={(co.expiring30d || 0) > 0 ? C.red : C.faint} />
      </View>
    </View>
  )
}

function BudgetsBlock({ report }) {
  const bu = report.budgets || {}
  const so = report.spend_overview || {}
  const n = report.section_narratives || {}
  return (
    <View>
      <Text style={s.h2}>Budgets & Forecast</Text>
      <Para>{n.budgets}</Para>
      <View style={s.metricRow}>
        <Metric label="Budgets defined" value={String(bu.count || 0)} color={C.blue} />
        <Metric label="Breaching / at risk" value={String(A(bu.breaching).length)} color={A(bu.breaching).length ? C.red : C.green} />
        <Metric label="Budget utilisation" value={`${bu.utilizationPct || 0}%`} color={(bu.utilizationPct || 0) >= 80 ? C.red : C.green} />
        <Metric label="Forecast (run-rate)" value={money(so.forecast_eom)} color={C.amber} />
      </View>
      {A(bu.breaching).length > 0 && (
        <Table cols={[
          { key: 'name', label: 'Budget', w: '54%' },
          { key: 'utilizationPct', label: 'Utilisation', w: '23%', align: 'right', fmt: (v) => `${v}%` },
          { key: 'status', label: 'Status', w: '23%', color: () => C.red },
        ]} rows={bu.breaching} />
      )}
    </View>
  )
}

function AnomaliesBlock({ report }) {
  const an = report.anomalies || {}
  const n = report.section_narratives || {}
  return (
    <View>
      <Text style={s.h2}>Cost Anomalies</Text>
      <Para>{n.anomalies}</Para>
      <View style={s.callout}>
        <Text style={{ fontSize: 10, color: an.openCount ? C.amber : C.green, fontFamily: 'Helvetica-Bold' }}>
          {an.openCount ? `${an.openCount} open cost anomaly signal(s) detected` : 'No open cost anomalies detected'}
        </Text>
      </View>
    </View>
  )
}

const BLOCK = {
  spend_overview: SpendOverviewBlock,
  subscriptions: SubscriptionsBlock,
  movers: MoversBlock,
  savings: SavingsBlock,
  cost_at_risk: CostAtRiskBlock,
  allocation: AllocationBlock,
  commitments: CommitmentsBlock,
  budgets: BudgetsBlock,
  anomalies: AnomaliesBlock,
}

const ratingColor = (r) => ({ strong: C.green, adequate: C.amber, weak: C.red }[String(r || '').toLowerCase()] || C.muted)

function ScorecardBlock({ report }) {
  const rows = A(report.scorecard)
  if (!rows.length) return null
  return (
    <View>
      <Text style={s.h1}>Executive Scorecard</Text>
      <View style={s.h1bar} />
      <Text style={{ fontSize: 8.5, color: C.muted, marginBottom: 6 }}>
        A qualitative read of the estate&apos;s FinOps posture across six dimensions, grounded in the figures in this report.
      </Text>
      {rows.map((r, i) => (
        <View key={i} wrap={false} style={{ flexDirection: 'row', marginBottom: 6, backgroundColor: C.bgCard, borderRadius: 6, padding: 9, borderLeft: `3px solid ${ratingColor(r.rating)}` }}>
          <View style={{ width: '30%' }}>
            <Text style={{ fontSize: 9.5, color: C.ink, fontFamily: 'Helvetica-Bold' }}>{asText(r.dimension)}</Text>
            <Text style={{ fontSize: 8, color: ratingColor(r.rating), fontFamily: 'Helvetica-Bold', marginTop: 2 }}>{asText(r.rating)}</Text>
          </View>
          <Text style={{ width: '70%', fontSize: 8.5, color: C.body, lineHeight: 1.5 }}>{asText(r.commentary)}</Text>
        </View>
      ))}
    </View>
  )
}

const NarrativeSection = ({ title, text }) => (text ? (
  <View wrap={false} style={{ marginTop: 8 }}>
    <Text style={s.h2}>{title}</Text>
    <Text style={s.p}>{asText(text)}</Text>
  </View>
) : null)

function RoadmapBlock({ report }) {
  const rm = A(report.roadmap)
  if (!rm.length) return null
  return (
    <View>
      <Text style={s.h1}>90-Day Action Roadmap</Text>
      <View style={s.h1bar} />
      {rm.map((h, i) => (
        <View key={i} wrap={false} style={{ marginBottom: 8, backgroundColor: C.bgCard, borderRadius: 6, padding: 10, borderLeft: `3px solid ${C.blue}` }}>
          <Text style={{ fontSize: 10, color: C.blueDk, fontFamily: 'Helvetica-Bold', marginBottom: 3 }}>{asText(h.horizon)}</Text>
          <Bullets items={h.actions} />
        </View>
      ))}
    </View>
  )
}

function ReportDoc({ report }) {
  const c = report.cover || {}
  const es = report.executive_summary || {}
  const label = report.report_type_label || 'FinOps Report'
  const order = A(report.sections).length ? report.sections : ['spend_overview', 'subscriptions', 'savings']
  const seen = new Set()
  const blocks = order.filter((k) => BLOCK[k] && !seen.has(k) && seen.add(k))

  return (
    <Document>
      <CoverPage report={report} />

      {/* Executive summary */}
      <Page size="A4" style={s.page} wrap>
        <RunningHead label={label} title="Executive Summary" />
        <Text style={s.h1}>Executive Summary</Text>
        <View style={s.h1bar} />
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 8 }}>
          {report.efficiency_score != null && (
            <View style={{ alignItems: 'center' }}>
              <Ring score={report.efficiency_score} />
              <Text style={{ fontSize: 7, color: C.muted, marginTop: 3 }}>Efficiency score</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            {es.headline ? <Text style={{ fontSize: 12, color: C.ink, fontFamily: 'Helvetica-Bold', lineHeight: 1.45 }}>{asText(es.headline)}</Text> : null}
          </View>
        </View>

        <View style={s.kpis}>
          {A(report.kpis).map((k, i) => (
            <View key={i} style={s.kpi}>
              <Text style={s.kpiV}>{asText(k.value)}</Text>
              <Text style={s.kpiL}>{asText(k.label)}</Text>
              {k.sub ? <Text style={s.kpiS}>{asText(k.sub)}</Text> : null}
            </View>
          ))}
        </View>

        <Para>{es.narrative}</Para>
        {A(es.key_findings).length > 0 && (<>
          <Text style={s.h2}>Key Findings</Text>
          <Bullets items={es.key_findings} />
        </>)}
        <Footer customer={c.customer_name} title={label} />
      </Page>

      {/* Executive scorecard + outlook */}
      {(A(report.scorecard).length > 0 || (report.section_narratives &&
        (report.section_narratives.cost_drivers || report.section_narratives.financial_outlook ||
         report.section_narratives.finops_maturity || report.section_narratives.governance))) && (
        <Page size="A4" style={s.page} wrap>
          <RunningHead label={label} title="Scorecard & Outlook" />
          <ScorecardBlock report={report} />
          <NarrativeSection title="Cost Drivers" text={report.section_narratives?.cost_drivers} />
          <NarrativeSection title="Financial Outlook" text={report.section_narratives?.financial_outlook} />
          <NarrativeSection title="FinOps Maturity" text={report.section_narratives?.finops_maturity} />
          <NarrativeSection title="Governance & Allocation" text={report.section_narratives?.governance} />
          <Footer customer={c.customer_name} title={label} />
        </Page>
      )}

      {/* Data blocks */}
      <Page size="A4" style={s.page} wrap>
        <RunningHead label={label} title="Cost Analysis" />
        {blocks.map((k, i) => {
          const B = BLOCK[k]
          return <B key={k + i} report={report} />
        })}
        <Footer customer={c.customer_name} title={label} />
      </Page>

      {/* Recommendations + conclusion */}
      {(A(report.recommendations).length > 0 || A(report.roadmap).length > 0 || (report.conclusion && (report.conclusion.summary || A(report.conclusion.next_steps).length))) && (
        <Page size="A4" style={s.page} wrap>
          <RunningHead label={label} title="Recommendations" />
          <RoadmapBlock report={report} />
          {A(report.recommendations).length > 0 && (<>
            <Text style={s.h1}>Recommendations</Text>
            <View style={s.h1bar} />
            {A(report.recommendations).map((rec, i) => (
              <View key={i} wrap={false} style={{ marginBottom: 8, backgroundColor: C.bgCard, borderRadius: 7, padding: 10, borderLeft: `3px solid ${prioColor(rec.priority)}` }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                  <Text style={{ fontSize: 10, color: C.ink, fontFamily: 'Helvetica-Bold', flex: 1 }}>{asText(rec.title)}</Text>
                  <Text style={{ fontSize: 8, color: prioColor(rec.priority), fontFamily: 'Helvetica-Bold' }}>{asText(rec.priority)}</Text>
                </View>
                <Text style={{ fontSize: 9, color: C.body, lineHeight: 1.5 }}>{asText(rec.detail)}</Text>
                <View style={{ flexDirection: 'row', gap: 14, marginTop: 3 }}>
                  {rec.impact ? <Text style={{ fontSize: 8, color: C.green }}>Impact: {asText(rec.impact)}</Text> : null}
                  {rec.effort ? <Text style={{ fontSize: 8, color: C.muted }}>Effort: {asText(rec.effort)}</Text> : null}
                </View>
              </View>
            ))}
          </>)}
          {report.conclusion && (report.conclusion.summary || A(report.conclusion.next_steps).length > 0) && (<>
            <Text style={s.h2}>Conclusion</Text>
            <Para>{report.conclusion.summary}</Para>
            {A(report.conclusion.next_steps).length > 0 && (<>
              <Text style={{ fontSize: 9, color: C.blueDk, fontFamily: 'Helvetica-Bold', marginTop: 4, marginBottom: 3 }}>Next steps</Text>
              <Bullets items={report.conclusion.next_steps} />
            </>)}
          </>)}
          <View style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
            <Text style={{ fontSize: 7.5, color: C.faint }}>
              All figures are sourced from Azure Cost Management (cost warehouse) for the {asText(c.period_label)} window
              {report.grounding && report.grounding.data_through ? ` (data through ${asText(report.grounding.data_through).slice(0, 10)})` : ''}.
              {report.model ? ` Narrative generated by ${asText(report.model)}.` : ''}
            </Text>
          </View>
          <Footer customer={c.customer_name} title={label} />
        </Page>
      )}
    </Document>
  )
}

/** Build and download the FinOps report PDF. */
export async function generateFinOpsReportPDF(report) {
  const safe = sanitizeDeep(report || {})
  const blob = await pdf(<ReportDoc report={safe} />).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const cust = (safe.cover?.customer_name || 'Customer').replace(/[^a-z0-9]+/gi, '-')
  const rt = (safe.report_type || 'finops').replace(/[^a-z0-9]+/gi, '-')
  a.download = `${cust}-FinOps-${rt}-${new Date().toISOString().slice(0, 10)}.pdf`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 1500)
}
