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
    const h = React.createElement
    const S = StyleSheet.create({
      page:    { padding: 32, fontSize: 10, color: '#0f172a', fontFamily: 'Helvetica' },
      h1:      { fontSize: 18, fontWeight: 700, marginBottom: 2, color: '#1e3a5f' },
      sub:     { fontSize: 9, color: '#64748b', marginBottom: 14 },
      h2:      { fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 6, color: '#1e3a5f' },
      kpiRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
      kpi:     { width: '31%', border: '1pt solid #e2e8f0', borderRadius: 4, padding: 6, marginRight: 6, marginBottom: 6 },
      kpiLbl:  { fontSize: 7, color: '#64748b', textTransform: 'uppercase' },
      kpiVal:  { fontSize: 12, fontWeight: 700, color: '#0f172a' },
      tr:      { flexDirection: 'row', borderBottom: '0.5pt solid #e2e8f0' },
      th:      { flex: 1, fontSize: 8, fontWeight: 700, color: '#1e3a5f', padding: 3, backgroundColor: '#f1f5f9' },
      td:      { flex: 1, fontSize: 8, padding: 3, color: '#334155' },
      ai:      { fontSize: 9, color: '#334155', lineHeight: 1.5, marginTop: 4 },
    })
    const r = report || {}
    const children = [
      h(Text, { style: S.h1 }, r.title || 'Azure FinOps Report'),
      h(Text, { style: S.sub }, `Generated ${new Date().toLocaleString()} · Azure Cost Management`),
    ]
    if (r.kpis?.length) {
      children.push(h(Text, { style: S.h2 }, 'Key Metrics'))
      children.push(h(View, { style: S.kpiRow },
        r.kpis.map((k, i) => h(View, { style: S.kpi, key: i }, [
          h(Text, { style: S.kpiLbl, key: 'l' }, String(k.label || '')),
          h(Text, { style: S.kpiVal, key: 'v' }, String(k.value ?? '')),
        ]))
      ))
    }
    if (r.aiSummary) {
      children.push(h(Text, { style: S.h2 }, 'AI Analysis'))
      children.push(h(Text, { style: S.ai }, String(r.aiSummary)))
    }
    for (const t of (r.tables || [])) {
      children.push(h(Text, { style: S.h2 }, t.title || 'Detail'))
      children.push(h(View, { style: S.tr }, (t.columns || []).map((c, i) => h(Text, { style: S.th, key: i }, String(c)))))
      for (let ri = 0; ri < (t.rows || []).length && ri < 60; ri++) {
        const row = t.rows[ri]
        children.push(h(View, { style: S.tr, key: ri }, row.map((c, ci) => h(Text, { style: S.td, key: ci }, String(c ?? '')))))
      }
    }
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
