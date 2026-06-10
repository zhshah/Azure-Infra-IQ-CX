/**
 * SearchableMultiSelect — Azure Portal-style multi-select dropdown with search, checkboxes, counts.
 *
 * Features:
 * - Search input inside dropdown with type-ahead filtering
 * - Checkboxes per option, "Select All" / "Clear All" actions
 * - Optional resource count / badge per option
 * - Keyboard navigation (↑ ↓ Space Enter Esc)
 * - Close on click-outside or Esc
 * - Selected count badge on trigger
 * - Consistent enterprise dark theme
 *
 * Props:
 *   label            — optional label above the trigger
 *   options          — [{ value, label, count?, description? }] or ['string']
 *   selected         — array of selected values
 *   onChange          — (selected: string[]) => void
 *   placeholder       — placeholder text when nothing selected
 *   searchPlaceholder — placeholder for the search input
 *   maxHeight         — max dropdown height (default 280)
 *   disabled          — disable the control
 *   width             — optional fixed width
 *   compact           — smaller padding for inline usage
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { ChevronDown, Search, X, Check } from 'lucide-react'

export default function SearchableMultiSelect({
  label,
  options = [],
  selected = [],
  onChange,
  placeholder = 'All',
  searchPlaceholder = 'Search…',
  maxHeight = 280,
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

  // Display text
  const displayText = useMemo(() => {
    if (selected.length === 0) return placeholder
    if (selected.length === 1) {
      return normalized.find(o => o.value === selected[0])?.label || selected[0]
    }
    return `${selected.length} selected`
  }, [selected, normalized, placeholder])

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

  const toggle = useCallback(
    val => {
      onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val])
    },
    [selected, onChange],
  )

  const selectAll = () => {
    onChange(filtered.map(o => o.value))
  }

  const clearAll = e => {
    if (e) e.stopPropagation()
    onChange([])
  }

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
        case ' ':
        case 'Enter':
          e.preventDefault()
          if (filtered[highlightIdx]) {
            toggle(filtered[highlightIdx].value)
          }
          break
        case 'Escape':
          e.preventDefault()
          setOpen(false)
          setSearch('')
          break
      }
    },
    [open, filtered, highlightIdx, toggle],
  )

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
          border: `1px solid ${open ? '#0078d4' : selected.length > 0 ? '#334155' : '#1e293b'}`,
          borderRadius: 7,
          color: selected.length > 0 ? '#e2e8f0' : '#64748b',
          fontSize: 13,
          fontWeight: selected.length > 0 ? 500 : 400,
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
          {displayText}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {selected.length > 0 && (
            <>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#fff',
                  background: '#0078d4',
                  padding: '1px 6px',
                  borderRadius: 8,
                  lineHeight: '16px',
                  minWidth: 18,
                  textAlign: 'center',
                }}
              >
                {selected.length}
              </span>
              {!disabled && (
                <span
                  onClick={clearAll}
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
            </>
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

          {/* Select All / Clear All actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              borderBottom: '1px solid #1e293b',
              fontSize: 11,
            }}
          >
            <button
              onClick={selectAll}
              style={{
                background: 'none',
                border: 'none',
                color: '#0078d4',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                padding: 0,
              }}
            >
              Select all ({filtered.length})
            </button>
            {selected.length > 0 && (
              <button
                onClick={() => onChange([])}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: 0,
                }}
              >
                Clear all
              </button>
            )}
          </div>

          {/* Options list */}
          <div
            ref={listRef}
            style={{
              maxHeight,
              overflowY: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: '#1e293b transparent',
            }}
          >
            {filtered.length === 0 && (
              <div
                style={{ padding: '14px 12px', color: '#475569', fontSize: 12, textAlign: 'center' }}
              >
                No matches found
              </div>
            )}
            {filtered.map((o, idx) => {
              const isChecked = selected.includes(o.value)
              const isHighlighted = idx === highlightIdx
              return (
                <div
                  key={o.value}
                  data-option
                  onClick={() => toggle(o.value)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 12px',
                    cursor: 'pointer',
                    background: isHighlighted ? 'rgba(0, 120, 212, 0.08)' : 'transparent',
                    color: isChecked ? '#e2e8f0' : '#94a3b8',
                    fontSize: 13,
                    transition: 'background 0.1s',
                  }}
                >
                  {/* Checkbox */}
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: `1.5px solid ${isChecked ? '#0078d4' : '#475569'}`,
                      background: isChecked ? '#0078d4' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'all 0.12s',
                    }}
                  >
                    {isChecked && <Check size={11} style={{ color: '#fff' }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontWeight: isChecked ? 500 : 400,
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
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
