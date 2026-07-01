/**
 * EnterpriseCard — Consistent card wrapper for all dashboard modules.
 *
 * Props:
 *   title         — card heading text
 *   subtitle      — optional secondary text
 *   icon          — optional lucide icon component
 *   iconColor     — icon color (default: #0078d4)
 *   badge         — optional badge text (e.g., "Beta", "New")
 *   badgeColor    — badge color
 *   actions       — optional React node rendered in the header right side
 *   collapsible   — if true, card body can be toggled
 *   defaultOpen   — initial collapsed state (default: true = open)
 *   padding       — custom padding (default: '18px 20px')
 *   noPadding     — remove body padding entirely
 *   className     — additional CSS class
 *   style         — additional inline styles
 *   children      — card body content
 */
import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function EnterpriseCard({
  title,
  subtitle,
  icon: Icon,
  iconColor = '#0078d4',
  badge,
  badgeColor = '#0078d4',
  actions,
  collapsible = false,
  defaultOpen = true,
  padding = '18px 20px',
  noPadding = false,
  className = '',
  style = {},
  children,
}) {
  const [expanded, setExpanded] = useState(defaultOpen)

  const hasHeader = title || subtitle || Icon || badge || actions || collapsible

  return (
    <div
      className={className}
      style={{
        background: 'var(--c-111827)',
        border: '1px solid rgba(var(--rgb-slate), 0.7)',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2), 0 1px 2px rgba(0, 0, 0, 0.15)',
        transition: 'box-shadow 0.2s, border-color 0.2s',
        ...style,
      }}
    >
      {/* Header */}
      {hasHeader && (
        <div
          onClick={collapsible ? () => setExpanded(e => !e) : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 20px',
            borderBottom: expanded && children ? '1px solid rgba(var(--rgb-slate), 0.5)' : 'none',
            cursor: collapsible ? 'pointer' : 'default',
            userSelect: collapsible ? 'none' : 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            {Icon && (
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: `${iconColor}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon size={16} style={{ color: iconColor }} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              {title && (
                <div
                  style={{
                    color: 'var(--c-f1f5f9)',
                    fontSize: 14,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {title}
                </div>
              )}
              {subtitle && (
                <div
                  style={{
                    color: 'var(--c-64748b)',
                    fontSize: 11,
                    marginTop: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {subtitle}
                </div>
              )}
            </div>
            {badge && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: badgeColor,
                  background: `${badgeColor}15`,
                  padding: '2px 8px',
                  borderRadius: 6,
                  border: `1px solid ${badgeColor}30`,
                  flexShrink: 0,
                  letterSpacing: '0.03em',
                }}
              >
                {badge}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {actions}
            {collapsible && (
              <ChevronDown
                size={16}
                style={{
                  color: 'var(--c-475569)',
                  transition: 'transform 0.2s',
                  transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Body */}
      {expanded && children && (
        <div style={{ padding: noPadding ? 0 : padding }}>{children}</div>
      )}
    </div>
  )
}
