/**
 * TagPicker — Azure Portal-style tag filter with live Azure tag keys/values.
 *
 * Features:
 * - Fetches tag keys from /api/tags/keys (with fallback to filterOptions)
 * - On key selection, fetches tag values from /api/tags/values/{key}
 * - Searchable dropdowns for both keys and values
 * - Multi-value selection per key
 * - Dynamic add/remove tag filter rows
 * - Active tag pills
 *
 * Props:
 *   tags            — [{ key: string, values: string[] }]
 *   onChange         — (tags: [{ key, values }]) => void
 *   fallbackTagKeys  — optional fallback tag keys (from cached dashboard data)
 *   compact          — smaller sizing
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, X, Tag, Loader } from 'lucide-react'
import SearchableSelect from './SearchableSelect'
import SearchableMultiSelect from './SearchableMultiSelect'

// Cache for tag keys and values to avoid redundant API calls
const tagCache = {
  keys: null,
  keysTimestamp: 0,
  values: {},       // { [key]: { data: [], timestamp: number } }
  TTL: 5 * 60_000,  // 5 minutes
}

async function fetchTagKeys() {
  const now = Date.now()
  if (tagCache.keys && now - tagCache.keysTimestamp < tagCache.TTL) {
    return tagCache.keys
  }
  try {
    const res = await fetch('/api/tags/keys')
    if (!res.ok) throw new Error('Failed')
    const data = await res.json()
    tagCache.keys = data.tag_keys || []
    tagCache.keysTimestamp = now
    return tagCache.keys
  } catch {
    return tagCache.keys || []
  }
}

async function fetchTagValues(key) {
  if (!key) return []
  const now = Date.now()
  const cached = tagCache.values[key]
  if (cached && now - cached.timestamp < tagCache.TTL) {
    return cached.data
  }
  try {
    const res = await fetch(`/api/tags/values/${encodeURIComponent(key)}`)
    if (!res.ok) throw new Error('Failed')
    const data = await res.json()
    const values = data.values || []
    tagCache.values[key] = { data: values, timestamp: now }
    return values
  } catch {
    return cached?.data || []
  }
}

function TagRow({ tag, index, tagKeys, onUpdate, onRemove }) {
  const [values, setValues] = useState([])
  const [loadingValues, setLoadingValues] = useState(false)

  // Fetch values when key changes
  useEffect(() => {
    if (!tag.key) {
      setValues([])
      return
    }
    let cancelled = false
    setLoadingValues(true)
    fetchTagValues(tag.key).then(v => {
      if (!cancelled) {
        setValues(v)
        setLoadingValues(false)
      }
    })
    return () => { cancelled = true }
  }, [tag.key])

  const keyOptions = useMemo(
    () => tagKeys.map(k => ({ value: k, label: k })),
    [tagKeys],
  )

  const valueOptions = useMemo(
    () => values.map(v => ({ value: v, label: v })),
    [values],
  )

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
        marginBottom: 8,
      }}
    >
      <div style={{ flex: 2, minWidth: 0 }}>
        {index === 0 && (
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
            Tag Key
          </label>
        )}
        <SearchableSelect
          value={tag.key}
          onChange={key => onUpdate(index, { key, values: [] })}
          options={keyOptions}
          placeholder="Select tag key…"
          searchPlaceholder="Search tag keys…"
          compact
        />
      </div>
      <span
        style={{
          color: '#475569',
          fontSize: 14,
          fontWeight: 600,
          paddingBottom: 8,
          flexShrink: 0,
        }}
      >
        =
      </span>
      <div style={{ flex: 3, minWidth: 0, position: 'relative' }}>
        {index === 0 && (
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
            Tag Values
          </label>
        )}
        {loadingValues ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 10px',
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: 7,
              fontSize: 12,
              color: '#475569',
            }}
          >
            <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
            Loading values…
          </div>
        ) : (
          <SearchableMultiSelect
            options={valueOptions}
            selected={tag.values || []}
            onChange={vals => onUpdate(index, { ...tag, values: vals })}
            placeholder={tag.key ? 'Select values…' : 'Select key first'}
            searchPlaceholder="Search tag values…"
            disabled={!tag.key}
            compact
          />
        )}
      </div>
      <button
        onClick={() => onRemove(index)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          marginBottom: 2,
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 6,
          color: '#475569',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'
          e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)'
          e.currentTarget.style.color = '#ef4444'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.borderColor = 'transparent'
          e.currentTarget.style.color = '#475569'
        }}
        title="Remove tag filter"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export default function TagPicker({
  tags = [],
  onChange,
  fallbackTagKeys = [],
  compact = false,
}) {
  const [tagKeys, setTagKeys] = useState(fallbackTagKeys)
  const [loading, setLoading] = useState(false)

  // Fetch live tag keys on mount
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchTagKeys().then(keys => {
      if (!cancelled) {
        // Merge with fallback, keeping unique
        const merged = [...new Set([...keys, ...fallbackTagKeys])].sort()
        setTagKeys(merged)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [fallbackTagKeys.join(',')])

  const addRow = () => {
    onChange([...tags, { key: '', values: [] }])
  }

  const removeRow = index => {
    onChange(tags.filter((_, i) => i !== index))
  }

  const updateRow = (index, updated) => {
    onChange(tags.map((t, i) => (i === index ? updated : t)))
  }

  // Active tag pills for non-empty filters
  const activeTags = tags.filter(t => t.key && (t.values || []).length > 0)

  return (
    <div>
      {/* Header with add button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: tags.length > 0 ? 10 : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tag size={13} style={{ color: '#a855f7' }} />
          <span
            style={{
              color: '#64748b',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Tag Filters
          </span>
          {loading && (
            <Loader
              size={10}
              style={{ color: '#475569', animation: 'spin 1s linear infinite' }}
            />
          )}
        </div>
        <button
          onClick={addRow}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            background: 'transparent',
            border: '1px solid #334155',
            borderRadius: 6,
            color: '#0078d4',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(0, 120, 212, 0.08)'
            e.currentTarget.style.borderColor = '#0078d4'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.borderColor = '#334155'
          }}
        >
          <Plus size={11} /> Add Tag
        </button>
      </div>

      {/* Tag rows */}
      {tags.map((tag, i) => (
        <TagRow
          key={i}
          tag={tag}
          index={i}
          tagKeys={tagKeys}
          onUpdate={updateRow}
          onRemove={removeRow}
        />
      ))}

      {/* No tags message */}
      {tags.length === 0 && (
        <div style={{ color: '#475569', fontSize: 12, fontStyle: 'italic', paddingTop: 4 }}>
          No tag filters active — click "Add Tag" to filter by Azure resource tags
        </div>
      )}

      {/* Active tag pills */}
      {activeTags.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid #1e293b',
          }}
        >
          {activeTags.map((t, i) =>
            (t.values || []).map(v => (
              <span
                key={`${t.key}-${v}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 500,
                  background: 'rgba(168, 85, 247, 0.1)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  color: '#c084fc',
                }}
              >
                {t.key}={v}
                <button
                  onClick={() => {
                    const newValues = t.values.filter(x => x !== v)
                    if (newValues.length === 0) {
                      removeRow(tags.findIndex(tag => tag.key === t.key))
                    } else {
                      updateRow(
                        tags.findIndex(tag => tag.key === t.key),
                        { ...t, values: newValues },
                      )
                    }
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#a855f7',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={10} />
                </button>
              </span>
            )),
          )}
        </div>
      )}
    </div>
  )
}
