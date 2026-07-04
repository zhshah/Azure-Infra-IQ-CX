/**
 * finopsExecutiveReport — branded, CFO-ready Azure FinOps executive report (PDF).
 *
 * Multi-section @react-pdf/renderer document: cover with headline KPIs, executive
 * summary + AI narrative, 30-day spend trend, cost by subscription, top movers
 * (period-over-period), top workloads, savings opportunities and Advisor
 * recommendations. Uses the shared BrandMark for one visual identity.
 *
 * IMPORTANT: this module statically imports @react-pdf/renderer, so it must only
 * ever be DYNAMICALLY imported (await import(...)) — never static-imported into a
 * component that ships in the main bundle (keeps react-pdf in a lazy chunk).
 */
import React from 'react'
import { pdf, Document, Page, Text, View, StyleSheet, Svg, Rect } from '@react-pdf/renderer'
import { BrandMark } from './pdfBrand'

const NAVY = '#0E3F73'
const BLUE = '#0A66C2'
const SKY = '#1583E6'
const INK = '#0f172a'
const MUTED = '#64748b'
const LINE = '#e2e8f0'
const GREEN = '#15803d'
const RED = '#b91c1c'

const S = StyleSheet.create({
  page:      { padding: 34, fontSize: 10, color: INK, fontFamily: 'Helvetica' },
  coverPage: { padding: 0, color: INK, fontFamily: 'Helvetica' },
  coverTop:  { backgroundColor: NAVY, color: '#fff', padding: 40, height: 300 },
  coverBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 30 },
  coverTitle: { fontSize: 30, fontWeight: 700, color: '#fff', marginTop: 20 },
  coverSub:  { fontSize: 13, color: '#cbd5e1', marginTop: 8 },
  coverMeta: { fontSize: 10, color: '#94a3b8', marginTop: 22 },
  kpiWrap:   { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 34 },
  kpiCard:   { width: '47%', border: `1pt solid ${LINE}`, borderRadius: 6, padding: 14, marginRight: 10, marginBottom: 10 },
  kpiLbl:    { fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiVal:    { fontSize: 20, fontWeight: 700, color: NAVY, marginTop: 4 },
  kpiSub:    { fontSize: 8, color: MUTED, marginTop: 3 },
  h1:        { fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 3 },
  h2:        { fontSize: 12, fontWeight: 700, color: BLUE, marginTop: 16, marginBottom: 7 },
  sub:       { fontSize: 9, color: MUTED, marginBottom: 12 },
  body:      { fontSize: 10, color: '#334155', lineHeight: 1.5 },
  tr:        { flexDirection: 'row', borderBottom: `0.5pt solid ${LINE}` },
  th:        { fontSize: 8, fontWeight: 700, color: NAVY, padding: 4, backgroundColor: '#f1f5f9' },
  td:        { fontSize: 8, padding: 4, color: '#334155' },
  footer:    { position: 'absolute', bottom: 18, left: 34, right: 34, flexDirection: 'row', justifyContent: 'space-between', borderTop: `0.5pt solid ${LINE}`, paddingTop: 6 },
  footTxt:   { fontSize: 7, color: MUTED },
  pill:      { fontSize: 8, color: '#fff', backgroundColor: BLUE, borderRadius: 3, padding: '2 6', marginRight: 4 },
})

const money = (v) => {
  const n = Number(v || 0)
  if (Math.abs(n) >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + n.toFixed(2)
}
const pct = (v) => `${Number(v || 0) >= 0 ? '+' : ''}${Number(v || 0).toFixed(1)}%`

function Footer({ page }) {
  return (
    <View style={S.footer} fixed>
      <Text style={S.footTxt}>© {new Date().getFullYear()} · Azure Infra IQ · FinOps Executive Report</Text>
      <Text style={S.footTxt}>Confidential</Text>
    </View>
  )
}

function KpiCard({ label, value, sub }) {
  return (
    <View style={S.kpiCard}>
      <Text style={S.kpiLbl}>{label}</Text>
      <Text style={S.kpiVal}>{value}</Text>
      {sub ? <Text style={S.kpiSub}>{sub}</Text> : null}
    </View>
  )
}

/* Simple bar chart (react-pdf has no chart lib) */
function TrendBars({ data, width = 520, height = 90 }) {
  const pts = (data || []).filter(p => p && p.cost != null)
  if (pts.length < 2) return null
  const max = Math.max(1, ...pts.map(p => p.cost))
  const bw = Math.max(2, (width - (pts.length - 1) * 2) / pts.length)
  return (
    <Svg width={width} height={height}>
      {pts.map((p, i) => {
        const h = Math.max(1, (p.cost / max) * (height - 14))
        return <Rect key={i} x={i * (bw + 2)} y={height - h - 2} width={bw} height={h} fill={SKY} rx={1} />
      })}
    </Svg>
  )
}

function Table({ columns, rows, widths }) {
  const w = widths || columns.map(() => `${(100 / columns.length).toFixed(2)}%`)
  return (
    <View>
      <View style={S.tr}>
        {columns.map((c, i) => (
          <Text key={i} style={[S.th, { width: w[i], textAlign: i === 0 ? 'left' : 'right' }]}>{c}</Text>
        ))}
      </View>
      {(rows || []).map((row, ri) => (
        <View key={ri} style={S.tr} wrap={false}>
          {row.map((cell, ci) => (
            <Text key={ci} style={[S.td, { width: w[ci], textAlign: ci === 0 ? 'left' : 'right' }]}>{String(cell ?? '')}</Text>
          ))}
        </View>
      ))}
    </View>
  )
}

function buildDoc(r) {
  const k = r.kpis || {}
  const h = React.createElement
  return (
    <Document>
      {/* Cover */}
      <Page size="A4" style={S.coverPage}>
        <View style={S.coverTop}>
          <View style={S.coverBrandRow}>
            <BrandMark size={40} />
            <Text style={{ fontSize: 13, color: '#fff', fontWeight: 700 }}>Azure Infra IQ</Text>
          </View>
          <Text style={S.coverTitle}>FinOps Executive Report</Text>
          <Text style={S.coverSub}>{r.customer || 'Azure Cost Management'} — cloud cost, trends, savings &amp; workloads</Text>
          <Text style={S.coverMeta}>Generated {r.generatedAt || new Date().toLocaleString()} · Source: live Azure Cost Management</Text>
        </View>
        <View style={S.kpiWrap}>
          <KpiCard label="Spend month-to-date" value={money(k.totalMtd)} sub={k.subCount ? `${k.subCount} subscriptions · ${k.resourceCount || 0} resources` : null} />
          <KpiCard label="Forecast end-of-month" value={money(k.forecastEom)} sub={k.momDeltaPct != null ? `${pct(k.momDeltaPct)} vs last month` : null} />
          <KpiCard label="Identified savings / mo" value={money(k.savings)} sub="right-size · orphans · commitments" />
          <KpiCard label="Tagging compliance" value={`${Number(k.tagCompliance || 0).toFixed(0)}%`} sub={k.anomalyCount ? `${k.anomalyCount} cost anomalies` : 'governance'} />
        </View>
        <Footer />
      </Page>

      {/* Executive summary */}
      <Page size="A4" style={S.page}>
        <Text style={S.h1}>Executive Summary</Text>
        <Text style={S.sub}>{r.customer || ''} · {r.generatedAt || new Date().toLocaleDateString()}</Text>
        {r.aiNarrative
          ? <Text style={S.body}>{r.aiNarrative}</Text>
          : <Text style={S.body}>
              Month-to-date spend is {money(k.totalMtd)} across {k.subCount || 0} subscriptions and {k.resourceCount || 0} resources,
              forecast to reach {money(k.forecastEom)} by end of month ({k.momDeltaPct != null ? pct(k.momDeltaPct) + ' vs last month' : 'trend stable'}).
              {Number(k.savings) > 0 ? ` An estimated ${money(k.savings)}/month of savings has been identified through right-sizing, orphan cleanup and commitment coverage.` : ''}
              {k.anomalyCount ? ` ${k.anomalyCount} cost anomalies were detected in the period.` : ''}
            </Text>}

        <Text style={S.h2}>30-day spend trend</Text>
        <TrendBars data={r.trend} />
        {r.trend && r.trend.length >= 2
          ? <Text style={[S.sub, { marginTop: 4 }]}>{r.trend.length} days · latest {money(r.trend[r.trend.length - 1].cost)}/day</Text>
          : <Text style={S.sub}>Trend data unavailable.</Text>}

        <Text style={S.h2}>Cost by subscription</Text>
        <Table
          columns={['Subscription', 'Monthly cost', '% of total']}
          widths={['58%', '22%', '20%']}
          rows={(r.bySubscription || []).slice(0, 12).map(s => {
            const tot = (r.bySubscription || []).reduce((a, b) => a + (b.cost || 0), 0) || 1
            return [s.name, money(s.cost), `${(s.cost / tot * 100).toFixed(1)}%`]
          })}
        />
        <Footer />
      </Page>

      {/* Movers + workloads */}
      <Page size="A4" style={S.page}>
        <Text style={S.h1}>What changed &amp; where cost concentrates</Text>
        <Text style={S.h2}>Biggest cost movers (this month vs last)</Text>
        <Table
          columns={['Resource group', 'This month', 'Last month', 'Change']}
          widths={['40%', '20%', '20%', '20%']}
          rows={(r.topMovers || []).slice(0, 12).map(m => [m.value, money(m.current), money(m.prior), `${m.delta >= 0 ? '+' : ''}${money(m.delta)}`])}
        />

        <Text style={S.h2}>Top workloads by cost (dependency roll-up)</Text>
        <Table
          columns={['Workload', 'Monthly cost', 'Resources']}
          widths={['58%', '24%', '18%']}
          rows={(r.workloads || []).slice(0, 12).map(w => [w.name, money(w.cost), String(w.resourceCount || 0)])}
        />
        <Footer />
      </Page>

      {/* Savings + recommendations */}
      <Page size="A4" style={S.page}>
        <Text style={S.h1}>Savings &amp; optimization</Text>
        {(r.savings || []).length > 0 && (
          <>
            <Text style={S.h2}>Savings opportunities</Text>
            <Table
              columns={['Opportunity', 'Est. monthly savings']}
              widths={['70%', '30%']}
              rows={(r.savings || []).slice(0, 14).map(s => [s.title, money(s.monthly)])}
            />
          </>
        )}
        {(r.recommendations || []).length > 0 && (
          <>
            <Text style={S.h2}>Azure Advisor cost recommendations</Text>
            <Table
              columns={['Recommendation', 'Resource', 'Est. monthly']}
              widths={['52%', '30%', '18%']}
              rows={(r.recommendations || []).slice(0, 14).map(x => [x.recommendation, x.resource, money(x.savings)])}
            />
          </>
        )}
        {((r.savings || []).length === 0 && (r.recommendations || []).length === 0) && (
          <Text style={S.body}>No savings opportunities or Advisor cost recommendations were available at generation time.</Text>
        )}
        <Text style={[S.sub, { marginTop: 20 }]}>
          Figures are sourced from live Azure Cost Management and the resource inventory at the time of generation.
          Savings are indicative estimates for prioritization, not guaranteed outcomes.
        </Text>
        <Footer />
      </Page>
    </Document>
  )
}

/** Build + download the FinOps executive PDF. `report` = assembled data (see component). */
export async function generateFinOpsExecutivePDF(report) {
  const doc = buildDoc(report || {})
  const blob = await pdf(doc).toBlob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const who = (report?.customer || 'azure').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  a.download = `finops-executive-report-${who}-${new Date().toISOString().slice(0, 10)}.pdf`
  document.body.appendChild(a); a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1500)
}

export default generateFinOpsExecutivePDF
