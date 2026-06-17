/**
 * Project Assessment PDF Export — board-ready, brand-matched to the home "Export PDF"
 * (Azure Estate Overview) report: dark theme, cover page with brand logo + score ring,
 * a sectioned body (executive summary, score breakdown, pillar bars, tag-driven insights,
 * findings, recommendations, key risks) and a fixed footer with page numbers.
 *
 * Handles the "Not Applicable" case (overall_score === null / applicability === not_applicable)
 * so a category that doesn't fit the resource types renders as N/A — never a false 0 / Critical.
 *
 * Lazy-loaded from ProjectWorkspace so the heavy PDF engine stays out of the main bundle.
 */
import React from 'react'
import { pdf, Document, Page, Text, View, StyleSheet, Svg, Path, Rect, Circle, Defs, LinearGradient, Stop, G } from '@react-pdf/renderer'

// ── Brand palette (matches ExportPDFButton / Azure Estate Overview) ───────────
const C = {
  bg: '#0f172a', bgCard: '#1e293b', bgLight: '#334155',
  accent: '#3b82f6', accentDim: '#1d4ed8',
  success: '#22c55e', warn: '#f59e0b', danger: '#ef4444',
  text: '#f1f5f9', textMuted: '#94a3b8', textDim: '#64748b',
  border: '#334155', white: '#ffffff', slate: '#64748b',
}

const fmtDate = (v) => { try { return new Date(v || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) } catch { return '' } }

// Coerce any value (string/number/array/object) to a safe display string — react-pdf
// <Text> children MUST be strings; backend findings/recs/risks can arrive as objects.
function asText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    if (v.action || v.notes) return [v.action, v.notes].filter(Boolean).map(asText).join(' — ')
    if (v.text) return asText(v.text)
    if (v.name) return asText(v.name)
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

const scoreColor = (sc) => (sc == null ? C.slate : sc >= 85 ? C.success : sc >= 70 ? '#84cc16' : sc >= 50 ? C.warn : sc >= 30 ? '#f97316' : C.danger)
const sevColor   = (sv) => ({ critical: C.danger, high: '#f97316', medium: C.warn, low: '#84cc16', info: C.accent }[String(sv || '').toLowerCase()] || C.slate)
const sevPillBg  = (sv) => ({ critical: '#450a0a', high: '#431407', medium: '#422006', low: '#052e16', info: '#0c2a4d' }[String(sv || '').toLowerCase()] || '#1e293b')

function affectedText(it) {
  const a = it.affected_resources || []
  const names = a.map(x => (x && (x.resource_name || x.name)) || '').filter(Boolean)
  let str = names.join(', ')
  const c = it.affected_count
  if (typeof c === 'number' && c > names.length) str += ` (+${c - names.length} more)`
  return str
}

const s = StyleSheet.create({
  page: { backgroundColor: C.bg, color: C.text, fontFamily: 'Helvetica', paddingBottom: 46 },

  // Cover
  cover: { flex: 1, padding: 48, justifyContent: 'space-between' },
  coverLogo: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  coverWord: { flexDirection: 'column', gap: 2 },
  coverEyebrow: { fontSize: 8, color: C.textDim, letterSpacing: 2, fontFamily: 'Helvetica-Bold' },
  coverBrand: { fontSize: 16, color: C.white, fontFamily: 'Helvetica-Bold' },
  coverTagline: { fontSize: 7.5, color: C.textDim },
  coverCenter: { flex: 1, justifyContent: 'center', paddingVertical: 24 },
  catEyebrow: { fontSize: 9, color: C.accent, letterSpacing: 2, fontFamily: 'Helvetica-Bold', marginBottom: 8, textTransform: 'uppercase' },
  coverTitle: { fontSize: 30, fontFamily: 'Helvetica-Bold', color: C.white, marginBottom: 8, lineHeight: 1.12 },
  coverSubtitle: { fontSize: 13, color: C.textMuted, marginBottom: 24 },
  scoreWrap: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 24 },
  scoreLabelBig: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  scoreLabelSub: { fontSize: 9, color: C.textMuted, marginTop: 3, maxWidth: 300 },
  meta: { backgroundColor: C.bgCard, borderRadius: 10, padding: 20, gap: 8, borderLeft: `3px solid ${C.accent}` },
  metaRow: { flexDirection: 'row', gap: 6 },
  metaLabel: { fontSize: 9, color: C.textDim, width: 120 },
  metaValue: { fontSize: 9, color: C.text, flex: 1 },
  coverFoot: { fontSize: 8, color: C.textDim },

  // Body
  inner: { paddingHorizontal: 40, paddingTop: 40 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, paddingBottom: 9, borderBottom: `2px solid ${C.accent}` },
  sectionTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.white },
  sectionBadge: { marginLeft: 10, backgroundColor: C.accentDim, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  sectionBadgeText: { fontSize: 8, color: C.white, fontFamily: 'Helvetica-Bold' },

  // KPI grid
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  kpiCard: { width: '30%', backgroundColor: C.bgCard, borderRadius: 8, padding: 14, borderTop: `2px solid ${C.accent}` },
  kpiLabel: { fontSize: 8, color: C.textDim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.white },
  kpiSub: { fontSize: 8, color: C.textMuted, marginTop: 3 },

  // Narrative / N-A
  narrative: { backgroundColor: C.bgCard, borderRadius: 8, padding: 16, borderLeft: `3px solid ${C.accent}`, marginBottom: 18 },
  narrativeText: { fontSize: 9.5, color: C.textMuted, lineHeight: 1.7 },
  naBox: { backgroundColor: '#1e293b', borderRadius: 8, padding: 12, borderLeft: `3px solid ${C.slate}`, marginBottom: 14 },
  naHead: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: '#e2e8f0', marginBottom: 3 },
  naText: { fontSize: 9, color: '#cbd5e1', lineHeight: 1.6 },

  // Pillar bars
  pillarRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 10 },
  pillarName: { width: 150, fontSize: 9, color: C.text },
  pillarBarBg: { flex: 1, height: 8, backgroundColor: C.bgLight, borderRadius: 4 },
  pillarScore: { width: 28, fontSize: 9, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  pillarRationale: { fontSize: 8, color: C.textDim, marginLeft: 160, marginBottom: 4, lineHeight: 1.5 },

  // Cards
  card: { backgroundColor: C.bgCard, borderRadius: 8, padding: 12, marginBottom: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  pill: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  cardTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.white, flex: 1 },
  cardBody: { fontSize: 8.5, color: C.textMuted, lineHeight: 1.6 },
  cardImpact: { fontSize: 8, color: C.success, marginTop: 4 },
  cardAffected: { fontSize: 7.5, color: C.textDim, marginTop: 4 },
  effort: { fontSize: 7.5, color: C.textDim },

  // Action rows (recommendations)
  actionRow: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottom: `1px solid ${C.border}` },
  actionNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.accentDim, justifyContent: 'center', alignItems: 'center' },
  actionNumText: { fontSize: 9, color: C.white, fontFamily: 'Helvetica-Bold' },

  // Bullets
  bullet: { flexDirection: 'row', marginBottom: 4, gap: 6 },
  bulletDot: { fontSize: 9, color: C.accent },
  bulletText: { fontSize: 9, color: C.textMuted, flex: 1, lineHeight: 1.6 },

  // Footer
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footText: { fontSize: 7.5, color: C.textDim },
})

// ── Brand mark (Azure swirl tile) ─────────────────────────────────────────────
function LogoIcon({ size = 44 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Defs>
        <LinearGradient id="aiqGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#2c9cf0" />
          <Stop offset="1" stopColor="#1668c5" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="40" height="40" rx="9" fill="url(#aiqGrad)" />
      {/* Ascending bars (brand mark) */}
      <Rect x="9"    y="22" width="5" height="9"  rx="1.5" fill="#bcd9f5" />
      <Rect x="17.5" y="18" width="5" height="13" rx="1.5" fill="#dcecfb" />
      <Rect x="26"   y="13" width="5" height="18" rx="1.5" fill="#ffffff" />
      {/* Growth trend line + node */}
      <Path d="M10 19 L28 9" stroke="#36e0e6" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <Circle cx="28.5" cy="9" r="2.6" fill="#0b2a4a" stroke="#36e0e6" strokeWidth="1.4" />
    </Svg>
  )
}

// ── Score ring (Svg rings + overlaid number; N/A renders a neutral ring) ───────
function ScoreRing({ score, size = 96 }) {
  const na = score == null
  const r = (size - 12) / 2
  const circ = 2 * Math.PI * r
  const pct = na ? 0 : Math.max(0, Math.min(100, score))
  const off = circ * (1 - pct / 100)
  const col = scoreColor(na ? null : score)
  return (
    <View style={{ width: size, height: size, position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', top: 0, left: 0 }}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.bgLight} strokeWidth={9} />
        {!na && (
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={9}
            strokeDasharray={String(circ)} strokeDashoffset={String(off)} strokeLinecap="round"
            transform={`rotate(-90, ${size / 2}, ${size / 2})`} />
        )}
      </Svg>
      {na ? (
        <Text style={{ fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.textMuted }}>N/A</Text>
      ) : (
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 26, fontFamily: 'Helvetica-Bold', color: col }}>{Math.round(pct)}</Text>
          <Text style={{ fontSize: 8, color: C.textDim, marginTop: -2 }}>/ 100</Text>
        </View>
      )}
    </View>
  )
}

function PageFooter({ project, cat }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footText}>Azure Infra IQ — Confidential   ·   {asText(project?.name) || 'Project'}   ·   {cat}</Text>
      <Text style={s.footText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

const MetaRow = ({ l, v }) => (
  <View style={s.metaRow}><Text style={s.metaLabel}>{l}</Text><Text style={s.metaValue}>{v}</Text></View>
)

function CoverPage({ result, project, cat, score, na }) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.cover}>
        <View style={s.coverLogo}>
          <LogoIcon size={52} />
          <View style={s.coverWord}>
            <Text style={s.coverEyebrow}>MICROSOFT AZURE</Text>
            <Text style={s.coverBrand}>Azure Infra IQ</Text>
            <Text style={s.coverTagline}>AI-Powered Insights</Text>
          </View>
        </View>

        <View style={s.coverCenter}>
          <Text style={s.catEyebrow}>Project Assessment</Text>
          <Text style={s.coverTitle}>{cat}{'\n'}Assessment</Text>
          <Text style={s.coverSubtitle}>{asText(project?.name) || 'Project'}{project?.description ? `  ·  ${asText(project.description)}` : ''}</Text>

          <View style={s.scoreWrap}>
            <ScoreRing score={na ? null : score} />
            <View>
              <Text style={[s.scoreLabelBig, { color: scoreColor(na ? null : score) }]}>{asText(result.score_label) || (na ? 'Not Applicable' : '—')}</Text>
              <Text style={s.scoreLabelSub}>{na ? 'This category does not directly apply to the in-scope resource type(s).' : 'Overall assessment score, weighted across the applicable pillars.'}</Text>
            </View>
          </View>

          <View style={s.meta}>
            <MetaRow l="Project" v={asText(project?.name) || 'Project'} />
            <MetaRow l="Category" v={cat} />
            <MetaRow l="Generated" v={fmtDate(result.generated_at)} />
            <MetaRow l="Resources analyzed" v={String(result.resource_count ?? 0)} />
            {typeof result.tag_coverage_pct === 'number' ? <MetaRow l="Tag coverage" v={`${result.tag_coverage_pct}%`} /> : null}
            {result.model ? <MetaRow l="AI model" v={asText(result.model)} /> : null}
            {na ? <MetaRow l="Applicability" v="Not applicable to resource type(s)" /> : null}
          </View>
        </View>

        <Text style={s.coverFoot}>Generated by Azure Infra IQ. Grounded only on this project's resources and their tags. Review recommendations before acting.</Text>
      </View>
      <PageFooter project={project} cat={cat} />
    </Page>
  )
}

function BodyPage({ result, project, cat, score, na, pillars, findings, recs, insights, risks }) {
  return (
    <Page size="A4" style={s.page} wrap>
      <View style={s.inner}>
        {/* Executive Summary */}
        <View style={s.sectionHeader}><Text style={s.sectionTitle}>Executive Summary</Text></View>
        {na && (
          <View style={s.naBox}>
            <Text style={s.naHead}>Not applicable to this resource type</Text>
            <Text style={s.naText}>{asText(result.applicability_note) || 'The selected assessment category does not directly apply to the resource type(s) in this project. The recommendations below are type-appropriate alternatives — this is not a failing score.'}</Text>
          </View>
        )}
        <View style={s.narrative}><Text style={s.narrativeText}>{asText(result.executive_summary) || 'No summary returned.'}</Text></View>

        {/* Score breakdown KPIs */}
        <View style={s.kpiGrid}>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>Overall Score</Text>
            <Text style={[s.kpiValue, { color: scoreColor(na ? null : score) }]}>{na ? 'N/A' : score}</Text>
            <Text style={s.kpiSub}>{asText(result.score_label) || ''}</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>Resources Analyzed</Text>
            <Text style={s.kpiValue}>{result.resource_count ?? 0}</Text>
            <Text style={s.kpiSub}>{typeof result.tag_coverage_pct === 'number' ? `${result.tag_coverage_pct}% tagged` : 'in this project'}</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>Findings</Text>
            <Text style={s.kpiValue}>{findings.length}</Text>
            <Text style={s.kpiSub}>{recs.length} recommendation{recs.length !== 1 ? 's' : ''}</Text>
          </View>
        </View>

        {/* Pillar scores */}
        {pillars.length > 0 && (
          <View>
            <View style={s.sectionHeader}><Text style={s.sectionTitle}>Pillar Scores</Text></View>
            {pillars.map((p, i) => {
              const ps = typeof p.score === 'number' ? p.score : 0
              return (
                <View key={i} wrap={false}>
                  <View style={s.pillarRow}>
                    <Text style={s.pillarName}>{asText(p.name)}</Text>
                    <View style={s.pillarBarBg}>
                      <View style={{ height: 8, borderRadius: 4, width: `${Math.max(2, Math.min(100, ps))}%`, backgroundColor: scoreColor(ps) }} />
                    </View>
                    <Text style={[s.pillarScore, { color: scoreColor(ps) }]}>{ps}</Text>
                  </View>
                  {p.rationale ? <Text style={s.pillarRationale}>{asText(p.rationale)}</Text> : null}
                </View>
              )
            })}
          </View>
        )}

        {/* Tag-driven insights */}
        {insights.length > 0 && (
          <View>
            <View style={[s.sectionHeader, { marginTop: 18 }]}><Text style={s.sectionTitle}>Tag-Driven Insights</Text></View>
            {insights.map((x, i) => (
              <View key={i} style={s.bullet}><Text style={s.bulletDot}>•</Text><Text style={s.bulletText}>{asText(x)}</Text></View>
            ))}
          </View>
        )}

        {/* Findings */}
        {findings.length > 0 && (
          <View>
            <View style={[s.sectionHeader, { marginTop: 18 }]}>
              <Text style={s.sectionTitle}>Findings</Text>
              <View style={s.sectionBadge}><Text style={s.sectionBadgeText}>{findings.length}</Text></View>
            </View>
            {findings.map((f, i) => (
              <View key={i} style={s.card} wrap={false}>
                <View style={s.cardHead}>
                  <Text style={[s.pill, { color: sevColor(f.severity), backgroundColor: sevPillBg(f.severity) }]}>{(asText(f.severity) || 'finding').toUpperCase()}</Text>
                  <Text style={s.cardTitle}>{asText(f.title)}</Text>
                </View>
                {f.detail ? <Text style={s.cardBody}>{asText(f.detail)}</Text> : null}
                {affectedText(f) ? <Text style={s.cardAffected}>Affected: {affectedText(f)}</Text> : null}
              </View>
            ))}
          </View>
        )}

        {/* Recommendations */}
        {recs.length > 0 && (
          <View>
            <View style={[s.sectionHeader, { marginTop: 18 }]}>
              <Text style={s.sectionTitle}>Recommendations</Text>
              <View style={s.sectionBadge}><Text style={s.sectionBadgeText}>{recs.length}</Text></View>
            </View>
            {recs.map((r, i) => (
              <View key={i} style={s.actionRow} wrap={false}>
                <View style={s.actionNum}><Text style={s.actionNumText}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <View style={s.cardHead}>
                    <Text style={[s.pill, { color: C.white, backgroundColor: C.accentDim }]}>{asText(r.priority) || 'P3'}</Text>
                    <Text style={s.cardTitle}>{asText(r.action)}</Text>
                    {r.effort ? <Text style={s.effort}>Effort: {asText(r.effort)}</Text> : null}
                  </View>
                  {r.rationale ? <Text style={s.cardBody}>{asText(r.rationale)}</Text> : null}
                  {r.business_impact ? <Text style={s.cardImpact}>Business impact: {asText(r.business_impact)}</Text> : null}
                  {affectedText(r) ? <Text style={s.cardAffected}>Affected: {affectedText(r)}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Key risks */}
        {risks.length > 0 && (
          <View>
            <View style={[s.sectionHeader, { marginTop: 18 }]}><Text style={s.sectionTitle}>Key Risks & Data Gaps</Text></View>
            {risks.map((x, i) => (
              <View key={i} style={s.bullet}><Text style={s.bulletDot}>•</Text><Text style={s.bulletText}>{asText(x)}</Text></View>
            ))}
          </View>
        )}
      </View>
      <PageFooter project={project} cat={cat} />
    </Page>
  )
}

// ── Resources Analyzed (full project inventory table, landscape page) ─────────
const money = (v) => {
  const n = Number(v)
  if (v == null || !isFinite(n)) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const shortType = (t) => { const x = asText(t); return x.split('/').slice(-1)[0] || x || '—' }
const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : '—')
function compactTags(r) {
  const ct = r && r.custom_tags && typeof r.custom_tags === 'object' ? r.custom_tags : null
  const tg = r && r.tags && typeof r.tags === 'object' ? r.tags : null
  const src = ct && Object.keys(ct).length ? ct : tg
  if (!src) return '—'
  const parts = Object.entries(src)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${asText(v)}`)
  if (!parts.length) return '—'
  const str = parts.join('  ·  ')
  return str.length > 110 ? str.slice(0, 108) + '…' : str
}

// Column widths sum to ~750pt (landscape A4 usable ≈ 762pt after 40pt side padding).
const RES_COLS = [
  { k: 'num',   label: '#',              w: 20,  align: 'center' },
  { k: 'name',  label: 'Resource',       w: 104 },
  { k: 'type',  label: 'Type',           w: 78 },
  { k: 'rg',    label: 'Resource Group',  w: 90 },
  { k: 'loc',   label: 'Location',        w: 52 },
  { k: 'sku',   label: 'SKU',            w: 60 },
  { k: 'cost',  label: 'Cost/mo',        w: 52,  align: 'right' },
  { k: 'save',  label: 'Saving/mo',      w: 54,  align: 'right' },
  { k: 'power', label: 'Power',          w: 48 },
  { k: 'bkp',   label: 'Backup',         w: 38,  align: 'center' },
  { k: 'score', label: 'Score',          w: 34,  align: 'right' },
  { k: 'tags',  label: 'Key Tags',       w: 150 },
]

const rs = StyleSheet.create({
  pageLand: { backgroundColor: C.bg, color: C.text, fontFamily: 'Helvetica', paddingBottom: 46, paddingHorizontal: 40, paddingTop: 40 },
  intro:    { fontSize: 8, color: C.textDim, marginBottom: 8, lineHeight: 1.5 },
  thead:    { flexDirection: 'row', backgroundColor: C.accentDim },
  th:       { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.white, paddingVertical: 5, paddingHorizontal: 3 },
  tr:       { flexDirection: 'row', borderBottom: `1px solid ${C.border}` },
  trAlt:    { backgroundColor: '#16233b' },
  td:       { fontSize: 6.8, color: C.textMuted, paddingVertical: 4, paddingHorizontal: 3 },
})

function ResourcesPage({ resources, project, cat }) {
  const list = Array.isArray(resources) ? resources : []
  if (!list.length) return null
  return (
    <Page size="A4" orientation="landscape" style={rs.pageLand} wrap>
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Resources Analyzed</Text>
        <View style={s.sectionBadge}><Text style={s.sectionBadgeText}>{list.length}</Text></View>
      </View>
      <Text style={rs.intro}>Every resource included in this project's {cat} assessment, with its key configuration, cost and protection properties. Cost/mo is month-to-date spend; Saving/mo is the estimated optimisation opportunity.</Text>
      <View style={rs.thead} fixed>
        {RES_COLS.map(c => (
          <Text key={c.k} style={[rs.th, { width: c.w, textAlign: c.align || 'left' }]}>{c.label}</Text>
        ))}
      </View>
      {list.map((r, i) => {
        const cells = {
          num:   String(i + 1),
          name:  asText(r.resource_name || r.name) || '—',
          type:  shortType(r.resource_type || r.type),
          rg:    asText(r.resource_group) || '—',
          loc:   asText(r.location) || '—',
          sku:   asText(r.sku) || '—',
          cost:  money(r.cost_current_month),
          save:  money(r.estimated_monthly_savings),
          power: asText(r.power_state) || '—',
          bkp:   yesNo(r.has_backup),
          score: r.final_score != null ? String(Math.round(r.final_score)) : '—',
          tags:  compactTags(r),
        }
        return (
          <View key={i} style={i % 2 ? [rs.tr, rs.trAlt] : rs.tr} wrap={false}>
            {RES_COLS.map(c => (
              <Text key={c.k} style={[rs.td, { width: c.w, textAlign: c.align || 'left' }]}>{cells[c.k]}</Text>
            ))}
          </View>
        )
      })}
      <PageFooter project={project} cat={cat} />
    </Page>
  )
}

function AssessmentPDFDoc({ result, project, resources }) {
  const na = result.overall_score == null || result.applicability === 'not_applicable' || result.score_label === 'Not Applicable'
  const score = Math.round(result.overall_score ?? 0)
  const cat = asText(result.category_label || result.category) || 'Assessment'
  const pillars = Array.isArray(result.pillar_scores) ? result.pillar_scores : []
  const findings = Array.isArray(result.findings) ? result.findings : []
  const recs = Array.isArray(result.recommendations) ? result.recommendations : []
  const insights = Array.isArray(result.tag_driven_insights) ? result.tag_driven_insights : []
  const risks = Array.isArray(result.key_risks) ? result.key_risks : []

  return (
    <Document title={`${cat} Assessment — ${asText(project?.name) || 'Project'}`} author="Azure Infra IQ">
      <CoverPage result={result} project={project} cat={cat} score={score} na={na} />
      <BodyPage result={result} project={project} cat={cat} score={score} na={na}
        pillars={pillars} findings={findings} recs={recs} insights={insights} risks={risks} />
      <ResourcesPage resources={resources} project={project} cat={cat} />
    </Document>
  )
}

export async function generateAssessmentPDF(result, project, resources) {
  return await pdf(<AssessmentPDFDoc result={result} project={project} resources={resources} />).toBlob()
}
