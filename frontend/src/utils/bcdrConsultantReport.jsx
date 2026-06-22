/**
 * Azure Resource BCDR Planning & Assessment Report — consultant-grade, board-ready PDF.
 *
 * Light, professional document style (white pages, light table headers, blue accents) — the
 * deliverable a Microsoft Azure BCDR consultant hands a customer. Follows the agreed outline:
 * Cover → Executive Summary → Environment Overview → BC Requirements → Methodology →
 * Current-State Findings (executive dashboard) → Gap Analysis → Recommended Architecture →
 * Solution Options → Cost & Licensing → Roadmap → DR Testing → Risk Register → Conclusion →
 * Appendices (A inventory, C RTO/RPO matrix, D service-by-service recommendations).
 *
 * Rendered from the structured report produced by backend bcdr_report_service.generate_consultant_report,
 * which is grounded on the live Azure inventory + the customer's Phase-1 classification + an AI pass.
 * Lazy-loaded so the heavy PDF engine stays out of the main bundle.
 */
import React from 'react'
import { pdf, Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer'
import { BrandMark } from './pdfBrand'

// A long unbreakable token (resource id, SKU, email, ARM path) that is wider than its
// fixed-width table column has no wrap point, so react-pdf/PDFKit computes a coordinate
// far outside the page and throws "unsupported number: …e+21", crashing the whole PDF.
// Register break points inside long tokens so they always wrap instead of overflowing.
Font.registerHyphenationCallback((word) => {
  if (typeof word !== 'string' || word.length <= 14) return [word]
  const parts = []
  for (let i = 0; i < word.length; i += 9) parts.push(word.slice(i, i + 9))
  return parts
})

// ── Dark navy palette — matches the dashboard PDF export (ExportPDFButton) ─────
const C = {
  bg: '#0f172a', bgCard: '#1e293b', bgLight: '#334155',
  ink: '#f8fafc', body: '#cbd5e1', muted: '#94a3b8', faint: '#64748b',
  blue: '#3b82f6', blueSoft: '#60a5fa', blueDk: '#93c5fd',
  accent: '#3b82f6', accentDim: '#1d4ed8',
  line: '#334155', lineSoft: '#243044', headBg: '#334155', panel: '#1e293b',
  white: '#ffffff',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', orange: '#fb923c',
}
const sevColor = (s) => ({ critical: C.red, high: C.orange, medium: C.amber, low: C.green }[String(s || '').toLowerCase()] || C.muted)
const scoreColor = (n) => (n == null ? C.muted : n >= 70 ? C.green : n >= 45 ? C.amber : C.red)

const asText = (v) => {
  if (v == null) return ''
  if (typeof v === 'string') return pdfSafe(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ')
  if (typeof v === 'object') return pdfSafe(v.action || v.name || v.text || JSON.stringify(v))
  return pdfSafe(String(v))
}
const money = (v) => { const n = Number(v); return (v == null || !isFinite(n)) ? '-' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) }
const A = (v) => (Array.isArray(v) ? v : [])

// ── PDF-safe text ─────────────────────────────────────────────────────────────
// The standard Helvetica PDF font only measures WinAnsi/Latin-1 glyphs. AI-generated
// text often contains arrows, special spaces, or other characters outside that range,
// which make react-pdf/PDFKit's text measurement return NaN — that NaN propagates into
// a layout coordinate and PDFKit throws "unsupported number: …e+21", crashing the whole
// PDF. Map the common offenders to ASCII and strip anything else above Latin-1 so every
// string we render is measurable. `sanitizeDeep` cleans the entire report up-front.
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
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '')   // strip remaining control / >Latin-1 chars
}

// Deep-sanitize a value: PDF-safe every string, coerce non-finite numbers to 0.
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

const s = StyleSheet.create({
  page: { backgroundColor: C.bg, color: C.body, fontFamily: 'Helvetica', fontSize: 9.5, paddingTop: 54, paddingBottom: 48, paddingHorizontal: 46, lineHeight: 1.5 },
  // cover
  cover: { backgroundColor: C.bg, paddingTop: 70, paddingBottom: 48, paddingHorizontal: 54, flex: 1, justifyContent: 'space-between' },
  cTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cBrand: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.ink },
  cTagline: { fontSize: 8, color: C.faint },
  cBar: { height: 4, backgroundColor: C.blue, width: 90, marginTop: 26, marginBottom: 18 },
  cEyebrow: { fontSize: 10, color: C.blue, fontFamily: 'Helvetica-Bold', letterSpacing: 2, textTransform: 'uppercase' },
  cTitle: { fontSize: 30, fontFamily: 'Helvetica-Bold', color: C.ink, marginTop: 10, lineHeight: 1.15 },
  cSub: { fontSize: 12, color: C.muted, marginTop: 10 },
  cMeta: { marginTop: 28, backgroundColor: C.bgCard, borderRadius: 8, padding: 18, borderLeft: `3px solid ${C.accent}` },
  cRow: { flexDirection: 'row', paddingVertical: 4 },
  cKey: { width: 150, fontSize: 10, color: C.faint },
  cVal: { fontSize: 10, color: C.ink, fontFamily: 'Helvetica-Bold' },
  cFoot: { fontSize: 8, color: C.faint, borderTop: `1px solid ${C.line}`, paddingTop: 10 },
  confidential: { fontSize: 8, color: C.red, fontFamily: 'Helvetica-Bold' },
  // section
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.white, marginBottom: 5 },
  h1bar: { height: 2, backgroundColor: C.accent, marginBottom: 12, marginTop: 1 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.blueDk, marginTop: 12, marginBottom: 5 },
  p: { fontSize: 9.5, color: C.body, marginBottom: 6, lineHeight: 1.6 },
  bullet: { flexDirection: 'row', gap: 6, marginBottom: 3 },
  bDot: { fontSize: 9, color: C.blue },
  bTxt: { fontSize: 9.5, color: C.body, flex: 1, lineHeight: 1.55 },
  // tables (light, bordered, like the requested CSS)
  table: { marginTop: 4, marginBottom: 10 },
  tr: { flexDirection: 'row' },
  th: { backgroundColor: C.headBg, fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.ink, padding: 5, borderTop: `1px solid ${C.line}`, borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` },
  td: { fontSize: 8, color: C.body, padding: 5, borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` },
  // kpi
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  kpi: { width: '31.5%', backgroundColor: C.bgCard, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, borderTop: `3px solid ${C.blue}` },
  kpiV: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: C.ink },
  kpiL: { fontSize: 7.5, color: C.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  // option cards
  opt: { backgroundColor: C.bgCard, border: `1px solid ${C.line}`, borderRadius: 8, padding: 11, marginBottom: 8, borderLeft: `3px solid ${C.blue}` },
  optName: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.blueDk },
  // callout
  callout: { backgroundColor: C.panel, borderRadius: 8, padding: 11, borderLeft: `3px solid ${C.blue}`, marginBottom: 10 },
  pill: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.white, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  footer: { position: 'absolute', bottom: 22, left: 46, right: 46, height: 18 },
  footerInner: { flexDirection: 'row', justifyContent: 'space-between', borderTop: `1px solid ${C.line}`, paddingTop: 6 },
  fT: { fontSize: 7.5, color: C.faint },
  secHead: { position: 'absolute', top: 22, left: 46, right: 46, flexDirection: 'row', justifyContent: 'space-between' },
  secHeadT: { fontSize: 7.5, color: C.faint },
})

function Footer({ customer }) {
  return (
    <View style={s.footer} fixed>
      <View style={s.footerInner}>
        <Text style={s.fT}>{asText(customer) || 'Customer'} — Business Continuity &amp; Disaster Recovery Plan</Text>
        <Text style={s.confidential}>CONFIDENTIAL</Text>
        <Text style={s.fT} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </View>
  )
}
const RunningHead = ({ title }) => (
  <View style={s.secHead} fixed><Text style={s.secHeadT}>Business Continuity &amp; Disaster Recovery Plan</Text><Text style={s.secHeadT}>{title}</Text></View>
)

const Bullets = ({ items }) => (
  <View>{A(items).map((x, i) => (<View key={i} style={s.bullet}><Text style={s.bDot}>•</Text><Text style={s.bTxt}>{asText(x)}</Text></View>))}</View>
)

// Generic table from columns [{key,label,w,align}] + rows (objects)
function Table({ cols, rows, sev }) {
  return (
    <View style={s.table}>
      <View style={s.tr} wrap={false}>
        {cols.map((c, i) => (<Text key={i} style={[s.th, { width: c.w, textAlign: c.align || 'left' }]}>{c.label}</Text>))}
      </View>
      {A(rows).map((r, ri) => (
        <View key={ri} style={s.tr} wrap={false}>
          {cols.map((c, ci) => {
            const raw = r[c.key]
            const isSev = sev && c.key === sev
            return (
              <Text key={ci} style={[s.td, { width: c.w, textAlign: c.align || 'left' },
                isSev ? { color: C.white, backgroundColor: sevColor(raw), fontFamily: 'Helvetica-Bold' } : {},
                ri % 2 ? { backgroundColor: '#ffffff08' } : {}]}>
                {c.fmt ? c.fmt(raw, r) : asText(raw)}
              </Text>
            )
          })}
        </View>
      ))}
    </View>
  )
}

// Score badge — a simple bordered circle showing the overall posture score (0–100),
// coloured green/amber/red by band. Rendered once on the cover page.
function Ring({ score, size = 86 }) {
  const sc = Number(score)
  const safeScore = Number.isFinite(sc) ? Math.max(0, Math.min(100, sc)) : 0
  const col = scoreColor(safeScore)
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 6, borderColor: col, backgroundColor: C.bgCard, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 26, fontFamily: 'Helvetica-Bold', color: col, lineHeight: 1 }}>{Math.round(safeScore)}</Text>
      <Text style={{ fontSize: 7, color: C.muted, marginTop: 2 }}>/ 100</Text>
    </View>
  )
}

const SectionPage = ({ title, customer, children }) => (
  <Page size="A4" style={s.page} wrap>
    <RunningHead title={title} />
    {children}
    <Footer customer={customer} />
  </Page>
)

function CoverPage({ report }) {
  const c = report.cover || {}
  return (
    <Page size="A4" style={s.page}>
      <View style={s.cover}>
        <View>
          <View style={s.cTop}>
            <BrandMark size={44} />
            <View><Text style={s.cBrand}>Azure Infra IQ</Text><Text style={s.cTagline}>BCDR Advisory · AI-Powered</Text></View>
          </View>
          <View style={s.cBar} />
          <Text style={s.cEyebrow}>Azure Resilience Assessment &amp; Strategy</Text>
          <Text style={s.cTitle}>Business Continuity &amp;{'\n'}Disaster Recovery Plan</Text>
          <Text style={s.cSub}>Resiliency posture, business impact analysis, gap analysis, recommended architecture, deployment &amp; activation plan and implementation roadmap.</Text>
          <View style={s.cMeta}>
            {[['Customer', c.customer_name], ['Assessment Period', c.assessment_period], ['Prepared By', c.prepared_by],
              ['Report Version', c.report_version], ['Date', c.date]].map(([k, v], i) => (
              <View key={i} style={s.cRow}><Text style={s.cKey}>{k}</Text><Text style={s.cVal}>{asText(v) || '-'}</Text></View>
            ))}
          </View>
        </View>
        <View>
          <Text style={s.confidential}>MICROSOFT CONFIDENTIAL</Text>
          <Text style={s.cFoot}>Generated by Azure Infra IQ. Grounded on the customer's live Azure inventory and Phase-1 classification. Recommendations should be validated against current Azure service capabilities before implementation.</Text>
        </View>
      </View>
    </Page>
  )
}

function ExecSummaryPage({ report }) {
  const es = report.executive_summary || {}, m = report.metrics || {}
  const cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="1. Executive Summary" customer={cust}>
      <Text style={s.h1}>1. Executive Summary</Text><View style={s.h1bar} />
      <View style={{ flexDirection: 'row', gap: 14, marginBottom: 8 }}>
        <Ring score={report.overall_score} />
        <View style={{ flex: 1 }}>
          <Text style={[s.h2, { marginTop: 0 }]}>BCDR Maturity: {asText(report.score_label) || '-'} ({report.overall_score ?? '-'}/100)</Text>
          <Text style={s.p}>{asText(es.purpose)}</Text>
        </View>
      </View>
      <Text style={s.h2}>Business Drivers</Text><Bullets items={es.business_drivers} />
      <Text style={s.h2}>Scope</Text><Text style={s.p}>{asText(es.scope) || `${m.total_resources || 0} resources across ${m.subscription_count || 0} subscription(s) and ${m.region_count || 0} region(s).`}</Text>
      <Text style={s.h2}>Key Findings — Current Resiliency Posture</Text>
      <Text style={s.p}>{asText(es.current_posture)}</Text>
      <Bullets items={es.major_risks} />
      <Text style={s.h2}>Executive Recommendations (Top Actions)</Text>
      <Table cols={[{ key: 'n', label: '#', w: 22, align: 'center' }, { key: 'action', label: 'Recommended Action', w: 270 }, { key: 'business_outcome', label: 'Expected Business Outcome', w: 210 }]}
        rows={A(es.top_recommendations).map((r, i) => ({ n: i + 1, ...r }))} />
    </SectionPage>
  )
}

function EnvironmentPage({ report }) {
  const m = report.metrics || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="2. Customer Environment Overview" customer={cust}>
      <Text style={s.h1}>2. Customer Environment Overview</Text><View style={s.h1bar} />
      <Text style={s.h2}>Current State</Text>
      <View style={s.kpis}>
        <View style={s.kpi}><Text style={s.kpiV}>{m.subscription_count || 0}</Text><Text style={s.kpiL}>Subscriptions assessed</Text></View>
        <View style={s.kpi}><Text style={s.kpiV}>{m.region_count || 0}</Text><Text style={s.kpiL}>Azure regions in use</Text></View>
        <View style={s.kpi}><Text style={s.kpiV}>{m.total_resources || 0}</Text><Text style={s.kpiL}>Workloads analyzed</Text></View>
      </View>
      <Text style={s.p}>Regions in use: {A(m.regions).join(', ') || '-'}.  Categorized in Phase 1: {m.categorized || 0} of {m.total_resources || 0}.  Total monthly spend: {money(m.total_monthly_cost)}.</Text>
      <Text style={s.h2}>Workload Classification</Text>
      <Table cols={[{ key: 'tier', label: 'Tier', w: 150 }, { key: 'business_criticality', label: 'Business Criticality', w: 140 }, { key: 'count', label: 'Count', w: 40, align: 'center' }, { key: 'examples', label: 'Examples', w: 175, fmt: (v) => A(v).join(', ') }]}
        rows={report.workload_classification} />
      <Text style={[s.p, { fontSize: 8, color: C.faint }]}>Tiering aligns workloads by business importance and RTO/RPO requirements per Azure BCDR planning guidance.</Text>
    </SectionPage>
  )
}

function RequirementsPage({ report }) {
  const bc = report.bc_requirements || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="3. Business Continuity Requirements" customer={cust}>
      <Text style={s.h1}>3. Business Continuity Requirements</Text><View style={s.h1bar} />
      <Text style={s.h2}>Regulatory Requirements</Text><Bullets items={bc.regulatory} />
      <Text style={s.h2}>Data Residency Considerations</Text><Text style={s.p}>{asText(bc.data_residency) || '-'}</Text>
      <Text style={s.h2}>Operational Requirements</Text><Bullets items={bc.operational} />
      <Text style={s.h2}>Recovery Objectives (RTO / RPO)</Text>
      <Table cols={[{ key: 'workload', label: 'Workload', w: 150 }, { key: 'current_rto', label: 'Current RTO', w: 78 }, { key: 'target_rto', label: 'Target RTO', w: 78 }, { key: 'current_rpo', label: 'Current RPO', w: 78 }, { key: 'target_rpo', label: 'Target RPO', w: 78 }]}
        rows={report.recovery_objectives} />
    </SectionPage>
  )
}

function MethodologyPage({ report }) {
  const md = report.methodology || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="4. Assessment Methodology" customer={cust}>
      <Text style={s.h1}>4. Assessment Methodology</Text><View style={s.h1bar} />
      <Text style={s.h2}>Discovery Activities</Text><Bullets items={md.discovery_activities} />
      <Text style={s.h2}>Assessment Areas</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        {A(md.assessment_areas).map((a, i) => (
          <Text key={i} style={{ fontSize: 8.5, color: C.blueDk, backgroundColor: C.panel, border: `1px solid ${C.line}`, borderRadius: 3, paddingHorizontal: 7, paddingVertical: 3 }}>{asText(a)}</Text>
        ))}
      </View>
    </SectionPage>
  )
}

function CurrentStatePage({ report }) {
  const cs = report.current_state || {}, d = cs.executive_dashboard || {}, f = cs.findings || {}, cust = (report.cover || {}).customer_name
  const FindBlock = ({ t, items }) => (A(items).length ? (<View><Text style={s.h2}>{t}</Text><Bullets items={items} /></View>) : null)
  return (
    <SectionPage title="5. Current State Findings" customer={cust}>
      <Text style={s.h1}>5. Current State Findings</Text><View style={s.h1bar} />
      <Text style={s.h2}>Executive Dashboard</Text>
      <View style={s.kpis}>
        <View style={s.kpi}><Text style={s.kpiV}>{d.total_resources ?? 0}</Text><Text style={s.kpiL}>Total Azure Resources</Text></View>
        <View style={[s.kpi, { borderTopColor: C.green }]}><Text style={[s.kpiV, { color: C.green }]}>{d.zone_redundant ?? 0}</Text><Text style={s.kpiL}>Zone-Redundant</Text></View>
        <View style={[s.kpi, { borderTopColor: C.amber }]}><Text style={[s.kpiV, { color: C.amber }]}>{d.non_zonal ?? 0}</Text><Text style={s.kpiL}>Non-Zonal</Text></View>
        <View style={[s.kpi, { borderTopColor: C.orange }]}><Text style={[s.kpiV, { color: C.orange }]}>{d.locally_redundant ?? 0}</Text><Text style={s.kpiL}>Locally Redundant (LRS)</Text></View>
        <View style={[s.kpi, { borderTopColor: scoreColor(d.backup_coverage_pct) }]}><Text style={[s.kpiV, { color: scoreColor(d.backup_coverage_pct) }]}>{d.backup_coverage_pct ?? 0}%</Text><Text style={s.kpiL}>Backup Coverage</Text></View>
        <View style={[s.kpi, { borderTopColor: scoreColor(d.dr_coverage_pct) }]}><Text style={[s.kpiV, { color: scoreColor(d.dr_coverage_pct) }]}>{d.dr_coverage_pct ?? 0}%</Text><Text style={s.kpiL}>DR Coverage</Text></View>
      </View>
      <Text style={s.h2}>Resource Assessment by Service</Text>
      <FindBlock t="Compute" items={f.compute} />
      <FindBlock t="Data Services" items={f.data_services} />
      <FindBlock t="Storage" items={f.storage} />
      <FindBlock t="Networking" items={f.networking} />
      <FindBlock t="Identity & Security" items={f.identity_security} />
      <FindBlock t="Backup & Disaster Recovery" items={f.backup_dr} />
    </SectionPage>
  )
}

function GapPage({ report }) {
  const g = report.gap_analysis || {}, bi = g.business_impact || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="6. Gap Analysis" customer={cust}>
      <Text style={s.h1}>6. Gap Analysis</Text><View style={s.h1bar} />
      <Text style={s.h2}>Resiliency Gaps</Text>
      <Table sev="severity" cols={[{ key: 'area', label: 'Area', w: 80 }, { key: 'finding', label: 'Finding', w: 210 }, { key: 'risk', label: 'Risk', w: 140 }, { key: 'severity', label: 'Severity', w: 56, align: 'center' }]}
        rows={g.resiliency_gaps} />
      <Text style={s.h2}>Business Impact Analysis</Text>
      <Text style={s.p}><Text style={{ fontFamily: 'Helvetica-Bold' }}>Service outage impact: </Text>{asText(bi.service_outage_impact)}</Text>
      <Text style={s.p}><Text style={{ fontFamily: 'Helvetica-Bold' }}>Data loss exposure: </Text>{asText(bi.data_loss_exposure)}</Text>
      <Text style={s.p}><Text style={{ fontFamily: 'Helvetica-Bold' }}>Financial exposure: </Text>{asText(bi.financial_exposure) || 'Not supplied'}</Text>
      <Text style={s.p}><Text style={{ fontFamily: 'Helvetica-Bold' }}>Compliance risks: </Text>{asText(bi.compliance_risks)}</Text>
      {A(bi.most_exposed_workloads).length ? (<View><Text style={s.h2}>Most-Exposed Workloads</Text><Bullets items={bi.most_exposed_workloads} /></View>) : null}
    </SectionPage>
  )
}

function ArchitecturePage({ report }) {
  const ra = report.recommended_architecture || {}, cust = (report.cover || {}).customer_name
  const stepCols = [{ key: 'n', label: '#', w: 22, align: 'center' }, { key: 'step', label: 'Step', w: 180 }, { key: 'detail', label: 'Detail', w: 288 }]
  return (
    <SectionPage title="7. Recommended BCDR Architecture" customer={cust}>
      <Text style={s.h1}>7. Recommended BCDR Architecture</Text><View style={s.h1bar} />
      {ra.failover_model ? (
        <View style={s.callout}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Text style={[s.pill, { backgroundColor: C.accent }]}>{asText(ra.failover_model)}</Text>
            <Text style={[s.h2, { marginTop: 0, marginBottom: 0 }]}>Recommended Failover Model</Text>
          </View>
          <Text style={s.bTxt}>{asText(ra.failover_rationale)}</Text>
        </View>
      ) : null}
      <Text style={s.h2}>Recommended Target State</Text>
      <View style={s.callout}><Text style={s.bTxt}>{asText(ra.target_state) || '-'}</Text></View>
      <Text style={s.h2}>Recommended Protection Strategy</Text>
      <Table cols={[{ key: 'azure_service', label: 'Azure Service', w: 170 }, { key: 'recommendation', label: 'Recommended DR Mechanism', w: 320 }]}
        rows={ra.protection_strategy} />
      {A(ra.deployment_plan).length ? (<View><Text style={s.h2}>Deployment Plan — Building the Target State</Text>
        <Table cols={stepCols} rows={A(ra.deployment_plan).map((x, i) => ({ n: i + 1, ...x }))} /></View>) : null}
      {A(ra.activation_plan).length ? (<View><Text style={s.h2}>Activation &amp; Failover Plan</Text>
        <Table cols={stepCols} rows={A(ra.activation_plan).map((x, i) => ({ n: i + 1, ...x }))} /></View>) : null}
    </SectionPage>
  )
}

function OptionsPage({ report }) {
  const cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="8. Proposed BCDR Solution Options" customer={cust}>
      <Text style={s.h1}>8. Proposed BCDR Solution Options</Text><View style={s.h1bar} />
      {A(report.solution_options).map((o, i) => (
        <View key={i} style={s.opt} wrap={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <Text style={s.optName}>{asText(o.name)}</Text>
            <Text style={[s.pill, { backgroundColor: C.blue }]}>{asText(o.cost_level) || 'Cost'} cost</Text>
            {o.rto_rpo ? <Text style={{ fontSize: 8, color: C.muted }}>RTO/RPO: {asText(o.rto_rpo)}</Text> : null}
          </View>
          <Text style={s.p}>{asText(o.approach)}</Text>
          {o.best_for ? <Text style={[s.p, { fontSize: 8.5, color: C.muted }]}>Best for: {asText(o.best_for)}</Text> : null}
        </View>
      ))}
    </SectionPage>
  )
}

function CostPage({ report }) {
  const cl = report.cost_licensing || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="9. Cost & Licensing Estimate" customer={cust}>
      <Text style={s.h1}>9. Cost & Licensing Estimate</Text><View style={s.h1bar} />
      <Text style={s.h2}>Estimated Monthly Cost</Text>
      <Table cols={[{ key: 'component', label: 'Component', w: 220 }, { key: 'existing', label: 'Existing', w: 135, align: 'right' }, { key: 'additional', label: 'Additional', w: 135, align: 'right' }]}
        rows={cl.monthly_estimate} />
      <Text style={s.h2}>Licensing & Service Impact</Text><Bullets items={cl.licensing_impact} />
      {A(cl.assumptions).length ? (<View><Text style={s.h2}>Assumptions</Text><Bullets items={cl.assumptions} /></View>) : null}
    </SectionPage>
  )
}

function RoadmapPage({ report }) {
  const cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="10. Implementation Roadmap" customer={cust}>
      <Text style={s.h1}>10. Implementation Roadmap</Text><View style={s.h1bar} />
      {A(report.roadmap).map((ph, i) => (
        <View key={i} style={s.opt} wrap={false}>
          <Text style={s.optName}>{asText(ph.phase)}</Text>
          <Text style={[s.h2, { marginTop: 4, fontSize: 9 }]}>Activities</Text><Bullets items={ph.activities} />
          {A(ph.outcomes).length ? (<View><Text style={[s.h2, { marginTop: 4, fontSize: 9 }]}>Outcomes</Text><Bullets items={ph.outcomes} /></View>) : null}
        </View>
      ))}
    </SectionPage>
  )
}

function TestingRiskPage({ report }) {
  const dt = report.dr_testing || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="11–12. DR Testing & Risk Register" customer={cust}>
      <Text style={s.h1}>11. DR Testing & Operational Readiness</Text><View style={s.h1bar} />
      <Text style={s.h2}>DR Test Plan</Text><Bullets items={dt.test_plan} />
      {A(dt.failback).length ? (<View><Text style={s.h2}>Failback Procedure</Text><Bullets items={dt.failback} /></View>) : null}
      <Text style={s.h2}>Operational Runbooks</Text><Bullets items={dt.runbooks} />
      {A(dt.validation_checklist).length ? (<View><Text style={s.h2}>Validation Checklist</Text><Bullets items={dt.validation_checklist} /></View>) : null}
      <Text style={[s.h1, { marginTop: 16 }]}>12. Risk Register</Text><View style={s.h1bar} />
      <Table cols={[{ key: 'risk', label: 'Risk', w: 200 }, { key: 'probability', label: 'Probability', w: 70, align: 'center' }, { key: 'impact', label: 'Impact', w: 60, align: 'center' }, { key: 'mitigation', label: 'Mitigation', w: 160 }]}
        rows={report.risk_register} />
    </SectionPage>
  )
}

function ConclusionPage({ report }) {
  const cc = report.conclusion || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="13. Conclusion & Next Steps" customer={cust}>
      <Text style={s.h1}>13. Conclusion & Next Steps</Text><View style={s.h1bar} />
      <Text style={s.h2}>Recommended Immediate Actions</Text><Bullets items={cc.immediate_actions} />
      <Text style={s.h2}>Medium-Priority Initiatives</Text><Bullets items={cc.medium_priority} />
      <Text style={s.h2}>Long-Term Resiliency Improvements</Text><Bullets items={cc.long_term} />
      <Text style={s.h2}>Expected Outcomes</Text><Bullets items={cc.expected_outcomes} />
    </SectionPage>
  )
}

function AppendixPage({ report }) {
  const ap = report.appendices || {}, cust = (report.cover || {}).customer_name
  const inv = A(ap.inventory)
  return (
    <Page size="A4" orientation="landscape" style={[s.page, { paddingHorizontal: 36 }]} wrap>
      <RunningHead title="Appendix A — Resource Inventory" />
      <Text style={s.h1}>Appendix A — Azure Resource Inventory</Text><View style={s.h1bar} />
      <Table cols={[
        { key: 'resource_name', label: 'Resource', w: 120 }, { key: 'resource_type', label: 'Type', w: 80 },
        { key: 'location', label: 'Region', w: 56 }, { key: 'sku', label: 'SKU', w: 70 },
        { key: 'zone_status', label: 'Zone Status', w: 64 }, { key: 'has_backup', label: 'Backup', w: 36, align: 'center', fmt: (v) => (v ? 'Yes' : 'No') },
        { key: 'cost_current_month', label: 'Cost/mo', w: 48, align: 'right', fmt: money },
        { key: 'criticality', label: 'Criticality', w: 54 }, { key: 'dr_tier', label: 'DR Tier', w: 44 },
        { key: 'target_rto', label: 'Tgt RTO', w: 48 }, { key: 'target_region', label: 'Tgt Region', w: 58 },
        { key: 'business_owner', label: 'Owner', w: 70 },
      ]} rows={inv.slice(0, 220)} />
      <Text style={[s.p, { fontSize: 8, color: C.faint }]}>{inv.length} resources in scope. Appendix C (RTO/RPO matrix) and Appendix D (service-by-service recommendations) follow.</Text>
      <Footer customer={cust} />
    </Page>
  )
}

function ServiceRecPage({ report }) {
  const ap = report.appendices || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="Appendix D — Service Recommendations" customer={cust}>
      <Text style={s.h1}>Appendix C — RTO / RPO Matrix</Text><View style={s.h1bar} />
      <Table cols={[{ key: 'workload', label: 'Workload', w: 150 }, { key: 'current_rto', label: 'Cur RTO', w: 70 }, { key: 'target_rto', label: 'Tgt RTO', w: 70 }, { key: 'current_rpo', label: 'Cur RPO', w: 70 }, { key: 'target_rpo', label: 'Tgt RPO', w: 70 }]}
        rows={ap.rto_rpo_matrix} />
      <Text style={[s.h1, { marginTop: 16 }]}>Appendix D — Service-by-Service BCDR Recommendations</Text><View style={s.h1bar} />
      <Table sev="priority" cols={[{ key: 'service', label: 'Service', w: 130 }, { key: 'current', label: 'Current State', w: 160 }, { key: 'recommended', label: 'Recommended DR Mechanism', w: 165 }, { key: 'priority', label: 'Priority', w: 45, align: 'center' }]}
        rows={A(ap.service_recommendations).map(r => ({ ...r }))} />
    </SectionPage>
  )
}

export function ReportDoc({ report, only }) {
  const title = `Business Continuity & Disaster Recovery Plan — ${asText((report.cover || {}).customer_name) || 'Customer'}`
  const pages = [
    ['cover', <CoverPage report={report} />],
    ['exec', <ExecSummaryPage report={report} />],
    ['env', <EnvironmentPage report={report} />],
    ['req', <RequirementsPage report={report} />],
    ['method', <MethodologyPage report={report} />],
    ['current', <CurrentStatePage report={report} />],
    ['gap', <GapPage report={report} />],
    ['arch', <ArchitecturePage report={report} />],
    ['options', <OptionsPage report={report} />],
    ['cost', <CostPage report={report} />],
    ['roadmap', <RoadmapPage report={report} />],
    ['testing', <TestingRiskPage report={report} />],
    ['conclusion', <ConclusionPage report={report} />],
    ['appendix', <AppendixPage report={report} />],
    ['servicerec', <ServiceRecPage report={report} />],
  ]
  const sel = only && only.length ? pages.filter(([k]) => only.includes(k)) : pages
  return (
    <Document title={title} author="Azure Infra IQ">
      {sel.map(([k, el]) => React.cloneElement(el, { key: k }))}
    </Document>
  )
}

export async function generateBcdrConsultantPDF(report) {
  // Deep-sanitize so no exotic character or non-finite number can crash the PDF engine.
  const safe = sanitizeDeep(report || {})
  return await pdf(<ReportDoc report={safe} />).toBlob()
}
