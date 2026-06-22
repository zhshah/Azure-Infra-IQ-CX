/**
 * AIInsightsDashboard — estate-wide AI intelligence surfaced on the home page.
 *
 * Aggregates the LAST-generated AI analysis for every category (Security,
 * Maturity, Monitoring, Governance, Advisor, Service Health, Quota, …) into a
 * grid of compact "mini-dashboard" cards, an Estate AI Health gauge, and a
 * cross-category AI Executive Briefing (a meta-synthesis over all the modules).
 *
 * Data: GET /api/ai/insights-dashboard (read-only, never triggers AI).
 *       GET /api/ai/executive-briefing?refresh= (one AI synthesis call).
 *       GET /api/ai/<category> (generates+caches a single category on demand).
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Brain, Sparkles, RefreshCw, ChevronRight, AlertTriangle, Loader2, Zap,
  Shield, Gauge, Rocket, ArrowLeftRight, DatabaseBackup, Activity, Scale,
  Lightbulb, HeartPulse, ShieldCheck, Wand2, ClipboardList,
} from 'lucide-react';
import { getJSON } from './mgmt/MgmtWidgets';

// Per-category presentation metadata (icon + accent). Keyed by backend `key`.
const MODULE_META = {
  security:       { Icon: Shield,         color: '#ef4444' },
  maturity:       { Icon: Gauge,          color: '#3b82f6' },
  innovation:     { Icon: Rocket,         color: '#a855f7' },
  migration:      { Icon: ArrowLeftRight, color: '#06b6d4' },
  backup:         { Icon: DatabaseBackup, color: '#22c55e' },
  resilience:     { Icon: ShieldCheck,    color: '#14b8a6' },
  monitoring:     { Icon: Activity,       color: '#f97316' },
  governance:     { Icon: Scale,          color: '#6366f1' },
  advisor:        { Icon: Lightbulb,      color: '#eab308' },
  service_health: { Icon: HeartPulse,     color: '#ec4899' },
  quota:          { Icon: Gauge,          color: '#f59e0b' },
};

const RISK_COLOR = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e', strong: '#22c55e', moderate: '#eab308', weak: '#ef4444' };
const riskColor = (rl) => RISK_COLOR[(rl || '').toLowerCase()] || '#64748b';
const scoreColor = (s) => (s == null ? '#64748b' : s >= 75 ? '#22c55e' : s >= 50 ? '#eab308' : s >= 25 ? '#f97316' : '#ef4444');

function timeAgo(iso) {
  if (!iso) return null;
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isNaN(d) || d < 0) return null;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function ScoreRing({ score, color, size = 48, stroke = 5 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        fontSize={size * 0.30} fontWeight="800" fill={score == null ? '#475569' : '#f1f5f9'}>
        {score == null ? '—' : score}
      </text>
    </svg>
  );
}

const panel = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14 };

// ── Per-category mini card ──────────────────────────────────────────────────
function ModuleCard({ m, busy, onOpen, onAnalyze }) {
  const meta = MODULE_META[m.key] || { Icon: Brain, color: '#38bdf8' };
  const Icon = meta.Icon;
  const when = timeAgo(m.generated_at);
  return (
    <div
      onClick={() => onOpen(m)}
      style={{
        ...panel, padding: 14, cursor: 'pointer', position: 'relative',
        borderLeft: `3px solid ${m.available ? meta.color : '#334155'}`,
        transition: 'transform .12s, border-color .12s', minHeight: 150,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = meta.color; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.borderLeft = `3px solid ${m.available ? meta.color : '#334155'}`; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: meta.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={16} style={{ color: meta.color }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</div>
          <div style={{ color: '#64748b', fontSize: 10.5 }}>{m.available ? (when ? `Updated ${when}` : 'Analyzed') : 'Not analyzed yet'}</div>
        </div>
        <ScoreRing score={m.available ? m.score : null} color={scoreColor(m.score)} size={44} />
      </div>

      {m.available ? (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {m.risk_level && (
              <span style={{ fontSize: 10, fontWeight: 700, color: riskColor(m.risk_level), background: riskColor(m.risk_level) + '1f', border: `1px solid ${riskColor(m.risk_level)}55`, borderRadius: 5, padding: '1px 7px', textTransform: 'capitalize' }}>{m.risk_level}</span>
            )}
            {m.category_count > 0 && <span style={{ fontSize: 10, color: '#94a3b8', background: '#1e293b', borderRadius: 5, padding: '1px 7px' }}>{m.category_count} categories</span>}
            {m.finding_count > 0 && <span style={{ fontSize: 10, color: '#94a3b8', background: '#1e293b', borderRadius: 5, padding: '1px 7px' }}>{m.finding_count} findings</span>}
          </div>
          {m.top_recommendation && (
            <div style={{ color: '#cbd5e1', fontSize: 11.5, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>▶ </span>{m.top_recommendation}
            </div>
          )}
          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 4, color: meta.color, fontSize: 11, fontWeight: 600 }}>
            View AI analysis <ChevronRight size={13} />
          </div>
        </>
      ) : (
        <>
          <div style={{ color: '#64748b', fontSize: 11.5, lineHeight: 1.45, flex: 1 }}>
            Run AI analysis to surface this category's risks, findings and prioritized recommendations.
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onAnalyze(m); }}
            disabled={busy}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: busy ? '#1e293b' : meta.color + '22', color: busy ? '#64748b' : meta.color, border: `1px solid ${busy ? '#334155' : meta.color + '66'}`, borderRadius: 7, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}
          >
            {busy ? <><Loader2 size={13} className="animate-spin" /> Analyzing…</> : <><Wand2 size={13} /> Analyze now</>}
          </button>
        </>
      )}
    </div>
  );
}

// ── Executive briefing sub-panel ────────────────────────────────────────────
function ExecutiveBriefing({ briefing, loading, error, canGenerate, analyzedCount, onGenerate }) {
  const roadmap = briefing?.unified_roadmap || {};
  const buckets = [
    { key: 'now', label: 'Now · 0–30 days', color: '#ef4444' },
    { key: 'next', label: 'Next · 30–90 days', color: '#eab308' },
    { key: 'later', label: 'Later · 90+ days', color: '#22c55e' },
  ];
  return (
    <div style={{ ...panel, padding: 16, background: 'linear-gradient(135deg,#0f172a,#131c33)', borderColor: '#312e81' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: '#6366f133', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Sparkles size={16} style={{ color: '#a5b4fc' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14 }}>AI Executive Briefing</div>
          <div style={{ color: '#94a3b8', fontSize: 11 }}>Cross-category synthesis — the highest-leverage actions across your whole estate</div>
        </div>
        <button
          onClick={onGenerate}
          disabled={loading || !canGenerate}
          title={!canGenerate ? 'Analyze at least 2 categories first' : ''}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: loading || !canGenerate ? '#1e293b' : '#6366f1', color: loading || !canGenerate ? '#64748b' : '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: loading || !canGenerate ? 'default' : 'pointer' }}
        >
          {loading ? <><Loader2 size={14} className="animate-spin" /> Synthesizing…</> : <><Brain size={14} /> {briefing ? 'Regenerate' : 'Generate'}</>}
        </button>
      </div>

      {error && <div style={{ color: '#fca5a5', fontSize: 12, background: '#7f1d1d33', border: '1px solid #7f1d1d', borderRadius: 8, padding: '8px 12px' }}>{error}</div>}

      {!briefing && !loading && !error && (
        <div style={{ color: '#94a3b8', fontSize: 12.5, padding: '6px 2px' }}>
          {canGenerate
            ? `Synthesize ${analyzedCount} analyzed categories into one CIO-level briefing with cross-cutting risks and a unified roadmap.`
            : 'Analyze at least 2 categories (cards below) to unlock the cross-category executive briefing.'}
        </div>
      )}

      {loading && !briefing && (
        <div style={{ color: '#a5b4fc', fontSize: 12.5, padding: '6px 2px' }}>Reasoning across all analyzed categories… this can take up to ~2 minutes.</div>
      )}

      {briefing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {briefing.headline && (
            <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={16} style={{ color: '#fbbf24', flexShrink: 0 }} /> {briefing.headline}
            </div>
          )}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {briefing.estate_health_score != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ScoreRing score={Math.round(briefing.estate_health_score)} color={scoreColor(briefing.estate_health_score)} size={46} />
                <div style={{ color: '#94a3b8', fontSize: 11 }}>Estate<br />Health</div>
              </div>
            )}
            {briefing.estate_posture && (
              <p style={{ color: '#cbd5e1', fontSize: 12.5, lineHeight: 1.6, margin: 0, flex: 1, minWidth: 240 }}>{briefing.estate_posture}</p>
            )}
          </div>

          {briefing.top_cross_cutting_risks?.length > 0 && (
            <div>
              <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Top cross-cutting risks</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {briefing.top_cross_cutting_risks.slice(0, 5).map((r, i) => (
                  <div key={i} style={{ background: '#0b1220', border: '1px solid #1e293b', borderLeft: `3px solid ${riskColor(r.severity)}`, borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: riskColor(r.severity), textTransform: 'uppercase' }}>{r.severity}</span>
                      <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 12.5 }}>{r.title}</span>
                      {(r.categories || []).map((c, j) => (
                        <span key={j} style={{ fontSize: 9.5, color: '#94a3b8', background: '#1e293b', borderRadius: 4, padding: '0 6px' }}>{c}</span>
                      ))}
                    </div>
                    {r.detail && <div style={{ color: '#94a3b8', fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>{r.detail}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(roadmap.now?.length || roadmap.next?.length || roadmap.later?.length) > 0 && (
            <div>
              <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <ClipboardList size={13} /> Unified roadmap
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
                {buckets.map((b) => (
                  <div key={b.key} style={{ background: '#0b1220', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ color: b.color, fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{b.label}</div>
                    <ul style={{ margin: 0, paddingLeft: 16, color: '#cbd5e1', fontSize: 11.5, lineHeight: 1.5 }}>
                      {(roadmap[b.key] || []).slice(0, 5).map((a, i) => <li key={i} style={{ marginBottom: 4 }}>{a}</li>)}
                      {!(roadmap[b.key] || []).length && <li style={{ color: '#475569', listStyle: 'none', marginLeft: -12 }}>—</li>}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {briefing.biggest_opportunity && (
            <div style={{ background: '#052e1633', border: '1px solid #16653455', borderRadius: 8, padding: '8px 12px', color: '#86efac', fontSize: 12 }}>
              <span style={{ fontWeight: 700 }}>Biggest opportunity: </span>{briefing.biggest_opportunity}
            </div>
          )}
          {briefing._meta?.generated_at && (
            <div style={{ color: '#475569', fontSize: 10.5 }}>
              Synthesized {timeAgo(briefing._meta.generated_at)} · {briefing._meta.model} · {briefing._meta.analyzed_count} categories
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main dashboard ──────────────────────────────────────────────────────────
export default function AIInsightsDashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyKeys, setBusyKeys] = useState({});           // per-card analyzing
  const [genAll, setGenAll] = useState(null);             // {done,total} or null
  const cancelRef = useRef(false);

  const [briefing, setBriefing] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await getJSON('/api/ai/insights-dashboard');
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Pull any already-cached executive briefing WITHOUT generating one (peek).
    getJSON('/api/ai/executive-briefing')
      .then((b) => { if (b && !b.error && (b.headline || b.estate_posture || b.top_cross_cutting_risks?.length)) setBriefing(b); })
      .catch(() => {});
  }, [load]);

  // Post-scan auto-warm (B) populates the core category cards server-side. While any
  // card is still missing, re-fetch the READ-ONLY summary so freshly-warmed cards
  // appear without a manual reload. Bounded (~5 min) and never triggers analysis.
  const warmPollsRef = useRef(0);
  useEffect(() => {
    const anyMissing = (data?.modules || []).some((m) => !m.available);
    if (!anyMissing || warmPollsRef.current >= 12) return undefined;
    const id = setTimeout(() => { warmPollsRef.current += 1; load(); }, 25000);
    return () => clearTimeout(id);
  }, [data, load]);

  const generateOne = useCallback(async (m) => {
    setBusyKeys((p) => ({ ...p, [m.key]: true }));
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 240000);
      const res = await fetch(m.endpoint, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.json();
      await load();
    } catch (e) {
      // leave the card as not-analyzed; surface nothing intrusive
    } finally {
      setBusyKeys((p) => { const n = { ...p }; delete n[m.key]; return n; });
    }
  }, [load]);

  const generateAll = useCallback(async () => {
    const missing = (data?.modules || []).filter((m) => !m.available);
    if (!missing.length) return;
    cancelRef.current = false;
    setGenAll({ done: 0, total: missing.length });
    for (let i = 0; i < missing.length; i++) {
      if (cancelRef.current) break;
      await generateOne(missing[i]);
      setGenAll({ done: i + 1, total: missing.length });
    }
    setGenAll(null);
  }, [data, generateOne]);

  const generateBriefing = useCallback(async () => {
    setBriefingLoading(true);
    setBriefingError(null);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 240000);
      const res = await fetch('/api/ai/executive-briefing?refresh=true', { signal: ctrl.signal });
      clearTimeout(t);
      const b = await res.json();
      if (b.error) setBriefingError(b.error);
      else setBriefing(b);
    } catch (e) {
      setBriefingError('Briefing timed out or failed. Try again once categories are analyzed.');
    } finally {
      setBriefingLoading(false);
    }
  }, []);

  const openModule = useCallback((m) => {
    onNavigate?.(m.view);
  }, [onNavigate]);

  const eh = data?.estate_health || {};
  const modules = data?.modules || [];
  const canBrief = (eh.analyzed_count || 0) >= 2;
  const missingCount = modules.filter((m) => !m.available).length;

  return (
    <div style={{ ...panel, padding: 18, background: 'linear-gradient(180deg,#0b1220,#0f172a)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Brain size={20} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ color: '#f8fafc', fontWeight: 800, fontSize: 17 }}>AI Insights — Estate-wide Intelligence</div>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>Latest AI analysis from every category, synthesized into one view</div>
        </div>

        {/* Estate AI health */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0b1220', border: '1px solid #1e293b', borderRadius: 12, padding: '8px 14px' }}>
          <ScoreRing score={eh.score ?? null} color={scoreColor(eh.score)} size={50} />
          <div>
            <div style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 700 }}>Estate AI Health</div>
            <div style={{ color: '#94a3b8', fontSize: 11 }}>{eh.analyzed_count || 0}/{eh.total_count || 0} categories analyzed</div>
            {eh.high_risk_count > 0 && (
              <div style={{ color: '#f97316', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <AlertTriangle size={11} /> {eh.high_risk_count} high-risk
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={generateAll}
            disabled={!!genAll || missingCount === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: genAll || missingCount === 0 ? '#1e293b' : '#6366f1', color: genAll || missingCount === 0 ? '#64748b' : '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: genAll || missingCount === 0 ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
          >
            {genAll ? <><Loader2 size={14} className="animate-spin" /> {genAll.done}/{genAll.total}…</> : <><Sparkles size={14} /> Analyze all{missingCount ? ` (${missingCount})` : ''}</>}
          </button>
          {genAll && (
            <button onClick={() => { cancelRef.current = true; }} style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', fontSize: 12, cursor: 'pointer' }}>Stop</button>
          )}
          <button onClick={() => { setLoading(true); load(); }} title="Refresh" style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: '#fca5a5', fontSize: 12, background: '#7f1d1d33', border: '1px solid #7f1d1d', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          Couldn't load AI insights: {error}
        </div>
      )}

      {/* Executive briefing */}
      <div style={{ marginBottom: 14 }}>
        <ExecutiveBriefing
          briefing={briefing}
          loading={briefingLoading}
          error={briefingError}
          canGenerate={canBrief}
          analyzedCount={eh.analyzed_count || 0}
          onGenerate={generateBriefing}
        />
      </div>

      {/* Category cards */}
      {loading && !data ? (
        <div style={{ color: '#64748b', fontSize: 13, padding: '20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={16} className="animate-spin" /> Loading AI insights…
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(255px,1fr))', gap: 12 }}>
          {modules.map((m) => (
            <ModuleCard key={m.key} m={m} busy={!!busyKeys[m.key]} onOpen={openModule} onAnalyze={generateOne} />
          ))}
        </div>
      )}
    </div>
  );
}
