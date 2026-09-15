import React, { useState, useMemo } from "react";
import { ResourceIconImg } from "../utils/resourceIcons";

const COMPLEXITY_COLOR = {
  Low:    "#22c55e",
  Medium: "#eab308",
  High:   "#f97316",
};

const WAVE_META = {
  1: { label: "Wave 1 — Quick Wins",    desc: "Low-complexity changes deliverable in a single sprint",    color: "#22c55e", icon: "⚡" },
  2: { label: "Wave 2 — Core Migrations", desc: "Medium-complexity, 1–3 sprint effort with real savings",  color: "#eab308", icon: "🚀" },
  3: { label: "Wave 3 — Complex Projects","desc": "High-complexity re-architecture — plan carefully",        color: "#f97316", icon: "🏗️" },
};

const PHASE_COLOR = {
  assess:   "#3b82f6",
  prepare:  "#8b5cf6",
  migrate:  "#f59e0b",
  validate: "#10b981",
  optimize: "#22c55e",
};

const SERVICE_ICONS = {
  "microsoft.web/sites":               "🌐",
  "microsoft.app/containerapps":       "📦",
  "microsoft.compute/virtualmachines": "💻",
  "microsoft.storage/storageaccounts": "🗄️",
  "microsoft.sql/servers/databases":   "🛢️",
  "microsoft.sql/managedinstances":    "🛢️",
};

// ── Migration step timeline component ─────────────────────────────────────────
function MigrationSteps({ steps = [] }) {
  if (!steps.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
        Migration Steps
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {steps.map((step, i) => {
          const phaseColor = PHASE_COLOR[step.phase] || "var(--c-64748b)";
          return (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              {/* Phase badge + connector */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 24 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: `${phaseColor}20`, border: `1.5px solid ${phaseColor}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, color: phaseColor, fontWeight: 700, flexShrink: 0,
                }}>
                  {i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div style={{ width: 1, flex: 1, minHeight: 8, background: "var(--c-1e293b)", marginTop: 2 }} />
                )}
              </div>
              <div style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 4 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: phaseColor,
                    textTransform: "uppercase", letterSpacing: "0.4px",
                    background: `${phaseColor}15`, padding: "1px 5px", borderRadius: 3,
                  }}>
                    {step.phase}
                  </span>
                  {step.effort_days > 0 && (
                    <span style={{ fontSize: 9, color: "var(--c-475569)" }}>{step.effort_days}d</span>
                  )}
                </div>
                <div style={{ color: "var(--c-e2e8f0)", fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{step.title}</div>
                {step.detail && (
                  <div style={{ color: "var(--c-64748b)", fontSize: 11, lineHeight: 1.5, marginBottom: step.az_cli ? 4 : 0 }}>
                    {step.detail}
                  </div>
                )}
                {step.az_cli && (
                  <div style={{
                    background: "var(--c-020617)", border: "1px solid var(--c-1e293b)",
                    borderRadius: 6, padding: "6px 10px", marginTop: 4,
                    fontFamily: "monospace", fontSize: 10, color: 'var(--c-38bdf8)',
                    whiteSpace: "pre-wrap", overflowX: "auto",
                  }}>
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

// ── Individual opportunity card ───────────────────────────────────────────────
function OpportunityCard({ opp, showSteps = false }) {
  const [expanded, setExpanded] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const complexColor  = COMPLEXITY_COLOR[opp.complexity] || "var(--c-64748b)";
  const targetIcon    = SERVICE_ICONS[opp.target_service_type] || "🔄";
  const monthlySaving = opp.monthly_cost * (opp.estimated_savings_pct / 100);
  const annualSaving  = monthlySaving * 12;
  const hasMigSteps   = (opp.migration_steps || []).length > 0;

  return (
    <div style={{
      background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)",
      borderRadius: 12, padding: "14px 16px",
      borderLeft: `3px solid ${complexColor}`,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 20, marginTop: 2 }}>{targetIcon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name + complexity badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <ResourceIconImg resourceType={opp.resource_type} size={16} />
            <span style={{ color: "var(--c-f1f5f9)", fontWeight: 600, fontSize: 14 }}>
              {opp.resource_name}
            </span>
            <span style={{
              background: `${complexColor}20`, color: complexColor,
              fontSize: 10, fontWeight: 700, padding: "2px 8px",
              borderRadius: 20, border: `1px solid ${complexColor}40`,
              textTransform: "uppercase", letterSpacing: "0.4px",
            }}>
              {opp.complexity} effort
            </span>
            {opp.estimated_effort_days > 0 && (
              <span style={{ fontSize: 10, color: "var(--c-475569)" }}>
                ~{opp.estimated_effort_days} days
              </span>
            )}
          </div>

          {/* Current → Target */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{ background: "var(--c-1e293b)", color: "var(--c-94a3b8)", fontSize: 11, padding: "3px 8px", borderRadius: 6 }}>
              {opp.current_config}
            </span>
            <span style={{ color: "var(--c-475569)", fontSize: 13 }}>→</span>
            <span style={{ background: "var(--c-0c1a2e)", color: 'var(--c-38bdf8)', fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #1e40af60" }}>
              {opp.target_service}
            </span>
          </div>

          {/* KPIs */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
            {opp.monthly_cost > 0 && (
              <div style={{ fontSize: 12 }}>
                <span style={{ color: "var(--c-64748b)" }}>Current: </span>
                <span style={{ color: "var(--c-f1f5f9)", fontWeight: 600 }}>
                  ${opp.monthly_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
                </span>
              </div>
            )}
            {monthlySaving > 0 && (
              <div style={{ fontSize: 12 }}>
                <span style={{ color: "var(--c-64748b)" }}>Est. Saving: </span>
                <span style={{ color: "#22c55e", fontWeight: 600 }}>
                  ${monthlySaving.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
                  {" "}({opp.estimated_savings_pct.toFixed(0)}%)
                </span>
              </div>
            )}
            {annualSaving > 0 && (
              <div style={{ fontSize: 12 }}>
                <span style={{ color: "var(--c-64748b)" }}>Annual: </span>
                <span style={{ color: 'var(--c-86efac)', fontWeight: 600 }}>
                  ${annualSaving.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr
                </span>
              </div>
            )}
            <div style={{ fontSize: 12 }}>
              <span style={{ color: "var(--c-64748b)" }}>RG: </span>
              <span style={{ color: "var(--c-94a3b8)" }}>{opp.resource_group}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setExpanded(!expanded)} style={{
              background: "none", border: "none", color: "var(--c-475569)",
              cursor: "pointer", fontSize: 11, padding: "2px 0",
            }}>
              {expanded ? "▲ Hide rationale" : "▼ Show benefits & rationale"}
            </button>
            {hasMigSteps && (
              <button onClick={() => setStepsOpen(!stepsOpen)} style={{
                background: stepsOpen ? "var(--c-1e293b)" : "none",
                border: "1px solid var(--c-334155)", color: 'var(--c-38bdf8)',
                cursor: "pointer", fontSize: 11, padding: "2px 8px", borderRadius: 6,
              }}>
                {stepsOpen ? "▲ Hide migration plan" : "📋 Migration plan"}
              </button>
            )}
          </div>

          {/* Expandable: rationale + benefits */}
          {expanded && (
            <div style={{ marginTop: 10 }}>
              <div style={{ color: "var(--c-94a3b8)", fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>{opp.reason}</div>
              {opp.benefits.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
                  {opp.benefits.map((b, i) => (
                    <li key={i} style={{ color: "var(--c-64748b)", fontSize: 12, marginBottom: 3, display: "flex", gap: 6 }}>
                      <span style={{ color: "#22c55e" }}>✓</span>
                      {b}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Expandable: migration steps */}
          {stepsOpen && hasMigSteps && (
            <MigrationSteps steps={opp.migration_steps} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Wave section ──────────────────────────────────────────────────────────────
function WaveSection({ wave, opportunities }) {
  const meta = WAVE_META[wave] || { label: `Wave ${wave}`, color: "var(--c-64748b)", icon: "📌", desc: "" };
  const totalSaving = opportunities.reduce((s, o) => s + o.monthly_cost * o.estimated_savings_pct / 100, 0);
  const totalEffort = opportunities.reduce((s, o) => s + (o.estimated_effort_days || 0), 0);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Wave header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        background: `${meta.color}08`, border: `1px solid ${meta.color}30`,
        borderRadius: 10, padding: "10px 14px", marginBottom: 10,
      }}>
        <span style={{ fontSize: 18 }}>{meta.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: meta.color, fontWeight: 700, fontSize: 14 }}>{meta.label}</div>
          <div style={{ color: "var(--c-64748b)", fontSize: 11 }}>{meta.desc}</div>
        </div>
        <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 14 }}>
              ${totalSaving.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
            </div>
            <div style={{ color: "var(--c-475569)", fontSize: 10 }}>potential savings</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "var(--c-f1f5f9)", fontWeight: 600, fontSize: 14 }}>{opportunities.length}</div>
            <div style={{ color: "var(--c-475569)", fontSize: 10 }}>items</div>
          </div>
          {totalEffort > 0 && (
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "var(--c-94a3b8)", fontWeight: 600, fontSize: 14 }}>~{totalEffort}d</div>
              <div style={{ color: "var(--c-475569)", fontSize: 10 }}>est. effort</div>
            </div>
          )}
        </div>
      </div>

      {/* Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 4 }}>
        {opportunities.map((o, i) => (
          <OpportunityCard key={o.resource_id + i} opp={o} />
        ))}
      </div>
    </div>
  );
}

// ── CSV export helper ─────────────────────────────────────────────────────────
function exportCSV(opportunities) {
  const header = ["Resource Name","Resource Group","Type","Current Config","Target Service","Complexity","Est. Saving $/mo","Est. Saving %","Migration Wave","Est. Effort Days","Subscription"];
  const rows = opportunities.map(o => [
    o.resource_name, o.resource_group, o.resource_type,
    o.current_config, o.target_service, o.complexity,
    (o.monthly_cost * o.estimated_savings_pct / 100).toFixed(2),
    o.estimated_savings_pct.toFixed(0),
    o.migration_wave ?? "",
    o.estimated_effort_days ?? "",
    o.subscription_id ?? "",
  ]);
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c ?? "").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "migration-plan.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ── Main panel ────────────────────────────────────────────────────────────────
const COMPLEXITY_FILTERS = ["All", "Low", "Medium", "High"];
const VIEW_MODES = [
  { id: "roadmap",    label: "📍 Roadmap" },
  { id: "list",       label: "📋 List" },
];

export default function ModernizationPanel({ modernizationOpportunities = [] }) {
  const [viewMode,     setViewMode]     = useState("roadmap");
  const [complexFilter, setComplexFilter] = useState("All");

  const filtered = useMemo(() =>
    modernizationOpportunities.filter(o =>
      complexFilter === "All" || o.complexity === complexFilter
    ),
    [modernizationOpportunities, complexFilter]
  );

  const totalSavings = useMemo(() =>
    modernizationOpportunities.reduce((s, o) => s + o.monthly_cost * o.estimated_savings_pct / 100, 0),
    [modernizationOpportunities]
  );

  const byWave = useMemo(() => {
    const waves = {};
    filtered.forEach(o => {
      const w = o.migration_wave ?? 2;
      if (!waves[w]) waves[w] = [];
      waves[w].push(o);
    });
    return waves;
  }, [filtered]);

  const byComplexity = useMemo(() => {
    const c = { Low: 0, Medium: 0, High: 0 };
    modernizationOpportunities.forEach(o => { if (c[o.complexity] !== undefined) c[o.complexity]++; });
    return c;
  }, [modernizationOpportunities]);

  const totalEffort = useMemo(() =>
    modernizationOpportunities.reduce((s, o) => s + (o.estimated_effort_days || 0), 0),
    [modernizationOpportunities]
  );

  if (!modernizationOpportunities.length) return null;

  return (
    <div style={{ background: "var(--c-0d1117)", border: "1px solid var(--c-1e293b)", borderRadius: 16, padding: "20px 24px" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ color: "var(--c-f1f5f9)", margin: 0, fontSize: 18, fontWeight: 700 }}>
            🔄 IaaS → PaaS Migration Planner
          </h2>
          <p style={{ color: "var(--c-64748b)", margin: "4px 0 0", fontSize: 13 }}>
            {modernizationOpportunities.length} opportunities identified · up to{" "}
            <span style={{ color: "#22c55e", fontWeight: 600 }}>
              ${totalSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
            </span>{" "}
            in potential savings · est. {totalEffort} days total effort
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Complexity badges */}
          {Object.entries(byComplexity).filter(([, v]) => v > 0).map(([key, val]) => (
            <div key={key} style={{
              background: `${COMPLEXITY_COLOR[key]}15`, border: `1px solid ${COMPLEXITY_COLOR[key]}40`,
              color: COMPLEXITY_COLOR[key], borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 600,
            }}>
              {val} {key}
            </div>
          ))}
          {/* CSV Export */}
          <button onClick={() => exportCSV(modernizationOpportunities)} style={{
            background: "var(--c-1e293b)", border: "1px solid var(--c-334155)", color: "var(--c-94a3b8)",
            borderRadius: 8, padding: "4px 12px", cursor: "pointer", fontSize: 12,
          }}>
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "Monthly Savings", value: `$${totalSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: "#22c55e" },
          { label: "Annual Savings",  value: `$${(totalSavings * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: '#86efac' },
          { label: "Quick Wins (Wave 1)", value: (byWave[1] || []).length, color: "#22c55e" },
          { label: "Est. Total Effort",   value: `${totalEffort} days`, color: "var(--c-94a3b8)" },
        ].map((kpi, i) => (
          <div key={i} style={{
            background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)",
            borderRadius: 8, padding: "10px 14px", minWidth: 120,
          }}>
            <div style={{ color: "var(--c-475569)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>{kpi.label}</div>
            <div style={{ color: kpi.color, fontWeight: 700, fontSize: 18 }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* ── View mode + filter bar ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {/* View toggle */}
        <div style={{ display: "flex", background: "var(--c-0f172a)", borderRadius: 8, padding: 4, border: "1px solid var(--c-1e293b)" }}>
          {VIEW_MODES.map(vm => (
            <button key={vm.id} onClick={() => setViewMode(vm.id)} style={{
              background: viewMode === vm.id ? "var(--c-1e293b)" : "none",
              border: "none", color: viewMode === vm.id ? "var(--c-f1f5f9)" : "var(--c-64748b)",
              borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12,
              fontWeight: viewMode === vm.id ? 700 : 400,
            }}>
              {vm.label}
            </button>
          ))}
        </div>

        {/* Complexity filter (only for list view) */}
        {viewMode === "list" && (
          <div style={{ display: "flex", gap: 4, background: "var(--c-0f172a)", borderRadius: 8, padding: 4, border: "1px solid var(--c-1e293b)" }}>
            {COMPLEXITY_FILTERS.map(f => (
              <button key={f} onClick={() => setComplexFilter(f)} style={{
                background: complexFilter === f ? "var(--c-1e293b)" : "none", border: "none",
                color: complexFilter === f ? (COMPLEXITY_COLOR[f] || "var(--c-f1f5f9)") : "var(--c-64748b)",
                borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12,
                fontWeight: complexFilter === f ? 700 : 400,
              }}>
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      {viewMode === "roadmap" ? (
        <div>
          {[1, 2, 3].map(wave => {
            const items = byWave[wave] || [];
            if (!items.length) return null;
            return <WaveSection key={wave} wave={wave} opportunities={items} />;
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((o, i) => (
            <OpportunityCard key={o.resource_id + i} opp={o} />
          ))}
        </div>
      )}

    </div>
  );
}

