import React, { useState } from 'react'
import clsx from 'clsx'
import { asText } from '../../utils/safeText'
import {
  Brain, RefreshCw, AlertTriangle, CheckCircle, ChevronDown, ChevronRight,
  Zap, Shield, TrendingUp, Play, Loader, Target, Server,
  ShieldCheck, Monitor, Database, ArrowRight,
} from 'lucide-react'

// ── Finding Card ─────────────────────────────────────────────────────────────

const SEV_STYLE = {
  Critical: 'border-red-700/50 bg-red-950/20 text-red-300',
  High:     'border-orange-700/50 bg-orange-950/20 text-orange-300',
  Medium:   'border-yellow-700/50 bg-yellow-950/20 text-yellow-300',
  Low:      'border-gray-700/50 bg-gray-900/40 text-gray-400',
}

const CAT_ICON = {
  Security:    Shield,
  Monitoring:  Monitor,
  BCDR:        Database,
  Governance:  Target,
  Patching:    RefreshCw,
  Performance: TrendingUp,
}

function FindingCard({ finding }) {
  const Icon = CAT_ICON[finding.category] || AlertTriangle
  return (
    <div className={clsx('rounded-lg border p-3 flex items-start gap-2.5', SEV_STYLE[finding.severity] || SEV_STYLE.Low)}>
      <Icon size={14} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold">{finding.category}</span>
          <span className="text-xs opacity-70">{finding.severity}</span>
          {finding.affected_machines > 0 && (
            <span className="text-xs opacity-60">{finding.affected_machines} machines</span>
          )}
        </div>
        <p className="text-xs mt-1 opacity-90 leading-relaxed">{asText(finding.finding)}</p>
        {finding.recommendation && (
          <p className="text-xs mt-1 opacity-70 italic">{asText(finding.recommendation)}</p>
        )}
      </div>
    </div>
  )
}

// ── Quick Win Card ───────────────────────────────────────────────────────────

function QuickWinCard({ qw }) {
  return (
    <div className="rounded-xl border border-teal-800/50 bg-teal-950/20 p-4">
      <div className="flex items-start gap-2">
        <Zap size={14} className="text-teal-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-teal-300">{qw.title}</p>
            {qw.impact && (
              <span className={clsx('text-xs px-1.5 py-0.5 rounded-full border',
                qw.impact === 'High' ? 'bg-green-900/30 text-green-300 border-green-800/50' :
                qw.impact === 'Medium' ? 'bg-yellow-900/30 text-yellow-300 border-yellow-800/50' :
                'bg-gray-800 text-gray-400 border-gray-700')}>{qw.impact} impact</span>
            )}
          </div>
          <p className="text-xs text-teal-400/80 mt-1">{asText(qw.description)}</p>
          {qw.affected_machines > 0 && (
            <p className="text-xs text-teal-500 mt-1">{qw.affected_machines} machines affected</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Score Ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 80 }) {
  const r = (size / 2) - 6
  const circ = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score))
  const dash = (pct / 100) * circ
  const color = pct >= 70 ? '#ef4444' : pct >= 50 ? '#f97316' : pct >= 30 ? '#eab308' : '#22c55e'

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-white tabular-nums">{Math.round(pct)}</span>
        <span className="text-[9px] text-gray-500 -mt-0.5">RISK</span>
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function ArcAIAnalysis() {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function runAnalysis() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/arc/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine_ids: [] }) // all machines
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || `HTTP ${res.status}`)
      }
      const json = await res.json()
      setAnalysis(json)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Not yet run
  if (!analysis && !loading) {
    return (
      <div className="space-y-4">
        {/* Hero Card */}
        <div className="rounded-xl border border-blue-800/40 bg-gradient-to-br from-blue-950/30 to-gray-900/50 p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-900/40 border border-blue-700/40 flex items-center justify-center mx-auto mb-4">
            <Brain size={28} className="text-blue-400" />
          </div>
          <h2 className="text-xl font-bold text-white">AI-Powered On-Premise Analysis</h2>
          <p className="text-sm text-gray-400 mt-2 max-w-lg mx-auto">
            Analyze your Azure Arc-enabled on-premise infrastructure with AI.
            Get comprehensive recommendations for security posture, monitoring gaps,
            BCDR readiness, governance compliance, and modernization opportunities.
          </p>
          <button
            onClick={runAnalysis}
            className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-semibold text-white transition-colors"
          >
            <Play size={14} /> Run AI Analysis
          </button>
        </div>

        {/* Capabilities */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { icon: Shield, label: 'Security Posture', desc: 'Endpoint protection gaps, vulnerability assessment, threat exposure' },
            { icon: Monitor, label: 'Observability', desc: 'Monitoring agent coverage, blind spots, alerting gaps' },
            { icon: Database, label: 'BCDR Readiness', desc: 'Backup coverage, recovery models, HA assessment, DR planning' },
          ].map(cap => (
            <div key={cap.label} className="rounded-lg border border-gray-800/60 bg-gray-900/40 p-4">
              <cap.icon size={16} className="text-blue-400 mb-2" />
              <h4 className="text-sm font-medium text-gray-200">{cap.label}</h4>
              <p className="text-xs text-gray-500 mt-1">{cap.desc}</p>
            </div>
          ))}
        </div>

        {error && (
          <div className="rounded-lg border border-red-800/50 bg-red-950/20 p-4">
            <p className="text-sm text-red-300 flex items-center gap-2">
              <AlertTriangle size={14} /> {error}
            </p>
          </div>
        )}
      </div>
    )
  }

  // Loading
  if (loading) {
    return (
      <div className="rounded-xl border border-blue-800/30 bg-gray-900/50 p-12 text-center">
        <Loader size={32} className="animate-spin text-blue-400 mx-auto" />
        <p className="text-gray-400 mt-4">AI is analyzing your on-premise infrastructure...</p>
        <p className="text-xs text-gray-600 mt-1">This may take 15-30 seconds</p>
      </div>
    )
  }

  // Results
  const HEALTH_STYLE = {
    Critical:  'bg-red-900/30 text-red-300 border-red-800/50',
    'At Risk': 'bg-orange-900/30 text-orange-300 border-orange-800/50',
    Fair:      'bg-yellow-900/30 text-yellow-300 border-yellow-800/50',
    Good:      'bg-green-900/30 text-green-300 border-green-800/50',
    Excellent: 'bg-teal-900/30 text-teal-300 border-teal-800/50',
  }

  return (
    <div className="space-y-4">
      {/* Header with score */}
      <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
        <div className="flex items-center gap-6">
          <ScoreRing score={analysis.risk_score || 0} />
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg font-bold text-white">Infrastructure Analysis</h2>
              {analysis.overall_health && (
                <span className={clsx('text-xs px-2.5 py-1 rounded-full border font-medium',
                  HEALTH_STYLE[analysis.overall_health] || HEALTH_STYLE.Fair)}>
                  {analysis.overall_health}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400 mt-1">{analysis.executive_summary}</p>
          </div>
          <button onClick={runAnalysis} className="shrink-0 p-2 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-gray-300">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Findings */}
      {analysis.findings?.length > 0 && (
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-3">
            Findings ({analysis.findings.length})
          </h3>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {analysis.findings.map((f, i) => <FindingCard key={i} finding={f} />)}
          </div>
        </div>
      )}

      {/* BCDR Assessment */}
      {analysis.bcdr_assessment && (
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
            <Database size={14} className="text-purple-400" /> BCDR Assessment
            {analysis.bcdr_assessment.readiness_level && (
              <span className={clsx('text-xs px-2 py-0.5 rounded-full border',
                analysis.bcdr_assessment.readiness_level === 'High' ? 'bg-green-900/30 text-green-300 border-green-800/50' :
                analysis.bcdr_assessment.readiness_level === 'Medium' ? 'bg-yellow-900/30 text-yellow-300 border-yellow-800/50' :
                'bg-red-900/30 text-red-300 border-red-800/50')}>
                {analysis.bcdr_assessment.readiness_level} Readiness
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-400 mb-3">{analysis.bcdr_assessment.summary}</p>
          {analysis.bcdr_assessment.recommendations?.length > 0 && (
            <ul className="space-y-1.5">
              {analysis.bcdr_assessment.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                  <ArrowRight size={10} className="text-purple-400 shrink-0 mt-0.5" />
                  {rec}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Quick Wins */}
      {analysis.quick_wins?.length > 0 && (
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
            <Zap size={14} className="text-teal-400" /> Quick Wins ({analysis.quick_wins.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {analysis.quick_wins.map((qw, i) => <QuickWinCard key={i} qw={qw} />)}
          </div>
        </div>
      )}

      {/* Modernization Opportunities */}
      {analysis.modernization_opportunities?.length > 0 && (
        <div className="rounded-xl border border-gray-800/60 bg-gray-900/50 p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
            <TrendingUp size={14} className="text-blue-400" /> Modernization Opportunities
          </h3>
          <div className="space-y-2">
            {analysis.modernization_opportunities.map((opp, i) => (
              <div key={i} className="rounded-lg border border-blue-800/30 bg-blue-950/10 p-3">
                <p className="text-sm font-medium text-blue-200">{opp.title}</p>
                <p className="text-xs text-blue-400/80 mt-1">{asText(opp.description)}</p>
                {opp.benefit && <p className="text-xs text-blue-500 mt-1 italic">Benefit: {opp.benefit}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
