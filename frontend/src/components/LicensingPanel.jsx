import React, { useState, useMemo } from "react";
import { ResourceIconImg } from "../utils/resourceIcons";
import { useDrill } from "../drill/DrillContext";

const oppToResource = (o) => ({
  resource_id: o.resource_id,
  resource_name: o.resource_name,
  resource_type: o.resource_type,
  resource_group: o.resource_group,
  location: o.location,
  subscription_id: o.subscription_id,
  cost_current_month: o.current_monthly_cost ?? o.cost_current_month ?? 0,
  estimated_monthly_savings: o.estimated_monthly_saving ?? 0,
});

const TYPE_META = {
  reserved_instance: {
    label: "Reserved Instance",
    icon:  "📅",
    color: "#22c55e",
    desc:  "Commit to 1 or 3 years for up to 40% saving vs pay-as-you-go.",
  },
  savings_plan: {
    label: "Savings Plan",
    icon:  "💰",
    color: "#84cc16",
    desc:  "Azure Savings Plan for Compute — flexible across SKU/region, ~12% saving.",
  },
  ahub_sql: {
    label: "AHUB — SQL Server",
    icon:  "🛢️",
    color: 'var(--c-38bdf8)',
    desc:  "Azure Hybrid Benefit for SQL Server (requires active Software Assurance).",
  },
  ahub_windows: {
    label: "AHUB — Windows Server",
    icon:  "🪟",
    color: 'var(--c-60a5fa)',
    desc:  "Azure Hybrid Benefit for Windows Server (requires active SA/subscription).",
  },
  spot_eligible: {
    label: "Spot / Burstable VM",
    icon:  "⚡",
    color: 'var(--c-a78bfa)',
    desc:  "Low-utilisation VM suitable for Spot pricing or B-series burstable downsize.",
  },
  byol_vmware: {
    label: "BYOL — VMware (AVS)",
    icon:  "☁️",
    color: "#f59e0b",
    desc:  "Azure VMware Solution — bring existing VMware licences to reduce per-node costs.",
  },
  byol_rhel: {
    label: "BYOL — Red Hat",
    icon:  "🎩",
    color: "#ef4444",
    desc:  "Red Hat Enterprise Linux — use Red Hat Cloud Access to eliminate Azure RHEL premium.",
  },
  byol_sles: {
    label: "BYOL — SUSE",
    icon:  "🦎",
    color: "#10b981",
    desc:  "SUSE Linux Enterprise — BYOL via SUSE Public Cloud Program saves 10–15%.",
  },
  byol_oracle: {
    label: "BYOL — Oracle",
    icon:  "🔶",
    color: "#dc2626",
    desc:  "Oracle Database — Licence Mobility on Azure Dedicated Hosts eliminates per-core Oracle costs.",
  },
};

const CONFIDENCE_COLOR = { high: "#22c55e", medium: "#eab308", low: "#f97316" };

function LicensingCard({ opp, onOpen }) {
  const [open, setOpen] = useState(false);
  const meta   = TYPE_META[opp.opportunity_type] || { label: opp.opportunity_type, icon: "💡", color: "var(--c-64748b)", desc: "" };
  const confC  = CONFIDENCE_COLOR[opp.confidence] || "var(--c-64748b)";

  return (
    <div
      onClick={() => onOpen && opp.resource_id && opp.resource_id !== "(multiple)" && onOpen(opp)}
      title={opp.resource_id && opp.resource_id !== "(multiple)" ? "Open full resource details" : undefined}
      style={{
      background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)",
      borderRadius: 12, padding: "14px 16px",
      borderLeft: `3px solid ${meta.color}`,
      cursor: opp.resource_id && opp.resource_id !== "(multiple)" ? "pointer" : "default",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--c-f1f5f9)", fontWeight: 600, fontSize: 14 }}>
              <ResourceIconImg resourceType={opp.resource_type} size={16} />
              {opp.resource_name}
            </span>
            <span style={{
              background: `${meta.color}20`, color: meta.color,
              fontSize: 10, fontWeight: 700, padding: "2px 7px",
              borderRadius: 20, border: `1px solid ${meta.color}40`,
            }}>
              {meta.label}
            </span>
            <span style={{
              background: `${confC}15`, color: confC,
              fontSize: 9, fontWeight: 700, padding: "2px 6px",
              borderRadius: 10, textTransform: "uppercase", letterSpacing: "0.4px",
            }}>
              {opp.confidence} confidence
            </span>
          </div>

          {/* Meta desc */}
          <div style={{ color: "var(--c-475569)", fontSize: 11, marginBottom: 6 }}>{meta.desc}</div>

          {/* Description + saving */}
          <div style={{ color: "var(--c-94a3b8)", fontSize: 12, lineHeight: 1.6, marginBottom: 6 }}>
            {opp.description}
          </div>

          {/* KPIs */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
            {opp.estimated_monthly_saving > 0 && (
              <div style={{ fontSize: 12 }}>
                <span style={{ color: "var(--c-64748b)" }}>Est. Saving: </span>
                <span style={{ color: "#22c55e", fontWeight: 700 }}>
                  ${opp.estimated_monthly_saving.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
                  {" "}(${(opp.estimated_monthly_saving * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr)
                </span>
              </div>
            )}
            {opp.current_sku && opp.current_sku !== "Pay-as-you-go" && (
              <div style={{ fontSize: 12 }}>
                <span style={{ color: "var(--c-64748b)" }}>SKU: </span>
                <span style={{ color: "var(--c-94a3b8)" }}>{opp.current_sku}</span>
              </div>
            )}
            {opp.resource_group && opp.resource_group !== "(multiple)" && (
              <div style={{ fontSize: 12 }}>
                <span style={{ color: "var(--c-64748b)" }}>RG: </span>
                <span style={{ color: "var(--c-94a3b8)" }}>{opp.resource_group}</span>
              </div>
            )}
          </div>

          {/* Expand: implementation + CLI */}
          {(opp.implementation || opp.az_cli) && (
            <>
              <button onClick={() => setOpen(!open)} style={{
                background: "none", border: "none", color: "var(--c-475569)",
                cursor: "pointer", fontSize: 11, padding: "2px 0",
              }}>
                {open ? "▲ Hide implementation" : "▼ How to apply"}
              </button>
              {open && (
                <div style={{ marginTop: 10 }}>
                  {opp.implementation && (
                    <div style={{ color: "var(--c-64748b)", fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
                      {opp.implementation}
                    </div>
                  )}
                  {opp.az_cli && (
                    <div style={{
                      background: "var(--c-020617)", border: "1px solid var(--c-1e293b)",
                      borderRadius: 6, padding: "8px 10px",
                      fontFamily: "monospace", fontSize: 10, color: 'var(--c-38bdf8)',
                      whiteSpace: "pre-wrap", overflowX: "auto",
                    }}>
                      {opp.az_cli}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const TYPE_FILTERS = ["All", "reserved_instance", "savings_plan", "ahub_sql", "ahub_windows", "spot_eligible", "byol_vmware", "byol_rhel", "byol_sles", "byol_oracle"];
const TYPE_LABELS  = {
  "All": "All",
  "reserved_instance": "RI",
  "savings_plan": "Savings Plan",
  "ahub_sql": "AHUB SQL",
  "ahub_windows": "AHUB Windows",
  "spot_eligible": "Spot/Burstable",
  "byol_vmware": "BYOL VMware",
  "byol_rhel": "BYOL RHEL",
  "byol_sles": "BYOL SUSE",
  "byol_oracle": "BYOL Oracle",
};

export default function LicensingPanel({ licensingOpportunities = [] }) {
  const [typeFilter, setTypeFilter] = useState("All");
  const { openResourceDrill, openResourceDetail } = useDrill();

  const filtered = useMemo(() =>
    licensingOpportunities.filter(o => typeFilter === "All" || o.opportunity_type === typeFilter),
    [licensingOpportunities, typeFilter]
  );

  const totalSaving = useMemo(() =>
    licensingOpportunities.reduce((s, o) => s + (o.estimated_monthly_saving || 0), 0),
    [licensingOpportunities]
  );

  const countByType = useMemo(() => {
    const counts = {};
    licensingOpportunities.forEach(o => {
      counts[o.opportunity_type] = (counts[o.opportunity_type] || 0) + 1;
    });
    return counts;
  }, [licensingOpportunities]);

  if (!licensingOpportunities.length) return null;

  return (
    <div style={{ background: "var(--c-0d1117)", border: "1px solid var(--c-1e293b)", borderRadius: 16, padding: "20px 24px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ color: "var(--c-f1f5f9)", margin: 0, fontSize: 18, fontWeight: 700 }}>
            🪙 Licensing & Hybrid Benefit Opportunities
          </h2>
          <p style={{ color: "var(--c-64748b)", margin: "4px 0 0", fontSize: 13 }}>
            {licensingOpportunities.length} opportunities detected
            {totalSaving > 0 && (
              <> · up to{" "}
                <span style={{ color: "#22c55e", fontWeight: 600 }}>
                  ${totalSaving.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
                </span>
                {" "}in combined savings
              </>
            )}
          </p>
        </div>

        {/* Type breakdown badges */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(countByType).filter(([, v]) => v > 0).map(([t, v]) => {
            const m = TYPE_META[t] || { label: t, color: "var(--c-64748b)" };
            return (
              <div key={t}
                onClick={() => openResourceDrill(`${m.label} opportunities`, licensingOpportunities.filter(o => o.opportunity_type === t).map(oppToResource))}
                title="Click to view the affected resources"
                style={{
                background: `${m.color}15`, border: `1px solid ${m.color}40`,
                color: m.color, borderRadius: 8, padding: "4px 10px",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>
                {v}× {m.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* Savings highlight strip */}
      {totalSaving > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { label: "Monthly Saving", value: `$${totalSaving.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: "#22c55e" },
            { label: "Annual Saving",  value: `$${(totalSaving * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: '#86efac' },
            { label: "Opportunities",  value: licensingOpportunities.length, color: "var(--c-94a3b8)" },
          ].map((kpi, i) => (
            <div key={i} style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 8, padding: "10px 14px", minWidth: 110 }}>
              <div style={{ color: "var(--c-475569)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>{kpi.label}</div>
              <div style={{ color: kpi.color, fontWeight: 700, fontSize: 18 }}>{kpi.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Type filter */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", background: "var(--c-0f172a)", borderRadius: 8, padding: 4, width: "fit-content", marginBottom: 14, border: "1px solid var(--c-1e293b)" }}>
        {TYPE_FILTERS.filter(f => f === "All" || countByType[f]).map(f => (
          <button key={f} onClick={() => setTypeFilter(f)} style={{
            background: typeFilter === f ? "var(--c-1e293b)" : "none",
            border: "none",
            color: typeFilter === f ? (TYPE_META[f]?.color || "var(--c-f1f5f9)") : "var(--c-64748b)",
            borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 11,
            fontWeight: typeFilter === f ? 700 : 400,
          }}>
            {TYPE_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((o, i) => <LicensingCard key={o.resource_id + i} opp={o} onOpen={(opp) => openResourceDetail(oppToResource(opp))} />)}
      </div>

      {/* Note */}
      <div style={{ marginTop: 16, padding: "10px 14px", background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 8, fontSize: 11, color: "var(--c-475569)" }}>
        <span style={{ color: "var(--c-94a3b8)" }}>ℹ </span>
        Confidence levels: <span style={{ color: "#22c55e" }}>High</span> = confirmed from Azure metadata ·
        <span style={{ color: "#eab308" }}> Medium</span> = inferred from resource name/SKU/tags ·
        Verify with your licensing team before committing.
      </div>
    </div>
  );
}
