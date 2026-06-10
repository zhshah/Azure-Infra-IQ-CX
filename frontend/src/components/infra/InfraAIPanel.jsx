import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Brain, RefreshCw, AlertTriangle, CheckCircle, ChevronDown, ChevronRight,
  Zap, Target, Shield, TrendingDown, TrendingUp, Clock, BarChart2,
  Play, Search, X, Loader, Globe, ArrowRight,
} from 'lucide-react'
import { api } from '../../api/client'

// ── Safe text helper — prevents "Objects are not valid as a React child" ──────
function safeTxt(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return String(v) }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const HEALTH_STYLE = {
  'Critical':   { cls: 'text-red-400 bg-red-900/20 border-red-700/50',    dot: '#ef4444' },
  'At Risk':    { cls: 'text-orange-400 bg-orange-900/20 border-orange-700/50', dot: '#f97316' },
  'Fair':       { cls: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/50', dot: '#eab308' },
  'Good':       { cls: 'text-green-400 bg-green-900/20 border-green-700/50',    dot: '#22c55e' },
  'Excellent':  { cls: 'text-teal-400 bg-teal-900/20 border-teal-700/50',       dot: '#14b8a6' },
}

const SEV_COLOR = {
  Critical: 'bg-red-900/30 text-red-300 border-red-800/50',
  High:     'bg-orange-900/30 text-orange-300 border-orange-800/50',
  Medium:   'bg-yellow-900/30 text-yellow-300 border-yellow-800/50',
  Low:      'bg-gray-800 text-gray-400 border-gray-700',
}

const CAT_ICON = {
  Cost:        TrendingDown,
  BCDR:        Shield,
  Security:    Shield,
  Performance: BarChart2,
  Governance:  Target,
}

function ScoreRing({ score, size = 80 }) {
  const r   = (size / 2) - 6
  const circ = 2 * Math.PI * r
  const pct  = Math.max(0, Math.min(100, score))
  const dash = (pct / 100) * circ
  const color = pct >= 70 ? '#ef4444' : pct >= 50 ? '#f97316' : pct >= 30 ? '#eab308' : '#22c55e'

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth="6" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-white tabular-nums">{Math.round(pct)}</span>
        <span className="text-[9px] text-gray-500 -mt-0.5">RISK</span>
      </div>
    </div>
  )
}

function FindingCard({ finding }) {
  const Icon = CAT_ICON[finding.category] || Target
  return (
    <div className={clsx('rounded-lg border p-3 flex items-start gap-2.5', SEV_COLOR[finding.severity])}>
      <Icon size={14} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold">{safeTxt(finding.category)}</span>
          <span className="text-xs opacity-70">{safeTxt(finding.severity)}</span>
        </div>
        <p className="text-xs mt-0.5 opacity-90 leading-relaxed">{safeTxt(finding.finding)}</p>
      </div>
    </div>
  )
}

function OpportunityRow({ op }) {
  const [open, setOpen] = useState(false)
  const savings = op.monthly_savings || 0
  return (
    <div className="border border-gray-800/60 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-3 hover:bg-gray-800/30 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">{safeTxt(op.resource_name)}</span>
            <span className="text-xs text-gray-500">{safeTxt(op.resource_type)}</span>
            <span className={clsx('text-xs px-1.5 py-0.5 rounded-full border',
              op.priority === 'P1' ? 'bg-red-900/40 text-red-300 border-red-800/50' :
              op.priority === 'P2' ? 'bg-orange-900/40 text-orange-300 border-orange-800/50' :
              'bg-gray-800 text-gray-400 border-gray-700')}>{safeTxt(op.priority)}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{safeTxt(op.action)} · Effort: {safeTxt(op.effort)}</p>
        </div>
        <div className="shrink-0 text-right">
          {savings > 0 && <p className="text-sm font-semibold text-green-400">${savings.toFixed(0)}/mo</p>}
          {open ? <ChevronDown size={13} className="text-gray-500 ml-auto mt-1" /> : <ChevronRight size={13} className="text-gray-500 ml-auto mt-1" />}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2 border-t border-gray-800/50 pt-3">
          <p className="text-xs text-gray-300 leading-relaxed">{safeTxt(op.explanation)}</p>
          {op.steps?.length > 0 && (
            <ol className="space-y-1">
              {op.steps.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs text-gray-400">
                  <span className="shrink-0 w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-gray-500">{i + 1}</span>
                  {safeTxt(s)}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

function QuickWinCard({ qw }) {
  return (
    <div className="rounded-xl border border-teal-800/50 bg-teal-950/20 p-4">
      <div className="flex items-start gap-2">
        <Zap size={14} className="text-teal-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-teal-300">{safeTxt(qw.title)}</p>
          <p className="text-xs text-teal-400/80 mt-1">{safeTxt(qw.description)}</p>
          {qw.estimated_impact && (
            <p className="text-xs text-teal-500 mt-1">Impact: {safeTxt(qw.estimated_impact)}</p>
          )}
          {qw.steps?.length > 0 && (
            <ol className="mt-2 space-y-0.5">
              {qw.steps.slice(0, 3).map((s, i) => (
                <li key={i} className="text-xs text-teal-400/70">
                  {i + 1}. {safeTxt(s)}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Semantic Search ───────────────────────────────────────────────────────────

function AISearch({ onResults }) {
  const [query,   setQuery]   = useState('')
  const [loading, setLoading] = useState(false)

  async function doSearch() {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k: 20 }),
      })
      const data = await res.json()
      onResults(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder='Ask AI: "Show me all production databases without backup"'
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-8 pr-3 py-2.5 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600"
        />
      </div>
      <button
        onClick={doSearch}
        disabled={loading || !query.trim()}
        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm text-white disabled:opacity-40"
      >
        {loading ? <Loader size={13} className="animate-spin" /> : <Brain size={13} />}
        {loading ? 'Searching…' : 'Ask AI'}
      </button>
    </div>
  )
}

// ── Streaming Analysis Component ──────────────────────────────────────────────

function StreamingAnalysis({ onComplete }) {
  const [chunks, setChunks]   = useState('')
  const [done,   setDone]     = useState(false)
  const [error,  setError]    = useState(null)

  useEffect(() => {
    const es = new EventSource('/api/ai/workload/stream?refresh=true')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'chunk')  setChunks(prev => prev + data.text)
        if (data.type === 'done')   { setDone(true); es.close(); onComplete?.(data.data) }
        if (data.type === 'error')  { setError(data.message); es.close() }
      } catch {}
    }
    es.onerror = () => { setError('Connection lost'); es.close() }
    return () => es.close()
  }, [])

  if (error) return (
    <div className="flex items-center gap-2 text-red-400 text-sm p-4">
      <AlertTriangle size={14} /> {error}
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-blue-400">
        <Loader size={14} className="animate-spin" />
        Claude is analysing your infrastructure…
      </div>
      {chunks && (
        <pre className="text-xs text-gray-400 bg-gray-800/50 rounded-lg p-4 max-h-48 overflow-y-auto font-mono whitespace-pre-wrap">
          {chunks}
        </pre>
      )}
    </div>
  )
}

// ── Main InfraAIPanel ─────────────────────────────────────────────────────────

export default function InfraAIPanel({ onSearchResults, onOpenSettings }) {
  const [analysis,   setAnalysis]   = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [streaming,  setStreaming]  = useState(false)
  const [error,      setError]      = useState(null)
  const [aiStatus,   setAIStatus]   = useState(null)
  const [activeTab,  setActiveTab]  = useState('summary')   // summary | findings | opportunities | quickwins | plan

  useEffect(() => {
    // Check AI availability
    fetch('/api/ai/status').then(r => r.json()).then(s => setAIStatus(s)).catch(() => {})
    // Try to load cached analysis
    loadCachedAnalysis()
  }, [])

  async function loadCachedAnalysis() {
    setLoading(true)
    try {
      const res  = await fetch('/api/ai/workload')
      const data = await res.json()
      if (!data.error) setAnalysis(data)
      else if (data.error.includes('No AI provider')) setError('ai_not_configured')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function refreshAnalysis() {
    setAnalysis(null)
    setStreaming(true)
  }

  function handleStreamComplete(data) {
    setStreaming(false)
    if (data && !data.error) setAnalysis(data)
    else if (data?.raw) setAnalysis({ _raw: data.raw, available: true })
  }

  const health = typeof analysis?.overall_health === 'string' ? analysis.overall_health : 'Fair'
  const hs     = HEALTH_STYLE[health] || HEALTH_STYLE['Fair']

  const tabs = [
    { key: 'summary',       label: 'Summary' },
    { key: 'findings',      label: `Findings (${analysis?.key_findings?.length || 0})` },
    { key: 'opportunities', label: `Opportunities (${analysis?.optimization_opportunities?.length || 0})` },
    { key: 'quickwins',     label: `Quick Wins (${analysis?.quick_wins?.length || 0})` },
    { key: 'bcdr',          label: 'BCDR' },
    { key: 'plan',          label: 'Action Plan' },
    { key: 'search',        label: '🔍 AI Search' },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Brain size={20} className="text-indigo-400" />
            AI Infrastructure Intelligence
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            AI-powered holistic workload analysis, optimization roadmap, and BCDR recommendations
          </p>
        </div>
        <div className="flex items-center gap-2">
          {aiStatus && (
            <div className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border',
              aiStatus.available ? 'bg-green-900/20 border-green-800/40 text-green-300' : 'bg-gray-800 border-gray-700 text-gray-400')}>
              <div className={clsx('w-1.5 h-1.5 rounded-full', aiStatus.available ? 'bg-green-400' : 'bg-gray-500')} />
              {aiStatus.available ? `${aiStatus.provider === 'azure_openai' ? 'Azure OpenAI' : aiStatus.model?.split('-').slice(0,3).join('-') || 'AI'}` : 'AI offline'}
            </div>
          )}
          {analysis?._cached && (
            <span className="text-xs text-gray-600">Cached {analysis._cached_at?.split('T')[1]?.slice(0,5)}</span>
          )}
          <button
            onClick={refreshAnalysis}
            disabled={loading || streaming}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white disabled:opacity-40"
          >
            {loading || streaming ? <Loader size={12} className="animate-spin" /> : <Play size={12} />}
            {streaming ? 'Analysing…' : analysis ? 'Re-analyse' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {/* AI not configured warning */}
      {error === 'ai_not_configured' && (
        <div className="rounded-xl border border-yellow-700/50 bg-yellow-950/20 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-yellow-400 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-semibold text-yellow-300">AI provider not configured</p>
              <p className="text-xs text-yellow-400/80 leading-relaxed">
                Configure AI in Settings → AI Configuration. Supported providers:
                <code className="bg-yellow-900/30 px-1 rounded">AZURE_OPENAI_ENDPOINT</code> + <code className="bg-yellow-900/30 px-1 rounded">AZURE_OPENAI_KEY</code> (Azure OpenAI),
                or <code className="bg-yellow-900/30 px-1 rounded">ANTHROPIC_API_KEY</code> (Anthropic Claude).
              </p>
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
                >
                  <ArrowRight size={13} />
                  Open Settings → Configure AI
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !streaming && (
        <div className="flex items-center justify-center h-48 gap-3 text-gray-500">
          <RefreshCw size={16} className="animate-spin" />
          Loading AI analysis…
        </div>
      )}

      {/* Streaming */}
      {streaming && (
        <div className="card">
          <StreamingAnalysis onComplete={handleStreamComplete} />
        </div>
      )}

      {/* Analysis results */}
      {!loading && !streaming && analysis && !analysis._raw && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card flex items-center gap-3">
              <ScoreRing score={analysis.overall_risk_score || 0} />
              <div>
                <p className="text-xs text-gray-500">Risk Score</p>
                <div className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border mt-1', hs.cls)}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: hs.dot }} />
                  {safeTxt(health)}
                </div>
              </div>
            </div>
            <div className="card">
              <p className="text-xs text-gray-500">Monthly Spend</p>
              <p className="text-2xl font-bold text-white mt-1">
                ${(analysis.total_monthly_cost || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="card">
              <p className="text-xs text-gray-500">Identified Savings</p>
              <p className="text-2xl font-bold text-green-400 mt-1">
                ${(analysis.estimated_monthly_savings || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-gray-600">per month</p>
            </div>
            <div className="card">
              <p className="text-xs text-gray-500">BCDR Readiness</p>
              <p className="text-2xl font-bold text-white mt-1">
                {analysis.bcdr_readiness?.score ?? '—'}<span className="text-sm text-gray-500">/100</span>
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-gray-800 overflow-x-auto pb-px">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={clsx(
                  'px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
                  activeTab === t.key
                    ? 'border-indigo-500 text-indigo-300'
                    : 'border-transparent text-gray-500 hover:text-gray-300',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab: Summary */}
          {activeTab === 'summary' && (
            <div className="card space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Executive Summary</h3>
                <p className="text-sm text-gray-300 leading-relaxed">{safeTxt(analysis.executive_summary)}</p>
              </div>
              {analysis.workload_patterns && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Workload Patterns</h3>
                  <p className="text-sm text-gray-300 leading-relaxed">{safeTxt(analysis.workload_patterns?.description)}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs">
                    <span className="text-red-400">{analysis.workload_patterns.idle_resources} idle</span>
                    <span className="text-yellow-400">{analysis.workload_patterns.underutilized} under-utilized</span>
                    <span className="text-green-400">{analysis.workload_patterns.well_utilized} well-utilized</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab: Findings */}
          {activeTab === 'findings' && (
            <div className="space-y-2">
              {(analysis.key_findings || []).map((f, i) => <FindingCard key={i} finding={f} />)}
              {!analysis.key_findings?.length && (
                <p className="text-gray-600 text-sm text-center py-8">No findings</p>
              )}
            </div>
          )}

          {/* Tab: Optimization Opportunities */}
          {activeTab === 'opportunities' && (
            <div className="space-y-2">
              {(analysis.optimization_opportunities || [])
                .sort((a, b) => (a.priority || 'P4').localeCompare(b.priority || 'P4'))
                .map((op, i) => <OpportunityRow key={i} op={op} />)}
              {!analysis.optimization_opportunities?.length && (
                <p className="text-gray-600 text-sm text-center py-8">No opportunities identified</p>
              )}
            </div>
          )}

          {/* Tab: Quick Wins */}
          {activeTab === 'quickwins' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(analysis.quick_wins || []).map((qw, i) => <QuickWinCard key={i} qw={qw} />)}
              {!analysis.quick_wins?.length && (
                <p className="text-gray-600 text-sm text-center py-8 col-span-2">No quick wins identified</p>
              )}
            </div>
          )}

          {/* Tab: BCDR */}
          {activeTab === 'bcdr' && analysis.bcdr_readiness && (
            <div className="card space-y-4">
              <div className="flex items-center gap-3">
                <ScoreRing score={analysis.bcdr_readiness.score || 0} size={72} />
                <div>
                  <p className="text-sm font-semibold text-white">BCDR Readiness Score</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {analysis.bcdr_readiness.gaps?.length || 0} gaps identified
                  </p>
                </div>
              </div>
              {analysis.bcdr_readiness.gaps?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Gaps</h3>
                  <ul className="space-y-1.5">
                    {analysis.bcdr_readiness.gaps.map((g, i) => (
                      <li key={i} className="flex gap-2 text-xs text-gray-300">
                        <AlertTriangle size={12} className="text-orange-400 shrink-0 mt-0.5" />
                        {safeTxt(g)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.bcdr_readiness.qatar_specific_issues?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-orange-500 uppercase tracking-wider mb-2">Qatar Central Specific</h3>
                  <ul className="space-y-1.5">
                    {analysis.bcdr_readiness.qatar_specific_issues.map((g, i) => (
                      <li key={i} className="flex gap-2 text-xs text-orange-300/90">
                        <AlertTriangle size={12} className="text-orange-400 shrink-0 mt-0.5" />
                        {safeTxt(g)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.bcdr_readiness.immediate_actions?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Immediate Actions</h3>
                  <ol className="space-y-1.5">
                    {analysis.bcdr_readiness.immediate_actions.map((a, i) => (
                      <li key={i} className="flex gap-2 text-xs text-gray-300">
                        <span className="shrink-0 w-4 h-4 rounded-full bg-blue-900/40 text-blue-400 flex items-center justify-center">{i + 1}</span>
                        {safeTxt(a)}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          {/* Tab: Action Plan */}
          {activeTab === 'plan' && (
            <div className="space-y-4">
              {analysis.recommended_next_steps?.length > 0 && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">Recommended Next Steps</h3>
                  <ol className="space-y-2">
                    {analysis.recommended_next_steps.map((s, i) => (
                      <li key={i} className="flex gap-3 text-sm text-gray-300">
                        <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-900/40 text-indigo-400 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                        {safeTxt(s)}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          {/* Tab: AI Search */}
          {activeTab === 'search' && (
            <div className="space-y-4">
              <div className="card">
                <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <Brain size={14} className="text-indigo-400" />
                  Natural Language Resource Search
                </h3>
                <AISearch onResults={onSearchResults} />
                <p className="text-xs text-gray-600 mt-2">
                  Examples: "VMs without backup" · "Production databases in Qatar" · "Resources with low utilization and high cost"
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Raw output fallback */}
      {!loading && !streaming && analysis?._raw && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">AI Response</h3>
          <pre className="text-xs text-gray-400 bg-gray-800/50 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap max-h-96">
            {analysis._raw}
          </pre>
        </div>
      )}
    </div>
  )
}
