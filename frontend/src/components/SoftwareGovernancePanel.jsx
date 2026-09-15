/**
 * SoftwareGovernancePanel — on-premise / Arc Windows software governance.
 *
 * Builds on the existing WMI/registry software inventory the on-prem scanner
 * collects. Lets you maintain an allow / block / required policy, evaluate a
 * machine's installed software against it (unauthorized / blocked / missing),
 * and run AI software intelligence (EOL, security risk, license, Azure target).
 *
 * This is the genuinely useful idea from scrosalem/software-scanner — done
 * natively on our richer inventory and AI-enhanced.
 *
 * Rules of Hooks: all hooks unconditional, before any early return.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ShieldCheck, Save, PlayCircle, Brain, AlertTriangle, CheckCircle2, XCircle, RefreshCw, ListChecks, Gauge, Boxes, Search, Sparkles, ChevronDown, ChevronRight, ShieldAlert, FileWarning, Rocket } from 'lucide-react'

const RISK_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' }
const EOL_COLOR  = { 'end-of-life': '#ef4444', 'approaching-eol': '#f59e0b', supported: '#22c55e', unknown: 'var(--c-64748b)' }

async function jget(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}`); return r.json() }
async function jsend(url, method, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) { const t = await r.text().catch(() => r.statusText); throw new Error(`${r.status}: ${t}`) }
  return r.json()
}

export default function SoftwareGovernancePanel() {
  const [tab, setTab] = useState('overview')
  const [policy, setPolicy]   = useState({ required: [], blocked: [], allowed: [] })
  const [templates, setTemplates] = useState([])
  const [fleet, setFleet] = useState(null)
  const [fleetLoading, setFleetLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [inventoryText, setInventoryText] = useState('Google Chrome\nMicrosoft SQL Server 2014\nApache Tomcat 8.5\nAnyDesk\nJava 8 Update 311\nNotepad++')
  const [evaluation, setEvaluation] = useState(null)
  const [evaluating, setEvaluating] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const [aiBusy, setAiBusy]   = useState(false)
  const [error, setError]     = useState(null)
  const [catFilter, setCatFilter] = useState('all')
  const [riskFilter, setRiskFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [whyOpen, setWhyOpen] = useState(true)
  const mounted = useRef(true)

  useEffect(() => () => { mounted.current = false }, [])

  const loadPolicy = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const p = await jget('/api/onprem/software-policy')
      if (mounted.current) setPolicy({ required: p.required || [], blocked: p.blocked || [], allowed: p.allowed || [] })
    } catch (e) { if (mounted.current) setError(e.message) }
    finally { if (mounted.current) setLoading(false) }
  }, [])

  const loadTemplates = useCallback(async () => {
    try { const t = await jget('/api/onprem/software/templates'); if (mounted.current) setTemplates(t.templates || []) } catch { /* */ }
  }, [])

  const loadFleet = useCallback(async () => {
    setFleetLoading(true); setError(null)
    try { const f = await jget('/api/onprem/software/fleet'); if (mounted.current) setFleet(f) }
    catch (e) { if (mounted.current) setError(e.message) }
    finally { if (mounted.current) setFleetLoading(false) }
  }, [])

  useEffect(() => { loadPolicy(); loadTemplates(); loadFleet() }, [loadPolicy, loadTemplates, loadFleet])

  const parseInventory = useCallback(() => (
    inventoryText.split('\n').map(s => s.trim()).filter(Boolean).map(name => ({ name }))
  ), [inventoryText])

  const savePolicy = async () => {
    setSaving(true); setSavedMsg(''); setError(null)
    try {
      await jsend('/api/onprem/software-policy', 'PUT', policy)
      setSavedMsg('Policy saved')
      loadFleet()
      setTimeout(() => mounted.current && setSavedMsg(''), 2500)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const applyTemplate = (tpl) => {
    setPolicy({ required: tpl.policy.required || [], blocked: tpl.policy.blocked || [], allowed: tpl.policy.allowed || [] })
    setSavedMsg(`Loaded “${tpl.label}” — review & Save`)
    setTimeout(() => mounted.current && setSavedMsg(''), 3500)
  }

  const evaluate = async () => {
    setEvaluating(true); setError(null)
    try {
      const res = await jsend('/api/onprem/software-policy/evaluate', 'POST', { inventory: parseInventory(), policy })
      if (mounted.current) setEvaluation(res)
    } catch (e) { setError(e.message) }
    finally { setEvaluating(false) }
  }

  const runAI = async () => {
    setAiBusy(true); setError(null)
    try {
      const res = await jsend('/api/onprem/software-ai', 'POST', { from_fleet: true, force_refresh: false })
      if (mounted.current) setAiResult(res)
    } catch (e) { setError(e.message) }
    finally { setAiBusy(false) }
  }

  const editList = (key) => (e) => setPolicy(p => ({ ...p, [key]: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }))
  const scoreColor = (s) => s >= 80 ? '#22c55e' : s >= 50 ? '#f59e0b' : '#ef4444'

  const sum = fleet?.summary || {}
  const catalog = fleet?.catalog || []
  const filteredCatalog = catalog.filter(c =>
    (catFilter === 'all' || c.category === catFilter) &&
    (riskFilter === 'all' || c.risk === riskFilter) &&
    (!search.trim() || (c.name + ' ' + (c.publisher || '')).toLowerCase().includes(search.trim().toLowerCase()))
  )
  const categories = ['all', ...Object.keys(fleet?.category_breakdown || {}).sort()]
  const TABS = [
    { key: 'overview', label: 'Overview', icon: Gauge },
    { key: 'catalog',  label: `Software Catalog${catalog.length ? ` (${catalog.length})` : ''}`, icon: Boxes },
    { key: 'policy',   label: 'Policy & Templates', icon: ListChecks },
    { key: 'ai',       label: 'AI Intelligence', icon: Brain },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ color: 'var(--c-f1f5f9)', fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={20} style={{ color: '#22c55e' }} /> Software Governance
          </h2>
          <p style={{ color: 'var(--c-64748b)', fontSize: 12, margin: '2px 0 0' }}>
            Fleet-wide control of installed software across your on-prem &amp; Azure Arc Windows estate — security, licensing &amp; modernization in one place.
          </p>
        </div>
        <button onClick={loadFleet} disabled={fleetLoading} style={btn('var(--c-0c1f33)', '#1d4ed8', '#60a5fa')}>
          <RefreshCw size={12} className={fleetLoading ? 'animate-spin' : ''} /> {fleetLoading ? 'Scanning fleet…' : 'Scan fleet'}
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--c-1e293b)', paddingBottom: 8, flexWrap: 'wrap' }}>
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: tab === t.key ? '#2563eb' : 'transparent', color: tab === t.key ? '#fff' : 'var(--c-94a3b8)', border: 'none',
            }}><Icon size={14} /> {t.label}</button>
          )
        })}
      </div>

      {error && <div style={{ background: '#1a0e0e', border: '1px solid var(--c-7f1d1d)', borderRadius: 8, padding: '8px 12px', color: 'var(--c-fca5a5)', fontSize: 12 }}>{error}</div>}

      {/* ─── OVERVIEW ─── */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <WhyItMatters open={whyOpen} onToggle={() => setWhyOpen(o => !o)} />

          {!fleet?.has_data ? (
            <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 24, textAlign: 'center' }}>
              <Boxes size={30} style={{ color: 'var(--c-334155)', marginBottom: 8 }} />
              <div style={{ color: 'var(--c-e2e8f0)', fontSize: 14, fontWeight: 600 }}>No software inventory yet</div>
              <p style={{ color: 'var(--c-64748b)', fontSize: 12, maxWidth: 470, margin: '6px auto 12px' }}>
                Software governance runs over the servers collected under <b>On-Premises</b>. Scan servers
                (with the “Applications” module enabled) and they’ll be scored here automatically.
              </p>
              <button onClick={loadFleet} style={{ ...btn('var(--c-0d2b1f)', 'var(--c-166534)', '#4ade80'), display: 'inline-flex' }}>
                <RefreshCw size={12} /> Re-check inventory
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
                <KPI label="Servers governed" value={sum.servers_with_software} sub={`of ${sum.servers_total} in inventory`} color="#60a5fa" />
                <KPI label="Fleet compliance" value={`${sum.avg_compliance}%`} sub={`${sum.compliant_servers} ok · ${sum.noncompliant_servers} not`} color={scoreColor(sum.avg_compliance || 0)} />
                <KPI label="Blocked installs" value={sum.blocked_incidents} sub={`${sum.blocked_software_types} blocked types`} color={sum.blocked_incidents ? '#ef4444' : '#22c55e'} />
                <KPI label="Missing required" value={sum.missing_required_gaps} sub="agent / security gaps" color={sum.missing_required_gaps ? '#f59e0b' : '#22c55e'} />
                <KPI label="High-risk apps" value={sum.high_risk_apps} sub="remote-access / P2P / crypto" color={sum.high_risk_apps ? '#ef4444' : '#22c55e'} />
                <KPI label="End-of-life apps" value={sum.eol_apps} sub={`${sum.approaching_eol_apps || 0} approaching`} color={sum.eol_apps ? '#f59e0b' : '#22c55e'} />
                <KPI label="Commercial apps" value={sum.commercial_apps} sub="license / true-up watch" color="#c4b5fd" />
                <KPI label="Unique software" value={sum.unique_software} sub="across the fleet" color="var(--c-94a3b8)" />
              </div>

              {fleet.category_breakdown && Object.keys(fleet.category_breakdown).length > 0 && (
                <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
                  <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Software by category</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {Object.entries(fleet.category_breakdown).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
                      <button key={c} onClick={() => { setCatFilter(c); setTab('catalog') }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                        <CatBadge category={c} />
                        <span style={{ color: 'var(--c-cbd5e1)', fontSize: 12, fontWeight: 700 }}>{n}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
                <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Servers needing attention</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr>
                      {['Server', 'OS', 'Apps', 'Blocked', 'Missing required', 'Compliance'].map(h => (
                        <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {(fleet.per_server || []).filter(p => !p.no_data).slice(0, 12).map((p, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--c-0f172a)' }}>
                          <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)', fontWeight: 600 }}>{p.hostname}</td>
                          <td style={{ padding: '6px 8px', color: 'var(--c-64748b)' }}>{p.os || '—'}</td>
                          <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)' }}>{p.app_count}</td>
                          <td style={{ padding: '6px 8px', color: p.blocked.length ? '#ef4444' : 'var(--c-475569)' }}>{p.blocked.length ? p.blocked.join(', ') : '—'}</td>
                          <td style={{ padding: '6px 8px', color: p.missing_required.length ? '#f59e0b' : 'var(--c-475569)' }}>{p.missing_required.length ? p.missing_required.join(', ') : '—'}</td>
                          <td style={{ padding: '6px 8px' }}><span style={{ color: scoreColor(p.compliance_score), fontWeight: 800 }}>{p.compliance_score}</span></td>
                        </tr>
                      ))}
                      {(fleet.per_server || []).filter(p => !p.no_data).length === 0 && (
                        <tr><td colSpan={6} style={{ padding: 10, color: 'var(--c-64748b)', fontSize: 12 }}>No scored servers yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── CATALOG ─── */}
      {tab === 'catalog' && (
        <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: 9, color: 'var(--c-475569)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search software / publisher…"
                style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6, color: 'var(--c-cbd5e1)', fontSize: 12, padding: '6px 8px 6px 26px', width: 220 }} />
            </div>
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={sel}>
              {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
            </select>
            <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)} style={sel}>
              {['all', 'high', 'medium', 'low'].map(r => <option key={r} value={r}>{r === 'all' ? 'All risk' : r + ' risk'}</option>)}
            </select>
            <span style={{ color: 'var(--c-64748b)', fontSize: 12, marginLeft: 'auto' }}>{filteredCatalog.length} of {catalog.length}</span>
          </div>
          {catalog.length === 0 ? (
            <div style={{ color: 'var(--c-64748b)', fontSize: 12, padding: 10 }}>No software catalog yet — run a fleet scan from the Overview tab.</div>
          ) : (
            <div style={{ overflowX: 'auto', maxHeight: 580, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr>
                  {['Software', 'Publisher', 'Category', 'Risk', 'License', 'EOL', 'Servers', 'Flags'].map(h => (
                    <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '6px 8px', borderBottom: '1px solid var(--c-1e293b)', position: 'sticky', top: 0, background: 'var(--c-111827)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filteredCatalog.map((c, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--c-0f172a)' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)', fontWeight: 600 }}>{c.name}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-64748b)' }}>{c.publisher || '—'}</td>
                      <td style={{ padding: '6px 8px' }}><CatBadge category={c.category} /></td>
                      <td style={{ padding: '6px 8px' }}><Badge text={c.risk} color={RISK_COLOR[c.risk]} /></td>
                      <td style={{ padding: '6px 8px', color: c.license === 'commercial' ? '#c4b5fd' : 'var(--c-94a3b8)' }}>{c.license}</td>
                      <td style={{ padding: '6px 8px' }}><span style={{ color: EOL_COLOR[c.eol_status] || 'var(--c-64748b)' }}>{c.eol_status}</span></td>
                      <td style={{ padding: '6px 8px', color: 'var(--c-60a5fa)', fontWeight: 700 }} title={(c.servers || []).join(', ')}>{c.server_count}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {c.is_blocked && <Badge text="blocked" color="#ef4444" />}
                        {c.is_required && <Badge text="required" color="#3b82f6" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── POLICY ─── */}
      {tab === 'policy' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {templates.length > 0 && (
            <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
              <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Policy templates</div>
              <p style={{ color: 'var(--c-64748b)', fontSize: 11, margin: '0 0 10px' }}>One-click starting points — load, review, then Save.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10 }}>
                {templates.map(t => (
                  <div key={t.key} style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: 12 }}>
                    <div style={{ color: 'var(--c-e2e8f0)', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{t.label}</div>
                    <p style={{ color: 'var(--c-64748b)', fontSize: 11, lineHeight: 1.5, margin: '0 0 10px', minHeight: 48 }}>{t.description}</p>
                    <button onClick={() => applyTemplate(t)} style={btn('var(--c-0c1f33)', '#1d4ed8', '#60a5fa')}><Sparkles size={12} /> Load template</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><ListChecks size={15} /> Software Policy</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {savedMsg && <span style={{ color: 'var(--c-4ade80)', fontSize: 11 }}>{savedMsg}</span>}
                <button onClick={loadPolicy} disabled={loading} style={btn('var(--c-1e293b)', 'var(--c-334155)', 'var(--c-94a3b8)')}><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Reload</button>
                <button onClick={savePolicy} disabled={saving} style={btn('var(--c-0c1f33)', '#1d4ed8', '#60a5fa')}><Save size={12} /> {saving ? 'Saving…' : 'Save & re-scan'}</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
              {[
                { key: 'required', label: 'Required (must be installed)', color: '#3b82f6' },
                { key: 'blocked',  label: 'Blocked (must NOT be installed)', color: '#ef4444' },
                { key: 'allowed',  label: 'Allowed (empty = allow all non-blocked)', color: '#22c55e' },
              ].map(c => (
                <div key={c.key}>
                  <div style={{ color: c.color, fontSize: 11, fontWeight: 700, marginBottom: 5 }}>{c.label}</div>
                  <textarea value={(policy[c.key] || []).join('\n')} onChange={editList(c.key)} rows={7} placeholder="One per line…"
                    style={{ width: '100%', background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6, color: 'var(--c-cbd5e1)', fontSize: 12, padding: 8, fontFamily: 'monospace', resize: 'vertical' }} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
            <span style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700 }}>Ad-hoc check (paste a machine’s software)</span>
            <p style={{ color: 'var(--c-64748b)', fontSize: 11, margin: '2px 0 8px' }}>Test the policy against any list without scanning — one app per line.</p>
            <textarea value={inventoryText} onChange={e => setInventoryText(e.target.value)} rows={5}
              style={{ width: '100%', background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6, color: 'var(--c-cbd5e1)', fontSize: 12, padding: 8, fontFamily: 'monospace', resize: 'vertical' }} />
            <button onClick={evaluate} disabled={evaluating} style={{ ...btn('var(--c-0d2b1f)', 'var(--c-166534)', '#4ade80'), marginTop: 10 }}>
              <PlayCircle size={13} /> {evaluating ? 'Evaluating…' : 'Evaluate compliance'}
            </button>
            {evaluation && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ color: scoreColor(evaluation.compliance_score), fontSize: 26, fontWeight: 800 }}>{evaluation.compliance_score}</span>
                    <span style={{ color: 'var(--c-64748b)', fontSize: 12 }}>/100</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: evaluation.compliant ? '#22c55e' : '#ef4444', background: (evaluation.compliant ? '#22c55e' : '#ef4444') + '22', borderRadius: 5, padding: '3px 10px' }}>{evaluation.compliant ? 'COMPLIANT' : 'NON-COMPLIANT'}</span>
                  <span style={{ color: 'var(--c-64748b)', fontSize: 12 }}>{evaluation.total_installed} apps</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
                  <Findings title="Blocked found" color="#ef4444" icon={XCircle} items={(evaluation.blocked_found || []).map(b => `${b.name} (rule: ${b.matched_rule})`)} empty="None — good" />
                  <Findings title="Missing required" color="#f59e0b" icon={AlertTriangle} items={evaluation.missing_required || []} empty="All present" />
                  <Findings title="Unauthorized" color="var(--c-94a3b8)" icon={AlertTriangle} items={(evaluation.unauthorized || []).map(u => u.name)} empty="None" />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── AI ─── */}
      {tab === 'ai' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700 }}>AI software intelligence</div>
              <p style={{ color: 'var(--c-64748b)', fontSize: 11, margin: '2px 0 0', maxWidth: 520 }}>
                Runs over your real fleet software to assess end-of-life / support, security risk, license type and the recommended Azure target for each product.
              </p>
            </div>
            <button onClick={runAI} disabled={aiBusy} style={btn('var(--c-1e1b4b)', '#6d28d9', '#c4b5fd')}><Brain size={13} /> {aiBusy ? 'Analysing…' : 'Analyse fleet software'}</button>
          </div>
          {aiResult && (
            <div style={{ background: 'linear-gradient(180deg,var(--c-0c1322),var(--c-0a0f1a))', border: '1px solid var(--c-1e3a5f)', borderRadius: 10, padding: 16 }}>
              <div style={{ color: 'var(--c-c4b5fd)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Brain size={15} /> AI Software Intelligence
                <span style={{ fontSize: 9, color: 'var(--c-64748b)', background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 4, padding: '1px 6px' }}>{aiResult.provider}</span>
              </div>
              {aiResult.summary && <p style={{ color: 'var(--c-cbd5e1)', fontSize: 12, lineHeight: 1.5, marginTop: 0 }}>{aiResult.summary}</p>}
              {(aiResult.items || []).length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead><tr>
                      {['Software', 'EOL', 'Risk', 'License', 'Azure target', 'Recommendation'].map(h => (
                        <th key={h} style={{ textAlign: 'left', color: 'var(--c-475569)', padding: '5px 8px', borderBottom: '1px solid var(--c-1e293b)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {aiResult.items.map((it, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--c-0f172a)' }}>
                          <td style={{ padding: '6px 8px', color: 'var(--c-e2e8f0)' }}>{it.name}</td>
                          <td style={{ padding: '6px 8px' }}><span style={{ color: EOL_COLOR[it.eol_status] || 'var(--c-64748b)' }}>{it.eol_status}</span></td>
                          <td style={{ padding: '6px 8px' }}><span style={{ color: RISK_COLOR[it.security_risk] || 'var(--c-64748b)' }}>{it.security_risk}</span></td>
                          <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)' }}>{it.license_note || '—'}</td>
                          <td style={{ padding: '6px 8px', color: 'var(--c-60a5fa)' }}>{it.azure_target || '—'}</td>
                          <td style={{ padding: '6px 8px', color: 'var(--c-94a3b8)' }}>{it.recommendation || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function btn(bg, border, color) {
  return { display: 'flex', alignItems: 'center', gap: 6, background: bg, border: `1px solid ${border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', color, fontSize: 11, fontWeight: 600 }
}

function Findings({ title, color, icon: Icon, items, empty }) {
  return (
    <div style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: 12 }}>
      <div style={{ color, fontSize: 11, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon size={13} /> {title} ({items.length})
      </div>
      {items.length === 0
        ? <div style={{ color: '#22c55e', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}><CheckCircle2 size={12} /> {empty}</div>
        : <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--c-cbd5e1)', fontSize: 11, lineHeight: 1.6 }}>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>}
    </div>
  )
}

const sel = { background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6, color: 'var(--c-cbd5e1)', fontSize: 12, padding: '6px 8px', cursor: 'pointer' }

const CAT_META = {
  'remote-access':    { label: 'Remote access',     color: '#ef4444' },
  'p2p-file-sharing': { label: 'P2P / file-sharing', color: '#ef4444' },
  'crypto-mining':    { label: 'Crypto',             color: '#ef4444' },
  'piracy-unwanted':  { label: 'Unwanted / piracy',  color: '#ef4444' },
  'security-agent':   { label: 'Security agent',     color: '#22c55e' },
  'azure-agent':      { label: 'Azure agent',        color: '#22c55e' },
  'backup-dr':        { label: 'Backup / DR',        color: '#38bdf8' },
  'virtualization':   { label: 'Virtualization',     color: '#38bdf8' },
  'database':         { label: 'Database',           color: '#f59e0b' },
  'web-server':       { label: 'Web / app server',   color: '#f59e0b' },
  'runtime':          { label: 'Runtime',            color: 'var(--c-94a3b8)' },
  'browser':          { label: 'Browser',            color: 'var(--c-94a3b8)' },
  'dev-tool':         { label: 'Dev tool',           color: '#a78bfa' },
  'productivity':     { label: 'Productivity',       color: 'var(--c-94a3b8)' },
  'utility':          { label: 'Utility',            color: 'var(--c-94a3b8)' },
  'other':            { label: 'Other',              color: 'var(--c-64748b)' },
}

function CatBadge({ category }) {
  const m = CAT_META[category] || { label: category, color: 'var(--c-64748b)' }
  return <span style={{ color: m.color, background: m.color + '1e', border: `1px solid ${m.color}40`, borderRadius: 5, padding: '2px 7px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{m.label}</span>
}

function Badge({ text, color }) {
  if (!text) return null
  const c = color || 'var(--c-64748b)'
  return <span style={{ color: c, background: c + '1e', borderRadius: 5, padding: '2px 7px', fontSize: 10, fontWeight: 700, marginRight: 4, whiteSpace: 'nowrap' }}>{text}</span>
}

function KPI({ label, value, sub, color }) {
  return (
    <div style={{ background: 'var(--c-111827)', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 14, borderLeft: `3px solid ${color}` }}>
      <div style={{ color: 'var(--c-64748b)', fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 24, fontWeight: 800, lineHeight: 1 }}>{value ?? 0}</div>
      {sub && <div style={{ color: 'var(--c-475569)', fontSize: 10, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

const WHY_PILLARS = [
  { icon: ShieldAlert, color: '#ef4444', title: 'Security & shadow IT', body: 'Unsanctioned remote-access tools (TeamViewer, AnyDesk), torrent clients and crackers are prime ransomware and data-exfiltration entry points. Governance flags them on every server automatically.' },
  { icon: FileWarning, color: '#c4b5fd', title: 'Licensing & audit risk', body: 'Commercial software (SQL Server, Oracle, VMware) installed without tracking means surprise true-up costs and failed vendor audits. Every commercial product and where it runs is surfaced.' },
  { icon: Rocket, color: '#60a5fa', title: 'Modernization readiness', body: 'End-of-life runtimes (Java 8, .NET 3.5, SQL 2012) block Azure migration and carry unpatched CVEs. We detect them so you can plan upgrades and re-platforming.' },
  { icon: CheckCircle2, color: '#22c55e', title: 'Standardization', body: 'Required agents (Azure Arc, Azure Monitor, Defender) must be on every machine for the estate to be governable, observable and protected. Coverage gaps are shown instantly.' },
]

function WhyItMatters({ open, onToggle }) {
  return (
    <div style={{ background: 'linear-gradient(180deg,var(--c-0c1322),var(--c-0b1018))', border: '1px solid var(--c-1e293b)', borderRadius: 10, padding: 16 }}>
      <button onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 700, padding: 0 }}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Why software governance matters
      </button>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12, marginTop: 12 }}>
          {WHY_PILLARS.map((p, i) => {
            const Icon = p.icon
            return (
              <div key={i} style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                  <Icon size={15} style={{ color: p.color }} />
                  <span style={{ color: 'var(--c-e2e8f0)', fontSize: 12, fontWeight: 700 }}>{p.title}</span>
                </div>
                <p style={{ color: 'var(--c-94a3b8)', fontSize: 11, lineHeight: 1.55, margin: 0 }}>{p.body}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
