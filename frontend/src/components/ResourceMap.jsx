import React, { useMemo, useRef, useState, useEffect } from 'react'
import { X, ExternalLink, ZoomIn, ZoomOut, Maximize2, AlertTriangle, Network, Search, Filter, Layers, RotateCcw } from 'lucide-react'
import { SCORE_HEX, SCORE_HEX_DEFAULT } from '../scoreColors'

const SCORE_COLOR  = SCORE_HEX
const DEFAULT_COLOR = SCORE_HEX_DEFAULT

// ── Resource group panel colours ───────────────────────────────────────────────
const RG_COLORS = [
  { fill: 'rgba(59,130,246,0.07)',  stroke: 'rgba(59,130,246,0.22)'  },
  { fill: 'rgba(139,92,246,0.07)', stroke: 'rgba(139,92,246,0.22)'  },
  { fill: 'rgba(20,184,166,0.07)', stroke: 'rgba(20,184,166,0.22)'  },
  { fill: 'rgba(245,158,11,0.07)', stroke: 'rgba(245,158,11,0.22)'  },
  { fill: 'rgba(236,72,153,0.07)', stroke: 'rgba(236,72,153,0.22)'  },
  { fill: 'rgba(16,185,129,0.07)', stroke: 'rgba(16,185,129,0.22)'  },
  { fill: 'rgba(251,146,60,0.07)', stroke: 'rgba(251,146,60,0.22)'  },
]

// ── Type icons ─────────────────────────────────────────────────────────────────
const TYPE_ICON = {
  'virtualmachines': 'VM', 'storageaccounts': 'St', 'sites': 'App',
  'serverfarms': 'Plan', 'virtualnetworks': 'VNet', 'networksecuritygroups': 'NSG',
  'publicipaddresses': 'IP', 'managedclusters': 'AKS', 'vaults': 'KV',
  'accounts': 'AI', 'workspaces': 'WS', 'namespaces': 'SB',
  'servers': 'SQL', 'flexibleservers': 'PG', 'components': 'AI',
  'disks': 'Disk', 'networkinterfaces': 'NIC', 'loadbalancers': 'LB',
  'applicationgateways': 'AGW', 'dnszones': 'DNS', 'privatednszones': 'DNS',
  'containerregistries': 'ACR', 'redis': 'Cache', 'searchservices': 'Srch',
}
function getTypeIcon(resourceType) {
  const lower = resourceType.toLowerCase()
  for (const [key, icon] of Object.entries(TYPE_ICON)) {
    if (lower.includes(key)) return icon
  }
  return lower.split('/').pop().slice(0, 3).replace(/^\w/, c => c.toUpperCase())
}

// ── Connection inference ───────────────────────────────────────────────────────
function commonPrefixLen(a, b) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function inferConnections(resources) {
  const edges = [], seen = new Set()
  const ids = new Set(resources.map(r => r.resource_id))
  function addEdge(s, t, type) {
    if (s === t || !ids.has(s) || !ids.has(t)) return
    const key = [s, t].sort().join('||')
    if (!seen.has(key)) { seen.add(key); edges.push({ source: s, target: t, type }) }
  }
  const t  = r => (r.resource_type || '').toLowerCase()
  const nn = r => (r.resource_name || '').toLowerCase().replace(/[-_]/g, '')
  const has = (r, ...kw) => kw.some(k => t(r).includes(k))
  const pick = (...kw) => resources.filter(r => has(r, ...kw))

  // ── Intra-resource-group inference (app tier + network fabric) ──
  const byRG = {}
  for (const r of resources) { (byRG[r.resource_group] ||= []).push(r) }
  for (const rg of Object.values(byRG)) {
    const plans   = rg.filter(r => has(r, 'serverfarms'))
    const sites   = rg.filter(r => has(r, '/sites'))
    const vnets   = rg.filter(r => has(r, 'virtualnetworks'))
    const vms     = rg.filter(r => has(r, '/virtualmachines'))
    const nsgs    = rg.filter(r => has(r, 'networksecuritygroups'))
    const storage = rg.filter(r => has(r, 'storageaccounts'))
    const kv      = rg.filter(r => has(r, '/vaults'))
    const aks     = rg.filter(r => has(r, 'managedclusters'))
    for (const p of plans) for (const s of sites) addEdge(p.resource_id, s.resource_id, 'hosts')
    for (const v of vnets) {
      for (const m of vms)  addEdge(v.resource_id, m.resource_id, 'network')
      for (const n of nsgs) addEdge(v.resource_id, n.resource_id, 'network')
      for (const a of aks)  addEdge(v.resource_id, a.resource_id, 'network')
    }
    if (storage.length && sites.length) {
      const funcs = sites.filter(s => /func|fn[-_]|[-_]fn/i.test(s.resource_name))
      for (const st of storage) for (const fn of funcs) addEdge(st.resource_id, fn.resource_id, 'storage')
    }
    for (const vault of kv) {
      const base = nn(vault).replace(/(kv|keyvault|vault)/g, '')
      if (base.length >= 3) for (const r of rg) {
        if (r.resource_id === vault.resource_id) continue
        if (nn(r).includes(base)) addEdge(vault.resource_id, r.resource_id, 'dependency')
      }
    }
  }

  // ── Global, cross-resource-group type linkage (deeper coverage) ──
  const vms   = pick('/virtualmachines'), nics = pick('networkinterfaces'), disks = pick('/disks')
  const pes   = pick('privateendpoints'), comps = pick('microsoft.insights/components')
  const works = pick('operationalinsights/workspaces'), acrs = pick('containerregistries')
  const aks   = pick('managedclusters'), sites = pick('/sites'), vnets = pick('virtualnetworks')
  const lbs   = pick('loadbalancers'), agws = pick('applicationgateways')
  const sql   = pick('sql/servers', '/flexibleservers'), cosmos = pick('databaseaccounts')
  const redis = pick('/redis'), storage = pick('storageaccounts'), kv = pick('/vaults')

  // NIC -> VM, Disk -> VM (Azure names them after the VM)
  for (const nic of nics) { const b = nn(nic).replace(/(nic|interface)\d*$/, ''); if (b.length >= 4) for (const vm of vms) if (nn(vm) === b || nn(vm).startsWith(b) || b.startsWith(nn(vm))) addEdge(nic.resource_id, vm.resource_id, 'compute') }
  for (const dk of disks) { const b = nn(dk).replace(/(osdisk|datadisk|disk)\d*.*$/, ''); if (b.length >= 4) for (const vm of vms) if (nn(vm) === b || nn(vm).startsWith(b) || b.startsWith(nn(vm))) addEdge(dk.resource_id, vm.resource_id, 'compute') }
  // Private endpoint -> the service it fronts (by name root)
  for (const pe of pes) { const b = nn(pe).replace(/(pe|privateendpoint|endpoint|pep)\d*$/, ''); if (b.length >= 4) for (const r of resources) { if (r.resource_id === pe.resource_id) continue; if (nn(r).includes(b)) addEdge(pe.resource_id, r.resource_id, 'private') } }
  // App Insights -> Log Analytics workspace; AKS -> ACR (same RG)
  for (const c of comps) for (const w of works) if (c.resource_group === w.resource_group) addEdge(c.resource_id, w.resource_id, 'monitor')
  for (const a of aks)   for (const acr of acrs) if (a.resource_group === acr.resource_group) addEdge(a.resource_id, acr.resource_id, 'dependency')
  // Web/Function apps -> backing data services by name root (cross-RG)
  const stores = [...sql.map(r => [r, 'data']), ...cosmos.map(r => [r, 'data']), ...redis.map(r => [r, 'data']), ...storage.map(r => [r, 'storage']), ...kv.map(r => [r, 'dependency'])]
  for (const s of sites) { const root = nn(s).replace(/(app|web|func|fn|api|site)\d*$/, ''); if (root.length < 4) continue; for (const [ds, et] of stores) if (nn(ds).includes(root) || root.includes(nn(ds))) addEdge(s.resource_id, ds.resource_id, et) }
  // Load balancers / app gateways -> backends (same RG)
  for (const lb of lbs)  for (const vm of vms)  if (lb.resource_group === vm.resource_group) addEdge(lb.resource_id, vm.resource_id, 'network')
  for (const g of agws)  for (const s of sites) if (g.resource_group === s.resource_group) addEdge(g.resource_id, s.resource_id, 'network')
  // VNet peering (hub-spoke): a 'hub' vnet connects to all others, else shared name root
  const hub = vnets.find(v => /hub/i.test(v.resource_name))
  if (hub) { for (const v of vnets) if (v.resource_id !== hub.resource_id) addEdge(hub.resource_id, v.resource_id, 'network') }
  else for (let i = 0; i < vnets.length; i++) for (let j = i + 1; j < vnets.length; j++) {
    const a = nn(vnets[i]).replace(/(vnet|network|vn)\d*$/, ''), b = nn(vnets[j]).replace(/(vnet|network|vn)\d*$/, '')
    if (a.length >= 4 && (a === b || a.startsWith(b) || b.startsWith(a))) addEdge(vnets[i].resource_id, vnets[j].resource_id, 'network')
  }

  // ── Fallback: same-RG shared naming convention (runs LAST so specific
  //    relationships above keep their labels; only fills unconnected pairs) ──
  for (const rg of Object.values(byRG)) {
    if (rg.length > 40) continue
    for (let i = 0; i < rg.length; i++)
      for (let j = i + 1; j < rg.length; j++)
        if (commonPrefixLen(nn(rg[i]), nn(rg[j])) >= 5) addEdge(rg[i].resource_id, rg[j].resource_id, 'app')
  }
  return edges
}

// ── Force layout ───────────────────────────────────────────────────────────────
function computeLayout(nodes, edges, W, H) {
  if (!nodes.length) return {}
  const groups = [...new Set(nodes.map(n => n.group))]
  const gCount = groups.length
  const cx = W/2, cy = H/2
  const orbitR = Math.min(W,H) * (gCount === 1 ? 0 : 0.30)
  const clusterPos = {}
  groups.forEach((g,i) => {
    const angle = (i/gCount)*Math.PI*2 - Math.PI/2
    clusterPos[g] = { x: cx + orbitR*Math.cos(angle), y: cy + orbitR*Math.sin(angle) }
  })
  const pos = {}
  for (const n of nodes) {
    const cp = clusterPos[n.group]
    pos[n.id] = { x: cp.x+(Math.random()-0.5)*120, y: cp.y+(Math.random()-0.5)*120, vx:0, vy:0 }
  }
  const ITERS=160, REPULSE=1800, SPRING=0.06, GRAVITY=0.025, DAMP=0.72
  for (let iter=0; iter<ITERS; iter++) {
    const alpha = 1 - iter/ITERS
    const ids = Object.keys(pos)
    for (let i=0; i<ids.length; i++)
      for (let j=i+1; j<ids.length; j++) {
        const a=pos[ids[i]], b=pos[ids[j]]
        const dx=b.x-a.x, dy=b.y-a.y
        const d2=dx*dx+dy*dy||0.01, d=Math.sqrt(d2), f=REPULSE/d2
        a.vx-=f*dx/d; a.vy-=f*dy/d; b.vx+=f*dx/d; b.vy+=f*dy/d
      }
    for (const e of edges) {
      const a=pos[e.source], b=pos[e.target]
      if (!a||!b) continue
      const dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy)||1, f=(d-130)*SPRING
      a.vx+=f*dx/d; a.vy+=f*dy/d; b.vx-=f*dx/d; b.vy-=f*dy/d
    }
    for (const n of nodes) {
      const p=pos[n.id], cp=clusterPos[n.group]
      p.vx+=(cp.x-p.x)*GRAVITY; p.vy+=(cp.y-p.y)*GRAVITY
    }
    for (const n of nodes) {
      const p=pos[n.id]
      p.vx*=DAMP; p.vy*=DAMP
      p.x=Math.max(n.r+8,Math.min(W-n.r-8,p.x+p.vx*alpha))
      p.y=Math.max(n.r+8,Math.min(H-n.r-8,p.y+p.vy*alpha))
    }
  }
  return pos
}

// ── Edge styles ────────────────────────────────────────────────────────────────
const EDGE_STYLE = {
  hosts:      { stroke: '#60a5fa', dasharray: '',     particleColor: '#93c5fd', label: 'Hosts' },
  network:    { stroke: '#34d399', dasharray: '',     particleColor: '#6ee7b7', label: 'Network' },
  compute:    { stroke: '#22d3ee', dasharray: '',     particleColor: '#67e8f9', label: 'Compute (NIC/Disk)' },
  storage:    { stroke: '#fb923c', dasharray: '4 2',  particleColor: '#fdba74', label: 'Storage' },
  data:       { stroke: '#f43f5e', dasharray: '4 2',  particleColor: '#fda4af', label: 'Data store' },
  private:    { stroke: '#facc15', dasharray: '1 3',  particleColor: '#fde047', label: 'Private link' },
  monitor:    { stroke: '#38bdf8', dasharray: '2 3',  particleColor: '#7dd3fc', label: 'Monitoring' },
  dependency: { stroke: '#a78bfa', dasharray: '2 3',  particleColor: '#c4b5fd', label: 'Dependency' },
  app:        { stroke: 'var(--c-94a3b8)', dasharray: '3 3',  particleColor: 'var(--c-cbd5e1)', label: 'App grouping' },
}

// ── Animated flow particle ─────────────────────────────────────────────────────
function FlowParticle({ pathD, color, duration, delay = 0 }) {
  return (
    <circle r={2.5} fill={color} opacity={0.95} style={{ filter: `drop-shadow(0 0 3px ${color})` }}>
      <animateMotion dur={`${duration}s`} begin={`${delay}s`} repeatCount="indefinite" path={pathD} />
    </circle>
  )
}

// ── Hover tooltip ──────────────────────────────────────────────────────────────
function NodeTooltip({ node, mousePos, containerRef }) {
  if (!node || !containerRef.current) return null
  const rect = containerRef.current.getBoundingClientRect()
  const x = mousePos.x - rect.left
  const y = mousePos.y - rect.top
  const color = SCORE_COLOR[node.data.score_label] ?? DEFAULT_COLOR
  const tipW = 220
  const left = x + tipW + 16 > rect.width ? x - tipW - 12 : x + 16
  const top  = Math.max(8, Math.min(y - 20, rect.height - 180))
  return (
    <div className="absolute z-30 pointer-events-none" style={{ left, top, width: tipW }}>
      <div className="bg-gray-900 border border-gray-700/80 rounded-xl shadow-2xl overflow-hidden"
           style={{ boxShadow: `0 0 20px ${color}22, 0 8px 32px rgba(0,0,0,0.6)` }}>
        <div className="px-3 py-2.5 border-b border-gray-800">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
            <span className="text-xs font-semibold" style={{ color }}>{node.data.score_label}</span>
            <span className="text-xs text-gray-500 ml-auto">Score {node.data.final_score?.toFixed(0)}</span>
          </div>
          <p className="text-sm font-semibold text-white leading-tight break-all">{node.data.resource_name}</p>
        </div>
        <div className="px-3 py-2 space-y-1 text-xs text-gray-400">
          <div className="flex justify-between">
            <span className="text-gray-600">Type</span>
            <span className="text-gray-300">{node.data.resource_type.split('/').pop()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Group</span>
            <span className="text-gray-300 truncate max-w-[130px] text-right">{node.data.resource_group}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">This month</span>
            <span className="text-white font-medium">${node.data.cost_current_month?.toFixed(2)}</span>
          </div>
          {node.data.estimated_monthly_savings > 0 && (
            <div className="flex justify-between border-t border-gray-800 pt-1">
              <span className="text-green-600">Est. savings</span>
              <span className="text-green-400 font-medium">${node.data.estimated_monthly_savings?.toFixed(2)}/mo</span>
            </div>
          )}
          {node.data.is_orphan && (
            <div className="flex items-center gap-1.5 border-t border-gray-800 pt-1 text-orange-400">
              <AlertTriangle size={10} /><span>Orphaned resource</span>
            </div>
          )}
        </div>
        <div className="px-3 py-1.5 bg-gray-800/50 border-t border-gray-800">
          <p className="text-xs text-gray-600">Click to pin details</p>
        </div>
      </div>
    </div>
  )
}

// ── Detail panel ───────────────────────────────────────────────────────────────
function DetailPanel({ resource, connectedResources, onClose }) {
  if (!resource) return null
  const color = SCORE_COLOR[resource.score_label] ?? DEFAULT_COLOR
  return (
    <div className="absolute right-0 top-0 h-full w-72 bg-gray-900/98 border-l border-gray-800 flex flex-col shadow-2xl z-20">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="min-w-0 pr-2">
          <p className="text-sm font-semibold text-white break-all leading-tight">{resource.resource_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{resource.resource_type.split('/').pop()}</p>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 shrink-0"><X size={15}/></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
          <span className="font-medium" style={{ color }}>{resource.score_label}</span>
          <span className="text-gray-500 ml-auto">Score {resource.final_score?.toFixed(0)}</span>
        </div>
        <div className="space-y-1.5 text-gray-400">
          <div><span className="text-gray-600">Group: </span>{resource.resource_group}</div>
          {resource.location && <div><span className="text-gray-600">Region: </span>{resource.location}</div>}
          {resource.sku      && <div><span className="text-gray-600">SKU: </span>{resource.sku}</div>}
        </div>
        <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-1.5">
          <div className="flex justify-between">
            <span className="text-gray-500">This month</span>
            <span className="text-white font-semibold">${resource.cost_current_month?.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Last month</span>
            <span className="text-gray-400">${resource.cost_previous_month?.toFixed(2)}</span>
          </div>
          {resource.estimated_monthly_savings > 0 && (
            <div className="flex justify-between border-t border-gray-700/60 pt-1.5">
              <span className="text-green-600">Est. savings</span>
              <span className="text-green-400 font-semibold">${resource.estimated_monthly_savings?.toFixed(2)}</span>
            </div>
          )}
        </div>
        {resource.ai_explanation && (
          <div className="bg-indigo-950/40 border border-indigo-800/40 rounded-lg p-3">
            <p className="text-indigo-400 font-medium mb-1">Analysis</p>
            <p className="text-gray-300 leading-relaxed">{resource.ai_explanation}</p>
          </div>
        )}
        {resource.recommendation && (
          <div className="bg-gray-800/40 border border-gray-700/60 rounded-lg p-3">
            <p className="text-gray-400 leading-relaxed">{resource.recommendation}</p>
          </div>
        )}
        {connectedResources.length > 0 && (
          <div>
            <p className="text-gray-500 font-medium uppercase tracking-wider mb-2">Connected</p>
            <div className="space-y-1.5">
              {connectedResources.map(cr => (
                <div key={cr.resource_id} className="flex items-center gap-2 bg-gray-800/40 rounded-lg px-2.5 py-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SCORE_COLOR[cr.score_label] ?? DEFAULT_COLOR }} />
                  <span className="text-gray-300 break-all flex-1 leading-tight">{cr.resource_name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {resource.is_orphan && (
          <div className="flex items-start gap-2 bg-orange-950/30 border border-orange-800/40 rounded-lg p-3">
            <AlertTriangle size={13} className="text-orange-400 shrink-0 mt-0.5"/>
            <div>
              <p className="text-orange-300 font-medium">Orphaned</p>
              <p className="text-orange-400/80 mt-0.5">{resource.orphan_reason}</p>
            </div>
          </div>
        )}
      </div>
      {resource.portal_url && (
        <div className="px-4 py-3 border-t border-gray-800">
          <a href={resource.portal_url} target="_blank" rel="noopener noreferrer"
             className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors">
            <ExternalLink size={12}/> Open in Azure Portal
          </a>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
const MAX_NODES  = 80
const NODE_LIMITS = [80, 150, 250, 600]
const SVG_W      = 1100
const SVG_H      = 700
const MIN_RADIUS = 10
const MAX_RADIUS = 34
const RG_PAD     = 44

// Friendly resource-type label for the type filter
const TYPE_LABEL = {
  'virtualmachines': 'Virtual Machines', 'storageaccounts': 'Storage', 'sites': 'App Service / Functions',
  'serverfarms': 'App Service Plans', 'virtualnetworks': 'Virtual Networks', 'networksecuritygroups': 'NSGs',
  'publicipaddresses': 'Public IPs', 'managedclusters': 'AKS', 'vaults': 'Key Vaults',
  'operationalinsights/workspaces': 'Log Analytics', 'namespaces': 'Messaging', 'sql/servers': 'SQL Servers',
  'flexibleservers': 'PostgreSQL / MySQL', 'components': 'App Insights', 'disks': 'Disks',
  'networkinterfaces': 'NICs', 'loadbalancers': 'Load Balancers', 'applicationgateways': 'App Gateways',
  'dnszones': 'DNS Zones', 'privatednszones': 'Private DNS', 'containerregistries': 'Container Registry',
  'redis': 'Redis Cache', 'searchservices': 'AI Search', 'privateendpoints': 'Private Endpoints',
  'databaseaccounts': 'Cosmos DB', 'accounts': 'AI / Cognitive',
}
function typeLabel(resourceType) {
  const lower = (resourceType || '').toLowerCase()
  for (const [key, label] of Object.entries(TYPE_LABEL)) if (lower.includes(key)) return label
  return lower.split('/').pop().replace(/^\w/, c => c.toUpperCase()) || 'Other'
}
const HEALTH_FILTERS = [
  { key: 'all',       label: 'All health' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'orphan',    label: 'Orphaned' },
  { key: 'idle',      label: 'Idle' },
  { key: 'underused', label: 'Underused' },
]
function matchHealth(r, health) {
  if (health === 'all') return true
  if (health === 'orphan') return !!r.is_orphan
  if (health === 'idle') return r.score_label === 'Idle'
  if (health === 'underused') return r.score_label === 'Underused'
  if (health === 'attention') return !!r.is_orphan || r.score_label === 'Idle' || r.score_label === 'Underused'
  return true
}

export default function ResourceMap({ resources = [], onNavigate }) {
  const svgRef       = useRef(null)
  const containerRef = useRef(null)
  const [selected,   setSelected]   = useState(null)
  const [hovered,    setHovered]    = useState(null)
  const [mousePos,   setMousePos]   = useState({ x: 0, y: 0 })
  const [filterRG,   setFilterRG]   = useState('')
  const [filterType, setFilterType] = useState('')
  const [search,     setSearch]     = useState('')
  const [health,     setHealth]     = useState('all')
  const [nodeLimit,  setNodeLimit]  = useState(MAX_NODES)
  const [hiddenEdges, setHiddenEdges] = useState(() => new Set())
  const [zoom,       setZoom]       = useState(1)
  const [pan,        setPan]        = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const lastPan  = useRef({ x: 0, y: 0 })

  const resourceGroups = useMemo(
    () => [...new Set(resources.map(r => r.resource_group))].sort(),
    [resources],
  )

  // Distinct resource types (friendly label) ordered by frequency
  const resourceTypes = useMemo(() => {
    const counts = {}
    for (const r of resources) { const l = typeLabel(r.resource_type); counts[l] = (counts[l] || 0) + 1 }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }))
  }, [resources])

  // Apply all advanced filters, then rank by cost and cap to the node budget
  const topResources = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rs = resources.filter(r =>
      (!filterRG   || r.resource_group === filterRG) &&
      (!filterType || typeLabel(r.resource_type) === filterType) &&
      matchHealth(r, health) &&
      (!q || (r.resource_name || '').toLowerCase().includes(q)
          || (r.resource_type || '').toLowerCase().includes(q)
          || (r.resource_group || '').toLowerCase().includes(q))
    )
    return [...rs].sort((a, b) => (b.cost_current_month || 0) - (a.cost_current_month || 0)).slice(0, nodeLimit)
  }, [resources, filterRG, filterType, health, search, nodeLimit])

  const totalMatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return resources.filter(r =>
      (!filterRG   || r.resource_group === filterRG) &&
      (!filterType || typeLabel(r.resource_type) === filterType) &&
      matchHealth(r, health) &&
      (!q || (r.resource_name || '').toLowerCase().includes(q)
          || (r.resource_type || '').toLowerCase().includes(q)
          || (r.resource_group || '').toLowerCase().includes(q))
    ).length
  }, [resources, filterRG, filterType, health, search])

  const maxCost = useMemo(
    () => Math.max(...topResources.map(r => r.cost_current_month||0), 1),
    [topResources],
  )

  const nodes = useMemo(() => topResources.map(r => ({
    id:    r.resource_id,
    label: r.resource_name,
    icon:  getTypeIcon(r.resource_type),
    group: r.resource_group,
    color: SCORE_COLOR[r.score_label] ?? DEFAULT_COLOR,
    r:     MIN_RADIUS + Math.sqrt((r.cost_current_month||0) / maxCost) * (MAX_RADIUS - MIN_RADIUS),
    data:  r,
  })), [topResources, maxCost])

  const edges = useMemo(() => inferConnections(topResources), [topResources])

  // Edge-type counts (for the interactive legend / toggles)
  const edgeTypeCounts = useMemo(() => {
    const c = {}
    for (const e of edges) c[e.type] = (c[e.type] || 0) + 1
    return c
  }, [edges])
  function toggleEdgeType(type) {
    setHiddenEdges(prev => {
      const next = new Set(prev)
      next.has(type) ? next.delete(type) : next.add(type)
      return next
    })
  }

  const layout = useMemo(() => {
    if (!nodes.length) return {}
    return computeLayout(nodes, edges, SVG_W, SVG_H)
  }, [nodes, edges]) // eslint-disable-line

  // RG bounding boxes for floor panels
  const rgPanels = useMemo(() => {
    if (!Object.keys(layout).length) return []
    const groups = [...new Set(nodes.map(n => n.group))]
    return groups.map((group, idx) => {
      const gNodes = nodes.filter(n => n.group === group)
      let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity
      for (const n of gNodes) {
        const p = layout[n.id]
        if (!p) continue
        minX = Math.min(minX, p.x - n.r - RG_PAD)
        minY = Math.min(minY, p.y - n.r - RG_PAD)
        maxX = Math.max(maxX, p.x + n.r + RG_PAD)
        maxY = Math.max(maxY, p.y + n.r + RG_PAD)
      }
      if (minX === Infinity) return null
      const c = RG_COLORS[idx % RG_COLORS.length]
      return { group, x: minX, y: minY, w: maxX-minX, h: maxY-minY, ...c }
    }).filter(Boolean)
  }, [nodes, layout])

  const connectedResources = useMemo(() => {
    if (!selected) return []
    const connIds = new Set()
    for (const e of edges) {
      if (e.source === selected.resource_id) connIds.add(e.target)
      if (e.target === selected.resource_id) connIds.add(e.source)
    }
    return topResources.filter(r => connIds.has(r.resource_id))
  }, [selected, edges, topResources])

  const hoveredNode = useMemo(() => nodes.find(n => n.id === hovered) ?? null, [nodes, hovered])

  const hasActiveFilters = !!(filterRG || filterType || search.trim() || health !== 'all' || nodeLimit !== MAX_NODES)
  function resetFilters() {
    setFilterRG(''); setFilterType(''); setSearch(''); setHealth('all'); setNodeLimit(MAX_NODES); setSelected(null)
  }
  function resetView() { setZoom(1); setPan({ x:0, y:0 }) }

  function onWheel(e) {
    e.preventDefault()
    setZoom(z => Math.max(0.3, Math.min(3, z * (e.deltaY > 0 ? 0.9 : 1.1))))
  }
  function onMouseDown(e) {
    if (e.target.closest('.map-node')) return
    dragging.current = true
    lastPan.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  function onMouseMove(e) {
    setMousePos({ x: e.clientX, y: e.clientY })
    if (!dragging.current) return
    setPan({ x: e.clientX - lastPan.current.x, y: e.clientY - lastPan.current.y })
  }
  function onMouseUp() { dragging.current = false }

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  if (!resources.length) {
    return (
      <div className="card flex items-center justify-center py-20">
        <p className="text-gray-600 text-sm">No resource data available.</p>
      </div>
    )
  }

  return (
    <div className="card p-0 overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-gray-800 space-y-2.5">
        {/* Row 1: title · filters · view controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <Network size={14} className="text-blue-400"/> Resource Map
          </h3>

          {/* Resource group */}
          <select value={filterRG} onChange={e => setFilterRG(e.target.value)}
            title="Filter by resource group"
            className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600 ml-1">
            <option value="">All resource groups ({resourceGroups.length})</option>
            {resourceGroups.map(rg => <option key={rg} value={rg}>{rg}</option>)}
          </select>

          {/* Resource type */}
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            title="Filter by resource type"
            className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600">
            <option value="">All types ({resourceTypes.length})</option>
            {resourceTypes.map(({ label, n }) => <option key={label} value={label}>{label} ({n})</option>)}
          </select>

          {/* Health */}
          <select value={health} onChange={e => setHealth(e.target.value)}
            title="Filter by health / utilisation"
            className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600">
            {HEALTH_FILTERS.map(h => <option key={h.key} value={h.key}>{h.label}</option>)}
          </select>

          {/* Search */}
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"/>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name / type…"
              className="bg-gray-800 border border-gray-700 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-600 w-44"/>
          </div>

          {/* Node budget */}
          <select value={nodeLimit} onChange={e => setNodeLimit(Number(e.target.value))}
            title="Maximum nodes to render (by cost)"
            className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-600 flex items-center gap-1">
            {NODE_LIMITS.map(l => <option key={l} value={l}>Show {l}</option>)}
          </select>

          {hasActiveFilters && (
            <button onClick={resetFilters} className="btn-ghost flex items-center gap-1 text-xs text-amber-400" title="Clear all map filters">
              <RotateCcw size={12}/> Clear
            </button>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setZoom(z => Math.min(3, z*1.2))} className="btn-ghost p-1.5"><ZoomIn size={14}/></button>
            <button onClick={() => setZoom(z => Math.max(0.3, z*0.8))} className="btn-ghost p-1.5"><ZoomOut size={14}/></button>
            <button onClick={resetView} className="btn-ghost p-1.5" title="Reset view"><Maximize2 size={14}/></button>
            {onNavigate && (
              <button onClick={() => onNavigate('architecture-map')} className="btn-ghost flex items-center gap-1.5 text-xs ml-1" title="Open interactive architecture diagram">
                <Network size={13}/> Architecture Map
              </button>
            )}
          </div>
        </div>

        {/* Row 2: score legend + stats */}
        <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap">
          <div className="flex items-center gap-3 text-xs text-gray-600">
            <span className="text-gray-700 flex items-center gap-1"><Layers size={11}/> Health</span>
            {Object.entries(SCORE_COLOR).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }}/>
                {label}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-700 ml-auto flex items-center gap-1.5 flex-wrap">
            <Filter size={11} className="text-gray-600"/>
            <span className="text-gray-500 font-medium">{topResources.length}</span> shown
            {totalMatches > topResources.length && <span className="text-amber-500/80">/ {totalMatches} match (raise “Show” to see more)</span>}
            {!hasActiveFilters && totalMatches === topResources.length && <span>of {resources.length}</span>}
            <span className="text-gray-800">·</span>
            <span className="text-gray-500 font-medium">{edges.length}</span> links
            <span className="text-gray-800">·</span>
            <span className="text-gray-700">{rgPanels.length} RG{rgPanels.length === 1 ? '' : 's'}</span>
            <span className="text-gray-800">·</span>
            <span className="text-gray-700">scoped to the global filter above</span>
          </p>
        </div>
      </div>

      {/* Map canvas */}
      <div ref={containerRef} className="relative" style={{ height: SVG_H }}>
        <svg ref={svgRef} width="100%" height={SVG_H}
          className="cursor-grab active:cursor-grabbing select-none"
          onMouseDown={onMouseDown} onMouseMove={onMouseMove}
          onMouseUp={onMouseUp} onMouseLeave={() => { onMouseUp(); setHovered(null) }}>

          <defs>
            {/* Dot grid background */}
            <pattern id="dot-grid" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1" style={{ fill: 'var(--c-1e293b)' }}/>
            </pattern>

            {/* Node gradients */}
            {nodes.map(n => {
              const gid = `grad-${n.id.replace(/\W/g,'_')}`
              return (
                <radialGradient key={gid} id={gid} cx="35%" cy="30%" r="70%">
                  <stop offset="0%"   stopColor={n.color} stopOpacity="1"   />
                  <stop offset="60%"  stopColor={n.color} stopOpacity="0.75"/>
                  <stop offset="100%" stopColor={n.color} stopOpacity="0.35"/>
                </radialGradient>
              )
            })}

            {/* Glow filters */}
            <filter id="glow-edge" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="glow-node" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="glow-node-lg" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="panel-shadow" x="-5%" y="-5%" width="110%" height="110%">
              <feDropShadow dx="0" dy="2" stdDeviation="8" floodColor="#000" floodOpacity="0.4"/>
            </filter>
          </defs>

          {/* Dot grid background — covers whole SVG, outside transform */}
          <rect width="100%" height="100%" fill="url(#dot-grid)"/>

          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

            {/* RG floor panels */}
            {rgPanels.map(panel => (
              <g key={panel.group}>
                <rect
                  x={panel.x} y={panel.y} width={panel.w} height={panel.h}
                  rx={20} ry={20}
                  fill={panel.fill}
                  stroke={panel.stroke}
                  strokeWidth={1}
                  filter="url(#panel-shadow)"
                />
                <text
                  x={panel.x + 16} y={panel.y + 20}
                  fontSize={11} fill={panel.stroke}
                  fontFamily="ui-monospace, monospace"
                  fontWeight="600" letterSpacing="0.06em"
                  style={{ pointerEvents: 'none' }}>
                  {panel.group}
                </text>
              </g>
            ))}

            {/* Edges */}
            {edges.map((e, i) => {
              const a = layout[e.source], b = layout[e.target]
              if (!a || !b) return null
              if (hiddenEdges.has(e.type)) return null
              const style = EDGE_STYLE[e.type] ?? EDGE_STYLE.app
              const isHighlighted = hovered === e.source || hovered === e.target ||
                selected?.resource_id === e.source || selected?.resource_id === e.target
              const mx = (a.x+b.x)/2 + (b.y-a.y)*0.15
              const my = (a.y+b.y)/2 - (b.x-a.x)*0.15
              const pathD = `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`
              const edgeLen = Math.sqrt((b.x-a.x)**2 + (b.y-a.y)**2)
              const particleDur = Math.max(1.2, edgeLen / 90)

              return (
                <g key={i}>
                  <path d={pathD} fill="none"
                    stroke={style.stroke}
                    strokeWidth={isHighlighted ? 2 : 0.8}
                    strokeDasharray={style.dasharray}
                    opacity={isHighlighted ? 0.9 : 0.15}
                    filter={isHighlighted ? 'url(#glow-edge)' : undefined}
                  />
                  {/* Animated particles on highlighted edges */}
                  {isHighlighted && (
                    <>
                      <FlowParticle pathD={pathD} color={style.particleColor} duration={particleDur} delay={0} />
                      <FlowParticle pathD={pathD} color={style.particleColor} duration={particleDur} delay={particleDur / 2} />
                    </>
                  )}
                </g>
              )
            })}

            {/* Nodes */}
            {nodes.map(n => {
              const p = layout[n.id]
              if (!p) return null
              const isSelected  = selected?.resource_id === n.id
              const isHovered   = hovered === n.id
              const isConnected = selected && connectedResources.some(c => c.resource_id === n.id)
              const dim         = selected && !isSelected && !isConnected
              const gradId      = `grad-${n.id.replace(/\W/g,'_')}`
              const iconSize    = n.icon.length <= 2 ? 11 : n.icon.length <= 3 ? 9 : 8

              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`}
                   className="map-node cursor-pointer"
                   onClick={() => setSelected(isSelected ? null : n.data)}
                   onMouseEnter={() => setHovered(n.id)}
                   onMouseLeave={() => setHovered(null)}>

                  {/* Large bloom glow for selected */}
                  {isSelected && (
                    <circle r={n.r + 4} fill={n.color} fillOpacity={0.25}
                      filter="url(#glow-node-lg)" />
                  )}

                  {/* Medium glow ring */}
                  {(isSelected || isHovered) && (
                    <circle r={n.r + 3} fill={n.color} fillOpacity={0.15}
                      filter="url(#glow-node)" />
                  )}

                  {/* Outer ring */}
                  {(isSelected || isHovered) && (
                    <circle r={n.r + 6} fill="none" stroke={n.color}
                      strokeWidth={isSelected ? 2 : 1.5}
                      opacity={isSelected ? 0.7 : 0.4} />
                  )}

                  {/* Main circle */}
                  <circle r={n.r}
                    fill={dim ? n.color : `url(#${gradId})`}
                    fillOpacity={dim ? 0.08 : 1}
                    stroke={n.color}
                    strokeWidth={isSelected ? 2.5 : isHovered ? 1.5 : 1}
                    strokeOpacity={dim ? 0.12 : isSelected ? 1 : 0.75}
                  />

                  {/* Specular highlight — small bright dot top-left */}
                  {!dim && (
                    <circle
                      r={n.r * 0.28}
                      cx={-n.r * 0.3}
                      cy={-n.r * 0.32}
                      fill="white"
                      fillOpacity={0.2}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}

                  {/* Type icon */}
                  <text textAnchor="middle" dominantBaseline="central"
                    fontSize={iconSize} fontWeight="700" style={{ fill: 'var(--c-0f172a)' }}
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                    opacity={dim ? 0 : 0.88}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {n.icon}
                  </text>

                  {/* Orphan indicator */}
                  {n.data.is_orphan && (
                    <circle r={4.5} cx={n.r-3} cy={-(n.r-3)}
                      fill="#f97316" style={{ stroke: 'var(--c-0f172a)' }} strokeWidth={1} />
                  )}
                </g>
              )
            })}
          </g>
        </svg>

        {/* HTML hover tooltip */}
        {hovered && !selected && hoveredNode && (
          <NodeTooltip node={hoveredNode} mousePos={mousePos} containerRef={containerRef}/>
        )}

        {/* Pinned detail panel */}
        {selected && (
          <DetailPanel resource={selected} connectedResources={connectedResources} onClose={() => setSelected(null)}/>
        )}

        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <p className="text-gray-600 text-sm">No resources match the current filters.</p>
            {hasActiveFilters && (
              <button onClick={resetFilters} className="btn-ghost flex items-center gap-1.5 text-xs text-amber-400">
                <RotateCcw size={12}/> Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Edge legend — click to toggle a connection type on/off */}
      <div className="px-4 py-2 border-t border-gray-800/60 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600">
        <span className="text-gray-700 flex items-center gap-1"><Network size={11}/> Connections</span>
        {Object.entries(EDGE_STYLE)
          .filter(([type]) => edgeTypeCounts[type])
          .map(([type, style]) => {
            const off = hiddenEdges.has(type)
            return (
              <button key={type} onClick={() => toggleEdgeType(type)}
                title={off ? `Show ${style.label} links` : `Hide ${style.label} links`}
                className={`flex items-center gap-1.5 transition-opacity ${off ? 'opacity-35 line-through' : 'hover:text-gray-300'}`}>
                <svg width={24} height={8}>
                  <line x1={0} y1={4} x2={24} y2={4}
                    stroke={style.stroke} strokeWidth={1.5} strokeDasharray={style.dasharray}/>
                </svg>
                {style.label} <span className="text-gray-700">({edgeTypeCounts[type]})</span>
              </button>
            )
          })}
        {edges.length === 0 && <span className="text-gray-700 italic">No connections inferred for this selection</span>}
      </div>
    </div>
  )
}
