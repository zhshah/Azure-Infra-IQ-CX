/**
 * FinOpsAIPanel — reusable AI analysis + recommendations block.
 *
 * Drop into any FinOps view: <FinOpsAIPanel view="overview" data={kpiSummary} />
 * It calls /api/finops/ai/insights (Azure OpenAI / Claude, Redis-cached), and
 * renders an executive summary, key findings, recommendations (with impact +
 * estimated savings) and risk flags. A "Refresh analysis" button forces a fresh
 * generation (new tokens). Auto-loads when the supplied data changes.
 *
 * Rules of Hooks: every hook is declared unconditionally before any return.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Brain, RefreshCw, AlertTriangle, Lightbulb, ChevronDown, ChevronRight, Sparkles, Crosshair, X, Check, SlidersHorizontal, MessageCircleQuestion } from 'lucide-react'
import { finopsApi, fmtUsd } from './finopsApi'

const IMPACT_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }

// Quick-pick focus areas for the “Scope this analysis” advanced feature.
const SCOPE_PRESETS = [
  'Compute / VMs', 'Storage', 'Networking', 'Databases (SQL / Cosmos)',
  'AI / ML services', 'Containers / AKS', 'Backup & DR',
  'Rightsizing opportunities', 'Reservations & Savings Plans',
  'Idle & orphaned waste', 'Cost anomalies & spikes',
  'Tagging & cost allocation', 'Forecast & budget risk',
]

// Starter questions for the free-text “Ask” feature.
const ASK_PRESETS = [
  'What are my top 3 cost drivers and why?',
  'Where can I save the most with least risk?',
  'What changed vs last month?',
  'Which spend is untagged or unallocated?',
  'Am I on track against budget?',
  'What should I show the executive team?',
]

// Structured business-context inputs — dropdowns that ground the AI's recommendations.
const CONTEXT_FIELDS = [
  { key: 'industry',    label: 'Industry',          options: ['Financial Services', 'Healthcare', 'Retail / e-Commerce', 'Manufacturing', 'Public Sector', 'Technology / SaaS', 'Education', 'Energy / Utilities', 'Media & Entertainment', 'Telecom', 'Other'] },
  { key: 'org_size',    label: 'Organization size', options: ['Startup (<50)', 'SMB (50–500)', 'Mid-market (500–5k)', 'Enterprise (5k–50k)', 'Large enterprise (50k+)'] },
  { key: 'environment', label: 'Environment mix',   options: ['Mostly Production', 'Mostly Dev/Test', 'Balanced Prod & Non-prod', 'Regulated / Compliance-heavy'] },
  { key: 'priority',    label: 'Primary goal',      options: ['Reduce overall cost', 'Improve cost allocation / showback', 'Increase forecast accuracy', 'Optimize commitments (RI / SP)', 'Eliminate idle & waste', 'Strengthen governance & tagging', 'Cloud sustainability'] },
]

export default function FinOpsAIPanel({ view, data, filters = null, title = 'AI Cost Analysis', defaultOpen = true, onInsights = null }) {
  const [insights, setInsights] = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [open, setOpen]         = useState(defaultOpen)
  // Advanced “Scope this analysis” feature — narrow the AI focus to one area.
  const [scope, setScope]         = useState('')
  const [scopeOpen, setScopeOpen] = useState(false)
  const [scopeDraft, setScopeDraft] = useState('')
  const scopeRef = useRef('')
  // Advanced “Business context” feature — ground the AI with industry / size / goals / notes.
  const [context, setContext]           = useState({})
  const [contextOpen, setContextOpen]   = useState(false)
  const [contextDraft, setContextDraft] = useState({})
  const contextRef = useRef({})
  // Free-text “Ask” — lets the user interrogate this view's data in their own words.
  const [question, setQuestion]     = useState('')
  const [askDraft, setAskDraft]     = useState('')
  const [askOpen, setAskOpen]       = useState(false)
  const questionRef = useRef('')
  const abortRef = useRef(null)

  // Stable fingerprint of the data so the effect only re-runs on real changes.
  const dataKey = useMemo(() => {
    try { return JSON.stringify(data || {}).slice(0, 4000) } catch { return '' }
  }, [data])

  const load = useCallback(async (force = false, scopeArg, contextArg, questionArg, _retry = 0) => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const scopeVal = scopeArg !== undefined ? scopeArg : scopeRef.current
    const ctxVal = contextArg !== undefined ? contextArg : contextRef.current
    const qVal = questionArg !== undefined ? questionArg : questionRef.current
    setLoading(true); setError(null)
    try {
      const res = await finopsApi.aiInsights(view, data || {}, filters, force, ctrl.signal, scopeVal || null, ctxVal && Object.keys(ctxVal).length ? ctxVal : null, qVal || null)
      if (!ctrl.signal.aborted) { setInsights(res); if (onInsights) onInsights(res) }
    } catch (e) {
      if (e.name === 'AbortError') return
      // A dropped connection usually means the answer landed in the cache anyway,
      // so one quiet retry (never forced) recovers it without spending tokens.
      if (e.networkError && _retry === 0 && !ctrl.signal.aborted) {
        await new Promise(r => setTimeout(r, 1500))
        if (!ctrl.signal.aborted) return load(false, scopeArg, contextArg, questionArg, 1)
      }
      setError(e.message)
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [view, dataKey, filters]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ask / clear a free-text question about this view's data.
  const applyAsk = useCallback(() => {
    const q = (askDraft || '').trim()
    if (!q) return
    questionRef.current = q
    setQuestion(q)
    setAskOpen(false)
    load(true, undefined, undefined, q)
  }, [askDraft, load])
  const clearAsk = useCallback(() => {
    questionRef.current = ''
    setQuestion('')
    setAskDraft('')
    setAskOpen(false)
    load(true, undefined, undefined, '')
  }, [load])

  // Apply / clear the active scope (forces a fresh, scoped generation).
  const applyScope = useCallback(() => {
    const s = (scopeDraft || '').trim()
    scopeRef.current = s
    setScope(s)
    setScopeOpen(false)
    load(true, s)
  }, [scopeDraft, load])
  const clearScope = useCallback(() => {
    scopeRef.current = ''
    setScope('')
    setScopeDraft('')
    setScopeOpen(false)
    load(true, '')
  }, [load])

  // Apply / clear structured business context (forces a fresh, grounded generation).
  const applyContext = useCallback(() => {
    const clean = Object.fromEntries(
      Object.entries(contextDraft || {}).filter(([, v]) => v && String(v).trim() && v !== '—')
    )
    contextRef.current = clean
    setContext(clean)
    setContextOpen(false)
    load(true, undefined, clean)
  }, [contextDraft, load])
  const clearContext = useCallback(() => {
    contextRef.current = {}
    setContext({})
    setContextDraft({})
    setContextOpen(false)
    load(true, undefined, {})
  }, [load])

  // Auto-load when data meaningfully changes (and there is something to analyse).
  // A view often renders once with zeroed placeholders before its fetch lands; running
  // the model on that wastes a 40-80s call and delays whatever the user actually asks.
  useEffect(() => {
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return
    const substantive = (v) => {
      if (v == null) return false
      if (Array.isArray(v)) return v.length > 0
      if (typeof v === 'number') return v !== 0
      if (typeof v === 'string') return v.trim() !== ''
      if (typeof v === 'object') return Object.values(v).some(substantive)
      return true
    }
    if (typeof data === 'object' && !Object.values(data).some(substantive)) return
    load(false)
  }, [dataKey, load]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort() }, [])

  const notConfigured = insights && insights.provider === 'none'
  const recs = insights?.recommendations || []
  const findings = insights?.key_findings || []
  const risks = insights?.risk_flags || []
  const activeContextCount = Object.keys(context).length
  const contextSummary = Object.entries(context)
    .filter(([k]) => k !== 'notes').map(([, v]) => v).join(' · ') || (context.notes ? 'custom notes' : '')

  return (
    <div style={{ background: 'linear-gradient(180deg,var(--c-0c1322),var(--c-0a0f1a))', border: '1px solid var(--c-1e3a5f)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 16px', borderBottom: (open || scopeOpen || contextOpen) ? '1px solid var(--c-15233b)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-e2e8f0)' }}>
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <Brain size={16} style={{ color: 'var(--c-a78bfa)' }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
            {insights?.provider && insights.provider !== 'none' && (
              <span style={{ fontSize: 9, color: 'var(--c-64748b)', background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 4, padding: '1px 6px' }}>
                {insights.provider}{insights.cached ? ' · cached' : ''}
              </span>
            )}
          </button>
          {scope && (
            <span title={`Analysis scoped to: ${scope}`} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: 'var(--c-67e8f9)', background: 'var(--c-0d2b3f)', border: '1px solid #0e7490', borderRadius: 4, padding: '2px 6px', maxWidth: 220 }}>
              <Crosshair size={9} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scope}</span>
              <X size={11} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={clearScope} />
            </span>
          )}
          {activeContextCount > 0 && (
            <span title={`Business context: ${contextSummary}`} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: 'var(--c-c4b5fd)', background: 'var(--c-1e1b4b)', border: '1px solid #6d28d9', borderRadius: 4, padding: '2px 6px', maxWidth: 240 }}>
              <SlidersHorizontal size={9} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contextSummary}</span>
              <X size={11} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={clearContext} />
            </span>
          )}
          {question && (
              <span title={`Question: ${question}`} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: 'var(--c-fcd34d)', background: 'var(--c-2a2207)', border: '1px solid var(--c-a16207)', borderRadius: 4, padding: '2px 6px', maxWidth: 260 }}>
              <MessageCircleQuestion size={9} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{question}</span>
              <X size={11} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={clearAsk} />
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => { setAskDraft(question); setAskOpen(o => !o); setScopeOpen(false); setContextOpen(false) }} title="Ask your own question about this data" style={{
            display: 'flex', alignItems: 'center', gap: 5, background: question || askOpen ? 'var(--c-2a2207)' : 'var(--c-0f172a)',
            border: `1px solid ${question || askOpen ? 'var(--c-a16207)' : 'var(--c-1e293b)'}`, borderRadius: 6, padding: '5px 11px',
            cursor: 'pointer', color: question || askOpen ? 'var(--c-fcd34d)' : 'var(--c-94a3b8)', fontSize: 11, fontWeight: 600,
          }}>
            <MessageCircleQuestion size={12} /> Ask
          </button>
          <button onClick={() => { setContextDraft({ ...context }); setContextOpen(o => !o); setScopeOpen(false); setAskOpen(false) }} title="Add business context to ground the recommendations" style={{
            display: 'flex', alignItems: 'center', gap: 5, background: activeContextCount || contextOpen ? 'var(--c-1e1b4b)' : 'var(--c-0f172a)',
            border: `1px solid ${activeContextCount || contextOpen ? '#6d28d9' : 'var(--c-1e293b)'}`, borderRadius: 6, padding: '5px 11px',
            cursor: 'pointer', color: activeContextCount || contextOpen ? 'var(--c-c4b5fd)' : 'var(--c-94a3b8)', fontSize: 11, fontWeight: 600,
          }}>
            <SlidersHorizontal size={12} /> Context{activeContextCount ? ` (${activeContextCount})` : ''}
          </button>
          <button onClick={() => { setScopeDraft(scope); setScopeOpen(o => !o); setContextOpen(false); setAskOpen(false) }} title="Scope this analysis to a specific area" style={{
            display: 'flex', alignItems: 'center', gap: 5, background: scope || scopeOpen ? 'var(--c-0d2b3f)' : 'var(--c-0f172a)',
            border: `1px solid ${scope || scopeOpen ? '#0e7490' : 'var(--c-1e293b)'}`, borderRadius: 6, padding: '5px 11px',
            cursor: 'pointer', color: scope || scopeOpen ? '#67e8f9' : 'var(--c-94a3b8)', fontSize: 11, fontWeight: 600,
          }}>
            <Crosshair size={12} /> {scope ? 'Scoped' : 'Scope'}
          </button>
          <button onClick={() => load(true)} disabled={loading} title="Generate a fresh analysis" style={{
            display: 'flex', alignItems: 'center', gap: 5, background: loading ? 'var(--c-1e293b)' : 'var(--c-1e1b4b)',
            border: `1px solid ${loading ? 'var(--c-334155)' : '#6d28d9'}`, borderRadius: 6, padding: '5px 11px',
            cursor: loading ? 'not-allowed' : 'pointer', color: loading ? 'var(--c-94a3b8)' : 'var(--c-c4b5fd)', fontSize: 11, fontWeight: 600,
          }}>
            {loading ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {loading ? (question ? 'Answering your question…' : 'Analysing…') : 'Refresh analysis'}
          </button>
        </div>
      </div>

      {/* Ask popover — free-text question answered against this view's real data */}
      {askOpen && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-15233b)', background: 'var(--c-0a1018)' }}>
          <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <MessageCircleQuestion size={12} style={{ color: 'var(--c-fcd34d)' }} /> Ask anything about this data
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {ASK_PRESETS.map(p => (
              <button key={p} onClick={() => setAskDraft(p)} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
                background: 'var(--c-0f172a)', color: 'var(--c-94a3b8)', border: '1px solid var(--c-1e293b)',
              }}>{p}</button>
            ))}
          </div>
          <textarea
            value={askDraft}
            onChange={e => setAskDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) applyAsk() }}
            rows={2}
            placeholder="e.g. Which resource groups grew most this month and what should I cut first?"
            style={{
              width: '100%', background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6,
              padding: '8px 10px', color: 'var(--c-e2e8f0)', fontSize: 11.5, resize: 'vertical', fontFamily: 'inherit',
            }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button onClick={applyAsk} disabled={!askDraft.trim() || loading} style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, borderRadius: 6, padding: '5px 12px',
              cursor: (!askDraft.trim() || loading) ? 'not-allowed' : 'pointer',
              background: (!askDraft.trim() || loading) ? 'var(--c-1e293b)' : '#a16207',
              border: '1px solid #a16207', color: (!askDraft.trim() || loading) ? 'var(--c-64748b)' : '#fff',
            }}><Check size={12} /> Ask</button>
            {question && (
              <button onClick={clearAsk} style={{
                fontSize: 11, borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
                background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', color: 'var(--c-94a3b8)',
              }}>Clear question</button>
            )}
            <span style={{ color: 'var(--c-475569)', fontSize: 10, marginLeft: 'auto' }}>Answered only from this view&rsquo;s live data. Ctrl/⌘+Enter to submit. Takes up to a minute.</span>
          </div>
        </div>
      )}

      {/* Scope popover — advanced: narrow the AI analysis to a specific area */}
      {scopeOpen && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-15233b)', background: 'var(--c-0a1018)' }}>
          <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Crosshair size={12} style={{ color: 'var(--c-67e8f9)' }} /> Scope this analysis to a specific area
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {SCOPE_PRESETS.map((p) => {
              const active = scopeDraft.trim().toLowerCase() === p.toLowerCase()
              return (
                <button key={p} onClick={() => setScopeDraft(active ? '' : p)} style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
                  background: active ? '#0e7490' : 'var(--c-0f172a)', color: active ? '#fff' : 'var(--c-94a3b8)',
                  border: `1px solid ${active ? '#22d3ee' : 'var(--c-1e293b)'}`,
                }}>{p}</button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={scopeDraft}
              onChange={(e) => setScopeDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyScope() }}
              placeholder="Or type a custom focus, e.g. 'Storage in West Europe & reservation coverage'"
              style={{ flex: '1 1 280px', minWidth: 200, background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6, padding: '7px 10px', color: 'var(--c-e2e8f0)', fontSize: 12, outline: 'none' }}
            />
            <button onClick={applyScope} disabled={!scopeDraft.trim() || loading} style={{
              display: 'flex', alignItems: 'center', gap: 5, background: (!scopeDraft.trim() || loading) ? 'var(--c-1e293b)' : '#0e7490',
              border: 'none', borderRadius: 6, padding: '7px 12px', cursor: (!scopeDraft.trim() || loading) ? 'not-allowed' : 'pointer',
              color: (!scopeDraft.trim() || loading) ? 'var(--c-64748b)' : '#fff', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
            }}><Check size={13} /> Analyze this scope</button>
            {scope && (
              <button onClick={clearScope} style={{ background: 'none', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 10px', cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 12 }}>Clear scope</button>
            )}
          </div>
          <div style={{ color: 'var(--c-475569)', fontSize: 10, marginTop: 6 }}>
            The summary, findings, recommendations & savings will focus on this area. Clear it to return to the full analysis.
          </div>
        </div>
      )}

      {/* Context popover — advanced: ground the AI with business context */}
      {contextOpen && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-15233b)', background: 'var(--c-0a1018)' }}>
          <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <SlidersHorizontal size={12} style={{ color: 'var(--c-c4b5fd)' }} /> Add business context for more grounded recommendations
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, marginBottom: 10 }}>
            {CONTEXT_FIELDS.map((f) => (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{f.label}</span>
                <select
                  value={contextDraft[f.key] || ''}
                  onChange={(e) => setContextDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6, padding: '7px 9px', color: 'var(--c-e2e8f0)', fontSize: 12, outline: 'none', cursor: 'pointer' }}
                >
                  <option value="">— Not specified —</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            ))}
          </div>
          <textarea
            value={contextDraft.notes || ''}
            onChange={(e) => setContextDraft((d) => ({ ...d, notes: e.target.value }))}
            placeholder="Additional business context, e.g. 'Migrating our on-prem datacenter to Azure by Q4; budget freeze on non-production; prioritise reserved-instance coverage for steady-state VMs.'"
            rows={3}
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6, padding: '8px 10px', color: 'var(--c-e2e8f0)', fontSize: 12, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={applyContext} disabled={loading} style={{
              display: 'flex', alignItems: 'center', gap: 5, background: loading ? 'var(--c-1e293b)' : '#6d28d9',
              border: 'none', borderRadius: 6, padding: '7px 12px', cursor: loading ? 'not-allowed' : 'pointer',
              color: loading ? 'var(--c-64748b)' : '#fff', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
            }}><Check size={13} /> Apply context &amp; analyze</button>
            {activeContextCount > 0 && (
              <button onClick={clearContext} style={{ background: 'none', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '7px 10px', cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 12 }}>Clear context</button>
            )}
            <span style={{ color: 'var(--c-475569)', fontSize: 10, marginLeft: 'auto' }}>Grounds the AI in your industry, size, goals &amp; notes.</span>
          </div>
        </div>
      )}

      {open && (
        <div style={{ padding: '14px 16px' }}>
          {loading && !insights && (
            <div style={{ color: 'var(--c-64748b)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <RefreshCw size={13} className="animate-spin" style={{ color: 'var(--c-a78bfa)' }} /> Generating AI cost analysis…
            </div>
          )}
          {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--c-f87171)', fontSize: 12 }}>AI error: {error}</span>
          <button onClick={() => load(false)} disabled={loading}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 6, cursor: loading ? 'wait' : 'pointer',
              background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', color: 'var(--c-e2e8f0)',
            }}>
            Retry
          </button>
        </div>
      )}
          {notConfigured && (
            <div style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>
              {insights.summary}
            </div>
          )}

          {insights && !notConfigured && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {question && loading && (
                <div style={{ background: 'var(--c-1a1503)', border: '1px solid var(--c-a16207)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <RefreshCw size={13} className="animate-spin" style={{ color: 'var(--c-fbbf24)' }} />
                  <div>
                    <div style={{ color: 'var(--c-fbbf24)', fontSize: 11, fontWeight: 700 }}>Answering: “{question}”</div>
                    <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, marginTop: 2 }}>
                      Reading this view&rsquo;s live data — this usually takes 30–90 seconds.
                    </div>
                  </div>
                </div>
              )}
              {insights.answer && insights.question && (
                <div style={{ background: 'var(--c-1a1503)', border: '1px solid var(--c-a16207)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <MessageCircleQuestion size={12} style={{ color: 'var(--c-fcd34d)', flexShrink: 0 }} />
                    <span style={{ color: 'var(--c-fcd34d)', fontSize: 11, fontWeight: 700 }}>{insights.question}</span>
                  </div>
                  <p style={{ color: 'var(--c-e2e8f0)', fontSize: 13, lineHeight: 1.55, margin: 0 }}>{insights.answer}</p>
                </div>
              )}
              {insights.summary && (
                <p style={{ color: 'var(--c-cbd5e1)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{insights.summary}</p>
              )}

              {insights.projected_savings_usd > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--c-0d2b1f)', border: '1px solid var(--c-166534)', borderRadius: 8, padding: '8px 12px', width: 'fit-content' }}>
                  <Lightbulb size={14} style={{ color: 'var(--c-4ade80)' }} />
                  <span style={{ color: 'var(--c-4ade80)', fontSize: 13, fontWeight: 700 }}>{fmtUsd(insights.projected_savings_usd)}/mo</span>
                  <span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>AI-identified savings potential</span>
                </div>
              )}

              {findings.length > 0 && (
                <div>
                  <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Key findings</div>
                  <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--c-cbd5e1)', fontSize: 12, lineHeight: 1.7 }}>
                    {findings.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}

              {recs.length > 0 && (
                <div>
                  <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Recommendations</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {recs.map((r, i) => (
                      <div key={i} style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: '9px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: r.detail ? 4 : 0 }}>
                          <span style={{ color: 'var(--c-e2e8f0)', fontSize: 12, fontWeight: 600 }}>{r.title}</span>
                          <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                            {r.est_monthly_savings > 0 && <span style={{ color: 'var(--c-4ade80)', fontSize: 11, fontWeight: 700 }}>{fmtUsd(r.est_monthly_savings)}/mo</span>}
                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: IMPACT_COLOR[r.impact] || 'var(--c-94a3b8)', background: (IMPACT_COLOR[r.impact] || 'var(--c-94a3b8)') + '22', borderRadius: 4, padding: '1px 6px' }}>{r.impact}</span>
                          </span>
                        </div>
                        {r.detail && <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, lineHeight: 1.5 }}>{r.detail}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {risks.length > 0 && (
                <div>
                  <div style={{ color: 'var(--c-94a3b8)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Risk flags</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {risks.map((r, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, color: 'var(--c-fca5a5)', fontSize: 12 }}>
                        <AlertTriangle size={13} style={{ color: 'var(--c-f87171)', flexShrink: 0, marginTop: 2 }} /> <span>{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {insights.generated_at && (
                <div style={{ color: 'var(--c-475569)', fontSize: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  {insights.grounded_on && insights.grounded_on.resources != null && (
                    <span
                      style={{ color: 'var(--c-64748b)' }}
                      title={insights.grounded_on.cost_source || undefined}>
                      🔎 Grounded on {insights.grounded_on.resources} resources
                      {insights.grounded_on.spend_usd != null ? ` · ${fmtUsd(insights.grounded_on.spend_usd)} analyzed` : ''}
                      {insights.grounded_on.cost_window ? ` (${insights.grounded_on.cost_window})` : ''}
                      {insights.grounded_on.tagged_pct != null ? ` · ${insights.grounded_on.tagged_pct}% tagged` : ''}
                    </span>
                  )}
                  <span>Generated {new Date(insights.generated_at).toLocaleString()}</span>
                  <span style={{ color: insights.cached ? '#f59e0b' : '#22c55e' }}>{insights.cached ? '· cached (click Refresh for a fresh run)' : '· fresh'}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
