/**
 * Subscription Governance — subscriptions that need attention.
 *
 * Surfaces three conditions the estate view otherwise hides: subscriptions with
 * no management-group assignment (outside policy inheritance), subscriptions
 * with no spend (candidates for cleanup), and subscriptions that are disabled
 * yet still billing.
 */
import React, { useState, useEffect } from 'react'
import { RefreshCw, AlertCircle, ShieldAlert, Ban, CircleSlash } from 'lucide-react'
import { fmtUsd } from './finopsApi'

const card = {
  background: 'var(--c-0f172a, #0f172a)',
  border: '1px solid var(--c-1e293b, #1e293b)',
  borderRadius: 10,
  padding: 16,
}

function Group({ title, icon: Icon, color, items, empty, why, showCost = true, showMg = false, unknown = false }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Icon size={15} style={{ color }} />
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--c-f1f5f9, #f1f5f9)' }}>{title}</h3>
        <span style={{ marginLeft: 'auto', fontSize: unknown ? 13 : 18, fontWeight: 700, color: unknown ? 'var(--c-64748b, #64748b)' : color }}>
          {unknown ? 'Not determinable' : items.length}
        </span>
      </div>
      {why && (
        <div style={{ fontSize: 11, color: 'var(--c-64748b, #64748b)', marginBottom: 12, lineHeight: 1.5, maxWidth: 780 }}>
          {why}
        </div>
      )}
      {unknown ? (
        <div style={{ fontSize: 12, color: 'var(--c-64748b, #64748b)' }}>
          The management-group hierarchy could not be read, so assignment cannot be determined.
          No count is shown rather than reporting a misleading zero.
        </div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--c-64748b, #64748b)' }}>{empty}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Subscription', ...(showMg ? ['Management group'] : []), 'State', ...(showCost ? ['Cost (30d)'] : [])].map((h, i, arr) => (
                <th key={h} style={{
                  textAlign: i === arr.length - 1 && showCost ? 'right' : 'left',
                  padding: '4px 8px', fontSize: 10, fontWeight: 600, letterSpacing: 0.4,
                  textTransform: 'uppercase', color: 'var(--c-475569, #475569)',
                  borderBottom: '1px solid var(--c-1e293b, #1e293b)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((s, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--c-1e293b, #1e293b)' }}>
                <td style={{ padding: '7px 8px', color: 'var(--c-e2e8f0, #e2e8f0)', fontWeight: 600 }}>
                  {s.name}
                  <div style={{ fontSize: 10, color: 'var(--c-475569, #475569)', fontWeight: 400, marginTop: 2 }}>
                    {s.subscription_id}
                  </div>
                </td>
                {showMg && (
                  <td style={{ padding: '7px 8px', color: 'var(--c-94a3b8, #94a3b8)' }}>
                    {s.management_group || '—'}
                  </td>
                )}
                <td style={{ padding: '7px 8px', color: 'var(--c-94a3b8, #94a3b8)' }}>{s.state}</td>
                {showCost && (
                  <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--c-e2e8f0, #e2e8f0)' }}>
                    {fmtUsd(s.cost_usd)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function SubscriptionGovernance() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/finops/mgmt/subscription-governance')
      if (!r.ok) throw new Error(`API error ${r.status}`)
      setData(await r.json())
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, gap: 10 }}>
      <RefreshCw size={18} className="animate-spin" style={{ color: '#3b82f6' }} />
      <span style={{ color: 'var(--c-94a3b8, #94a3b8)' }}>Loading subscription governance…</span>
    </div>
  )
  if (error) return (
    <div style={{ background: '#1a0e0e', border: '1px solid #7f1d1d', borderRadius: 10, padding: 16, color: '#fca5a5', display: 'flex', gap: 8, fontSize: 12 }}>
      <AlertCircle size={16} /><span>{error}</span>
    </div>
  )
  if (!data) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ color: 'var(--c-f1f5f9, #f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Subscription Governance</h2>
        <div style={{ fontSize: 12, color: 'var(--c-64748b, #64748b)', marginTop: 3 }}>
          {data.total_subscriptions} subscriptions reviewed
        </div>
      </div>

      {!data.mg_hierarchy_available && (
        <div style={{ background: '#1a1508', border: '1px solid #78350f', borderRadius: 10, padding: 12, display: 'flex', gap: 8, fontSize: 12, color: '#fde68a' }}>
          <AlertCircle size={15} style={{ color: '#fbbf24', flexShrink: 0 }} />
          <span>
            The management-group hierarchy could not be read, so unassigned subscriptions cannot be
            determined. Grant the identity <strong>Management Group Reader</strong> at the tenant root.
          </span>
        </div>
      )}

      <Group title="Not in a landing-zone management group" icon={ShieldAlert} color="#f59e0b"
        items={data.unassigned || []}
        showMg
        why="These subscriptions sit directly under the tenant root instead of a purpose-built management group. Azure Policy, RBAC and budgets are normally applied at the management-group level, so anything parked at the root inherits no guardrails. Move them under a landing zone (Platform, Corp, Sandbox, etc.) to bring them under governance."
        unknown={data.unassigned_count === null || data.unassigned_count === undefined}
        empty="Every subscription sits inside a purpose-built management group." />

      <Group title="Zero-spend subscriptions" icon={CircleSlash} color="#3b82f6"
        items={data.zero_spend || []}
        why="No cost recorded in the last 30 days. These are usually leftovers from a decommissioned project or a trial that was never cancelled. Each one still carries RBAC assignments and policy scope, so confirm it is genuinely dormant and then cancel it to reduce the attack surface and audit noise."
        empty="No zero-spend subscriptions." />

      <Group title="Disabled but still billing" icon={Ban} color="#ef4444"
        items={data.disabled_with_cost || []}
        why="The subscription is disabled yet still accruing charges — normally retained storage, reserved capacity or a support plan that survives deactivation. This is money spent on something nobody can use; raise a billing case to stop the charge."
        empty="No disabled subscriptions are incurring cost." />
    </div>
  )
}
