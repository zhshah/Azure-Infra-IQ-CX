/**
 * FinOpsExportMenu — one Export control for every FinOps view.
 *
 * Offers CSV, Excel (XLSX), PDF and FOCUS 1.2 downloads. PDF is generated
 * client-side via @react-pdf/renderer, which is imported dynamically (only when
 * the user actually clicks PDF) so it never bloats the main bundle.
 *
 * Props:
 *   view       string  — label used in filenames
 *   onCsv      async fn — optional, triggers a CSV download
 *   onXlsx     async fn — optional, triggers an XLSX download
 *   focusDays  number   — if set, shows a "FOCUS 1.2 CSV" item (downloadFocusCsv)
 *   report     object   — { title, kpis:[{label,value}], tables:[{title,columns,rows}], aiSummary } for PDF
 *
 * Rules of Hooks: all hooks declared unconditionally before any return.
 */
import React, { useState, useRef, useEffect } from 'react'
import { Download, FileText, FileSpreadsheet, FileType, ChevronDown, Loader } from 'lucide-react'
import { finopsApi } from './finopsApi'

export default function FinOpsExportMenu({ view = 'finops', onCsv, onXlsx, focusDays = null, report = null }) {
  const [open, setOpen]   = useState(false)
  const [busy, setBusy]   = useState(null)   // 'csv' | 'xlsx' | 'pdf' | 'focus'
  const [err, setErr]     = useState(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const run = async (key, fn) => {
    setBusy(key); setErr(null)
    try { await fn() } catch (e) { setErr(e.message || String(e)) }
    finally { setBusy(null); setOpen(false) }
  }

  const handlePdf = async () => {
    const mod = await import('@react-pdf/renderer')
    const { pdf, Document, Page, Text, View, StyleSheet } = mod
    // Shared brand mark (dynamic import keeps the FinOps bundle code-split).
    let BrandMark = null
    try { BrandMark = (await import('../utils/pdfBrand')).BrandMark } catch { /* optional */ }
    const h = React.createElement
    // Dark, branded palette — matches the BCDR / BIA consultant reports.
    const C = {
      bg: '#0f172a', card: '#1e293b', slate: '#334155', accent: '#3b82f6', blue: '#60a5fa',
      blueDk: '#93c5fd', ink: '#f8fafc', body: '#cbd5e1', muted: '#94a3b8', faint: '#64748b',
      green: '#4ade80', border: '#22304a', headerAlt: '#16223b',
    }
    const S = StyleSheet.create({
      page:    { paddingTop: 30, paddingHorizontal: 30, paddingBottom: 52, fontSize: 10, color: C.body, fontFamily: 'Helvetica', backgroundColor: C.bg },
      // Cover / header
      brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
      brandName: { fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: 'Helvetica-Bold' },
      brandTag: { fontSize: 8, color: C.muted },
      h1:      { fontSize: 20, color: C.ink, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
      sub:     { fontSize: 9, color: C.muted, marginBottom: 8 },
      rule:    { height: 2, backgroundColor: C.accent, marginBottom: 14, borderRadius: 1 },
      // Sections
      h2:      { fontSize: 12, color: C.blueDk, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 7, paddingBottom: 3, borderBottom: `1pt solid ${C.slate}` },
      // KPI cards
      kpiRow:  { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
      kpi:     { width: '31.5%', backgroundColor: C.card, borderRadius: 5, borderLeft: `2pt solid ${C.accent}`, padding: 8, marginRight: '1.8%', marginBottom: 7 },
      kpiLbl:  { fontSize: 7, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
      kpiVal:  { fontSize: 13, color: C.ink, fontFamily: 'Helvetica-Bold' },
      // AI narrative
      aiCard:  { backgroundColor: C.card, borderRadius: 5, padding: 10, borderLeft: `2pt solid ${C.blue}` },
      ai:      { fontSize: 9.5, color: C.body, lineHeight: 1.55 },
      // Tables
      thRow:   { flexDirection: 'row', backgroundColor: C.slate, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
      th:      { flex: 1, fontSize: 8, color: '#ffffff', fontFamily: 'Helvetica-Bold', padding: 5 },
      tr:      { flexDirection: 'row', borderBottom: `0.5pt solid ${C.border}` },
      trAlt:   { flexDirection: 'row', borderBottom: `0.5pt solid ${C.border}`, backgroundColor: C.headerAlt },
      td:      { flex: 1, fontSize: 8, padding: 5, color: C.body },
      more:    { fontSize: 8, color: C.faint, fontStyle: 'italic', marginTop: 4 },
      // Footer
      footer:  { position: 'absolute', bottom: 22, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTop: `0.5pt solid ${C.slate}`, paddingTop: 6 },
      footTxt: { fontSize: 7.5, color: C.faint },
      footMid: { fontSize: 7.5, color: C.muted, fontFamily: 'Helvetica-Bold' },
    })
    const r = report || {}
    const year = new Date().getFullYear()
    const children = [
      h(View, { style: S.brandRow, key: 'brand' }, [
        BrandMark ? h(BrandMark, { size: 34, key: 'm' }) : null,
        h(View, { key: 't' }, [
          h(Text, { style: S.brandName, key: 'n' }, 'Azure Infra IQ'),
          h(Text, { style: S.brandTag, key: 'g' }, 'FinOps · Cost Intelligence'),
        ]),
      ]),
      h(Text, { style: S.h1, key: 'title' }, r.title || 'Azure FinOps Report'),
      h(Text, { style: S.sub, key: 'gen' }, `Generated ${new Date().toLocaleString()} · grounded on Azure Cost Management data`),
      h(View, { style: S.rule, key: 'rule' }),
    ]
    if (r.kpis?.length) {
      children.push(h(Text, { style: S.h2, key: 'kh' }, 'Key Metrics'))
      children.push(h(View, { style: S.kpiRow, key: 'kr' },
        r.kpis.map((k, i) => h(View, { style: S.kpi, key: i }, [
          h(Text, { style: S.kpiLbl, key: 'l' }, String(k.label || '')),
          h(Text, { style: S.kpiVal, key: 'v' }, String(k.value ?? '')),
        ]))
      ))
    }
    if (r.aiSummary) {
      children.push(h(Text, { style: S.h2, key: 'aih' }, 'AI Cost Analysis'))
      children.push(h(View, { style: S.aiCard, key: 'aic' }, h(Text, { style: S.ai }, String(r.aiSummary))))
    }
    for (const [ti, t] of (r.tables || []).entries()) {
      children.push(h(Text, { style: S.h2, key: `t${ti}h` }, t.title || 'Detail'))
      children.push(h(View, { style: S.thRow, key: `t${ti}head` }, (t.columns || []).map((c, i) => h(Text, { style: S.th, key: i }, String(c)))))
      const allRows = t.rows || []
      const shown = Math.min(allRows.length, 60)
      for (let ri = 0; ri < shown; ri++) {
        const row = allRows[ri]
        children.push(h(View, { style: ri % 2 ? S.trAlt : S.tr, key: `t${ti}r${ri}` }, row.map((c, ci) => h(Text, { style: S.td, key: ci }, String(c ?? '')))))
      }
      if (allRows.length > shown) {
        children.push(h(Text, { style: S.more, key: `t${ti}more` }, `… +${allRows.length - shown} more rows (download the Excel export for the full detail)`))
      }
    }
    // Fixed footer with page numbers (repeats on every page).
    children.push(h(View, { style: S.footer, fixed: true, key: 'footer' }, [
      h(Text, { style: S.footTxt, key: 'l' }, `© ${year} Azure Infra IQ`),
      h(Text, { style: S.footMid, key: 'm' }, 'Confidential'),
      h(Text, { style: S.footTxt, key: 'r', render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }),
    ]))
    const doc = h(Document, {}, h(Page, { size: 'A4', style: S.page }, children))
    const blob = await pdf(doc).toBlob()
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `azure-finops-${view}-${new Date().toISOString().slice(0, 10)}.pdf`
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
  }

  const items = []
  if (onCsv)   items.push({ key: 'csv',   label: 'CSV',          icon: FileText,        fn: onCsv })
  if (onXlsx)  items.push({ key: 'xlsx',  label: 'Excel (XLSX)', icon: FileSpreadsheet, fn: onXlsx })
  if (report)  items.push({ key: 'pdf',   label: 'PDF report',   icon: FileType,        fn: handlePdf })
  if (focusDays != null) items.push({ key: 'focus', label: 'FOCUS 1.2 CSV', icon: FileText, fn: () => finopsApi.downloadFocusCsv(focusDays) })

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} disabled={!!busy} style={{
        display: 'flex', alignItems: 'center', gap: 6, background: '#0d2b1f', border: '1px solid #166534',
        borderRadius: 6, padding: '6px 12px', cursor: busy ? 'wait' : 'pointer', color: '#4ade80', fontSize: 11, fontWeight: 600,
      }}>
        {busy ? <Loader size={12} className="animate-spin" /> : <Download size={12} />}
        Export <ChevronDown size={11} />
      </button>
      {open && items.length > 0 && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 4, minWidth: 168, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {items.map(it => (
            <button key={it.key} onClick={() => run(it.key, it.fn)} disabled={busy === it.key} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
              background: 'none', border: 'none', borderRadius: 6, padding: '7px 10px', cursor: 'pointer',
              color: '#cbd5e1', fontSize: 12,
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              {busy === it.key ? <Loader size={13} className="animate-spin" /> : <it.icon size={13} style={{ color: '#64748b' }} />}
              {it.label}
            </button>
          ))}
          {err && <div style={{ color: '#f87171', fontSize: 10, padding: '4px 10px' }}>{err}</div>}
        </div>
      )}
    </div>
  )
}
