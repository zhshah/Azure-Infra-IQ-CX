/**
 * BCDR Planning & Assessment — enterprise, board-ready PDF export.
 *
 * Brand-matched to the project assessment PDF (assessmentExport.jsx): dark theme, cover page
 * with brand logo + resilience-score ring, then the four consultant sections (Critical Services
 * Identification, BCDR & Workload Prioritization, Infrastructure Modernization, FinOps & Cost
 * Visibility), a phased roadmap, key risks/assumptions, and a full resource inventory.
 *
 * Lazy-loaded from ProjectWorkspace so the heavy PDF engine stays out of the main bundle.
 */
import React from 'react'
import { pdf, Document, Page, Text, View, StyleSheet, Svg, Circle } from '@react-pdf/renderer'
import { BrandMark } from './pdfBrand'

const C = {
  bg: '#0f172a', bgCard: '#1e293b', bgLight: '#334155',
  accent: '#3b82f6', accentDim: '#1d4ed8',
  success: '#22c55e', warn: '#f59e0b', danger: '#ef4444',
  text: '#f1f5f9', textMuted: '#94a3b8', textDim: '#64748b',
  border: '#334155', white: '#ffffff', slate: '#64748b',
}

const fmtDate = (v) => { try { return new Date(v || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) } catch { return '' } }

function asText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    if (v.resource_name || v.name) return asText(v.resource_name || v.name)
    if (v.action || v.text) return asText(v.action || v.text)
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

const scoreColor = (sc) => (sc == null ? C.slate : sc >= 85 ? C.success : sc >= 70 ? '#84cc16' : sc >= 50 ? C.warn : sc >= 30 ? '#f97316' : C.danger)
const sevColor   = (sv) => ({ critical: C.danger, high: '#f97316', medium: C.warn, low: '#84cc16', info: C.accent }[String(sv || '').toLowerCase()] || C.slate)
const sevPillBg  = (sv) => ({ critical: '#450a0a', high: '#431407', medium: '#422006', low: '#052e16', info: '#0c2a4d' }[String(sv || '').toLowerCase()] || '#1e293b')
const prioColor  = (p) => ({ P1: C.danger, P2: C.warn, P3: C.accent }[String(p || '').toUpperCase()] || C.slate)

function affectedText(it) {
  const a = it?.affected_resources || it?.resources || []
  const names = a.map(x => (x && (x.resource_name || x.name)) || (typeof x === 'string' ? x : '')).filter(Boolean)
  let str = names.slice(0, 6).join(', ')
  const c = it?.affected_count
  if (typeof c === 'number' && c > names.length) str += ` (+${c - names.length} more)`
  return str
}

const s = StyleSheet.create({
  page: { backgroundColor: C.bg, color: C.text, fontFamily: 'Helvetica', paddingBottom: 46 },
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
  metaLabel: { fontSize: 9, color: C.textDim, width: 130 },
  metaValue: { fontSize: 9, color: C.text, flex: 1 },
  coverFoot: { fontSize: 8, color: C.textDim },

  inner: { paddingHorizontal: 40, paddingTop: 40 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, paddingBottom: 9, borderBottom: `2px solid ${C.accent}` },
  sectionEyebrow: { fontSize: 7.5, color: C.accent, letterSpacing: 1.5, fontFamily: 'Helvetica-Bold', marginBottom: 3, textTransform: 'uppercase' },
  sectionTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.white },
  sectionBadge: { marginLeft: 10, backgroundColor: C.accentDim, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  sectionBadgeText: { fontSize: 8, color: C.white, fontFamily: 'Helvetica-Bold' },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  kpiCard: { width: '30%', backgroundColor: C.bgCard, borderRadius: 8, padding: 14, borderTop: `2px solid ${C.accent}` },
  kpiLabel: { fontSize: 8, color: C.textDim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.white },
  kpiSub: { fontSize: 8, color: C.textMuted, marginTop: 3 },

  narrative: { backgroundColor: C.bgCard, borderRadius: 8, padding: 16, borderLeft: `3px solid ${C.accent}`, marginBottom: 14 },
  narrativeText: { fontSize: 9.5, color: C.textMuted, lineHeight: 1.7 },
  subnote: { fontSize: 9, color: C.textMuted, lineHeight: 1.6, marginBottom: 10 },

  pillarRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 10 },
  pillarName: { width: 170, fontSize: 9, color: C.text },
  pillarBarBg: { flex: 1, height: 8, backgroundColor: C.bgLight, borderRadius: 4 },
  pillarScore: { width: 28, fontSize: 9, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  pillarRationale: { fontSize: 8, color: C.textDim, marginLeft: 180, marginBottom: 4, lineHeight: 1.5 },

  card: { backgroundColor: C.bgCard, borderRadius: 8, padding: 12, marginBottom: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' },
  pill: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  cardTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.white, flex: 1 },
  cardBody: { fontSize: 8.5, color: C.textMuted, lineHeight: 1.6 },
  cardMeta: { fontSize: 8, color: C.textDim, marginTop: 4 },
  cardImpact: { fontSize: 8, color: C.success, marginTop: 4 },
  cardAffected: { fontSize: 7.5, color: C.textDim, marginTop: 4 },

  // RTO/RPO grid inside workload cards
  rrGrid: { flexDirection: 'row', gap: 8, marginTop: 5, marginBottom: 4 },
  rrBox: { backgroundColor: C.bg, borderRadius: 5, padding: 6, flex: 1 },
  rrLabel: { fontSize: 6.5, color: C.textDim, textTransform: 'uppercase', letterSpacing: 0.3 },
  rrValue: { fontSize: 8.5, color: C.text, fontFamily: 'Helvetica-Bold', marginTop: 1 },

  bullet: { flexDirection: 'row', marginBottom: 4, gap: 6 },
  bulletDot: { fontSize: 9, color: C.accent },
  bulletText: { fontSize: 9, color: C.textMuted, flex: 1, lineHeight: 1.6 },

  tierChip: { fontSize: 7.5, color: C.text, backgroundColor: C.bgLight, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2, marginRight: 4, marginBottom: 4 },

  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footText: { fontSize: 7.5, color: C.textDim },
})

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
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 26, fontFamily: 'Helvetica-Bold', color: col }}>{na ? '—' : Math.round(pct)}</Text>
        <Text style={{ fontSize: 8, color: C.textDim, marginTop: -2 }}>/ 100</Text>
      </View>
    </View>
  )
}

function PageFooter({ project }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footText}>Azure Infra IQ — Confidential   ·   {asText(project?.name) || 'Project'}   ·   BCDR Planning & Assessment</Text>
      <Text style={s.footText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

const MetaRow = ({ l, v }) => (v == null || v === '' ? null : (
  <View style={s.metaRow}><Text style={s.metaLabel}>{l}</Text><Text style={s.metaValue}>{asText(v)}</Text></View>
))

const SectionHead = ({ eyebrow, title, count }) => (
  <View style={{ marginTop: 4 }}>
    {eyebrow ? <Text style={s.sectionEyebrow}>{eyebrow}</Text> : null}
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{title}</Text>
      {typeof count === 'number' ? <View style={s.sectionBadge}><Text style={s.sectionBadgeText}>{count}</Text></View> : null}
    </View>
  </View>
)

function CoverPage({ result, project, inputs }) {
  const score = result.overall_resilience_score ?? result.overall_score ?? null
  return (
    <Page size="A4" style={s.page}>
      <View style={s.cover}>
        <View style={s.coverLogo}>
          <BrandMark size={52} />
          <View style={s.coverWord}>
            <Text style={s.coverEyebrow}>MICROSOFT AZURE</Text>
            <Text style={s.coverBrand}>Azure Infra IQ</Text>
            <Text style={s.coverTagline}>AI-Powered Insights</Text>
          </View>
        </View>
        <View style={s.coverCenter}>
          <Text style={s.catEyebrow}>Consultant Deliverable</Text>
          <Text style={s.coverTitle}>BCDR Planning{'\n'}& Assessment</Text>
          <Text style={s.coverSubtitle}>{asText(project?.name) || 'Project'}{project?.description ? `  ·  ${asText(project.description)}` : ''}</Text>
          <View style={s.scoreWrap}>
            <ScoreRing score={score} />
            <View>
              <Text style={[s.scoreLabelBig, { color: scoreColor(score) }]}>{asText(result.posture_label) || asText(result.score_label) || '—'}</Text>
              <Text style={s.scoreLabelSub}>Resilience posture, weighted across recovery readiness, geo-redundancy, backup coverage and DR testing.</Text>
            </View>
          </View>
          <View style={s.meta}>
            <MetaRow l="Project / Workload" v={asText(project?.name) || 'Project'} />
            <MetaRow l="Generated" v={fmtDate(result.generated_at)} />
            <MetaRow l="Resources analyzed" v={String(result.resource_count ?? 0)} />
            <MetaRow l="Data classification" v={inputs.data_classification || project?.data_classification} />
            {result.dependency_summary?.edge_count ? <MetaRow l="Dependencies mapped" v={`${result.dependency_summary.edge_count}  ·  ${result.dependency_summary.spof_count || 0} SPOF`} /> : null}
            <MetaRow l="Compliance" v={inputs.compliance} />
            <MetaRow l="Target RTO / RPO" v={[inputs.default_rto || project?.rto_target, inputs.default_rpo || project?.rpo_target].filter(Boolean).join('  /  ')} />
            <MetaRow l="Preferred DR strategy" v={inputs.dr_strategy || project?.dr_tier} />
            {result.model ? <MetaRow l="AI model" v={asText(result.model)} /> : null}
          </View>
        </View>
        <Text style={s.coverFoot}>Generated by Azure Infra IQ. Grounded only on this project's resources, their tags and the customer's stated continuity requirements. Review recommendations before acting.</Text>
      </View>
      <PageFooter project={project} />
    </Page>
  )
}

function ExecPage({ result, project }) {
  const score = result.overall_resilience_score ?? result.overall_score ?? null
  const pillars = Array.isArray(result.pillar_scores) ? result.pillar_scores : []
  const cs = result.critical_services || {}
  const gaps = Array.isArray(cs.bcdr_gaps) ? cs.bcdr_gaps : []
  const wl = (result.workload_prioritization || {}).workloads || []
  return (
    <Page size="A4" style={s.page} wrap>
      <View style={s.inner}>
        <SectionHead title="Executive Summary" />
        <View style={s.narrative}><Text style={s.narrativeText}>{asText(result.executive_summary) || 'No summary returned.'}</Text></View>
        {result.maturity_summary ? (
          <View style={[s.narrative, { borderLeft: `3px solid ${C.slate}` }]}><Text style={s.narrativeText}>{asText(result.maturity_summary)}</Text></View>
        ) : null}
        <View style={s.kpiGrid}>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>Resilience Score</Text>
            <Text style={[s.kpiValue, { color: scoreColor(score) }]}>{score == null ? '—' : score}</Text>
            <Text style={s.kpiSub}>{asText(result.posture_label) || asText(result.score_label) || ''}</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>Resources Analyzed</Text>
            <Text style={s.kpiValue}>{result.resource_count ?? 0}</Text>
            <Text style={s.kpiSub}>{typeof result.tag_coverage_pct === 'number' ? `${result.tag_coverage_pct}% tagged` : 'in this project'}</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>BCDR Gaps</Text>
            <Text style={[s.kpiValue, { color: gaps.length ? C.warn : C.success }]}>{gaps.length}</Text>
            <Text style={s.kpiSub}>{wl.length} workload{wl.length !== 1 ? 's' : ''} prioritized</Text>
          </View>
        </View>
        {pillars.length > 0 && (
          <View>
            <SectionHead title="Resilience Pillars" />
            {pillars.map((p, i) => {
              const ps = typeof p.score === 'number' ? p.score : 0
              return (
                <View key={i} wrap={false}>
                  <View style={s.pillarRow}>
                    <Text style={s.pillarName}>{asText(p.name)}</Text>
                    <View style={s.pillarBarBg}><View style={{ height: 8, borderRadius: 4, width: `${Math.max(2, Math.min(100, ps))}%`, backgroundColor: scoreColor(ps) }} /></View>
                    <Text style={[s.pillarScore, { color: scoreColor(ps) }]}>{ps}</Text>
                  </View>
                  {p.rationale ? <Text style={s.pillarRationale}>{asText(p.rationale)}</Text> : null}
                </View>
              )
            })}
          </View>
        )}
      </View>
      <PageFooter project={project} />
    </Page>
  )
}

function CriticalServicesPage({ result, project }) {
  const cs = result.critical_services || {}
  const tiers = Array.isArray(cs.tiers) ? cs.tiers : []
  const deps = Array.isArray(cs.key_dependencies) ? cs.key_dependencies : []
  const gaps = Array.isArray(cs.bcdr_gaps) ? cs.bcdr_gaps : []
  return (
    <Page size="A4" style={s.page} wrap>
      <View style={s.inner}>
        <SectionHead eyebrow="Section 1" title="Critical Services Identification" />
        {cs.summary ? <Text style={s.subnote}>{asText(cs.summary)}</Text> : null}

        {tiers.length > 0 && (
          <View style={{ marginBottom: 6 }}>
            {tiers.map((t, i) => (
              <View key={i} style={s.card} wrap={false}>
                <View style={s.cardHead}>
                  <Text style={[s.pill, { color: C.white, backgroundColor: C.accentDim }]}>{(asText(t.tier) || 'Tier').toUpperCase()}</Text>
                  <Text style={s.cardTitle}>{asText(t.tier)} ({t.count ?? (t.resources || []).length})</Text>
                </View>
                {t.rationale ? <Text style={s.cardBody}>{asText(t.rationale)}</Text> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 }}>
                  {(t.resources || []).slice(0, 14).map((r, j) => (
                    <Text key={j} style={s.tierChip}>{asText(r.resource_name || r.name || r)}</Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {deps.length > 0 && (
          <View>
            <SectionHead title="Key Dependencies" count={deps.length} />
            {deps.map((d, i) => (
              <View key={i} style={s.card} wrap={false}>
                <View style={s.cardHead}>
                  <Text style={[s.pill, { color: C.accent, backgroundColor: '#0c2a4d' }]}>{(asText(d.type) || 'dep').toUpperCase()}</Text>
                  <Text style={s.cardTitle}>{asText(d.from)} → {asText(d.to)}</Text>
                </View>
                {d.risk ? <Text style={s.cardBody}>{asText(d.risk)}</Text> : null}
              </View>
            ))}
          </View>
        )}

        {gaps.length > 0 && (
          <View>
            <SectionHead title="BCDR Gaps" count={gaps.length} />
            {gaps.map((g, i) => (
              <View key={i} style={s.card} wrap={false}>
                <View style={s.cardHead}>
                  <Text style={[s.pill, { color: sevColor(g.severity), backgroundColor: sevPillBg(g.severity) }]}>{(asText(g.severity) || 'gap').toUpperCase()}</Text>
                  <Text style={s.cardTitle}>{asText(g.title)}</Text>
                </View>
                {g.detail ? <Text style={s.cardBody}>{asText(g.detail)}</Text> : null}
                {affectedText(g) ? <Text style={s.cardAffected}>Affected: {affectedText(g)}</Text> : null}
              </View>
            ))}
          </View>
        )}
      </View>
      <PageFooter project={project} />
    </Page>
  )
}

function PrioritizationPage({ result, project }) {
  const wp = result.workload_prioritization || {}
  const wl = Array.isArray(wp.workloads) ? wp.workloads : []
  return (
    <Page size="A4" style={s.page} wrap>
      <View style={s.inner}>
        <SectionHead eyebrow="Section 2" title="BCDR & Workload Prioritization" count={wl.length} />
        {wp.summary ? <Text style={s.subnote}>{asText(wp.summary)}</Text> : null}
        {wl.map((w, i) => (
          <View key={i} style={s.card} wrap={false}>
            <View style={s.cardHead}>
              <Text style={[s.pill, { color: C.white, backgroundColor: prioColor(w.priority) }]}>{asText(w.priority) || 'P3'}</Text>
              <Text style={s.cardTitle}>{asText(w.workload)}</Text>
              {w.criticality ? <Text style={s.cardMeta}>{asText(w.criticality)}</Text> : null}
            </View>
            <View style={s.rrGrid}>
              <View style={s.rrBox}><Text style={s.rrLabel}>Current RTO</Text><Text style={s.rrValue}>{asText(w.current_rto) || '—'}</Text></View>
              <View style={s.rrBox}><Text style={s.rrLabel}>Current RPO</Text><Text style={s.rrValue}>{asText(w.current_rpo) || '—'}</Text></View>
              <View style={s.rrBox}><Text style={s.rrLabel}>Target RTO</Text><Text style={s.rrValue}>{asText(w.target_rto) || '—'}</Text></View>
              <View style={s.rrBox}><Text style={s.rrLabel}>Target RPO</Text><Text style={s.rrValue}>{asText(w.target_rpo) || '—'}</Text></View>
            </View>
            {w.gap ? <Text style={s.cardBody}>Gap: {asText(w.gap)}</Text> : null}
            {w.recommended_dr_approach ? <Text style={[s.cardBody, { marginTop: 3, color: C.text }]}>Recommended: {asText(w.recommended_dr_approach)}</Text> : null}
            {affectedText(w) ? <Text style={s.cardAffected}>Resources: {affectedText(w)}</Text> : null}
          </View>
        ))}
      </View>
      <PageFooter project={project} />
    </Page>
  )
}

function ModernizationFinopsPage({ result, project }) {
  const mod = result.modernization || {}
  const cands = Array.isArray(mod.candidates) ? mod.candidates : []
  const fin = result.finops || {}
  const obs = Array.isArray(fin.cost_observations) ? fin.cost_observations : []
  const levers = Array.isArray(fin.optimization_levers) ? fin.optimization_levers : []
  const caps = Array.isArray(fin.reporting_capabilities) ? fin.reporting_capabilities : []
  return (
    <Page size="A4" style={s.page} wrap>
      <View style={s.inner}>
        <SectionHead eyebrow="Section 3" title="Infrastructure Modernization" count={cands.length} />
        {mod.summary ? <Text style={s.subnote}>{asText(mod.summary)}</Text> : null}
        {cands.map((c, i) => (
          <View key={i} style={s.card} wrap={false}>
            <View style={s.cardHead}>
              <Text style={[s.pill, { color: C.white, backgroundColor: C.accentDim }]}>{(asText(c.disposition) || '7R').toUpperCase()}</Text>
              <Text style={s.cardTitle}>{asText(c.workload)}</Text>
              {c.effort ? <Text style={s.cardMeta}>Effort: {asText(c.effort)}</Text> : null}
            </View>
            {c.current_state ? <Text style={s.cardBody}>Current: {asText(c.current_state)}</Text> : null}
            {c.target_architecture ? <Text style={[s.cardBody, { marginTop: 3, color: C.text }]}>Target: {asText(c.target_architecture)}</Text> : null}
            {c.benefit ? <Text style={s.cardImpact}>Benefit: {asText(c.benefit)}</Text> : null}
            {affectedText(c) ? <Text style={s.cardAffected}>Resources: {affectedText(c)}</Text> : null}
          </View>
        ))}

        <View style={{ marginTop: 14 }}>
          <SectionHead eyebrow="Section 4" title="FinOps & Cost Visibility" />
          {fin.summary ? <Text style={s.subnote}>{asText(fin.summary)}</Text> : null}
          {obs.length > 0 && obs.map((o, i) => (
            <View key={i} style={s.bullet}><Text style={s.bulletDot}>•</Text><Text style={s.bulletText}>{asText(o)}</Text></View>
          ))}
          {levers.length > 0 && (
            <View style={{ marginTop: 8 }}>
              {levers.map((lv, i) => (
                <View key={i} style={s.card} wrap={false}>
                  <View style={s.cardHead}>
                    <Text style={[s.pill, { color: C.success, backgroundColor: '#052e16' }]}>{asText(lv.lever) || 'LEVER'}</Text>
                    <Text style={s.cardTitle}>{asText(lv.action)}</Text>
                    {lv.est_monthly_saving ? <Text style={[s.cardMeta, { color: C.success }]}>{asText(lv.est_monthly_saving)}</Text> : null}
                  </View>
                  {affectedText(lv) ? <Text style={s.cardAffected}>Resources: {affectedText(lv)}</Text> : null}
                </View>
              ))}
            </View>
          )}
          {caps.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={[s.kpiLabel, { marginBottom: 4 }]}>Azure Infra IQ reporting capabilities</Text>
              {caps.map((cap, i) => (
                <View key={i} style={s.bullet}><Text style={s.bulletDot}>•</Text><Text style={s.bulletText}>{asText(cap)}</Text></View>
              ))}
            </View>
          )}
        </View>
      </View>
      <PageFooter project={project} />
    </Page>
  )
}

function RoadmapPage({ result, project }) {
  const roadmap = Array.isArray(result.roadmap) ? result.roadmap : []
  const risks = Array.isArray(result.key_risks) ? result.key_risks : []
  const assumptions = Array.isArray(result.assumptions) ? result.assumptions : []
  if (!roadmap.length && !risks.length && !assumptions.length) return null
  return (
    <Page size="A4" style={s.page} wrap>
      <View style={s.inner}>
        {roadmap.length > 0 && (
          <View>
            <SectionHead title="Remediation Roadmap" count={roadmap.length} />
            {roadmap.map((ph, i) => (
              <View key={i} style={s.card} wrap={false}>
                <View style={s.cardHead}>
                  <Text style={[s.pill, { color: C.white, backgroundColor: C.accentDim }]}>{asText(ph.workstream) || 'PHASE'}</Text>
                  <Text style={s.cardTitle}>{asText(ph.phase)}</Text>
                </View>
                {(ph.outcomes || []).map((o, j) => (
                  <View key={j} style={s.bullet}><Text style={s.bulletDot}>•</Text><Text style={s.bulletText}>{asText(o)}</Text></View>
                ))}
              </View>
            ))}
          </View>
        )}
        {risks.length > 0 && (
          <View style={{ marginTop: 14 }}>
            <SectionHead title="Key Risks & Data Gaps" count={risks.length} />
            {risks.map((rk, i) => (
              <View key={i} style={s.bullet}><Text style={[s.bulletDot, { color: C.warn }]}>⚠</Text><Text style={s.bulletText}>{asText(rk)}</Text></View>
            ))}
          </View>
        )}
        {assumptions.length > 0 && (
          <View style={{ marginTop: 14 }}>
            <SectionHead title="Assumptions" count={assumptions.length} />
            {assumptions.map((a, i) => (
              <View key={i} style={s.bullet}><Text style={s.bulletDot}>•</Text><Text style={s.bulletText}>{asText(a)}</Text></View>
            ))}
          </View>
        )}
      </View>
      <PageFooter project={project} />
    </Page>
  )
}

// ── Resources Analyzed (landscape inventory) ──────────────────────────────────
const money = (v) => { const n = Number(v); if (v == null || !isFinite(n)) return '—'; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
const shortType = (t) => { const x = asText(t); return x.split('/').slice(-1)[0] || x || '—' }
const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : '—')
function compactTags(r) {
  const ct = r && r.custom_tags && typeof r.custom_tags === 'object' ? r.custom_tags : null
  const tg = r && r.tags && typeof r.tags === 'object' ? r.tags : null
  const src = ct && Object.keys(ct).length ? ct : tg
  if (!src) return '—'
  const parts = Object.entries(src).filter(([, v]) => v != null && String(v).trim() !== '').map(([k, v]) => `${k}: ${asText(v)}`)
  if (!parts.length) return '—'
  const str = parts.join('  ·  ')
  return str.length > 110 ? str.slice(0, 108) + '…' : str
}
const RES_COLS = [
  { k: 'num', label: '#', w: 20, align: 'center' },
  { k: 'name', label: 'Resource', w: 110 },
  { k: 'type', label: 'Type', w: 84 },
  { k: 'rg', label: 'Resource Group', w: 92 },
  { k: 'loc', label: 'Location', w: 54 },
  { k: 'cost', label: 'Cost/mo', w: 54, align: 'right' },
  { k: 'bkp', label: 'Backup', w: 40, align: 'center' },
  { k: 'zone', label: 'Zone', w: 60 },
  { k: 'pe', label: 'Priv EP', w: 42, align: 'center' },
  { k: 'tags', label: 'Business Tags', w: 158 },
]
const rs = StyleSheet.create({
  pageLand: { backgroundColor: C.bg, color: C.text, fontFamily: 'Helvetica', paddingBottom: 46, paddingHorizontal: 40, paddingTop: 40 },
  intro: { fontSize: 8, color: C.textDim, marginBottom: 8, lineHeight: 1.5 },
  thead: { flexDirection: 'row', backgroundColor: C.accentDim },
  th: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.white, paddingVertical: 5, paddingHorizontal: 3 },
  tr: { flexDirection: 'row', borderBottom: `1px solid ${C.border}` },
  trAlt: { backgroundColor: '#16233b' },
  td: { fontSize: 6.8, color: C.textMuted, paddingVertical: 4, paddingHorizontal: 3 },
})
function ResourcesPage({ resources, project }) {
  const list = Array.isArray(resources) ? resources : []
  if (!list.length) return null
  return (
    <Page size="A4" orientation="landscape" style={rs.pageLand} wrap>
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Resources Analyzed</Text>
        <View style={s.sectionBadge}><Text style={s.sectionBadgeText}>{list.length}</Text></View>
      </View>
      <Text style={rs.intro}>Every resource in scope for this BCDR plan, with its key protection and cost properties. Backup, Zone and Private Endpoint indicate current resilience posture.</Text>
      <View style={rs.thead} fixed>
        {RES_COLS.map(c => (<Text key={c.k} style={[rs.th, { width: c.w, textAlign: c.align || 'left' }]}>{c.label}</Text>))}
      </View>
      {list.map((r, i) => {
        const cells = {
          num: String(i + 1),
          name: asText(r.resource_name || r.name) || '—',
          type: shortType(r.resource_type || r.type),
          rg: asText(r.resource_group) || '—',
          loc: asText(r.location) || '—',
          cost: money(r.cost_current_month),
          bkp: yesNo(r.has_backup),
          zone: asText(r.zone_status) || '—',
          pe: yesNo(r.has_private_endpoint),
          tags: compactTags(r),
        }
        return (
          <View key={i} style={i % 2 ? [rs.tr, rs.trAlt] : rs.tr} wrap={false}>
            {RES_COLS.map(c => (<Text key={c.k} style={[rs.td, { width: c.w, textAlign: c.align || 'left' }]}>{cells[c.k]}</Text>))}
          </View>
        )
      })}
      <PageFooter project={project} />
    </Page>
  )
}

function BcdrPlanDoc({ result, project, resources }) {
  const inputs = result.inputs || {}
  return (
    <Document title={`BCDR Planning & Assessment — ${asText(project?.name) || 'Project'}`} author="Azure Infra IQ">
      <CoverPage result={result} project={project} inputs={inputs} />
      <ExecPage result={result} project={project} />
      <CriticalServicesPage result={result} project={project} />
      <PrioritizationPage result={result} project={project} />
      <ModernizationFinopsPage result={result} project={project} />
      <RoadmapPage result={result} project={project} />
      <ResourcesPage resources={resources} project={project} />
    </Document>
  )
}

export async function generateBcdrPlanPDF(result, project, resources) {
  return await pdf(<BcdrPlanDoc result={result} project={project} resources={resources} />).toBlob()
}
