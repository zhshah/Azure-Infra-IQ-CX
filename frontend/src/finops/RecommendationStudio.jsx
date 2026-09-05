/**
 * Recommendation Studio — scope-driven, grounded, PERSONALIZED cost-optimization.
 *
 * The user sets a CONTEXT (subscription + resource group + optional region/tag),
 * chooses GOALS (reduce spend / clean up waste / right-size / optimize commitments /
 * improve tag compliance), sets CONSTRAINTS (exclude production, minimum $ impact) and
 * a PRIORITY lens (balanced / cost / effort / risk), plus optional business context.
 *
 * The backend returns DETERMINISTIC, grounded actions from the real per-resource scan
 * signals (each with $ impact, effort, risk, confidence, portal link and a ready-to-run
 * Azure CLI command) PLUS an AI-generated personalized phased roadmap that cites those
 * exact resources and dollars — not generic advice.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Target, Sparkles, Play, RefreshCw, AlertCircle, Filter, Copy, Check,
  ExternalLink, Zap, Tag, Server, ShieldCheck, TrendingDown, DollarSign,
  Layers, Gauge, ListChecks, Rocket,
} from 'lucide-react'
import { finopsApi, fmtUsd, getSubscriptions, getFilterOptions } from './finopsApi'
import SearchableSelect from '../components/shared/SearchableSelect'

const STORAGE_KEY = 'finops:reco:model:v1'

const GOALS = [
  { id: 'reduce_spend',   label: 'Reduce spend',      icon: TrendingDown },
  { id: 'waste_cleanup',  label: 'Clean up waste',    icon: Zap },
  { id: 'rightsizing',    label: 'Right-size',        icon: Server },
  { id: 'commitments',    label: 'Optimize commitments', icon: DollarSign },
  { id: 'tag_compliance', label: 'Tag compliance',    icon: Tag },
  { id: 'sustainability', label: 'Sustainability',    icon: ShieldCheck },
]
const PRIORITIES = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'cost',     label: 'Max savings' },
  { id: 'effort',   label: 'Least effort' },
  { id: 'risk',     label: 'Lowest risk' },
]
const CAT_META = {
  waste_cleanup:  { label: 'Waste cleanup', color: '#ef4444', icon: Zap },
  rightsizing:    { label: 'Right-size',    color: '#f59e0b', icon: Server },
  commitments:    { label: 'Commitments',   color: '#06b6d4', icon: DollarSign },
  tag_compliance: { label: 'Tag governance', color: '#a855f7', icon: Tag },
  advisor:        { label: 'Azure Advisor', color: '#22c55e', icon: ShieldCheck },
}
const IMPACT_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }
const LEVEL_COLOR = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' }

const DEFAULT_MODEL = {
  scope: { subscription_id: '', resource_group: '', region: '', tag_key: '', tag_value: '' },
  goals: ['reduce_spend'],
  priority: 'balanced',
  constraints: { exclude_production: false, min_impact_usd: 0 },
  context: { industry: '', org_size: '', notes: '' },
}

// ── Shared styles (match app dark theme) ──────────────────────────────────
const card      = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const inputStyle = { background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 9px', color: 'var(--c-e2e8f0)', fontSize: 12, width: '100%', boxSizing: 'border-box' }
const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#4f46e5', border: '1px solid #4f46e5', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', color: '#fff', fontSize: 13, fontWeight: 600 }
const secLabel  = { color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }
const miniLabel = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }

function toApiModel(m) {
  const s = m.scope || {}
  const filters = {}
  if (s.subscription_id) filters.subscription_id = s.subscription_id
  if (s.resource_group) filters.resource_group = s.resource_group
  if (s.region) filters.region = s.region
  if (s.tag_key) filters.tags = [{ key: s.tag_key, value: s.tag_value || '' }]
  const c = m.constraints || {}
  return {
    filters,
    goals: m.goals || [],
    priority: m.priority || 'balanced',
    constraints: {
      exclude_environments: c.exclude_production ? ['prod', 'production', 'prd'] : [],
      min_impact_usd: Number(c.min_impact_usd) || 0,
    },
    context: {
      industry: m.context?.industry || '',
      org_size: m.context?.org_size || '',
      notes: m.context?.notes || '',
    },
    include_ai: true,
    limit: 150,
  }
}

/* ── KPI tile ── */
function Kpi({ label, value, sub, icon: Icon, color = '#3b82f6' }) {
  return (
    <div style={{ ...card, padding: '12px 16px', flex: 1, minWidth: 150 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={miniLabel}>{label}</span>
        {Icon && <Icon size={14} style={{ color }} />}
      </div>
      <div style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--c-64748b)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

/* ── Copy-to-clipboard CLI button ── */
function CopyCli({ cli }) {
  const [copied, setCopied] = useState(false)
  if (!cli) return <span style={{ color: 'var(--c-475569)', fontSize: 11 }}>—</span>
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(cli).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}
      title={cli}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 5, padding: '3px 7px', cursor: 'pointer', color: copied ? '#22c55e' : 'var(--c-94a3b8)', fontSize: 10, fontFamily: 'monospace', maxWidth: 210, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy CLI'}
    </button>
  )
}

export default function RecommendationStudio() {
  const [model, setModel] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) return { ...DEFAULT_MODEL, ...JSON.parse(s) } } catch { /* ignore */ }
    return DEFAULT_MODEL
  })
  const [result, setResult]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [subOpts, setSubOpts] = useState([])
  const [rgOpts, setRgOpts]   = useState([])
  const [regionOpts, setRegionOpts] = useState([])
  const [tagKeys, setTagKeys] = useState([])
  const [tagVals, setTagVals] = useState([])
  const [catFilter, setCatFilter] = useState('all')

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(model)) } catch { /* ignore */ } }, [model])

  useEffect(() => {
    getSubscriptions().then(s => setSubOpts((s || []).map(x => ({ value: x.subscription_id, label: x.subscription_name || x.subscription_id })))).catch(() => {})
    getFilterOptions().then(o => {
      setRgOpts((o.resource_groups || []).map(v => (typeof v === 'string' ? { value: v, label: v } : { value: v.value, label: v.label ?? v.value })))
      setRegionOpts((o.regions || []).map(v => (typeof v === 'string' ? { value: v, label: v } : { value: v.value, label: v.label ?? v.value })))
      setTagKeys(o.tag_keys || [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const key = model.scope.tag_key
    if (!key) { setTagVals([]); return }
    let cancelled = false
    fetch(`/api/tags/values/${encodeURIComponent(key)}`)
      .then(r => r.ok ? r.json() : { values: [] })
      .then(d => { if (!cancelled) setTagVals(d.values || []) })
      .catch(() => { if (!cancelled) setTagVals([]) })
    return () => { cancelled = true }
  }, [model.scope.tag_key])

  const generate = useCallback(async (forceRefresh = false) => {
    setLoading(true); setError(null)
    try {
      const payload = { ...toApiModel(model), force_refresh: forceRefresh }
      setResult(await finopsApi.getRecommendations(payload))
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [model])

  // Auto-generate once on first open so the panel is never empty (uses the saved
  // model / defaults). The user can then refine scope & goals and regenerate.
  useEffect(() => { generate(false) /* eslint-disable-next-line */ }, [])

  // ── Mutators ──
  const setScope = (patch) => setModel(m => ({ ...m, scope: { ...m.scope, ...patch } }))
  const toggleGoal = (id) => setModel(m => ({ ...m, goals: m.goals.includes(id) ? m.goals.filter(g => g !== id) : [...m.goals, id] }))
  const setConstraint = (patch) => setModel(m => ({ ...m, constraints: { ...m.constraints, ...patch } }))
  const setContext = (patch) => setModel(m => ({ ...m, context: { ...m.context, ...patch } }))

  const recos = result?.recommendations
  const ai = result?.ai
  const actions = recos?.actions || []
  const cats = recos?.category_summary || {}
  const filtered = useMemo(
    () => (catFilter === 'all' ? actions : actions.filter(a => a.category === catFilter)),
    [actions, catFilter]
  )

  const exportXlsx = () => {
    if (!actions.length) return
    finopsApi.exportGenericXlsx({
      title: 'FinOps Recommendations',
      sheets: [{
        name: 'Recommendations',
        columns: ['Title', 'Category', 'Resource', 'Resource Group', 'Subscription', 'Monthly $', 'Effort', 'Risk', 'Confidence', 'CLI'],
        rows: actions.map(a => [a.title, a.category, a.resource_name, a.resource_group, a.subscription, a.monthly_impact_usd, a.effort, a.risk, a.confidence, a.cli || '']),
      }],
    }).catch(() => {})
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
            <Target size={20} style={{ color: '#4f46e5' }} /> Recommendation Studio
          </h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '4px 0 0' }}>
            Set your scope &amp; goals — get grounded, personalized actions from your real Azure estate, with $ impact and ready-to-run commands.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {actions.length > 0 && (
            <button onClick={exportXlsx} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 12 }}>
              Export XLSX
            </button>
          )}
          <button onClick={() => generate(false)} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {loading ? 'Analyzing…' : 'Generate recommendations'}
          </button>
        </div>
      </div>

      {/* Context / goals / constraints builder */}
      <div style={card}>
        <div style={secLabel}><Filter size={14} style={{ color: '#4f46e5' }} /> 1 · Set your context</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={miniLabel}>Subscription</div>
            <SearchableSelect value={model.scope.subscription_id} onChange={v => setScope({ subscription_id: v })} options={[{ value: '', label: 'All subscriptions' }, ...subOpts]} placeholder="All subscriptions" />
          </div>
          <div>
            <div style={miniLabel}>Resource group</div>
            <SearchableSelect value={model.scope.resource_group} onChange={v => setScope({ resource_group: v })} options={[{ value: '', label: 'All resource groups' }, ...rgOpts]} placeholder="All resource groups" />
          </div>
          <div>
            <div style={miniLabel}>Region</div>
            <SearchableSelect value={model.scope.region} onChange={v => setScope({ region: v })} options={[{ value: '', label: 'All regions' }, ...regionOpts]} placeholder="All regions" />
          </div>
          <div>
            <div style={miniLabel}>Tag key</div>
            <SearchableSelect value={model.scope.tag_key} onChange={v => setScope({ tag_key: v, tag_value: '' })} options={[{ value: '', label: '(none)' }, ...tagKeys.map(k => ({ value: k, label: k }))]} placeholder="(none)" />
          </div>
          {model.scope.tag_key && (
            <div>
              <div style={miniLabel}>Tag value</div>
              <SearchableSelect value={model.scope.tag_value} onChange={v => setScope({ tag_value: v })} options={[{ value: '', label: 'Any value' }, ...tagVals.map(v => ({ value: v, label: v }))]} placeholder="Any value" />
            </div>
          )}
        </div>

        <div style={secLabel}><ListChecks size={14} style={{ color: '#4f46e5' }} /> 2 · Choose your goals</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {GOALS.map(g => {
            const on = model.goals.includes(g.id)
            const Icon = g.icon
            return (
              <button key={g.id} onClick={() => toggleGoal(g.id)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 20, padding: '6px 13px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: on ? 'rgba(79,70,229,0.18)' : 'var(--c-0b1220)', border: `1px solid ${on ? '#4f46e5' : 'var(--c-334155)'}`, color: on ? 'var(--c-c7d2fe)' : 'var(--c-94a3b8)',
              }}>
                <Icon size={13} /> {g.label}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, alignItems: 'end' }}>
          <div>
            <div style={secLabel}><Gauge size={14} style={{ color: '#4f46e5' }} /> 3 · Priority lens</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRIORITIES.map(p => (
                <button key={p.id} onClick={() => setModel(m => ({ ...m, priority: p.id }))} style={{
                  borderRadius: 6, padding: '6px 11px', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                  background: model.priority === p.id ? '#4f46e5' : 'var(--c-0b1220)', border: `1px solid ${model.priority === p.id ? '#4f46e5' : 'var(--c-334155)'}`, color: model.priority === p.id ? '#fff' : 'var(--c-94a3b8)',
                }}>{p.label}</button>
              ))}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--c-cbd5e1)', fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!model.constraints.exclude_production} onChange={e => setConstraint({ exclude_production: e.target.checked })} />
            Exclude production resources
          </label>
          <div>
            <div style={miniLabel}>Minimum $ / month impact</div>
            <input type="number" min={0} value={model.constraints.min_impact_usd} onChange={e => setConstraint({ min_impact_usd: e.target.value })} style={inputStyle} placeholder="0" />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={secLabel}><Sparkles size={14} style={{ color: '#4f46e5' }} /> 4 · Business context (optional — personalizes the AI plan)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <input value={model.context.industry} onChange={e => setContext({ industry: e.target.value })} style={inputStyle} placeholder="Industry (e.g. Banking)" />
            <input value={model.context.org_size} onChange={e => setContext({ org_size: e.target.value })} style={inputStyle} placeholder="Org size (e.g. Enterprise)" />
            <input value={model.context.notes} onChange={e => setContext({ notes: e.target.value })} style={inputStyle} placeholder="Notes / priorities (e.g. protect prod, cut dev/test)" />
          </div>
        </div>
      </div>

      {error && (
        <div style={{ ...card, borderColor: 'var(--c-7f1d1d)', color: 'var(--c-fca5a5)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={16} /> <span style={{ fontSize: 12 }}>{error}</span>
        </div>
      )}

      {/* Results */}
      {recos && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Kpi label="Actions found" value={recos.action_count ?? 0} icon={ListChecks} color="#4f46e5" />
            <Kpi label="Est. monthly savings" value={fmtUsd(recos.projected_monthly_savings_usd)} sub={`${fmtUsd(recos.projected_annual_savings_usd)}/yr potential`} icon={TrendingDown} color="#22c55e" />
            <Kpi label="In-scope spend" value={fmtUsd(recos.context?.in_scope_spend_usd)} sub={`${recos.context?.resource_count ?? 0} resources${recos.context?.scoped ? ' (scoped)' : ''}`} icon={DollarSign} color="#3b82f6" />
            <Kpi label="Priority lens" value={(recos.context?.priority || 'balanced').replace(/^\w/, c => c.toUpperCase())} sub={(recos.context?.goals || []).join(', ') || 'all goals'} icon={Gauge} color="#f59e0b" />
          </div>

          {/* AI personalized plan */}
          <div style={{ ...card, borderColor: '#4f46e5', background: 'linear-gradient(180deg, rgba(79,70,229,0.08), var(--c-111827))' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={secLabel}><Rocket size={15} style={{ color: '#818cf8' }} /> AI action plan — personalized for your scope &amp; goals</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {ai?.provider && ai.provider !== 'none' && (
                  <span style={{ fontSize: 10, color: 'var(--c-64748b)', border: '1px solid var(--c-334155)', borderRadius: 4, padding: '2px 6px' }}>
                    {ai.cached ? '⚡ cached' : '✦'} {ai.provider}
                  </span>
                )}
                <button onClick={() => generate(true)} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', color: '#818cf8', fontSize: 11 }}>
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
            </div>
            {ai?.summary
              ? (
                <>
                  <p style={{ color: 'var(--c-e2e8f0)', fontSize: 13, lineHeight: 1.6, margin: '0 0 12px' }}>{ai.summary}</p>
                  {(ai.key_findings || []).length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={miniLabel}>Key findings</div>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--c-cbd5e1)', fontSize: 12, lineHeight: 1.7 }}>
                        {ai.key_findings.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                  )}
                  {(ai.recommendations || []).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={miniLabel}>Recommended plan</div>
                      {ai.recommendations.map((r, i) => (
                        <div key={i} style={{ background: 'var(--c-0b1220)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: '10px 12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                            <span style={{ color: 'var(--c-f1f5f9)', fontSize: 13, fontWeight: 600 }}>{r.title}</span>
                            <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                              {r.est_monthly_savings > 0 && <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 700 }}>{fmtUsd(r.est_monthly_savings)}/mo</span>}
                              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: IMPACT_COLOR[r.impact] || '#94a3b8', border: `1px solid ${IMPACT_COLOR[r.impact] || '#94a3b8'}55`, borderRadius: 4, padding: '1px 6px' }}>{r.impact}</span>
                            </span>
                          </div>
                          {r.detail && <p style={{ color: 'var(--c-94a3b8)', fontSize: 12, lineHeight: 1.5, margin: '5px 0 0' }}>{r.detail}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {(ai.risk_flags || []).length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ ...miniLabel, color: '#f59e0b' }}>Watch-outs</div>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: '#fcd9a8', fontSize: 12, lineHeight: 1.6 }}>
                        {ai.risk_flags.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              )
              : <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>{ai?.summary || 'AI plan not available — showing the deterministic action list below.'}</p>}
          </div>

          {/* Category chips + action table */}
          {Object.keys(cats).length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => setCatFilter('all')} style={{ borderRadius: 20, padding: '5px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: catFilter === 'all' ? 'var(--c-1e293b)' : 'var(--c-0b1220)', border: `1px solid ${catFilter === 'all' ? 'var(--c-475569)' : 'var(--c-1e293b)'}`, color: 'var(--c-e2e8f0)' }}>
                All ({actions.length})
              </button>
              {Object.entries(cats).map(([c, v]) => {
                const meta = CAT_META[c] || { label: c, color: '#94a3b8', icon: Layers }
                const Icon = meta.icon
                return (
                  <button key={c} onClick={() => setCatFilter(c)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 20, padding: '5px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: catFilter === c ? `${meta.color}22` : 'var(--c-0b1220)', border: `1px solid ${catFilter === c ? meta.color : 'var(--c-1e293b)'}`, color: catFilter === c ? meta.color : 'var(--c-94a3b8)' }}>
                    <Icon size={12} /> {meta.label} ({v.count}) · {fmtUsd(v.monthly_impact_usd)}/mo
                  </button>
                )
              })}
            </div>
          )}

          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--c-0b1220)', color: 'var(--c-64748b)', textAlign: 'left' }}>
                    {['Action', 'Category', 'Resource', '$ / month', 'Effort', 'Risk', 'Conf.', 'CLI', ''].map((h, i) => (
                      <th key={i} style={{ padding: '9px 12px', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: 'var(--c-64748b)' }}>
                      {actions.length === 0 ? 'No actions — click "Generate recommendations".' : 'No actions in this category.'}
                    </td></tr>
                  )}
                  {filtered.map((a, i) => {
                    const meta = CAT_META[a.category] || { label: a.category, color: '#94a3b8' }
                    return (
                      <tr key={a.id || i} style={{ borderTop: '1px solid var(--c-1e293b)' }}>
                        <td style={{ padding: '9px 12px', maxWidth: 260 }}>
                          <div style={{ color: 'var(--c-f1f5f9)', fontWeight: 600 }}>{a.title}</div>
                          <div style={{ color: 'var(--c-64748b)', fontSize: 11, marginTop: 2 }}>{a.rationale}</div>
                        </td>
                        <td style={{ padding: '9px 12px' }}><span style={{ color: meta.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{meta.label}</span></td>
                        <td style={{ padding: '9px 12px' }}>
                          <div style={{ color: 'var(--c-cbd5e1)' }}>{a.resource_name || '—'}</div>
                          <div style={{ color: 'var(--c-475569)', fontSize: 10 }}>{a.resource_group}{a.region ? ` · ${a.region}` : ''}</div>
                        </td>
                        <td style={{ padding: '9px 12px', color: a.monthly_impact_usd > 0 ? '#22c55e' : 'var(--c-64748b)', fontWeight: 700, whiteSpace: 'nowrap' }}>{a.monthly_impact_usd > 0 ? `${fmtUsd(a.monthly_impact_usd)}` : '—'}</td>
                        <td style={{ padding: '9px 12px' }}><span style={{ color: LEVEL_COLOR[a.effort] }}>{a.effort}</span></td>
                        <td style={{ padding: '9px 12px' }}><span style={{ color: LEVEL_COLOR[a.risk] }}>{a.risk}</span></td>
                        <td style={{ padding: '9px 12px', color: 'var(--c-94a3b8)' }}>{a.confidence}</td>
                        <td style={{ padding: '9px 12px' }}><CopyCli cli={a.cli} /></td>
                        <td style={{ padding: '9px 12px' }}>
                          {a.portal_url && <a href={a.portal_url} target="_blank" rel="noreferrer" title="Open in Azure Portal" style={{ color: '#60a5fa', display: 'inline-flex' }}><ExternalLink size={14} /></a>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!recos && !loading && (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--c-64748b)' }}>
          <Target size={30} style={{ color: '#4f46e5', marginBottom: 10 }} />
          <div style={{ fontSize: 14, color: 'var(--c-cbd5e1)', fontWeight: 600 }}>Set your scope and goals, then generate</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Recommendations are grounded in your real Azure estate and personalized to the context you choose.</div>
        </div>
      )}
    </div>
  )
}
