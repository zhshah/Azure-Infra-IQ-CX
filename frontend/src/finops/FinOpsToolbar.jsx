/**
 * FinOpsToolbar — the shared deep-capability bar for EVERY FinOps module.
 *
 * One drop-in that gives every child view the same capabilities:
 *   • Deep scope filtering: subscription / resource group / resource-name search
 *   • Tag filters (multiple key=value rows, live values from /api/tags/values)
 *   • User-defined period (time range)
 *   • Export to CSV (client-side), XLSX (server openpyxl) and PDF (react-pdf)
 *
 * It owns nothing about a module's data — the parent passes the current filter
 * object and an `exportReport` ({ title, kpis, tables }) describing what to export.
 * Emitted filters ({subscription_id, resource_group, resource_name, region,
 * tags:[{key,value}], time_range}) are compatible with the resource-grounded AI
 * endpoint, so passing them to <FinOpsAIPanel filters=…> scopes the AI too.
 *
 * Rules of Hooks: all hooks declared unconditionally before any return.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Filter, X, Plus, Tag } from 'lucide-react'
import { getSubscriptions, getFilterOptions, finopsApi, TIME_RANGE_OPTIONS } from './finopsApi'
import SearchableSelect from '../components/shared/SearchableSelect'
import FinOpsExportMenu from './FinOpsExportMenu'

export const EMPTY_TOOLBAR_FILTERS = {
  subscription_id: '', resource_group: '', region: '', resource_name: '',
  tags: [], time_range: 'last_30d',
}

const inputStyle = { background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 9px', color: 'var(--c-e2e8f0)', fontSize: 12, width: '100%', boxSizing: 'border-box' }
const miniLabel  = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }
const btnGhost   = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 11 }

// One tag key=value row with live value suggestions.
function TagRow({ row, index, tagKeys, onUpdate, onRemove }) {
  const [vals, setVals] = useState([])
  useEffect(() => {
    if (!row.key) { setVals([]); return }
    let cancelled = false
    fetch(`/api/tags/values/${encodeURIComponent(row.key)}`)
      .then(r => r.ok ? r.json() : { values: [] })
      .then(d => { if (!cancelled) setVals(d.values || []) })
      .catch(() => { if (!cancelled) setVals([]) })
    return () => { cancelled = true }
  }, [row.key])
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
      <div style={{ width: 150 }}>
        <div style={miniLabel}>Tag key</div>
        <SearchableSelect value={row.key} onChange={v => onUpdate(index, { key: v, value: '' })} options={tagKeys.map(k => ({ value: k, label: k }))} placeholder="key…" compact />
      </div>
      <span style={{ color: 'var(--c-475569)', paddingBottom: 8 }}>=</span>
      <div style={{ width: 160 }}>
        <div style={miniLabel}>Tag value</div>
        <SearchableSelect value={row.value} onChange={v => onUpdate(index, { value: v })} options={vals.map(v => ({ value: v, label: v }))} placeholder={row.key ? 'value…' : 'pick key'} disabled={!row.key} compact />
      </div>
      <button onClick={() => onRemove(index)} style={{ background: 'none', border: 'none', color: 'var(--c-64748b)', cursor: 'pointer', padding: 4, marginBottom: 5 }} title="Remove tag filter"><X size={13} /></button>
    </div>
  )
}

export default function FinOpsToolbar({
  filters = EMPTY_TOOLBAR_FILTERS,
  onChange,
  exportReport = null,      // { title, kpis:[{label,value}], tables:[{title,columns,rows}] }
  exportName = 'finops',
  showPeriod = true,
  showResourceName = true,
  extra = null,             // optional extra controls rendered inline (e.g. a group-by select)
}) {
  const [subOpts, setSubOpts] = useState([])
  const [rgOpts,  setRgOpts]  = useState([])
  const [regionOpts, setRegionOpts] = useState([])
  const [tagKeys, setTagKeys] = useState([])

  useEffect(() => {
    getSubscriptions().then(s => setSubOpts((s || []).map(x => ({ value: x.subscription_id, label: x.subscription_name || x.subscription_id })))).catch(() => {})
    getFilterOptions().then(o => {
      const norm = (a) => (a || []).map(v => (typeof v === 'string' ? { value: v, label: v } : { value: v.value, label: v.label ?? v.value }))
      setRgOpts(norm(o.resource_groups)); setRegionOpts(norm(o.regions)); setTagKeys(o.tag_keys || [])
    }).catch(() => {})
  }, [])

  const set = useCallback((patch) => onChange && onChange({ ...filters, ...patch }), [filters, onChange])
  const tags = filters.tags || []
  const setTags = (next) => set({ tags: next })
  const addTag = () => setTags([...tags, { key: '', value: '' }])
  const updateTag = (i, patch) => setTags(tags.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  const removeTag = (i) => setTags(tags.filter((_, idx) => idx !== i))

  const active = filters.subscription_id || filters.resource_group || filters.region || filters.resource_name || (tags.some(t => t.key)) || (showPeriod && filters.time_range && filters.time_range !== 'last_30d')

  // CSV built client-side from the export tables; XLSX via the generic server endpoint.
  const csvFn = useMemo(() => {
    if (!exportReport?.tables?.length) return null
    return async () => {
      const parts = []
      for (const t of exportReport.tables) {
        parts.push((t.title || 'Table'))
        parts.push((t.columns || []).map(csvCell).join(','))
        for (const row of (t.rows || [])) parts.push(row.map(csvCell).join(','))
        parts.push('')
      }
      const blob = new Blob([parts.join('\n')], { type: 'text/csv;charset=utf-8;' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = `azure-finops-${exportName}-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 800)
    }
  }, [exportReport, exportName])

  const xlsxFn = useMemo(() => {
    if (!exportReport?.tables?.length) return null
    return async () => finopsApi.exportGenericXlsx({
      title: exportReport.title || `FinOps ${exportName}`,
      sheets: [
        ...(exportReport.kpis?.length ? [{ name: 'Summary', columns: ['Metric', 'Value'], rows: exportReport.kpis.map(k => [k.label, k.value]) }] : []),
        ...exportReport.tables.map(t => ({ name: (t.title || 'Detail').slice(0, 31), columns: t.columns || [], rows: t.rows || [] })),
      ],
    })
  }, [exportReport, exportName])

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', background: 'var(--c-0f172a)', border: `1px solid ${active ? '#1d4ed8' : 'var(--c-1e293b)'}`, borderRadius: 10, padding: '12px 14px' }}>
      <Filter size={15} style={{ color: active ? '#60a5fa' : 'var(--c-64748b)', marginBottom: 7 }} />
      <div style={{ minWidth: 190 }}>
        <div style={miniLabel}>Subscription</div>
        <SearchableSelect value={filters.subscription_id} onChange={v => set({ subscription_id: v || '' })} options={subOpts} placeholder="All subscriptions" compact />
      </div>
      <div style={{ minWidth: 170 }}>
        <div style={miniLabel}>Resource group</div>
        <SearchableSelect value={filters.resource_group} onChange={v => set({ resource_group: v || '' })} options={rgOpts} placeholder="All resource groups" compact />
      </div>
      <div style={{ minWidth: 140 }}>
        <div style={miniLabel}>Region</div>
        <SearchableSelect value={filters.region} onChange={v => set({ region: v || '' })} options={regionOpts} placeholder="All regions" compact />
      </div>
      {showResourceName && (
        <div style={{ minWidth: 150 }}>
          <div style={miniLabel}>Resource name</div>
          <input value={filters.resource_name || ''} onChange={e => set({ resource_name: e.target.value })} placeholder="contains…" style={inputStyle} />
        </div>
      )}
      {showPeriod && (
        <div style={{ minWidth: 140 }}>
          <div style={miniLabel}>Period</div>
          <SearchableSelect value={filters.time_range} onChange={v => set({ time_range: v || 'last_30d' })} options={TIME_RANGE_OPTIONS.filter(o => o.value !== 'custom')} compact />
        </div>
      )}
      {extra}
      {/* Tag filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tags.map((t, i) => <TagRow key={i} row={t} index={i} tagKeys={tagKeys} onUpdate={updateTag} onRemove={removeTag} />)}
        <button onClick={addTag} style={{ ...btnGhost, alignSelf: 'flex-start' }}><Tag size={11} /> {tags.length ? 'Add tag filter' : 'Filter by tag'}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
        {active && (
          <button onClick={() => onChange && onChange({ ...EMPTY_TOOLBAR_FILTERS })} style={btnGhost}><X size={11} /> Clear</button>
        )}
        {exportReport && <FinOpsExportMenu view={exportName} onCsv={csvFn} onXlsx={xlsxFn} report={exportReport} />}
      </div>
    </div>
  )
}

function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
