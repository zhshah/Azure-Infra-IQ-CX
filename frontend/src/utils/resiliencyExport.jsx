/**
 * Resiliency Explorer — board-ready PDF export.
 *
 * Renders the SAME filtered posture the Resiliency Explorer shows on screen (KPIs,
 * availability-zone / backup / geo distributions, the customizable group-by breakdown,
 * the criticality × zone risk matrix and the top resiliency risks) into a dark,
 * brand-matched PDF — the same approach used for the BCDR consultant report export.
 * Lazy-loaded so the PDF engine stays out of the main bundle.
 */
import React from 'react'
import { pdf, Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer'
import { BrandMark } from './pdfBrand'

// Long unbreakable tokens (resource ids, types) overflow fixed table columns and crash
// PDFKit with "unsupported number: …e+21" — register break points so they always wrap.
Font.registerHyphenationCallback((word) => {
  if (typeof word !== 'string' || word.length <= 14) return [word]
  const parts = []
  for (let i = 0; i < word.length; i += 9) parts.push(word.slice(i, i + 9))
  return parts
})

// Dark navy palette — matches the dashboard / consultant PDF exports.
const C = {
  bg: '#0f172a', bgCard: '#1e293b', bgLight: '#334155',
  ink: '#f8fafc', body: '#cbd5e1', muted: '#94a3b8', faint: '#64748b',
  blue: '#3b82f6', blueDk: '#93c5fd', line: '#334155', white: '#ffffff',
  green: '#22c55e', amber: '#eab308', red: '#ef4444', orange: '#f97316',
}
const ZONE_COLORS = {
  ZoneRedundant: '#22c55e', Zonal: '#eab308', NotZoneAware: '#60a5fa',
  LocallyRedundant: '#ef4444', Unknown: '#6b7280',
}
const ZONE_ORDER = ['ZoneRedundant', 'Zonal', 'NotZoneAware', 'LocallyRedundant', 'Unknown']
const ZONE_LABEL = {
  ZoneRedundant: 'Zone-redundant', Zonal: 'Single-zone', NotZoneAware: 'Not zone-aware',
  LocallyRedundant: 'Locally redundant', Unknown: 'Unknown',
}
const CRIT_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Unclassified']
const CRIT_COLORS = { Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#22c55e', Unclassified: '#64748b' }

function pdfSafe(str) {
  if (typeof str !== 'string') return str
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-').replace(/\u2026/g, '...').replace(/\u2212/g, '-')
    .replace(/[\u2022\u25CF\u00B7]/g, '-').replace(/[\u2192\u21D2]/g, '->')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '')
}
const T = (v) => pdfSafe(v == null ? '' : String(v))
const scoreColor = (n) => (n == null ? C.muted : n >= 70 ? C.green : n >= 45 ? C.amber : C.red)
const money = (v) => { const n = Number(v); return (v == null || !isFinite(n)) ? '$0' : (n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : '$' + n.toFixed(0)) }

const s = StyleSheet.create({
  page: { backgroundColor: C.bg, color: C.body, fontFamily: 'Helvetica', fontSize: 9.5, paddingTop: 50, paddingBottom: 46, paddingHorizontal: 44, lineHeight: 1.5 },
  cover: { backgroundColor: C.bg, paddingTop: 80, paddingBottom: 48, paddingHorizontal: 54, flex: 1, justifyContent: 'space-between' },
  cTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cBrand: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.ink },
  cTagline: { fontSize: 8, color: C.faint },
  cBar: { height: 4, backgroundColor: C.blue, width: 90, marginTop: 26, marginBottom: 18 },
  cEyebrow: { fontSize: 10, color: C.blue, fontFamily: 'Helvetica-Bold', letterSpacing: 2 },
  cTitle: { fontSize: 28, fontFamily: 'Helvetica-Bold', color: C.ink, marginTop: 10, lineHeight: 1.15 },
  cSub: { fontSize: 12, color: C.muted, marginTop: 10 },
  cMeta: { marginTop: 26, backgroundColor: C.bgCard, borderRadius: 8, padding: 16, borderLeft: `3px solid ${C.blue}` },
  cRow: { flexDirection: 'row', paddingVertical: 3 },
  cKey: { width: 150, fontSize: 10, color: C.faint },
  cVal: { fontSize: 10, color: C.ink, fontFamily: 'Helvetica-Bold', flex: 1 },
  cFoot: { fontSize: 8, color: C.faint, borderTop: `1px solid ${C.line}`, paddingTop: 10 },
  confidential: { fontSize: 8, color: C.red, fontFamily: 'Helvetica-Bold' },
  h1: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.white, marginBottom: 4 },
  h1bar: { height: 2, backgroundColor: C.blue, marginBottom: 12 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.blueDk, marginTop: 14, marginBottom: 6 },
  // KPI grid
  kpiWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  kpi: { width: '31.6%', backgroundColor: C.bgCard, borderRadius: 6, padding: 10, borderLeft: `2px solid ${C.blue}` },
  kpiLabel: { fontSize: 8, color: C.muted, marginBottom: 3 },
  kpiVal: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: C.ink },
  kpiSub: { fontSize: 7.5, color: C.faint, marginTop: 2 },
  // bar rows
  barRow: { marginBottom: 6 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  barLabel: { fontSize: 9, color: C.body },
  barVal: { fontSize: 9, color: C.muted },
  barTrack: { height: 9, backgroundColor: '#0b1220', borderRadius: 3, flexDirection: 'row', overflow: 'hidden' },
  // tables
  table: { marginTop: 4, marginBottom: 8, borderTop: `1px solid ${C.line}` },
  tr: { flexDirection: 'row', borderBottom: `1px solid ${C.lineSoft || '#243044'}` },
  th: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.muted, paddingVertical: 4, paddingHorizontal: 3 },
  td: { fontSize: 8.5, color: C.body, paddingVertical: 3.5, paddingHorizontal: 3 },
  headRow: { backgroundColor: C.bgLight },
  chip: { fontSize: 7.5, fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 22, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', borderTop: `1px solid ${C.line}`, paddingTop: 6 },
  footTxt: { fontSize: 7.5, color: C.faint },
})

function Bar({ dist, colorMap }) {
  const entries = Object.entries(dist || {}).filter(([, v]) => v > 0)
  const total = entries.reduce((a, [, v]) => a + v, 0) || 1
  return (
    <View>
      {entries.sort((a, b) => b[1] - a[1]).map(([label, v]) => (
        <View key={label} style={s.barRow}>
          <View style={s.barHead}>
            <Text style={s.barLabel}>{T(ZONE_LABEL[label] || label)}</Text>
            <Text style={s.barVal}>{v}  ({Math.round((100 * v) / total)}%)</Text>
          </View>
          <View style={s.barTrack}>
            <View style={{ width: `${(100 * v) / total}%`, backgroundColor: (colorMap && colorMap[label]) || C.blue }} />
          </View>
        </View>
      ))}
      {!entries.length && <Text style={{ fontSize: 9, color: C.faint }}>No data.</Text>}
    </View>
  )
}

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footTxt}>Azure Infra IQ — Resiliency Explorer</Text>
      <Text style={s.footTxt} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      <Text style={s.footTxt}>Microsoft Confidential</Text>
    </View>
  )
}

export async function generateResiliencyPDF(payload) {
  const p = payload || {}
  const k = p.kpis || {}
  const scope = p.scope || {}
  const groups = (p.groups || []).slice(0, 12)
  const maxG = Math.max(1, ...groups.map((g) => g.total || 0))
  const atRisk = (p.at_risk || []).slice(0, 24)
  const matrix = p.risk_matrix || {}
  const cost = p.measure_label === 'Monthly cost ($)'

  const KPIS = [
    { label: 'Resiliency Score', val: `${k.score ?? '-'}`, sub: '/ 100', color: scoreColor(k.score) },
    { label: 'Resources in scope', val: `${k.total ?? 0}`, sub: 'filtered estate' },
    { label: 'Zone-redundant', val: `${k.zonePct ?? 0}%`, sub: `${k.zr ?? 0} resources` },
    { label: 'Backup coverage', val: `${k.backupPct ?? 0}%`, sub: `${k.backed ?? 0} protected` },
    { label: 'Geo-redundant', val: `${k.geoPct ?? 0}%`, sub: `${k.geo ?? 0} multi-region` },
    { label: 'Critical at risk', val: `${k.critAtRisk ?? 0}`, sub: 'Crit/High exposed' },
  ]

  const doc = (
    <Document title="Azure Resiliency Posture" author="Azure Infra IQ">
      {/* Cover */}
      <Page size="A4" style={s.cover}>
        <View>
          <View style={s.cTop}>
            <BrandMark size={34} />
            <View>
              <Text style={s.cBrand}>Azure Infra IQ</Text>
              <Text style={s.cTagline}>Discover · Govern · Manage your Azure estate</Text>
            </View>
          </View>
          <View style={s.cBar} />
          <Text style={s.cEyebrow}>BUSINESS CONTINUITY &amp; RESILIENCE</Text>
          <Text style={s.cTitle}>Azure Resiliency{'\n'}Posture Report</Text>
          <Text style={s.cSub}>Availability-zone, backup &amp; cross-region readiness for the selected scope</Text>
          <View style={s.cMeta}>
            <View style={s.cRow}><Text style={s.cKey}>Resiliency Score</Text><Text style={s.cVal}>{k.score ?? '-'} / 100</Text></View>
            <View style={s.cRow}><Text style={s.cKey}>Resources in scope</Text><Text style={s.cVal}>{k.total ?? 0}</Text></View>
            {Object.entries(scope).map(([key, val]) => (
              <View style={s.cRow} key={key}><Text style={s.cKey}>{T(key)}</Text><Text style={s.cVal}>{T(val)}</Text></View>
            ))}
            <View style={s.cRow}><Text style={s.cKey}>Generated</Text><Text style={s.cVal}>{T((p.generated_at || '').slice(0, 19).replace('T', ' '))} UTC</Text></View>
          </View>
        </View>
        <View style={s.cFoot}>
          <Text>Computed live from the Azure availability-zone redundancy assessment joined with backup, cost &amp; BCDR Planning classification — no sample data.</Text>
          <Text style={s.confidential}>MICROSOFT CONFIDENTIAL</Text>
        </View>
      </Page>

      {/* Posture */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Resiliency Posture</Text>
        <View style={s.h1bar} />

        <View style={s.kpiWrap}>
          {KPIS.map((x) => (
            <View style={s.kpi} key={x.label}>
              <Text style={s.kpiLabel}>{x.label}</Text>
              <Text style={[s.kpiVal, x.color ? { color: x.color } : {}]}>{x.val}</Text>
              <Text style={s.kpiSub}>{x.sub}</Text>
            </View>
          ))}
        </View>

        <Text style={s.h2}>Availability-zone resilience</Text>
        <Bar dist={p.zone_distribution} colorMap={ZONE_COLORS} />
        <Text style={s.h2}>Backup coverage</Text>
        <Bar dist={p.backup_distribution} colorMap={{ Protected: C.green, Unprotected: C.red }} />
        <Text style={s.h2}>Cross-region redundancy</Text>
        <Bar dist={p.geo_distribution} colorMap={{ 'Geo-redundant': C.green, 'Single-region': C.orange }} />
        <Footer />
      </Page>

      {/* Breakdown + risk matrix */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Resilience Breakdown</Text>
        <View style={s.h1bar} />
        <Text style={s.h2}>{T(p.measure_label || 'Resource count')} by {T(p.group_by_label || 'Group')} (stacked by zone resilience)</Text>
        <View style={s.table}>
          <View style={[s.tr, s.headRow]}>
            <Text style={[s.th, { width: '46%' }]}>{T(p.group_by_label || 'Group')}</Text>
            <Text style={[s.th, { width: '14%', textAlign: 'right' }]}>Total</Text>
            <Text style={[s.th, { width: '40%' }]}>Zone composition</Text>
          </View>
          {groups.map((g, i) => (
            <View style={s.tr} key={i} wrap={false}>
              <Text style={[s.td, { width: '46%' }]}>{T(g.name)}</Text>
              <Text style={[s.td, { width: '14%', textAlign: 'right' }]}>{cost ? money(g.total) : g.total}</Text>
              <View style={[{ width: '40%', justifyContent: 'center' }]}>
                <View style={{ height: 8, flexDirection: 'row', borderRadius: 2, overflow: 'hidden', backgroundColor: '#0b1220' }}>
                  {ZONE_ORDER.map((z) => {
                    const v = (g.byZone || {})[z] || 0
                    if (!v) return null
                    return <View key={z} style={{ width: `${(100 * v) / maxG}%`, backgroundColor: ZONE_COLORS[z] }} />
                  })}
                </View>
              </View>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, marginBottom: 6 }}>
          {ZONE_ORDER.map((z) => (
            <View key={z} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <View style={{ width: 7, height: 7, backgroundColor: ZONE_COLORS[z], borderRadius: 1 }} />
              <Text style={{ fontSize: 7.5, color: C.muted }}>{ZONE_LABEL[z]}</Text>
            </View>
          ))}
        </View>

        <Text style={s.h2}>Risk matrix — criticality x zone resilience</Text>
        <View style={s.table}>
          <View style={[s.tr, s.headRow]}>
            <Text style={[s.th, { width: '24%' }]}>Criticality</Text>
            {ZONE_ORDER.map((z) => <Text key={z} style={[s.th, { width: '15.2%', textAlign: 'center' }]}>{ZONE_LABEL[z]}</Text>)}
          </View>
          {CRIT_ORDER.map((cKey) => {
            const rowM = matrix[cKey] || {}
            const rowTotal = ZONE_ORDER.reduce((a, z) => a + (rowM[z] || 0), 0)
            if (!rowTotal) return null
            return (
              <View style={s.tr} key={cKey} wrap={false}>
                <View style={[{ width: '24%', flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 3.5, paddingHorizontal: 3 }]}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: CRIT_COLORS[cKey] }} />
                  <Text style={{ fontSize: 8.5, color: C.body }}>{cKey}</Text>
                </View>
                {ZONE_ORDER.map((z) => {
                  const v = rowM[z] || 0
                  const danger = v > 0 && (z === 'LocallyRedundant' || z === 'Zonal') && (cKey === 'Critical' || cKey === 'High')
                  return <Text key={z} style={[s.td, { width: '15.2%', textAlign: 'center' }, danger ? { color: C.red, fontFamily: 'Helvetica-Bold' } : {}]}>{v || '-'}</Text>
                })}
              </View>
            )
          })}
        </View>
        <Text style={{ fontSize: 7.5, color: C.faint }}>Highlighted = business-critical workloads without zone redundancy (priority DR candidates).</Text>
        <Footer />
      </Page>

      {/* Top risks */}
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Top Resiliency Risks</Text>
        <View style={s.h1bar} />
        <View style={s.table}>
          <View style={[s.tr, s.headRow]}>
            <Text style={[s.th, { width: '26%' }]}>Resource</Text>
            <Text style={[s.th, { width: '21%' }]}>Type</Text>
            <Text style={[s.th, { width: '17%' }]}>Region</Text>
            <Text style={[s.th, { width: '13%' }]}>Criticality</Text>
            <Text style={[s.th, { width: '15%' }]}>Zone</Text>
            <Text style={[s.th, { width: '8%', textAlign: 'center' }]}>Bkp</Text>
          </View>
          {atRisk.map((x, i) => (
            <View style={s.tr} key={i} wrap={false}>
              <Text style={[s.td, { width: '26%' }]}>{T(x.resource_name)}</Text>
              <Text style={[s.td, { width: '21%' }]}>{T((x.resource_type || '').split('/').pop())}</Text>
              <Text style={[s.td, { width: '17%' }]}>{T(x.location)}</Text>
              <Text style={[s.td, { width: '13%', color: CRIT_COLORS[x.criticality] || C.body }]}>{T(x.criticality || '-')}</Text>
              <Text style={[s.td, { width: '15%', color: ZONE_COLORS[x.zone_status] || C.body }]}>{T(ZONE_LABEL[x.zone_status] || x.zone_status)}</Text>
              <Text style={[s.td, { width: '8%', textAlign: 'center', color: x.has_backup ? C.green : C.red, fontFamily: 'Helvetica-Bold' }]}>{x.has_backup ? 'Y' : 'N'}</Text>
            </View>
          ))}
          {!atRisk.length && <Text style={[s.td, { padding: 8 }]}>No exposed resources in this selection — everything is zone-redundant and backed up.</Text>}
        </View>
        <Footer />
      </Page>
    </Document>
  )

  return pdf(doc).toBlob()
}
