import React, { useEffect, useState } from 'react'
import ResourceDetailDrawer from '../ResourceDetailDrawer'
import clsx from 'clsx'
import {
  Shield, AlertTriangle, Globe, Network, Wifi, Lock,
  Activity, DollarSign, TrendingUp, RefreshCw, ChevronRight,
  Server, Eye, Zap, AlertCircle, CheckCircle, XCircle,
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

function ScoreGauge({ score, label, size = 'md' }) {
  const color = score >= 80 ? 'text-green-400' : score >= 60 ? 'text-yellow-400' : score >= 40 ? 'text-orange-400' : 'text-red-400'
  const bgColor = score >= 80 ? 'stroke-green-900/50' : score >= 60 ? 'stroke-yellow-900/50' : score >= 40 ? 'stroke-orange-900/50' : 'stroke-red-900/50'
  const fgColor = score >= 80 ? 'stroke-green-400' : score >= 60 ? 'stroke-yellow-400' : score >= 40 ? 'stroke-orange-400' : 'stroke-red-400'
  const sz = size === 'lg' ? 100 : 70
  const sw = size === 'lg' ? 8 : 6
  const r = (sz - sw) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ

  return (
    <div className="flex flex-col items-center">
      <svg width={sz} height={sz} className="transform -rotate-90">
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" strokeWidth={sw} className={bgColor} />
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" strokeWidth={sw} className={fgColor}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <span className={clsx('font-bold mt-1', color, size === 'lg' ? 'text-2xl -mt-14' : 'text-lg -mt-11')}>{score}</span>
      {label && <span className="text-xs text-gray-400 mt-5">{label}</span>}
    </div>
  )
}

function HBarChart({ data, maxItems = 8 }) {
  const entries = Object.entries(data).slice(0, maxItems)
  if (!entries.length) return <p className="text-gray-500 text-sm">No data</p>
  const maxVal = Math.max(...entries.map(([, v]) => v), 1)
  return (
    <div className="space-y-2">
      {entries.map(([label, value]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-32 truncate text-right">{label}</span>
          <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500/60 rounded-full" style={{ width: `${(value / maxVal) * 100}%` }} />
          </div>
          <span className="text-xs text-gray-300 w-10 text-right">{value}</span>
        </div>
      ))}
    </div>
  )
}

function CostBar({ data, maxItems = 8 }) {
  const entries = Object.entries(data).filter(([, v]) => v > 0).slice(0, maxItems)
  if (!entries.length) return <p className="text-gray-500 text-sm">No cost data</p>
  const maxVal = Math.max(...entries.map(([, v]) => v), 1)
  return (
    <div className="space-y-2">
      {entries.map(([label, value]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-36 truncate text-right">{label}</span>
          <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500/50 rounded-full" style={{ width: `${(value / maxVal) * 100}%` }} />
          </div>
          <span className="text-xs text-emerald-300 w-16 text-right">${value.toFixed(0)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function NetworkingDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedResource, setSelectedResource] = useState(null)

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const resp = await api.getNetworkingDashboard()
      setData(resp)
    } catch (e) {
      setError(e.message || 'Failed to load networking data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
        <span className="ml-3 text-gray-400">Loading networking assessment...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p className="text-red-300">{error}</p>
        <button onClick={fetchData} className="mt-3 px-4 py-1.5 bg-red-700 text-white rounded text-sm hover:bg-red-600">Retry</button>
      </div>
    )
  }

  if (!data || data.empty) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 text-center">
        <Network className="w-8 h-8 text-gray-500 mx-auto mb-2" />
        <p className="text-gray-400">No networking resources found. Run a scan first.</p>
      </div>
    )
  }

  const { kpi, component_inventory, cost_breakdown, regional_distribution, security_posture, architecture_review, public_ip_analysis, nsg_analysis, gateway_analysis, design_issues, acr_opportunities, high_risk_resources } = data

  return (
    <>
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard icon={Network} label="Network Resources" value={kpi.total_networking_resources} sub={`${kpi.networking_pct}% of estate`} />
        <KpiCard icon={Shield} label="Security Score" value={`${kpi.security_score}/100`} sub={kpi.security_score >= 70 ? 'Good' : kpi.security_score >= 40 ? 'Needs Work' : 'Critical'} color={kpi.security_score >= 70 ? 'green' : kpi.security_score >= 40 ? 'yellow' : 'red'} />
        <KpiCard icon={AlertTriangle} label="Design Issues" value={kpi.design_issues_count} sub={`${kpi.critical_issues} Critical, ${kpi.high_issues} High`} color={kpi.critical_issues > 0 ? 'red' : kpi.high_issues > 0 ? 'orange' : 'green'} />
        <KpiCard icon={DollarSign} label="Network Cost" value={`$${kpi.total_networking_cost.toLocaleString()}`} sub="This month" />
        <KpiCard icon={TrendingUp} label="ACR Potential" value={`$${kpi.total_monthly_acr_potential.toLocaleString()}`} sub={`${kpi.acr_opportunity_count} opportunities`} color="blue" />
        <KpiCard icon={Globe} label="Public IPs" value={kpi.public_ips} sub={`${public_ip_analysis.unattached} unattached`} color={public_ip_analysis.unattached > 0 ? 'orange' : 'green'} />
        <KpiCard icon={Lock} label="Private Endpoints" value={kpi.private_endpoints} sub={`${kpi.vnets} VNets`} />
      </div>

      {/* Security Score + Architecture */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Security Gauge */}
        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" /> Security Posture
          </h3>
          <div className="flex justify-center mb-4">
            <ScoreGauge score={kpi.security_score} label="Security Score" size="lg" />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <PostureItem label="Firewall" active={security_posture.has_firewall} />
            <PostureItem label="DDoS Plan" active={security_posture.has_ddos} />
            <PostureItem label="WAF" active={security_posture.has_waf} />
            <PostureItem label="Bastion" active={security_posture.has_bastion} />
            <PostureItem label="Private Endpoints" value={security_posture.private_endpoints} />
            <PostureItem label="NSG Allow *" value={security_posture.nsgs_with_allow_star} bad />
          </div>
        </div>

        {/* Architecture Review */}
        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-purple-400" /> Architecture
          </h3>
          <div className="mb-3">
            <span className="text-xs text-gray-500">Topology</span>
            <p className="text-lg font-bold text-purple-300">{architecture_review.topology}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <ArchItem label="VNets" value={architecture_review.total_vnets} />
            <ArchItem label="Peerings" value={architecture_review.total_peerings} />
            <ArchItem label="NAT Gateways" value={architecture_review.nat_gateways} />
            <ArchItem label="Route Tables" value={architecture_review.route_tables} />
            <ArchItem label="Flow Logs" value={architecture_review.flow_logs_enabled} />
            <ArchItem label="VPN/ER Connections" value={architecture_review.vpn_er_connections} />
          </div>
        </div>

        {/* Gateway Analysis */}
        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Wifi className="w-4 h-4 text-cyan-400" /> Gateways & Connectivity
          </h3>
          <div className="space-y-3">
            <ArchItem label="VPN Gateways" value={gateway_analysis.vpn_gateways} />
            <ArchItem label="ExpressRoute Gateways" value={gateway_analysis.expressroute_gateways} />
            <ArchItem label="ER Circuits" value={gateway_analysis.expressroute_circuits} />
            <ArchItem label="Total Gateways" value={gateway_analysis.total_gateways} />
          </div>
          <div className="mt-4 border-t border-gray-700 pt-3">
            <h4 className="text-xs font-semibold text-gray-400 mb-2">Public IP Breakdown</h4>
            <div className="grid grid-cols-2 gap-1 text-xs">
              <span className="text-gray-500">Total:</span><span className="text-gray-300">{public_ip_analysis.total}</span>
              <span className="text-gray-500">Attached:</span><span className="text-green-400">{public_ip_analysis.attached}</span>
              <span className="text-gray-500">Unattached:</span><span className="text-orange-400">{public_ip_analysis.unattached}</span>
              <span className="text-gray-500">Basic SKU:</span><span className="text-red-400">{public_ip_analysis.basic_sku}</span>
              <span className="text-gray-500">Standard SKU:</span><span className="text-green-400">{public_ip_analysis.standard_sku}</span>
              <span className="text-gray-500">No Zone:</span><span className="text-yellow-400">{public_ip_analysis.no_zone_redundancy}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Component Inventory + Cost + Regional */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Server className="w-4 h-4 text-blue-400" /> Component Inventory
          </h3>
          <HBarChart data={component_inventory} maxItems={10} />
        </div>

        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" /> Cost by Component
          </h3>
          <CostBar data={cost_breakdown} />
        </div>

        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Globe className="w-4 h-4 text-sky-400" /> Regional Distribution
          </h3>
          <HBarChart data={regional_distribution} />
        </div>
      </div>

      {/* Design Issues */}
      {design_issues && design_issues.length > 0 && (
        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-400" /> Design Issues & Anti-Patterns
            <span className="ml-auto text-xs bg-gray-800 px-2 py-0.5 rounded-full text-gray-400">{design_issues.length} issues</span>
          </h3>
          <div className="space-y-3">
            {design_issues.map((issue, idx) => (
              <div key={idx} className="bg-gray-800/50 border border-gray-700/40 rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={issue.severity} />
                    <span className="text-xs text-gray-500">{issue.category}</span>
                  </div>
                  {issue.monthly_waste && <span className="text-xs text-red-400">${issue.monthly_waste}/mo waste</span>}
                  {issue.acr_opportunity && <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-0.5 rounded-full border border-blue-800/50">ACR Opportunity</span>}
                </div>
                <p className="text-sm font-medium text-gray-200 mt-1">{issue.title}</p>
                <p className="text-xs text-gray-400 mt-1">{issue.description}</p>
                <p className="text-xs text-blue-400 mt-1">→ {issue.action}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cloud Adoption Opportunities */}
      {acr_opportunities && acr_opportunities.length > 0 && (
        <div className="bg-gray-900/80 border border-blue-800/40 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-400" /> Cloud Adoption Opportunities
            <span className="ml-auto text-sm font-bold text-blue-300">${kpi.total_monthly_acr_potential.toLocaleString()}/mo savings potential</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {acr_opportunities.map((opp, idx) => (
              <div key={idx} className="bg-gray-800/60 border border-gray-700/40 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full border', opp.priority === 'High' ? 'bg-orange-900/40 text-orange-300 border-orange-800/50' : 'bg-blue-900/40 text-blue-300 border-blue-800/50')}>{opp.priority}</span>
                  <span className="text-sm font-bold text-emerald-300">${opp.estimated_monthly_acr.toLocaleString()}/mo</span>
                </div>
                <p className="text-sm font-medium text-gray-200">{opp.service}</p>
                <p className="text-xs text-gray-400 mt-1">{opp.description}</p>
                <p className="text-xs text-gray-500 mt-2 italic">{opp.business_case}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NSG Analysis + High Risk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* NSG */}
        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-yellow-400" /> NSG Analysis
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-800/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-gray-200">{nsg_analysis.total}</p>
              <p className="text-xs text-gray-500">Total NSGs</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-orange-400">{nsg_analysis.with_allow_star_rules}</p>
              <p className="text-xs text-gray-500">Allow * Rules</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-400">{nsg_analysis.allow_all_inbound}</p>
              <p className="text-xs text-gray-500">Allow All Inbound</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-yellow-400">{nsg_analysis.not_attached}</p>
              <p className="text-xs text-gray-500">Orphaned</p>
            </div>
          </div>
        </div>

        {/* High Risk Resources */}
        <div className="bg-gray-900/80 border border-gray-700/60 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" /> High Risk Resources
          </h3>
          {high_risk_resources && high_risk_resources.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {high_risk_resources.slice(0, 10).map((r, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-gray-800/50 rounded p-2 cursor-pointer hover:bg-gray-700/50"
                  onClick={() => r.resource_id && setSelectedResource(r)}>
                  <span className={clsx('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
                    r.risk_score >= 70 ? 'bg-red-900/60 text-red-300' : r.risk_score >= 50 ? 'bg-orange-900/60 text-orange-300' : 'bg-yellow-900/60 text-yellow-300'
                  )}>{r.risk_score}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 truncate">{r.resource_name}{r.resource_id && <span className="text-blue-400 ml-1">↗</span>}</p>
                    <p className="text-xs text-gray-500 truncate">{r.reasons?.join(', ')}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No high-risk resources detected.</p>
          )}
        </div>
      </div>
    </div>

      {selectedResource && (
        <ResourceDetailDrawer
          resourceId={selectedResource.resource_id}
          resourceName={selectedResource.resource_name}
          onClose={() => setSelectedResource(null)}
        />
      )}
    </>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color = 'default' }) {
  const colorMap = {
    green:   'border-green-800/50 bg-green-900/10',
    red:     'border-red-800/50 bg-red-900/10',
    orange:  'border-orange-800/50 bg-orange-900/10',
    yellow:  'border-yellow-800/50 bg-yellow-900/10',
    blue:    'border-blue-800/50 bg-blue-900/10',
    default: 'border-gray-700/60 bg-gray-900/80',
  }
  const textColor = {
    green: 'text-green-300', red: 'text-red-300', orange: 'text-orange-300',
    yellow: 'text-yellow-300', blue: 'text-blue-300', default: 'text-gray-200',
  }
  return (
    <div className={clsx('rounded-xl p-3 border', colorMap[color])}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <p className={clsx('text-lg font-bold', textColor[color])}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function PostureItem({ label, active, value, bad = false }) {
  if (typeof active === 'boolean') {
    return (
      <div className="flex items-center gap-1.5">
        {active ? <CheckCircle className="w-3 h-3 text-green-400" /> : <XCircle className="w-3 h-3 text-red-400" />}
        <span className={active ? 'text-green-300' : 'text-red-300'}>{label}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-400">{label}:</span>
      <span className={bad && value > 0 ? 'text-red-300 font-semibold' : 'text-gray-300'}>{value}</span>
    </div>
  )
}

function ArchItem({ label, value }) {
  return (
    <div className="flex items-center justify-between bg-gray-800/40 rounded px-2 py-1.5">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-200 font-semibold">{value}</span>
    </div>
  )
}
