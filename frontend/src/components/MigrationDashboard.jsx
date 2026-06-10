/**
 * MigrationDashboard — Comprehensive migration assessment with 5R framework,
 * wave planner, listing view, risk scoring, and category breakdown.
 * Calls /api/migration/assessment for data.
 */
import React, { useState, useEffect, useMemo } from "react";
import { RefreshCw, Wrench, Landmark, Hammer, Trash2, Pin, BarChart3, Waves, ClipboardList, Target, Zap, Rocket, HardHat } from "lucide-react";
import { ResourceIconImg } from "../utils/resourceIcons";

const API = import.meta.env.VITE_API_URL || '';

// ── Constants ────────────────────────────────────────────────────────────────
const FIVE_R = {
  Rehost:      { color: "#22c55e", Icon: RefreshCw, desc: "Lift-and-shift" },
  Refactor:    { color: "#38bdf8", Icon: Wrench, desc: "Managed PaaS" },
  Rearchitect: { color: "#a78bfa", Icon: Landmark, desc: "Cloud-native redesign" },
  Rebuild:     { color: "#f59e0b", Icon: Hammer, desc: "Full rewrite" },
  Retire:      { color: "#ef4444", Icon: Trash2, desc: "Decommission" },
  Retain:      { color: "#64748b", Icon: Pin, desc: "Keep as-is" },
};

const WAVE_COLOR = { 0: "#ef4444", 1: "#22c55e", 2: "#eab308", 3: "#f97316" };
const COMPLEXITY_COLOR = { Low: "#22c55e", Medium: "#eab308", High: "#f97316" };
const RISK_COLOR = (r) => r >= 60 ? "#ef4444" : r >= 30 ? "#eab308" : "#22c55e";

const PHASE_COLOR = {
  assess: "#3b82f6", prepare: "#8b5cf6", migrate: "#f59e0b",
  validate: "#10b981", optimize: "#22c55e",
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function KpiTile({ label, value, sub, color = "#f1f5f9" }) {
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b",
      borderRadius: 10, padding: "12px 16px", minWidth: 130, flex: 1,
    }}>
      <div style={{ color: "#475569", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontWeight: 800, fontSize: 22 }}>{value}</div>
      {sub && <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function RiskBar({ score }) {
  const col = RISK_COLOR(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 40, height: 5, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: col, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 10, color: col, fontWeight: 600 }}>{score}</span>
    </div>
  );
}

function Badge({ label, color }) {
  return (
    <span style={{
      background: `${color}18`, color, border: `1px solid ${color}40`,
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
      textTransform: "uppercase", letterSpacing: "0.4px",
    }}>
      {label}
    </span>
  );
}

function DonutSmall({ pct, color, size = 48 }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * (pct / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth={4} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ * 0.25} strokeLinecap="round" />
      <text x={size/2} y={size/2 + 4} textAnchor="middle" fill={color} fontSize={11} fontWeight={700}>
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

// ── Migration Step Timeline ─────────────────────────────────────────────────
function MigrationSteps({ steps = [] }) {
  if (!steps.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ color: "#64748b", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Migration Steps</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {steps.map((step, i) => {
          const pc = PHASE_COLOR[step.phase] || "#64748b";
          return (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 22 }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: `${pc}20`, border: `1.5px solid ${pc}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: pc, fontWeight: 700 }}>{i + 1}</div>
                {i < steps.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 6, background: "#1e293b", marginTop: 2 }} />}
              </div>
              <div style={{ flex: 1, paddingBottom: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 1 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: pc, textTransform: "uppercase", letterSpacing: "0.4px", background: `${pc}15`, padding: "1px 5px", borderRadius: 3 }}>{step.phase}</span>
                  {step.effort_days > 0 && <span style={{ fontSize: 9, color: "#475569" }}>{step.effort_days}d</span>}
                </div>
                <div style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600 }}>{step.title}</div>
                {step.detail && <div style={{ color: "#64748b", fontSize: 10, lineHeight: 1.5 }}>{step.detail}</div>}
                {step.az_cli && (
                  <div style={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 6, padding: "4px 8px", marginTop: 3, fontFamily: "monospace", fontSize: 9, color: "#38bdf8", whiteSpace: "pre-wrap", overflowX: "auto" }}>
                    {step.az_cli}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 5R Donut Chart ──────────────────────────────────────────────────────────
function FiveRChart({ summary }) {
  const total = summary.reduce((s, r) => s + r.count, 0) || 1;
  let cumPct = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={120} height={120} viewBox="0 0 120 120">
        {summary.map((r, i) => {
          const pct = r.count / total * 100;
          const circ = 2 * Math.PI * 50;
          const dash = circ * (pct / 100);
          const offset = circ * 0.25 - circ * (cumPct / 100);
          cumPct += pct;
          const col = FIVE_R[r.category]?.color || "#64748b";
          return <circle key={i} cx={60} cy={60} r={50} fill="none" stroke={col} strokeWidth={14}
            strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={offset} />;
        })}
        <text x={60} y={56} textAnchor="middle" fill="#f1f5f9" fontSize={18} fontWeight={800}>{total}</text>
        <text x={60} y={72} textAnchor="middle" fill="#475569" fontSize={9}>resources</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {summary.map((r, i) => {
          const meta = FIVE_R[r.category] || FIVE_R.Retain;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: meta.color, flexShrink: 0 }} />
              <span style={{ color: "#e2e8f0", fontWeight: 600, minWidth: 70 }}>{r.category}</span>
              <span style={{ color: "#64748b" }}>{r.count}</span>
              {r.potential_savings > 0 && <span style={{ color: "#22c55e", fontSize: 10 }}>${Math.round(r.potential_savings).toLocaleString()}/mo</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Opportunity Row (table mode) ────────────────────────────────────────────
function OpportunityRow({ opp, onClick }) {
  const savingMo = opp.monthly_cost * (opp.estimated_savings_pct / 100);
  const fiveR = FIVE_R[opp.five_r] || FIVE_R.Retain;
  const waveColor = WAVE_COLOR[opp.migration_wave] || "#64748b";
  return (
    <tr onClick={onClick} style={{ cursor: "pointer", borderBottom: "1px solid #1e293b" }}
      onMouseEnter={(e) => e.currentTarget.style.background = "#1e293b30"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      <td style={{ padding: "8px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ResourceIconImg resourceType={opp.resource_type} size={16} />
          <div>
            <div style={{ color: "#f1f5f9", fontSize: 12, fontWeight: 600 }}>{opp.resource_name}</div>
            <div style={{ color: "#475569", fontSize: 10 }}>{opp.resource_group}</div>
          </div>
        </div>
      </td>
      <td style={{ padding: "8px 6px" }}>
        <Badge label={opp.five_r || "Retain"} color={fiveR.color} />
      </td>
      <td style={{ padding: "8px 6px" }}>
        <span style={{ color: "#94a3b8", fontSize: 11 }}>{opp.current_config?.split("(")[0]?.trim()}</span>
      </td>
      <td style={{ padding: "8px 6px" }}>
        <span style={{ color: "#38bdf8", fontSize: 11 }}>{opp.target_service}</span>
      </td>
      <td style={{ padding: "8px 6px" }}>
        <Badge label={`W${opp.migration_wave}`} color={waveColor} />
      </td>
      <td style={{ padding: "8px 6px" }}>
        <Badge label={opp.complexity} color={COMPLEXITY_COLOR[opp.complexity] || "#64748b"} />
      </td>
      <td style={{ padding: "8px 6px", textAlign: "right" }}>
        <div style={{ color: "#f1f5f9", fontSize: 12, fontWeight: 600 }}>${Math.round(opp.monthly_cost).toLocaleString()}</div>
      </td>
      <td style={{ padding: "8px 6px", textAlign: "right" }}>
        {savingMo > 0 && <div style={{ color: "#22c55e", fontSize: 12, fontWeight: 600 }}>${Math.round(savingMo).toLocaleString()}/mo</div>}
      </td>
      <td style={{ padding: "8px 6px" }}>
        <RiskBar score={opp.risk_score || 0} />
      </td>
      <td style={{ padding: "8px 6px", textAlign: "center" }}>
        <span style={{ color: "#475569", fontSize: 11 }}>{opp.estimated_effort_days || "—"}d</span>
      </td>
    </tr>
  );
}

// ── Detail Side Panel ───────────────────────────────────────────────────────
function DetailPanel({ opp, onClose }) {
  if (!opp) return null;
  const savingMo = opp.monthly_cost * (opp.estimated_savings_pct / 100);
  const fiveR = FIVE_R[opp.five_r] || FIVE_R.Retain;
  return (
    <div style={{
      position: "fixed", top: 0, right: 0, width: 500, height: "100vh",
      background: "#0d1117", borderLeft: "1px solid #1e293b", zIndex: 1000,
      overflowY: "auto", padding: "20px 24px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ color: "#f1f5f9", margin: 0, fontSize: 16, fontWeight: 700 }}>{opp.resource_name}</h3>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 18 }}>✕</button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <Badge label={opp.five_r || "Retain"} color={fiveR.color} />
        <Badge label={opp.complexity} color={COMPLEXITY_COLOR[opp.complexity] || "#64748b"} />
        <Badge label={`Wave ${opp.migration_wave}`} color={WAVE_COLOR[opp.migration_wave] || "#64748b"} />
        <Badge label={opp.migration_category || "compute"} color="#64748b" />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <KpiTile label="Current Cost" value={`$${Math.round(opp.monthly_cost).toLocaleString()}`} sub="/month" color="#f1f5f9" />
        <KpiTile label="Est. Saving" value={`$${Math.round(savingMo).toLocaleString()}`} sub={`${opp.estimated_savings_pct}% /month`} color="#22c55e" />
        <KpiTile label="Risk" value={opp.risk_score || 0} color={RISK_COLOR(opp.risk_score || 0)} />
        <KpiTile label="Effort" value={`${opp.estimated_effort_days || 0}d`} color="#94a3b8" />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ color: "#64748b", fontSize: 11, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Current → Target</div>
        <div style={{ background: "#1e293b", borderRadius: 8, padding: "10px 14px", marginBottom: 6 }}>
          <div style={{ color: "#94a3b8", fontSize: 12 }}>{opp.current_config}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
          <span style={{ color: "#475569", fontSize: 16 }}>↓</span>
        </div>
        <div style={{ background: "#0c1a2e", border: "1px solid #1e40af60", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ color: "#38bdf8", fontSize: 12, fontWeight: 600 }}>{opp.target_service}</div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ color: "#64748b", fontSize: 11, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Rationale</div>
        <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.7 }}>{opp.reason}</div>
      </div>

      {opp.benefits?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: "#64748b", fontSize: 11, fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Benefits</div>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {opp.benefits.map((b, i) => (
              <li key={i} style={{ color: "#94a3b8", fontSize: 12, marginBottom: 4, display: "flex", gap: 6 }}>
                <span style={{ color: "#22c55e" }}>✓</span>{b}
              </li>
            ))}
          </ul>
        </div>
      )}

      <MigrationSteps steps={opp.migration_steps || []} />
    </div>
  );
}

// ── CSV Export ───────────────────────────────────────────────────────────────
function exportCSV(opps) {
  const header = ["Resource","RG","Type","5R","Current","Target","Wave","Complexity","Cost $/mo","Saving $/mo","Saving %","Risk","Effort Days","Category"];
  const rows = opps.map(o => [
    o.resource_name, o.resource_group, o.resource_type, o.five_r || "Retain",
    o.current_config, o.target_service, o.migration_wave, o.complexity,
    (o.monthly_cost || 0).toFixed(2),
    (o.monthly_cost * o.estimated_savings_pct / 100).toFixed(2),
    o.estimated_savings_pct?.toFixed(0) ?? "", o.risk_score ?? "", o.estimated_effort_days ?? "",
    o.migration_category || "",
  ]);
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "migration-assessment.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ── Main Component ──────────────────────────────────────────────────────────
const VIEW_MODES = [
  { id: "overview", label: "Overview", Icon: BarChart3 },
  { id: "waves",    label: "Wave Planner", Icon: Waves },
  { id: "list",     label: "Listing", Icon: ClipboardList },
  { id: "5r",       label: "5R Framework", Icon: Target },
];

const FILTER_OPTIONS = {
  wave:       [{ v: "all", l: "All Waves" }, { v: "1", l: "W1" }, { v: "2", l: "W2" }, { v: "3", l: "W3" }],
  complexity: [{ v: "all", l: "All" }, { v: "Low", l: "Low" }, { v: "Medium", l: "Med" }, { v: "High", l: "High" }],
  fiveR:      [{ v: "all", l: "All 5R" }, ...Object.keys(FIVE_R).map(k => ({ v: k, l: k }))],
  category:   [{ v: "all", l: "All Categories" }, { v: "compute", l: "Compute" }, { v: "database", l: "Database" }, { v: "storage", l: "Storage" }, { v: "container", l: "Container" }, { v: "app_platform", l: "App Platform" }],
};

export default function MigrationDashboard({ legacyOpps = [] }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState("overview");
  const [filters, setFilters] = useState({ wave: "all", complexity: "all", fiveR: "all", category: "all", search: "" });
  const [sort, setSort] = useState({ key: "savings", dir: "desc" });
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/migration/assessment`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => { setData(d); setError(null); })
      .catch(e => {
        console.warn("Migration assessment API not available, using legacy data", e);
        setError(null);
        // Fall back to legacy ModernizationOpportunity data
        if (legacyOpps.length > 0) {
          setData({
            total_resources_assessed: 0, total_opportunities: legacyOpps.length,
            total_monthly_savings: legacyOpps.reduce((s, o) => s + (o.monthly_cost || 0) * ((o.estimated_savings_pct || 0) / 100), 0),
            total_annual_savings: 0, total_effort_days: legacyOpps.reduce((s, o) => s + (o.estimated_effort_days || 0), 0),
            migration_readiness_pct: 0, iaas_pct: 0, paas_pct: 0,
            five_r_summary: [], category_summary: [],
            wave_groups: [], opportunities: legacyOpps,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const opps = useMemo(() => data?.opportunities || [], [data]);
  const filtered = useMemo(() => {
    let f = opps;
    if (filters.wave !== "all") f = f.filter(o => String(o.migration_wave) === filters.wave);
    if (filters.complexity !== "all") f = f.filter(o => o.complexity === filters.complexity);
    if (filters.fiveR !== "all") f = f.filter(o => (o.five_r || "Retain") === filters.fiveR);
    if (filters.category !== "all") f = f.filter(o => (o.migration_category || "compute") === filters.category);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      f = f.filter(o => (o.resource_name || "").toLowerCase().includes(q) || (o.resource_group || "").toLowerCase().includes(q) || (o.target_service || "").toLowerCase().includes(q));
    }
    // Sort
    const mul = sort.dir === "desc" ? -1 : 1;
    const sortFns = {
      name:       (a, b) => (a.resource_name || "").localeCompare(b.resource_name || "") * mul,
      cost:       (a, b) => ((a.monthly_cost || 0) - (b.monthly_cost || 0)) * mul,
      savings:    (a, b) => ((a.monthly_cost * a.estimated_savings_pct / 100) - (b.monthly_cost * b.estimated_savings_pct / 100)) * mul,
      risk:       (a, b) => ((a.risk_score || 0) - (b.risk_score || 0)) * mul,
      effort:     (a, b) => ((a.estimated_effort_days || 0) - (b.estimated_effort_days || 0)) * mul,
      wave:       (a, b) => ((a.migration_wave || 0) - (b.migration_wave || 0)) * mul,
      complexity: (a, b) => ({ Low: 1, Medium: 2, High: 3 }[a.complexity] - { Low: 1, Medium: 2, High: 3 }[b.complexity]) * mul,
    };
    return [...f].sort(sortFns[sort.key] || sortFns.savings);
  }, [opps, filters, sort]);

  const toggleSort = (key) => setSort(prev => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }));

  if (loading) {
    return (
      <div style={{ background: "#0d1117", border: "1px solid #1e293b", borderRadius: 16, padding: "40px 24px", textAlign: "center" }}>
        <div style={{ color: "#38bdf8", fontSize: 24, marginBottom: 8 }}>🔄</div>
        <div style={{ color: "#94a3b8", fontSize: 14 }}>Analysing migration opportunities...</div>
        <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>Evaluating 12 migration patterns with 5R classification</div>
      </div>
    );
  }

  if (!data || opps.length === 0) {
    return (
      <div style={{ background: "#0d1117", border: "1px solid #1e293b", borderRadius: 16, padding: "40px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
        <div style={{ color: "#22c55e", fontSize: 16, fontWeight: 600 }}>No migration opportunities detected</div>
        <div style={{ color: "#475569", fontSize: 12, marginTop: 4 }}>Your estate is already well-optimised or using modern Azure services</div>
      </div>
    );
  }

  const totalSavings = data.total_monthly_savings || opps.reduce((s, o) => s + o.monthly_cost * o.estimated_savings_pct / 100, 0);

  return (
    <div style={{ background: "#0d1117", border: "1px solid #1e293b", borderRadius: 16, padding: "20px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: 18, fontWeight: 700 }}>
            🔄 Migration Assessment Centre
          </h2>
          <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: 12 }}>
            {opps.length} opportunities across {(data.category_summary || []).length} categories ·{" "}
            <span style={{ color: "#22c55e", fontWeight: 600 }}>
              ${Math.round(totalSavings).toLocaleString()}/mo
            </span> potential savings
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {VIEW_MODES.map(m => (
            <button key={m.id} onClick={() => setViewMode(m.id)} style={{
              background: viewMode === m.id ? "#1e293b" : "transparent",
              border: `1px solid ${viewMode === m.id ? "#334155" : "#1e293b"}`,
              color: viewMode === m.id ? "#f1f5f9" : "#475569",
              fontSize: 11, padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 600,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <m.Icon size={13} /> {m.label}
            </button>
          ))}
          <button onClick={() => exportCSV(opps)} style={{
            background: "#1e293b", border: "1px solid #334155", color: "#94a3b8",
            borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 11,
          }}>
            ⬇ CSV
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <KpiTile label="Monthly Savings" value={`$${Math.round(totalSavings).toLocaleString()}`} color="#22c55e" />
        <KpiTile label="Annual Savings" value={`$${Math.round(totalSavings * 12).toLocaleString()}`} color="#86efac" />
        <KpiTile label="Opportunities" value={opps.length} sub={`${opps.filter(o => o.migration_wave === 1).length} quick wins`} color="#38bdf8" />
        <KpiTile label="Est. Effort" value={`${data.total_effort_days || opps.reduce((s, o) => s + (o.estimated_effort_days || 0), 0)}d`} color="#94a3b8" />
        {data.iaas_pct > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "8px 14px", minWidth: 130 }}>
            <DonutSmall pct={data.paas_pct} color="#38bdf8" />
            <div>
              <div style={{ color: "#475569", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>PaaS Ratio</div>
              <div style={{ color: "#f1f5f9", fontSize: 11 }}>{Math.round(data.paas_pct)}% PaaS · {Math.round(data.iaas_pct)}% IaaS</div>
            </div>
          </div>
        )}
      </div>

      {/* ── OVERVIEW VIEW ── */}
      {viewMode === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* 5R Distribution */}
          {(data.five_r_summary || []).length > 0 && (
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>5R Classification</div>
              <FiveRChart summary={data.five_r_summary} />
            </div>
          )}

          {/* Category Breakdown */}
          {(data.category_summary || []).length > 0 && (
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>By Category</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.category_summary.map((c, i) => {
                  const maxSav = Math.max(...data.category_summary.map(x => x.potential_savings || 1));
                  const pct = (c.potential_savings / maxSav) * 100;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <ResourceIconImg type={c.category} size={20} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, textTransform: "capitalize" }}>{c.category.replace("_", " ")}</span>
                          <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 600 }}>${Math.round(c.potential_savings).toLocaleString()}/mo</span>
                        </div>
                        <div style={{ height: 4, background: "#1e293b", borderRadius: 2 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "#38bdf8", borderRadius: 2 }} />
                        </div>
                        <div style={{ color: "#475569", fontSize: 10, marginTop: 1 }}>{c.count} opportunities · ${Math.round(c.total_cost).toLocaleString()}/mo current</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Wave Summary */}
          <div style={{ gridColumn: "1 / -1", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Migration Waves</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {(data.wave_groups || []).map((wg, i) => {
                const wc = WAVE_COLOR[wg.wave] || "#64748b";
                return (
                  <div key={i} style={{ flex: 1, minWidth: 160, background: `${wc}08`, border: `1px solid ${wc}25`, borderRadius: 10, padding: "14px 16px", cursor: "pointer" }}
                    onClick={() => { setFilters(f => ({ ...f, wave: String(wg.wave) })); setViewMode("list"); }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: wc, fontSize: 13, fontWeight: 700 }}>Wave {wg.wave}</span>
                      <span style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 800 }}>{wg.total_resources}</span>
                    </div>
                    <div style={{ color: "#64748b", fontSize: 10, marginBottom: 6 }}>{wg.description}</div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <div><span style={{ color: "#22c55e", fontSize: 12, fontWeight: 700 }}>${Math.round(wg.total_savings).toLocaleString()}</span><span style={{ color: "#475569", fontSize: 10 }}>/mo</span></div>
                      <div><span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>{wg.total_effort_days}d</span><span style={{ color: "#475569", fontSize: 10 }}> effort</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── WAVE PLANNER VIEW ── */}
      {viewMode === "waves" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {(data.wave_groups || []).map((wg, i) => {
            const wc = WAVE_COLOR[wg.wave] || "#64748b";
            return (
              <div key={i}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: `${wc}08`, border: `1px solid ${wc}30`, borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
                  {React.createElement(wg.wave === 1 ? Zap : wg.wave === 2 ? Rocket : wg.wave === 3 ? HardHat : Target, { size: 18, style: { color: wc } })}
                  <div style={{ flex: 1 }}>
                    <div style={{ color: wc, fontWeight: 700, fontSize: 14 }}>{wg.label}</div>
                    <div style={{ color: "#64748b", fontSize: 11 }}>{wg.description}</div>
                  </div>
                  <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 14 }}>${Math.round(wg.total_savings).toLocaleString()}/mo</div>
                      <div style={{ color: "#475569", fontSize: 10 }}>savings</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 14 }}>{wg.total_resources}</div>
                      <div style={{ color: "#475569", fontSize: 10 }}>items</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#94a3b8", fontWeight: 600, fontSize: 14 }}>~{wg.total_effort_days}d</div>
                      <div style={{ color: "#475569", fontSize: 10 }}>effort</div>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 4 }}>
                  {(wg.items || []).map((o, j) => {
                    const savMo = o.monthly_cost * o.estimated_savings_pct / 100;
                    const fR = FIVE_R[o.five_r] || FIVE_R.Retain;
                    return (
                      <div key={j} onClick={() => setSelected(o)} style={{
                        background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10,
                        padding: "10px 14px", cursor: "pointer", borderLeft: `3px solid ${COMPLEXITY_COLOR[o.complexity] || "#64748b"}`,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <ResourceIconImg resourceType={o.resource_type} size={16} />
                          <span style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600 }}>{o.resource_name}</span>
                          <Badge label={o.five_r || "Retain"} color={fR.color} />
                          <Badge label={o.complexity} color={COMPLEXITY_COLOR[o.complexity] || "#64748b"} />
                          <RiskBar score={o.risk_score || 0} />
                        </div>
                        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#64748b" }}>
                          <span>{o.current_config?.split("(")[0]?.trim()}</span>
                          <span style={{ color: "#475569" }}>→</span>
                          <span style={{ color: "#38bdf8" }}>{o.target_service}</span>
                          {savMo > 0 && <span style={{ color: "#22c55e", fontWeight: 600, marginLeft: "auto" }}>${Math.round(savMo).toLocaleString()}/mo</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── LISTING VIEW ── */}
      {viewMode === "list" && (
        <>
          {/* Filter bar */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <input
              type="text" placeholder="Search resources..."
              value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#f1f5f9", padding: "5px 12px", fontSize: 12, minWidth: 180 }}
            />
            {Object.entries(FILTER_OPTIONS).map(([key, opts]) => (
              <select key={key} value={filters[key]} onChange={e => setFilters(f => ({ ...f, [key]: e.target.value }))}
                style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, color: "#94a3b8", padding: "5px 10px", fontSize: 11 }}>
                {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            ))}
            <span style={{ color: "#475569", fontSize: 11, alignSelf: "center", marginLeft: 8 }}>{filtered.length} results</span>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  {[
                    { key: "name", label: "Resource" }, { key: null, label: "5R" },
                    { key: null, label: "Current" }, { key: null, label: "Target" },
                    { key: "wave", label: "Wave" }, { key: "complexity", label: "Complexity" },
                    { key: "cost", label: "Cost" }, { key: "savings", label: "Saving" },
                    { key: "risk", label: "Risk" }, { key: "effort", label: "Effort" },
                  ].map((col, i) => (
                    <th key={i} onClick={() => col.key && toggleSort(col.key)} style={{
                      padding: "6px 6px", textAlign: col.key === "cost" || col.key === "savings" ? "right" : "left",
                      color: sort.key === col.key ? "#38bdf8" : "#475569", fontSize: 10, fontWeight: 700,
                      textTransform: "uppercase", cursor: col.key ? "pointer" : "default",
                      userSelect: "none", whiteSpace: "nowrap",
                    }}>
                      {col.label}{sort.key === col.key && (sort.dir === "desc" ? " ▼" : " ▲")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((o, i) => (
                  <OpportunityRow key={o.resource_id + i} opp={o} onClick={() => setSelected(o)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── 5R FRAMEWORK VIEW ── */}
      {viewMode === "5r" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {(data.five_r_summary?.length > 0 ? data.five_r_summary : [{ category: "Retain", count: opps.length, total_cost: 0, potential_savings: 0, description: "" }]).map((rSum, i) => {
            const meta = FIVE_R[rSum.category] || FIVE_R.Retain;
            const items = opps.filter(o => (o.five_r || "Retain") === rSum.category);
            return (
              <div key={i} style={{ background: "#0f172a", border: `1px solid ${meta.color}25`, borderRadius: 12, padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <meta.Icon size={22} style={{ color: meta.color }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: meta.color, fontWeight: 700, fontSize: 15 }}>{rSum.category}</div>
                    <div style={{ color: "#64748b", fontSize: 11 }}>{rSum.description || meta.desc}</div>
                  </div>
                  <div style={{ display: "flex", gap: 14 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 18 }}>{rSum.count}</div>
                      <div style={{ color: "#475569", fontSize: 10 }}>resources</div>
                    </div>
                    {rSum.potential_savings > 0 && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 16 }}>${Math.round(rSum.potential_savings).toLocaleString()}</div>
                        <div style={{ color: "#475569", fontSize: 10 }}>/mo savings</div>
                      </div>
                    )}
                  </div>
                </div>
                {items.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {items.slice(0, 8).map((o, j) => {
                      const savMo = o.monthly_cost * o.estimated_savings_pct / 100;
                      return (
                        <div key={j} onClick={() => setSelected(o)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, cursor: "pointer", background: "#0d1117", border: "1px solid #1e293b" }}>
                          <ResourceIconImg resourceType={o.resource_type} size={14} />
                          <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600, flex: 1 }}>{o.resource_name}</span>
                          <span style={{ color: "#64748b", fontSize: 10 }}>{o.resource_group}</span>
                          <Badge label={o.complexity} color={COMPLEXITY_COLOR[o.complexity] || "#64748b"} />
                          {savMo > 0 && <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 600 }}>${Math.round(savMo).toLocaleString()}/mo</span>}
                        </div>
                      );
                    })}
                    {items.length > 8 && (
                      <div style={{ color: "#475569", fontSize: 11, paddingLeft: 10, cursor: "pointer" }}
                        onClick={() => { setFilters(f => ({ ...f, fiveR: rSum.category })); setViewMode("list"); }}>
                        +{items.length - 8} more → view all
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Panel */}
      {selected && <DetailPanel opp={selected} onClose={() => setSelected(null)} />}
      {selected && <div onClick={() => setSelected(null)} style={{ position: "fixed", top: 0, left: 0, right: 500, bottom: 0, background: "#00000060", zIndex: 999 }} />}
    </div>
  );
}
