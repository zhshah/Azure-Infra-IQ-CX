/**
 * Tag Analytics — Tag coverage + cost by tag value
 * Coverage from Azure Resource Graph KQL, cost from Azure Cost Management
 */
import React, { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { RefreshCw, AlertCircle, AlertTriangle, Tags } from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct, CHART_COLORS } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'
import DateRangePicker from './DateRangePicker'

function CoverageGauge({ pct }) {
  const color = pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444'
  const circumference = 2 * Math.PI * 54
  return (
    <div style={{ position: 'relative', width: 128, height: 128, margin: '0 auto' }}>
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r="54" fill="none" style={{ stroke: 'var(--c-1e293b)' }} strokeWidth="10" />
        <circle cx="64" cy="64" r="54" fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${circumference * pct / 100} ${circumference}`}
          strokeLinecap="round" transform="rotate(-90 64 64)"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color, fontSize: 24, fontWeight: 800 }}>{Math.round(pct)}%</div>
        <div style={{ color: 'var(--c-64748b)', fontSize: 10 }}>Coverage</div>
      </div>
    </div>
  )
}

export default function TagAnalytics() {
  const [data,       setData]       = useState(null)
  const [matrix,     setMatrix]     = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [timeRange,  setTimeRange]  = useState('mtd')
  const [dateFrom,   setDateFrom]   = useState('')
  const [dateTo,     setDateTo]     = useState('')
  const [activeTag,  setActiveTag]  = useState(null)
  const [matLoading, setMatLoading] = useState(false)
  const [matError,   setMatError]   = useState(null)
  const [allTags,    setAllTags]    = useState(null)
  const [required,   setRequired]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('finops:requiredTags') || 'null') } catch { return null }
  })
  const [pickerOpen, setPickerOpen] = useState(false)

  const load = async () => {
    setLoading(true); setError(null); setMatrix(null); setActiveTag(null)
    try {
      setData(await finopsApi.getTagAnalytics(
        timeRange, dateFrom || undefined, dateTo || undefined, undefined, required))
    }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [timeRange, dateFrom, dateTo, required])

  // Discover every tag key in the estate so the user can choose the compliance set.
  useEffect(() => {
    let cancelled = false
    finopsApi.getTagKeys()
      .then(r => { if (!cancelled) setAllTags(r) })
      .catch(() => { if (!cancelled) setAllTags({ available: false, tag_keys: [] }) })
    return () => { cancelled = true }
  }, [])

  const toggleTag = (key) => {
    const base = required || (allTags?.default_required_tags ?? [])
    const has = base.some(t => t.toLowerCase() === key.toLowerCase())
    const next = has ? base.filter(t => t.toLowerCase() !== key.toLowerCase()) : [...base, key]
    setRequired(next)
    try { localStorage.setItem('finops:requiredTags', JSON.stringify(next)) } catch { /* ignore */ }
  }

  const resetTags = () => {
    setRequired(null)
    try { localStorage.removeItem('finops:requiredTags') } catch { /* ignore */ }
  }

  const activeRequired = required || data?.required_tags || []

  const loadMatrix = async (tagKey) => {
    setActiveTag(tagKey); setMatLoading(true); setMatrix(null); setMatError(null)
    try { setMatrix(await finopsApi.getTagCostMatrix(tagKey, timeRange)) }
    catch (e) { setMatError(e.message || 'Failed to load cost matrix') }
    finally { setMatLoading(false) }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 10 }}>
      <RefreshCw size={18} className="animate-spin" style={{ color: '#3b82f6' }} /><span style={{ color: 'var(--c-94a3b8)' }}>Loading tag analytics…</span>
    </div>
  )
  if (error) return (
    <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 10, padding: 16, color: 'var(--c-fca5a5)', display: 'flex', gap: 8 }}>
      <AlertCircle size={16} /><span style={{ fontSize: 12 }}>{error}</span>
    </div>
  )
  if (!data) return null

  const tagStats = data.tag_stats?.length ? data.tag_stats : (data.tag_keys || [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <FinOpsExportMenu view="tag-analytics" focusDays={30} onXlsx={() => finopsApi.downloadReport()} report={{ title: 'Tag Cost Analytics', kpis: [{ label: 'Compliance', value: fmtPct(data.compliance_score_pct) }, { label: 'Resources', value: String(data.total_resources ?? 0) }, { label: 'Untagged Spend', value: fmtUsd(data.untagged_spend_usd) }], tables: [{ title: 'Tag Coverage', columns: ['Tag Key', 'Coverage %', 'Resources'], rows: (data.tag_stats || []).slice(0, 30).map(t => [t.key || t.tag_key || '-', fmtPct(t.coverage ?? t.coverage_pct), String(t.resources ?? t.resource_count ?? '')]) }] }} />
      </div>
      <FinOpsAIPanel view="tag-analytics" data={{ compliance_score_pct: data.compliance_score_pct, total_resources: data.total_resources, fully_compliant: data.fully_compliant, non_compliant: data.non_compliant, untagged_spend_usd: data.untagged_spend_usd, required_tags: data.required_tags, tag_stats: (data.tag_stats || []).slice(0, 10) }} />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Tag Cost Analytics</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>Coverage from Azure Resource Graph · Cost from Azure Cost Management</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <DateRangePicker
            value={timeRange} onChange={v => { setTimeRange(v); if (v !== 'custom') { setDateFrom(''); setDateTo('') } }}
            dateFrom={dateFrom} dateTo={dateTo}
            onDateFromChange={setDateFrom} onDateToChange={setDateTo}
          />
          <button onClick={() => setPickerOpen(o => !o)} style={{
            background: pickerOpen ? 'var(--c-334155)' : 'var(--c-1e293b)', border: '1px solid var(--c-334155)',
            borderRadius: 6, padding: '5px 10px', cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 11,
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Tags size={12} /> Required tags ({activeRequired.length})
          </button>
          <button onClick={load} style={{
            background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6,
            padding: '5px 10px', cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 11,
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Required-tag picker — compliance is measured against whatever is ticked here */}
      {pickerOpen && (
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ color: 'var(--c-f1f5f9)', fontSize: 13, fontWeight: 700 }}>Choose the tags that define compliance</div>
              <div style={{ color: 'var(--c-64748b)', fontSize: 11, marginTop: 2 }}>
                {allTags?.available
                  ? `${allTags.tag_keys.length} tag keys found across ${allTags.total_resources} resources · ${allTags.untagged_resource_count} resources carry no tags at all`
                  : 'Discovering tags from the latest scan…'}
              </div>
            </div>
            <button onClick={resetTags} style={{
              background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6,
              padding: '4px 10px', cursor: 'pointer', color: 'var(--c-94a3b8)', fontSize: 11,
            }}>Reset to default</button>
          </div>
          {allTags?.available ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
              {allTags.tag_keys.map(t => {
                const on = activeRequired.some(r => r.toLowerCase() === t.tag_key.toLowerCase())
                return (
                  <label key={t.tag_key} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer',
                    background: on ? 'rgba(59,130,246,0.10)' : 'transparent',
                    border: `1px solid ${on ? '#3b82f6' : 'var(--c-1e293b)'}`, borderRadius: 6,
                  }}>
                    <input type="checkbox" checked={on} onChange={() => toggleTag(t.tag_key)} />
                    <span style={{ color: 'var(--c-e2e8f0)', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.tag_key}
                    </span>
                    <span style={{ fontSize: 10, color: t.coverage_pct >= 80 ? '#22c55e' : t.coverage_pct >= 40 ? '#f59e0b' : '#ef4444' }}>
                      {t.coverage_pct}%
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--c-64748b)' }}>{t.covered_resources}</span>
                  </label>
                )
              })}
            </div>
          ) : (
            <div style={{ color: 'var(--c-64748b)', fontSize: 12 }}>
              No tags discovered yet — run a resource scan first.
            </div>
          )}
        </div>
      )}

      {/* Compliance gauge + KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <CoverageGauge pct={data.compliance_score_pct ?? 0} />
          <div style={{ color: 'var(--c-64748b)', fontSize: 11, textAlign: 'center' }}>
            Overall tag compliance for {data.required_tags?.length || 0} required tags
          </div>
          {/* A 0% score is almost always "this tag exists nowhere", not a bug. Say so. */}
          {data.missing_required_tags?.length > 0 && (
            <div style={{
              fontSize: 10.5, lineHeight: 1.45, textAlign: 'center', borderRadius: 6, padding: '6px 8px',
              background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.45)', color: '#fbbf24',
            }}>
              {data.missing_required_tags.length} of {data.required_tags?.length || 0} required tags are on
              <strong> no resource at all</strong>: {data.missing_required_tags.join(', ')}.
              Compliance counts only resources carrying <em>every</em> required tag, so it stays 0% until these
              are applied — or until you deselect them above.
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, alignContent: 'start' }}>
          {[
            { label: 'Total Resources', value: data.total_resources ?? 0, color: 'var(--c-94a3b8)' },
            { label: 'Compliant', value: data.compliant_resources ?? data.fully_compliant ?? 0, color: '#4ade80' },
            { label: 'Non-Compliant', value: data.non_compliant_resources ?? data.non_compliant ?? 0, color: '#f87171' },
            { label: 'Untagged Spend', value: fmtUsd(data.untagged_spend_usd ?? data.untagged_cost_usd ?? 0), color: '#f59e0b' },
          ].map(c => (
            <div key={c.label} style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>{c.label}</div>
              <div style={{ color: c.color, fontSize: 18, fontWeight: 700 }}>{c.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tag coverage table + drill-down */}
      <div style={{ display: 'grid', gridTemplateColumns: matrix ? '1fr 1fr' : '1fr', gap: 16 }}>
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Tag Coverage — click a tag to see cost breakdown</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>{['Tag Key', 'Coverage %', 'Resources', 'Compliant', 'Required'].map(h => (
                <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {tagStats.map((ts, i) => {
                const color = ts.coverage_pct >= 80 ? '#4ade80' : ts.coverage_pct >= 60 ? '#f59e0b' : '#f87171'
                return (
                  <tr
                    key={i}
                    onClick={() => loadMatrix(ts.tag_key)}
                    style={{ borderBottom: '1px solid var(--c-0f172a)', cursor: 'pointer', background: activeTag === ts.tag_key ? 'var(--c-1e293b)' : 'transparent' }}
                    onMouseEnter={e => { if (activeTag !== ts.tag_key) e.currentTarget.style.background = 'var(--c-111827)' }}
                    onMouseLeave={e => { if (activeTag !== ts.tag_key) e.currentTarget.style.background = 'transparent' }}
                  >
                    <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)', fontWeight: 600 }}>{ts.tag_key}</td>
                    <td style={{ padding: '6px 8px', color }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ height: 4, width: `${ts.coverage_pct}%`, background: color, borderRadius: 2, maxWidth: 60 }} />
                        {fmtPct(ts.coverage_pct)}
                      </div>
                    </td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-64748b)' }}>{ts.resource_count ?? ts.total_resources ?? '—'}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-4ade80)' }}>{ts.tagged_count ?? ts.covered_resources ?? '—'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {ts.is_required
                        ? <span style={{ color: '#f59e0b', fontSize: 10 }}>Required</span>
                        : <span style={{ color: 'var(--c-334155)', fontSize: 10 }}>Optional</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Cost matrix drill-down */}
        {(activeTag || matLoading) && (
          <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
            <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
              Cost by <span style={{ color: '#3b82f6' }}>{activeTag}</span> tag values
            </div>
            {matLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 20, color: 'var(--c-64748b)', fontSize: 12 }}>
                <RefreshCw size={14} className="animate-spin" style={{ color: '#3b82f6' }} />Loading cost breakdown…
              </div>
            )}
            {matError && !matLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, color: 'var(--c-fca5a5)', fontSize: 12, background: '#1a0e0e', borderRadius: 6 }}>
                <AlertTriangle size={14} />{matError}
              </div>
            )}
            {matrix && !matError && (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={matrix.values?.slice(0, 12) || []} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#475569', fontSize: 10 }} tickFormatter={v => '$' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} />
                    <YAxis type="category" dataKey="tag_value" tick={{ fill: '#94a3b8', fontSize: 10 }} width={120} />
                    <Tooltip formatter={v => fmtUsd(v, 2)} contentStyle={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 11 }} />
                    <Bar dataKey="cost_usd" name="Cost (USD)" radius={[0, 4, 4, 0]}>
                      {(matrix.values || []).slice(0, 12).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ marginTop: 12, fontSize: 11, color: 'var(--c-475569)' }}>
                  Total tracked: <span style={{ color: '#3b82f6' }}>{fmtUsd(matrix.total_cost_usd, 2)}</span> · {matrix.value_count} values
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
