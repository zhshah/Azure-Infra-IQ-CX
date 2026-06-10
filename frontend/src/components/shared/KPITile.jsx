import React from 'react';
import { RADIUS, BG, BORDER, TEXT, KPI } from '../styles/tokens';

/**
 * Shared KPITile — standardized metric tile used across all panels.
 *
 * Props:
 *  - label: string
 *  - value: string | number
 *  - icon: React component (lucide-react icon) or null
 *  - accent: color string (top border accent)
 *  - onClick: optional click handler (for drill-down)
 *  - subtitle: optional small text below value
 *  - trend: optional { direction: 'up'|'down', value: string }
 */
export default function KPITile({ label, value, icon: Icon, accent, onClick, subtitle, trend }) {
  const accentColor = accent || '#3b82f6';

  return (
    <div
      onClick={onClick}
      style={{
        background: BG.card,
        border: `1px solid ${BORDER.default}`,
        borderTop: `${KPI.accentBorderWidth}px solid ${accentColor}`,
        borderRadius: KPI.radius,
        padding: KPI.padding,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, background 0.15s',
        minWidth: 0,
      }}
      onMouseEnter={e => {
        if (onClick) {
          e.currentTarget.style.borderColor = accentColor;
          e.currentTarget.style.background = BG.surface;
        }
      }}
      onMouseLeave={e => {
        if (onClick) {
          e.currentTarget.style.borderColor = BORDER.default;
          e.currentTarget.style.borderTop = `${KPI.accentBorderWidth}px solid ${accentColor}`;
          e.currentTarget.style.background = BG.card;
        }
      }}
    >
      {/* Icon + Label row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {Icon && <Icon size={14} style={{ color: accentColor, flexShrink: 0 }} />}
        <span style={{
          fontSize: KPI.labelSize,
          fontWeight: 600,
          color: TEXT.muted,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {label}
        </span>
      </div>

      {/* Value */}
      <div style={{
        fontSize: KPI.valueSize,
        fontWeight: 700,
        color: TEXT.primary,
        lineHeight: 1.2,
      }}>
        {value}
      </div>

      {/* Optional subtitle */}
      {subtitle && (
        <div style={{ fontSize: 10, color: TEXT.dim, marginTop: 2 }}>
          {subtitle}
        </div>
      )}

      {/* Optional trend indicator */}
      {trend && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          marginTop: 4,
          fontSize: 10,
          fontWeight: 600,
          color: trend.direction === 'up' ? '#22c55e' : '#ef4444',
        }}>
          <span>{trend.direction === 'up' ? '↑' : '↓'}</span>
          <span>{trend.value}</span>
        </div>
      )}
    </div>
  );
}

/**
 * KPIGrid — standard grid container for KPI tiles.
 * Uses CSS Grid with auto-fill responsive columns.
 */
export function KPIGrid({ children, minWidth, gap }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth || KPI.gridMin}px, 1fr))`,
      gap: gap || KPI.gap,
    }}>
      {children}
    </div>
  );
}
