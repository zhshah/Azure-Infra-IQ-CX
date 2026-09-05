/**
 * AIAnalysisTools — shared controls + resource linkage for EVERY AI analysis panel.
 *
 * Gives any module's AI block the same capabilities the FinOps panel has:
 *   • Scope   — free-text focus that re-runs the analysis narrowed to one area
 *   • Context — structured business context (industry / size / goal / notes)
 *   • Focus   — subscription → resource group → type → a single resource; each
 *                choice filters the next, and Apply re-runs the analysis on it
 *   • Export  — CSV or PDF including the resources behind every finding
 *   • Affected resources — which resource, RG and subscription a finding is about,
 *                          clickable through to the 360° resource blade
 *
 * Usage:
 *   const [ctl, setCtl] = useState(EMPTY_AI_CONTROLS)
 *   <AIControlsBar title="Cloud Maturity" report={report} resources={resources}
 *                  value={ctl} onApply={next => { setCtl(next); reload(next) }} />
 *   <AffectedResources items={finding.affected_resources} count={finding.affected_count} />
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Crosshair, SlidersHorizontal, Filter, Download, X, Check, ChevronDown, Loader2,
} from 'lucide-react'
import { useDrill } from '../../drill/DrillContext'

export const EMPTY_AI_CONTROLS = { scope: '', context: {}, filters: {} }

const SCOPE_PRESETS = [
  'Production workloads only', 'Non-production / dev-test', 'Virtual machines',
  'Storage & data', 'Networking & connectivity', 'Databases (SQL / Cosmos)',
  'Containers / AKS', 'Identity & access', 'Backup & disaster recovery',
  'Public-facing / internet-exposed resources', 'Highest-cost resources',
  'Untagged & unowned resources',
]

const CONTEXT_FIELDS = [
  { key: 'industry', label: 'Industry', options: ['Financial Services', 'Healthcare', 'Retail / e-Commerce', 'Manufacturing', 'Public Sector', 'Technology / SaaS', 'Education', 'Energy / Utilities', 'Media & Entertainment', 'Telecom', 'Other'] },
  { key: 'org_size', label: 'Organization size', options: ['Startup (<50)', 'SMB (50–500)', 'Mid-market (500–5k)', 'Enterprise (5k–50k)', 'Large enterprise (50k+)'] },
  { key: 'environment', label: 'Environment mix', options: ['Mostly Production', 'Mostly Dev/Test', 'Balanced Prod & Non-prod', 'Regulated / Compliance-heavy'] },
  { key: 'priority', label: 'Primary goal', options: ['Reduce risk', 'Reduce cost', 'Improve resilience / DR', 'Strengthen security posture', 'Modernise / migrate to PaaS', 'Improve governance & tagging', 'Operational excellence'] },
  { key: 'compliance', label: 'Compliance regime', options: ['None / not regulated', 'ISO 27001', 'PCI-DSS', 'HIPAA / HITRUST', 'SOC 2', 'GDPR', 'FedRAMP / Gov', 'Local data-residency'] },
]

const btn = (active) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontSize: 11, padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
  background: active ? 'rgba(59,130,246,.16)' : 'transparent',
  border: `1px solid ${active ? '#3b82f6' : 'var(--c-334155)'}`,
  color: active ? '#93c5fd' : 'var(--c-94a3b8)',
})

const drawer = {
  marginTop: 8, padding: 12, borderRadius: 8,
  background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)',
}
const inputStyle = {
  width: '100%', background: 'var(--c-0f172a)', color: 'var(--c-e2e8f0)',
  border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 8px', fontSize: 12,
}
const chip = {
  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10,
  padding: '2px 7px', borderRadius: 999, background: 'rgba(59,130,246,.14)',
  border: '1px solid rgba(59,130,246,.4)', color: '#93c5fd',
}

/* ── report flattening ─────────────────────────────────────────────────────── */

const TITLE_KEYS = ['title', 'name', 'finding', 'gap', 'issue', 'recommendation', 'dimension', 'category', 'headline']
const TEXT_KEYS = ['detail', 'description', 'summary', 'rationale', 'impact', 'action', 'remediation', 'why', 'so_what']

const pick = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/** Walk any module's AI result and pull out every finding-like item with its resources. */
export function flattenAIReport(report, maxDepth = 4) {
  const rows = []
  const seen = new Set()
  const walk = (node, path, depth) => {
    if (!node || depth > maxDepth) return
    if (Array.isArray(node)) { node.forEach(n => walk(n, path, depth)); return }
    if (typeof node !== 'object') return
    const title = pick(node, TITLE_KEYS)
    const text = pick(node, TEXT_KEYS)
    const res = Array.isArray(node.affected_resources) ? node.affected_resources : []
    if (title || text || res.length) {
      const key = `${path}|${title}|${text}`.slice(0, 300)
      if (!seen.has(key)) {
        seen.add(key)
        rows.push({
          section: path || 'analysis',
          title,
          detail: text,
          severity: node.severity || node.priority || node.impact || node.risk_level || '',
          score: node.score ?? node.percentage ?? '',
          resources: res,
          affected_count: node.affected_count ?? res.length,
        })
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'affected_resources') continue
      if (v && typeof v === 'object') walk(v, path ? `${path} › ${k}` : k, depth + 1)
    }
  }
  walk(report, '', 0)
  return rows.filter(r => r.title || r.detail || r.resources.length)
}

/** Every distinct resource referenced anywhere in the analysis. */
export function collectAffectedResources(report) {
  const out = new Map()
  flattenAIReport(report).forEach(row => {
    row.resources.forEach(r => {
      const id = r.resource_id || r.resource_name
      if (id && !out.has(id)) out.set(id, r)
    })
  })
  return [...out.values()]
}

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

export function exportAIAnalysisCSV(title, report, controls = EMPTY_AI_CONTROLS, subNames = {}) {
  const rows = flattenAIReport(report)
  const meta = [
    ['Analysis', title],
    ['Generated', new Date().toLocaleString()],
    ['Focus (scope)', controls.scope || 'Whole estate (no focus set)'],
    ['Resource filter', describeFilters(controls.filters, subNames) || 'None — all resources'],
    ['Business context', Object.entries(controls.context || {}).map(([k, v]) => `${k}=${v}`).join('; ') || 'None'],
    [],
  ]
  const head = ['Section', 'Finding', 'Detail', 'Severity', 'Score',
    'Resource', 'Resource type', 'Resource group', 'Subscription', 'Location', 'Monthly cost (USD)']
  const body = []
  rows.forEach(r => {
    if (!r.resources.length) {
      body.push([r.section, r.title, r.detail, r.severity, r.score, '', '', '', '', '', ''])
      return
    }
    r.resources.forEach(res => body.push([
      r.section, r.title, r.detail, r.severity, r.score,
      res.resource_name || '', (res.resource_type || '').split('/').pop() || '',
      res.resource_group || '',
      res.subscription_name || subNames[String(res.subscription_id || '').toLowerCase()] || res.subscription_id || '',
      res.location || '', res.cost_usd ?? '',
    ]))
  })
  const text = [...meta, head, ...body].map(r => r.map(esc).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-ai-analysis.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function describeFilters(filters = {}, subNames = {}) {
  const bits = []
  if (filters.sub) bits.push(`Subscription: ${subNames[String(filters.sub).toLowerCase()] || filters.sub}`)
  if (filters.rg) bits.push(`Resource group: ${filters.rg}`)
  if (filters.rtype) bits.push(`Type: ${String(filters.rtype).split('/').pop()}`)
  if (filters.res) bits.push(`Resource: ${filters.res_name || filters.res}`)
  return bits.join(' · ')
}

/** Turn the controls into the query string every /api/ai/* route understands. */
export function aiControlsQuery(controls = EMPTY_AI_CONTROLS) {
  const p = new URLSearchParams()
  const { scope, context, filters } = controls || {}
  if (scope) p.set('scope', scope)
  if (context && Object.keys(context).length) p.set('context', JSON.stringify(context))
  if (filters?.sub) p.set('sub', filters.sub)
  if (filters?.rg) p.set('rg', filters.rg)
  if (filters?.rtype) p.set('rtype', filters.rtype)
  if (filters?.res) {
    p.set('res', filters.res)
    if (filters.res_name) p.set('res_name', filters.res_name)
  }
  const s = p.toString()
  return s ? `&${s}` : ''
}

/* ── affected-resource linkage ─────────────────────────────────────────────── */

const th = {
  textAlign: 'left', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4,
  textTransform: 'uppercase', color: 'var(--c-64748b)',
  padding: '5px 8px', borderBottom: '1px solid var(--c-334155)', whiteSpace: 'nowrap',
}
const td = {
  fontSize: 11, color: 'var(--c-cbd5e1)', padding: '5px 8px',
  borderBottom: '1px solid var(--c-1e293b)', whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260,
}

const fmtMoney = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return '—'
  return n >= 100 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`
}

/** Normalise whatever shape a model emitted into the columns the table renders. */
export function normaliseResource(r, subNames = {}) {
  const o = typeof r === 'string' ? { resource_name: r } : (r || {})
  return {
    ...o,
    resource_name: o.resource_name || o.name || o.resource_id || '(unnamed)',
    resource_type: o.resource_type || o.type || '',
    resource_group: o.resource_group || o.resourceGroup || '',
    subscription_name: o.subscription_name
      || subNames[String(o.subscription_id || '').toLowerCase()] || o.subscription_id || '',
    location: o.location || o.region || '',
    cost_usd: o.cost_usd ?? o.monthly_cost ?? o.cost_current_month ?? null,
  }
}

/** Every finding that names resources renders them as this table, everywhere. */
export function AffectedResources({ items, count, subNames = {}, label = 'Affected resources', onResourceClick }) {
  const { openResourceDetail, openResourceDrill } = useDrill()
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  if (!list.length) return null
  const rows = list.map(r => normaliseResource(r, subNames))
  const total = count && count > rows.length ? count : rows.length
  const open = (r) => {
    if (!r.resource_id && !r.resource_name) return
    if (onResourceClick) onResourceClick(r)
    else openResourceDetail(r)
  }
  // Only show columns the data actually has, so a sparse model answer does not
  // render a table of empty cells.
  const has = (k) => rows.some(r => r[k] !== '' && r[k] != null)
  const cols = [
    { k: 'resource_name', h: 'Resource', get: r => r.resource_name },
    has('resource_type') && { k: 'resource_type', h: 'Type', get: r => String(r.resource_type).split('/').pop() },
    has('resource_group') && { k: 'resource_group', h: 'Resource group', get: r => r.resource_group },
    has('subscription_name') && { k: 'subscription_name', h: 'Subscription', get: r => r.subscription_name },
    has('location') && { k: 'location', h: 'Location', get: r => r.location },
    has('cost_usd') && { k: 'cost_usd', h: 'Cost / mo', get: r => fmtMoney(r.cost_usd), num: true },
  ].filter(Boolean)

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--c-64748b)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {label} ({rows.length}{total > rows.length ? ` of ${total}` : ''}) — click a row for 360° detail
        </span>
        {rows.some(r => r.resource_id) && (
          <button
            onClick={() => openResourceDrill(label, rows.filter(r => r.resource_id))}
            style={{ ...btn(false), padding: '1px 6px', fontSize: 9.5 }}>
            View all
          </button>
        )}
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--c-334155)', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460 }}>
          <thead>
            <tr>{cols.map(c => <th key={c.k} style={{ ...th, textAlign: c.num ? 'right' : 'left' }}>{c.h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const clickable = !!(r.resource_id || r.resource_name)
              return (
                <tr key={`${r.resource_id || r.resource_name}-${i}`}
                    onClick={() => open(r)}
                    style={{ cursor: clickable ? 'pointer' : 'default' }}
                    title={clickable ? `View 360° details for ${r.resource_name}` : undefined}>
                  {cols.map((c, ci) => (
                    <td key={c.k} style={{
                      ...td,
                      textAlign: c.num ? 'right' : 'left',
                      fontVariantNumeric: c.num ? 'tabular-nums' : 'normal',
                      color: ci === 0 && clickable ? '#93c5fd' : td.color,
                      fontWeight: ci === 0 ? 600 : 400,
                    }}>{c.get(r) || '—'}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── controls bar ──────────────────────────────────────────────────────────── */

export function AIControlsBar({
  title = 'AI analysis',
  report = null,
  resources = null,
  value = EMPTY_AI_CONTROLS,
  onApply,
  busy = false,
  compact = false,
}) {
  const [scopeOpen, setScopeOpen] = useState(false)
  const [ctxOpen, setCtxOpen] = useState(false)
  const [filtOpen, setFiltOpen] = useState(false)
  const [expOpen, setExpOpen] = useState(false)
  const [scopeDraft, setScopeDraft] = useState(value.scope || '')
  const [ctxDraft, setCtxDraft] = useState(value.context || {})
  const [filtDraft, setFiltDraft] = useState(value.filters || {})
  const [subNames, setSubNames] = useState({})
  const expRef = useRef(null)

  useEffect(() => {
    let dead = false
    fetch('/api/subscriptions')
      .then(r => (r.ok ? r.json() : []))
      .then(list => {
        if (dead) return
        const m = {}
        ;(Array.isArray(list) ? list : []).forEach(s => {
          if (s.subscription_id) m[String(s.subscription_id).toLowerCase()] = s.subscription_name || s.subscription_id
        })
        setSubNames(m)
      })
      .catch(() => {})
    return () => { dead = true }
  }, [])

  useEffect(() => {
    const close = (e) => { if (expRef.current && !expRef.current.contains(e.target)) setExpOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // Options cascade off what is already picked, so an impossible combination
  // (an RG from another subscription) can never be selected.
  const inSub = useCallback(
    (r) => !filtDraft.sub || String(r?.subscription_id || '') === String(filtDraft.sub),
    [filtDraft.sub])

  // Most panels never pass `resources`, which left Focus offering only the
  // subscription. Load the estate on first open of the drawer instead — the
  // payload is large, so never on mount.
  const [autoEstate, setAutoEstate] = useState(null)
  const [estateBusy, setEstateBusy] = useState(false)
  const estateReq = useRef(false)
  const estate = (resources && resources.length) ? resources : autoEstate

  useEffect(() => {
    if (!filtOpen || estate || estateReq.current) return
    // Guard with a ref, not state: a `busy` dependency would re-run this effect
    // and its cleanup would cancel the very fetch it just started.
    estateReq.current = true
    setEstateBusy(true)
    fetch('/api/resources')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const list = Array.isArray(j) ? j : (Array.isArray(j?.resources) ? j.resources : [])
        setAutoEstate(list)
      })
      .catch(() => setAutoEstate([]))
      .finally(() => setEstateBusy(false))
  }, [filtOpen, estate])

  const rgOptions = useMemo(() => {
    const s = new Set()
    ;(estate || []).forEach(r => { if (r?.resource_group && inSub(r)) s.add(r.resource_group) })
    return [...s].sort()
  }, [estate, inSub])

  const typeOptions = useMemo(() => {
    const s = new Set()
    ;(estate || []).forEach(r => {
      if (!r?.resource_type || !inSub(r)) return
      if (filtDraft.rg && r.resource_group !== filtDraft.rg) return
      s.add(r.resource_type)
    })
    return [...s].sort()
  }, [estate, inSub, filtDraft.rg])

  const resourceOptions = useMemo(() => {
    const out = []
    ;(estate || []).forEach(r => {
      const nm = r?.resource_name || r?.name
      if (!nm || !inSub(r)) return
      if (filtDraft.rg && r.resource_group !== filtDraft.rg) return
      if (filtDraft.rtype && r.resource_type !== filtDraft.rtype) return
      out.push({ id: r.resource_id || r.id || nm, name: nm, rg: r.resource_group || '' })
    })
    return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 600)
  }, [estate, inSub, filtDraft.rg, filtDraft.rtype])

  const resListId = useMemo(() => `ai-focus-res-${Math.random().toString(36).slice(2, 9)}`, [])

  const subOptions = useMemo(() => {
    const s = new Map()
    ;(estate || []).forEach(r => {
      if (r?.subscription_id) s.set(r.subscription_id, subNames[String(r.subscription_id).toLowerCase()] || r.subscription_id)
    })
    if (!s.size) Object.entries(subNames).forEach(([id, n]) => s.set(id, n))
    return [...s.entries()]
  }, [estate, subNames])

  const apply = useCallback((patch) => {
    setScopeOpen(false); setCtxOpen(false); setFiltOpen(false)
    onApply?.({ scope: value.scope, context: value.context, filters: value.filters, ...patch })
  }, [onApply, value])

  const activeFilters = describeFilters(value.filters, subNames)
  const ctxCount = Object.keys(value.context || {}).length

  return (
    <div style={{ marginBottom: compact ? 8 : 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <button style={btn(!!value.scope)} onClick={() => { setScopeDraft(value.scope || ''); setScopeOpen(o => !o); setCtxOpen(false); setFiltOpen(false) }}>
          <Crosshair size={11} /> Scope
        </button>
        <button style={btn(ctxCount > 0)} onClick={() => { setCtxDraft(value.context || {}); setCtxOpen(o => !o); setScopeOpen(false); setFiltOpen(false) }}>
          <SlidersHorizontal size={11} /> Context{ctxCount ? ` (${ctxCount})` : ''}
        </button>
        <button style={btn(!!activeFilters)} onClick={() => { setFiltDraft(value.filters || {}); setFiltOpen(o => !o); setScopeOpen(false); setCtxOpen(false) }}>
          <Filter size={11} /> Focus
        </button>
        <div style={{ position: 'relative' }} ref={expRef}>
          <button style={btn(false)} disabled={!report} onClick={() => setExpOpen(o => !o)}>
            <Download size={11} /> Export <ChevronDown size={10} />
          </button>
          {expOpen && report && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 60, minWidth: 168, ...drawer, padding: 4 }}>
              <button
                style={{ ...btn(false), width: '100%', justifyContent: 'flex-start', border: 'none' }}
                onClick={() => { exportAIAnalysisCSV(title, report, value, subNames); setExpOpen(false) }}>
                CSV (findings + resources)
              </button>
              <button
                style={{ ...btn(false), width: '100%', justifyContent: 'flex-start', border: 'none' }}
                onClick={async () => {
                  setExpOpen(false)
                  try {
                    const { generateAIReportPDF } = await import('../../utils/aiReportExport')
                    await generateAIReportPDF(title, title, report)
                  } catch { /* export unavailable */ }
                }}>
                PDF report
              </button>
            </div>
          )}
        </div>
        {busy && <Loader2 size={12} className="animate-spin" style={{ color: '#60a5fa' }} />}

        {(value.scope || ctxCount > 0 || activeFilters) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginLeft: 'auto' }}>
            {value.scope && (
              <span style={chip}>
                <Crosshair size={9} /> {value.scope.slice(0, 46)}
                <X size={10} style={{ cursor: 'pointer' }} onClick={() => apply({ scope: '' })} />
              </span>
            )}
            {ctxCount > 0 && (
              <span style={chip}>
                <SlidersHorizontal size={9} /> {ctxCount} context
                <X size={10} style={{ cursor: 'pointer' }} onClick={() => apply({ context: {} })} />
              </span>
            )}
            {activeFilters && (
              <span style={chip}>
                <Filter size={9} /> {activeFilters}
                <X size={10} style={{ cursor: 'pointer' }} onClick={() => apply({ filters: {} })} />
              </span>
            )}
          </div>
        )}
      </div>

      {scopeOpen && (
        <div style={drawer}>
          <div style={{ fontSize: 11, color: 'var(--c-94a3b8)', marginBottom: 6 }}>
            Narrow this analysis to one area. The AI keeps its deep-dive on what you pick.
          </div>
          <input
            style={inputStyle} value={scopeDraft} autoFocus
            placeholder="e.g. Internet-facing storage accounts in production"
            onChange={e => setScopeDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') apply({ scope: scopeDraft.trim() }) }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '8px 0' }}>
            {SCOPE_PRESETS.map(p => (
              <button key={p} style={{ ...btn(false), fontSize: 10 }} onClick={() => setScopeDraft(p)}>{p}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={btn(true)} onClick={() => apply({ scope: scopeDraft.trim() })}><Check size={11} /> Apply</button>
            <button style={btn(false)} onClick={() => apply({ scope: '' })}>Clear</button>
          </div>
        </div>
      )}

      {ctxOpen && (
        <div style={drawer}>
          <div style={{ fontSize: 11, color: 'var(--c-94a3b8)', marginBottom: 8 }}>
            Tell the AI about your organisation so findings and priorities fit your situation.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 8 }}>
            {CONTEXT_FIELDS.map(f => (
              <label key={f.key} style={{ fontSize: 10, color: 'var(--c-64748b)' }}>
                {f.label}
                <select
                  style={{ ...inputStyle, marginTop: 3 }}
                  value={ctxDraft[f.key] || ''}
                  onChange={e => setCtxDraft(d => ({ ...d, [f.key]: e.target.value }))}>
                  <option value="">—</option>
                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            ))}
          </div>
          <label style={{ fontSize: 10, color: 'var(--c-64748b)', display: 'block', marginTop: 8 }}>
            Notes for the AI
            <textarea
              rows={2} style={{ ...inputStyle, marginTop: 3, resize: 'vertical' }}
              placeholder="e.g. We are migrating out of the on-prem datacentre by March; dev/test may be aggressively optimised."
              value={ctxDraft.notes || ''}
              onChange={e => setCtxDraft(d => ({ ...d, notes: e.target.value }))} />
          </label>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              style={btn(true)}
              onClick={() => apply({
                context: Object.fromEntries(Object.entries(ctxDraft).filter(([, v]) => v && String(v).trim())),
              })}>
              <Check size={11} /> Apply
            </button>
            <button style={btn(false)} onClick={() => apply({ context: {} })}>Clear</button>
          </div>
        </div>
      )}

      {filtOpen && (
        <div style={drawer}>
          <div style={{ fontSize: 11, color: 'var(--c-94a3b8)', marginBottom: 8 }}>
            Narrow the estate the AI analyses. Each choice filters the next, so the
            combination is always valid. Apply re-runs the analysis on just that slice.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 8 }}>
            <label style={{ fontSize: 10, color: 'var(--c-64748b)' }}>
              Subscription
              <select style={{ ...inputStyle, marginTop: 3 }} value={filtDraft.sub || ''}
                      onChange={e => setFiltDraft({ sub: e.target.value })}>
                <option value="">All subscriptions</option>
                {subOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            {rgOptions.length > 0 && (
              <label style={{ fontSize: 10, color: 'var(--c-64748b)' }}>
                Resource group
                <select style={{ ...inputStyle, marginTop: 3 }} value={filtDraft.rg || ''}
                        onChange={e => setFiltDraft(d => ({ sub: d.sub, rg: e.target.value }))}>
                  <option value="">All resource groups</option>
                  {rgOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            )}
            {typeOptions.length > 0 && (
              <label style={{ fontSize: 10, color: 'var(--c-64748b)' }}>
                Resource type
                <select style={{ ...inputStyle, marginTop: 3 }} value={filtDraft.rtype || ''}
                        onChange={e => setFiltDraft(d => ({ sub: d.sub, rg: d.rg, rtype: e.target.value }))}>
                  <option value="">All types</option>
                  {typeOptions.map(o => <option key={o} value={o}>{o.split('/').pop()}</option>)}
                </select>
              </label>
            )}
            {resourceOptions.length > 0 && (
              <label style={{ fontSize: 10, color: 'var(--c-64748b)' }}>
                Single resource ({resourceOptions.length} available)
                {/* A free-text datalist rather than a select: the estate can run to
                    hundreds of resources and the user needs to type to find one. */}
                <input
                  list={resListId}
                  style={{ ...inputStyle, marginTop: 3 }}
                  placeholder="All resources — type to search"
                  defaultValue={filtDraft.res_name || ''}
                  onChange={e => {
                    const text = e.target.value.trim()
                    const hit = resourceOptions.find(o => o.name === text)
                    setFiltDraft(d => ({
                      ...d,
                      res: hit ? hit.id : undefined,
                      res_name: hit ? hit.name : undefined,
                    }))
                  }} />
                <datalist id={resListId}>
                  {resourceOptions.map(o => <option key={o.id} value={o.name}>{o.rg}</option>)}
                </datalist>
              </label>
            )}
          </div>
          {!estate?.length && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--c-64748b)', marginTop: 8 }}>
              {estateBusy && <Loader2 size={11} className="animate-spin" />}
              {estateBusy
                ? 'Loading the estate so you can focus on a resource group or a single resource…'
                : 'Resource group, type and single-resource focus need the estate — none loaded.'}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button style={btn(true)} onClick={() => apply({ filters: { ...filtDraft } })}><Check size={11} /> Apply &amp; re-run</button>
            <button style={btn(false)} onClick={() => { setFiltDraft({}); apply({ filters: {} }) }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AIControlsBar
