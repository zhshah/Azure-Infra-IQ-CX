import React from 'react'
import clsx from 'clsx'

/**
 * Layout-stable loading/empty placeholders.
 *
 * These reserve the EXACT footprint of the real dashboard cards so the home
 * grid never collapses or reflows while data is still streaming in (or when a
 * section is momentarily empty). When real data is present the actual component
 * renders unchanged — these are only shown in the no-data / loading window.
 *
 * Styling intentionally matches the existing dark theme (`.card`,
 * bg-gray-800/700) so nothing looks different from the rest of the UI.
 */

// Subtle shimmer block.
export function Shimmer({ className, style }) {
  return <div className={clsx('animate-pulse rounded bg-gray-800/70', className)} style={style} />
}

/**
 * Generic chart/card placeholder. Reserves the same `.card` footprint + a
 * body of the given height so a chart cell keeps its place in a grid row.
 */
export function ChartCardSkeleton({ height = 200, className }) {
  return (
    <div className={clsx('card flex flex-col', className)}>
      <div className="flex items-center justify-between mb-4">
        <Shimmer className="h-4 w-40" />
        <Shimmer className="h-3 w-16" />
      </div>
      <Shimmer className="w-full" style={{ height }} />
    </div>
  )
}

// KPI row placeholder — same 4-column grid + 4 cards as <KPICards/>.
export function KpiCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="card">
          <div className="flex items-center justify-between mb-3">
            <Shimmer className="h-3 w-24" />
            <Shimmer className="h-6 w-6 rounded-lg" />
          </div>
          <Shimmer className="h-8 w-28 mb-3" />
          <Shimmer className="h-2.5 w-full mb-1.5" />
          <Shimmer className="h-2.5 w-2/3" />
        </div>
      ))}
    </div>
  )
}

// Spend-trend placeholder — same card + flex [chart + w-56 sidebar] footprint.
export function SpendTrendSkeleton() {
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div className="space-y-2">
          <Shimmer className="h-4 w-56" />
          <Shimmer className="h-3 w-40" />
        </div>
        <div className="flex gap-4">
          <Shimmer className="h-9 w-20" />
          <Shimmer className="h-9 w-20" />
        </div>
      </div>
      <div className="flex gap-6">
        <Shimmer className="flex-1 min-w-0" style={{ height: 200 }} />
        <div className="w-56 shrink-0 border-l border-gray-800/60 pl-5 space-y-3">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-10 w-full" />
          <Shimmer className="h-10 w-full" />
          <Shimmer className="h-10 w-full" />
        </div>
      </div>
    </div>
  )
}

// AI summary banner placeholder — matches <AIInsightPanel/>'s slim banner.
export function AIInsightSkeleton() {
  return (
    <div className="rounded-xl border bg-gradient-to-r from-indigo-950/60 to-purple-950/40 border-indigo-800/40 p-4">
      <div className="flex items-center gap-2.5">
        <Shimmer className="h-7 w-7 rounded-lg bg-indigo-900/50" />
        <Shimmer className="h-3 w-28 bg-indigo-900/40" />
      </div>
      <div className="mt-3 space-y-2">
        <Shimmer className="h-2.5 w-full bg-indigo-900/30" />
        <Shimmer className="h-2.5 w-5/6 bg-indigo-900/30" />
      </div>
    </div>
  )
}
