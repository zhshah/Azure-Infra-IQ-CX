import React, { useState, useMemo, useEffect, useCallback } from "react";
import { ShieldCheck, Search, Bell, ClipboardList, Bug, DollarSign, BarChart3, MonitorCheck, Target, Lock, Database } from "lucide-react";
import { ResourceIconImg } from "../utils/resourceIcons";
import KPIDrillDrawer from "./KPIDrillDrawer";
import ResourceDetailDrawer from "./ResourceDetailDrawer";
import SearchableSelect from "./shared/SearchableSelect";

// ══════════════════════════════════════════════════════════════════════════════════
// CONSTANTS & CONFIG
// ══════════════════════════════════════════════════════════════════════════════════

const SEVERITY_COLOR = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "var(--c-64748b)",
  informational: "#38bdf8",
};

const SOURCE_LABEL = {
  internal: "Coverage Gap",
  defender: "Defender for Cloud",
  advisor: "Azure Advisor",
  arc_analysis: "Azure Arc",
  alert: "Security Alert",
  "onprem-scan": "On-Premises Scan",
};

const SOURCE_COLOR = {
  internal: "#38bdf8",
  defender: "#a78bfa",
  advisor: "#34d399",
  arc_analysis: "#fb923c",
  alert: "#ef4444",
  "onprem-scan": "#f472b6",
};

const GAP_TYPE_LABEL = {
  no_backup: "No Backup",
  no_private_endpoint: "No Private Endpoint",
  no_lock: "No Resource Lock",
  missing_tags: "Missing Tags",
  unmonitored: "Unmonitored",
  public_exposure: "Public Exposure",
};

const PLAN_STATUS_COLOR = {
  full: "#22c55e",
  partial: "#eab308",
  none: "#ef4444",
};

// ══════════════════════════════════════════════════════════════════════════════════
// SMALL UTILITY COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════════

function SeverityBadge({ severity }) {
  const color = SEVERITY_COLOR[severity] || "var(--c-64748b)";
  return (
    <span style={{
      background: `${color}20`, color,
      fontSize: 10, fontWeight: 700, padding: "2px 8px",
      borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.5px",
      border: `1px solid ${color}40`,
    }}>
      {severity}
    </span>
  );
}

function SourceBadge({ source }) {
  const color = SOURCE_COLOR[source] || "var(--c-64748b)";
  const label = SOURCE_LABEL[source] || source;
  return (
    <span style={{
      background: `${color}15`, color,
      fontSize: 9, fontWeight: 600, padding: "2px 6px",
      borderRadius: 12, border: `1px solid ${color}30`,
    }}>
      {label}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// SECURE SCORE GAUGE (Large)
// ══════════════════════════════════════════════════════════════════════════════════

function SecureScoreGauge({ score }) {
  if (!score || !score.percentage) return null;
  const pct = score.percentage;
  const color = pct >= 70 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444";
  const circumference = 2 * Math.PI * 52;
  const strokeDashoffset = circumference * (1 - pct / 100);
  return (
    <div style={{ textAlign: "center" }}>
      <svg width="130" height="130" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="52" fill="none" style={{ stroke: 'var(--c-1e293b)' }} strokeWidth="10" />
        <circle cx="60" cy="60" r="52" fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
          strokeLinecap="round" transform="rotate(-90 60 60)"
          style={{ transition: "stroke-dashoffset 1s ease" }} />
        <text x="60" y="55" textAnchor="middle" fill={color} fontSize="26" fontWeight="800">{Math.round(pct)}%</text>
        <text x="60" y="74" textAnchor="middle" style={{ fill: 'var(--c-64748b)' }} fontSize="9">Secure Score</text>
      </svg>
      <div style={{ color: "var(--c-94a3b8)", fontSize: 11, marginTop: 2 }}>
        {score.current_score}/{score.max_score} pts
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// KPI TILES
// ══════════════════════════════════════════════════════════════════════════════════

function KPITile({ icon: Icon, label, value, subtext, color = "#38bdf8", onClick }) {
  return (
    <div onClick={onClick} style={{
      background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 12,
      padding: "14px 16px", minWidth: 140, cursor: onClick ? "pointer" : "default",
      transition: "all 0.2s", borderTop: `3px solid ${color}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {Icon && typeof Icon !== "string" ? <Icon size={16} style={{ color }} /> : <span style={{ fontSize: 18 }}>{Icon}</span>}
        <span style={{ color: "var(--c-94a3b8)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
      </div>
      <div style={{ color: "var(--c-f1f5f9)", fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{value}</div>
      {subtext && <div style={{ color: "var(--c-64748b)", fontSize: 10, marginTop: 4 }}>{subtext}</div>}
    </div>
  );
}

function KPISection({ defenderData, allFindings, securityGaps, onDrill }) {
  const defenderAvailable = !!(defenderData?.defender);
  const secureScore = defenderData?.defender?.secure_score;
  const plans = defenderData?.defender?.defender_plans;
  const alerts = defenderData?.defender?.alerts || [];
  const compliance = defenderData?.defender?.compliance || [];
  const totalVulns = defenderData?.defender?.total_vulnerabilities || 0;

  const criticalAlerts = alerts.filter(a => a.severity === "high").length;
  const totalRisk = securityGaps.reduce((s, g) => s + (g.monthly_risk_usd || 0), 0);
  const complianceAvg = compliance.length > 0
    ? Math.round(compliance.reduce((s, c) => s + (c.compliance_pct || 0), 0) / compliance.length)
    : null;

  return (
    <div>
      {!defenderAvailable && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
          borderRadius: 10, border: "1px solid #eab30860", background: "#eab30810",
          marginBottom: 16,
        }}>
          <ShieldCheck size={18} color="#eab308" />
          <div style={{ flex: 1 }}>
            <div style={{ color: 'var(--c-fbbf24)', fontWeight: 700, fontSize: 13 }}>Microsoft Defender for Cloud Not Configured</div>
            <div style={{ color: "var(--c-94a3b8)", fontSize: 12, marginTop: 2 }}>
              Enable Defender for Cloud to unlock Secure Score, Alerts, Plan Coverage, Compliance, and Vulnerability data.
            </div>
          </div>
          <a
            href="https://portal.azure.com/#blade/Microsoft_Azure_Security/SecurityMenuBlade/0"
            target="_blank" rel="noopener noreferrer"
            style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: "#eab308", color: "#000", textDecoration: "none", whiteSpace: "nowrap",
            }}
          >Enable Defender ↗</a>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 12, marginBottom: 20 }}>
        <KPITile icon={ShieldCheck} label="Secure Score"
          value={secureScore ? `${Math.round(secureScore.percentage)}%` : (defenderAvailable ? "0%" : "—")}
          subtext={secureScore ? `${secureScore.current_score}/${secureScore.max_score} pts` : (defenderAvailable ? "" : "Enable Defender")}
          color={secureScore && secureScore.percentage >= 70 ? "#22c55e" : defenderAvailable ? "#eab308" : "var(--c-64748b)"}
          onClick={() => secureScore && onDrill && onDrill("secure-score", secureScore)} />
        <KPITile icon={Search} label="Total Findings" value={allFindings.length}
          subtext={`${allFindings.filter(f => f.severity === "high" || f.severity === "critical").length} high/critical`}
          color="#f97316"
          onClick={() => onDrill && onDrill("findings", allFindings)} />
        <KPITile icon={Bell} label="Active Alerts"
          value={defenderAvailable ? alerts.length : "—"}
          subtext={defenderAvailable ? (criticalAlerts > 0 ? `${criticalAlerts} high severity` : "No critical") : "Enable Defender"}
          color={!defenderAvailable ? "var(--c-64748b)" : criticalAlerts > 0 ? "#ef4444" : "#22c55e"}
          onClick={() => defenderAvailable && onDrill && onDrill("alerts", alerts)} />
        <KPITile icon={ShieldCheck} label="Plan Coverage"
          value={plans ? `${plans.overall_coverage_pct}%` : (defenderAvailable ? "0%" : "—")}
          subtext={plans ? `${plans.fully_enabled}/${plans.total_plans} plans enabled` : (defenderAvailable ? "" : "Enable Defender")}
          color={!defenderAvailable ? "var(--c-64748b)" : plans && plans.overall_coverage_pct >= 80 ? "#22c55e" : "#eab308"}
          onClick={() => plans && onDrill && onDrill("plans", plans?.plan_details || [])} />
        <KPITile icon={ClipboardList} label="Compliance"
          value={complianceAvg !== null ? `${complianceAvg}%` : (defenderAvailable ? "—" : "—")}
          subtext={compliance.length > 0 ? `${compliance.length} standards` : (defenderAvailable ? "No standards configured" : "Enable Defender")}
          color={!defenderAvailable ? "var(--c-64748b)" : complianceAvg && complianceAvg >= 70 ? "#22c55e" : "#eab308"}
          onClick={() => compliance.length > 0 && onDrill && onDrill("compliance", compliance)} />
        <KPITile icon={Bug} label="Vulnerabilities"
          value={defenderAvailable ? totalVulns : "—"}
          subtext={defenderAvailable ? "CVEs on servers/containers" : "Enable Defender"}
          color={!defenderAvailable ? "var(--c-64748b)" : totalVulns > 50 ? "#ef4444" : totalVulns > 10 ? "#eab308" : "#22c55e"} />
        {totalRisk > 0 && (
          <KPITile icon={DollarSign} label="Monthly Risk" value={`$${totalRisk.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            subtext="Estimated exposure" color="#ef4444"
            onClick={() => onDrill && onDrill("risk", securityGaps.filter(g => g.monthly_risk_usd > 0))} />
        )}
        <KPITile icon={BarChart3} label="Resources Assessed"
          value={new Set(allFindings.map(f => f.resource_id)).size}
          subtext="Unique resources with findings" color="var(--c-64748b)" />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// CHARTS — SVG-based (no dependencies)
// ══════════════════════════════════════════════════════════════════════════════════

function DonutChart({ data, title, size = 140 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const radius = 45, center = 60;
  let cumulative = 0;
  const slices = data.filter(d => d.value > 0).map((d) => {
    const startAngle = (cumulative / total) * 360;
    cumulative += d.value;
    const endAngle = (cumulative / total) * 360;
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const startRad = ((startAngle - 90) * Math.PI) / 180;
    const endRad = ((endAngle - 90) * Math.PI) / 180;
    return {
      ...d,
      path: `M ${center + radius * Math.cos(startRad)} ${center + radius * Math.sin(startRad)}
             A ${radius} ${radius} 0 ${largeArc} 1 ${center + radius * Math.cos(endRad)} ${center + radius * Math.sin(endRad)}`,
    };
  });
  return (
    <div style={{ textAlign: "center" }}>
      {title && <div style={{ color: "var(--c-94a3b8)", fontSize: 11, fontWeight: 600, marginBottom: 6 }}>{title}</div>}
      <svg width={size} height={size} viewBox="0 0 120 120">
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill="none" stroke={s.color} strokeWidth="16" strokeLinecap="butt" />
        ))}
        <text x="60" y="58" textAnchor="middle" style={{ fill: 'var(--c-f1f5f9)' }} fontSize="18" fontWeight="800">{total}</text>
        <text x="60" y="72" textAnchor="middle" style={{ fill: 'var(--c-64748b)' }} fontSize="8">total</text>
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 6 }}>
        {data.filter(d => d.value > 0).map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--c-94a3b8)" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.color }} />
            <span>{d.name} ({d.value})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HBarChart({ data, title, maxItems = 8, barColor = "#38bdf8" }) {
  if (!data || !data.length) return null;
  const items = data.slice(0, maxItems);
  const maxVal = Math.max(...items.map(d => d.value), 1);
  return (
    <div>
      {title && <div style={{ color: "var(--c-94a3b8)", fontSize: 11, fontWeight: 600, marginBottom: 10 }}>{title}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--c-94a3b8)", fontSize: 10, width: 90, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", textAlign: "right" }}>
              {d.name}
            </span>
            <div style={{ flex: 1, background: "var(--c-1e293b)", borderRadius: 3, height: 14, overflow: "hidden" }}>
              <div style={{
                background: d.color || barColor, height: "100%",
                width: `${(d.value / maxVal) * 100}%`, borderRadius: 3,
                transition: "width 0.5s",
              }} />
            </div>
            <span style={{ color: "var(--c-64748b)", fontSize: 10, width: 28, textAlign: "right" }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ControlsProgressChart({ data, title }) {
  if (!data || !data.length) return null;
  return (
    <div>
      {title && <div style={{ color: "var(--c-94a3b8)", fontSize: 11, fontWeight: 600, marginBottom: 10 }}>{title}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {data.slice(0, 8).map((d, i) => {
          const total = d.healthy + d.unhealthy;
          const healthyPct = total > 0 ? (d.healthy / total * 100) : 0;
          return (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{ color: "var(--c-94a3b8)", fontSize: 10, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.name}
                </span>
                <span style={{ color: "var(--c-64748b)", fontSize: 9 }}>{Math.round(healthyPct)}%</span>
              </div>
              <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--c-1e293b)" }}>
                <div style={{ width: `${healthyPct}%`, background: "#22c55e", transition: "width 0.5s" }} />
                <div style={{ width: `${100 - healthyPct}%`, background: "#ef4444" }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// DEFENDER PLAN STATUS SECTION
// ══════════════════════════════════════════════════════════════════════════════════

function DefenderPlansSection({ plans }) {
  if (!plans || !plans.plans || !plans.plans.length) return null;
  return (
    <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ color: "var(--c-f1f5f9)", fontSize: 14, fontWeight: 700, margin: 0 }}>
          Defender Plan Coverage
        </h3>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: "#22c55e", fontSize: 10 }}>● Enabled ({plans.fully_enabled})</span>
          <span style={{ color: "#eab308", fontSize: 10 }}>● Partial ({plans.partially_enabled})</span>
          <span style={{ color: "#ef4444", fontSize: 10 }}>● Disabled ({plans.not_enabled})</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
        {plans.plans.map((p, i) => {
          const statusColor = PLAN_STATUS_COLOR[p.status] || "var(--c-64748b)";
          return (
            <div key={i} style={{
              background: "var(--c-0d1117)", border: `1px solid ${statusColor}30`,
              borderRadius: 8, padding: "10px 12px", borderLeft: `3px solid ${statusColor}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--c-e2e8f0)", fontSize: 11, fontWeight: 600 }}>{p.plan_name}</span>
                <span style={{
                  background: `${statusColor}20`, color: statusColor,
                  fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10,
                }}>
                  {p.status === "full" ? "ENABLED" : p.status === "partial" ? "PARTIAL" : "DISABLED"}
                </span>
              </div>
              <div style={{ marginTop: 6 }}>
                <div style={{ background: "var(--c-1e293b)", borderRadius: 3, height: 4, overflow: "hidden" }}>
                  <div style={{ background: statusColor, height: "100%", width: `${p.coverage_pct}%` }} />
                </div>
                <div style={{ color: "var(--c-475569)", fontSize: 9, marginTop: 3 }}>
                  {p.enabled_count}/{p.total_subscriptions} subscriptions
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// SECURITY ALERTS SECTION
// ══════════════════════════════════════════════════════════════════════════════════

function SecurityAlertsSection({ alerts }) {
  const [expanded, setExpanded] = useState(false);
  if (!alerts || !alerts.length) return (
    <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 12, padding: 24, textAlign: "center" }}>
      <span style={{ color: "#22c55e", fontSize: 13 }}>✓ No active security alerts</span>
    </div>
  );
  const shown = expanded ? alerts : alerts.slice(0, 5);
  return (
    <div style={{ background: "var(--c-0f172a)", border: "1px solid #ef444430", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ color: "var(--c-f1f5f9)", fontSize: 14, fontWeight: 700, margin: 0 }}>
          Active Security Alerts ({alerts.length})
        </h3>
        {alerts.length > 5 && (
          <button onClick={() => setExpanded(!expanded)} style={{
            background: "none", border: "1px solid var(--c-334155)", color: "var(--c-94a3b8)",
            borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 10,
          }}>
            {expanded ? "Show Less" : `Show All (${alerts.length})`}
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map((alert, i) => {
          const color = SEVERITY_COLOR[alert.severity] || "var(--c-64748b)";
          return (
            <div key={i} style={{
              background: "var(--c-0d1117)", border: `1px solid ${color}30`, borderRadius: 8,
              padding: "10px 12px", borderLeft: `3px solid ${color}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <SeverityBadge severity={alert.severity} />
                <span style={{ color: "var(--c-f1f5f9)", fontSize: 12, fontWeight: 600 }}>{alert.title}</span>
              </div>
              <div style={{ color: "var(--c-94a3b8)", fontSize: 11, marginTop: 4 }}>
                {alert.description?.substring(0, 150)}{alert.description?.length > 150 ? "…" : ""}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                {alert.compromised_entity && (
                  <span style={{ color: "var(--c-64748b)", fontSize: 10 }}>Entity: <span style={{ color: "var(--c-94a3b8)" }}>{alert.compromised_entity}</span></span>
                )}
                {alert.intent && (
                  <span style={{ color: "var(--c-64748b)", fontSize: 10 }}>Intent: <span style={{ color: "var(--c-94a3b8)" }}>{alert.intent}</span></span>
                )}
                {alert.tactics && (
                  <span style={{ color: "var(--c-64748b)", fontSize: 10 }}>Tactics: <span style={{ color: "var(--c-94a3b8)" }}>{alert.tactics}</span></span>
                )}
                {alert.start_time && (
                  <span style={{ color: "var(--c-475569)", fontSize: 9 }}>{new Date(alert.start_time).toLocaleDateString()}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// COMPLIANCE SECTION
// ══════════════════════════════════════════════════════════════════════════════════

function ComplianceSection({ compliance }) {
  if (!compliance || !compliance.length) return (
    <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 12, padding: 24, textAlign: "center" }}>
      <span style={{ color: "var(--c-64748b)", fontSize: 12 }}>No regulatory compliance standards configured</span>
    </div>
  );
  return (
    <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 12, padding: 16 }}>
      <h3 style={{ color: "var(--c-f1f5f9)", fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>
        Regulatory Compliance
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
        {compliance.map((c, i) => {
          const pct = c.compliance_pct || 0;
          const color = pct >= 80 ? "#22c55e" : pct >= 60 ? "#eab308" : "#ef4444";
          return (
            <div key={i} style={{ background: "var(--c-0d1117)", border: "1px solid var(--c-1e293b)", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ color: "var(--c-e2e8f0)", fontSize: 11, fontWeight: 600 }}>{c.standard}</span>
                <span style={{ color, fontSize: 12, fontWeight: 700 }}>{pct}%</span>
              </div>
              <div style={{ background: "var(--c-1e293b)", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 4 }}>
                <div style={{ background: color, height: "100%", width: `${pct}%`, transition: "width 0.5s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--c-64748b)" }}>
                <span>✓ {c.passed_controls} passed</span>
                <span>✗ {c.failed_controls} failed</span>
                <span>⊘ {c.skipped_controls} skipped</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// CHARTS DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════════

function ChartsDashboard({ charts }) {
  if (!charts) return null;
  return (
    <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 12, padding: 16 }}>
      <h3 style={{ color: "var(--c-f1f5f9)", fontSize: 14, fontWeight: 700, margin: "0 0 16px" }}>
        Security Analytics
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
        <div style={{ background: "var(--c-0d1117)", borderRadius: 10, padding: 16, border: "1px solid var(--c-1e293b)" }}>
          <DonutChart data={charts.severity_distribution || []} title="Findings by Severity" />
        </div>
        <div style={{ background: "var(--c-0d1117)", borderRadius: 10, padding: 16, border: "1px solid var(--c-1e293b)" }}>
          <HBarChart data={charts.category_breakdown || []} title="Findings by Category" barColor="#a78bfa" />
        </div>
        <div style={{ background: "var(--c-0d1117)", borderRadius: 10, padding: 16, border: "1px solid var(--c-1e293b)" }}>
          <HBarChart data={charts.resource_type_breakdown || []} title="Findings by Resource Type" barColor="#38bdf8" />
        </div>
        <div style={{ background: "var(--c-0d1117)", borderRadius: 10, padding: 16, border: "1px solid var(--c-1e293b)" }}>
          <HBarChart data={charts.top_affected_resources || []} title="Most Affected Resources" barColor="#f97316" />
        </div>
        {charts.alerts_by_severity && charts.alerts_by_severity.some(d => d.value > 0) && (
          <div style={{ background: "var(--c-0d1117)", borderRadius: 10, padding: 16, border: "1px solid var(--c-1e293b)" }}>
            <DonutChart data={charts.alerts_by_severity} title="Alerts by Severity" />
          </div>
        )}
        {charts.controls_progress && charts.controls_progress.length > 0 && (
          <div style={{ background: "var(--c-0d1117)", borderRadius: 10, padding: 16, border: "1px solid var(--c-1e293b)" }}>
            <ControlsProgressChart data={charts.controls_progress} title="Score Controls Progress" />
          </div>
        )}
        {charts.implementation_effort && charts.implementation_effort.length > 0 && (
          <div style={{ background: "var(--c-0d1117)", borderRadius: 10, padding: 16, border: "1px solid var(--c-1e293b)" }}>
            <HBarChart data={charts.implementation_effort} title="By Implementation Effort" barColor="#34d399" />
          </div>
        )}
        {charts.defender_plan_coverage && charts.defender_plan_coverage.length > 0 && (
          <div style={{ background: "var(--c-0d1117)", borderRadius: 10, padding: 16, border: "1px solid var(--c-1e293b)" }}>
            <HBarChart
              data={charts.defender_plan_coverage.map(p => ({
                name: p.name, value: p.coverage,
                color: PLAN_STATUS_COLOR[p.status] || "#38bdf8",
              }))}
              title="Defender Plan Coverage %"
              maxItems={12}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// SCORE CONTROLS PANEL
// ══════════════════════════════════════════════════════════════════════════════════

function ScoreControlsPanel({ controls }) {
  if (!controls || !controls.length) return (
    <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 12, padding: 24, textAlign: "center" }}>
      <span style={{ color: "#22c55e", fontSize: 12 }}>✓ All score controls are healthy</span>
    </div>
  );
  return (
    <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 12, padding: 16 }}>
      <h3 style={{ color: "var(--c-f1f5f9)", fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>
        Secure Score Improvement Actions
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
        {controls.slice(0, 15).map((c, i) => {
          const pct = c.maxScore > 0 ? (c.currentScore / c.maxScore * 100) : 0;
          const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444";
          return (
            <div key={i} style={{ background: "var(--c-0d1117)", border: "1px solid var(--c-1e293b)", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ color: "var(--c-e2e8f0)", fontSize: 11, fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.controlName}
                </span>
                <span style={{ color, fontSize: 11, fontWeight: 700 }}>{Math.round(pct)}%</span>
              </div>
              <div style={{ background: "var(--c-1e293b)", borderRadius: 4, height: 4, overflow: "hidden" }}>
                <div style={{ background: color, height: "100%", width: `${pct}%`, transition: "width 0.5s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ color: "#ef4444", fontSize: 9 }}>✗ {c.unhealthyCount} unhealthy</span>
                <span style={{ color: "#22c55e", fontSize: 9 }}>✓ {c.healthyCount} healthy</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// TABLE VIEW
// ══════════════════════════════════════════════════════════════════════════════════

function SecurityTable({ findings, onSort, sortBy, sortDir }) {
  const columns = [
    { key: "severity", label: "Severity", width: "80px" },
    { key: "title", label: "Finding", width: "auto" },
    { key: "resource_name", label: "Resource", width: "160px" },
    { key: "resource_type", label: "Type", width: "120px" },
    { key: "resource_group", label: "Resource Group", width: "130px" },
    { key: "source", label: "Source", width: "110px" },
    { key: "category", label: "Category", width: "110px" },
  ];
  return (
    <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--c-1e293b)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "var(--c-0a0f1a)" }}>
            {columns.map(col => (
              <th key={col.key} onClick={() => onSort(col.key)} style={{
                padding: "8px 10px", color: sortBy === col.key ? "#38bdf8" : "var(--c-64748b)",
                fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
                borderBottom: "1px solid var(--c-1e293b)", textAlign: "left", width: col.width,
              }}>
                {col.label} {sortBy === col.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {findings.map((f, i) => (
            <tr key={f.id || f.resource_id + f.title + i}
                onClick={() => { if (f.resource_id) { setSelectedResourceId(f.resource_id); setSelectedResourceName(f.resource_name); } }}
                style={{ background: i % 2 === 0 ? "var(--c-0f172a)" : "var(--c-0d1117)", cursor: f.resource_id ? "pointer" : "default" }}>
              <td style={{ padding: "6px 10px" }}><SeverityBadge severity={f.severity} /></td>
              <td style={{ padding: "6px 10px", color: "var(--c-e2e8f0)", fontWeight: 500 }}>
                <div style={{ fontSize: 11 }}>{f.title}</div>
                {f.description && (
                  <div style={{ color: "var(--c-475569)", fontSize: 9, marginTop: 2, maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.description}
                  </div>
                )}
              </td>
              <td style={{ padding: "6px 10px", color: f.resource_id ? "#93c5fd" : "var(--c-94a3b8)", fontSize: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <ResourceIconImg resourceType={f.resource_type} size={14} />
                  {f.resource_name}
                  {f.resource_id && <span style={{ color: "#3b82f6", fontSize: 10, marginLeft: 2 }}>↗</span>}
                </div>
              </td>
              <td style={{ padding: "6px 10px", color: "var(--c-64748b)", fontSize: 10 }}>{(f.resource_type || "").split("/").pop()}</td>
              <td style={{ padding: "6px 10px", color: "var(--c-64748b)", fontSize: 10 }}>{f.resource_group}</td>
              <td style={{ padding: "6px 10px" }}><SourceBadge source={f.source} /></td>
              <td style={{ padding: "6px 10px", color: "var(--c-64748b)", fontSize: 10 }}>{f.category || f.gap_type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// CARD VIEW
// ══════════════════════════════════════════════════════════════════════════════════

function GapCard({ finding, onSelect }) {
  const [open, setOpen] = useState(false);
  const color = SEVERITY_COLOR[finding.severity] || "var(--c-64748b)";
  return (
    <div style={{
      background: "var(--c-0f172a)", border: `1px solid ${color}30`,
      borderRadius: 10, padding: "12px 14px", borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <SeverityBadge severity={finding.severity} />
            <span style={{ color: "var(--c-f1f5f9)", fontSize: 12, fontWeight: 600 }}>{finding.title}</span>
            {finding.source && <SourceBadge source={finding.source} />}
          </div>
          <div style={{ color: "var(--c-64748b)", fontSize: 11, marginBottom: 4 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--c-94a3b8)" }}>
              <ResourceIconImg resourceType={finding.resource_type} size={13} />
              {finding.resource_name}
            </span>
            {finding.resource_group && <> · <span>{finding.resource_group}</span></>}
            {finding.subscription_id && (
              <span style={{ color: "var(--c-475569)", marginLeft: 6, fontSize: 9 }}>
                {finding.subscription_id.substring(0, 8)}…
              </span>
            )}
          </div>
          {open && (
            <div style={{ marginTop: 6, marginBottom: 6 }}>
              {finding.description && (
                <div style={{ color: "var(--c-94a3b8)", fontSize: 11, marginBottom: 4 }}>{finding.description}</div>
              )}
              {finding.remediation && (
                <div style={{ color: 'var(--c-34d399)', fontSize: 10, marginTop: 4 }}>Remediation: {finding.remediation}</div>
              )}
              {finding.threats && (
                <div style={{ color: "#eab308", fontSize: 10, marginTop: 3 }}>Threats: {finding.threats}</div>
              )}
              {finding.implementation_effort && (
                <div style={{ color: "var(--c-475569)", fontSize: 9, marginTop: 3 }}>Effort: {finding.implementation_effort}</div>
              )}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            {finding.category && (
              <span style={{ color: "var(--c-475569)", fontSize: 9 }}>{GAP_TYPE_LABEL[finding.category] || finding.category}</span>
            )}
            <button onClick={() => setOpen(!open)} style={{
              background: "none", border: "none", color: "var(--c-475569)",
              cursor: "pointer", fontSize: 10, padding: 0,
            }}>
              {open ? "Hide ‹" : "Details ›"}
            </button>
            {finding.resource_id && onSelect && (
              <button onClick={() => onSelect(finding)} style={{
                background: "none", border: "none", color: "#3b82f6",
                cursor: "pointer", fontSize: 10, padding: 0,
              }}>
                View Resource ↗
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// FILTER BAR
// ══════════════════════════════════════════════════════════════════════════════════

function FilterBar({ filters, setFilters, allFindings }) {
  const subscriptions = useMemo(() => [...new Set(allFindings.map(f => f.subscription_id).filter(Boolean))], [allFindings]);
  const resourceGroups = useMemo(() => [...new Set(allFindings.map(f => f.resource_group).filter(Boolean))].sort(), [allFindings]);
  const resourceTypes = useMemo(() => [...new Set(allFindings.map(f => f.resource_type).filter(Boolean))].sort(), [allFindings]);
  const sources = useMemo(() => [...new Set(allFindings.map(f => f.source).filter(Boolean))], [allFindings]);
  const categories = useMemo(() => [...new Set(allFindings.map(f => f.category || f.gap_type).filter(Boolean))].sort(), [allFindings]);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div style={{ width: 140 }}>
        <SearchableSelect
          value={filters.severity || 'all'}
          onChange={v => setFilters(f => ({ ...f, severity: v }))}
          options={[{value:'all',label:'All Severities'},{value:'critical',label:'Critical'},{value:'high',label:'High'},{value:'medium',label:'Medium'},{value:'low',label:'Low'}]}
          compact
        />
      </div>
      <div style={{ width: 140 }}>
        <SearchableSelect
          value={filters.source || 'all'}
          onChange={v => setFilters(f => ({ ...f, source: v }))}
          options={[{value:'all',label:'All Sources'}, ...sources.map(s => ({value:s,label:SOURCE_LABEL[s]||s}))]}
          placeholder="All Sources"
          compact
        />
      </div>
      <div style={{ width: 160 }}>
        <SearchableSelect
          value={filters.resourceType || 'all'}
          onChange={v => setFilters(f => ({ ...f, resourceType: v }))}
          options={[{value:'all',label:'All Resource Types'}, ...resourceTypes.map(t => ({value:t,label:t.split('/').pop()}))]}
          placeholder="All Types"
          searchPlaceholder="Search types…"
          compact
        />
      </div>
      <div style={{ width: 160 }}>
        <SearchableSelect
          value={filters.resourceGroup || 'all'}
          onChange={v => setFilters(f => ({ ...f, resourceGroup: v }))}
          options={[{value:'all',label:'All Resource Groups'}, ...resourceGroups.map(rg => ({value:rg,label:rg}))]}
          placeholder="All RGs"
          searchPlaceholder="Search resource groups…"
          compact
        />
      </div>
      <div style={{ width: 140 }}>
        <SearchableSelect
          value={filters.category || 'all'}
          onChange={v => setFilters(f => ({ ...f, category: v }))}
          options={[{value:'all',label:'All Categories'}, ...categories.map(c => ({value:c,label:GAP_TYPE_LABEL[c]||c}))]}
          placeholder="All Categories"
          compact
        />
      </div>
      <div style={{ width: 140 }}>
        <SearchableSelect
          value={filters.subscription || 'all'}
          onChange={v => setFilters(f => ({ ...f, subscription: v }))}
          options={[{value:'all',label:'All Subscriptions'}, ...subscriptions.map(s => ({value:s,label:s.substring(0,12)+'…'}))]}
          placeholder="All Subs"
          compact
        />
      </div>
      <input type="text" placeholder="Search…" value={filters.search || ""}
        onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
        style={{
          background: "var(--c-0c1220)", color: "var(--c-e2e8f0)", border: "1px solid var(--c-1e293b)",
          borderRadius: 7, padding: "7px 10px", fontSize: 11, width: 140,
          outline: 'none', transition: 'border-color 0.15s',
        }}
        onFocus={e => e.target.style.borderColor = '#0078d4'}
        onBlur={e => e.target.style.borderColor = 'var(--c-1e293b)'}
      />
      {Object.values(filters).some(v => v && v !== "all" && v !== "") && (
        <button onClick={() => setFilters({
          severity: "all", source: "all", resourceType: "all",
          subscription: "all", resourceGroup: "all", category: "all", search: "",
        })} style={{
          background: "transparent", border: "1px solid var(--c-1e293b)", color: "var(--c-94a3b8)",
          borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 11,
          display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
        }}>
          ✕ Clear
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════════════════════════════════

function exportToCSV(findings, filename = "security_findings.csv") {
  const headers = ["Severity", "Title", "Resource Name", "Resource Type", "Resource Group",
    "Subscription", "Source", "Category", "Description", "Remediation"];
  const rows = findings.map(f => [
    f.severity, f.title, f.resource_name, f.resource_type, f.resource_group,
    f.subscription_id, f.source || "internal", f.category || f.gap_type || "",
    (f.description || "").replace(/"/g, '""'), (f.remediation || "").replace(/"/g, '""'),
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${c || ""}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════════════════════════
// ZERO TRUST SCORECARD TAB
// ══════════════════════════════════════════════════════════════════════════════════

function ZeroTrustTab({ data, loading }) {
  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "var(--c-64748b)" }}>Loading Zero Trust assessment…</div>;
  if (!data) return <div style={{ textAlign: "center", padding: 40, color: "var(--c-64748b)" }}>No data available</div>;

  const maturityColor = data.overall_score >= 80 ? "#22c55e" : data.overall_score >= 60 ? "#eab308" : data.overall_score >= 40 ? "#f97316" : "#ef4444";
  const circumference = 2 * Math.PI * 52;
  const offset = circumference * (1 - data.overall_score / 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header with overall score */}
      <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 12, padding: 20, display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div style={{ textAlign: "center" }}>
          <svg width="130" height="130" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="none" style={{ stroke: 'var(--c-1e293b)' }} strokeWidth="10" />
            <circle cx="60" cy="60" r="52" fill="none" stroke={maturityColor} strokeWidth="10"
              strokeDasharray={circumference} strokeDashoffset={offset}
              strokeLinecap="round" transform="rotate(-90 60 60)"
              style={{ transition: "stroke-dashoffset 1s ease" }} />
            <text x="60" y="55" textAnchor="middle" fill={maturityColor} fontSize="26" fontWeight="800">{data.overall_score}</text>
            <text x="60" y="74" textAnchor="middle" style={{ fill: 'var(--c-64748b)' }} fontSize="9">Zero Trust</text>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ color: "var(--c-f1f5f9)", fontSize: 20, fontWeight: 800 }}>Zero Trust Scorecard</span>
            <span style={{ background: `${maturityColor}15`, color: maturityColor, fontSize: 12, fontWeight: 700, padding: "3px 12px", borderRadius: 20, border: `1px solid ${maturityColor}35` }}>
              {data.maturity_level}
            </span>
            <span style={{ background: `${maturityColor}12`, color: maturityColor, fontSize: 14, fontWeight: 800, padding: "2px 10px", borderRadius: 8, border: `1px solid ${maturityColor}30` }}>
              {data.overall_grade}
            </span>
          </div>
          <div style={{ color: "var(--c-94a3b8)", fontSize: 12 }}>
            {data.passing_checks}/{data.total_checks} checks passing across {data.pillars?.length || 6} pillars
          </div>
          <div style={{ color: "var(--c-64748b)", fontSize: 11, marginTop: 4 }}>
            Based on Microsoft Zero Trust model — verify explicitly, use least privilege, assume breach
          </div>
        </div>
      </div>

      {/* Pillar cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
        {(data.pillars || []).map(p => {
          const color = p.score >= 80 ? "#22c55e" : p.score >= 60 ? "#eab308" : p.score >= 40 ? "#f97316" : "#ef4444";
          return (
            <div key={p.key} style={{ background: "var(--c-0f172a)", border: `1px solid ${color}25`, borderRadius: 12, padding: 16, borderTop: `3px solid ${color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{p.icon}</span>
                  <div>
                    <div style={{ color: "var(--c-f1f5f9)", fontSize: 14, fontWeight: 700 }}>{p.name}</div>
                    <div style={{ color: "var(--c-475569)", fontSize: 10 }}>{p.description?.substring(0, 60)}…</div>
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ color, fontSize: 24, fontWeight: 800 }}>{p.score}</div>
                  <div style={{ color: "var(--c-475569)", fontSize: 9, fontWeight: 700 }}>{p.grade}</div>
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ background: "var(--c-1e293b)", borderRadius: 4, height: 6, marginBottom: 12, overflow: "hidden" }}>
                <div style={{ background: color, height: "100%", width: `${p.score}%`, transition: "width 0.5s", borderRadius: 4 }} />
              </div>
              {/* Checks */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(p.checks || []).map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 8px", background: c.status === "pass" ? "#05280f15" : "#3b000015", borderRadius: 6, border: `1px solid ${c.status === "pass" ? "#16a34a20" : "#dc262620"}` }}>
                    <span style={{ fontSize: 12, marginTop: 1 }}>{c.status === "pass" ? "✓" : "✗"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "var(--c-e2e8f0)", fontSize: 11, fontWeight: 600 }}>{c.name}</div>
                      <div style={{ color: "var(--c-64748b)", fontSize: 10 }}>{c.detail}</div>
                      {c.status !== "pass" && (
                        <div style={{ color: "#f97316", fontSize: 10, marginTop: 2 }}>{c.recommendation}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// ATTACK SURFACE ANALYSIS TAB
// ══════════════════════════════════════════════════════════════════════════════════

function AttackSurfaceTab({ data, loading }) {
  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "var(--c-64748b)" }}>Analyzing attack surface…</div>;
  if (!data) return <div style={{ textAlign: "center", padding: 40, color: "var(--c-64748b)" }}>No data available</div>;

  const riskColor = data.risk_level === "critical" ? "#ef4444" : data.risk_level === "high" ? "#f97316" : data.risk_level === "medium" ? "#eab308" : "#22c55e";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary header */}
      <div style={{ background: "var(--c-0f172a)", border: `1px solid ${riskColor}25`, borderRadius: 12, padding: 20, borderLeft: `4px solid ${riskColor}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ color: "var(--c-64748b)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Attack Surface Exposure</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
              <span style={{ color: riskColor, fontSize: 42, fontWeight: 800 }}>{data.attack_surface_score}</span>
              <span style={{ color: "var(--c-475569)", fontSize: 18 }}>/100 risk</span>
              <span style={{ background: `${riskColor}15`, color: riskColor, fontSize: 12, fontWeight: 700, padding: "3px 12px", borderRadius: 20, border: `1px solid ${riskColor}35` }}>
                {data.risk_level?.toUpperCase()}
              </span>
            </div>
            <div style={{ color: "var(--c-475569)", fontSize: 11 }}>
              {data.total_exposures} exposure points identified — lower is better
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {[
              { label: "Public IPs", value: data.public_ip_count, icon: "○" },
              { label: "PE Gaps", value: data.pe_gaps_count, icon: "○" },
              { label: "No Backup", value: data.no_backup_count, icon: "○" },
              { label: "Blind Spots", value: data.unmonitored_count, icon: "○" },
            ].map(m => (
              <div key={m.label} style={{ background: "var(--c-1e293b)", borderRadius: 10, padding: "10px 14px", textAlign: "center", minWidth: 70 }}>
                <div style={{ fontSize: 16, marginBottom: 2 }}>{m.icon}</div>
                <div style={{ color: m.value > 0 ? "#f97316" : "#22c55e", fontSize: 20, fontWeight: 800 }}>{m.value}</div>
                <div style={{ color: "var(--c-64748b)", fontSize: 9, fontWeight: 600 }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Category summary bars */}
      {data.category_summary?.length > 0 && (
        <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 12, padding: 16 }}>
          <h3 style={{ color: "var(--c-f1f5f9)", fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>Exposure by Category</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.category_summary.map((cat, i) => {
              const catColor = cat.severity === "critical" ? "#ef4444" : cat.severity === "high" ? "#f97316" : cat.severity === "medium" ? "#eab308" : "var(--c-64748b)";
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "var(--c-94a3b8)", fontSize: 11, width: 180, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{cat.category}</span>
                  <div style={{ flex: 1, background: "var(--c-1e293b)", borderRadius: 4, height: 16, overflow: "hidden" }}>
                    <div style={{ background: catColor, height: "100%", width: `${Math.min(100, cat.count * 20)}%`, borderRadius: 4, transition: "width 0.5s" }} />
                  </div>
                  <SeverityBadge severity={cat.severity} />
                  <span style={{ color: "var(--c-94a3b8)", fontSize: 11, width: 30, textAlign: "right" }}>{cat.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Exposure details */}
      {data.exposures?.length > 0 && (
        <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 12, padding: 16 }}>
          <h3 style={{ color: "var(--c-f1f5f9)", fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>🔍 Exposure Details ({data.exposures.length})</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.exposures.map((e, i) => {
              const sevColor = SEVERITY_COLOR[e.severity] || "var(--c-64748b)";
              return (
                <div key={i} style={{ background: "var(--c-0d1117)", border: `1px solid ${sevColor}25`, borderRadius: 8, padding: "10px 12px", borderLeft: `3px solid ${sevColor}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <SeverityBadge severity={e.severity} />
                    <span style={{ background: "var(--c-1e293b)", color: "var(--c-94a3b8)", fontSize: 9, padding: "2px 6px", borderRadius: 10 }}>{e.category}</span>
                    <span style={{ color: "var(--c-e2e8f0)", fontSize: 12, fontWeight: 600 }}>{e.resource_name}</span>
                  </div>
                  <div style={{ color: "var(--c-94a3b8)", fontSize: 11 }}>{e.description}</div>
                  <div style={{ color: 'var(--c-34d399)', fontSize: 10, marginTop: 4 }}>Remediation: {e.remediation}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// DB-BACKED FINDINGS TABLE TAB (Server-side filtering, sorting, pagination)
// ══════════════════════════════════════════════════════════════════════════════════

function DBFindingsTab({ onSelectResource }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    severity: "all", source: "all", resourceType: "all",
    resourceGroup: "all", subscription: "all", category: "all",
    status: "active", search: "",
  });
  const [sortBy, setSortBy] = useState("severity");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);
  const [filterOptions, setFilterOptions] = useState({});

  const fetchFindings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        severity: filters.severity, source: filters.source,
        resource_type: filters.resourceType, resource_group: filters.resourceGroup,
        subscription: filters.subscription, category: filters.category,
        status: filters.status, search: filters.search,
        sort_by: sortBy, sort_dir: sortDir,
        page: String(page), page_size: String(pageSize),
      });
      const res = await fetch(`/api/security/findings?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      if (json.filter_options) setFilterOptions(json.filter_options);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters, sortBy, sortDir, page, pageSize]);

  useEffect(() => { fetchFindings(); }, [fetchFindings]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/security/findings/refresh", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchFindings();
    } catch (e) {
      setError("Refresh failed: " + e.message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        severity: filters.severity, source: filters.source,
        resource_type: filters.resourceType, resource_group: filters.resourceGroup,
        subscription: filters.subscription, category: filters.category,
        status: filters.status, search: filters.search,
      });
      const res = await fetch(`/api/security/findings/export?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "security_findings.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError("Export failed: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
    setPage(0);
  };

  const handleFilterChange = (key, value) => {
    setFilters(f => ({ ...f, [key]: value }));
    setPage(0);
  };

  const clearFilters = () => {
    setFilters({
      severity: "all", source: "all", resourceType: "all",
      resourceGroup: "all", subscription: "all", category: "all",
      status: "active", search: "",
    });
    setPage(0);
  };

  const hasActiveFilters = Object.entries(filters).some(([k, v]) => {
    if (k === "status") return v !== "active";
    return v && v !== "all" && v !== "";
  });

  const columns = [
    { key: "severity", label: "Severity", width: "80px" },
    { key: "title", label: "Finding", width: "auto" },
    { key: "resource_name", label: "Resource", width: "160px" },
    { key: "resource_type", label: "Type", width: "120px" },
    { key: "resource_group", label: "Resource Group", width: "130px" },
    { key: "source", label: "Source", width: "100px" },
    { key: "category", label: "Category", width: "110px" },
    { key: "monthly_risk_usd", label: "Risk/mo", width: "80px" },
  ];

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = data?.total_pages || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Toolbar: Filters + Actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ width: 130 }}>
            <SearchableSelect
              value={filters.severity}
              onChange={v => handleFilterChange("severity", v)}
              options={[
                { value: "all", label: "All Severities" },
                ...((filterOptions.severity || ["critical","high","medium","low"]).map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))),
              ]}
              compact
            />
          </div>
          <div style={{ width: 130 }}>
            <SearchableSelect
              value={filters.source}
              onChange={v => handleFilterChange("source", v)}
              options={[
                { value: "all", label: "All Sources" },
                ...((filterOptions.source || []).map(s => ({ value: s, label: SOURCE_LABEL[s] || s }))),
              ]}
              compact
            />
          </div>
          <div style={{ width: 150 }}>
            <SearchableSelect
              value={filters.resourceType}
              onChange={v => handleFilterChange("resourceType", v)}
              options={[
                { value: "all", label: "All Types" },
                ...((filterOptions.resource_type || []).map(t => ({ value: t, label: t.split("/").pop() }))),
              ]}
              placeholder="All Types"
              searchPlaceholder="Search types..."
              compact
            />
          </div>
          <div style={{ width: 150 }}>
            <SearchableSelect
              value={filters.resourceGroup}
              onChange={v => handleFilterChange("resourceGroup", v)}
              options={[
                { value: "all", label: "All RGs" },
                ...((filterOptions.resource_group || []).map(rg => ({ value: rg, label: rg }))),
              ]}
              placeholder="All RGs"
              searchPlaceholder="Search RGs..."
              compact
            />
          </div>
          <div style={{ width: 120 }}>
            <SearchableSelect
              value={filters.category}
              onChange={v => handleFilterChange("category", v)}
              options={[
                { value: "all", label: "All Categories" },
                ...((filterOptions.category || []).map(c => ({ value: c, label: GAP_TYPE_LABEL[c] || c }))),
              ]}
              compact
            />
          </div>
          <input type="text" placeholder="Search..." value={filters.search}
            onChange={e => handleFilterChange("search", e.target.value)}
            style={{
              background: "var(--c-0c1220)", color: "var(--c-e2e8f0)", border: "1px solid var(--c-1e293b)",
              borderRadius: 7, padding: "7px 10px", fontSize: 11, width: 130,
              outline: "none",
            }}
            onFocus={e => e.target.style.borderColor = "#0078d4"}
            onBlur={e => e.target.style.borderColor = "var(--c-1e293b)"}
          />
          {hasActiveFilters && (
            <button onClick={clearFilters} style={{
              background: "transparent", border: "1px solid var(--c-1e293b)", color: "var(--c-94a3b8)",
              borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 11,
            }}>✕ Clear</button>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={handleRefresh} disabled={refreshing} style={{
            background: "var(--c-1e293b)", border: "1px solid var(--c-334155)", color: refreshing ? "var(--c-475569)" : "var(--c-94a3b8)",
            borderRadius: 6, padding: "6px 12px", cursor: refreshing ? "default" : "pointer", fontSize: 11,
          }}>{refreshing ? "⟳ Scanning..." : "⟳ Refresh"}</button>
          <button onClick={handleExport} disabled={exporting || total === 0} style={{
            background: "var(--c-1e293b)", border: "1px solid var(--c-334155)",
            color: exporting || total === 0 ? "var(--c-475569)" : "var(--c-94a3b8)",
            borderRadius: 6, padding: "6px 12px", cursor: exporting || total === 0 ? "default" : "pointer", fontSize: 11,
          }}>{exporting ? "Exporting..." : "↓ Export CSV"}</button>
        </div>
      </div>

      {/* Status bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "var(--c-475569)", fontSize: 11 }}>
          {loading ? "Loading..." : `Showing ${items.length} of ${total} findings`}
          {total > 0 && ` · Page ${page + 1} of ${totalPages}`}
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--c-0f172a)", borderRadius: 8, padding: 3 }}>
          <span style={{ color: "var(--c-94a3b8)", fontSize: 10, padding: "3px 8px" }}>
            Persisted to {" "}
            <span style={{ color: 'var(--c-38bdf8)', fontWeight: 600 }}>Azure SQL Database</span>
          </span>
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "#ef444415", border: "1px solid #ef444430", borderRadius: 8 }}>
          <span style={{ color: "#ef4444", fontSize: 11 }}>⚠ {error}</span>
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--c-1e293b)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--c-0a0f1a)" }}>
              {columns.map(col => (
                <th key={col.key} onClick={() => handleSort(col.key)} style={{
                  padding: "10px 10px", color: sortBy === col.key ? "#38bdf8" : "var(--c-64748b)",
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                  cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
                  borderBottom: "2px solid var(--c-1e293b)", textAlign: "left", width: col.width,
                  position: "sticky", top: 0, background: "var(--c-0a0f1a)", zIndex: 1,
                }}>
                  {col.label} {sortBy === col.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td colSpan={columns.length} style={{ padding: 40, textAlign: "center", color: "var(--c-64748b)" }}>Loading findings...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={columns.length} style={{ padding: 40, textAlign: "center", color: "var(--c-64748b)" }}>
                {total === 0 ? "No findings persisted yet. Click ⟳ Refresh to scan and persist." : "No findings match current filters."}
              </td></tr>
            ) : items.map((f, i) => (
              <tr key={f.id || i}
                  onClick={() => f.resource_id && onSelectResource && onSelectResource(f.resource_id, f.resource_name)}
                  style={{
                    background: i % 2 === 0 ? "var(--c-0f172a)" : "var(--c-0d1117)",
                    cursor: f.resource_id ? "pointer" : "default",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "#1e293b40"}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "var(--c-0f172a)" : "var(--c-0d1117)"}>
                <td style={{ padding: "8px 10px" }}><SeverityBadge severity={f.severity} /></td>
                <td style={{ padding: "8px 10px", color: "var(--c-e2e8f0)", fontWeight: 500 }}>
                  <div style={{ fontSize: 11 }}>{f.title}</div>
                  {f.description && (
                    <div style={{ color: "var(--c-475569)", fontSize: 9, marginTop: 2, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.description}
                    </div>
                  )}
                </td>
                <td style={{ padding: "8px 10px", color: f.resource_id ? "#93c5fd" : "var(--c-94a3b8)", fontSize: 11 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <ResourceIconImg resourceType={f.resource_type} size={14} />
                    <span style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.resource_name}</span>
                    {f.resource_id && <span style={{ color: "#3b82f6", fontSize: 10 }}>↗</span>}
                  </div>
                </td>
                <td style={{ padding: "8px 10px", color: "var(--c-64748b)", fontSize: 10 }}>{(f.resource_type || "").split("/").pop()}</td>
                <td style={{ padding: "8px 10px", color: "var(--c-64748b)", fontSize: 10 }}>{f.resource_group}</td>
                <td style={{ padding: "8px 10px" }}><SourceBadge source={f.source} /></td>
                <td style={{ padding: "8px 10px", color: "var(--c-64748b)", fontSize: 10 }}>{GAP_TYPE_LABEL[f.category] || f.category}</td>
                <td style={{ padding: "8px 10px", color: f.monthly_risk_usd > 0 ? "#ef4444" : "var(--c-475569)", fontSize: 10, fontWeight: f.monthly_risk_usd > 0 ? 600 : 400 }}>
                  {f.monthly_risk_usd > 0 ? `$${Number(f.monthly_risk_usd).toFixed(0)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 4 }}>
          <button disabled={page === 0} onClick={() => setPage(0)} style={{
            background: "none", border: "1px solid var(--c-1e293b)",
            color: page === 0 ? "var(--c-334155)" : "var(--c-94a3b8)",
            borderRadius: 6, padding: "4px 8px", cursor: page === 0 ? "default" : "pointer", fontSize: 10,
          }}>⟪</button>
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{
            background: "none", border: "1px solid var(--c-1e293b)",
            color: page === 0 ? "var(--c-334155)" : "var(--c-94a3b8)",
            borderRadius: 6, padding: "4px 10px", cursor: page === 0 ? "default" : "pointer", fontSize: 11,
          }}>← Prev</button>
          <div style={{ display: "flex", gap: 2 }}>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 7) pageNum = i;
              else if (page < 3) pageNum = i;
              else if (page >= totalPages - 3) pageNum = totalPages - 7 + i;
              else pageNum = page - 3 + i;
              return (
                <button key={pageNum} onClick={() => setPage(pageNum)} style={{
                  background: page === pageNum ? "var(--c-334155)" : "none",
                  border: page === pageNum ? "1px solid var(--c-475569)" : "1px solid transparent",
                  color: page === pageNum ? "var(--c-f1f5f9)" : "var(--c-64748b)",
                  borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 10, fontWeight: page === pageNum ? 700 : 400,
                  minWidth: 28,
                }}>{pageNum + 1}</button>
              );
            })}
          </div>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{
            background: "none", border: "1px solid var(--c-1e293b)",
            color: page >= totalPages - 1 ? "var(--c-334155)" : "var(--c-94a3b8)",
            borderRadius: 6, padding: "4px 10px", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: 11,
          }}>Next →</button>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} style={{
            background: "none", border: "1px solid var(--c-1e293b)",
            color: page >= totalPages - 1 ? "var(--c-334155)" : "var(--c-94a3b8)",
            borderRadius: 6, padding: "4px 8px", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: 10,
          }}>⟫</button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
// MAIN SECURITY PANEL
// ══════════════════════════════════════════════════════════════════════════════════

export default function SecurityPanel({ securityGaps = [] }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [view, setView] = useState("card");
  const [defenderData, setDefenderData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState("severity");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({
    severity: "all", source: "all", resourceType: "all",
    subscription: "all", resourceGroup: "all", category: "all", search: "",
  });
  const [zeroTrustData, setZeroTrustData] = useState(null);
  const [attackSurfaceData, setAttackSurfaceData] = useState(null);
  const [ztLoading, setZtLoading] = useState(false);
  const [asLoading, setAsLoading] = useState(false);
  const [drill, setDrill] = useState({ open: false, title: "", items: [], columns: [], accent: "#38bdf8" });
  const [selectedResourceId, setSelectedResourceId] = useState(null);
  const [selectedResourceName, setSelectedResourceName] = useState(null);

  const PAGE_SIZE = view === "list" ? 50 : 20;

  useEffect(() => {
    setLoading(true);
    fetch("/api/security/enhanced")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setDefenderData(data); })
      .catch(err => {
        console.warn("Defender data unavailable:", err);
        setError("Defender for Cloud data not available — showing internal analysis only");
      })
      .finally(() => setLoading(false));
  }, []);

  // Lazy-load Zero Trust data
  useEffect(() => {
    if (activeTab === "zerotrust" && !zeroTrustData && !ztLoading) {
      setZtLoading(true);
      fetch("/api/security/zero-trust")
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setZeroTrustData(data); })
        .catch(() => {})
        .finally(() => setZtLoading(false));
    }
  }, [activeTab, zeroTrustData, ztLoading]);

  // Lazy-load Attack Surface data
  useEffect(() => {
    if (activeTab === "attacksurface" && !attackSurfaceData && !asLoading) {
      setAsLoading(true);
      fetch("/api/security/attack-surface")
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setAttackSurfaceData(data); })
        .catch(() => {})
        .finally(() => setAsLoading(false));
    }
  }, [activeTab, attackSurfaceData, asLoading]);

  const allFindings = useMemo(() => {
    const findings = [];
    for (const g of securityGaps) {
      findings.push({
        ...g,
        id: g.resource_id + "_" + g.gap_type,
        source: "internal",
        category: GAP_TYPE_LABEL[g.gap_type] || g.gap_type,
      });
    }
    if (defenderData?.defender?.findings) {
      for (const f of defenderData.defender.findings) findings.push({ ...f });
    }
    if (defenderData?.arc_findings) {
      for (const f of defenderData.arc_findings) findings.push({ ...f });
    }
    if (defenderData?.onprem_findings) {
      for (const f of defenderData.onprem_findings) findings.push({ ...f, source: f.source || 'onprem-scan' });
    }
    return findings;
  }, [securityGaps, defenderData]);

  const handleDrill = useCallback((type, data) => {
    const DRILL_CONFIGS = {
      "findings": {
        title: "Security Findings", accent: "#f97316",
        items: (data || []).map(f => ({ name: f.title || f.resource_name, type: f.resource_type, severity: f.severity, source: f.source || "internal", detail: f.description })),
        columns: [
          { key: "name", label: "Finding", width: "2fr", value: i => i.name },
          { key: "severity", label: "Severity", width: "80px", value: i => i.severity, color: i => ({ critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "var(--c-64748b)" })[i.severity] || "var(--c-94a3b8)" },
          { key: "source", label: "Source", width: "80px", value: i => i.source },
        ],
      },
      "alerts": {
        title: "Active Alerts", accent: "#ef4444",
        items: (data || []).map(a => ({ name: a.alert_display_name || a.name, type: a.resource_type, severity: a.severity, status: a.status, detail: a.description })),
        columns: [
          { key: "name", label: "Alert", width: "2fr", value: i => i.name },
          { key: "severity", label: "Severity", width: "80px", value: i => i.severity, color: i => i.severity === "high" ? "#ef4444" : "#eab308" },
          { key: "status", label: "Status", width: "80px", value: i => i.status },
        ],
      },
      "plans": {
        title: "Defender Plan Coverage", accent: "#22c55e",
        items: (data || []).map(p => ({ name: p.name || p.plan_name, status: p.pricing_tier || p.status, coverage: p.coverage || "N/A" })),
        columns: [
          { key: "name", label: "Plan", width: "2fr", value: i => i.name },
          { key: "status", label: "Tier", width: "100px", value: i => i.status, color: i => i.status === "Free" ? "#eab308" : "#22c55e" },
        ],
      },
      "compliance": {
        title: "Compliance Standards", accent: "#38bdf8",
        items: (data || []).map(c => ({ name: c.standard_name || c.name, compliance: `${c.compliance_pct || 0}%`, passed: c.passed_controls, failed: c.failed_controls })),
        columns: [
          { key: "name", label: "Standard", width: "2fr", value: i => i.name },
          { key: "compliance", label: "Score", width: "70px", value: i => i.compliance, color: i => parseInt(i.compliance) >= 70 ? "#22c55e" : "#eab308" },
          { key: "passed", label: "Passed", width: "60px", value: i => i.passed },
          { key: "failed", label: "Failed", width: "60px", value: i => i.failed, color: i => i.failed > 0 ? "#ef4444" : "#22c55e" },
        ],
      },
      "risk": {
        title: "Monthly Risk Exposure", accent: "#ef4444",
        items: (data || []).map(g => ({ name: g.resource_name, type: g.resource_type, risk: `$${(g.monthly_risk_usd || 0).toFixed(0)}`, gap: g.gap_type, detail: g.description })),
        columns: [
          { key: "name", label: "Resource", width: "2fr", value: i => i.name },
          { key: "risk", label: "Risk/mo", width: "80px", value: i => i.risk, color: () => "#ef4444" },
          { key: "gap", label: "Gap", width: "120px", value: i => i.gap },
        ],
      },
    };
    const cfg = DRILL_CONFIGS[type];
    if (cfg) setDrill({ open: true, ...cfg });
  }, []);

  const filtered = useMemo(() => {
    return allFindings.filter(f => {
      if (filters.severity !== "all" && f.severity !== filters.severity) return false;
      if (filters.source !== "all" && f.source !== filters.source) return false;
      if (filters.subscription !== "all" && f.subscription_id !== filters.subscription) return false;
      if (filters.resourceGroup !== "all" && f.resource_group !== filters.resourceGroup) return false;
      if (filters.category !== "all") {
        const cat = f.category || f.gap_type || "";
        if (cat !== filters.category) return false;
      }
      if (filters.resourceType !== "all") {
        const rtype = (f.resource_type || "").toLowerCase();
        if (rtype !== filters.resourceType.toLowerCase()) return false;
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const searchable = `${f.title} ${f.resource_name} ${f.description} ${f.resource_group}`.toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [allFindings, filters]);

  const sorted = useMemo(() => {
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "severity") {
        cmp = (sevOrder[a.severity] || 9) - (sevOrder[b.severity] || 9);
      } else {
        const av = (a[sortBy] || "").toString().toLowerCase();
        const bv = (b[sortBy] || "").toString().toLowerCase();
        cmp = av.localeCompare(bv);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortBy, sortDir]);

  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  const handleSort = useCallback((key) => {
    if (sortBy === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir("asc"); }
  }, [sortBy]);

  const tabStyle = (tab) => ({
    background: activeTab === tab ? "var(--c-1e293b)" : "transparent",
    border: activeTab === tab ? "1px solid var(--c-334155)" : "1px solid transparent",
    color: activeTab === tab ? "var(--c-f1f5f9)" : "var(--c-64748b)",
    borderRadius: 8, padding: "6px 14px", cursor: "pointer",
    fontSize: 11, fontWeight: activeTab === tab ? 700 : 500,
    transition: "all 0.2s",
  });

  if (loading && !defenderData && !securityGaps.length) {
    return (
      <div style={{ background: "var(--c-0d1117)", borderRadius: 16, padding: 40, textAlign: "center" }}>
        <div style={{ color: "var(--c-64748b)", fontSize: 14 }}>Loading comprehensive security posture from Defender for Cloud…</div>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--c-0d1117)", border: "1px solid var(--c-1e293b)", borderRadius: 16, padding: "20px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {defenderData?.defender?.secure_score && <SecureScoreGauge score={defenderData.defender.secure_score} />}
          <div>
            <h2 style={{ color: "var(--c-f1f5f9)", margin: 0, fontSize: 20, fontWeight: 800 }}>Security Posture</h2>
            <p style={{ color: "var(--c-64748b)", margin: "4px 0 0", fontSize: 12 }}>
              Microsoft Defender for Cloud · Azure Advisor · Azure Arc · Heuristic Analysis
            </p>
          </div>
        </div>
        <button onClick={() => exportToCSV(sorted)} style={{
          background: "var(--c-1e293b)", border: "1px solid var(--c-334155)", color: "var(--c-94a3b8)",
          borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 11,
        }}>↓ Export CSV</button>
      </div>

      {/* KPI Tiles */}
      <KPISection defenderData={defenderData} allFindings={allFindings} securityGaps={securityGaps} onDrill={handleDrill} />

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap", background: "var(--c-0f172a)", borderRadius: 10, padding: 4, border: "1px solid var(--c-1e293b)" }}>
        <button style={tabStyle("overview")} onClick={() => setActiveTab("overview")}><BarChart3 size={12} style={{marginRight:4}} /> Overview</button>
        <button style={tabStyle("findings")} onClick={() => setActiveTab("findings")}><Search size={12} style={{marginRight:4}} /> Findings ({allFindings.length})</button>
        <button style={tabStyle("alerts")} onClick={() => setActiveTab("alerts")}><Bell size={12} style={{marginRight:4}} /> Alerts ({defenderData?.defender?.alerts?.length || 0})</button>
        <button style={tabStyle("plans")} onClick={() => setActiveTab("plans")}><ShieldCheck size={12} style={{marginRight:4}} /> Defender Plans</button>
        <button style={tabStyle("compliance")} onClick={() => setActiveTab("compliance")}><ClipboardList size={12} style={{marginRight:4}} /> Compliance</button>
        <button style={tabStyle("controls")} onClick={() => setActiveTab("controls")}><Target size={12} style={{marginRight:4}} /> Score Controls</button>
        <button style={tabStyle("zerotrust")} onClick={() => setActiveTab("zerotrust")}><Lock size={12} style={{marginRight:4}} /> Zero Trust</button>
        <button style={tabStyle("attacksurface")} onClick={() => setActiveTab("attacksurface")}><Target size={12} style={{marginRight:4}} /> Attack Surface</button>
        <button style={{...tabStyle("dbfindings"), borderTop: activeTab === "dbfindings" ? "2px solid #0078d4" : undefined}} onClick={() => setActiveTab("dbfindings")}><Database size={12} style={{marginRight:4}} /> All Findings (DB)</button>
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ChartsDashboard charts={defenderData?.defender?.charts} />
          {defenderData?.defender?.alerts?.length > 0 && (
            <SecurityAlertsSection alerts={defenderData.defender.alerts.slice(0, 3)} />
          )}
          {defenderData?.defender?.defender_plans && (
            <DefenderPlansSection plans={defenderData.defender.defender_plans} />
          )}
        </div>
      )}

      {/* Findings Tab */}
      {activeTab === "findings" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <FilterBar filters={filters} setFilters={(fn) => { setFilters(fn); setPage(0); }} allFindings={allFindings} />
            <div style={{ display: "flex", gap: 4, background: "var(--c-0f172a)", borderRadius: 8, padding: 3 }}>
              <button onClick={() => { setView("card"); setPage(0); }} style={{
                background: view === "card" ? "var(--c-1e293b)" : "none",
                border: "none", color: view === "card" ? "var(--c-f1f5f9)" : "var(--c-64748b)",
                borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontSize: 11,
              }}>▦ Cards</button>
              <button onClick={() => { setView("list"); setPage(0); }} style={{
                background: view === "list" ? "var(--c-1e293b)" : "none",
                border: "none", color: view === "list" ? "var(--c-f1f5f9)" : "var(--c-64748b)",
                borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontSize: 11,
              }}>≡ List</button>
            </div>
          </div>
          <div style={{ color: "var(--c-475569)", fontSize: 11, marginBottom: 10 }}>
            Showing {paginated.length} of {sorted.length} findings
            {sorted.length !== allFindings.length && ` (${allFindings.length} total)`}
          </div>
          {view === "card" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {paginated.map((f, i) => <GapCard key={f.id || f.resource_id + f.title + i} finding={f} onSelect={f => { setSelectedResourceId(f.resource_id); setSelectedResourceName(f.resource_name); }} />)}
            </div>
          ) : (
            <SecurityTable findings={paginated} onSort={handleSort} sortBy={sortBy} sortDir={sortDir} />
          )}
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 14 }}>
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{
                background: "none", border: "1px solid var(--c-1e293b)", color: page === 0 ? "var(--c-334155)" : "var(--c-94a3b8)",
                borderRadius: 6, padding: "4px 10px", cursor: page === 0 ? "default" : "pointer", fontSize: 11,
              }}>← Prev</button>
              <span style={{ color: "var(--c-64748b)", fontSize: 11 }}>Page {page + 1} of {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{
                background: "none", border: "1px solid var(--c-1e293b)", color: page >= totalPages - 1 ? "var(--c-334155)" : "var(--c-94a3b8)",
                borderRadius: 6, padding: "4px 10px", cursor: page >= totalPages - 1 ? "default" : "pointer", fontSize: 11,
              }}>Next →</button>
            </div>
          )}
        </div>
      )}

      {/* Alerts Tab */}
      {activeTab === "alerts" && (
        <SecurityAlertsSection alerts={defenderData?.defender?.alerts || []} />
      )}

      {/* Defender Plans Tab */}
      {activeTab === "plans" && (
        <DefenderPlansSection plans={defenderData?.defender?.defender_plans} />
      )}

      {/* Compliance Tab */}
      {activeTab === "compliance" && (
        <ComplianceSection compliance={defenderData?.defender?.compliance} />
      )}

      {/* Score Controls Tab */}
      {activeTab === "controls" && (
        <ScoreControlsPanel controls={defenderData?.defender?.controls} />
      )}

      {/* Zero Trust Scorecard Tab */}
      {activeTab === "zerotrust" && (
        <ZeroTrustTab data={zeroTrustData} loading={ztLoading} />
      )}

      {/* Attack Surface Tab */}
      {activeTab === "attacksurface" && (
        <AttackSurfaceTab data={attackSurfaceData} loading={asLoading} />
      )}

      {/* DB Findings Tab — Server-side filtered table with export */}
      {activeTab === "dbfindings" && (
        <DBFindingsTab onSelectResource={(id, name) => { setSelectedResourceId(id); setSelectedResourceName(name); }} />
      )}

      {error && (
        <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--c-1e293b)", borderRadius: 8 }}>
          <span style={{ color: "#eab308", fontSize: 11 }}>△ {error}</span>
        </div>
      )}

      <KPIDrillDrawer
        open={drill.open}
        onClose={() => setDrill(d => ({ ...d, open: false }))}
        title={drill.title}
        accent={drill.accent}
        items={drill.items}
        columns={drill.columns}
      />

      {selectedResourceId && (
        <ResourceDetailDrawer
          resourceId={selectedResourceId}
          resourceName={selectedResourceName}
          onClose={() => { setSelectedResourceId(null); setSelectedResourceName(null); }}
        />
      )}
    </div>
  );
}
