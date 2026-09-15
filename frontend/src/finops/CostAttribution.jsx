/**
 * Cost change attribution.
 *
 * Every other view answers "what does it cost". This answers "why did it change":
 * the movement between two equal windows split into resources that appeared, grew,
 * shrank or went away. The four buckets sum exactly to the total delta, so the
 * waterfall always lands on the current total — the component says so on screen
 * rather than asking the reader to take it on trust.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertCircle, TrendingUp, TrendingDown, PlusCircle, MinusCircle, CheckCircle2 } from 'lucide-react'
import { fmtUsd } from './finopsApi'

const WINDOWS = [{ d: 7, l: '7d' }, { d: 30, l: '30d' }, { d: 60, l: '60d' }, { d: 90, l: '90d' }]
const sub = 'var(--c-94a3b8, #94a3b8)'
const dim = 'var(--c-64748b, #64748b)'
const ink = 'var(--c-e2e8f0, #e2e8f0)'
const line = '1px solid var(--c-1e293b, #1e293b)'
const BUCKET = {
  new: { color: '#8b5cf6', Icon: PlusCircle },
  increased: { color: '#ef4444', Icon: TrendingUp },
  decreased: { color: '#22c55e', Icon: TrendingDown },
  retired: { color: '#0ea5e9', Icon: MinusCircle },
}
const ctl = {
  background: 'var(--c-0f172a, #0f172a)', color: ink,
  border: '1px solid var(--c-334155, #334155)', borderRadius: 6, padding: '5px 9px', fontSize: 12,
}

export default function CostAttribution() {
  const [days, setDays] = useState(30)
  const [dimension, setDimension] = useState('resource')
  const [open, setOpen] = useState('increased')
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/finops/studio/cost-attribution?days=${days}&dimension=${encodeURIComponent(dimension)}`)
      .then(r => r.json()).then(x => { setD(x); setError(null) })
      .catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [days, dimension])
  useEffect(load, [load])

  const up = (d?.delta_usd ?? 0) > 0

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 2, background: 'var(--c-0f172a, #0f172a)', border: '1px solid var(--c-334155, #334155)', borderRadius: 6, padding: 2 }}>
          {WINDOWS.map(w => (
            <button key={w.d} onClick={() => setDays(w.d)}
              style={{ background: days === w.d ? '#0078d4' : 'transparent', color: days === w.d ? '#fff' : sub,
                       border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer' }}>{w.l}</button>
          ))}
        </div>
        <span style={{ fontSize: 11.5, color: sub }}>Attribute by</span>
        <select value={dimension} onChange={e => setDimension(e.target.value)} style={ctl}>
          {(d?.dimensions || [{ key: 'resource', label: 'Resource' }]).map(x =>
            <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <button onClick={load} style={{ ...ctl, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: sub }}>
          <RefreshCw size={11} /> Refresh
        </button>
        {d?.available && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: dim }}>
            {d.current_from} → {d.current_to} vs {d.previous_from} → {d.previous_to}
          </span>
        )}
      </div>

      {loading && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 20, color: sub, fontSize: 12 }}>
          <RefreshCw size={14} className="animate-spin" style={{ color: '#3b82f6' }} /> Attributing cost change…
        </div>
      )}
      {error && <div style={{ color: 'var(--c-fca5a5, #fca5a5)', fontSize: 12, padding: 12, display: 'flex', gap: 6 }}><AlertCircle size={14} />{error}</div>}
      {!loading && !error && d && !d.available && (
        <div style={{ fontSize: 12, color: dim, padding: 14 }}>{d.reason}</div>
      )}

      {!loading && d?.available && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Big label="Previous window" value={fmtUsd(d.previous_total_usd)} sub={`${d.previous_from} → ${d.previous_to}`} />
            <Big label="Current window" value={fmtUsd(d.current_total_usd)} sub={`${d.current_from} → ${d.current_to}`} />
            <Big label="Change" value={`${up ? '+' : ''}${fmtUsd(d.delta_usd)}`}
                 sub={d.delta_pct === null ? 'no prior spend' : `${up ? '+' : ''}${d.delta_pct}% period over period`}
                 color={up ? '#f87171' : '#4ade80'} />
            <Big label="Flat" value={String(d.unchanged_count)}
                 sub={`${d.dimension_label.toLowerCase()}s within a cent`} />
          </div>

          <Waterfall steps={d.waterfall} />

          {d.reconciles ? (
            <div style={{ fontSize: 11, color: '#4ade80', display: 'flex', gap: 5, alignItems: 'center', margin: '8px 0 16px' }}>
              <CheckCircle2 size={12} /> Buckets reconcile exactly to the {fmtUsd(d.delta_usd)} change —
              previous + new + increased + decreased + retired = current.
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#fbbf24', display: 'flex', gap: 5, alignItems: 'center', margin: '8px 0 16px' }}>
              <AlertCircle size={12} /> Buckets do not reconcile to the total change; treat the split as indicative.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {d.buckets.map(b => {
              const { color, Icon } = BUCKET[b.key]
              const on = open === b.key
              return (
                <button key={b.key} onClick={() => setOpen(on ? null : b.key)} title={b.description}
                  style={{ flex: '1 1 170px', minWidth: 160, textAlign: 'left', cursor: 'pointer',
                           background: on ? `${color}1f` : 'var(--c-0f172a, #0f172a)',
                           border: `1px solid ${on ? color : 'var(--c-1e293b, #1e293b)'}`,
                           borderRadius: 8, padding: '9px 11px' }}>
                  <div style={{ fontSize: 10, color: sub, display: 'flex', alignItems: 'center', gap: 5, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    <Icon size={11} style={{ color }} />{b.label}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                    {b.delta_usd > 0 ? '+' : ''}{fmtUsd(b.delta_usd)}
                  </div>
                  <div style={{ fontSize: 10, color: dim, marginTop: 1 }}>
                    {b.count} {d.dimension_label.toLowerCase()}{b.count === 1 ? '' : 's'}
                  </div>
                </button>
              )
            })}
          </div>

          {open && <Items b={d.buckets.find(x => x.key === open)} label={d.dimension_label} dimension={d.dimension} />}

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-f1f5f9, #f1f5f9)', marginBottom: 6 }}>
              Biggest movers, either direction
            </div>
            <Table rows={d.top_movers} label={d.dimension_label} dimension={d.dimension} />
          </div>

          <div style={{ fontSize: 10.5, color: dim, marginTop: 10 }}>
            Actuals from the cost warehouse for both windows — no forecasting or modelling.
            &ldquo;Retired&rdquo; means the {d.dimension_label.toLowerCase()} carried cost in the previous
            window and none in this one; it does not by itself prove the resource was deleted.
          </div>
        </>
      )}
    </div>
  )
}

function Waterfall({ steps }) {
  const max = Math.max(...steps.map(s => s.kind === 'total' ? s.value : s.end), 1)
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 190,
                  borderBottom: line, padding: '0 2px' }}>
      {steps.map((s, i) => {
        const isTotal = s.kind === 'total'
        const h = isTotal ? (s.value / max) * 150 : Math.max(2, (s.span / max) * 150)
        const bottom = isTotal ? 0 : (s.base / max) * 150
        const colour = isTotal ? '#334155' : s.value > 0 ? '#ef4444' : '#22c55e'
        return (
          <div key={`${s.label}-${i}`} style={{ flex: 1, minWidth: 40, height: '100%', position: 'relative',
                                                display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <div style={{ position: 'absolute', bottom: bottom + h + 3, left: 0, right: 0, textAlign: 'center',
                          fontSize: 9.5, color: isTotal ? ink : colour, fontVariantNumeric: 'tabular-nums' }}>
              {isTotal ? fmtUsd(s.value, 0) : `${s.value > 0 ? '+' : ''}${fmtUsd(s.value, 0)}`}
            </div>
            <div style={{ position: 'absolute', bottom, height: h, left: 4, right: 4,
                          background: colour, borderRadius: 3, opacity: isTotal ? 1 : 0.85 }} />
            <div style={{ position: 'absolute', bottom: -18, left: 0, right: 0, textAlign: 'center',
                          fontSize: 9, color: dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Items({ b, label, dimension }) {
  if (!b) return null
  return (
    <div>
      <div style={{ fontSize: 11.5, color: sub, marginBottom: 5 }}>
        {b.label} — {b.description.toLowerCase()}
        {b.truncated && <span style={{ color: dim }}> · showing the top {b.items.length} of {b.count} by size</span>}
      </div>
      <Table rows={b.items} label={label} dimension={dimension} />
    </div>
  )
}

function Table({ rows, label, dimension }) {
  if (!rows?.length) return <div style={{ fontSize: 12, color: dim, padding: 10 }}>Nothing in this bucket.</div>
  const showCtx = dimension === 'resource'
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
      <thead>
        <tr style={{ color: sub, textAlign: 'left' }}>
          <th style={{ padding: '4px 6px' }}>{label}</th>
          {showCtx && <th style={{ padding: '4px 6px' }}>Resource group</th>}
          {showCtx && <th style={{ padding: '4px 6px' }}>Service</th>}
          <th style={{ padding: '4px 6px', textAlign: 'right' }}>Previous</th>
          <th style={{ padding: '4px 6px', textAlign: 'right' }}>Current</th>
          <th style={{ padding: '4px 6px', textAlign: 'right' }}>Change</th>
          <th style={{ padding: '4px 6px', textAlign: 'right' }}>%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.label}-${i}`} style={{ borderTop: line }}>
            <td style={{ padding: '4px 6px', color: ink }}>{r.label || '(unnamed)'}</td>
            {showCtx && <td style={{ padding: '4px 6px', color: sub }}>{r.resource_group || '—'}</td>}
            {showCtx && <td style={{ padding: '4px 6px', color: dim }}>{r.service_name || '—'}</td>}
            <td style={{ padding: '4px 6px', textAlign: 'right', color: sub, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(r.prev_usd)}</td>
            <td style={{ padding: '4px 6px', textAlign: 'right', color: ink, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(r.cur_usd)}</td>
            <td style={{ padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                         color: r.delta_usd > 0 ? '#f87171' : '#4ade80' }}>
              {r.delta_usd > 0 ? '+' : ''}{fmtUsd(r.delta_usd)}
            </td>
            <td style={{ padding: '4px 6px', textAlign: 'right', color: dim, fontVariantNumeric: 'tabular-nums' }}>
              {r.delta_pct === null ? 'new' : `${r.delta_pct > 0 ? '+' : ''}${r.delta_pct}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Big({ label, value, sub: s, color }) {
  return (
    <div style={{ flex: '1 1 170px', minWidth: 160, background: 'var(--c-0f172a, #0f172a)',
                  border: line, borderRadius: 8, padding: '9px 11px' }}>
      <div style={{ fontSize: 9.5, color: dim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: color || 'var(--c-f1f5f9, #f1f5f9)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 10, color: dim, marginTop: 1 }}>{s}</div>
    </div>
  )
}
