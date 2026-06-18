/**
 * AI Report PDF Export — generic, works for ANY category's AI analysis.
 *
 * Renders a clean, printable report from the raw AI report object regardless of its exact
 * shape: score, executive summary, findings (even when nested inside categories),
 * recommendations, top risks, category scores, and the resources each item references.
 * Light theme so it prints well and is easy to share.
 */
import React from 'react'
import { pdf, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { BrandMark } from './pdfBrand'

const COL = {
  ink: '#0f172a', body: '#1e293b', muted: '#64748b', line: '#e2e8f0',
  accent: '#2563eb', headBg: '#f1f5f9',
  crit: '#b91c1c', high: '#c2410c', medium: '#a16207', low: '#475569',
  good: '#16a34a', impact: '#0f766e', bad: '#dc2626',
}
function scoreColor(s) {
  if (s >= 85) return COL.good
  if (s >= 70) return '#65a30d'
  if (s >= 50) return '#d97706'
  if (s >= 30) return '#ea580c'
  return COL.bad
}
const sevColor = (s) => ({ critical: COL.crit, high: COL.high, medium: COL.medium, low: COL.low, p1: COL.crit, p2: COL.high, p3: COL.medium }[String(s || '').toLowerCase()] || COL.low)

const st = StyleSheet.create({
  page: { paddingTop: 38, paddingBottom: 46, paddingHorizontal: 40, fontSize: 9.5, color: COL.body, fontFamily: 'Helvetica', lineHeight: 1.4 },
  brand: { fontSize: 8, color: COL.muted, letterSpacing: 1.5, fontFamily: 'Helvetica-Bold' },
  h1: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: COL.ink, marginTop: 2 },
  sub: { fontSize: 9, color: COL.muted, marginTop: 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 8 },
  scoreBox: { width: 70, height: 70, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  scoreNum: { fontSize: 25, fontFamily: 'Helvetica-Bold', color: '#fff' },
  scoreLbl: { fontSize: 7.5, color: '#fff', marginTop: -2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 },
  metaItem: { fontSize: 8, color: COL.muted, marginRight: 14 },
  section: { marginTop: 14 },
  secTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: COL.accent, borderBottomWidth: 1, borderBottomColor: COL.line, paddingBottom: 3, marginBottom: 6 },
  para: { fontSize: 9.5, color: COL.body },
  bullet: { flexDirection: 'row', marginBottom: 3 },
  bulletDot: { width: 10, color: COL.accent },
  tHead: { flexDirection: 'row', backgroundColor: COL.headBg, borderBottomWidth: 1, borderBottomColor: COL.line, paddingVertical: 4, paddingHorizontal: 4 },
  th: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: COL.ink },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingVertical: 4, paddingHorizontal: 4 },
  td: { fontSize: 8.5, color: COL.body },
  card: { borderWidth: 1, borderColor: COL.line, borderRadius: 4, padding: 8, marginBottom: 6 },
  pill: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#fff', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: COL.line, paddingTop: 6 },
  footTxt: { fontSize: 7.5, color: COL.muted },
})

function asText(v) {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('; ')
  if (typeof v === 'object') return v.action || v.text || v.recommendation || v.description || v.detail || v.title || v.name || JSON.stringify(v)
  return String(v)
}
function collectNested(rep, key) {
  const out = []
  if (Array.isArray(rep?.[key])) out.push(...rep[key].filter((x) => x && typeof x === 'object'))
  for (const [, v] of Object.entries(rep || {})) {
    if (Array.isArray(v)) {
      for (const it of v) {
        if (it && typeof it === 'object' && Array.isArray(it[key])) {
          const cat = it.name || it.category || it.title || ''
          for (const sub of it[key]) {
            if (sub && typeof sub === 'object') out.push(cat && !sub.category ? { ...sub, category: cat } : sub)
          }
        }
      }
    }
  }
  return out
}
function pickScore(rep) {
  for (const k of Object.keys(rep || {})) {
    if (/score$/i.test(k) && typeof rep[k] === 'number') return rep[k]
  }
  if (typeof rep?.score === 'number') return rep.score
  return null
}
function pickLabel(rep) {
  return rep?.risk_level || rep?.score_label || rep?.maturity_label || rep?.innovation_maturity || rep?.risk_rating || ''
}
function affectedText(it) {
  const a = it.affected_resources || it.resources || it.resources_affected || []
  const names = (Array.isArray(a) ? a : []).map((x) => (x && (x.resource_name || x.name)) || (typeof x === 'string' ? x : '')).filter(Boolean)
  let s = names.join(', ')
  const c = it.affected_count
  if (typeof c === 'number' && c > names.length) s += ` (+${c - names.length} more)`
  return s
}

function AIReportDoc({ title, category, report }) {
  const score = pickScore(report)
  const label = pickLabel(report)
  const summary = report?.executive_summary || report?.summary || ''
  const findings = collectNested(report, 'findings').concat(collectNested(report, 'critical_findings'))
  const recs = collectNested(report, 'recommendations')
  const risks = collectNested(report, 'top_risks')
  const cats = ((report?.categories || report?.category_analysis || [])).filter((c) => c && typeof c === 'object')
  const meta = report?._meta || {}
  let when
  try { when = new Date(meta.generated_at || Date.now()).toLocaleString() } catch { when = '' }

  return (
    <Document>
      <Page size="A4" style={st.page} wrap>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 2 }}>
          <BrandMark size={24} />
          <Text style={st.brand}>AZURE INFRA IQ</Text>
        </View>
        <Text style={st.h1}>{title || 'AI Analysis'}</Text>
        <Text style={st.sub}>{category ? `${category} · ` : ''}AI Analysis{when ? `  ·  ${when}` : ''}</Text>

        <View style={st.headerRow}>
          {score != null && (
            <View style={[st.scoreBox, { backgroundColor: scoreColor(score) }]}>
              <Text style={st.scoreNum}>{Math.round(score)}</Text>
              <Text style={st.scoreLbl}>/ 100</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            {label ? <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: score != null ? scoreColor(score) : COL.ink }}>{asText(label)}</Text> : null}
            {summary ? <Text style={[st.para, { marginTop: 3 }]}>{asText(summary)}</Text> : null}
            <View style={st.metaRow}>
              {meta.resource_count != null && <Text style={st.metaItem}>{meta.resource_count} resources analyzed</Text>}
              {meta.model && <Text style={st.metaItem}>Model: {meta.model}</Text>}
            </View>
          </View>
        </View>

        {cats.length > 0 && (
          <View style={st.section}>
            <Text style={st.secTitle}>Category Scores</Text>
            <View style={st.tHead}>
              <Text style={[st.th, { flex: 4 }]}>Category</Text>
              <Text style={[st.th, { width: 42, textAlign: 'right' }]}>Score</Text>
              <Text style={[st.th, { width: 70, textAlign: 'right' }]}>Findings</Text>
            </View>
            {cats.map((c, i) => (
              <View key={i} style={st.tRow} wrap={false}>
                <Text style={[st.td, { flex: 4 }]}>{asText(c.name || c.category || c.title)}</Text>
                <Text style={[st.td, { width: 42, textAlign: 'right', fontFamily: 'Helvetica-Bold', color: scoreColor(c.score || 0) }]}>{typeof c.score === 'number' ? c.score : '—'}</Text>
                <Text style={[st.td, { width: 70, textAlign: 'right', color: COL.muted }]}>{(c.findings && c.findings.length) || c.finding_count || 0}</Text>
              </View>
            ))}
          </View>
        )}

        {findings.length > 0 && (
          <View style={st.section}>
            <Text style={st.secTitle}>Findings ({findings.length})</Text>
            {findings.slice(0, 80).map((f, i) => (
              <View key={i} style={st.card} wrap={false}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
                  {f.severity ? <Text style={[st.pill, { backgroundColor: sevColor(f.severity) }]}>{String(f.severity).toUpperCase()}</Text> : null}
                  <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: COL.ink, marginLeft: f.severity ? 6 : 0, flex: 1 }}>{asText(f.title || f.name)}</Text>
                  {f.category ? <Text style={{ fontSize: 7.5, color: COL.muted }}>{asText(f.category)}</Text> : null}
                </View>
                {(f.detail || f.description) ? <Text style={st.para}>{asText(f.detail || f.description)}</Text> : null}
                {f.recommendation ? <Text style={{ fontSize: 8.5, color: COL.impact, marginTop: 2 }}>Recommendation: {asText(f.recommendation)}</Text> : null}
                {affectedText(f) ? <Text style={{ fontSize: 7.5, color: COL.muted, marginTop: 3 }}>Affected: {affectedText(f)}</Text> : null}
              </View>
            ))}
          </View>
        )}

        {recs.length > 0 && (
          <View style={st.section}>
            <Text style={st.secTitle}>Recommendations ({recs.length})</Text>
            {recs.slice(0, 80).map((r, i) => (
              <View key={i} style={st.card} wrap={false}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
                  {(r.priority) ? <Text style={[st.pill, { backgroundColor: sevColor(r.priority) }]}>{asText(r.priority)}</Text> : null}
                  <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: COL.ink, marginLeft: r.priority ? 6 : 0, flex: 1 }}>{asText(r.title || r.action || r.recommendation)}</Text>
                  {r.estimated_effort || r.effort ? <Text style={{ fontSize: 7.5, color: COL.muted }}>Effort: {asText(r.estimated_effort || r.effort)}</Text> : null}
                </View>
                {(r.description || r.detail) ? <Text style={st.para}>{asText(r.description || r.detail)}</Text> : null}
                {affectedText(r) ? <Text style={{ fontSize: 7.5, color: COL.muted, marginTop: 3 }}>Affected: {affectedText(r)}</Text> : null}
              </View>
            ))}
          </View>
        )}

        {risks.length > 0 && (
          <View style={st.section}>
            <Text style={st.secTitle}>Top Risks</Text>
            {risks.slice(0, 40).map((x, i) => (
              <View key={i} style={st.bullet}>
                <Text style={st.bulletDot}>•</Text>
                <Text style={[st.para, { flex: 1 }]}>{asText(x.title || x.description || x)}{x.remediation_priority ? `  [${asText(x.remediation_priority)}]` : ''}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={st.footer} fixed>
          <Text style={st.footTxt}>Azure Infra IQ — Confidential  ·  {asText(title)}</Text>
          <Text style={st.footTxt} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

export async function generateAIReportPDF(title, category, report) {
  return await pdf(<AIReportDoc title={title} category={category} report={report} />).toBlob()
}
