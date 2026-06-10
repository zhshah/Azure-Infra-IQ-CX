import React, { useState } from 'react'
import clsx from 'clsx'
import {
  Brain, Shield, Zap, TrendingUp, RefreshCw, AlertTriangle,
  CheckCircle, ChevronRight, Target, Globe, Lock, Eye,
  DollarSign, Activity, Network, Router, MapPin,
} from 'lucide-react'
import { api } from '../../api/client'

// ── Badges ──────────────────────────────────────────────────────────────────

function SeverityBadge({ severity }) {
  const map = {
    Critical: 'bg-red-900/40 text-red-300 border-red-800/50',
    High:     'bg-orange-900/40 text-orange-300 border-orange-800/50',
    Medium:   'bg-yellow-900/40 text-yellow-300 border-yellow-800/50',
    Low:      'bg-gray-800 text-gray-400 border-gray-700',
  }
  return <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold border', map[severity] || map.Low)}>{severity}</span>
}

function PriorityBadge({ priority }) {
  const map = {
    P1: 'bg-red-900/40 text-red-300 border-red-800/50',
    P2: 'bg-orange-900/40 text-orange-300 border-orange-800/50',
    P3: 'bg-yellow-900/40 text-yellow-300 border-yellow-800/50',
    P4: 'bg-gray-800 text-gray-400 border-gray-700',
  }
  return <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold border', map[priority] || map.P4)}>{priority}</span>
}

// ── Score Ring ──────────────────────────────────────────────────────────────

function ScoreRing({ score, label, size = 90 }) {
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : score >= 40 ? '#f97316' : '#ef4444'
  const sw = 7
  const r = (size - sw) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={sw} stroke="#374151" opacity={0.5} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={sw} stroke={color}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <span className="text-xl font-bold -mt-14" style={{ color }}>{score}</span>
      {label && <span className="text-xs text-gray-400 mt-5">{label}</span>}
    </div>
  )
}

// ── Analysis Stages ─────────────────────────────────────────────────────────

const STAGES = [
  { key: 'init', label: 'Preparing network context...' },
  { key: 'topo', label: 'Discovering hub-spoke topology via Resource Graph...' },
  { key: 'arch', label: 'Analyzing architecture & topology...' },
  { key: 'sec', label: 'Evaluating security posture...' },
  { key: 'perf', label: 'Assessing performance & bottlenecks...' },
  { key: 'route', label: 'Analyzing route tables & NVA forwarding...' },
  { key: 'cost', label: 'Calculating cost optimization...' },
  { key: 'acr', label: 'Identifying cloud adoption opportunities...' },
  { key: 'compile', label: 'Compiling recommendations...' },
]

// ── Main Component ──────────────────────────────────────────────────────────

export default function NetworkingAIAnalysis() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [stageIdx, setStageIdx] = useState(0)
  const [expandedSections, setExpandedSections] = useState({})

  const toggle = (key) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))

  async function runAnalysis(refresh = false) {
    setLoading(true)
    setError(null)
    setStageIdx(0)

    // Simulate progress stages while waiting
    const interval = setInterval(() => {
      setStageIdx(prev => prev < STAGES.length - 1 ? prev + 1 : prev)
    }, 3000)

    try {
      const resp = await api.getAINetworking(refresh)
      if (resp.error) {
        setError(resp.error)
      } else {
        setData(resp)
      }
    } catch (e) {
      setError(e.message || 'AI analysis failed')
    } finally {
      clearInterval(interval)
      setLoading(false)
    }
  }

  // ── Loading State ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-lg mx-auto mt-16">
        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-8 text-center">
          <Brain className="w-12 h-12 text-blue-400 mx-auto mb-4 animate-pulse" />
          <h3 className="text-lg font-semibold text-gray-200 mb-6">AI Networking Analysis</h3>
          <div className="space-y-2 text-left">
            {STAGES.map((stage, idx) => (
              <div key={stage.key} className={clsx('flex items-center gap-2 px-3 py-1.5 rounded', idx === stageIdx ? 'bg-blue-900/30' : '')}>
                {idx < stageIdx ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : idx === stageIdx ? (
                  <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-gray-600" />
                )}
                <span className={clsx('text-sm', idx <= stageIdx ? 'text-gray-200' : 'text-gray-500')}>{stage.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── No Data / Trigger ─────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="max-w-lg mx-auto mt-16">
        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-8 text-center">
          <Brain className="w-14 h-14 text-blue-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-200 mb-2">AI Networking Analysis</h3>
          <p className="text-sm text-gray-400 mb-6">
            Deep-dive analysis of your Azure networking architecture, security posture,
            performance bottlenecks, and cloud adoption opportunities powered by AI.
          </p>
          {error && (
            <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-3 mb-4">
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}
          <button onClick={() => runAnalysis(false)} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">
            Run AI Analysis
          </button>
        </div>
      </div>
    )
  }

  // ── Results ────────────────────────────────────────────────────────────────
  const { overall_network_score, score_breakdown, risk_level, executive_summary, architecture_assessment, topology_assessment, security_findings, performance_insights, cost_optimization, acr_opportunities, zero_trust_assessment, compliance_status, recommendations } = data

  return (
    <div className="space-y-6">
      {/* Header / Score */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Brain className="w-6 h-6 text-blue-400" />
          <div>
            <h2 className="text-lg font-semibold text-gray-200">AI Network Assessment</h2>
            <p className="text-xs text-gray-500">
              {data._cached ? `Cached analysis • ` : ''}Model: {data.model || 'unknown'} • {data.analysis_timestamp ? new Date(data.analysis_timestamp).toLocaleString() : ''}
            </p>
          </div>
        </div>
        <button onClick={() => runAnalysis(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Re-analyze
        </button>
      </div>

      {/* Score Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5 flex flex-col items-center justify-center">
          <ScoreRing score={overall_network_score || 0} label="Overall" size={110} />
          <span className={clsx('mt-2 px-3 py-0.5 rounded-full text-xs font-semibold border',
            risk_level === 'Critical' ? 'bg-red-900/40 text-red-300 border-red-800/50' :
            risk_level === 'High' ? 'bg-orange-900/40 text-orange-300 border-orange-800/50' :
            risk_level === 'Medium' ? 'bg-yellow-900/40 text-yellow-300 border-yellow-800/50' :
            'bg-green-900/40 text-green-300 border-green-800/50'
          )}>{risk_level} Risk</span>
        </div>

        <div className="lg:col-span-3 bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Score Breakdown</h4>
          {score_breakdown && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5">
              {Object.entries(score_breakdown).map(([key, val]) => (
                <ScoreBar key={key} label={key.replace(/_/g, ' ')} score={val} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Executive Summary */}
      {executive_summary && (
        <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl p-4">
          <p className="text-sm text-blue-200">{executive_summary}</p>
        </div>
      )}

      {/* Architecture Assessment */}
      {architecture_assessment && (
        <CollapsibleSection title="Architecture Assessment" icon={Activity} color="purple" expanded={expandedSections.arch} onToggle={() => toggle('arch')}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <MiniStat label="Topology" value={architecture_assessment.topology_type} />
            <MiniStat label="Design Quality" value={architecture_assessment.design_quality} />
            <MiniStat label="Scalability" value={architecture_assessment.scalability_rating} />
            <MiniStat label="DR Readiness" value={architecture_assessment.dr_readiness} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h5 className="text-xs font-semibold text-green-400 mb-1">Strengths</h5>
              <ul className="space-y-1">{(architecture_assessment.strengths || []).map((s, i) => <li key={i} className="text-xs text-gray-300 flex gap-1"><CheckCircle className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />{s}</li>)}</ul>
            </div>
            <div>
              <h5 className="text-xs font-semibold text-orange-400 mb-1">Weaknesses</h5>
              <ul className="space-y-1">{(architecture_assessment.weaknesses || []).map((s, i) => <li key={i} className="text-xs text-gray-300 flex gap-1"><AlertTriangle className="w-3 h-3 text-orange-400 mt-0.5 shrink-0" />{s}</li>)}</ul>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Topology Assessment (Hub-Spoke / Multi-Region) */}
      {topology_assessment && (
        <CollapsibleSection title="Hub-Spoke Topology Assessment" icon={Network} color="purple" expanded={expandedSections.topo !== false} onToggle={() => toggle('topo')}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <MiniStat label="Topology Pattern" value={topology_assessment.detected_pattern || '—'} />
            <MiniStat label="Design Quality" value={topology_assessment.design_quality || '—'} />
            <MiniStat label="Total Hubs" value={(topology_assessment.hub_analysis || []).length} />
            <MiniStat label="Total Spokes" value={topology_assessment.spoke_assessment?.total_spokes || 0} />
          </div>

          {/* Hub Details */}
          {topology_assessment.hub_analysis && topology_assessment.hub_analysis.length > 0 && (
            <div className="mb-4">
              <h5 className="text-xs font-semibold text-purple-400 mb-2 flex items-center gap-1"><Router className="w-3 h-3" /> Hub VNets</h5>
              <div className="space-y-3">
                {topology_assessment.hub_analysis.map((hub, idx) => (
                  <div key={idx} className="bg-gray-800/60 border border-purple-900/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-purple-300">{hub.hub_name}</span>
                      <span className="text-xs text-gray-500 flex items-center gap-1"><MapPin className="w-3 h-3" />{hub.region}</span>
                      <span className="text-xs bg-purple-900/40 text-purple-300 px-2 py-0.5 rounded-full border border-purple-800/50">{hub.role}</span>
                      <span className="ml-auto text-xs text-gray-400">{hub.spoke_count} spokes</span>
                    </div>
                    {hub.firewall_assessment && <p className="text-xs text-gray-400 mb-1"><span className="text-orange-400">Firewall:</span> {hub.firewall_assessment}</p>}
                    {hub.gateway_assessment && <p className="text-xs text-gray-400 mb-1"><span className="text-cyan-400">Gateway:</span> {hub.gateway_assessment}</p>}
                    {hub.nva_assessment && <p className="text-xs text-gray-400 mb-1"><span className="text-yellow-400">NVA:</span> {hub.nva_assessment}</p>}
                    {hub.issues && hub.issues.length > 0 && (
                      <div className="mt-2">
                        {hub.issues.map((issue, i) => <p key={i} className="text-xs text-red-400 flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{issue}</p>)}
                      </div>
                    )}
                    {hub.recommendations && hub.recommendations.length > 0 && (
                      <div className="mt-1">
                        {hub.recommendations.map((rec, i) => <p key={i} className="text-xs text-blue-400">→ {rec}</p>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Spoke Summary */}
          {topology_assessment.spoke_assessment && (
            <div className="mb-4">
              <h5 className="text-xs font-semibold text-blue-400 mb-2">Spoke Connectivity</h5>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
                <MiniStat label="Properly Connected" value={topology_assessment.spoke_assessment.properly_connected || 0} />
                <MiniStat label="Using Remote GW" value={topology_assessment.spoke_assessment.using_remote_gateway || 0} />
                <MiniStat label="Forced Tunnel OK" value={topology_assessment.spoke_assessment.forced_tunnel_compliant || 0} />
                <MiniStat label="Total Spokes" value={topology_assessment.spoke_assessment.total_spokes || 0} />
              </div>
              {topology_assessment.spoke_assessment.issues && topology_assessment.spoke_assessment.issues.length > 0 && (
                <ul className="space-y-1">
                  {topology_assessment.spoke_assessment.issues.map((issue, i) => <li key={i} className="text-xs text-orange-400 flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{issue}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* Multi-Region Assessment */}
          {topology_assessment.multi_region_assessment && topology_assessment.multi_region_assessment.is_multi_region && (
            <div className="mb-4">
              <h5 className="text-xs font-semibold text-cyan-400 mb-2 flex items-center gap-1"><Globe className="w-3 h-3" /> Multi-Region Assessment</h5>
              <div className="bg-gray-800/60 border border-cyan-900/30 rounded-lg p-3">
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <MiniStat label="Regions" value={(topology_assessment.multi_region_assessment.regions || []).join(', ')} />
                  <MiniStat label="Global Peering" value={topology_assessment.multi_region_assessment.global_peering_status} />
                  <MiniStat label="Failover" value={topology_assessment.multi_region_assessment.failover_capability} />
                </div>
                {topology_assessment.multi_region_assessment.cross_region_routing && <p className="text-xs text-gray-400 mb-1"><span className="text-cyan-400">Routing:</span> {topology_assessment.multi_region_assessment.cross_region_routing}</p>}
                {topology_assessment.multi_region_assessment.latency_considerations && <p className="text-xs text-gray-400 mb-1"><span className="text-yellow-400">Latency:</span> {topology_assessment.multi_region_assessment.latency_considerations}</p>}
                {topology_assessment.multi_region_assessment.recommendations && topology_assessment.multi_region_assessment.recommendations.length > 0 && (
                  <div className="mt-2">
                    {topology_assessment.multi_region_assessment.recommendations.map((rec, i) => <p key={i} className="text-xs text-blue-400">→ {rec}</p>)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Routing Assessment */}
          {topology_assessment.routing_assessment && (
            <div className="mb-4">
              <h5 className="text-xs font-semibold text-yellow-400 mb-2">Routing Analysis</h5>
              <div className="bg-gray-800/60 rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-1"><span className="text-yellow-400">Forced Tunneling:</span> {topology_assessment.routing_assessment.forced_tunneling}</p>
                <p className="text-xs text-gray-400 mb-1"><span className="text-yellow-400">Default Route Coverage:</span> {topology_assessment.routing_assessment.default_route_coverage}</p>
                <p className="text-xs text-gray-400 mb-1"><span className="text-yellow-400">Asymmetric Risk:</span> {topology_assessment.routing_assessment.asymmetric_routing_risk}</p>
                {topology_assessment.routing_assessment.black_hole_risks && topology_assessment.routing_assessment.black_hole_risks.length > 0 && (
                  <div className="mt-1">
                    {topology_assessment.routing_assessment.black_hole_risks.map((r, i) => <p key={i} className="text-xs text-red-400 flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{r}</p>)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Blast Radius */}
          {topology_assessment.blast_radius_analysis && topology_assessment.blast_radius_analysis.single_points_of_failure && topology_assessment.blast_radius_analysis.single_points_of_failure.length > 0 && (
            <div className="mb-4">
              <h5 className="text-xs font-semibold text-red-400 mb-2">Blast Radius Analysis</h5>
              <div className="bg-red-900/10 border border-red-900/30 rounded-lg p-3">
                {topology_assessment.blast_radius_analysis.single_points_of_failure.map((spf, i) => <p key={i} className="text-xs text-red-300 flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{spf}</p>)}
                {topology_assessment.blast_radius_analysis.max_blast_radius && <p className="text-xs text-gray-400 mt-2">Worst case: {topology_assessment.blast_radius_analysis.max_blast_radius}</p>}
              </div>
            </div>
          )}

          {/* Connectivity Gaps */}
          {topology_assessment.connectivity_gaps && topology_assessment.connectivity_gaps.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-orange-400 mb-2">Connectivity Gaps ({topology_assessment.connectivity_gaps.length})</h5>
              <div className="space-y-2">
                {topology_assessment.connectivity_gaps.map((gap, idx) => (
                  <div key={idx} className="bg-gray-800/50 rounded-lg p-3 flex gap-3">
                    <SeverityBadge severity={gap.severity} />
                    <div className="flex-1">
                      <p className="text-xs text-gray-200 font-medium">{gap.affected_resource}</p>
                      <p className="text-xs text-gray-400">{gap.description}</p>
                      {gap.remediation && <p className="text-xs text-blue-400 mt-0.5">→ {gap.remediation}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Security Findings */}
      {security_findings && security_findings.length > 0 && (
        <CollapsibleSection title={`Security Findings (${security_findings.length})`} icon={Shield} color="red" expanded={expandedSections.sec !== false} onToggle={() => toggle('sec')}>
          <div className="space-y-3">
            {security_findings.map((f, idx) => (
              <div key={idx} className="bg-gray-800/50 border border-gray-700/40 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <SeverityBadge severity={f.severity} />
                  <span className="text-xs text-gray-500">{f.category}</span>
                  {f.acr_opportunity && <span className="ml-auto text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full border border-blue-800/50">Adoption</span>}
                </div>
                <p className="text-sm font-medium text-gray-200">{f.title}</p>
                <p className="text-xs text-gray-400 mt-1">{f.description}</p>
                {f.remediation && <p className="text-xs text-blue-400 mt-1">→ {f.remediation}</p>}
                {f.business_impact && <p className="text-xs text-orange-400 mt-0.5">Impact: {f.business_impact}</p>}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Cloud Adoption Opportunities */}
      {acr_opportunities && acr_opportunities.length > 0 && (
        <CollapsibleSection title={`Cloud Adoption Opportunities (${acr_opportunities.length})`} icon={TrendingUp} color="blue" expanded={expandedSections.acr !== false} onToggle={() => toggle('acr')}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {acr_opportunities.map((opp, idx) => (
              <div key={idx} className="bg-gray-800/60 border border-gray-700/40 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full border',
                    opp.priority === 'High' ? 'bg-orange-900/40 text-orange-300 border-orange-800/50' : 'bg-blue-900/40 text-blue-300 border-blue-800/50'
                  )}>{opp.priority}</span>
                  <span className="text-sm font-bold text-emerald-300">${(opp.estimated_monthly_acr || 0).toLocaleString()}/mo</span>
                </div>
                <p className="text-sm font-medium text-gray-200">{opp.service}</p>
                <p className="text-xs text-gray-400 mt-1">{opp.business_justification}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                  <span>Complexity: {opp.implementation_complexity}</span>
                  {opp.quick_win && <span className="text-green-400">⚡ Quick Win</span>}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Cost Optimization */}
      {cost_optimization && (
        <CollapsibleSection title="Cost Optimization" icon={DollarSign} color="emerald" expanded={expandedSections.cost} onToggle={() => toggle('cost')}>
          <div className="flex gap-4 mb-4">
            <MiniStat label="Total Spend" value={`$${(cost_optimization.total_networking_spend || 0).toLocaleString()}`} />
            <MiniStat label="Estimated Waste" value={`$${(cost_optimization.estimated_waste || 0).toLocaleString()}`} highlight />
          </div>
          {cost_optimization.optimization_actions && cost_optimization.optimization_actions.length > 0 && (
            <div className="space-y-2">
              {cost_optimization.optimization_actions.map((a, idx) => (
                <div key={idx} className="flex items-center justify-between bg-gray-800/50 rounded-lg p-3">
                  <div>
                    <p className="text-sm text-gray-200">{a.title}</p>
                    <p className="text-xs text-gray-500">Effort: {a.effort}</p>
                  </div>
                  <span className="text-sm font-bold text-emerald-300">${(a.monthly_savings || 0).toLocaleString()}/mo</span>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Zero Trust */}
      {zero_trust_assessment && (
        <CollapsibleSection title="Zero Trust Assessment" icon={Lock} color="cyan" expanded={expandedSections.zt} onToggle={() => toggle('zt')}>
          <div className="flex items-center gap-6 mb-4">
            <ScoreRing score={zero_trust_assessment.score || 0} label="ZT Score" size={80} />
            <div>
              <p className="text-sm text-gray-300">Maturity: <span className="font-semibold text-cyan-300">{zero_trust_assessment.maturity_level}</span></p>
              {zero_trust_assessment.gaps && (
                <ul className="mt-2 space-y-1">
                  {zero_trust_assessment.gaps.map((g, i) => <li key={i} className="text-xs text-gray-400 flex gap-1"><AlertTriangle className="w-3 h-3 text-yellow-400 mt-0.5 shrink-0" />{g}</li>)}
                </ul>
              )}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Recommendations */}
      {recommendations && recommendations.length > 0 && (
        <CollapsibleSection title={`Recommendations (${recommendations.length})`} icon={Target} color="amber" expanded={expandedSections.recs !== false} onToggle={() => toggle('recs')}>
          <div className="space-y-3">
            {recommendations.map((rec, idx) => (
              <div key={idx} className="bg-gray-800/50 border border-gray-700/40 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <PriorityBadge priority={rec.priority} />
                  <span className="text-xs text-gray-500">{rec.category}</span>
                  {rec.estimated_monthly_acr > 0 && <span className="ml-auto text-xs text-emerald-300 font-semibold">${rec.estimated_monthly_acr}/mo savings</span>}
                  {rec.quick_win && <span className="text-xs text-green-400">⚡</span>}
                </div>
                <p className="text-sm font-medium text-gray-200">{rec.title}</p>
                <p className="text-xs text-gray-400 mt-1">{rec.description}</p>
                {rec.implementation_steps && (
                  <ul className="mt-2 space-y-0.5">
                    {rec.implementation_steps.map((s, i) => <li key={i} className="text-xs text-gray-500 pl-3 relative before:absolute before:left-0 before:content-['→'] before:text-blue-500">{s}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Action Plans */}
      {(data['30_day_plan'] || data['90_day_plan']) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data['30_day_plan'] && (
            <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-yellow-400" /> 30-Day Plan</h4>
              <ol className="space-y-1.5">
                {data['30_day_plan'].map((a, i) => <li key={i} className="text-xs text-gray-300 flex gap-2"><span className="text-yellow-400 font-bold">{i + 1}.</span>{a}</li>)}
              </ol>
            </div>
          )}
          {data['90_day_plan'] && (
            <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2"><Target className="w-4 h-4 text-purple-400" /> 90-Day Plan</h4>
              <ol className="space-y-1.5">
                {data['90_day_plan'].map((a, i) => <li key={i} className="text-xs text-gray-300 flex gap-2"><span className="text-purple-400 font-bold">{i + 1}.</span>{a}</li>)}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function CollapsibleSection({ title, icon: Icon, color = 'blue', expanded = true, onToggle, children }) {
  const borderMap = { red: 'border-red-800/40', blue: 'border-blue-800/40', purple: 'border-purple-800/40', emerald: 'border-emerald-800/40', cyan: 'border-cyan-800/40', amber: 'border-amber-800/40' }
  const iconMap = { red: 'text-red-400', blue: 'text-blue-400', purple: 'text-purple-400', emerald: 'text-emerald-400', cyan: 'text-cyan-400', amber: 'text-amber-400' }
  return (
    <div className={clsx('bg-gray-900/80 border rounded-xl', borderMap[color] || 'border-gray-700/60')}>
      <button onClick={onToggle} className="w-full flex items-center gap-2 p-4 text-left">
        <Icon className={clsx('w-4 h-4', iconMap[color])} />
        <span className="text-sm font-semibold text-gray-300 flex-1">{title}</span>
        <ChevronRight className={clsx('w-4 h-4 text-gray-500 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

function MiniStat({ label, value, highlight = false }) {
  return (
    <div className="bg-gray-800/50 rounded-lg px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={clsx('text-sm font-semibold', highlight ? 'text-red-300' : 'text-gray-200')}>{value}</p>
    </div>
  )
}

function ScoreBar({ label, score }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-yellow-500' : score >= 40 ? 'bg-orange-500' : 'bg-red-500'
  const textColor = score >= 80 ? 'text-green-400' : score >= 60 ? 'text-yellow-400' : score >= 40 ? 'text-orange-400' : 'text-red-400'
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 capitalize w-32 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 bg-gray-700/60 rounded-full overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${Math.max(score, 2)}%` }} />
      </div>
      <span className={clsx('text-xs font-bold w-8 text-right', textColor)}>{score}</span>
    </div>
  )
}
