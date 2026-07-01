/**
 * Business Impact Analysis (BIA) — consultant-grade, board-ready PDF.
 *
 * Dark navy document style matching the dashboard / BCDR consultant exports. Rendered from
 * the structured report produced by backend bia_service.generate_bia_report, which grounds a
 * standards-based (ISO 22301 / NIST SP 800-34 / ITIL 4 / ISO 27031) BIA on the live Azure
 * inventory, Azure + custom/Phase-1 tags and resource posture, with an AI narrative.
 *
 * Outline: Cover -> Executive Summary -> Methodology -> Business Services -> Criticality Tiers ->
 * Impact Over Time -> Recovery Objectives -> Dependencies & SPOF -> Financial Exposure ->
 * Resource Requirements -> Recovery Sequence -> Gaps & Recommendations -> Risk Register ->
 * Conclusion -> Appendix (per-resource BIA matrix).
 *
 * Lazy-loaded so the heavy PDF engine stays out of the main bundle.
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
  accent: '#3b82f6', accentDim: '#1d4ed8',
  line: '#334155', lineSoft: '#243044', headBg: '#334155', panel: '#1e293b',
  white: '#ffffff',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', orange: '#fb923c',
}
const sevColor = (s) => ({ critical: C.red, high: C.orange, medium: C.amber, low: C.green,
  p1: C.red, p2: C.orange, p3: C.amber }[String(s || '').toLowerCase()] || C.muted)
// Higher BIA score = more business-critical / exposed -> red is "high criticality".
const critColor = (n) => (n == null ? C.muted : n >= 70 ? C.red : n >= 45 ? C.amber : C.green)

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
  if (typeof v === 'object') return pdfSafe(v.action || v.name || v.text || JSON.stringify(v))
  return pdfSafe(String(v))
}
const money = (v) => { const n = Number(v); return (v == null || !isFinite(n)) ? '-' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) }
const A = (v) => (Array.isArray(v) ? v : [])

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
  cRow: { flexDirection: 'row', paddingVertical: 4 },
  cKey: { width: 150, fontSize: 10, color: C.faint },
  cVal: { fontSize: 10, color: C.ink, fontFamily: 'Helvetica-Bold' },
  cFoot: { fontSize: 8, color: C.faint, borderTop: `1px solid ${C.line}`, paddingTop: 10 },
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
  kpiV: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: C.ink },
  kpiL: { fontSize: 7.5, color: C.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  tag: { fontSize: 8.5, color: C.blueDk, backgroundColor: C.panel, border: `1px solid ${C.line}`, borderRadius: 3, paddingHorizontal: 7, paddingVertical: 3 },
  callout: { backgroundColor: C.panel, borderRadius: 8, padding: 11, borderLeft: `3px solid ${C.blue}`, marginBottom: 10 },
  // Amber alert callout — used when the BIA had to assume something because the customer
  // did not state it at intake. Visually distinct from the blue informational callout so
  // the reader instantly sees what is stated vs assumed.
  alert: { backgroundColor: '#3b2b10', borderRadius: 8, padding: 11, borderLeft: '3px solid #f59e0b', marginBottom: 10 },
  alertT: { fontSize: 9.5, color: '#fcd34d', fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  alertP: { fontSize: 9, color: '#fde68a', lineHeight: 1.55 },
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
        <Text style={s.fT}>{asText(customer) || 'Customer'} — Business Impact Analysis</Text>
        <Text style={s.confidential}>CONFIDENTIAL</Text>
        <Text style={s.fT} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </View>
  )
}
const RunningHead = ({ title }) => (
  <View style={s.secHead} fixed><Text style={s.secHeadT}>Business Impact Analysis</Text><Text style={s.secHeadT}>{title}</Text></View>
)
const Bullets = ({ items }) => (
  <View>{A(items).map((x, i) => (<View key={i} style={s.bullet}><Text style={s.bDot}>•</Text><Text style={s.bTxt}>{asText(x)}</Text></View>))}</View>
)

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

function Ring({ score, size = 86 }) {
  const sc = Number(score)
  const safeScore = Number.isFinite(sc) ? Math.max(0, Math.min(100, sc)) : 0
  const col = critColor(safeScore)
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
            <View><Text style={s.cBrand}>Azure Infra IQ</Text><Text style={s.cTagline}>Resilience Advisory · AI-Powered</Text></View>
          </View>
          <View style={s.cBar} />
          <Text style={s.cEyebrow}>IT Service Continuity · Standards-Based</Text>
          <Text style={s.cTitle}>Business Impact{'\n'}Analysis</Text>
          <Text style={s.cSub}>Critical-service mapping, criticality tiers, impact-over-time, MTD/RTO/RPO objectives, dependency &amp; single-point-of-failure analysis and prioritised recovery sequence — aligned to ISO 22301, NIST SP 800-34, ITIL 4 and ISO/IEC 27031.</Text>
          <View style={s.cMeta}>
            {[['Customer', c.customer_name], ['Assessment Period', c.assessment_period], ['Prepared By', c.prepared_by],
              ['Report Version', c.report_version], ['Date', c.date]].map(([k, v], i) => (
              <View key={i} style={s.cRow}><Text style={s.cKey}>{k}</Text><Text style={s.cVal}>{asText(v) || '-'}</Text></View>
            ))}
          </View>
        </View>
        <View>
          <Text style={s.confidential}>MICROSOFT CONFIDENTIAL</Text>
          <Text style={s.cFoot}>Generated by Azure Infra IQ. Grounded on the customer's live Azure inventory, resource tags and Phase-1 classification. Recommendations should be validated against current business priorities and Azure service capabilities before implementation.</Text>
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
          <Text style={[s.h2, { marginTop: 0 }]}>Business Criticality: {asText(report.score_label) || '-'} ({report.overall_score ?? '-'}/100)</Text>
          <Text style={s.p}>{asText(es.headline)}</Text>
          <Text style={s.p}><Text style={{ fontFamily: 'Helvetica-Bold' }}>Aggregate downtime cost: </Text>{asText(es.aggregate_downtime_cost_per_hour) || 'Not supplied'}{es.aggregate_downtime_cost_per_hour ? ' / hour' : ''}</Text>
        </View>
      </View>
      <Text style={s.h2}>Purpose</Text><Text style={s.p}>{asText(es.purpose)}</Text>
      <Text style={s.h2}>Scope</Text><Text style={s.p}>{asText(es.scope) || `${m.total_resources || 0} resources across ${m.subscription_count || 0} subscription(s) and ${m.region_count || 0} region(s).`}</Text>
      <Text style={s.h2}>Frameworks Applied</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2, marginBottom: 4 }}>
        {A(es.frameworks).map((f, i) => (<Text key={i} style={s.tag}>{asText(f)}</Text>))}
      </View>
      <Text style={s.h2}>Key Findings</Text><Bullets items={es.key_findings} />
    </SectionPage>
  )
}

function IntakeAuditPage({ report }) {
  const cust = (report.cover || {}).customer_name
  const summary = report.intake_summary || {}
  const assumptions = A(report.assumptions)
  const supplied = A(summary.supplied)
  const notSupplied = A(summary.not_supplied)
  return (
    <SectionPage title="Intake — Supplied vs Assumed" customer={cust}>
      <Text style={s.h1}>BIA Intake — Stated vs Assumed</Text><View style={s.h1bar} />
      <Text style={s.p}>
        This page records exactly which inputs were supplied by the customer at intake and which had
        to be assumed. Every figure later in the report is anchored on the &quot;Supplied&quot; rows
        below; anything labelled &quot;(recommended …)&quot; or &quot;Not supplied&quot; flows from
        the assumed rows.
      </Text>
      {notSupplied.length > 0 && (
        <View style={s.alert}>
          <Text style={s.alertT}>{notSupplied.length} of {(supplied.length + notSupplied.length)} BIA intake fields were not supplied ({summary.supplied_pct ?? 0}% supplied)</Text>
          <Text style={s.alertP}>
            For the strongest, board-ready BIA, re-run with the missing inputs supplied — in particular
            recovery targets (MTD / RTO / RPO) and a stated cost of downtime.
          </Text>
        </View>
      )}
      {assumptions.length > 0 && (
        <>
          <Text style={s.h2}>Assumptions Used Because the Customer Did Not State the Value</Text>
          <Bullets items={assumptions} />
        </>
      )}
      <Text style={s.h2}>Intake Field Audit</Text>
      <Table cols={[
        { key: 'label', label: 'BIA Intake Field', w: 230 },
        { key: 'status', label: 'Status', w: 110 },
        { key: 'value', label: 'Customer-Stated Value', w: 200 },
      ]} rows={[
        ...supplied.map(f => ({ label: f.label, status: 'Supplied', value: asText(f.value) })),
        ...notSupplied.map(f => ({ label: f.label, status: 'Not supplied — assumed', value: '—' })),
      ]} />
      <Text style={[s.p, { fontSize: 8, color: C.faint, marginTop: 6 }]}>
        Required fields are blocked at the intake form. &quot;Recovery target&quot; and &quot;Impact
        signal&quot; groups require at least ONE field to be supplied; if none was, the BIA still runs
        but flags the missing anchor across every downstream table.
      </Text>
    </SectionPage>
  )
}

function MethodologyPage({ report }) {
  const md = report.methodology || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="2. BIA Methodology" customer={cust}>
      <Text style={s.h1}>2. BIA Methodology</Text><View style={s.h1bar} />
      <Text style={s.h2}>Approach</Text><Text style={s.p}>{asText(md.approach)}</Text>
      <Text style={s.h2}>Frameworks Applied</Text>
      <Table cols={[{ key: 'framework', label: 'Standard / Framework', w: 200 }, { key: 'how_applied', label: 'How Applied', w: 300 }]}
        rows={md.frameworks_applied} />
      <Text style={s.h2}>Data Sources</Text><Bullets items={md.data_sources} />
    </SectionPage>
  )
}

function ServicesPage({ report }) {
  const cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="3. Critical Business Services" customer={cust}>
      <Text style={s.h1}>3. Critical Business Services &amp; Processes</Text><View style={s.h1bar} />
      <Text style={s.p}>The selected Azure resources mapped to the business services / processes they support.</Text>
      <Table cols={[
        { key: 'service', label: 'Service / Process', w: 110 }, { key: 'business_function', label: 'Business Function', w: 110 },
        { key: 'criticality_tier', label: 'Criticality Tier', w: 95 },
        { key: 'supporting_resources', label: 'Supporting Resources', w: 110, fmt: (v) => A(v).join(', ') },
        { key: 'users_affected', label: 'Users', w: 65 },
      ]} rows={report.business_services} />
      <Text style={s.h2}>Criticality Tiers</Text>
      <Table cols={[
        { key: 'tier', label: 'Tier', w: 110 }, { key: 'definition', label: 'Definition', w: 150 },
        { key: 'mtd', label: 'MTD', w: 70 }, { key: 'rto', label: 'RTO', w: 60 }, { key: 'rpo', label: 'RPO', w: 60 },
        { key: 'resource_count', label: '#', w: 30, align: 'center' },
      ]} rows={report.criticality_tiers} />
    </SectionPage>
  )
}

function ImpactPage({ report }) {
  const cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="4. Impact Over Time" customer={cust}>
      <Text style={s.h1}>4. Impact Over Time</Text><View style={s.h1bar} />
      <Text style={s.p}>Escalation of business impact by outage duration across the five standard BIA impact categories (NIST SP 800-34 / ISO 22301).</Text>
      <Table cols={[
        { key: 'duration', label: 'Outage', w: 52 }, { key: 'financial', label: 'Financial', w: 98 },
        { key: 'operational', label: 'Operational', w: 92 }, { key: 'reputational', label: 'Reputational', w: 92 },
        { key: 'regulatory', label: 'Regulatory', w: 88 }, { key: 'health_safety', label: 'Health & Safety', w: 80 },
      ]} rows={report.impact_over_time} />
    </SectionPage>
  )
}

function RecoveryObjPage({ report }) {
  const cust = (report.cover || {}).customer_name
  const summary = report.intake_summary || {}
  const noTargets = summary.any_recovery_target_supplied === false
  return (
    <SectionPage title="5. Recovery Objectives" customer={cust}>
      <Text style={s.h1}>5. Recovery Objectives (MTD / RTO / RPO)</Text><View style={s.h1bar} />
      {noTargets && (
        <View style={s.alert}>
          <Text style={s.alertT}>Customer did not state recovery targets at intake</Text>
          <Text style={s.alertP}>
            No MTD, default RTO or default RPO was supplied for this BIA. The &quot;Current&quot; columns
            below therefore read &quot;Not supplied&quot;, and the &quot;Recommended&quot; columns are
            tagged &quot;(recommended — no customer target)&quot;. These are professional recommendations
            derived from each workload&apos;s criticality tier and Microsoft DR doctrine — please validate
            with the business owner before approval. To replace these with stated targets, re-run the BIA
            with MTD / default RTO / default RPO in the intake form.
          </Text>
        </View>
      )}
      <Table cols={[
        { key: 'workload', label: 'Workload', w: 110 }, { key: 'criticality', label: 'Criticality', w: 70 },
        { key: 'mtd', label: 'MTD', w: 56 }, { key: 'current_rto', label: 'Cur RTO', w: 56 }, { key: 'recommended_rto', label: 'Rec RTO', w: 56 },
        { key: 'current_rpo', label: 'Cur RPO', w: 56 }, { key: 'recommended_rpo', label: 'Rec RPO', w: 56 },
      ]} rows={report.recovery_objectives} />
      <Text style={[s.p, { fontSize: 8, color: C.faint }]}>MTD = Maximum Tolerable Downtime · RTO = Recovery Time Objective · RPO = Recovery Point Objective. Recommended values are professional guidance where the customer did not state a target.</Text>
    </SectionPage>
  )
}

function DependencyPage({ report }) {
  const da = report.dependency_analysis || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="6. Dependencies & Single Points of Failure" customer={cust}>
      <Text style={s.h1}>6. Dependency &amp; Single-Point-of-Failure Analysis</Text><View style={s.h1bar} />
      <Text style={s.h2}>Upstream Dependencies</Text><Bullets items={da.upstream_dependencies} />
      <Text style={s.h2}>Downstream Dependencies</Text><Bullets items={da.downstream_dependencies} />
      {asText(da.notes) ? (<View style={s.callout}><Text style={s.p}>{asText(da.notes)}</Text></View>) : null}
      <Text style={s.h2}>Single Points of Failure</Text>
      <Table cols={[
        { key: 'resource', label: 'Resource', w: 110 }, { key: 'why', label: 'Why', w: 150 },
        { key: 'impact', label: 'Business Impact', w: 120 }, { key: 'mitigation', label: 'Mitigation', w: 120 },
      ]} rows={da.single_points_of_failure} />
    </SectionPage>
  )
}

function FinancialPage({ report }) {
  const fe = report.financial_exposure || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="7. Financial Exposure" customer={cust}>
      <Text style={s.h1}>7. Financial Exposure</Text><View style={s.h1bar} />
      <View style={s.kpis}>
        <View style={[s.kpi, { borderTopColor: C.green }]}><Text style={s.kpiV}>{asText(fe.actual_monthly_run_rate) || '-'}</Text><Text style={s.kpiL}>Actual monthly run-rate (Azure cost)</Text></View>
        <View style={[s.kpi, { borderTopColor: C.red }]}><Text style={s.kpiV}>{asText(fe.per_hour) || '-'}</Text><Text style={s.kpiL}>Est. per hour (business loss)</Text></View>
        <View style={[s.kpi, { borderTopColor: C.amber }]}><Text style={s.kpiV}>{asText(fe.annualized) || '-'}</Text><Text style={s.kpiL}>Est. annualized (business loss)</Text></View>
      </View>
      <View style={s.callout}><Text style={[s.p, { marginBottom: 0 }]}>The actual monthly run-rate is the real Azure cost (Cost Management). The per-hour / annualized figures are ESTIMATES of business impact from downtime, not the Azure bill — see basis below.</Text></View>
      <Text style={s.h2}>Basis</Text><Text style={s.p}>{asText(fe.basis)}</Text>
      <Text style={s.h2}>Most Exposed Services</Text><Bullets items={fe.most_exposed_services} />
    </SectionPage>
  )
}

function RequirementsPage({ report }) {
  const rr = report.resource_requirements || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="8. Recovery Resource Requirements" customer={cust}>
      <Text style={s.h1}>8. Recovery Resource Requirements</Text><View style={s.h1bar} />
      <Text style={s.h2}>Minimum Recovery Resources</Text><Bullets items={rr.minimum_recovery_resources} />
      <Text style={s.h2}>Vital Records / Critical Data</Text><Bullets items={rr.vital_records} />
      <Text style={s.h2}>Staffing Roles</Text><Bullets items={rr.staffing_roles} />
      <Text style={s.h2}>Third-Party Dependencies</Text><Bullets items={rr.third_party_dependencies} />
    </SectionPage>
  )
}

function RecoverySeqPage({ report }) {
  const cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="9. Prioritised Recovery Sequence" customer={cust}>
      <Text style={s.h1}>9. Prioritised Recovery Sequence</Text><View style={s.h1bar} />
      <Table cols={[
        { key: 'order', label: '#', w: 24, align: 'center' }, { key: 'service', label: 'Service / Workload', w: 130 },
        { key: 'resources', label: 'Resources', w: 150, fmt: (v) => A(v).join(', ') },
        { key: 'target_rto', label: 'Target RTO', w: 64 }, { key: 'rationale', label: 'Rationale', w: 132 },
      ]} rows={report.recovery_sequence} />
    </SectionPage>
  )
}

function GapsPage({ report }) {
  const cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="10. Gaps & Recommendations" customer={cust}>
      <Text style={s.h1}>10. Gaps &amp; Recommendations</Text><View style={s.h1bar} />
      <Table sev="priority" cols={[
        { key: 'gap', label: 'Gap', w: 130 }, { key: 'business_impact', label: 'Business Impact', w: 120 },
        { key: 'recommendation', label: 'Recommendation', w: 160 }, { key: 'priority', label: 'Pri', w: 34, align: 'center' },
        { key: 'effort', label: 'Effort', w: 44, align: 'center' },
      ]} rows={report.gaps_and_recommendations} />
    </SectionPage>
  )
}

function RiskConclusionPage({ report }) {
  const cc = report.conclusion || {}, cust = (report.cover || {}).customer_name
  return (
    <SectionPage title="11. Risk Register & Conclusion" customer={cust}>
      <Text style={s.h1}>11. Risk Register</Text><View style={s.h1bar} />
      <Table sev="impact" cols={[
        { key: 'risk', label: 'Risk', w: 210 }, { key: 'probability', label: 'Probability', w: 70, align: 'center' },
        { key: 'impact', label: 'Impact', w: 60, align: 'center' }, { key: 'mitigation', label: 'Mitigation', w: 162 },
      ]} rows={report.risk_register} />
      <Text style={[s.h1, { marginTop: 16 }]}>12. Conclusion &amp; Next Steps</Text><View style={s.h1bar} />
      <Text style={s.p}>{asText(cc.summary)}</Text>
      <Text style={s.h2}>Immediate Actions</Text><Bullets items={cc.immediate_actions} />
      <Text style={s.h2}>Next Steps</Text><Bullets items={cc.next_steps} />
    </SectionPage>
  )
}

function AppendixPage({ report }) {
  const matrix = (report.appendices || {}).bia_matrix || []
  const cust = (report.cover || {}).customer_name
  return (
    <Page size="A4" style={s.page} wrap>
      <RunningHead title="Appendix A — BIA Matrix" />
      <Text style={s.h1}>Appendix A — Per-Resource BIA Matrix</Text><View style={s.h1bar} />
      <Text style={[s.p, { fontSize: 8, color: C.faint }]}>Deterministic grounding: criticality tier, target RTO and the resource's ACTUAL monthly Azure cost (Azure Cost Management — region/SKU-accurate). Estimated business-impact loss is shown in the Financial Exposure section, not per-resource here.</Text>
      <Table cols={[
        { key: 'resource_name', label: 'Resource', w: 110 }, { key: 'resource_type', label: 'Type', w: 78 },
        { key: 'location', label: 'Region', w: 56 }, { key: 'bia_tier', label: 'BIA Tier', w: 86 },
        { key: 'criticality_source', label: 'Source', w: 48 },
        { key: 'target_rto_hours', label: 'RTO(h)', w: 44, align: 'right' },
        { key: 'monthly_cost', label: 'Monthly $ (actual)', w: 78, align: 'right', fmt: money },
        { key: 'business_owner', label: 'Owner', w: 64 },
      ]} rows={matrix.slice(0, 240)} />
      <Text style={[s.p, { fontSize: 8, color: C.faint }]}>{matrix.length} resources in scope.</Text>
      <Footer customer={cust} />
    </Page>
  )
}

export function BIADoc({ report, only }) {
  const title = `Business Impact Analysis — ${asText((report.cover || {}).customer_name) || 'Customer'}`
  const pages = [
    ['cover', <CoverPage report={report} />],
    ['exec', <ExecSummaryPage report={report} />],
    ['intake', <IntakeAuditPage report={report} />],
    ['method', <MethodologyPage report={report} />],
    ['services', <ServicesPage report={report} />],
    ['impact', <ImpactPage report={report} />],
    ['objectives', <RecoveryObjPage report={report} />],
    ['deps', <DependencyPage report={report} />],
    ['financial', <FinancialPage report={report} />],
    ['requirements', <RequirementsPage report={report} />],
    ['sequence', <RecoverySeqPage report={report} />],
    ['gaps', <GapsPage report={report} />],
    ['riskconc', <RiskConclusionPage report={report} />],
    ['appendix', <AppendixPage report={report} />],
  ]
  const sel = only && only.length
    ? pages.filter(([k]) => only.includes(k))
    : pages.filter(([k]) => {
        // Intake-audit page is OMITTED when the backend didn't attach intake_summary
        // (i.e. an older payload) so existing reports still render unchanged.
        if (k === 'intake') return !!(report.intake_summary || (report.assumptions && report.assumptions.length))
        return true
      })
  return (
    <Document title={title} author="Azure Infra IQ">
      {sel.map(([k, el]) => React.cloneElement(el, { key: k }))}
    </Document>
  )
}

export async function generateBIAPDF(report) {
  const safe = sanitizeDeep(report || {})
  return await pdf(<BIADoc report={safe} />).toBlob()
}
