import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import clsx from 'clsx'
import {
  Network, AlertTriangle, Search, RefreshCw,
  ChevronDown, ChevronRight, X as XIcon, Target, Info,
  Cpu, HardDrive, Database, Cloud, Shield, Server,
  Layers, Link2, GitBranch, ArrowRight,
} from 'lucide-react'
import { api } from '../../api/client'

// -- Type helpers --

const TYPE_ICON = {
  virtualmachines:        Cpu,
  storageaccounts:        HardDrive,
  databases:              Database,
  servers:                Database,
  virtualnetworks:        Cloud,
  networksecuritygroups:  Shield,
  vaults:                 Shield,
  sites:                  Cloud,
  managedclusters:        Cloud,
  disks:                  HardDrive,
  networkinterfaces:      Link2,
  publicipaddresses:      Cloud,
}

const TYPE_COLOR = {
  virtualmachines:        'bg-blue-900/40 text-blue-300 border-blue-800/50',
  storageaccounts:        'bg-amber-900/40 text-amber-300 border-amber-800/50',
  databases:              'bg-teal-900/40 text-teal-300 border-teal-800/50',
  servers:                'bg-teal-900/40 text-teal-300 border-teal-800/50',
  virtualnetworks:        'bg-indigo-900/40 text-indigo-300 border-indigo-800/50',
  networksecuritygroups:  'bg-red-900/40 text-red-300 border-red-800/50',
  vaults:                 'bg-purple-900/40 text-purple-300 border-purple-800/50',
  sites:                  'bg-green-900/40 text-green-300 border-green-800/50',
  managedclusters:        'bg-cyan-900/40 text-cyan-300 border-cyan-800/50',
}

function getShortType(resourceType) {
  return (resourceType || '').split('/').slice(-1)[0].toLowerCase()
}

function getTypeIcon(resourceType) {
  const short = getShortType(resourceType)
  for (const [k, Icon] of Object.entries(TYPE_ICON)) {
    if (short.includes(k)) return Icon
  }
  return Server
}

function getTypeColor(resourceType) {
  const short = getShortType(resourceType)
  for (const [k, cls] of Object.entries(TYPE_COLOR)) {
    if (short.includes(k)) return cls
  }
  return 'bg-gray-800/60 text-gray-300 border-gray-700/50'
}

// -- Resource Group Card --

function RgCard({ rg, connections, selected, onSelect }) {
  const [expanded, setExpanded] = React.useState(false)
  const hasConnections = connections.length > 0

  return (
    <div
      className={clsx(
        'rounded-xl border transition-all cursor-pointer',
        selected
          ? 'border-blue-500/60 bg-blue-950/20'
          : hasConnections
            ? 'border-teal-700/40 bg-gray-900/50 hover:border-teal-600/60'
            : 'border-gray-800/60 bg-gray-900/40 hover:border-gray-700',
      )}
      onClick={() => onSelect(rg.name)}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={clsx(
            'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
            hasConnections ? 'bg-teal-900/40' : 'bg-gray-800/60',
          )}>
            <Layers size={16} className={hasConnections ? 'text-teal-400' : 'text-gray-500'} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-white truncate">{rg.name}</span>
              {hasConnections && (
                <span className="inline-flex items-center gap-1 text-xs bg-teal-900/30 text-teal-300 border border-teal-800/50 rounded-full px-2 py-0.5">
                  <Link2 size={9} />
                  {connections.length} {connections.length === 1 ? 'link' : 'links'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-gray-500">{rg.nodes.length} resources</span>
              {rg.totalCost > 0 && (
                <span className="text-xs text-green-400">${rg.totalCost.toFixed(0)}/mo</span>
              )}
            </div>
          </div>
          <button
            onClick={e => { e.stopPropagation(); setExpanded(x => !x) }}
            className="text-gray-600 hover:text-gray-400 flex-shrink-0"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>

        <div className="flex flex-wrap gap-1 mt-3">
          {Object.entries(rg.typeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([type, count]) => {
              const Icon = getTypeIcon('microsoft.x/' + type)
              return (
                <span
                  key={type}
                  className={clsx(
                    'inline-flex items-center gap-1 text-xs border rounded-md px-1.5 py-0.5',
                    getTypeColor('microsoft.x/' + type),
                  )}
                >
                  <Icon size={9} />
                  {type}
                  {count > 1 && <span className="opacity-60">x{count}</span>}
                </span>
              )
            })}
          {Object.keys(rg.typeCounts).length > 5 && (
            <span className="text-xs text-gray-600">+{Object.keys(rg.typeCounts).length - 5} more</span>
          )}
        </div>

        {hasConnections && (
          <div className="mt-3 pt-3 border-t border-gray-800/50 space-y-1">
            <p className="text-xs text-gray-600 uppercase tracking-wider font-medium">Connected workloads</p>
            {connections.map(conn => (
              <div key={conn.rg} className="flex items-center gap-2 text-xs">
                <ArrowRight size={10} className="text-teal-500 flex-shrink-0" />
                <span className="text-teal-300 truncate">{conn.rg}</span>
                <span className="text-gray-600 capitalize ml-auto">{conn.type.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-gray-800/50 px-4 py-3">
          <p className="text-xs text-gray-600 font-medium uppercase tracking-wider mb-2">Resources</p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {rg.nodes.map(node => {
              const Icon = getTypeIcon(node.resource_type)
              return (
                <div key={node.resource_id} className="flex items-center gap-2 text-xs text-gray-400">
                  <Icon size={11} className="text-gray-600 flex-shrink-0" />
                  <span className="truncate font-mono">{node.name}</span>
                  {node.cost_monthly > 0 && (
                    <span className="ml-auto text-gray-600 flex-shrink-0">${node.cost_monthly.toFixed(0)}/mo</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// -- SPOF Card --

function SPOFCard({ spof }) {
  const [open, setOpen] = React.useState(false)
  const sev = spof.severity || 'medium'
  const sevCls = {
    critical: 'border-red-700/60 bg-red-950/20 text-red-400',
    high:     'border-orange-700/60 bg-orange-950/20 text-orange-400',
    medium:   'border-yellow-700/50 bg-yellow-950/20 text-yellow-400',
    low:      'border-gray-700/50 bg-gray-900/40 text-gray-400',
  }[sev] || 'border-gray-700/50 bg-gray-900/40 text-gray-400'

  return (
    <div className={clsx('rounded-xl border p-3', sevCls)}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white truncate">{spof.resource_name}</span>
            <span className="text-xs capitalize opacity-80 px-1.5 py-0.5 rounded bg-black/20">{sev}</span>
          </div>
          <p className="text-xs opacity-80 mt-0.5 leading-relaxed">{spof.reason}</p>
          {spof.affected_resources?.length > 0 && (
            <button onClick={() => setOpen(o => !o)} className="text-xs opacity-60 hover:opacity-100 mt-1 flex items-center gap-1">
              {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {spof.affected_resources.length} affected resources
            </button>
          )}
          {open && (
            <ul className="mt-1.5 space-y-0.5">
              {spof.affected_resources.map(id => (
                <li key={id} className="text-xs font-mono opacity-60 truncate">{id.split('/').slice(-1)[0]}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// -- Blast Radius Panel --

function BlastRadiusPanel({ resourceId, onClose }) {
  const [data, setData]       = React.useState(null)
  const [err, setErr]         = React.useState(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!resourceId) return
    setLoading(true)
    fetch('/api/dependencies/' + encodeURIComponent(resourceId) + '/blast-radius')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setErr(e.message); setLoading(false) })
  }, [resourceId])

  return (
    <div className="rounded-xl border border-orange-700/50 bg-orange-950/10 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Target size={14} className="text-orange-400" />
        <span className="text-sm font-semibold text-orange-300">Blast Radius</span>
        <button onClick={onClose} className="ml-auto text-gray-600 hover:text-gray-400"><XIcon size={13} /></button>
      </div>
      {loading && <p className="text-xs text-gray-500 animate-pulse">Calculating...</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
      {data && !loading && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-gray-400">Direct impact: <strong className="text-orange-300">{data.direct_impact_count ?? 0}</strong></span>
            <span className="text-gray-400">Total affected: <strong className="text-orange-300">{data.total_affected ?? 0}</strong></span>
          </div>
          {data.mitigation_suggestion && (
            <p className="text-xs text-orange-300/80 bg-orange-950/30 rounded-lg px-2 py-1.5 leading-relaxed">
              {data.mitigation_suggestion}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// -- RG-level force graph --

function RgForceGraph({ rgList, crossEdges, width = 860, height = 380 }) {
  const canvasRef = useRef(null)
  const simRef    = useRef({ positions: {}, velocities: {} })
  const rafRef    = useRef(null)

  const RG_COLORS = [
    '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
    '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6',
  ]

  useEffect(() => {
    const ids = rgList.map(rg => rg.name)
    ids.forEach((id, i) => {
      if (!simRef.current.positions[id]) {
        const angle = (i / ids.length) * 2 * Math.PI
        simRef.current.positions[id] = {
          x: width / 2 + Math.cos(angle) * (Math.min(width, height) * 0.35),
          y: height / 2 + Math.sin(angle) * (Math.min(width, height) * 0.35),
        }
        simRef.current.velocities[id] = { x: 0, y: 0 }
      }
    })

    const edgeSet = new Set()
    const edgeList = []
    crossEdges.forEach(({ srcRg, tgtRg }) => {
      const key = [srcRg, tgtRg].sort().join('|||')
      if (!edgeSet.has(key)) { edgeSet.add(key); edgeList.push({ src: srcRg, tgt: tgtRg }) }
    })

    const REPEL = 8000, ATTRACT = 0.008, DAMP = 0.65, CENTER_PULL = 0.004

    function tick() {
      const pos = simRef.current.positions
      const vel = simRef.current.velocities
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos[ids[i]], b = pos[ids[j]]
          if (!a || !b) continue
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.max(1, Math.sqrt(dx*dx + dy*dy))
          const force = REPEL / (dist * dist)
          const fx = (dx / dist) * force, fy = (dy / dist) * force
          vel[ids[i]].x -= fx; vel[ids[i]].y -= fy
          vel[ids[j]].x += fx; vel[ids[j]].y += fy
        }
      }
      edgeList.forEach(({ src, tgt }) => {
        const a = pos[src], b = pos[tgt]
        if (!a || !b) return
        const dx = b.x - a.x, dy = b.y - a.y
        vel[src].x += dx * ATTRACT; vel[src].y += dy * ATTRACT
        vel[tgt].x -= dx * ATTRACT; vel[tgt].y -= dy * ATTRACT
      })
      ids.forEach(id => {
        const p = pos[id]; const v = vel[id]
        if (!p || !v) return
        v.x += (width/2 - p.x) * CENTER_PULL
        v.y += (height/2 - p.y) * CENTER_PULL
        v.x *= DAMP; v.y *= DAMP
        p.x = Math.max(50, Math.min(width-50, p.x + v.x))
        p.y = Math.max(30, Math.min(height-30, p.y + v.y))
      })
      draw()
    }

    function draw() {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      const pos = simRef.current.positions
      ctx.clearRect(0, 0, width, height)
      edgeList.forEach(({ src, tgt }) => {
        const a = pos[src], b = pos[tgt]
        if (!a || !b) return
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
        ctx.strokeStyle = '#2dd4bf'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5
        ctx.stroke(); ctx.globalAlpha = 1
      })
      rgList.forEach((rg, i) => {
        const p = pos[rg.name]
        if (!p) return
        const color = RG_COLORS[i % RG_COLORS.length]
        const r = Math.max(14, Math.min(28, 10 + Math.sqrt(rg.nodes.length) * 2.5))
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2)
        ctx.fillStyle = color; ctx.globalAlpha = 0.2; ctx.fill()
        ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold ' + (r > 18 ? '11' : '9') + 'px ui-monospace,monospace'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(rg.nodes.length, p.x, p.y)
        const shortName = rg.name.length > 18 ? rg.name.slice(0,16) + '...' : rg.name
        ctx.fillStyle = '#9ca3af'; ctx.font = '9px ui-sans-serif,sans-serif'
        ctx.textAlign = 'center'; ctx.textBaseline = 'top'
        ctx.fillText(shortName, p.x, p.y + r + 4)
      })
    }

    let ticks = 0
    function animate() { tick(); ticks++; if (ticks < 300) rafRef.current = requestAnimationFrame(animate) }
    animate()
    return () => cancelAnimationFrame(rafRef.current)
  }, [rgList, crossEdges, width, height])

  return (
    <canvas
      ref={canvasRef} width={width} height={height}
      className="rounded-xl border border-gray-800/60 bg-gray-950/50 w-full"
      style={{ maxHeight: height }}
    />
  )
}

// -- Main component --

export default function DependencyGraphView() {
  const [graph,    setGraph]    = useState(null)
  const [spof,     setSpof]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [tab,      setTab]      = useState('workloads')
  const [selected, setSelected] = useState(null)
  const [blastId,  setBlastId]  = useState(null)
  const [search,   setSearch]   = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [graphData, spofData] = await Promise.all([
        fetch('/api/dependencies').then(r => r.json()).catch(() => null),
        api.getDependencySPOF().catch(() => []),
      ])
      setGraph(graphData)
      setSpof(Array.isArray(spofData) ? spofData : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const { rgList, crossEdges, summary } = useMemo(() => {
    if (!graph?.nodes) return { rgList: [], crossEdges: [], summary: {} }
    const groups = {}
    const nRgMap = {}
    graph.nodes.forEach(node => {
      const rg = node.resource_group || 'Unknown'
      nRgMap[node.resource_id] = rg
      if (!groups[rg]) groups[rg] = { name: rg, nodes: [], totalCost: 0, typeCounts: {} }
      groups[rg].nodes.push(node)
      groups[rg].totalCost += node.cost_monthly || 0
      const shortType = getShortType(node.resource_type)
      groups[rg].typeCounts[shortType] = (groups[rg].typeCounts[shortType] || 0) + 1
    })
    const cEdges = []
    ;(graph.edges || []).forEach(edge => {
      const srcRg = nRgMap[edge.source_id]
      const tgtRg = nRgMap[edge.target_id]
      if (srcRg && tgtRg && srcRg !== tgtRg) cEdges.push({ srcRg, tgtRg, type: edge.relationship_type, edge })
    })
    const rgConnMap = {}
    cEdges.forEach(({ srcRg, tgtRg, type }) => {
      if (!rgConnMap[srcRg]) rgConnMap[srcRg] = {}
      if (!rgConnMap[tgtRg]) rgConnMap[tgtRg] = {}
      rgConnMap[srcRg][tgtRg] = type
      rgConnMap[tgtRg][srcRg] = type
    })
    Object.keys(groups).forEach(rg => {
      groups[rg].connections = Object.entries(rgConnMap[rg] || {}).map(([r, t]) => ({ rg: r, type: t }))
    })
    const list = Object.values(groups).sort((a, b) => b.nodes.length - a.nodes.length)
    return {
      rgList: list,
      crossEdges: cEdges,
      summary: { rgCount: list.length, nodeCount: graph.nodes.length, edgeCount: (graph.edges||[]).length, crossEdgeCount: cEdges.length, spofCount: spof.length },
    }
  }, [graph, spof])

  const filteredRg   = useMemo(() => !search ? rgList : rgList.filter(rg => rg.name.toLowerCase().includes(search.toLowerCase()) || Object.keys(rg.typeCounts).some(t => t.includes(search.toLowerCase()))), [rgList, search])
  const filteredSpof = useMemo(() => !search ? spof : spof.filter(s => s.resource_name?.toLowerCase().includes(search.toLowerCase())), [spof, search])
  const selectedRg   = useMemo(() => rgList.find(r => r.name === selected), [rgList, selected])

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <Network size={32} className="text-blue-400 animate-pulse" />
        <p className="text-sm text-gray-400">Building dependency graph...</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center gap-3 py-16">
      <AlertTriangle size={28} className="text-red-400" />
      <p className="text-sm text-red-400">{error}</p>
      <button onClick={load} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  )

  const noData = !graph?.nodes?.length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Network size={16} className="text-blue-400" />
            Infrastructure Dependency Map
          </h3>
          {!noData && (
            <p className="text-xs text-gray-500 mt-0.5">
              {summary.rgCount} resource groups · {summary.nodeCount} resources · {summary.edgeCount} connections · {summary.crossEdgeCount} cross-workload links
            </p>
          )}
        </div>
        <button onClick={load} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Architecture Map deep-link banner */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-gray-800 bg-gray-900/60">
        <Network size={14} className="text-blue-400 shrink-0" />
        <p className="text-xs text-gray-400 flex-1">Need interactive architecture diagrams with auto-layout, cost overlays, and drawing tools?</p>
        <button onClick={() => { const ev = new CustomEvent('navigate', { detail: 'architecture-map' }); window.dispatchEvent(ev) }}
          className="btn-ghost flex items-center gap-1.5 text-xs shrink-0">
          <Network size={12} /> Architecture Map
        </button>
      </div>

      {noData ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center space-y-2">
          <Info size={24} className="text-gray-600 mx-auto" />
          <p className="text-sm text-gray-400">Dependency graph not yet computed.</p>
          <p className="text-xs text-gray-600">Trigger a full scan to build the graph.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Resource Groups',         value: summary.rgCount,        color: 'text-blue-400' },
              { label: 'Total Resources',          value: summary.nodeCount,      color: 'text-indigo-400' },
              { label: 'Cross-RG Connections',     value: summary.crossEdgeCount, color: 'text-teal-400' },
              { label: 'Single Points of Failure', value: summary.spofCount,      color: summary.spofCount > 0 ? 'text-red-400' : 'text-green-400' },
            ].map(kpi => (
              <div key={kpi.label} className="rounded-xl border border-gray-800/60 bg-gray-900/40 p-3">
                <p className={clsx('text-2xl font-bold tabular-nums', kpi.color)}>{kpi.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{kpi.label}</p>
              </div>
            ))}
          </div>

          <div className="relative max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search resource groups or types..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-800/60 border border-gray-700/60 rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
            />
          </div>

          <div className="flex items-center gap-1 border-b border-gray-800 pb-3">
            {[
              { key: 'workloads', label: 'Workloads by Resource Group (' + rgList.length + ')' },
              { key: 'spof',      label: 'Single Points of Failure (' + spof.length + ')' },
              { key: 'graph',     label: 'Visual Map' },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={clsx('px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                  tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200')}
              >{t.label}</button>
            ))}
          </div>

          {tab === 'workloads' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-2 max-h-[65vh] overflow-y-auto pr-1">
                {filteredRg.length === 0 && (
                  <p className="text-xs text-gray-600 py-4 text-center">No resource groups match your search</p>
                )}
                {filteredRg.map(rg => (
                  <RgCard
                    key={rg.name} rg={rg}
                    connections={rg.connections || []}
                    selected={selected === rg.name}
                    onSelect={name => setSelected(prev => prev === name ? null : name)}
                  />
                ))}
              </div>
              <div className="space-y-3">
                {selectedRg ? (
                  <>
                    <div className="rounded-xl border border-blue-700/40 bg-blue-950/20 p-4 space-y-3">
                      <p className="text-sm font-semibold text-blue-300">{selectedRg.name}</p>
                      <div className="text-xs text-gray-400 space-y-1.5">
                        <div className="flex justify-between"><span className="text-gray-600">Resources</span><span>{selectedRg.nodes.length}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">Monthly cost</span><span className="text-green-400">${selectedRg.totalCost.toFixed(0)}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">Cross-RG links</span><span className={selectedRg.connections?.length > 0 ? 'text-teal-400' : 'text-gray-500'}>{selectedRg.connections?.length || 0}</span></div>
                      </div>
                      {selectedRg.nodes.filter(n => n.cost_monthly > 0).length > 0 && (() => {
                        const topNode = selectedRg.nodes.filter(n => n.cost_monthly > 0).sort((a,b) => b.cost_monthly - a.cost_monthly)[0]
                        return (
                          <div>
                            <p className="text-xs text-gray-600 font-medium mb-1">Top resource by cost</p>
                            <p className="text-xs text-gray-300 truncate font-mono">{topNode.name}</p>
                            <p className="text-xs text-green-400">${topNode.cost_monthly.toFixed(0)}/mo</p>
                            <button onClick={() => setBlastId(prev => prev === topNode.resource_id ? null : topNode.resource_id)}
                              className="mt-2 flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300">
                              <Target size={11} />
                              {blastId === topNode.resource_id ? 'Hide' : 'Show'} blast radius
                            </button>
                          </div>
                        )
                      })()}
                    </div>
                    {blastId && <BlastRadiusPanel resourceId={blastId} onClose={() => setBlastId(null)} />}
                  </>
                ) : (
                  <div className="rounded-xl border border-gray-800/40 bg-gray-900/20 p-5 text-center space-y-2">
                    <GitBranch size={20} className="text-gray-600 mx-auto" />
                    <p className="text-xs text-gray-500">Click a resource group to see details and blast radius analysis</p>
                  </div>
                )}
                {crossEdges.length > 0 && (
                  <div className="rounded-xl border border-teal-800/30 bg-teal-950/10 p-3 space-y-2">
                    <p className="text-xs font-medium text-teal-400 flex items-center gap-1.5">
                      <Link2 size={11} /> Cross-workload connections
                    </p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {crossEdges.map((e, i) => (
                        <div key={i} className="flex items-center gap-1 text-xs text-gray-500">
                          <span className="truncate text-gray-400">{e.srcRg.split('-').slice(-1)[0]}</span>
                          <ArrowRight size={9} className="text-teal-600 flex-shrink-0" />
                          <span className="truncate text-gray-400">{e.tgtRg.split('-').slice(-1)[0]}</span>
                          <span className="ml-auto text-gray-700 capitalize whitespace-nowrap text-[10px]">{e.type?.replace(/_/g,' ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'spof' && (
            <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
              {filteredSpof.length === 0 && (
                <div className="rounded-xl border border-green-800/40 bg-green-950/10 p-6 text-center">
                  <p className="text-sm text-green-400">No single points of failure detected</p>
                  <p className="text-xs text-gray-600 mt-1">All {summary.nodeCount} resources have redundant paths or no dependents</p>
                </div>
              )}
              {filteredSpof.map((s, i) => <SPOFCard key={s.resource_id || i} spof={s} />)}
            </div>
          )}

          {tab === 'graph' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-900/40 border border-gray-800/60 rounded-lg p-3">
                <Info size={13} className="text-gray-600 flex-shrink-0 mt-0.5" />
                <p>
                  Each node is a <strong className="text-gray-400">Resource Group</strong>. Node size reflects resource count.
                  Lines show cross-RG dependencies.
                  {crossEdges.length === 0 && <span className="text-yellow-500/80"> No cross-RG dependencies detected — all workloads are isolated.</span>}
                </p>
              </div>
              <RgForceGraph rgList={rgList} crossEdges={crossEdges} width={860} height={380} />
              <p className="text-xs text-gray-700">
                {rgList.length} resource groups · {crossEdges.length} cross-workload connections
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

