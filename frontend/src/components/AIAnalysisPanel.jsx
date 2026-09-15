/**
 * AIAnalysisPanel — Reusable AI analysis component for all modules.
 * 
 * Usage:
 *   <AIAnalysisPanel
 *     endpoint="/api/ai/maturity"
 *     title="Cloud Maturity AI Analysis"
 *     renderReport={(data) => <MaturityAIReport data={data} />}
 *   />
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import TagAIBanner from './TagAIBanner';
import ResourceDetailDrawer from './ResourceDetailDrawer';
import { asText } from '../utils/safeText';

const API = import.meta.env.VITE_API_URL || '';

// Contains a render failure in a single module's AI report so a bad/stale/partial
// cached result can never take down the whole portal section. Offers a re-run.
class ReportBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { try { console.warn('AI report render failed:', err?.message); } catch { /* noop */ } }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }); }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ background: 'var(--c-0f172a)', border: '1px solid var(--c-7f1d1d)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
          <div style={{ color: 'var(--c-fca5a5)', fontSize: 14, fontWeight: 700, marginBottom: 6 }}>This analysis couldn't be displayed</div>
          <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, marginBottom: 12 }}>The cached AI result was incomplete or in an unexpected format. Re-running usually fixes it.</div>
          <button onClick={this.props.onRetry} style={{ padding: '8px 18px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Re-run AI Analysis</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const SEVERITY_COLORS = {
  critical: { bg: 'var(--c-450a0a)', border: '#dc2626', text: '#fca5a5', badge: '#ef4444' },
  high:     { bg: 'var(--c-431407)', border: '#ea580c', text: '#fdba74', badge: '#f97316' },
  medium:   { bg: 'var(--c-422006)', border: '#d97706', text: '#fcd34d', badge: '#eab308' },
  low:      { bg: 'var(--c-052e16)', border: '#16a34a', text: '#86efac', badge: '#22c55e' },
  P1:       { bg: 'var(--c-450a0a)', border: '#dc2626', text: '#fca5a5', badge: '#ef4444' },
  P2:       { bg: 'var(--c-431407)', border: '#ea580c', text: '#fdba74', badge: '#f97316' },
  P3:       { bg: 'var(--c-422006)', border: '#d97706', text: '#fcd34d', badge: '#eab308' },
};

function SeverityBadge({ severity }) {
  const s = (severity || '').toLowerCase();
  const c = SEVERITY_COLORS[s] || SEVERITY_COLORS[severity] || { bg: 'var(--c-1e293b)', border: 'var(--c-475569)', text: 'var(--c-94a3b8)', badge: 'var(--c-64748b)' };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
      padding: '2px 8px', borderRadius: 4, color: c.text, background: c.bg, border: `1px solid ${c.border}`,
    }}>
      {severity}
    </span>
  );
}

function ScoreGauge({ score, label, size = 100 }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score || 0));
  const offset = circ * (1 - pct / 100);
  const color = pct >= 80 ? '#22c55e' : pct >= 60 ? '#84cc16' : pct >= 40 ? '#eab308' : pct >= 20 ? '#f97316' : '#ef4444';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" style={{ stroke: 'var(--c-1e293b)' }} strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} />
        <text x={size/2} y={size/2 - 4} textAnchor="middle" fill={color} fontSize={size/3.5} fontWeight="800">{Math.round(pct)}</text>
        <text x={size/2} y={size/2 + 14} textAnchor="middle" style={{ fill: 'var(--c-94a3b8)' }} fontSize={size/10}>/ 100</text>
      </svg>
      {label && <span style={{ color: 'var(--c-94a3b8)', fontSize: 11, fontWeight: 600 }}>{label}</span>}
    </div>
  );
}

function ExpandableCard({ title, severity, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8, overflow: 'hidden',
      marginBottom: 8,
    }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {severity && <SeverityBadge severity={severity} />}
          <span style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600, textAlign: 'left' }}>{title}</span>
        </div>
        <span style={{ color: 'var(--c-64748b)', fontSize: 16 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--c-1e293b)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function FindingsList({ findings, onResourceClick }) {
  if (!findings || findings.length === 0) return <p style={{ color: 'var(--c-64748b)', fontSize: 12 }}>No findings.</p>;
  return findings.map((f, i) => (
    <ExpandableCard key={i} title={f.title} severity={f.severity}>
      <p style={{ color: 'var(--c-cbd5e1)', fontSize: 12, lineHeight: 1.6, marginTop: 8 }}>{f.detail || f.description}</p>
      {f.affected_resources?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <span style={{ color: 'var(--c-94a3b8)', fontSize: 11, fontWeight: 600 }}>
            Affected resources ({f.affected_resources.length}{f.affected_count && f.affected_count > f.affected_resources.length ? ` of ${f.affected_count}` : ''}) — click for 360° detail:
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {f.affected_resources.map((r, j) => {
              const ro = typeof r === 'string' ? { resource_name: r } : (r || {});
              const clickable = onResourceClick && (ro.resource_id || ro.resource_name);
              return (
                <div
                  key={j}
                  onClick={() => clickable && onResourceClick(ro)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '6px 10px', borderRadius: 6,
                    background: clickable ? 'var(--c-1e3a5f)' : 'var(--c-1e293b)',
                    border: clickable ? '1px solid #2563eb55' : '1px solid var(--c-1e293b)',
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                  title={clickable ? `View 360° details for ${ro.resource_name}` : undefined}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ color: clickable ? '#93c5fd' : 'var(--c-cbd5e1)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ro.resource_name || '(unknown)'}</span>
                    <span style={{ color: 'var(--c-64748b)', fontSize: 10 }}>
                      {(ro.resource_type || '').split('/').pop()}{ro.resource_group ? ` · ${ro.resource_group}` : ''}{ro.cost_usd ? ` · $${ro.cost_usd}/mo` : ''}
                    </span>
                  </div>
                  {clickable && <span style={{ color: 'var(--c-60a5fa)', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>Details →</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {f.recommendation && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: '#0c4a6e20', border: '1px solid #0c4a6e50', borderRadius: 6 }}>
          <span style={{ color: 'var(--c-38bdf8)', fontSize: 11, fontWeight: 600 }}>Recommendation: </span>
          <span style={{ color: 'var(--c-7dd3fc)', fontSize: 12 }}>{asText(f.recommendation)}</span>
        </div>
      )}
      {f.remediation && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: '#0c4a6e20', border: '1px solid #0c4a6e50', borderRadius: 6 }}>
          <span style={{ color: 'var(--c-38bdf8)', fontSize: 11, fontWeight: 600 }}>Remediation: </span>
          <span style={{ color: 'var(--c-7dd3fc)', fontSize: 12 }}>{asText(f.remediation)}</span>
        </div>
      )}
      {f.effort && (
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--c-94a3b8)' }}>Effort: <b style={{ color: 'var(--c-e2e8f0)' }}>{f.effort}</b></span>
          {f.impact && <span style={{ fontSize: 10, color: 'var(--c-94a3b8)' }}>Impact: <b style={{ color: 'var(--c-e2e8f0)' }}>{f.impact}</b></span>}
          {f.estimated_timeline && <span style={{ fontSize: 10, color: 'var(--c-94a3b8)' }}>Timeline: <b style={{ color: 'var(--c-e2e8f0)' }}>{f.estimated_timeline}</b></span>}
        </div>
      )}
    </ExpandableCard>
  ));
}

function RecommendationList({ recommendations }) {
  if (!recommendations?.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      {recommendations.map((r, i) => (
        <div key={i} style={{
          display: 'flex', gap: 10, padding: '10px 12px', marginBottom: 6,
          background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 8,
        }}>
          <div style={{ minWidth: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: r.priority === 'P1' ? 'var(--c-450a0a)' : r.priority === 'P2' ? 'var(--c-431407)' : 'var(--c-1e293b)',
            border: `1px solid ${r.priority === 'P1' ? '#dc2626' : r.priority === 'P2' ? '#ea580c' : 'var(--c-475569)'}`,
            color: r.priority === 'P1' ? '#fca5a5' : r.priority === 'P2' ? '#fdba74' : 'var(--c-94a3b8)',
            fontSize: 10, fontWeight: 800,
          }}>{r.priority || `#${i + 1}`}</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600 }}>{r.title}</div>
            <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, lineHeight: 1.5, marginTop: 2 }}>{r.description}</div>
            {r.azure_services?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {r.azure_services.map((s, j) => (
                  <span key={j} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#0369a120', border: '1px solid #0369a150', color: 'var(--c-38bdf8)' }}>{s}</span>
                ))}
              </div>
            )}
            {(r.estimated_effort || r.estimated_timeline || r.resources_affected) && (
              <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                {r.estimated_effort && <span style={{ fontSize: 10, color: 'var(--c-64748b)' }}>Effort: {r.estimated_effort}</span>}
                {r.estimated_timeline && <span style={{ fontSize: 10, color: 'var(--c-64748b)' }}>Timeline: {r.estimated_timeline}</span>}
                {r.resources_affected > 0 && <span style={{ fontSize: 10, color: 'var(--c-64748b)' }}>{r.resources_affected} resources</span>}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Estate context bar — shows 3-source data chips + per-category statistics grid
// ═══════════════════════════════════════════════════════════════════════════════

function EstateContextBar({ data }) {
  if (!data) return null;
  const ds = data._meta?.data_sources;
  const breakdown = data.estate_breakdown;
  const stats = data.statistics;
  if (!ds && !breakdown && !stats) return null;

  const azureN = breakdown?.azure?.count ?? ds?.azure_resources ?? 0;
  const arcN = breakdown?.arc?.machines ?? ds?.arc_machines ?? 0;
  const onpremN = breakdown?.onprem?.servers ?? ds?.onprem_servers ?? 0;

  const chip = (label, value, color) => (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 9999,
      background: `${color}1a`, border: `1px solid ${color}`, color,
    }}>{label}: {value}</span>
  );

  // Pick the most relevant statistics to surface (skip verbose nested objects)
  const statEntries = stats ? Object.entries(stats).filter(([k, v]) =>
    typeof v === 'number' && !['category'].includes(k)
  ).slice(0, 12) : [];

  const pretty = (k) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div style={{
      background: 'var(--c-0b1220)', border: '1px solid var(--c-1e293b)', borderRadius: 8,
      padding: '12px 14px', marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: statEntries.length ? 12 : 0 }}>
        <span style={{ color: 'var(--c-64748b)', fontSize: 11, fontWeight: 600, marginRight: 4 }}>Data sources grounding this analysis:</span>
        {chip('Azure-native', azureN, '#3b82f6')}
        {chip('Arc-hybrid', arcN, '#a855f7')}
        {chip('On-prem scanned', onpremN, '#f59e0b')}
      </div>
      {statEntries.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8,
        }}>
          {statEntries.map(([k, v]) => (
            <div key={k} style={{
              background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 6, padding: '8px 10px',
            }}>
              <div style={{ color: 'var(--c-e2e8f0)', fontSize: 16, fontWeight: 800 }}>
                {typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : v}
                {k.endsWith('_pct') ? '%' : ''}
              </div>
              <div style={{ color: 'var(--c-64748b)', fontSize: 10, marginTop: 2 }}>{pretty(k)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Main AI Analysis Panel — fetches data and renders module-specific report
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// Per-category focus metadata — drives category-accurate progress text and the
// user-directed "Focus" presets so each AI analysis is scoped to ITS OWN data
// (no more generic "Gathering Azure Arc inventory…" on identity/advisor/quota).
// ═══════════════════════════════════════════════════════════════════════════════
function endpointFocusMeta(endpoint = '') {
  const e = String(endpoint).split('?')[0];
  const MAP = {
    '/api/ai/entra':            { short: 'identity & access', data: 'role assignments, app registrations & directory signals', presets: ['Privileged & Owner sprawl', 'App registration secret/cert expiry', 'Guest & external user risk', 'Service principal / workload identity risk', 'Least-privilege & PIM readiness'] },
    '/api/ai/governance':       { short: 'governance & policy', data: 'Azure Policy compliance & RBAC signals', presets: ['Policy non-compliance', 'RBAC over-permissioning', 'Policy exemptions & drift', 'Management-group governance'] },
    '/api/ai/advisor':          { short: 'Advisor', data: 'Azure Advisor recommendations', presets: ['Cost', 'Security', 'Reliability', 'Performance', 'Operational Excellence'] },
    '/api/ai/quota':            { short: 'quota & capacity', data: 'quota & regional capacity signals', presets: ['Blocked VM families', 'Near-limit quotas', 'Qatar Central capacity', 'vCPU headroom for scaling'] },
    '/api/ai/service-health':   { short: 'Service Health', data: 'Service Health events', presets: ['Active service issues', 'Planned maintenance', 'Security advisories', 'Affected workloads'] },
    '/api/ai/lifecycle':        { short: 'retirements & deprecations', data: 'lifecycle radar signals', presets: ['Overdue retirements', 'Due within 30 days', 'SKU/size end-of-support', 'Certificate / security deadlines'] },
    '/api/ai/waf':              { short: 'Well-Architected', data: 'estate signals across the five pillars', presets: ['Reliability', 'Security', 'Cost Optimization', 'Operational Excellence', 'Performance Efficiency'] },
    '/api/ai/caf':              { short: 'Cloud Adoption Framework', data: 'landing-zone & adoption signals', presets: ['Govern', 'Secure', 'Ready (landing zone)', 'Migrate', 'Manage'] },
    '/api/ai/sql-modernization':{ short: 'SQL modernization', data: 'SQL estate (PaaS, IaaS, Arc, on-prem)', presets: ['IaaS SQL VMs', 'On-prem SQL', 'Managed Instance candidates', 'Azure SQL DB candidates'] },
    '/api/ai/appservice':       { short: 'App Service', data: 'App Service plans & sites', presets: ['Plan right-sizing', 'Tier upgrades (Pv3 / Isolated)', 'Functions Flex Consumption', 'Security & managed identity', 'Zone redundancy'] },
    '/api/ai/vm-performance':   { short: 'VM performance', data: 'Azure Monitor VM metrics', presets: ['Idle / underused VMs', 'Over-utilised VMs', 'Right-sizing', 'Arc-enabled servers'] },
  };
  return MAP[e] || { short: 'estate', data: 'Azure resource data', presets: [] };
}


export default function AIAnalysisPanel({ endpoint, title, renderReport }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadingStage, setLoadingStage] = useState('');
  // Resource detail drawer — opened when user clicks an affected resource chip
  const [drawerResource, setDrawerResource] = useState(null); // { name, id }
  // User-directed focus (scopes the AI to a sub-topic of THIS category's data)
  const meta = useMemo(() => endpointFocusMeta(endpoint), [endpoint]);
  const [scope, setScope] = useState('');         // applied focus (drives the request)
  const [focusDraft, setFocusDraft] = useState(''); // free-text input

  const handleResourceClick = useCallback((res) => {
    // `res` may be a full object {resource_id, resource_name, ...} or a string.
    if (res && typeof res === 'object') {
      const id = res.resource_id || null;
      const name = res.resource_name || (id ? id.split('/').pop() : '');
      setDrawerResource({ id, name });
    } else if (typeof res === 'string') {
      if (res.startsWith('/subscriptions/')) {
        setDrawerResource({ id: res, name: res.split('/').pop() });
      } else {
        setDrawerResource({ name: res, id: null });
      }
    }
  }, []);

  const runAnalysis = useCallback(async (refresh = false, scopeValue = scope) => {
    setLoading(true);
    setError(null);

    // Category-accurate progress (no more generic Arc text on every blade)
    const stages = [
      `Collecting ${meta.data}...`,
      'Building AI analysis context...',
      scopeValue
        ? `Focusing AI on "${scopeValue}"...`
        : `Sending to AI for deep ${meta.short} analysis...`,
      'Processing AI response...',
      'Finalizing recommendations...',
    ];
    setLoadingStage(stages[0]);
    let stageIdx = 0;
    const timer = setInterval(() => {
      stageIdx = Math.min(stageIdx + 1, stages.length - 1);
      setLoadingStage(stages[stageIdx]);
    }, 3000);

    try {
      const params = new URLSearchParams();
      params.set('refresh', String(refresh));
      if (scopeValue) params.set('scope', scopeValue);
      const url = `${API}${endpoint}${endpoint.includes('?') ? '&' : '?'}${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      clearInterval(timer);
      setLoading(false);
      setLoadingStage('');
    }
  }, [endpoint, scope, meta]);

  // Apply a focus (preset chip or free text) and immediately re-run scoped.
  const applyFocus = useCallback((value) => {
    const v = (value || '').trim();
    setScope(v);
    setFocusDraft(v);
    runAnalysis(true, v);
  }, [runAnalysis]);

  // Export the current AI report (works for ANY category) to PDF or rich multi-sheet Excel.
  const [exporting, setExporting] = useState(null);
  const category = useMemo(() => (endpoint || '').split('?')[0].split('/').filter(Boolean).pop() || 'ai', [endpoint]);
  const downloadBlob = (blob, name) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); };
  const exportPdf = useCallback(async () => {
    if (!data) return;
    setExporting('pdf');
    try {
      const { generateAIReportPDF } = await import('../utils/aiReportExport');
      const blob = await generateAIReportPDF(title, category, data);
      downloadBlob(blob, `${category}-ai-analysis-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) { console.error('PDF export failed', e); } finally { setExporting(null); }
  }, [data, title, category]);
  const exportXlsx = useCallback(async () => {
    if (!data) return;
    setExporting('xlsx');
    try {
      const res = await fetch(`${API}/api/ai/report-export.xlsx`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, category, report: data }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const fname = (cd.match(/filename="?([^"]+)"?/) || [])[1] || `${category}-ai-analysis.xlsx`;
      downloadBlob(blob, fname);
    } catch (e) { console.error('Excel export failed', e); } finally { setExporting(null); }
  }, [data, title, category]);

  // Auto-load on mount (uses cache)
  useEffect(() => { runAnalysis(false); }, []);

  if (loading) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: 300, gap: 16, padding: 40,
      }}>
        <div style={{
          width: 48, height: 48, border: '3px solid var(--c-1e293b)', borderTopColor: '#3b82f6',
          borderRadius: '50%', animation: 'spin 1s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        <div style={{ color: 'var(--c-94a3b8)', fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ color: 'var(--c-64748b)', fontSize: 12 }}>{loadingStage}</div>
        <div style={{ color: 'var(--c-475569)', fontSize: 11, marginTop: 8 }}>
          Deep AI analysis may take up to ~2 minutes for a comprehensive estate review…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        background: 'var(--c-0f172a)', border: '1px solid #dc2626', borderRadius: 12, padding: 24,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      }}>
        <div style={{ fontSize: 32 }}>△</div>
        <div style={{ color: 'var(--c-fca5a5)', fontSize: 14, fontWeight: 600 }}>Analysis Failed</div>
        <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, textAlign: 'center' }}>{error}</div>
        <button onClick={() => runAnalysis(true)} style={{
          marginTop: 8, padding: '8px 20px', background: '#1e40af', color: '#fff',
          border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>Retry Analysis</button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <ReportBoundary resetKey={data?._meta?.generated_at} onRetry={() => runAnalysis(true)}>
    <div style={{ position: 'relative' }}>
      <TagAIBanner />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
        <button onClick={exportPdf} disabled={!!exporting} title="Download a PDF of this AI analysis"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--c-1e293b)', border: '1px solid var(--c-334155)', color: 'var(--c-e2e8f0)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: exporting ? 'default' : 'pointer', opacity: exporting ? 0.6 : 1 }}>
          {exporting === 'pdf' ? 'Exporting…' : '⤓ Export PDF'}
        </button>
        <button onClick={exportXlsx} disabled={!!exporting} title="Download a rich multi-sheet Excel of this AI analysis"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--c-166534)', border: '1px solid #15803d', color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: exporting ? 'default' : 'pointer', opacity: exporting ? 0.6 : 1 }}>
          {exporting === 'xlsx' ? 'Exporting…' : '⤓ Export Excel'}
        </button>
      </div>
      {/* Focus selector — directs the AI at a sub-topic of THIS category's data.
          Only shown for scope-aware generic categories (presets configured). */}
      {meta.presets.length > 0 && (
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
        background: 'var(--c-0b1220)', border: '1px solid var(--c-1e293b)', borderRadius: 10,
        padding: '10px 12px', marginBottom: 12,
      }}>
        <span style={{ color: 'var(--c-64748b)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Focus
        </span>
        <button
          onClick={() => { if (scope) applyFocus(''); }}
          style={{
            padding: '4px 12px', borderRadius: 9999, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${scope ? 'var(--c-334155)' : '#3b82f6'}`,
            background: scope ? 'transparent' : 'rgba(59,130,246,0.15)',
            color: scope ? 'var(--c-94a3b8)' : '#93c5fd',
          }}
        >Full analysis</button>
        {meta.presets.map((p) => {
          const active = scope === p;
          return (
            <button key={p} onClick={() => applyFocus(p)} style={{
              padding: '4px 12px', borderRadius: 9999, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${active ? '#3b82f6' : 'var(--c-334155)'}`,
              background: active ? 'rgba(59,130,246,0.15)' : 'transparent',
              color: active ? '#93c5fd' : 'var(--c-94a3b8)',
            }}>{p}</button>
          );
        })}
        <div style={{ flex: 1 }} />
        <input
          value={focusDraft}
          onChange={(e) => setFocusDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyFocus(focusDraft); }}
          placeholder="Ask the AI to focus on…"
          style={{
            minWidth: 200, padding: '5px 10px', background: 'var(--c-0f172a)', color: 'var(--c-e2e8f0)',
            border: '1px solid var(--c-334155)', borderRadius: 6, fontSize: 12, outline: 'none',
          }}
        />
        <button onClick={() => applyFocus(focusDraft)} disabled={!focusDraft.trim() || focusDraft.trim() === scope} style={{
          padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
          border: '1px solid #2563eb',
          background: (!focusDraft.trim() || focusDraft.trim() === scope) ? 'var(--c-1e293b)' : '#2563eb',
          color: (!focusDraft.trim() || focusDraft.trim() === scope) ? 'var(--c-64748b)' : '#fff',
        }}>Apply</button>
      </div>
      )}
      {scope && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          color: 'var(--c-93c5fd)', fontSize: 12,
        }}>
          <span style={{
            padding: '3px 10px', borderRadius: 9999, background: 'rgba(59,130,246,0.12)',
            border: '1px solid #1d4ed8', fontWeight: 600,
          }}>Focused on: {scope}</span>
          <button onClick={() => applyFocus('')} style={{
            background: 'none', border: 'none', color: 'var(--c-64748b)', fontSize: 11, cursor: 'pointer',
            textDecoration: 'underline',
          }}>clear</button>
        </div>
      )}
      {/* Refresh button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {data._meta?.generated_at && (
            <span style={{ color: 'var(--c-475569)', fontSize: 10 }}>
              Generated: {new Date(data._meta.generated_at).toLocaleString()} · {data._meta.model}
              {data._meta.resource_count ? ` · ${data._meta.resource_count} resources` : ''}
              {data._meta.arc_machines ? ` + ${data._meta.arc_machines} Arc machines` : ''}
            </span>
          )}
          {data._meta?.data_confidence && (() => {
            const dc = data._meta.data_confidence;
            const color = dc.level === 'high' ? '#22c55e' : dc.level === 'medium' ? '#eab308' : '#ef4444';
            return (
              <span title={`Signals: ${dc.signals?.join(', ') || 'none'}\nGaps: ${dc.gaps?.join(', ') || 'none'}`}
                style={{ fontSize: 10, padding: '2px 8px', borderRadius: 9999, border: `1px solid ${color}`, color, cursor: 'help' }}>
                Data: {dc.level} ({dc.score}%)
              </span>
            );
          })()}
          <button onClick={() => runAnalysis(true)} style={{
            padding: '5px 14px', background: 'var(--c-1e293b)', color: 'var(--c-94a3b8)', border: '1px solid var(--c-334155)',
            borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>Re-run AI Analysis</button>
        </div>
      </div>
      <EstateContextBar data={data} />
      {renderReport(data, { onResourceClick: handleResourceClick })}
      {/* Resource Detail Drawer — triggered from affected resource chips */}
      {drawerResource && (
        <ResourceDetailDrawer
          resourceId={drawerResource.id || undefined}
          resourceName={drawerResource.name}
          onClose={() => setDrawerResource(null)}
        />
      )}
    </div>
    </ReportBoundary>
  );
}

// Export shared sub-components for module-specific renderers
export { ScoreGauge, SeverityBadge, ExpandableCard, FindingsList, RecommendationList, SEVERITY_COLORS };
