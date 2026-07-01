/**
 * Budget Manager — Create, view and manage Azure budgets
 * Azure native budgets are synced from CostManagementClient.budgets
 * Custom budgets stored in SQLite with live variance computation
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Plus, RefreshCw, Trash2, Edit2, AlertCircle, CheckCircle, X } from 'lucide-react'
import { finopsApi, fmtUsd, fmtPct, budgetStatusColor } from './finopsApi'
import FinOpsAIPanel from './FinOpsAIPanel'
import FinOpsExportMenu from './FinOpsExportMenu'
import SearchableSelect from '../components/shared/SearchableSelect'

function StatusBadge({ status }) {
  const colors = {
    ok:       { bg: 'var(--c-052e16)', border: 'var(--c-166534)', text: '#4ade80' },
    at_risk:  { bg: 'var(--c-1c1003)', border: '#854d0e', text: '#fbbf24' },
    exceeded: { bg: '#1a0e0e', border: 'var(--c-7f1d1d)', text: '#f87171' },
  }
  const c = colors[status] || colors.ok
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    }}>
      {status === 'exceeded' ? 'Exceeded' : status === 'at_risk' ? 'At Risk' : 'OK'}
    </span>
  )
}

function BudgetProgress({ budget, variance }) {
  const pct   = variance?.utilization_pct ?? 0
  const color = budgetStatusColor(variance?.status || 'ok')
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
        <span style={{ color: 'var(--c-94a3b8)' }}>
          {fmtUsd(variance?.actual_cost_usd ?? 0, 2)} of {fmtUsd(budget.amount_usd)}
        </span>
        <span style={{ color, fontWeight: 700 }}>{fmtPct(pct)}</span>
      </div>
      <div style={{ height: 6, background: 'var(--c-1e293b)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 4, transition: 'width 0.5s' }} />
      </div>
      {pct > 100 && (
        <div style={{ color: 'var(--c-f87171)', fontSize: 10, marginTop: 3 }}>
          Overspent by {fmtUsd(Math.abs(variance?.variance_usd ?? 0), 2)}
        </div>
      )}
    </div>
  )
}

function CreateBudgetModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', amount_usd: '', period: 'Monthly', scope_type: 'all',
    alert_thresholds: '50,75,90,100', owner_email: '', cost_center: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.name || !form.amount_usd) { setErr('Name and amount are required'); return }
    setSaving(true); setErr(null)
    try {
      const b = await finopsApi.createBudget({
        ...form,
        amount_usd: parseFloat(form.amount_usd),
        alert_thresholds: form.alert_thresholds.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0),
      })
      onCreated(b)
      onClose()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const Field = ({ label, k, type = 'text', placeholder }) => (
    <div>
      <label style={{ color: 'var(--c-64748b)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 4 }}>{label}</label>
      <input
        type={type} value={form[k]} placeholder={placeholder}
        onChange={e => set(k, e.target.value)}
        style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6, color: 'var(--c-e2e8f0)', padding: '7px 10px', fontSize: 12, width: '100%', outline: 'none' }}
      />
    </div>
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 12, padding: 24, width: 440, maxWidth: '90vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ color: 'var(--c-f1f5f9)', fontSize: 16, fontWeight: 700, margin: 0 }}>Create Budget</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-64748b)' }}><X size={16} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Budget Name" k="name" placeholder="e.g. Production Monthly" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Amount (USD)" k="amount_usd" type="number" placeholder="e.g. 10000" />
            <SearchableSelect
              label="Period"
              value={form.period}
              onChange={v => set('period', v)}
              options={[{value:'Monthly',label:'Monthly'},{value:'Quarterly',label:'Quarterly'},{value:'Annually',label:'Annually'}]}
              compact
            />
          </div>
          <Field label="Alert Thresholds %" k="alert_thresholds" placeholder="50,75,90,100" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Owner Email" k="owner_email" placeholder="owner@company.com" />
            <Field label="Cost Center" k="cost_center" placeholder="e.g. CC-1234" />
          </div>
          {err && <div style={{ color: 'var(--c-f87171)', fontSize: 11 }}>{err}</div>}
          <button onClick={submit} disabled={saving} style={{
            background: '#0078d4', border: 'none', borderRadius: 7, padding: '9px', color: 'white',
            fontWeight: 600, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
            boxShadow: saving ? 'none' : '0 1px 4px rgba(0, 120, 212, 0.3)',
          }}>
            {saving ? 'Creating…' : 'Create Budget'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Individual budget card with lazy variance fetch on expand */
function BudgetCard({ b, onDelete, onEdit }) {
  const [expanded,  setExpanded]  = useState(false)
  const [variance,  setVariance]  = useState(null)
  const [varLoading, setVarLoading] = useState(false)

  const loadVariance = useCallback(async () => {
    if (variance || varLoading) return
    setVarLoading(true)
    try {
      const v = await finopsApi.getBudgetVariance(b.id)
      setVariance(v)
    } catch { /* non-critical */ }
    finally { setVarLoading(false) }
  }, [b.id, variance, varLoading])

  const handleExpand = () => {
    setExpanded(e => !e)
    if (!expanded) loadVariance()
  }

  return (
    <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ flex: 1, cursor: 'pointer' }} onClick={handleExpand}>
          <div style={{ color: 'var(--c-e2e8f0)', fontWeight: 700, fontSize: 13 }}>{b.name}</div>
          <div style={{ color: 'var(--c-475569)', fontSize: 10, marginTop: 2 }}>
            {b.period} · {b.scope_type} · {b.source === 'azure' ? '☁ Azure' : '✎ Custom'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {variance && <StatusBadge status={variance.status} />}
          {b.source !== 'azure' && (
            <>
              <button onClick={() => onEdit(b)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-475569)', padding: 2,
              }} title="Edit"><Edit2 size={13} /></button>
              <button onClick={() => onDelete(b.id)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-475569)', padding: 2,
              }} title="Delete"><Trash2 size={13} /></button>
            </>
          )}
        </div>
      </div>

      {/* Always show static info */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div style={{ background: 'var(--c-0f172a)', borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ color: 'var(--c-475569)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Budget</div>
          <div style={{ color: '#3b82f6', fontSize: 14, fontWeight: 700 }}>{fmtUsd(b.amount_usd)}</div>
        </div>
        <div style={{ background: 'var(--c-0f172a)', borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ color: 'var(--c-475569)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Remaining</div>
          <div style={{ color: variance?.status === 'exceeded' ? '#f87171' : '#22c55e', fontSize: 14, fontWeight: 700 }}>
            {varLoading ? <RefreshCw size={12} className="animate-spin" style={{ color: '#3b82f6' }} /> : (variance ? fmtUsd(variance.remaining_usd, 2) : '―')}
          </div>
        </div>
      </div>

      {/* Click to expand and load variance */}
      {!expanded ? (
        <button onClick={handleExpand} style={{ width: '100%', background: 'none', border: '1px dashed var(--c-1e293b)', borderRadius: 6, padding: '5px', cursor: 'pointer', color: 'var(--c-475569)', fontSize: 11 }}>
          {varLoading ? 'Loading variance…' : 'Show utilization'}
        </button>
      ) : (
        <>
          <BudgetProgress budget={b} variance={variance} />
          {b.cost_center && (
            <div style={{ marginTop: 8, fontSize: 10, color: 'var(--c-475569)' }}>
              Cost Center: <span style={{ color: 'var(--c-64748b)' }}>{b.cost_center}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function BudgetManager() {
  const [budgets,   setBudgets]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [creating,  setCreating]  = useState(false)
  const [editing,   setEditing]   = useState(null)
  const [syncing,   setSyncing]   = useState(false)

  const loadBudgets = async (sync = false) => {
    if (sync) setSyncing(true); else setLoading(true)
    setError(null)
    try {
      const list = await finopsApi.listBudgets(sync)
      setBudgets(list)
      // Variance is now loaded lazily per card — no N parallel requests on mount
    } catch (e) { setError(e.message) }
    finally { setLoading(false); setSyncing(false) }
  }

  useEffect(() => { loadBudgets() }, [])

  const deleteBudget = async (id) => {
    if (!confirm('Delete this budget?')) return
    await finopsApi.deleteBudget(id)
    setBudgets(prev => prev.filter(b => b.id !== id))
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 10, color: '#3b82f6' }}>
      <RefreshCw size={18} className="animate-spin" /><span style={{ color: 'var(--c-94a3b8)' }}>Loading budgets…</span>
    </div>
  )
  if (error) return (
    <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 10, padding: 16, color: 'var(--c-fca5a5)', display: 'flex', gap: 8 }}>
      <AlertCircle size={16} /><span style={{ fontSize: 12 }}>{error}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <FinOpsExportMenu view="budgets" focusDays={30} onXlsx={() => finopsApi.downloadReport()} report={{ title: 'Budget Manager', kpis: [{ label: 'Budgets', value: String((budgets || []).length) }], tables: [{ title: 'Budgets', columns: ['Name', 'Amount', 'Period', 'Scope'], rows: (budgets || []).slice(0, 40).map(b => [b.name || '-', fmtUsd(b.amount_usd), b.period || '-', b.scope_type || '-']) }] }} />
      </div>
      <FinOpsAIPanel view="budgets" data={{ budget_count: (budgets || []).length, budgets: (budgets || []).slice(0, 15).map(b => ({ name: b.name, amount: b.amount_usd, period: b.period, scope: b.scope_type, cost_center: b.cost_center })) }} />
      {creating && <CreateBudgetModal onClose={() => setCreating(false)} onCreated={b => setBudgets(prev => [b, ...prev])} />}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 18, fontWeight: 700, margin: 0 }}>Budget Manager</h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: 0 }}>Azure native + custom budgets with live variance from Azure Cost Management</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => loadBudgets(true)} disabled={syncing} style={{
            background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', borderRadius: 6, padding: '6px 12px',
            color: 'var(--c-94a3b8)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> Sync Azure
          </button>
          <button onClick={() => setCreating(true)} style={{
            background: '#3b82f6', border: 'none', borderRadius: 6, padding: '6px 14px',
            color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Plus size={12} /> New Budget
          </button>
        </div>
      </div>

      {/* Budget cards */}
      {budgets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--c-334155)', fontSize: 13 }}>
          No budgets found. Click <strong style={{ color: '#3b82f6' }}>Sync Azure</strong> to import Azure Portal budgets, or create a custom one.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {budgets.map(b => (
            <BudgetCard
              key={b.id}
              b={b}
              onDelete={deleteBudget}
              onEdit={b => setEditing(b)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
