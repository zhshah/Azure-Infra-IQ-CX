/**
 * Chargeback / Showback — a real cost-allocation engine.
 *
 * The user DEFINES the chargeback model:
 *   1. Cost centers (business units / teams) with owner + optional weight/headcount.
 *   2. Ordered allocation rules (first match wins) mapping resources → a cost center
 *      by Tag / Subscription / Resource Group / Resource Type / Region.
 *   3. How the shared/unmatched pool is spread (proportional / even / weighted /
 *      headcount / leave unallocated).
 *   4. An optional overhead markup %.
 * The backend computes the statement against the live per-resource cost cache
 * (throttling-immune) and returns direct + allocated-shared + markup per cost center.
 *
 * Model is saved to localStorage so it is reusable across sessions.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  Plus, Trash2, Play, RefreshCw, AlertCircle, Building2, Users, Percent,
  CheckCircle2, Settings2, DollarSign, Sparkles, GripVertical,
} from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct, getSubscriptions, getFilterOptions } from './finopsApi'
import SearchableSelect from '../components/shared/SearchableSelect'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'

// ── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'finops:chargeback:model:v1'
const uid = () => Math.random().toString(36).slice(2, 9)

const RULE_TYPES = [
  { value: 'tag',            label: 'Tag' },
  { value: 'subscription',   label: 'Subscription' },
  { value: 'resource_group', label: 'Resource Group' },
  { value: 'resource_type',  label: 'Resource Type' },
  { value: 'region',         label: 'Region' },
]
const ALLOC_METHODS = [
  { value: 'proportional', label: 'Proportional to direct cost' },
  { value: 'even',         label: 'Even split across cost centers' },
  { value: 'weighted',     label: 'Weighted (custom %)' },
  { value: 'headcount',    label: 'By headcount' },
  { value: 'none',         label: 'Leave unallocated (showback only)' },
]
const COST_FIELDS = [
  { value: 'current',  label: 'This month' },
  { value: 'previous', label: 'Last month' },
]

const DEFAULT_MODEL = { costCenters: [], rules: [], sharedAllocation: 'proportional', markupPct: 0, costField: 'current' }
const SERIES = [
  { key: 'Direct',  color: '#3b82f6' },
  { key: 'Shared',  color: '#f59e0b' },
  { key: 'Markup',  color: '#8b5cf6' },
]

// ── Shared styles ──────────────────────────────────────────────────────────
const card       = { background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }
const inputStyle = { background: 'var(--c-0b1220)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 9px', color: 'var(--c-e2e8f0)', fontSize: 12, width: '100%', boxSizing: 'border-box' }
const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#4f46e5', border: '1px solid #4f46e5', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 600 }
const btnGhost   = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: 'var(--c-cbd5e1)', fontSize: 11 }
const iconBtn    = { background: 'none', border: 'none', color: 'var(--c-64748b)', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center' }
const secLabel   = { color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }
const miniLabel  = { color: 'var(--c-64748b)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }

function toApiModel(m) {
  return {
    cost_centers: (m.costCenters || []).map(c => ({ id: c.id, name: c.name, owner: c.owner, weight: Number(c.weight) || 0, headcount: Number(c.headcount) || 0 })),
    rules: (m.rules || []).map(r => ({ id: r.id, type: r.type, match_key: r.matchKey || '', match_value: r.matchValue || '', cost_center_id: r.costCenterId || '' })),
    shared_allocation: m.sharedAllocation,
    markup_pct: Number(m.markupPct) || 0,
    cost_field: m.costField,
  }
}

// ── Rule row (value editor adapts to the rule type) ──────────────────────────
function RuleRow({ rule, index, ccOptions, subOpts, rgOpts, typeOpts, regionOpts, tagKeys, onUpdate, onRemove }) {
  const [tagVals, setTagVals] = useState([])
  useEffect(() => {
    if (rule.type !== 'tag' || !rule.matchKey) { setTagVals([]); return }
    let cancelled = false
    fetch(`/api/tags/values/${encodeURIComponent(rule.matchKey)}`)
      .then(r => r.ok ? r.json() : { values: [] })
      .then(d => { if (!cancelled) setTagVals(d.values || []) })
      .catch(() => { if (!cancelled) setTagVals([]) })
    return () => { cancelled = true }
  }, [rule.type, rule.matchKey])

  const valueOptions = rule.type === 'subscription' ? subOpts
    : rule.type === 'resource_group' ? rgOpts
    : rule.type === 'resource_type' ? typeOpts
    : rule.type === 'region' ? regionOpts
    : tagVals.map(v => ({ value: v, label: v }))

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 6 }}>
      <GripVertical size={13} style={{ color: 'var(--c-334155)', marginBottom: 8, flexShrink: 0 }} />
      <div style={{ width: 34, textAlign: 'center', color: 'var(--c-475569)', fontSize: 11, marginBottom: 8 }}>{index + 1}</div>
      <div style={{ flex: 1.2, minWidth: 0 }}>
        <div style={miniLabel}>Match by</div>
        <SearchableSelect value={rule.type} onChange={v => onUpdate(index, { type: v, matchKey: '', matchValue: '' })} options={RULE_TYPES} compact />
      </div>
      {rule.type === 'tag' && (
        <div style={{ flex: 1.2, minWidth: 0 }}>
          <div style={miniLabel}>Tag key</div>
          <SearchableSelect value={rule.matchKey} onChange={v => onUpdate(index, { matchKey: v, matchValue: '' })} options={tagKeys.map(k => ({ value: k, label: k }))} placeholder="key…" compact />
        </div>
      )}
      <div style={{ flex: 1.6, minWidth: 0 }}>
        <div style={miniLabel}>Equals</div>
        <SearchableSelect value={rule.matchValue} onChange={v => onUpdate(index, { matchValue: v })} options={valueOptions} placeholder={rule.type === 'tag' && !rule.matchKey ? 'pick key first' : 'value…'} disabled={rule.type === 'tag' && !rule.matchKey} compact />
      </div>
      <div style={{ color: 'var(--c-475569)', fontSize: 13, marginBottom: 8 }}>→</div>
      <div style={{ flex: 1.4, minWidth: 0 }}>
        <div style={miniLabel}>Cost center</div>
        <SearchableSelect value={rule.costCenterId} onChange={v => onUpdate(index, { costCenterId: v })} options={ccOptions} placeholder="assign…" compact />
      </div>
      <button onClick={() => onRemove(index)} style={{ ...iconBtn, marginBottom: 5 }} title="Remove rule"><Trash2 size={13} /></button>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ChargebackPanel() {
  const [model, setModel] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) return { ...DEFAULT_MODEL, ...JSON.parse(s) } } catch { /* ignore */ }
    return DEFAULT_MODEL
  })
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [subOpts, setSubOpts] = useState([])
  const [rgOpts,  setRgOpts]  = useState([])
  const [typeOpts, setTypeOpts] = useState([])
  const [regionOpts, setRegionOpts] = useState([])
  const [tagKeys, setTagKeys] = useState([])
  const [seeding, setSeeding] = useState(false)

  // Persist model
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(model)) } catch { /* ignore */ } }, [model])

  // Load filter options once
  useEffect(() => {
    getSubscriptions().then(s => setSubOpts((s || []).map(x => ({ value: x.subscription_id, label: x.subscription_name || x.subscription_id })))).catch(() => {})
    getFilterOptions().then(o => {
      const norm = (arr) => (arr || []).map(v => (typeof v === 'string' ? { value: v, label: v } : { value: v.value, label: v.label ?? v.value }))
      setRgOpts(norm(o.resource_groups)); setTypeOpts(norm(o.resource_types)); setRegionOpts(norm(o.regions))
      setTagKeys(o.tag_keys || [])
    }).catch(() => {})
  }, [])

  const compute = useCallback(async (m) => {
    const mdl = m || model
    if (!(mdl.costCenters || []).length) { setResult(null); return }
    setLoading(true); setError(null)
    try { setResult(await finopsApi.computeChargeback(toApiModel(mdl))) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [model])

  // Auto-compute on first mount if a model already exists
  useEffect(() => { if ((model.costCenters || []).length) compute(model) /* eslint-disable-next-line */ }, [])

  // ── Model mutators ──
  const addCostCenter = () => setModel(m => ({ ...m, costCenters: [...m.costCenters, { id: uid(), name: '', owner: '', weight: 1, headcount: 0 }] }))
  const updateCostCenter = (id, patch) => setModel(m => ({ ...m, costCenters: m.costCenters.map(c => c.id === id ? { ...c, ...patch } : c) }))
  const removeCostCenter = (id) => setModel(m => ({ ...m, costCenters: m.costCenters.filter(c => c.id !== id), rules: m.rules.map(r => r.costCenterId === id ? { ...r, costCenterId: '' } : r) }))
  const addRule = () => setModel(m => ({ ...m, rules: [...m.rules, { id: uid(), type: 'tag', matchKey: 'CostCenter', matchValue: '', costCenterId: '' }] }))
  const updateRule = (index, patch) => setModel(m => ({ ...m, rules: m.rules.map((r, i) => i === index ? { ...r, ...patch } : r) }))
  const removeRule = (index) => setModel(m => ({ ...m, rules: m.rules.filter((_, i) => i !== index) }))

  // Seed cost centers + rules from the existing CostCenter tag values
  const seedFromTag = async () => {
    setSeeding(true); setError(null)
    try {
      const r = await fetch('/api/tags/values/CostCenter')
      const d = r.ok ? await r.json() : { values: [] }
      const vals = (d.values || []).filter(Boolean)
      if (!vals.length) { setError('No CostCenter tag values found on your resources to seed from.'); setSeeding(false); return }
      const next = { ...model, costCenters: [], rules: [] }
      for (const v of vals) {
        const id = uid()
        next.costCenters.push({ id, name: v, owner: '', weight: 1, headcount: 0 })
        next.rules.push({ id: uid(), type: 'tag', matchKey: 'CostCenter', matchValue: v, costCenterId: id })
      }
      setModel(next)
      await compute(next)
    } catch (e) { setError(e.message) }
    finally { setSeeding(false) }
  }

  const ccOptions = useMemo(() => (model.costCenters || []).map(c => ({ value: c.id, label: c.name || '(unnamed)' })), [model.costCenters])
  const showWeight = model.sharedAllocation === 'weighted'
  const showHeadcount = model.sharedAllocation === 'headcount'

  const chartData = useMemo(() => (result?.cost_centers || []).map(c => ({
    name: c.name, Direct: c.direct_usd, Shared: c.allocated_shared_usd, Markup: c.markup_usd,
  })), [result])

  const aiData = result ? {
    method: result.shared_allocation_method, markup_pct: result.markup_pct,
    total_spend_usd: result.total_spend_usd, chargeback_total_usd: result.chargeback_total_usd,
    coverage_pct: result.coverage_pct, unallocated_usd: result.unallocated_usd,
    cost_centers: (result.cost_centers || []).slice(0, 12).map(c => ({ name: c.name, total: c.total_usd, direct: c.direct_usd, shared: c.allocated_shared_usd, markup: c.markup_usd, pct: c.pct_of_total })),
  } : {}

  const kpis = result ? [
    { label: 'Total cloud spend', value: fmtUsd(result.total_spend_usd),      color: '#3b82f6', Icon: DollarSign },
    { label: 'Chargeback total',  value: fmtUsd(result.chargeback_total_usd), color: '#8b5cf6', Icon: Percent, sub: result.markup_pct ? `incl. ${result.markup_pct}% markup` : 'no markup' },
    { label: 'Allocation coverage', value: fmtPct(result.coverage_pct),        color: result.coverage_pct >= 90 ? '#22c55e' : result.coverage_pct >= 60 ? '#f59e0b' : '#ef4444', Icon: CheckCircle2 },
    { label: 'Shared pool',       value: fmtUsd(result.shared_pool_usd),      color: '#f59e0b', Icon: Users, sub: `${result.unmatched_resource_count} resources` },
    { label: 'Unallocated',       value: fmtUsd(result.unallocated_usd),      color: result.unallocated_usd > 0.5 ? '#ef4444' : 'var(--c-64748b)', Icon: AlertCircle },
    { label: 'Cost centers',      value: String(result.cost_center_count),     color: 'var(--c-cbd5e1)', Icon: Building2 },
  ] : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={18} style={{ color: '#818cf8' }} /> Chargeback
          </h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '2px 0 0 0' }}>
            Define allocation rules → distribute shared costs → apply markup → charge each business unit. Model saved locally.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => compute()} disabled={loading || !(model.costCenters || []).length} style={{ ...btnPrimary, opacity: (loading || !(model.costCenters || []).length) ? 0.55 : 1 }}>
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />} Compute chargeback
          </button>
          {result && (model.costCenters || []).length > 0 && (
            <FinOpsExportMenu view="chargeback" report={{
              title: 'Chargeback Statement',
              kpis: [
                { label: 'Total cloud spend', value: fmtUsd(result.total_spend_usd) },
                { label: 'Chargeback total',  value: fmtUsd(result.chargeback_total_usd) },
                { label: 'Coverage',          value: fmtPct(result.coverage_pct) },
                { label: 'Markup',            value: `${result.markup_pct}%` },
              ],
              tables: [{
                title: 'Chargeback by cost center',
                columns: ['Cost Center', 'Owner', 'Direct', 'Allocated Shared', 'Markup', 'Total', '% of Total'],
                rows: (result.cost_centers || []).map(c => [c.name, c.owner || '—', fmtUsd(c.direct_usd), fmtUsd(c.allocated_shared_usd), fmtUsd(c.markup_usd), fmtUsd(c.total_usd), fmtPct(c.pct_of_total)]),
              }],
            }} />
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 8, padding: 12, color: 'var(--c-fca5a5)', fontSize: 12, display: 'flex', gap: 8 }}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} />{error}
        </div>
      )}

      {/* AI narrative */}
      <FinOpsAIPanel view="chargeback" title="AI chargeback narrative" data={aiData} />

      {/* ── Design: cost centers + rules + policy ── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={secLabel}><Settings2 size={15} style={{ color: '#818cf8' }} /> Chargeback model</div>
          <button onClick={seedFromTag} disabled={seeding} style={btnGhost} title="Create a cost center + rule for every CostCenter tag value on your resources">
            {seeding ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />} Auto-seed from CostCenter tag
          </button>
        </div>

        {/* Cost centers */}
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600 }}>Cost centers ({model.costCenters.length})</span>
            <button onClick={addCostCenter} style={btnGhost}><Plus size={12} /> Add cost center</button>
          </div>
          {model.costCenters.length === 0 && (
            <div style={{ color: 'var(--c-475569)', fontSize: 12, padding: '10px 0' }}>No cost centers yet. Add one, or auto-seed from your CostCenter tag.</div>
          )}
          {model.costCenters.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 2, minWidth: 0 }}>
                <div style={miniLabel}>Name</div>
                <input value={c.name} onChange={e => updateCostCenter(c.id, { name: e.target.value })} placeholder="e.g. Engineering" style={inputStyle} />
              </div>
              <div style={{ flex: 2, minWidth: 0 }}>
                <div style={miniLabel}>Owner</div>
                <input value={c.owner} onChange={e => updateCostCenter(c.id, { owner: e.target.value })} placeholder="owner@company.com" style={inputStyle} />
              </div>
              {showWeight && (
                <div style={{ width: 90 }}>
                  <div style={miniLabel}>Weight %</div>
                  <input type="number" min="0" value={c.weight} onChange={e => updateCostCenter(c.id, { weight: e.target.value })} style={inputStyle} />
                </div>
              )}
              {showHeadcount && (
                <div style={{ width: 90 }}>
                  <div style={miniLabel}>Headcount</div>
                  <input type="number" min="0" value={c.headcount} onChange={e => updateCostCenter(c.id, { headcount: e.target.value })} style={inputStyle} />
                </div>
              )}
              <button onClick={() => removeCostCenter(c.id)} style={{ ...iconBtn, marginBottom: 5 }} title="Remove cost center"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>

        {/* Rules */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600 }}>Allocation rules ({model.rules.length}) · <span style={{ color: 'var(--c-475569)', fontWeight: 400 }}>evaluated top-to-bottom, first match wins</span></span>
            <button onClick={addRule} disabled={!model.costCenters.length} style={{ ...btnGhost, opacity: model.costCenters.length ? 1 : 0.5 }}><Plus size={12} /> Add rule</button>
          </div>
          {model.rules.length === 0 && (
            <div style={{ color: 'var(--c-475569)', fontSize: 12, padding: '10px 0' }}>No rules. Resources with no matching rule fall into the shared pool below.</div>
          )}
          {model.rules.map((r, i) => (
            <RuleRow key={r.id} rule={r} index={i} ccOptions={ccOptions} subOpts={subOpts} rgOpts={rgOpts} typeOpts={typeOpts} regionOpts={regionOpts} tagKeys={tagKeys} onUpdate={updateRule} onRemove={removeRule} />
          ))}
        </div>

        {/* Policy: shared allocation + markup + period */}
        <div style={{ marginTop: 18, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', borderTop: '1px solid var(--c-1e293b)', paddingTop: 14 }}>
          <div style={{ minWidth: 240 }}>
            <div style={miniLabel}>Shared / unmatched cost allocation</div>
            <SearchableSelect value={model.sharedAllocation} onChange={v => setModel(m => ({ ...m, sharedAllocation: v }))} options={ALLOC_METHODS} compact />
          </div>
          <div style={{ width: 120 }}>
            <div style={miniLabel}>Overhead markup %</div>
            <input type="number" min="0" step="1" value={model.markupPct} onChange={e => setModel(m => ({ ...m, markupPct: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ width: 150 }}>
            <div style={miniLabel}>Billing period</div>
            <SearchableSelect value={model.costField} onChange={v => setModel(m => ({ ...m, costField: v }))} options={COST_FIELDS} compact />
          </div>
        </div>
      </div>

      {/* ── Statement ── */}
      {loading && !result && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20 }}>
          <RefreshCw size={16} className="animate-spin" style={{ color: '#3b82f6' }} />
          <span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>Computing chargeback…</span>
        </div>
      )}

      {result && (result.cost_centers || []).length > 0 && (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            {kpis.map((k, i) => {
              const Icon = k.Icon
              return (
                <div key={i} style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
                    <Icon size={12} style={{ color: k.color }} /> {k.label}
                  </div>
                  <div style={{ color: k.color, fontSize: 19, fontWeight: 700 }}>{k.value}</div>
                  {k.sub && <div style={{ color: 'var(--c-475569)', fontSize: 10, marginTop: 2 }}>{k.sub}</div>}
                </div>
              )
            })}
          </div>

          {/* Reconciliation banner */}
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, borderRadius: 8, padding: '9px 12px',
            background: result.reconciled ? 'var(--c-0d2b1f)' : 'var(--c-1c1003)',
            border: `1px solid ${result.reconciled ? 'var(--c-166534)' : '#854d0e'}`,
            color: result.reconciled ? 'var(--c-4ade80)' : 'var(--c-fbbf24)',
          }}>
            {result.reconciled ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {result.reconciled
              ? `Reconciled — 100% of ${fmtUsd(result.total_spend_usd)} spend is accounted for (${fmtUsd(result.total_direct_usd)} direct + ${fmtUsd(result.shared_distributed_usd)} shared${result.unallocated_usd > 0.5 ? ` + ${fmtUsd(result.unallocated_usd)} unallocated` : ''}).`
              : `${fmtUsd(result.unallocated_usd)} of shared cost is left unallocated (method: showback only). Switch shared allocation to distribute it.`}
          </div>

          {/* Stacked bar per cost center */}
          <div style={card}>
            <div style={secLabel}><DollarSign size={15} style={{ color: '#3b82f6' }} /> Allocation by cost center</div>
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 46 + 40)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke="#475569" fontSize={10} tickFormatter={v => `$${Math.round(v).toLocaleString()}`} />
                <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={11} width={140} />
                <Tooltip formatter={v => fmtUsd(v)} contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }} cursor={{ fill: '#1e293b55' }} />
                <Legend iconSize={9} wrapperStyle={{ fontSize: 11, color: 'var(--c-94a3b8)' }} />
                {SERIES.map(s => <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} radius={s.key === 'Markup' ? [0, 3, 3, 0] : 0} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Statement table */}
          <div style={card}>
            <div style={secLabel}><Building2 size={15} style={{ color: '#818cf8' }} /> Chargeback statement</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>{['Cost Center', 'Owner', 'Direct', 'Allocated Shared', 'Markup', 'Total', '% of Total', 'Resources'].map((h, i) => (
                    <th key={h} style={{ textAlign: i >= 2 && i <= 6 ? 'right' : 'left', color: 'var(--c-475569)', padding: '6px 10px', borderBottom: '1px solid var(--c-1e293b)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {result.cost_centers.map((c, i) => (
                    <tr key={c.id || i} style={{ borderBottom: '1px solid var(--c-0f172a)' }}>
                      <td style={{ padding: '7px 10px', color: 'var(--c-e2e8f0)', fontWeight: 600 }}>{c.name}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--c-64748b)', fontSize: 11 }}>{c.owner || '—'}</td>
                      <td style={{ padding: '7px 10px', color: '#60a5fa', textAlign: 'right' }}>{fmtUsd(c.direct_usd)}</td>
                      <td style={{ padding: '7px 10px', color: '#fbbf24', textAlign: 'right' }}>{fmtUsd(c.allocated_shared_usd)}</td>
                      <td style={{ padding: '7px 10px', color: '#a78bfa', textAlign: 'right' }}>{fmtUsd(c.markup_usd)}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--c-e2e8f0)', fontWeight: 700, textAlign: 'right' }}>{fmtUsd(c.total_usd)}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--c-94a3b8)', textAlign: 'right' }}>{fmtPct(c.pct_of_total)}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--c-475569)', textAlign: 'right' }}>{c.resource_count}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--c-1e293b)' }}>
                    <td style={{ padding: '8px 10px', color: 'var(--c-cbd5e1)', fontWeight: 700 }} colSpan={2}>Total</td>
                    <td style={{ padding: '8px 10px', color: '#60a5fa', textAlign: 'right', fontWeight: 700 }}>{fmtUsd(result.total_direct_usd)}</td>
                    <td style={{ padding: '8px 10px', color: '#fbbf24', textAlign: 'right', fontWeight: 700 }}>{fmtUsd(result.shared_distributed_usd)}</td>
                    <td style={{ padding: '8px 10px', color: '#a78bfa', textAlign: 'right', fontWeight: 700 }}>{fmtUsd(result.markup_total_usd)}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--c-f1f5f9)', textAlign: 'right', fontWeight: 700 }}>{fmtUsd(result.chargeback_total_usd)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--c-94a3b8)', fontWeight: 700 }}>100%</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--c-475569)' }}>{result.matched_resource_count}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {result && (result.cost_centers || []).length === 0 && !loading && (
        <div style={{ ...card, color: 'var(--c-475569)', fontSize: 12, textAlign: 'center', padding: 30 }}>
          Add at least one cost center and a rule, then click <b style={{ color: 'var(--c-94a3b8)' }}>Compute chargeback</b>.
        </div>
      )}
    </div>
  )
}

