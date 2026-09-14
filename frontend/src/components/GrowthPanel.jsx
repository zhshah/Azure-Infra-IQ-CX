import React, { useState, useMemo } from "react";
import { ResourceIconImg } from "../utils/resourceIcons";

// ── Constants ──────────────────────────────────────────────────────────────────

const SEV_COLOR = {
  critical: "#ef4444",
  high:     "#f97316",
  medium:   "#eab308",
  low:      "var(--c-64748b)",
};
const SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

const ACR_IMPACT_COLOR = { high: "#22c55e", medium: "#3b82f6", low: "var(--c-64748b)" };
const ACR_IMPACT_LABEL = { high: "High ACR", medium: "Medium ACR", low: "Low ACR" };

// ── Hero / Overview ────────────────────────────────────────────────────────────

function GrowthHero({ opps }) {
  if (!opps) return null;
  const {
    total_gaps, critical_count, high_count, medium_count, low_count,
    estimated_total_monthly_acr, categories,
  } = opps;

  const annualACR = estimated_total_monthly_acr * 12;
  const heroColor = critical_count > 0 ? "#ef4444" : high_count > 0 ? "#f97316" : "#22c55e";
  const urgency   = critical_count > 0 ? "Critical Gaps — Act Now"
                  : high_count > 0     ? "High Priority Opportunities"
                  :                      "Growth Opportunities Identified";

  return (
    <div style={{
      background: "var(--c-0f172a)",
      border: `1px solid ${heroColor}25`,
      borderLeft: `4px solid ${heroColor}`,
      borderRadius: 16,
      padding: "24px",
      marginBottom: 24,
    }}>
      <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 16 }}>
        Azure ACR Growth — Service Adoption Opportunities
      </div>

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>

        {/* ACR potential card */}
        <div style={{
          background: "var(--c-1e293b)", borderRadius: 14,
          padding: "18px 24px", textAlign: "center", minWidth: 160,
          border: "1px solid #22c55e25",
        }}>
          <div style={{ color: "#22c55e", fontSize: 30, fontWeight: 800 }}>
            ${Math.round(estimated_total_monthly_acr).toLocaleString()}
          </div>
          <div style={{ color: "var(--c-64748b)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>
            /month ACR potential
          </div>
          <div style={{ color: "var(--c-475569)", fontSize: 11, marginTop: 4 }}>
            ${Math.round(annualACR).toLocaleString()}/year
          </div>
        </div>

        {/* Gap summary */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ color: "var(--c-f1f5f9)", fontSize: 26, fontWeight: 800 }}>{total_gaps}</span>
            <span style={{ color: "var(--c-475569)", fontSize: 14 }}>opportunities across {categories.length} service categories</span>
            <span style={{
              background: `${heroColor}15`, color: heroColor,
              fontSize: 11, fontWeight: 700, padding: "2px 10px",
              borderRadius: 20, border: `1px solid ${heroColor}30`,
            }}>{urgency}</span>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { sev: "critical", count: critical_count },
              { sev: "high",     count: high_count     },
              { sev: "medium",   count: medium_count   },
              { sev: "low",      count: low_count      },
            ].map(({ sev, count }) => (
              <div key={sev} style={{
                background: `${SEV_COLOR[sev]}10`,
                border: `1px solid ${SEV_COLOR[sev]}25`,
                borderRadius: 10, padding: "8px 14px", textAlign: "center",
                minWidth: 65,
              }}>
                <div style={{ color: SEV_COLOR[sev], fontSize: 20, fontWeight: 800 }}>{count}</div>
                <div style={{ color: "var(--c-64748b)", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>
                  {SEV_LABEL[sev]}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, color: "var(--c-475569)", fontSize: 11, lineHeight: 1.6 }}>
            Each category represents an Azure service that is <strong style={{ color: "var(--c-94a3b8)" }}>not yet adopted</strong> by
            one or more resources. Enabling these services grows Azure consumption and
            improves security, reliability, and observability simultaneously.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Category summary cards ─────────────────────────────────────────────────────

function CategoryGrid({ categories, activeCategory, onSelect }) {
  if (!categories.length) return null;
  return (
    <div style={{
      background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)",
      borderRadius: 16, padding: "20px 24px", marginBottom: 24,
    }}>
      <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
        Opportunity Categories
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 10 }}>
        {categories.map((cat) => {
          const pct   = cat.coverage_pct;
          const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444";
          const isActive = activeCategory === cat.category_key;
          const impactColor = ACR_IMPACT_COLOR[cat.acr_impact] || "var(--c-64748b)";
          return (
            <div
              key={cat.category_key}
              onClick={() => onSelect(isActive ? null : cat.category_key)}
              style={{
                background: isActive ? "var(--c-1e3a5f)" : "var(--c-1e293b)",
                border: `1px solid ${isActive ? "#3b82f6" : color + "25"}`,
                borderRadius: 12, padding: "12px 14px",
                cursor: "pointer", transition: "all 0.15s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>{cat.icon}</span>
                <span style={{
                  background: `${impactColor}15`, color: impactColor,
                  fontSize: 8, fontWeight: 700, padding: "1px 5px",
                  borderRadius: 8, textTransform: "uppercase",
                }}>
                  {ACR_IMPACT_LABEL[cat.acr_impact]}
                </span>
              </div>
              <div style={{ color: "var(--c-e2e8f0)", fontSize: 11, fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>
                {cat.category}
              </div>
              {/* Progress bar */}
              <div style={{ height: 4, background: "var(--c-0f172a)", borderRadius: 2, marginBottom: 6, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${pct}%`,
                  background: `linear-gradient(90deg, ${color}99, ${color})`,
                  borderRadius: 2, transition: "width 0.8s ease",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                <span style={{ color }}>{Math.round(pct)}% covered</span>
                <span style={{ color: "var(--c-475569)" }}>{cat.gaps} gap{cat.gaps !== 1 ? "s" : ""}</span>
              </div>
              {cat.estimated_total_acr > 0 && (
                <div style={{ marginTop: 5, color: "#22c55e", fontSize: 10, fontWeight: 600 }}>
                  +${Math.round(cat.estimated_total_acr).toLocaleString()}/mo ACR
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Individual opportunity card ────────────────────────────────────────────────

function ACRGapCard({ gap }) {
  const [open, setOpen] = useState(false);
  const sevColor    = SEV_COLOR[gap.severity]    || "var(--c-64748b)";
  const impactColor = ACR_IMPACT_COLOR[gap.acr_impact] || "var(--c-64748b)";

  return (
    <div style={{
      background: "var(--c-0f172a)",
      border: "1px solid var(--c-1e293b)",
      borderRadius: 12,
      padding: "14px 16px",
      borderLeft: `3px solid ${sevColor}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{gap.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Title row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--c-f1f5f9)", fontWeight: 700, fontSize: 14 }}>
              <ResourceIconImg resourceType={gap.resource_type} size={16} />
              {gap.resource_name}
            </span>
            <span style={{
              background: `${sevColor}20`, color: sevColor,
              fontSize: 9, fontWeight: 700, padding: "2px 7px",
              borderRadius: 20, border: `1px solid ${sevColor}40`,
              textTransform: "uppercase",
            }}>{SEV_LABEL[gap.severity]}</span>
            <span style={{
              background: `${impactColor}15`, color: impactColor,
              fontSize: 9, fontWeight: 700, padding: "2px 7px",
              borderRadius: 20, border: `1px solid ${impactColor}30`,
              textTransform: "uppercase",
            }}>{ACR_IMPACT_LABEL[gap.acr_impact]}</span>
            <span style={{
              background: "var(--c-1e293b)", color: "var(--c-475569)",
              fontSize: 9, padding: "2px 7px", borderRadius: 10,
              border: "1px solid var(--c-334155)",
            }}>{gap.category}</span>
          </div>

          {/* Subtitle */}
          <div style={{ color: "var(--c-475569)", fontSize: 10, marginBottom: 6 }}>
            <span>{gap.resource_group}</span>
            <span style={{ color: "var(--c-334155)", margin: "0 5px" }}>·</span>
            <span>{gap.resource_type.split("/").pop()}</span>
            {gap.resource_monthly_cost > 0 && (
              <>
                <span style={{ color: "var(--c-334155)", margin: "0 5px" }}>·</span>
                <span style={{ color: "var(--c-64748b)" }}>💰 ${Math.round(gap.resource_monthly_cost).toLocaleString()}/mo resource</span>
              </>
            )}
          </div>

          {/* Description */}
          <div style={{ color: "var(--c-94a3b8)", fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
            {gap.description}
          </div>

          {/* Service + ACR row */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{
              background: "#1e40af18", color: 'var(--c-60a5fa)',
              fontSize: 10, fontWeight: 600, padding: "3px 9px",
              borderRadius: 20, border: "1px solid #1d4ed830",
            }}>🔧 {gap.azure_service}</span>
            {gap.estimated_monthly_acr > 0 && (
              <span style={{
                background: "#14532d18", color: 'var(--c-4ade80)',
                fontSize: 10, fontWeight: 700, padding: "3px 9px",
                borderRadius: 20, border: "1px solid #14532d30",
              }}>+${gap.estimated_monthly_acr < 1 ? gap.estimated_monthly_acr.toFixed(2) : Math.round(gap.estimated_monthly_acr).toLocaleString()}/mo ACR</span>
            )}
          </div>

          {/* Expand toggle */}
          <button
            onClick={() => setOpen(!open)}
            style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 11, padding: 0 }}
          >
            {open ? "▲ Hide implementation guide" : "▼ Show step-by-step guide + CLI"}
          </button>

          {open && (
            <div style={{ marginTop: 10, background: "var(--c-1e293b)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--c-334155)" }}>

              {/* Steps */}
              {gap.implementation_steps.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: "#22c55e", fontSize: 11, fontWeight: 600, marginBottom: 8 }}>
                    ✅ Implementation Steps
                  </div>
                  <ol style={{ margin: 0, paddingLeft: 18 }}>
                    {gap.implementation_steps.map((step, i) => (
                      <li key={i} style={{ color: "var(--c-94a3b8)", fontSize: 12, lineHeight: 1.7, marginBottom: 2 }}>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* CLI */}
              {gap.az_cli_snippet && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: 'var(--c-60a5fa)', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
                    🖥️ Azure CLI
                  </div>
                  <pre style={{
                    background: "var(--c-0f172a)", color: 'var(--c-7dd3fc)',
                    fontSize: 10, padding: "10px 12px",
                    borderRadius: 8, border: "1px solid var(--c-1e3a5f)",
                    overflowX: "auto", margin: 0,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {gap.az_cli_snippet}
                  </pre>
                </div>
              )}

              {/* Docs link */}
              {gap.documentation_url && (
                <a href={gap.documentation_url} target="_blank" rel="noopener noreferrer"
                   style={{ color: "#3b82f6", fontSize: 11, textDecoration: "none" }}>
                  📖 Microsoft Docs — {gap.azure_service} →
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export default function GrowthPanel({ acrOpportunities }) {
  const [filterSev,  setFilterSev]  = useState("all");
  const [filterCat,  setFilterCat]  = useState(null);
  const [filterImpact, setFilterImpact] = useState("all");

  const opps     = acrOpportunities;
  const allGaps  = opps?.gaps ?? [];
  const allCats  = opps?.categories ?? [];

  const filteredGaps = useMemo(() => {
    return allGaps.filter((g) => {
      if (filterSev    !== "all"  && g.severity   !== filterSev)    return false;
      if (filterCat    !== null   && g.category_key !== filterCat)  return false;
      if (filterImpact !== "all"  && g.acr_impact  !== filterImpact) return false;
      return true;
    });
  }, [allGaps, filterSev, filterCat, filterImpact]);

  if (!opps) {
    return (
      <div style={{
        textAlign: "center", padding: "60px 20px",
        color: "var(--c-475569)", background: "var(--c-0f172a)",
        borderRadius: 16, border: "1px solid var(--c-1e293b)",
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔄</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--c-94a3b8)", marginBottom: 6 }}>
          ACR opportunity data not yet available
        </div>
        <div style={{ fontSize: 12 }}>Run a full scan to generate growth opportunity analysis.</div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "inherit" }}>

      {/* Hero */}
      <GrowthHero opps={opps} />

      {/* Category grid (clickable filter) */}
      <CategoryGrid categories={allCats} activeCategory={filterCat} onSelect={setFilterCat} />

      {/* Filter bar */}
      <div style={{
        display: "flex", gap: 8, flexWrap: "wrap",
        padding: "12px 16px", background: "var(--c-0f172a)",
        border: "1px solid var(--c-1e293b)", borderRadius: 12, marginBottom: 16,
      }}>

        {/* Severity */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "var(--c-475569)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginRight: 4 }}>Severity:</span>
          {[["all","All","var(--c-64748b)"],["critical","Critical","#ef4444"],["high","High","#f97316"],["medium","Medium","#eab308"],["low","Low","var(--c-64748b)"]].map(([v,l,c]) => (
            <button key={v} onClick={() => setFilterSev(v)} style={{
              background: filterSev === v ? `${c}20` : "transparent",
              border: `1px solid ${filterSev === v ? c : "var(--c-334155)"}`,
              color: filterSev === v ? c : "var(--c-64748b)",
              borderRadius: 20, padding: "2px 10px", fontSize: 11,
              cursor: "pointer", fontWeight: filterSev === v ? 700 : 500,
            }}>
              {l}{v !== "all" ? ` (${allGaps.filter(g => g.severity === v).length})` : ""}
            </button>
          ))}
        </div>

        {/* ACR Impact */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", borderLeft: "1px solid var(--c-1e293b)", paddingLeft: 10 }}>
          <span style={{ color: "var(--c-475569)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginRight: 4 }}>ACR Impact:</span>
          {[["all","All"],["high","High"],["medium","Medium"],["low","Low"]].map(([v,l]) => {
            const c = ACR_IMPACT_COLOR[v] || "var(--c-64748b)";
            return (
              <button key={v} onClick={() => setFilterImpact(v)} style={{
                background: filterImpact === v ? `${c}20` : "transparent",
                border: `1px solid ${filterImpact === v ? c : "var(--c-334155)"}`,
                color: filterImpact === v ? c : "var(--c-64748b)",
                borderRadius: 20, padding: "2px 10px", fontSize: 11,
                cursor: "pointer", fontWeight: filterImpact === v ? 700 : 500,
              }}>{l}</button>
            );
          })}
        </div>

        {/* Clear category filter */}
        {filterCat && (
          <button onClick={() => setFilterCat(null)} style={{
            background: "#1e3a5f18", color: 'var(--c-60a5fa)',
            border: "1px solid #1d4ed830", borderRadius: 20,
            padding: "2px 10px", fontSize: 11, cursor: "pointer",
          }}>
            ✕ Clear category filter
          </button>
        )}
      </div>

      {/* Results count */}
      <div style={{ color: "var(--c-475569)", fontSize: 11, marginBottom: 12 }}>
        Showing {filteredGaps.length} of {allGaps.length} opportunities
        {filterCat && <span style={{ color: 'var(--c-60a5fa)', marginLeft: 6 }}>
          — filtered to: {allCats.find(c => c.category_key === filterCat)?.category}
        </span>}
      </div>

      {/* Gap cards */}
      {filteredGaps.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          color: "var(--c-475569)", background: "var(--c-0f172a)",
          borderRadius: 12, border: "1px solid var(--c-1e293b)",
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-94a3b8)" }}>
            No items match the current filter
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filteredGaps.map((g, i) => (
            <ACRGapCard key={g.resource_id + i} gap={g} />
          ))}
        </div>
      )}
    </div>
  );
}
