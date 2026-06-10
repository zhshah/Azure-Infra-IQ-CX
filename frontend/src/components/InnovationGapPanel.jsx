import React, { useState, useMemo } from "react";

const IMPACT_COLOR = { High: "#f97316", Medium: "#eab308", Low: "#22c55e" };
const EFFORT_COLOR = { Low: "#22c55e", Medium: "#eab308", High: "#f97316" };

function AdoptionHeatmap({ scores = [] }) {
  if (!scores.length) return null;
  return (
    <div>
      <div style={{ color: "#64748b", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
        Service Adoption Scorecard
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 6 }}>
        {scores.map((s, i) => {
          const bg    = s.adopted ? "#052e16" : s.partial ? "#1c1a05" : "#1a0a0a";
          const border= s.adopted ? "#16a34a" : s.partial ? "#ca8a04" : "#dc262630";
          const color = s.adopted ? "#86efac" : s.partial ? "#fde68a" : "#f87171";
          const label = s.adopted ? "Adopted" : s.partial ? "Partial" : "Not Adopted";
          return (
            <div key={i} style={{
              background: bg, border: `1px solid ${border}`,
              borderRadius: 8, padding: "8px 10px",
            }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600, marginBottom: 3, lineHeight: 1.3 }}>
                {s.category}
              </div>
              <div style={{
                display: "inline-block", background: `${color}18`,
                color, fontSize: 9, fontWeight: 700, padding: "1px 6px",
                borderRadius: 10, border: `1px solid ${color}40`,
              }}>
                {label}
              </div>
              {s.resource_count > 0 && (
                <div style={{ color: "#475569", fontSize: 9, marginTop: 3 }}>
                  {s.resource_count} resource{s.resource_count !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GapCard({ gap }) {
  const [open, setOpen] = useState(false);
  const impColor  = IMPACT_COLOR[gap.business_impact]  || "#64748b";
  const effColor  = EFFORT_COLOR[gap.estimated_effort] || "#64748b";

  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b",
      borderRadius: 12, padding: "14px 16px",
      borderLeft: `3px solid ${impColor}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>{gap.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{gap.category}</span>
            <span style={{
              background: `${impColor}20`, color: impColor,
              fontSize: 9, fontWeight: 700, padding: "2px 7px",
              borderRadius: 20, border: `1px solid ${impColor}40`,
              textTransform: "uppercase", letterSpacing: "0.4px",
            }}>
              {gap.business_impact} Impact
            </span>
            <span style={{
              background: `${effColor}15`, color: effColor,
              fontSize: 9, fontWeight: 700, padding: "2px 7px",
              borderRadius: 20, border: `1px solid ${effColor}30`,
              textTransform: "uppercase", letterSpacing: "0.4px",
            }}>
              {gap.estimated_effort} Effort
            </span>
            {gap.status === "partially_adopted" && (
              <span style={{
                background: "#1c1a05", color: "#fde68a",
                fontSize: 9, fontWeight: 700, padding: "2px 7px",
                borderRadius: 20, border: "1px solid #ca8a0440",
              }}>
                PARTIAL ADOPTION
              </span>
            )}
          </div>

          {/* Opportunity teaser */}
          <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6, marginBottom: 6 }}>
            {gap.opportunity}
          </div>

          {/* Azure services pills */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
            {gap.azure_services.slice(0, 4).map((svc, si) => (
              <span key={si} style={{
                background: "#0c1a2e", color: "#38bdf8", fontSize: 10,
                padding: "2px 8px", borderRadius: 6, border: "1px solid #1e40af40",
              }}>
                {svc}
              </span>
            ))}
            {gap.azure_services.length > 4 && (
              <span style={{ color: "#475569", fontSize: 10, padding: "2px 4px" }}>
                +{gap.azure_services.length - 4} more
              </span>
            )}
          </div>

          {/* Expand for recommendation detail */}
          {gap.recommendation_detail && (
            <>
              <button onClick={() => setOpen(!open)} style={{
                background: "none", border: "none", color: "#475569",
                cursor: "pointer", fontSize: 11, padding: "2px 0",
              }}>
                {open ? "▲ Hide recommendation" : "▼ Show recommendation detail"}
              </button>
              {open && (
                <div style={{
                  marginTop: 8, padding: "10px 12px",
                  background: "#0c1a2e", borderRadius: 8,
                  color: "#64748b", fontSize: 12, lineHeight: 1.7,
                  borderLeft: "2px solid #1e40af",
                }}>
                  {gap.recommendation_detail}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const FILTER_OPTIONS = ["All", "High", "Medium", "Low"];

export default function InnovationGapPanel({ innovationGaps = [], serviceAdoptionScores = [] }) {
  const [impactFilter, setImpactFilter] = useState("All");
  const [activeTab,    setActiveTab]    = useState("gaps");

  const filtered = useMemo(() =>
    innovationGaps.filter(g => impactFilter === "All" || g.business_impact === impactFilter),
    [innovationGaps, impactFilter]
  );

  const highCount   = innovationGaps.filter(g => g.business_impact === "High").length;
  const adoptedCount = serviceAdoptionScores.filter(s => s.adopted).length;

  if (!innovationGaps.length && !serviceAdoptionScores.length) return null;

  return (
    <div style={{ background: "#0d1117", border: "1px solid #1e293b", borderRadius: 16, padding: "20px 24px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 18, fontWeight: 700 }}>
            🚀 Innovation Gap Analysis
          </h2>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 13 }}>
            {innovationGaps.length} service categories not yet adopted
            {adoptedCount > 0 && ` · ${adoptedCount} of ${serviceAdoptionScores.length} categories in use`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {highCount > 0 && (
            <div style={{ background: "#f9731615", border: "1px solid #f9731640", color: "#f97316", borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 700 }}>
              {highCount} High Impact Gaps
            </div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, background: "#0f172a", borderRadius: 8, padding: 4, width: "fit-content", marginBottom: 14, border: "1px solid #1e293b" }}>
        {[{ id: "gaps", label: "🔍 Gaps" }, { id: "scorecard", label: "📊 Adoption Scorecard" }].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            background: activeTab === t.id ? "#1e293b" : "none",
            border: "none", color: activeTab === t.id ? "#f1f5f9" : "#64748b",
            borderRadius: 6, padding: "4px 14px", cursor: "pointer", fontSize: 12,
            fontWeight: activeTab === t.id ? 700 : 400,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "scorecard" ? (
        <AdoptionHeatmap scores={serviceAdoptionScores} />
      ) : (
        <>
          {/* Impact filter */}
          <div style={{ display: "flex", gap: 4, background: "#0f172a", borderRadius: 8, padding: 4, width: "fit-content", marginBottom: 12, border: "1px solid #1e293b" }}>
            {FILTER_OPTIONS.map(f => (
              <button key={f} onClick={() => setImpactFilter(f)} style={{
                background: impactFilter === f ? "#1e293b" : "none",
                border: "none",
                color: impactFilter === f ? (IMPACT_COLOR[f] || "#f1f5f9") : "#64748b",
                borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12,
                fontWeight: impactFilter === f ? 700 : 400,
              }}>
                {f}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((g, i) => <GapCard key={i} gap={g} />)}
            {filtered.length === 0 && (
              <div style={{ color: "#475569", fontSize: 13, padding: "16px 0", textAlign: "center" }}>
                No gaps match this filter.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
