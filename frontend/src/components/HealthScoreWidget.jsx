/**
 * HealthScoreWidget — Donut-style composite health score display.
 * Fetches from /api/health-score and shows score, grade, breakdown.
 */
import React, { useState, useEffect } from "react";
import { Activity, ChevronDown } from "lucide-react";
import { api } from "../api/client";

const GRADE_COLOR = { A: "#22c55e", B: "#84cc16", C: "#eab308", D: "#f97316", F: "#ef4444" };
const DIM_LABEL = { orphans: "Orphan Cleanup", waste: "Waste Reduction", advisor: "Advisor Compliance", reservations: "RI Coverage", health: "Resource Health" };

function ScoreDonut({ score, grade, size = 100 }) {
  const color = GRADE_COLOR[grade] || "#64748b";
  const r = 38, circ = 2 * Math.PI * r;
  const offset = circ - (circ * Math.min(score, 100)) / 100;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#1e293b" strokeWidth="8" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform="rotate(-90 50 50)" style={{ transition: "stroke-dashoffset 1s ease" }} />
      <text x="50" y="46" textAnchor="middle" fill={color} fontSize="22" fontWeight="800">{Math.round(score)}</text>
      <text x="50" y="60" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="600">{grade}</text>
    </svg>
  );
}

export default function HealthScoreWidget() {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.getHealthScore().then(setData).catch(() => {});
  }, []);

  if (!data || data.score == null) return null;

  const color = GRADE_COLOR[data.grade] || "#64748b";

  return (
    <div style={{
      background: "#0d1117", border: `1px solid ${color}30`, borderRadius: 14,
      padding: "16px 20px", minWidth: 220,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ScoreDonut score={data.score} grade={data.grade} size={80} />
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Activity size={14} style={{ color }} />
            <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>Infrastructure Health</span>
          </div>
          <div style={{ color, fontWeight: 700, fontSize: 13 }}>{data.label}</div>
          <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
            {data.total_resources} resources · ${Math.round(data.total_monthly_cost).toLocaleString()}/mo
          </div>
          {data.total_savings_potential > 0 && (
            <div style={{ color: "#22c55e", fontSize: 11, fontWeight: 600 }}>
              ${Math.round(data.total_savings_potential).toLocaleString()}/mo savings available
            </div>
          )}
        </div>
      </div>

      {/* Expandable breakdown */}
      {data.breakdown && Object.keys(data.breakdown).length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setExpanded(!expanded)} style={{
            background: "none", border: "none", color: "#475569", fontSize: 10, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4, padding: 0, fontWeight: 600,
          }}>
            <ChevronDown size={11} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            Score Breakdown
          </button>
          {expanded && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(data.breakdown).map(([key, val]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#94a3b8", fontSize: 10, minWidth: 100 }}>{DIM_LABEL[key] || key}</span>
                  <div style={{ flex: 1, height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{
                      width: `${val}%`, height: "100%", borderRadius: 2,
                      background: val >= 80 ? "#22c55e" : val >= 60 ? "#eab308" : "#ef4444",
                    }} />
                  </div>
                  <span style={{ color: "#e2e8f0", fontSize: 10, fontWeight: 700, minWidth: 28, textAlign: "right" }}>{val}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
