/**
 * AIModuleReports.jsx — Module-specific AI analysis report renderers.
 * Each renderer knows the JSON schema returned by its backend endpoint
 * and presents findings, scores, and recommendations in a consistent dark UI.
 */
import React, { useState } from 'react';
import AIAnalysisPanel, { ScoreGauge, FindingsList, RecommendationList, ExpandableCard } from './AIAnalysisPanel';

// ═══════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════════

function SectionHeader({ icon, title, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, marginTop: 20 }}>
      <span style={{ width: 3, height: 16, borderRadius: 2, background: '#0078d4', display: 'inline-block' }} />
      <span style={{ color: 'var(--c-f1f5f9)', fontSize: 15, fontWeight: 700 }}>{title}</span>
      {count != null && <span style={{ color: 'var(--c-475569)', fontSize: 12 }}>({count})</span>}
    </div>
  );
}

function RoadmapPhase({ phase, color, data }) {
  if (!data) return null;
  return (
    <div style={{
      background: 'var(--c-0f172a)', border: `1px solid ${color}30`, borderRadius: 12,
      padding: '14px 16px', flex: 1, minWidth: 220,
    }}>
      <div style={{ color, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{phase}</div>
      {data.timeline && <div style={{ color: 'var(--c-64748b)', fontSize: 11, marginBottom: 8 }}>{data.timeline}</div>}
      {(data.actions || data.items || []).map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <span style={{ color, fontSize: 10, marginTop: 2 }}>•</span>
          <span style={{ color: 'var(--c-94a3b8)', fontSize: 12, lineHeight: 1.5 }}>{typeof a === 'string' ? a : a.title || a.description}</span>
        </div>
      ))}
      {data.estimated_cost && <div style={{ color, fontSize: 11, marginTop: 8, fontWeight: 600 }}>Est. {data.estimated_cost}</div>}
    </div>
  );
}

function MetricCard({ label, value, color = 'var(--c-e2e8f0)', sub }) {
  return (
    <div style={{
      background: 'var(--c-0f172a)', border: '1px solid var(--c-1e293b)', borderRadius: 10,
      padding: '12px 16px', minWidth: 120, flex: 1,
    }}>
      <div style={{ color: 'var(--c-475569)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 22, fontWeight: 800 }}>{value}</div>
      {sub && <div style={{ color: 'var(--c-475569)', fontSize: 10, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// 1. CLOUD MATURITY AI REPORT
// ═══════════════════════════════════════════════════════════════════════════════

function MaturityAIReport({ data, onResourceClick }) {
  const riskColor = (data.overall_label || '').includes('Native') ? '#22c55e' :
    (data.overall_label || '').includes('Smart') ? '#84cc16' :
    (data.overall_label || '').includes('Ready') ? '#eab308' : '#f97316';

  return (
    <div>
      {/* Executive Summary */}
      <div style={{
        background: 'linear-gradient(135deg, var(--c-0f172a), #1e1b4b30)', border: '1px solid #3b82f630',
        borderRadius: 16, padding: 20, marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <ScoreGauge score={data.overall_score} label="Maturity Score" size={110} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ color: riskColor, fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
              {data.overall_label}
            </div>
            {data.executive_summary && (
              <p style={{ color: 'var(--c-94a3b8)', fontSize: 13, lineHeight: 1.7 }}>{data.executive_summary}</p>
            )}
          </div>
        </div>
      </div>

      {/* Dimension Scores */}
      {data.dimension_scores?.length > 0 && (
        <>
          <SectionHeader icon="📊" title="Dimension Analysis" count={data.dimension_scores.length} />
          {data.dimension_scores.map((dim, i) => {
            const color = dim.score >= 80 ? '#22c55e' : dim.score >= 60 ? '#84cc16' : dim.score >= 40 ? '#eab308' : '#f97316';
            return (
              <ExpandableCard key={i} title={`${dim.name} — ${dim.score}% (${dim.grade || ''})`} severity={dim.grade === 'F' ? 'critical' : dim.grade === 'D' ? 'high' : dim.grade === 'C' ? 'medium' : 'low'}>
                {dim.findings?.map((f, j) => (
                  <div key={j} style={{ color: 'var(--c-94a3b8)', fontSize: 12, lineHeight: 1.6, marginTop: 6 }}>• {typeof f === 'string' ? f : f.title || f.detail}</div>
                ))}
                {dim.recommendations?.map((r, j) => (
                  <div key={j} style={{ color: 'var(--c-7dd3fc)', fontSize: 12, lineHeight: 1.6, marginTop: 4 }}>• {typeof r === 'string' ? r : r.title || r.description}</div>
                ))}
              </ExpandableCard>
            );
          })}
        </>
      )}

      {/* Cross-cutting Insights */}
      {data.cross_cutting_insights?.length > 0 && (
        <>
          <SectionHeader icon="🔗" title="Cross-Cutting Insights" count={data.cross_cutting_insights.length} />
          <FindingsList findings={data.cross_cutting_insights} onResourceClick={onResourceClick} />
        </>
      )}

      {/* Strategic Recommendations */}
      {data.strategic_recommendations?.length > 0 && (
        <>
          <SectionHeader icon="🎯" title="Strategic Recommendations" count={data.strategic_recommendations.length} />
          <RecommendationList recommendations={data.strategic_recommendations} />
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// 2. SECURITY AI REPORT
// ═══════════════════════════════════════════════════════════════════════════════

function SecurityAIReport({ data, onResourceClick }) {
  const riskColor = data.risk_level === 'Critical' ? '#ef4444' : data.risk_level === 'High' ? '#f97316' :
    data.risk_level === 'Medium' ? '#eab308' : '#22c55e';

  return (
    <div>
      {/* Top metrics */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <ScoreGauge score={data.posture_score} label="Security Posture" size={110} />
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <MetricCard label="Risk Level" value={data.risk_level} color={riskColor} />
          <MetricCard label="Critical Findings" value={data.critical_findings?.length ?? 0} color="#ef4444" />
          <MetricCard label="Compliance Gaps" value={data.compliance_gaps?.length ?? 0} color="#f97316" />
        </div>
      </div>

      {/* Critical Findings */}
      {data.critical_findings?.length > 0 && (
        <>
          <SectionHeader icon="🚨" title="Critical Findings" count={data.critical_findings.length} />
          <FindingsList findings={data.critical_findings} onResourceClick={onResourceClick} />
        </>
      )}

      {/* Category Analysis */}
      {data.category_analysis?.length > 0 && (
        <>
          <SectionHeader icon="📂" title="Category Analysis" count={data.category_analysis.length} />
          {data.category_analysis.map((cat, i) => (
            <ExpandableCard key={i} title={`${cat.category} — ${cat.score ?? ''}%`}>
              {cat.findings?.map((f, j) => (
                <div key={j} style={{ color: 'var(--c-94a3b8)', fontSize: 12, lineHeight: 1.6, marginTop: 6 }}>
                  • {typeof f === 'string' ? f : f.title || f.detail}
                </div>
              ))}
            </ExpandableCard>
          ))}
        </>
      )}

      {/* Compliance Gaps */}
      {data.compliance_gaps?.length > 0 && (
        <>
          <SectionHeader icon="📋" title="Compliance Gaps" count={data.compliance_gaps.length} />
          {data.compliance_gaps.map((g, i) => (
            <ExpandableCard key={i} title={`${g.framework}: ${g.gap}`}>
              <div style={{ color: 'var(--c-7dd3fc)', fontSize: 12, marginTop: 6 }}>Fix: {g.remediation}</div>
            </ExpandableCard>
          ))}
        </>
      )}

      {/* Recommendations */}
      {data.recommendations?.length > 0 && (
        <>
          <SectionHeader icon="🎯" title="Recommendations" count={data.recommendations.length} />
          <RecommendationList recommendations={data.recommendations} />
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. INNOVATION AI REPORT
// ═══════════════════════════════════════════════════════════════════════════════

function MonitoringAIReport({ data, onResourceClick }) {
  const riskColor = data.risk_level === 'Critical' ? '#ef4444' : data.risk_level === 'High' ? '#f97316' :
    data.risk_level === 'Medium' ? '#eab308' : '#22c55e';
  const cs = data.coverage_summary || {};
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <ScoreGauge score={data.monitoring_score} label="Monitoring Score" size={110} />
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <MetricCard label="Risk Level" value={data.risk_level || '—'} color={riskColor} />
          <MetricCard label="Agent Coverage" value={cs.agent_coverage_pct != null ? cs.agent_coverage_pct + '%' : '—'} color="#38bdf8" />
          <MetricCard label="Machines Uncovered" value={cs.machines_uncovered ?? '—'} color="#f97316" />
          <MetricCard label="Critical Alerts" value={cs.critical_alerts ?? '—'} color="#ef4444" />
        </div>
      </div>
      {data.executive_summary && (
        <div style={{ color: 'var(--c-cbd5e1)', fontSize: 13, lineHeight: 1.7, marginBottom: 18, padding: 14, background: 'var(--c-0f172a)', borderRadius: 10, border: '1px solid var(--c-1e293b)' }}>
          {data.executive_summary}
        </div>
      )}
      {data.categories?.length > 0 && (
        <>
          <SectionHeader icon="📡" title="Observability Categories" count={data.categories.length} />
          {data.categories.map((cat, i) => (
            <ExpandableCard key={i} title={`${cat.name} — ${cat.score ?? ''}%`}>
              {cat.assessment && <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>{cat.assessment}</div>}
              {cat.findings?.length > 0 && <FindingsList findings={cat.findings} onResourceClick={onResourceClick} />}
            </ExpandableCard>
          ))}
        </>
      )}
      {data.top_recommendations?.length > 0 && (
        <>
          <SectionHeader icon="🎯" title="Top Recommendations" count={data.top_recommendations.length} />
          <RecommendationList recommendations={data.top_recommendations} />
        </>
      )}
    </div>
  );
}


function InnovationAIReport({ data }) {
  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <ScoreGauge score={data.innovation_score} label="Innovation Score" size={110} />
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <MetricCard label="Maturity" value={data.maturity_label || '—'} color="#38bdf8" />
          <MetricCard label="Gaps Found" value={data.gap_analysis?.length ?? 0} color="#f97316" />
          <MetricCard label="Quick Wins" value={data.quick_wins?.length ?? 0} color="#22c55e" />
        </div>
      </div>

      {/* Gap Analysis */}
      {data.gap_analysis?.length > 0 && (
        <>
          <SectionHeader icon="🔍" title="Innovation Gap Analysis" count={data.gap_analysis.length} />
          {data.gap_analysis.map((g, i) => (
            <ExpandableCard key={i} title={g.category} severity={g.priority}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
                <div><span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>Current: </span><span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>{g.current_state}</span></div>
                <div><span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>Target: </span><span style={{ color: 'var(--c-38bdf8)', fontSize: 12 }}>{g.target_state}</span></div>
              </div>
              <p style={{ color: 'var(--c-94a3b8)', fontSize: 12, lineHeight: 1.6, marginTop: 6 }}>{g.gap_description}</p>
              {g.azure_services?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                  {g.azure_services.map((s, j) => (
                    <span key={j} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#0369a120', border: '1px solid #0369a150', color: 'var(--c-38bdf8)' }}>{s}</span>
                  ))}
                </div>
              )}
            </ExpandableCard>
          ))}
        </>
      )}

      {/* Quick Wins */}
      {data.quick_wins?.length > 0 && (
        <>
          <SectionHeader icon="⚡" title="Quick Wins" count={data.quick_wins.length} />
          {data.quick_wins.map((w, i) => (
            <div key={i} style={{ background: 'var(--c-0f172a)', border: '1px solid #16a34a30', borderRadius: 8, padding: '10px 14px', marginBottom: 6 }}>
              <div style={{ color: 'var(--c-e2e8f0)', fontSize: 13, fontWeight: 600 }}>{w.title}</div>
              <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, marginTop: 4 }}>{w.description}</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                {w.effort && <span style={{ fontSize: 10, color: 'var(--c-64748b)' }}>Effort: {w.effort}</span>}
                {w.impact && <span style={{ fontSize: 10, color: 'var(--c-64748b)' }}>Impact: {w.impact}</span>}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Adoption Roadmap */}
      {data.adoption_roadmap && (
        <>
          <SectionHeader icon="📅" title="Adoption Roadmap" />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <RoadmapPhase phase="Phase 1: Quick Wins" color="#22c55e" data={data.adoption_roadmap.phase1 || data.adoption_roadmap.phase_1_immediate} />
            <RoadmapPhase phase="Phase 2: Core Adoption" color="#eab308" data={data.adoption_roadmap.phase2 || data.adoption_roadmap.phase_2_short_term} />
            <RoadmapPhase phase="Phase 3: Advanced" color="#3b82f6" data={data.adoption_roadmap.phase3 || data.adoption_roadmap.phase_3_long_term} />
          </div>
        </>
      )}

      {/* Strategic Recommendations */}
      {data.strategic_recommendations?.length > 0 && (
        <>
          <SectionHeader icon="🎯" title="Strategic Recommendations" count={data.strategic_recommendations.length} />
          <RecommendationList recommendations={data.strategic_recommendations} />
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// 4. MIGRATION AI REPORT
// ═══════════════════════════════════════════════════════════════════════════════

function MigrationAIReport({ data }) {
  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <ScoreGauge score={data.migration_readiness_score} label="Migration Readiness" size={110} />
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <MetricCard label="Total Workloads" value={data.total_workloads ?? '—'} color="#38bdf8" />
          <MetricCard label="Migration Candidates" value={data.workload_analysis?.length ?? 0} color="#a78bfa" />
          {data.dc_migration_analysis?.arc_machines_count > 0 && (
            <MetricCard label="Arc Machines" value={data.dc_migration_analysis.arc_machines_count} color="#fb923c" sub="On-premises discovered" />
          )}
        </div>
      </div>

      {/* Executive Summary */}
      {data.executive_summary && (
        <div style={{ background: 'var(--c-0f172a)', border: '1px solid #3b82f630', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <p style={{ color: 'var(--c-94a3b8)', fontSize: 13, lineHeight: 1.7 }}>{data.executive_summary}</p>
        </div>
      )}

      {/* DC Migration Analysis (Arc) */}
      {data.dc_migration_analysis && (
        <>
          <SectionHeader icon="🏢" title="Data Center Migration Analysis" />
          <div style={{ background: 'var(--c-0f172a)', border: '1px solid #fb923c30', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              {data.dc_migration_analysis.arc_machines_count > 0 && (
                <MetricCard label="Arc Machines" value={data.dc_migration_analysis.arc_machines_count} color="#fb923c" />
              )}
              {data.dc_migration_analysis.sql_instances > 0 && (
                <MetricCard label="SQL Instances" value={data.dc_migration_analysis.sql_instances} color="#a78bfa" />
              )}
            </div>
            {data.dc_migration_analysis.migration_waves?.map((wave, i) => (
              <ExpandableCard key={i} title={wave.name || `Wave ${i + 1}`} severity={wave.priority || 'P' + (i + 1)}>
                {wave.workloads?.map((w, j) => (
                  <div key={j} style={{ color: 'var(--c-94a3b8)', fontSize: 12, lineHeight: 1.6, marginTop: 4 }}>• {typeof w === 'string' ? w : w.name || w.description}</div>
                ))}
                {wave.description && <p style={{ color: 'var(--c-94a3b8)', fontSize: 12, marginTop: 6 }}>{wave.description}</p>}
              </ExpandableCard>
            ))}
          </div>
        </>
      )}

      {/* Workload Analysis */}
      {data.workload_analysis?.length > 0 && (
        <>
          <SectionHeader icon="📋" title="Workload Analysis" count={data.workload_analysis.length} />
          {data.workload_analysis.map((w, i) => (
            <ExpandableCard key={i} title={w.workload_name || w.name} severity={w.complexity === 'High' ? 'high' : w.complexity === 'Medium' ? 'medium' : 'low'}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
                <div><span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>Current: </span><span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>{w.current_state}</span></div>
                <div><span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>Target: </span><span style={{ color: 'var(--c-38bdf8)', fontSize: 12 }}>{w.target_state}</span></div>
                {w.migration_approach && <div><span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>Approach: </span><span style={{ color: 'var(--c-a78bfa)', fontSize: 12 }}>{w.migration_approach}</span></div>}
                {w.estimated_effort && <div><span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>Effort: </span><span style={{ color: 'var(--c-94a3b8)', fontSize: 12 }}>{w.estimated_effort}</span></div>}
              </div>
              {w.risks?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {w.risks.map((r, j) => (
                    <div key={j} style={{ color: 'var(--c-fca5a5)', fontSize: 11, marginTop: 2 }}>△ {typeof r === 'string' ? r : r.title || r.description}</div>
                  ))}
                </div>
              )}
            </ExpandableCard>
          ))}
        </>
      )}

      {/* Strategic Recommendations */}
      {data.strategic_recommendations?.length > 0 && (
        <>
          <SectionHeader icon="🎯" title="Strategic Recommendations" count={data.strategic_recommendations.length} />
          <RecommendationList recommendations={data.strategic_recommendations} />
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// 5. BACKUP AI REPORT
// ═══════════════════════════════════════════════════════════════════════════════

// Normalise a backup finding (service_coverage.findings / configuration_issues)
// into the shape FindingsList expects, building affected_resources from any
// inline resource fields so the 360° drill-down works.
function _normBackupFinding(f) {
  if (typeof f === 'string') return { title: f };
  if (!f || typeof f !== 'object') return { title: String(f ?? '') };
  const inlineRes = (f.resource_id || f.resource_name)
    ? [{ resource_id: f.resource_id || '', resource_name: f.resource_name || '', resource_group: f.resource_group || '', subscription_id: f.subscription_id || '', resource_type: f.resource_type || '', cost_usd: f.estimated_monthly_cost || f.cost_usd || 0 }]
    : null;
  return {
    title: f.title || f.issue || f.resource_name || 'Backup gap',
    detail: f.detail || f.description || (f.title ? f.issue : ''),
    severity: f.severity,
    recommendation: f.recommendation,
    affected_resources: Array.isArray(f.affected_resources) ? f.affected_resources : (inlineRes || []),
    affected_count: f.affected_count,
    effort: f.effort,
    impact: f.impact,
  };
}

function BackupAIReport({ data, onResourceClick }) {
  // Tolerant to both the current backend schema (backup_health_score /
  // coverage_analysis / service_coverage / configuration_issues) and older keys.
  const score = data.backup_health_score ?? data.backup_score ?? 0;
  const cov = data.coverage_analysis || {};
  const coveragePct = cov.coverage_pct ?? data.coverage_pct;
  const services = data.service_coverage || data.service_analysis || [];
  const configIssues = (data.configuration_issues || data.critical_gaps || []).map(_normBackupFinding);
  const recs = data.recommendations || data.top_recommendations || [];
  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <ScoreGauge score={score} label="Backup Score" size={110} />
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <MetricCard label="Coverage" value={coveragePct != null ? `${coveragePct}%` : '—'} color={coveragePct >= 80 ? '#22c55e' : coveragePct >= 50 ? '#eab308' : '#ef4444'} />
          <MetricCard label="Unprotected" value={cov.unprotected ?? '—'} color="#ef4444" />
          <MetricCard label="Config Issues" value={configIssues.length} color="#f97316" />
          <MetricCard label="Services" value={services.length} color="#38bdf8" />
        </div>
      </div>

      {data.executive_summary && (
        <div style={{ color: 'var(--c-cbd5e1)', fontSize: 13, lineHeight: 1.7, marginBottom: 18, padding: 14, background: 'var(--c-0f172a)', borderRadius: 10, border: '1px solid var(--c-1e293b)' }}>
          {data.executive_summary}
        </div>
      )}

      {/* Configuration Issues & Gaps */}
      {configIssues.length > 0 && (
        <>
          <SectionHeader icon="🚨" title="Configuration Issues & Gaps" count={configIssues.length} />
          <FindingsList findings={configIssues} onResourceClick={onResourceClick} />
        </>
      )}

      {/* Service-by-Service Coverage */}
      {services.length > 0 && (
        <>
          <SectionHeader icon="📊" title="Service-by-Service Coverage" count={services.length} />
          {services.map((svc, i) => {
            const total = svc.total_resources ?? ((svc.protected ?? svc.protected_count ?? 0) + (svc.gaps ?? svc.unprotected_count ?? 0));
            const prot = svc.protected ?? svc.protected_count ?? 0;
            const pct = total > 0 ? Math.round(prot / total * 100) : 0;
            const svcFindings = (svc.findings || []).map(_normBackupFinding);
            return (
              <ExpandableCard key={i} title={`${svc.service_type} — ${pct}% protected (${prot}/${total})`}
                severity={pct < 30 ? 'critical' : pct < 60 ? 'high' : pct < 90 ? 'medium' : 'low'}>
                {svc.backup_solution && <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>{svc.backup_solution}</div>}
                {svcFindings.length > 0 && <FindingsList findings={svcFindings} onResourceClick={onResourceClick} />}
              </ExpandableCard>
            );
          })}
        </>
      )}

      {/* Recommendations */}
      {recs.length > 0 && (
        <>
          <SectionHeader icon="🎯" title="Recommendations" count={recs.length} />
          <RecommendationList recommendations={recs} />
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// 6. RESILIENCE AI REPORT
// ═══════════════════════════════════════════════════════════════════════════════

function ResilienceAIReport({ data, onResourceClick }) {
  const riskColor = data.risk_level === 'Critical' ? '#ef4444' : data.risk_level === 'High' ? '#f97316' :
    data.risk_level === 'Medium' ? '#eab308' : '#22c55e';

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <ScoreGauge score={data.resilience_score} label="Resilience Score" size={110} />
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <MetricCard label="Risk Level" value={data.risk_level || '—'} color={riskColor} />
          <MetricCard label="Findings" value={data.findings?.length ?? 0} color="#f97316" />
          <MetricCard label="Recommendations" value={data.recommendations?.length ?? 0} color="#38bdf8" />
        </div>
      </div>

      {/* Executive Summary */}
      {data.executive_summary && (
        <div style={{ background: 'var(--c-0f172a)', border: '1px solid #3b82f630', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <p style={{ color: 'var(--c-94a3b8)', fontSize: 13, lineHeight: 1.7 }}>{data.executive_summary}</p>
        </div>
      )}

      {/* Findings */}
      {data.findings?.length > 0 && (
        <>
          <SectionHeader icon="🔍" title="Resilience Findings" count={data.findings.length} />
          <FindingsList findings={data.findings} onResourceClick={onResourceClick} />
        </>
      )}

      {/* Recommendations */}
      {data.recommendations?.length > 0 && (
        <>
          <SectionHeader icon="🎯" title="Recommendations" count={data.recommendations.length} />
          <RecommendationList recommendations={data.recommendations} />
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// 7. AVS BCDR AI REPORT
// ═══════════════════════════════════════════════════════════════════════════════

function AVSBCDRAIReport({ data, onResourceClick }) {
  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {data.readiness_score != null && <ScoreGauge score={data.readiness_score} label="AVS DR Readiness" size={110} />}
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <MetricCard label="DR Strategy" value={data.recommended_strategy || '—'} color="#a78bfa" />
          <MetricCard label="Critical Gaps" value={data.critical_gaps?.length ?? 0} color="#ef4444" />
        </div>
      </div>

      {/* Executive Summary */}
      {data.executive_summary && (
        <div style={{ background: 'var(--c-0f172a)', border: '1px solid #a78bfa30', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <p style={{ color: 'var(--c-94a3b8)', fontSize: 13, lineHeight: 1.7 }}>{data.executive_summary}</p>
        </div>
      )}

      {/* Cross-Zonal DR */}
      {data.cross_zonal_dr && (
        <>
          <SectionHeader icon="🏢" title="Cross-Zonal DR (Qatar Central AV36p → AV64)" />
          <div style={{ background: 'var(--c-0f172a)', border: '1px solid #22c55e30', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <p style={{ color: 'var(--c-94a3b8)', fontSize: 13, lineHeight: 1.7 }}>{typeof data.cross_zonal_dr === 'string' ? data.cross_zonal_dr : data.cross_zonal_dr.description}</p>
            {data.cross_zonal_dr.steps?.map((s, i) => (
              <div key={i} style={{ color: 'var(--c-86efac)', fontSize: 12, marginTop: 4 }}>→ {typeof s === 'string' ? s : s.title}</div>
            ))}
          </div>
        </>
      )}

      {/* Cross-Regional DR */}
      {data.cross_regional_dr && (
        <>
          <SectionHeader icon="🌍" title="Cross-Regional DR Options" />
          <div style={{ background: 'var(--c-0f172a)', border: '1px solid #3b82f630', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <p style={{ color: 'var(--c-94a3b8)', fontSize: 13, lineHeight: 1.7 }}>{typeof data.cross_regional_dr === 'string' ? data.cross_regional_dr : data.cross_regional_dr.description}</p>
            {data.cross_regional_dr.options?.map((o, i) => (
              <ExpandableCard key={i} title={typeof o === 'string' ? o : o.name || o.title}>
                {o.description && <p style={{ color: 'var(--c-94a3b8)', fontSize: 12, marginTop: 6 }}>{o.description}</p>}
              </ExpandableCard>
            ))}
          </div>
        </>
      )}

      {/* Critical Gaps */}
      {data.critical_gaps?.length > 0 && (
        <>
          <SectionHeader icon="🚨" title="Critical Gaps" count={data.critical_gaps.length} />
          <FindingsList findings={data.critical_gaps} onResourceClick={onResourceClick} />
        </>
      )}

      {/* Recommendations */}
      {data.recommendations?.length > 0 && (
        <>
          <SectionHeader icon="🎯" title="AVS DR Recommendations" count={data.recommendations.length} />
          <RecommendationList recommendations={data.recommendations} />
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// 8. DEEP BCDR AI REPORT
// ═══════════════════════════════════════════════════════════════════════════════

function DeepBCDRAIReport({ data, onResourceClick }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {data.overall_bcdr_score != null && <ScoreGauge score={data.overall_bcdr_score} label="BCDR Score" size={110} />}
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <MetricCard label="Risk Level" value={data.risk_level || '—'} color={data.risk_level === 'Critical' ? '#ef4444' : data.risk_level === 'High' ? '#f97316' : '#eab308'} />
          <MetricCard label="Critical Gaps" value={data.critical_gaps?.length ?? 0} color="#ef4444" />
          <MetricCard label="Recommendations" value={data.recommendations?.length ?? 0} color="#38bdf8" />
        </div>
      </div>

      {data.executive_summary && typeof data.executive_summary === 'string' && (
        <div style={{ background: 'var(--c-0f172a)', border: '1px solid #3b82f630', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <p style={{ color: 'var(--c-94a3b8)', fontSize: 13, lineHeight: 1.7 }}>{data.executive_summary}</p>
        </div>
      )}

      {data.critical_gaps?.length > 0 && (
        <>
          <SectionHeader icon="🚨" title="Critical BCDR Gaps" count={data.critical_gaps.length} />
          <FindingsList findings={data.critical_gaps} onResourceClick={onResourceClick} />
        </>
      )}

      {/* Regional Analysis */}
      {data.regional_analysis && (
        <>
          <SectionHeader icon="🌐" title="Regional Analysis" />
          <div style={{ background: 'var(--c-0f172a)', border: '1px solid #3b82f630', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            {data.regional_analysis.primary_regions?.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>Primary Regions: </span>
                {data.regional_analysis.primary_regions.map((r, i) => (
                  <span key={i} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#0369a120', color: 'var(--c-38bdf8)', marginRight: 4 }}>{r}</span>
                ))}
              </div>
            )}
            {data.regional_analysis.recommended_dr_regions?.length > 0 && (
              <div>
                <span style={{ color: 'var(--c-64748b)', fontSize: 11 }}>Recommended DR: </span>
                {data.regional_analysis.recommended_dr_regions.map((r, i) => (
                  <span key={i} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#16a34a20', color: 'var(--c-86efac)', marginRight: 4 }}>{r}</span>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Implementation Roadmap */}
      {data.implementation_roadmap && (
        <>
          <SectionHeader icon="📅" title="Implementation Roadmap" />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <RoadmapPhase phase="Phase 1: Immediate" color="#ef4444" data={data.implementation_roadmap.phase_1_immediate} />
            <RoadmapPhase phase="Phase 2: Short-term" color="#f97316" data={data.implementation_roadmap.phase_2_short_term} />
            <RoadmapPhase phase="Phase 3: Long-term" color="#3b82f6" data={data.implementation_roadmap.phase_3_long_term} />
          </div>
        </>
      )}

      {data.recommendations?.length > 0 && (
        <>
          <SectionHeader icon="🎯" title="Recommendations" count={data.recommendations.length} />
          <RecommendationList recommendations={data.recommendations} />
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ASSEMBLED PANELS (wrap AIAnalysisPanel with module-specific renderer)
// ═══════════════════════════════════════════════════════════════════════════════

export function MaturityAIAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/maturity" title="Cloud Maturity AI Analysis" renderReport={(d, opts) => <MaturityAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function SecurityAIAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/security" title="Security AI Analysis" renderReport={(d, opts) => <SecurityAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

// Generic AI report for governance / advisor / identity style modules (uses data.score).
function GenericAIReport({ data, onResourceClick }) {
  const riskColor = data.risk_level === 'Critical' ? '#ef4444' : data.risk_level === 'High' ? '#f97316' :
    data.risk_level === 'Medium' ? '#eab308' : '#22c55e';
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <ScoreGauge score={data.score} label="Score" size={110} />
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          <MetricCard label="Risk Level" value={data.risk_level || '—'} color={riskColor} />
          <MetricCard label="Categories" value={data.categories?.length ?? 0} color="#38bdf8" />
          <MetricCard label="Recommendations" value={data.top_recommendations?.length ?? 0} color="#22c55e" />
        </div>
      </div>
      {data.executive_summary && (
        <div style={{ color: 'var(--c-cbd5e1)', fontSize: 13, lineHeight: 1.7, marginBottom: 18, padding: 14, background: 'var(--c-0f172a)', borderRadius: 10, border: '1px solid var(--c-1e293b)' }}>
          {data.executive_summary}
        </div>
      )}
      {data.categories?.length > 0 && (
        <>
          <SectionHeader icon="📂" title="Categories" count={data.categories.length} />
          {data.categories.map((cat, i) => (
            <ExpandableCard key={i} title={`${cat.name} — ${cat.score ?? ''}%`}>
              {cat.assessment && <div style={{ color: 'var(--c-94a3b8)', fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>{cat.assessment}</div>}
              {cat.findings?.length > 0 && <FindingsList findings={cat.findings} onResourceClick={onResourceClick} />}
            </ExpandableCard>
          ))}
        </>
      )}
      {data.top_recommendations?.length > 0 && (
        <>
          <SectionHeader icon="🎯" title="Top Recommendations" count={data.top_recommendations.length} />
          <RecommendationList recommendations={data.top_recommendations} />
        </>
      )}
    </div>
  );
}

export function MonitoringAIAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/monitoring" title="Monitoring AI Analysis" renderReport={(d, opts) => <MonitoringAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

// Reusable generic AI assessment panel — used by the AI Assessment modules
// (WAF, CAF, SQL Modernization, App Service, VM Performance, Entra, …).
export function GenericAIAnalysis({ endpoint, title }) {
  return <AIAnalysisPanel endpoint={endpoint} title={title} renderReport={(d, opts) => <GenericAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function GovernanceAIAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/governance" title="Governance &amp; Identity AI Analysis" renderReport={(d, opts) => <GenericAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function AdvisorAIAnalysis({ category }) {
  const scoped = category && category !== 'all';
  const endpoint = scoped ? `/api/ai/advisor?category=${encodeURIComponent(category)}` : '/api/ai/advisor';
  const title = scoped ? `Advisor AI Analysis — ${category}` : 'Advisor AI Analysis';
  return <AIAnalysisPanel endpoint={endpoint} title={title} renderReport={(d, opts) => <GenericAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function ServiceHealthAIAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/service-health" title="Service Health AI Analysis" renderReport={(d, opts) => <GenericAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function LifecycleAIAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/lifecycle" title="Retirements &amp; Deprecations AI Briefing" renderReport={(d, opts) => <GenericAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function QuotaAIAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/quota" title="Quota &amp; Capacity AI Analysis" renderReport={(d, opts) => <GenericAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function InnovationAIAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/innovation" title="Innovation AI Analysis" renderReport={(d, opts) => <InnovationAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function MigrationAIAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/migration" title="Migration AI Analysis" renderReport={(d, opts) => <MigrationAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function BackupAIAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/backup" title="Backup AI Analysis" renderReport={(d, opts) => <BackupAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function ResilienceAIAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/resilience" title="Resilience AI Analysis" renderReport={(d, opts) => <ResilienceAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function AVSBCDRAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/bcdr/avs" title="AVS DR AI Analysis" renderReport={(d, opts) => <AVSBCDRAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}

export function DeepBCDRAnalysis() {
  return <AIAnalysisPanel endpoint="/api/ai/bcdr/deep" title="Deep BCDR AI Analysis" renderReport={(d, opts) => <DeepBCDRAIReport data={d} onResourceClick={opts?.onResourceClick} />} />;
}
