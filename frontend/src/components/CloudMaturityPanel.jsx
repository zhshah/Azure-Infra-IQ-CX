import React, { useState } from "react";
import { Cloud, CloudSun, CloudHail, CloudFog, Landmark, BarChart3 } from "lucide-react";

const GRADE_COLOR = { A: "#22c55e", B: "#84cc16", C: "#eab308", D: "#f97316", F: "#ef4444" };

const LABEL_DESCRIPTIONS = {
  "Cloud Native":    "Workloads are predominantly PaaS, AI is in production, DevOps is automated, and security posture is strong.",
  "Cloud Smart":     "Good PaaS adoption with some AI/data services. Strong foundation — ready for next-level innovation.",
  "Cloud Ready":     "Moving in the right direction. Core managed services adopted; AI, automation, and DevOps still maturing.",
  "Cloud Aware":     "Primarily IaaS with limited PaaS. Significant opportunity to modernise and reduce operational overhead.",
  "Traditional IT":  "Workloads are mostly IaaS/VM-based with limited cloud-native adoption. High potential for transformation.",
};

const LABEL_COLOR = {
  "Cloud Native":    "#22c55e",
  "Cloud Smart":     "#84cc16",
  "Cloud Ready":     "#eab308",
  "Cloud Aware":     "#f97316",
  "Traditional IT":  "#ef4444",
};

const LABEL_ICON = {
  "Cloud Native":    Cloud,
  "Cloud Smart":     CloudSun,
  "Cloud Ready":     CloudHail,
  "Cloud Aware":     CloudFog,
  "Traditional IT":  Landmark,
};

// Simple horizontal bar chart for each dimension
function DimensionBar({ dim }) {
  const [open, setOpen] = useState(false);
  const color = GRADE_COLOR[dim.grade] || "#64748b";

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{dim.name}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color, fontWeight: 700, fontSize: 14 }}>{dim.score}%</span>
          <span style={{
            background: `${color}20`, color, fontSize: 11, fontWeight: 700,
            padding: "1px 7px", borderRadius: 10, border: `1px solid ${color}40`,
          }}>
            {dim.grade}
          </span>
        </div>
      </div>

      {/* Bar */}
      <div style={{ height: 8, background: "#1e293b", borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
        <div style={{
          height: "100%", width: `${dim.score}%`,
          background: `linear-gradient(90deg, ${color}99, ${color})`,
          borderRadius: 4, transition: "width 0.8s ease",
        }} />
      </div>

      {/* Description */}
      <div style={{ color: "#475569", fontSize: 11, marginBottom: 4 }}>{dim.description}</div>

      {/* Gaps / Recs expandable */}
      {(dim.gaps.length > 0 || dim.recommendations.length > 0) && (
        <>
          <button onClick={() => setOpen(!open)} style={{
            background: "none", border: "none", color: "#475569",
            cursor: "pointer", fontSize: 10, padding: 0,
          }}>
            {open ? "▲ Hide details" : "▼ Show gaps & recommendations"}
          </button>
          {open && (
            <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: "2px solid #1e293b" }}>
              {dim.gaps.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  {dim.gaps.map((g, i) => (
                    <div key={i} style={{ color: "#f97316", fontSize: 11, marginBottom: 2, display: "flex", gap: 5 }}>
                      <span>△</span><span>{g}</span>
                    </div>
                  ))}
                </div>
              )}
              {dim.recommendations.map((r, i) => (
                <div key={i} style={{ color: "#64748b", fontSize: 11, marginBottom: 2, display: "flex", gap: 5 }}>
                  <span style={{ color: "#22c55e" }}>→</span><span>{r}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function CloudMaturityPanel({ cloudMaturity }) {
  if (!cloudMaturity) return null;

  const { overall_score, overall_grade, overall_label, dimensions } = cloudMaturity;
  const gradeColor  = GRADE_COLOR[overall_grade]  || "#64748b";
  const labelColor  = LABEL_COLOR[overall_label]  || "#64748b";
  const labelIcon   = LABEL_ICON[overall_label]   || Cloud;
  const labelDesc   = LABEL_DESCRIPTIONS[overall_label] || "";

  return (
    <div style={{ background: "#0d1117", border: "1px solid #1e293b", borderRadius: 16, padding: "20px 24px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <BarChart3 size={18} style={{ color: "#22c55e" }} /> Cloud Maturity Index
          </h2>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 13 }}>
            5-dimension assessment across IaaS modernisation, AI adoption, DevOps, security, and operational excellence
          </p>
        </div>

        {/* Overall score badge */}
        <div style={{
          background: `${gradeColor}12`, border: `1px solid ${gradeColor}40`,
          borderRadius: 12, padding: "12px 18px", textAlign: "center", minWidth: 90,
        }}>
          <div style={{ color: gradeColor, fontSize: 28, fontWeight: 800, lineHeight: 1 }}>
            {overall_score}
          </div>
          <div style={{ color: gradeColor, fontSize: 11, fontWeight: 600, marginTop: 2 }}>/ 100</div>
          <div style={{
            marginTop: 6, background: `${gradeColor}20`, color: gradeColor,
            fontSize: 16, fontWeight: 800, padding: "2px 10px", borderRadius: 20,
            border: `1px solid ${gradeColor}40`,
          }}>
            {overall_grade}
          </div>
        </div>
      </div>

      {/* Maturity label strip */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        background: `${labelColor}10`, border: `1px solid ${labelColor}30`,
        borderRadius: 10, padding: "10px 14px", marginBottom: 20,
      }}>
        {React.createElement(labelIcon, { size: 22, style: { color: labelColor } })}
        <div>
          <div style={{ color: labelColor, fontWeight: 700, fontSize: 15 }}>{overall_label}</div>
          <div style={{ color: "#64748b", fontSize: 12, marginTop: 1 }}>{labelDesc}</div>
        </div>
      </div>

      {/* Dimension bars */}
      <div>
        {dimensions.map((dim, i) => <DimensionBar key={i} dim={dim} />)}
      </div>
    </div>
  );
}
