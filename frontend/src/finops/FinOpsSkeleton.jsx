/**
 * FinOps layout-matched skeleton loaders.
 * All skeletons use Tailwind's animate-pulse for a smooth shimmer effect
 * that matches the dark theme (`bg-slate-700/50` on `bg-[#111827]`).
 *
 * Usage:
 *   if (loading) return <KPISkeleton count={6} />
 *   if (loading) return <ChartSkeleton height={340} />
 *   if (loading) return <TableSkeleton rows={12} cols={5} />
 */

import React from 'react'

// ─── Primitive ────────────────────────────────────────────────────────────────
function Pulse({ className = '', style = {} }) {
  return (
    <div
      className="animate-pulse rounded"
      style={{ background: 'rgba(255,255,255,0.06)', ...style }}
    />
  )
}

// ─── KPI cards row ────────────────────────────────────────────────────────────
export function KPISkeleton({ count = 6 }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${Math.min(count, 6)}, minmax(0, 1fr))`,
      gap: 16,
      marginBottom: 24,
    }}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          style={{
            background: '#111827',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: '20px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Pulse style={{ width: 100, height: 13 }} />
            <Pulse style={{ width: 28, height: 28, borderRadius: 7 }} />
          </div>
          <Pulse style={{ width: '60%', height: 26 }} />
          <Pulse style={{ width: '40%', height: 11 }} />
        </div>
      ))}
    </div>
  )
}

// ─── Single chart area ────────────────────────────────────────────────────────
export function ChartSkeleton({ height = 300, title = true }) {
  return (
    <div style={{
      background: '#111827',
      border: '1px solid #1e293b',
      borderRadius: 12,
      padding: '20px 18px',
    }}>
      {title && <Pulse style={{ width: 180, height: 14, marginBottom: 18 }} />}
      <Pulse style={{ width: '100%', height }} />
    </div>
  )
}

// ─── Two-chart row (e.g. bar + pie side-by-side) ──────────────────────────────
export function DualChartSkeleton({ height = 280 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
      <ChartSkeleton height={height} />
      <ChartSkeleton height={height} />
    </div>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────
export function TableSkeleton({ rows = 8, cols = 5 }) {
  return (
    <div style={{
      background: '#111827',
      border: '1px solid #1e293b',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {/* header row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 16,
        padding: '12px 16px',
        borderBottom: '1px solid #1e293b',
        background: '#0a0f1e',
      }}>
        {Array.from({ length: cols }, (_, i) => (
          <Pulse key={i} style={{ height: 12, width: `${50 + Math.random() * 40}%` }} />
        ))}
      </div>
      {/* data rows */}
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 16,
            padding: '11px 16px',
            borderBottom: r < rows - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}
        >
          {Array.from({ length: cols }, (_, c) => (
            <Pulse key={c} style={{ height: 11, width: c === 0 ? '80%' : `${30 + Math.random() * 50}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Filter bar skeleton ──────────────────────────────────────────────────────
export function FilterSkeleton({ items = 5 }) {
  return (
    <div style={{
      display: 'flex',
      gap: 12,
      flexWrap: 'wrap',
      padding: '14px 16px',
      background: '#111827',
      border: '1px solid #1e293b',
      borderRadius: 10,
      marginBottom: 16,
    }}>
      {Array.from({ length: items }, (_, i) => (
        <Pulse key={i} style={{ width: 130 + i * 10, height: 34, borderRadius: 7 }} />
      ))}
      <Pulse style={{ width: 90, height: 34, borderRadius: 7, marginLeft: 'auto' }} />
    </div>
  )
}

// ─── Full FinOps Overview page skeleton ──────────────────────────────────────
export function OverviewSkeleton() {
  return (
    <div style={{ padding: '0 2px' }}>
      <KPISkeleton count={6} />
      <DualChartSkeleton height={260} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 24 }}>
        <ChartSkeleton height={220} />
        <ChartSkeleton height={220} />
      </div>
      <TableSkeleton rows={6} cols={5} />
    </div>
  )
}

// ─── Full Cost Explorer skeleton ──────────────────────────────────────────────
export function ExplorerSkeleton() {
  return (
    <div style={{ padding: '0 2px' }}>
      <FilterSkeleton items={6} />
      <ChartSkeleton height={320} />
      <div style={{ marginTop: 16 }}>
        <TableSkeleton rows={10} cols={6} />
      </div>
    </div>
  )
}
