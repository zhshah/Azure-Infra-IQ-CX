/**
 * SearchableSelect — Azure Portal-style single-select dropdown with type-ahead search.
 *
 * Features:
 * - Search input inside dropdown with type-ahead filtering
 * - Optional icon per option
 * - Optional count/badge per option
 * - Keyboard navigation (↑ ↓ Enter Esc)
 * - Close on click-outside or Esc
 * - Portal-rendered dropdown avoids clipping
 * - Consistent enterprise dark theme
 *
 * Props:
 *   label         — optional label above the trigger
 *   value         — current selected value (string)
 *   onChange      — (value: string) => void
 *   options       — [{ value, label, icon?, count?, description? }] or ['string']
 *   placeholder   — placeholder text when nothing selected
 *   searchPlaceholder — placeholder for the search input
 *   disabled      — disable the control
 *   width         — optional fixed width
 *   compact       — smaller padding for inline usage
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { ChevronDown, Search, Check, X } from 'lucide-react'

export default function SearchableSelect({
  label,
  value = '',
  onChange,
  options = [],
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  disabled = false,
  width,
  compact = false,
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const containerRef = useRef(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)

  // Normalize options
  const normalized = useMemo(
    () => options.map(o => (typeof o === 'string' ? { value: o, label: o } : o)),
    [options],
  )

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return normalized
    const q = search.toLowerCase()
    return normalized.filter(
      o =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.description || '').toLowerCase().includes(q),
    )
  }, [normalized, search])

  // Selected option label
  const selectedLabel = useMemo(
    () => normalized.find(o => o.value === value)?.label || '',
    [normalized, value],
  )

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Auto-focus search when opened
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus()
      setHighlightIdx(0)
    }
  }, [open])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return
    const items = listRef.current.querySelectorAll('[data-option]')
    if (items[highlightIdx]) {
      items[highlightIdx].scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIdx, open])

  const handleKeyDown = useCallback(
    e => {
      if (!open) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault()
          setOpen(true)
        }
        return
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightIdx(i => Math.min(i + 1, filtered.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightIdx(i => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (filtered[highlightIdx] && !filtered[highlightIdx].disabled) {
            onChange(filtered[highlightIdx].value)
            setOpen(false)
            setSearch('')
          }
          break
        case 'Escape':
          e.preventDefault()
          setOpen(false)
          setSearch('')
          break
      }
    },
    [open, filtered, highlightIdx, onChange],
  )

  const select = val => {
    onChange(val)
    setOpen(false)
    setSearch('')
  }

  const clear = e => {
    e.stopPropagation()
    onChange('')
    setSearch('')
  }

  const py = compact ? '5px' : '7px'

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', minWidth: 0, width: width || '100%' }}
      onKeyDown={handleKeyDown}
    >
      {label && (
        <label
          style={{
            color: '#64748b',
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            display: 'block',
            marginBottom: 4,
          }}
        >
          {label}
        </label>
      )}

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: `${py} 10px`,
          background: open ? '#111827' : '#0f172a',
          border: `1px solid ${open ? '#0078d4' : '#1e293b'}`,
          borderRadius: 7,
          color: value ? '#e2e8f0' : '#64748b',
          fontSize: 13,
          fontWeight: value ? 500 : 400,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'border-color 0.15s, background 0.15s',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'left',
          }}
        >
          {selectedLabel || placeholder}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {value && !disabled && (
            <span
              onClick={clear}
              style={{
                display: 'flex',
                alignItems: 'center',
                color: '#64748b',
                cursor: 'pointer',
                padding: 1,
                borderRadius: 3,
              }}
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown
            size={13}
            style={{
              color: '#475569',
              transition: 'transform 0.2s',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 9999,
            background: '#111827',
            border: '1px solid #334155',
            borderRadius: 8,
            boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3)',
            overflow: 'hidden',
            animation: 'dropdown-in 0.15s ease-out',
          }}
        >
          {/* Search input */}
          {normalized.length > 5 && (
            <div style={{ padding: '8px 10px 6px', borderBottom: '1px solid #1e293b' }}>
              <div style={{ position: 'relative' }}>
                <Search
                  size={13}
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#475569',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => {
                    setSearch(e.target.value)
                    setHighlightIdx(0)
                  }}
                  placeholder={searchPlaceholder}
                  style={{
                    width: '100%',
                    background: '#0f172a',
                    border: '1px solid #1e293b',
                    borderRadius: 6,
                    color: '#e2e8f0',
                    fontSize: 12,
                    padding: '6px 10px 6px 28px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e => (e.target.style.borderColor = '#0078d4')}
                  onBlur={e => (e.target.style.borderColor = '#1e293b')}
                />
              </div>
            </div>
          )}

          {/* Options list */}
          <div
            ref={listRef}
            style={{
              maxHeight: 260,
              overflowY: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: '#1e293b transparent',
            }}
          >
            {filtered.length === 0 && (
              <div style={{ padding: '14px 12px', color: '#475569', fontSize: 12, textAlign: 'center' }}>
                No matches found
              </div>
            )}
            {filtered.map((o, idx) => {
              const isSelected = o.value === value
              const isHighlighted = idx === highlightIdx
              const showHeader = o.group && o.group !== (idx > 0 ? filtered[idx - 1].group : undefined)
              return (
                <React.Fragment key={(o.value || o.label || idx) + ':' + (o.group || '')}>
                {showHeader && (
                  <div style={{ padding: '7px 12px 3px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', background: '#0c1322' }}>
                    {o.group}
                  </div>
                )}
                <div
                  data-option
                  onClick={() => !o.disabled && select(o.value)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: `8px 12px 8px ${(o.group ? 22 : 12) + (o.level ? o.level * 16 : 0)}px`,
                    cursor: o.disabled ? 'default' : 'pointer',
                    background: isHighlighted && !o.disabled
                      ? 'rgba(0, 120, 212, 0.1)'
                      : isSelected
                        ? 'rgba(0, 120, 212, 0.06)'
                        : 'transparent',
                    color: o.disabled ? '#5b6472' : (isSelected ? '#e2e8f0' : '#94a3b8'),
                    opacity: o.disabled ? 0.75 : 1,
                    fontSize: 13,
                    transition: 'background 0.1s',
                    borderLeft: isSelected ? '2px solid #0078d4' : '2px solid transparent',
                  }}
                >
                  {o.icon && (
                    <img
                      src={o.icon}
                      alt=""
                      style={{ width: 16, height: 16, flexShrink: 0, opacity: isSelected ? 1 : 0.6 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontWeight: isSelected ? 600 : 400,
                      }}
                    >
                      {o.label}
                    </div>
                    {o.description && (
                      <div
                        style={{
                          fontSize: 11,
                          color: '#475569',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginTop: 1,
                        }}
                      >
                        {o.description}
                      </div>
                    )}
                  </div>
                  {o.count != null && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: '#475569',
                        background: '#1e293b',
                        padding: '1px 6px',
                        borderRadius: 8,
                        flexShrink: 0,
                      }}
                    >
                      {o.count}
                    </span>
                  )}
                  {isSelected && <Check size={14} style={{ color: '#0078d4', flexShrink: 0 }} />}
                </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
