/**
 * ResourceDetailDrawer — Universal resource detail slide-over panel.
 *
 * Usage:
 *   <ResourceDetailDrawer
 *     resourceId="/subscriptions/.../providers/.../myResource"
 *     resourceName="myResource"
 *     onClose={() => setSelectedId(null)}
 *   />
 *
 * Fetches GET /api/resources/{resourceId}/detail and shows tabbed view:
 *   Overview | Security | BCDR | Advisor | AI Findings
 */
import React, { useEffect, useState, useCallback } from "react";
import { asText } from "../utils/safeText";

const BASE = "/api";

const SEVERITY_COLOR = {
  critical: "#ef4444",
  high:     "#f97316",
  medium:   "#eab308",
  low:      "#22c55e",
  info:     "#3b82f6",
};

function Badge({ text, color }) {
  return (
    <span style={{
      background: color + "22",
      color,
      border: `1px solid ${color}66`,
      borderRadius: 4,
      padding: "1px 7px",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
    }}>{text}</span>
  );
}

function Tab({ label, active, onClick, count }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
        color: active ? "#93c5fd" : "var(--c-64748b)",
        padding: "8px 14px",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: active ? 700 : 400,
        display: "flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span style={{
          background: active ? "#3b82f633" : "var(--c-1e293b)",
          color: active ? "#93c5fd" : "var(--c-94a3b8)",
          borderRadius: 9,
          padding: "1px 6px",
          fontSize: 11,
          fontWeight: 700,
        }}>{count}</span>
      )}
    </button>
  );
}

function KVRow({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--c-1e293b)" }}>
      <span style={{ color: "var(--c-64748b)", fontSize: 12, minWidth: 160, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "var(--c-e2e8f0)", fontSize: 12, wordBreak: "break-all" }}>{String(value)}</span>
    </div>
  );
}

function FindingCard({ finding, severityKey = "severity", portalUrl }) {
  const sev = (finding[severityKey] || "info").toLowerCase();
  const color = SEVERITY_COLOR[sev] || "var(--c-94a3b8)";
  return (
    <div style={{
      background: "var(--c-0f172a)",
      border: `1px solid ${color}44`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 8,
      padding: "10px 14px",
      marginBottom: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <Badge text={sev} color={color} />
        {(finding.category || finding.azure_service) && (
          <span style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 600 }}>{finding.category || finding.azure_service}</span>
        )}
        <span style={{ color: "var(--c-f1f5f9)", fontWeight: 600, fontSize: 13 }}>
          {finding.title || finding.name || asText(finding.description).slice(0, 60) || "Finding"}
        </span>
      </div>
      {finding.detail && (
        <p style={{ color: "var(--c-94a3b8)", fontSize: 12, margin: "4px 0" }}>{asText(finding.detail)}</p>
      )}
      {finding.description && finding.description !== finding.title && (
        <p style={{ color: "var(--c-94a3b8)", fontSize: 12, margin: "4px 0" }}>{asText(finding.description)}</p>
      )}
      {(finding.recommendation || finding.remediation) && (
        <p style={{ color: "#22c55e", fontSize: 12, margin: "4px 0" }}>
          ✅ {asText(finding.recommendation || finding.remediation)}
        </p>
      )}
      {(finding.portal_url || portalUrl) && (
        <a href={finding.portal_url || portalUrl} target="_blank" rel="noopener noreferrer"
           style={{ color: 'var(--c-60a5fa)', fontSize: 12, textDecoration: "none", fontWeight: 600 }}>
          Open in Azure Portal →
        </a>
      )}
    </div>
  );
}

function OverviewTab({ resource, metrics, metricsLoading, metricsError }) {
  if (!resource) return null;
  const r = resource;
  const scoreColor = r.final_score >= 75 ? "#22c55e" : r.final_score >= 50 ? "#eab308" : "#ef4444";
  const fmtPct = (v) => (v === null || v === undefined) ? "—" : `${Number(v).toFixed(1)}%`;
  return (
    <div>
      {/* Score hero */}
      <div style={{
        display: "flex", gap: 16, alignItems: "center",
        background: "var(--c-0f172a)", borderRadius: 10, padding: "14px 18px", marginBottom: 16,
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: scoreColor + "22", border: `2px solid ${scoreColor}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, fontWeight: 900, color: scoreColor,
        }}>{Math.round(r.final_score ?? 0)}</div>
        <div>
          <div style={{ color: "var(--c-f1f5f9)", fontWeight: 700, fontSize: 15 }}>{r.resource_name}</div>
          <div style={{ color: "var(--c-94a3b8)", fontSize: 12 }}>{r.resource_type}</div>
          <div style={{ color: "var(--c-64748b)", fontSize: 12 }}>{r.location} · {r.resource_group}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          {r.cost_current_month > 0 && (
            <div style={{ color: "var(--c-f1f5f9)", fontWeight: 700, fontSize: 16 }}>
              ${r.cost_current_month?.toFixed(2)}/mo
            </div>
          )}
          {r.score_label && (
            <Badge
              text={r.score_label?.value ?? r.score_label}
              color={scoreColor}
            />
          )}
        </div>
      </div>

      {/* Live metrics (fetched on demand) */}
      <div style={{ background: "var(--c-111827)", borderRadius: 8, padding: "12px 16px", marginBottom: 12 }}>
        <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8 }}>
          Live Utilization (30-day)
          {metricsLoading && <span style={{ color: "#3b82f6", fontSize: 10, fontWeight: 600 }}>· fetching live…</span>}
        </div>
        {metricsError && (
          <div style={{ color: "#f97316", fontSize: 12 }}>Could not load live metrics: {metricsError}</div>
        )}
        {!metricsError && !metricsLoading && metrics && (
          <>
            <KVRow label="Primary Utilization" value={fmtPct(metrics.primary_utilization)} />
            <KVRow label="Peak Utilization" value={fmtPct(metrics.peak_utilization)} />
            <KVRow label="CPU" value={fmtPct(metrics.cpu)} />
            <KVRow label="Memory" value={fmtPct(metrics.memory)} />
            <KVRow label="Disk" value={fmtPct(metrics.disk)} />
            <KVRow label="Network" value={fmtPct(metrics.network)} />
            <KVRow label="Activity Detected" value={metrics.has_any_activity ? "✅ Yes" : "— No"} />
          </>
        )}
        {!metricsError && !metricsLoading && !metrics && (
          <div style={{ color: "var(--c-64748b)", fontSize: 12 }}>No live metrics available for this resource type.</div>
        )}
      </div>

      {/* Key attributes */}
      <div style={{ background: "var(--c-111827)", borderRadius: 8, padding: "12px 16px", marginBottom: 12 }}>
        <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>Resource Details</div>
        <KVRow label="Resource ID" value={r.resource_id} />
        <KVRow label="Subscription" value={r.subscription_id} />
        <KVRow label="Resource Group" value={r.resource_group} />
        <KVRow label="Location" value={r.location} />
        <KVRow label="SKU" value={r.sku} />
        <KVRow label="Power State" value={r.power_state} />
        <KVRow label="Has Backup" value={r.has_backup ? "✅ Yes" : "❌ No"} />
        <KVRow label="Has Private Endpoint" value={r.has_private_endpoint ? "✅ Yes" : "⚠️ No"} />
        <KVRow label="Has Lock" value={r.has_lock ? "✅ Yes" : "—"} />
        <KVRow label="Is Orphan" value={r.is_orphan ? "⚠️ Yes — " + (r.orphan_reason || "no usage") : null} />
        {r.avg_cpu_pct !== null && r.avg_cpu_pct !== undefined && (
          <KVRow label="Avg CPU %" value={`${r.avg_cpu_pct?.toFixed(1)}%`} />
        )}
        {r.avg_memory_pct !== null && r.avg_memory_pct !== undefined && (
          <KVRow label="Avg Memory %" value={`${r.avg_memory_pct?.toFixed(1)}%`} />
        )}
        <KVRow label="Days Since Active" value={r.days_since_active} />
        <KVRow label="Recommendation" value={r.recommendation} />
      </div>
    </div>
  );
}

function SecurityTab({ gaps, defenderFindings, portalUrl }) {
  const allFindings = [...(gaps || []), ...(defenderFindings || [])];
  if (!allFindings.length) {
    return <p style={{ color: "var(--c-64748b)", fontSize: 13, padding: "20px 0" }}>No security findings for this resource.</p>;
  }
  return (
    <div>
      {allFindings.map((f, i) => (
        <FindingCard key={i} finding={f} severityKey="severity" portalUrl={portalUrl} />
      ))}
    </div>
  );
}

function BCDRTab({ assessment }) {
  if (!assessment) {
    return <p style={{ color: "var(--c-64748b)", fontSize: 13, padding: "20px 0" }}>No BCDR assessment available for this resource.</p>;
  }
  const a = assessment;
  return (
    <div>
      <div style={{ background: "var(--c-0f172a)", borderRadius: 8, padding: "12px 16px", marginBottom: 12 }}>
        <KVRow label="Criticality" value={a.sa_criticality} />
        <KVRow label="BCDR Strategy" value={a.sa_bcdr_strategy} />
        <KVRow label="DR Region" value={a.sa_dr_region_choice} />
        <KVRow label="DR Method" value={a.sa_dr_method} />
        <KVRow label="RPO Target" value={a.sa_rpo} />
        <KVRow label="RTO Target" value={a.sa_rto} />
        <KVRow label="Zone Context" value={a.sa_zr_context} />
        <KVRow label="Priority" value={a.sa_priority} />
        <KVRow label="Quick Win" value={a.sa_quick_win} />
        <KVRow label="Compliance" value={a.sa_compliance_note} />
        <KVRow label="Dependencies" value={a.sa_dependencies} />
        <KVRow label="Implementation Effort" value={a.sa_implementation_effort} />
        <KVRow label="Cost Impact" value={a.sa_cost_impact} />
      </div>
      {a.sa_bcdr_guidance_summary && (
        <div style={{ background: "var(--c-111827)", borderRadius: 8, padding: "12px 16px", marginBottom: 12 }}>
          <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>BCDR Guidance</div>
          <p style={{ color: "var(--c-cbd5e1)", fontSize: 13, margin: 0 }}>{a.sa_bcdr_guidance_summary}</p>
        </div>
      )}
      {a.sa_current_gap_summary && (
        <div style={{ background: "var(--c-1e1b2e)", border: "1px solid #f97316aa", borderRadius: 8, padding: "12px 16px" }}>
          <div style={{ color: "#fb923c", fontSize: 11, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>Current Gap</div>
          <p style={{ color: 'var(--c-fed7aa)', fontSize: 13, margin: 0 }}>{a.sa_current_gap_summary}</p>
        </div>
      )}
    </div>
  );
}

function AdvisorTab({ recommendations }) {
  if (!recommendations?.length) {
    return <p style={{ color: "var(--c-64748b)", fontSize: 13, padding: "20px 0" }}>No Advisor recommendations for this resource.</p>;
  }
  const CAT_COLOR = { cost: "#22c55e", security: "#ef4444", performance: "#38bdf8", highavailability: "#a78bfa", reliability: "#a78bfa", operationalexcellence: "#f59e0b" };
  return (
    <div>
      {recommendations.map((rec, i) => {
        const impact = (rec.impact || "").toLowerCase();
        const color = impact === "high" ? "#ef4444" : impact === "medium" ? "#f97316" : "#eab308";
        const cat = (rec.category || "").toLowerCase();
        const catColor = CAT_COLOR[cat] || "var(--c-64748b)";
        // Backend sends short_description as a string; older shape used an object — support both.
        const title = rec.problem
          || (typeof rec.short_description === "object" ? rec.short_description?.problem : rec.short_description)
          || rec.recommendation_text || "Advisor Recommendation";
        const detail = rec.solution
          || (typeof rec.short_description === "object" ? rec.short_description?.solution : "")
          || "";
        return (
          <div key={i} style={{
            background: "var(--c-0f172a)", border: `1px solid ${color}44`,
            borderLeft: `3px solid ${color}`, borderRadius: 8,
            padding: "12px 14px", marginBottom: 8,
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <Badge text={rec.impact || "—"} color={color} />
              {(rec.category_label || rec.category) && <Badge text={rec.category_label || rec.category} color={catColor} />}
              {rec.potential_savings > 0 && (
                <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 700 }}>~${Math.round(rec.potential_savings)}/mo savings</span>
              )}
            </div>
            <div style={{ color: "var(--c-f1f5f9)", fontWeight: 600, fontSize: 13, marginBottom: detail ? 4 : 0, lineHeight: 1.4 }}>{title}</div>
            {detail && <p style={{ color: "var(--c-cbd5e1)", fontSize: 12, margin: "2px 0 8px", lineHeight: 1.5 }}>✅ {detail}</p>}
            {rec.portal_url && (
              <a href={rec.portal_url} target="_blank" rel="noopener noreferrer"
                 style={{ color: 'var(--c-60a5fa)', fontSize: 12, textDecoration: "none", fontWeight: 600 }}>
                Open in Azure Portal →
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AIFindingsTab({ findings }) {
  if (!findings?.length) {
    return <p style={{ color: "var(--c-64748b)", fontSize: 13, padding: "20px 0" }}>No cached AI findings reference this resource.</p>;
  }
  const typeLabel = {
    ai_security_posture: "Security AI",
    ai_cloud_maturity: "Maturity AI",
    ai_resilience: "Resilience AI",
    ai_backup: "Backup AI",
  };
  return (
    <div>
      {findings.map((f, i) => (
        <div key={i} style={{
          background: "var(--c-0f172a)", border: "1px solid #3b82f644",
          borderLeft: "3px solid #3b82f6", borderRadius: 8,
          padding: "10px 14px", marginBottom: 8,
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <Badge text={typeLabel[f.analysis_type] || f.analysis_type} color="#3b82f6" />
            {f.severity && <Badge text={f.severity} color={SEVERITY_COLOR[f.severity?.toLowerCase()] || "var(--c-94a3b8)"} />}
            <span style={{ color: "var(--c-f1f5f9)", fontWeight: 600, fontSize: 13 }}>{f.title}</span>
          </div>
          {f.detail && <p style={{ color: "var(--c-94a3b8)", fontSize: 12, margin: "4px 0" }}>{f.detail}</p>}
          {f.recommendation && (
            <p style={{ color: "#22c55e", fontSize: 12, margin: "4px 0" }}>✅ {f.recommendation}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ResourceDetailDrawer({ resourceId, resourceName, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  // Resolved resource ID (from name lookup when only name is provided)
  const [resolvedId, setResolvedId] = useState(resourceId || null);
  // On-demand LIVE metrics (fetched only when the drawer opens — not on the
  // bulk dashboard build, which keeps the portal fast).
  const [metrics, setMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState(null);

  const load = useCallback(async (rid) => {
    if (!rid) return;
    setLoading(true);
    setError(null);
    try {
      const encodedId = rid.startsWith("/") ? rid.slice(1) : rid;
      const res = await fetch(`${BASE}/resources/${encodedId}/detail`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Resolve by name when no resourceId is provided
  useEffect(() => {
    if (resourceId) {
      setResolvedId(resourceId);
      return;
    }
    if (!resourceName) return;
    setLoading(true);
    fetch(`${BASE}/resources/by-name/${encodeURIComponent(resourceName)}`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(j => { setResolvedId(j.resource_id); })
      .catch(e => { setError(`Could not find resource "${resourceName}"`); setLoading(false); });
  }, [resourceId, resourceName]);

  useEffect(() => {
    if (resolvedId) load(resolvedId);
  }, [resolvedId, load]);

  // Fetch LIVE per-resource metrics on demand when the drawer opens.
  useEffect(() => {
    if (!resolvedId) return;
    let cancelled = false;
    setMetrics(null);
    setMetricsError(null);
    setMetricsLoading(true);
    const encodedId = resolvedId.startsWith("/") ? resolvedId.slice(1) : resolvedId;
    fetch(`${BASE}/resource/${encodeURIComponent(encodedId)}/metrics`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(j => { if (!cancelled) setMetrics(j); })
      .catch(e => { if (!cancelled) setMetricsError(String(e)); })
      .finally(() => { if (!cancelled) setMetricsLoading(false); });
    return () => { cancelled = true; };
  }, [resolvedId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const securityCount = (data?.security_gaps?.length || 0) + (data?.security_resource?.defender_findings?.length || 0);
  const advisorCount = data?.advisor_recommendations?.length || 0;
  const aiCount = data?.ai_findings?.length || 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          zIndex: 1000, backdropFilter: "blur(2px)",
        }}
      />

      {/* Drawer */}
      <div style={{
        position: "fixed", right: 0, top: 0, bottom: 0,
        width: "min(640px, 100vw)",
        background: "var(--c-0f172a)",
        borderLeft: "1px solid var(--c-1e293b)",
        zIndex: 1001,
        display: "flex", flexDirection: "column",
        overflowY: "auto",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid var(--c-1e293b)",
          background: "var(--c-111827)",
          position: "sticky", top: 0, zIndex: 10,
        }}>
          <div>
            <div style={{ color: "var(--c-f1f5f9)", fontWeight: 700, fontSize: 16 }}>
              {resourceName || data?.resource?.resource_name || "Resource Detail"}
            </div>
            <div style={{ color: "var(--c-64748b)", fontSize: 11 }}>
              {data?.resource?.resource_type || "Loading…"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "var(--c-1e293b)", border: "none", color: "var(--c-94a3b8)",
              borderRadius: 6, padding: "6px 12px", cursor: "pointer",
              fontSize: 14, fontWeight: 700,
            }}
          >✕</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", borderBottom: "1px solid var(--c-1e293b)",
          background: "var(--c-111827)", overflowX: "auto",
          position: "sticky", top: 57, zIndex: 10,
        }}>
          <Tab label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
          <Tab label="Security" active={activeTab === "security"} onClick={() => setActiveTab("security")} count={securityCount} />
          <Tab label="BCDR" active={activeTab === "bcdr"} onClick={() => setActiveTab("bcdr")} />
          <Tab label="Advisor" active={activeTab === "advisor"} onClick={() => setActiveTab("advisor")} count={advisorCount} />
          <Tab label="AI Findings" active={activeTab === "ai"} onClick={() => setActiveTab("ai")} count={aiCount} />
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", flex: 1 }}>
          {loading && (
            <div style={{ color: "var(--c-64748b)", textAlign: "center", padding: 40, fontSize: 14 }}>
              Loading resource details…
            </div>
          )}
          {error && (
            <div style={{ color: "#ef4444", background: "var(--c-1e0a0a)", borderRadius: 8, padding: 16, fontSize: 13 }}>
              Failed to load: {error}
            </div>
          )}
          {!loading && !error && data && (
            <>
              {activeTab === "overview" && <OverviewTab resource={data.resource} metrics={metrics} metricsLoading={metricsLoading} metricsError={metricsError} />}
              {activeTab === "security" && (
                <SecurityTab
                  gaps={data.security_gaps}
                  defenderFindings={data.security_resource?.defender_findings}
                  portalUrl={data.portal_url}
                />
              )}
              {activeTab === "bcdr" && <BCDRTab assessment={data.bcdr_assessment} />}
              {activeTab === "advisor" && <AdvisorTab recommendations={data.advisor_recommendations} />}
              {activeTab === "ai" && <AIFindingsTab findings={data.ai_findings} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}
