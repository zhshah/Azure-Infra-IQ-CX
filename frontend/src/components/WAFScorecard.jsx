import React, { useState } from "react";

const PILLAR_ICONS = {
  "Cost Optimization": "💰",
  "Reliability": "🛡️",
  "Security": "🔒",
  "Operational Excellence": "⚙️",
  "Performance Efficiency": "⚡",
};

function GradeRing({ score, grade, color, size = 80 }) {
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--c-1e293b)' }} strokeWidth={7} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="44%" dominantBaseline="middle" textAnchor="middle"
        style={{ fill: color, fontSize: size * 0.28, fontWeight: 700 }}>
        {grade}
      </text>
      <text x="50%" y="68%" dominantBaseline="middle" textAnchor="middle"
        style={{ fill: "var(--c-94a3b8)", fontSize: size * 0.14 }}>
        {score.toFixed(0)}
      </text>
    </svg>
  );
}

function PillarCard({ pillar }) {
  const [open, setOpen] = useState(false);
  const icon = PILLAR_ICONS[pillar.pillar] || "📊";

  return (
    <div style={{
      background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)",
      borderRadius: 12, padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <GradeRing score={pillar.score} grade={pillar.grade} color={pillar.color} size={72} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 18 }}>{icon}</span>
            <span style={{ color: "var(--c-f1f5f9)", fontWeight: 600, fontSize: 14 }}>{pillar.pillar}</span>
          </div>
          {/* Score bar */}
          <div style={{ background: "var(--c-1e293b)", borderRadius: 4, height: 6, width: "100%", marginBottom: 4 }}>
            <div style={{
              width: `${pillar.score}%`, height: "100%",
              background: pillar.color, borderRadius: 4,
              transition: "width 0.6s ease",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--c-64748b)" }}>
            <span>{pillar.resource_gap_count} resource{pillar.resource_gap_count !== 1 ? "s" : ""} need attention</span>
            <span style={{ color: pillar.color, fontWeight: 600 }}>{pillar.score.toFixed(0)}/100</span>
          </div>
        </div>
      </div>

      {/* Gaps preview */}
      {pillar.gaps.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--c-94a3b8)", borderTop: "1px solid var(--c-1e293b)", paddingTop: 8 }}>
          <div style={{ color: "#ef4444", marginBottom: 4, fontSize: 11, fontWeight: 600 }}>⚠ Top Gaps</div>
          {pillar.gaps.slice(0, open ? 10 : 2).map((g, i) => (
            <div key={i} style={{ marginBottom: 3, paddingLeft: 8, borderLeft: "2px solid #ef444460" }}>
              {g}
            </div>
          ))}
          {pillar.gaps.length > 2 && (
            <button onClick={() => setOpen(!open)} style={{
              background: "none", border: "none", color: 'var(--c-38bdf8)',
              cursor: "pointer", fontSize: 11, padding: "2px 0", marginTop: 2,
            }}>
              {open ? "Show less" : `+${pillar.gaps.length - 2} more`}
            </button>
          )}
        </div>
      )}

      {/* Recommendations */}
      {pillar.recommendations.length > 0 && (
        <div style={{ fontSize: 12, borderTop: "1px solid var(--c-1e293b)", paddingTop: 8 }}>
          <div style={{ color: "#22c55e", marginBottom: 4, fontSize: 11, fontWeight: 600 }}>✦ Azure Services</div>
          {pillar.recommendations.map((rec, i) => (
            <div key={i} style={{ color: "var(--c-94a3b8)", marginBottom: 3, paddingLeft: 8, borderLeft: "2px solid #22c55e60" }}>
              {rec}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WAFScorecard({ waf }) {
  if (!waf) return null;

  const overall = waf.overall_score;
  const grade   = waf.overall_grade;
  const gradeColor = overall >= 75 ? "#22c55e" : overall >= 60 ? "#eab308" : overall >= 45 ? "#f97316" : "#ef4444";

  return (
    <div style={{
      background: "var(--c-0d1117)", border: "1px solid var(--c-1e293b)",
      borderRadius: 16, padding: "20px 24px",
    }}>
      {/* Panel header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ color: "var(--c-f1f5f9)", margin: 0, fontSize: 18, fontWeight: 700 }}>
            Well-Architected Framework Scorecard
          </h2>
          <p style={{ color: "var(--c-64748b)", margin: "4px 0 0", fontSize: 13 }}>
            Across all 5 pillars · computed from live scan data
          </p>
        </div>
        {/* Overall score badge */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          background: "var(--c-0f172a)", border: `2px solid ${gradeColor}`,
          borderRadius: 12, padding: "10px 18px", minWidth: 90,
        }}>
          <span style={{ color: gradeColor, fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{grade}</span>
          <span style={{ color: "var(--c-94a3b8)", fontSize: 12, marginTop: 2 }}>{overall.toFixed(0)} / 100</span>
          <span style={{ color: "var(--c-475569)", fontSize: 10, marginTop: 1 }}>Overall</span>
        </div>
      </div>

      {/* 5-pillar grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
      }}>
        {waf.pillars.map(p => (
          <PillarCard key={p.pillar} pillar={p} />
        ))}
      </div>

      <div style={{ marginTop: 14, fontSize: 11, color: "var(--c-334155)", textAlign: "right" }}>
        Generated {new Date(waf.generated_at).toLocaleString()}
      </div>
    </div>
  );
}
