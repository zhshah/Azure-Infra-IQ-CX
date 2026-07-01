import React, { useState, useMemo, useCallback } from "react";
import { ResourceIconImg } from "../utils/resourceIcons";

// ── Constants ──────────────────────────────────────────────────────────────────

const SEV_COLOR = {
  critical: "#ef4444",
  high:     "#f97316",
  medium:   "#eab308",
  low:      "var(--c-64748b)",
};
const SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

const IMPACT_COLOR = { high: "#22c55e", medium: "#3b82f6", low: "var(--c-64748b)" };
const IMPACT_LABEL = { high: "High Impact", medium: "Medium Impact", low: "Low Impact" };

// Map ACR categories to cloud adoption themes
const ADOPTION_THEME = {
  defender:       { theme: "Security Modernization",   approach: "Enable cloud-native protection" },
  site_recovery:  { theme: "Disaster Recovery",        approach: "Migrate to managed DR services" },
  monitor:        { theme: "Observability Maturity",   approach: "Adopt cloud-native monitoring" },
  app_insights:   { theme: "APM Modernization",       approach: "Instrument with managed APM" },
  ddos:           { theme: "Network Protection",      approach: "Enable platform-level security" },
  cdn:            { theme: "Edge & Performance",      approach: "Modernize delivery architecture" },
  bastion:        { theme: "Zero Trust Access",       approach: "Replace VPN with managed access" },
  autoscale:      { theme: "Elastic Scaling",         approach: "Migrate to PaaS auto-scaling" },
  update_manager: { theme: "Patch Automation",        approach: "Move from manual to managed ops" },
  managed_id:     { theme: "Identity Modernization",  approach: "Adopt passwordless & managed ID" },
  private_ep:     { theme: "Network Isolation",       approach: "Modernize to private connectivity" },
};

// ── Adoption Maturity Chart (SVG) ──────────────────────────────────────────────

function AdoptionMaturityChart({ categories }) {
  if (!categories || categories.length === 0) return null;

  const sorted = [...categories].sort((a, b) => a.coverage_pct - b.coverage_pct);
  const barH = 28, gap = 6, padding = { top: 30, bottom: 20, left: 160, right: 60 };
  const svgH = padding.top + padding.bottom + sorted.length * (barH + gap);
  const svgW = 700;
  const maxBarW = svgW - padding.left - padding.right;

  return (
    <div style={{
      background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)",
      borderRadius: 16, padding: "20px 24px", marginBottom: 24,
    }}>
      <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
        Cloud Service Adoption Maturity
      </div>
      <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" style={{ maxHeight: 450, overflow: "visible" }}>
        {/* Header */}
        <text x={padding.left} y={16} style={{ fill: 'var(--c-475569)' }} fontSize="9" fontWeight="600">SERVICE CATEGORY</text>
        <text x={svgW - padding.right + 5} y={16} style={{ fill: 'var(--c-475569)' }} fontSize="9" fontWeight="600">COVERAGE</text>

        {sorted.map((cat, i) => {
          const y = padding.top + i * (barH + gap);
          const pct = cat.coverage_pct;
          const barW = (pct / 100) * maxBarW;
          const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#eab308" : pct >= 25 ? "#f97316" : "#ef4444";
          const theme = ADOPTION_THEME[cat.category_key] || {};

          return (
            <g key={cat.category_key}>
              {/* Label */}
              <text x={padding.left - 8} y={y + barH / 2 + 4} style={{ fill: 'var(--c-94a3b8)' }} fontSize="10" textAnchor="end" fontWeight="500">
                {cat.category}
              </text>
              {/* Background bar */}
              <rect x={padding.left} y={y} width={maxBarW} height={barH} rx={4} style={{ fill: 'var(--c-1e293b)' }} />
              {/* Progress bar */}
              <rect x={padding.left} y={y} width={Math.max(barW, 2)} height={barH} rx={4} fill={color} opacity={0.8} />
              {/* Percentage label */}
              <text x={padding.left + maxBarW + 8} y={y + barH / 2 + 4} fill={color} fontSize="11" fontWeight="700">
                {Math.round(pct)}%
              </text>
              {/* Gap count inside bar */}
              {pct < 100 && (
                <text x={padding.left + barW + 8} y={y + barH / 2 + 3} style={{ fill: 'var(--c-64748b)' }} fontSize="9">
                  {cat.gaps} gap{cat.gaps !== 1 ? "s" : ""} — {theme.approach || ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Migration Approach Donut ───────────────────────────────────────────────────

function MigrationApproachChart({ categories }) {
  if (!categories || categories.length === 0) return null;

  // Group by modernization approach type
  const approaches = [
    { label: "Platform Services (PaaS)", keys: ["monitor", "app_insights", "autoscale", "cdn"], color: "#3b82f6" },
    { label: "Security Modernization",   keys: ["defender", "ddos", "bastion", "private_ep"], color: "#8b5cf6" },
    { label: "Managed Operations",       keys: ["update_manager", "managed_id"], color: "#06b6d4" },
    { label: "DR & Resilience",          keys: ["site_recovery"], color: "#22c55e" },
  ];

  const totals = approaches.map(a => ({
    ...a,
    gaps: categories.filter(c => a.keys.includes(c.category_key)).reduce((s, c) => s + c.gaps, 0),
    savings: categories.filter(c => a.keys.includes(c.category_key)).reduce((s, c) => s + (c.estimated_total_acr || 0), 0),
  }));

  const totalGaps = totals.reduce((s, t) => s + t.gaps, 0) || 1;

  // Simple donut
  const cx = 80, cy = 80, r = 60, r2 = 40;
  let angle = -90;

  return (
    <div style={{
      background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)",
      borderRadius: 16, padding: "20px 24px",
    }}>
      <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
        Migration & Modernization Approach
      </div>
      <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        <svg width={160} height={160} viewBox="0 0 160 160">
          {totals.map((t, i) => {
            const pct = t.gaps / totalGaps;
            const sweep = pct * 360;
            const startAngle = angle;
            angle += sweep;
            const start = polarToCart(cx, cy, r, startAngle);
            const end = polarToCart(cx, cy, r, startAngle + sweep - 0.5);
            const startInner = polarToCart(cx, cy, r2, startAngle + sweep - 0.5);
            const endInner = polarToCart(cx, cy, r2, startAngle);
            const largeArc = sweep > 180 ? 1 : 0;
            const d = `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} L ${startInner.x} ${startInner.y} A ${r2} ${r2} 0 ${largeArc} 0 ${endInner.x} ${endInner.y} Z`;
            return <path key={i} d={d} fill={t.color} opacity={0.85} />;
          })}
          <text x={cx} y={cy - 4} textAnchor="middle" style={{ fill: 'var(--c-f1f5f9)' }} fontSize="18" fontWeight="800">
            {totalGaps}
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" style={{ fill: 'var(--c-64748b)' }} fontSize="9" fontWeight="600">
            OPPORTUNITIES
          </text>
        </svg>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {totals.map(t => (
            <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: t.color, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--c-e2e8f0)", fontSize: 12, fontWeight: 600 }}>{t.label}</div>
                <div style={{ color: "var(--c-475569)", fontSize: 10 }}>
                  {t.gaps} opportunities · ${Math.round(t.savings).toLocaleString()}/mo potential savings
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function polarToCart(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// ── Hero / Overview ────────────────────────────────────────────────────────────

function AdoptionHero({ opps }) {
  if (!opps) return null;
  const {
    total_gaps, critical_count, high_count, medium_count, low_count,
    estimated_total_monthly_acr, categories,
  } = opps;

  const annualSavings = estimated_total_monthly_acr * 12;
  const heroColor = critical_count > 0 ? "#ef4444" : high_count > 0 ? "#f97316" : "#3b82f6";
  const urgency   = critical_count > 0 ? "Critical Modernization Gaps"
                  : high_count > 0     ? "High-Priority Adoption Opportunities"
                  :                      "Cloud Adoption Optimized";

  // Compute adoption score (weighted coverage)
  const avgCoverage = categories.length > 0
    ? Math.round(categories.reduce((s, c) => s + c.coverage_pct, 0) / categories.length)
    : 0;
  const scoreColor = avgCoverage >= 80 ? "#22c55e" : avgCoverage >= 50 ? "#eab308" : "#ef4444";

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
        Cloud Adoption & Modernization — Service Migration Opportunities
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>

        {/* Adoption score ring */}
        <div style={{
          background: "var(--c-1e293b)", borderRadius: 14,
          padding: "18px 24px", textAlign: "center", minWidth: 140,
          border: `1px solid ${scoreColor}25`,
        }}>
          <svg width={80} height={80} viewBox="0 0 80 80">
            <circle cx={40} cy={40} r={32} fill="none" style={{ stroke: 'var(--c-1e293b)' }} strokeWidth={8} />
            <circle cx={40} cy={40} r={32} fill="none" stroke={scoreColor} strokeWidth={8}
              strokeDasharray={`${avgCoverage * 2.01} 999`}
              strokeLinecap="round" transform="rotate(-90 40 40)" />
            <text x={40} y={38} textAnchor="middle" fill={scoreColor} fontSize="18" fontWeight="800">
              {avgCoverage}%
            </text>
            <text x={40} y={52} textAnchor="middle" style={{ fill: 'var(--c-64748b)' }} fontSize="8" fontWeight="600">
              ADOPTED
            </text>
          </svg>
          <div style={{ color: "var(--c-64748b)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>
            Service Adoption Score
          </div>
        </div>

        {/* Savings potential */}
        <div style={{
          background: "var(--c-1e293b)", borderRadius: 14,
          padding: "18px 24px", textAlign: "center", minWidth: 160,
          border: "1px solid #22c55e25",
        }}>
          <div style={{ color: "#22c55e", fontSize: 28, fontWeight: 800 }}>
            ${Math.round(estimated_total_monthly_acr).toLocaleString()}
          </div>
          <div style={{ color: "var(--c-64748b)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>
            /month savings potential
          </div>
          <div style={{ color: "var(--c-475569)", fontSize: 11, marginTop: 4 }}>
            ${Math.round(annualSavings).toLocaleString()}/year with modernization
          </div>
        </div>

        {/* Gap summary */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ color: "var(--c-f1f5f9)", fontSize: 26, fontWeight: 800 }}>{total_gaps}</span>
            <span style={{ color: "var(--c-475569)", fontSize: 14 }}>modernization opportunities across {categories.length} categories</span>
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
            Each opportunity identifies an Azure managed service that can <strong style={{ color: "var(--c-94a3b8)" }}>replace manual infrastructure</strong>,
            reduce operational overhead, and improve security — moving your estate from IaaS to PaaS where possible.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── IaaS vs PaaS Migration Summary ─────────────────────────────────────────────

function MigrationSummaryCards({ categories }) {
  if (!categories || categories.length === 0) return null;

  const paasCategories = ["monitor", "app_insights", "autoscale", "cdn", "managed_id"];
  const securityCategories = ["defender", "ddos", "bastion", "private_ep"];
  const opsCategories = ["update_manager", "site_recovery"];

  const count = (keys) => categories.filter(c => keys.includes(c.category_key)).reduce((s, c) => s + c.gaps, 0);
  const savings = (keys) => categories.filter(c => keys.includes(c.category_key)).reduce((s, c) => s + (c.estimated_total_acr || 0), 0);

  const cards = [
    {
      title: "IaaS → PaaS Migration",
      subtitle: "Replace self-managed infra with Azure managed services",
      gaps: count(paasCategories),
      monthlySavings: savings(paasCategories),
      color: "#3b82f6",
      icon: "▸",
      benefits: ["Auto-scaling", "Zero-patch overhead", "Built-in HA", "Pay-per-use"],
    },
    {
      title: "Security Modernization",
      subtitle: "Adopt cloud-native security vs. appliance-based",
      gaps: count(securityCategories),
      monthlySavings: savings(securityCategories),
      color: "#8b5cf6",
      icon: "◆",
      benefits: ["Zero Trust", "Managed WAF", "Private networking", "Platform DDoS"],
    },
    {
      title: "Operations Automation",
      subtitle: "Shift from manual ops to managed lifecycle",
      gaps: count(opsCategories),
      monthlySavings: savings(opsCategories),
      color: "#06b6d4",
      icon: "⚙",
      benefits: ["Auto-patching", "Managed DR", "Self-healing", "Reduced FTE cost"],
    },
  ];

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14,
      marginBottom: 24,
    }}>
      {cards.map(card => (
        <div key={card.title} style={{
          background: "var(--c-0f172a)", border: `1px solid ${card.color}20`,
          borderRadius: 14, padding: "18px 20px",
          borderTop: `3px solid ${card.color}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 24 }}>{card.icon}</span>
            <div>
              <div style={{ color: "var(--c-f1f5f9)", fontSize: 13, fontWeight: 700 }}>{card.title}</div>
              <div style={{ color: "var(--c-475569)", fontSize: 10 }}>{card.subtitle}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
            <div>
              <div style={{ color: card.color, fontSize: 22, fontWeight: 800 }}>{card.gaps}</div>
              <div style={{ color: "var(--c-64748b)", fontSize: 9, fontWeight: 600, textTransform: "uppercase" }}>Opportunities</div>
            </div>
            <div>
              <div style={{ color: "#22c55e", fontSize: 22, fontWeight: 800 }}>
                ${Math.round(card.monthlySavings).toLocaleString()}
              </div>
              <div style={{ color: "var(--c-64748b)", fontSize: 9, fontWeight: 600, textTransform: "uppercase" }}>/mo savings</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {card.benefits.map(b => (
              <span key={b} style={{
                background: `${card.color}10`, color: `${card.color}cc`,
                fontSize: 9, fontWeight: 600, padding: "2px 7px",
                borderRadius: 8, border: `1px solid ${card.color}20`,
              }}>{b}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Category Grid ──────────────────────────────────────────────────────────────

function CategoryGrid({ categories, activeCategory, onSelect }) {
  if (!categories.length) return null;
  return (
    <div style={{
      background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)",
      borderRadius: 16, padding: "20px 24px", marginBottom: 24,
    }}>
      <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
        Service Adoption Categories
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 10 }}>
        {categories.map((cat) => {
          const pct   = cat.coverage_pct;
          const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444";
          const isActive = activeCategory === cat.category_key;
          const impactColor = IMPACT_COLOR[cat.acr_impact] || "var(--c-64748b)";
          const theme = ADOPTION_THEME[cat.category_key] || {};
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
                  {IMPACT_LABEL[cat.acr_impact]}
                </span>
              </div>
              <div style={{ color: "var(--c-e2e8f0)", fontSize: 11, fontWeight: 600, marginBottom: 2, lineHeight: 1.3 }}>
                {cat.category}
              </div>
              {theme.theme && (
                <div style={{ color: "var(--c-475569)", fontSize: 9, marginBottom: 6 }}>{theme.theme}</div>
              )}
              {/* Progress bar */}
              <div style={{ height: 4, background: "var(--c-0f172a)", borderRadius: 2, marginBottom: 6, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${pct}%`,
                  background: `linear-gradient(90deg, ${color}99, ${color})`,
                  borderRadius: 2, transition: "width 0.8s ease",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                <span style={{ color }}>{Math.round(pct)}% adopted</span>
                <span style={{ color: "var(--c-475569)" }}>{cat.gaps} gap{cat.gaps !== 1 ? "s" : ""}</span>
              </div>
              {cat.estimated_total_acr > 0 && (
                <div style={{ marginTop: 5, color: "#22c55e", fontSize: 10, fontWeight: 600 }}>
                  +${Math.round(cat.estimated_total_acr).toLocaleString()}/mo savings
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Individual Adoption Opportunity Card ───────────────────────────────────────

function AdoptionCard({ gap }) {
  const [open, setOpen] = useState(false);
  const sevColor    = SEV_COLOR[gap.severity]    || "var(--c-64748b)";
  const impactColor = IMPACT_COLOR[gap.acr_impact] || "var(--c-64748b)";
  const theme = ADOPTION_THEME[gap.category_key] || {};

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
            }}>{IMPACT_LABEL[gap.acr_impact]}</span>
            {theme.theme && (
              <span style={{
                background: "var(--c-1e293b)", color: "var(--c-94a3b8)",
                fontSize: 9, padding: "2px 7px", borderRadius: 10,
                border: "1px solid var(--c-334155)",
              }}>{theme.theme}</span>
            )}
          </div>

          {/* Subtitle */}
          <div style={{ color: "var(--c-475569)", fontSize: 10, marginBottom: 6 }}>
            <span>{gap.resource_group}</span>
            <span style={{ color: "var(--c-334155)", margin: "0 5px" }}>·</span>
            <span>{gap.resource_type.split("/").pop()}</span>
            {gap.resource_monthly_cost > 0 && (
              <>
                <span style={{ color: "var(--c-334155)", margin: "0 5px" }}>·</span>
                <span style={{ color: "var(--c-64748b)" }}>Current: ${Math.round(gap.resource_monthly_cost).toLocaleString()}/mo</span>
              </>
            )}
          </div>

          {/* Description */}
          <div style={{ color: "var(--c-94a3b8)", fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}>
            {gap.description}
          </div>

          {/* Service + savings row */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{
              background: "#1e40af18", color: 'var(--c-60a5fa)',
              fontSize: 10, fontWeight: 600, padding: "3px 9px",
              borderRadius: 20, border: "1px solid #1d4ed830",
            }}>Migrate to: {gap.azure_service}</span>
            {gap.estimated_monthly_acr > 0 && (
              <span style={{
                background: "#14532d18", color: 'var(--c-4ade80)',
                fontSize: 10, fontWeight: 700, padding: "3px 9px",
                borderRadius: 20, border: "1px solid #14532d30",
              }}>+${gap.estimated_monthly_acr < 1 ? gap.estimated_monthly_acr.toFixed(2) : Math.round(gap.estimated_monthly_acr).toLocaleString()}/mo value</span>
            )}
            {theme.approach && (
              <span style={{
                background: "var(--c-0f172a)", color: "var(--c-64748b)",
                fontSize: 9, padding: "3px 8px", borderRadius: 10,
                border: "1px solid var(--c-334155)", fontStyle: "italic",
              }}>{theme.approach}</span>
            )}
          </div>

          {/* Expand toggle */}
          <button
            onClick={() => setOpen(!open)}
            style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 11, padding: 0 }}
          >
            {open ? "▲ Hide migration guide" : "▼ Show migration steps + CLI"}
          </button>

          {open && (
            <div style={{ marginTop: 10, background: "var(--c-1e293b)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--c-334155)" }}>

              {/* Steps */}
              {gap.implementation_steps && gap.implementation_steps.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: "#22c55e", fontSize: 11, fontWeight: 600, marginBottom: 8 }}>
                    Migration Steps
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
                    Azure CLI
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
                  Microsoft Docs — {gap.azure_service} →
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── AI Deep Analysis Component ─────────────────────────────────────────────────

function AIAdoptionAnalysis({ data, loading, error, onRun }) {
  if (!data && !loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", background: "var(--c-0f172a)", borderRadius: 16, border: "1px solid var(--c-1e293b)" }}>
        <div style={{ fontSize: 48, marginBottom: 12, color: 'var(--c-60a5fa)' }}>⬢</div>
        <div style={{ color: "var(--c-f1f5f9)", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
          AI-Powered Cloud Adoption Analysis
        </div>
        <div style={{ color: "var(--c-64748b)", fontSize: 12, marginBottom: 20, maxWidth: 500, margin: "0 auto 20px" }}>
          Get personalized migration recommendations, IaaS-to-PaaS opportunities,
          modernization waves, and cost projections tailored to your environment.
        </div>
        {error && (
          <div style={{ background: "#7f1d1d20", border: "1px solid #dc262630", borderRadius: 8, padding: "8px 14px", marginBottom: 16, color: 'var(--c-fca5a5)', fontSize: 11 }}>
            {error}
          </div>
        )}
        <button onClick={() => onRun(false)} style={{
          background: "#3b82f6", color: "#fff", border: "none", borderRadius: 10,
          padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>
          Run AI Analysis
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", background: "var(--c-0f172a)", borderRadius: 16, border: "1px solid var(--c-1e293b)" }}>
        <div style={{ fontSize: 36, marginBottom: 12, animation: "pulse 2s infinite", color: 'var(--c-60a5fa)' }}>○</div>
        <div style={{ color: "var(--c-94a3b8)", fontSize: 14, fontWeight: 600 }}>Analyzing your environment...</div>
        <div style={{ color: "var(--c-475569)", fontSize: 11, marginTop: 6 }}>AI is evaluating migration paths and modernization opportunities</div>
      </div>
    );
  }

  const {
    adoption_score, maturity_level, executive_summary,
    iaas_to_paas_opportunities = [], modernization_recommendations = [],
    migration_waves = [], cost_comparison, cloud_native_gaps = [],
  } = data;

  const scoreColor = (adoption_score || 0) >= 80 ? "#22c55e" : (adoption_score || 0) >= 50 ? "#eab308" : "#ef4444";
  const maturityColor = { "Cloud-Native": "#22c55e", "Advanced": "#3b82f6", "Intermediate": "#eab308", "Beginner": "#ef4444" }[maturity_level] || "var(--c-64748b)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header with score */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 24, color: 'var(--c-60a5fa)' }}>⬢</div>
          <div>
            <div style={{ color: "var(--c-f1f5f9)", fontSize: 14, fontWeight: 700 }}>AI Cloud Adoption Assessment</div>
            <div style={{ color: "var(--c-475569)", fontSize: 10 }}>
              {data._cached ? "Cached " : ""}Model: {data.model || "unknown"} • {data.analysis_timestamp ? new Date(data.analysis_timestamp).toLocaleString() : ""}
            </div>
          </div>
        </div>
        <button onClick={() => onRun(true)} style={{
          background: "var(--c-1e293b)", color: "var(--c-94a3b8)", border: "1px solid var(--c-334155)",
          borderRadius: 8, padding: "5px 12px", fontSize: 11, cursor: "pointer",
        }}>↻ Re-analyze</button>
      </div>

      {/* Score + Maturity + Executive summary */}
      <div style={{ display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 20, background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 16, padding: "20px 24px" }}>
        <div style={{ textAlign: "center" }}>
          <svg width={90} height={90} viewBox="0 0 90 90">
            <circle cx={45} cy={45} r={36} fill="none" style={{ stroke: 'var(--c-1e293b)' }} strokeWidth={8} />
            <circle cx={45} cy={45} r={36} fill="none" stroke={scoreColor} strokeWidth={8}
              strokeDasharray={`${(adoption_score || 0) * 2.26} 999`} strokeLinecap="round" transform="rotate(-90 45 45)" />
            <text x={45} y={43} textAnchor="middle" fill={scoreColor} fontSize="20" fontWeight="800">{adoption_score || 0}</text>
            <text x={45} y={57} textAnchor="middle" style={{ fill: 'var(--c-64748b)' }} fontSize="8">SCORE</text>
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
          <div style={{ color: "var(--c-64748b)", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Maturity Level</div>
          <div style={{ color: maturityColor, fontSize: 18, fontWeight: 800 }}>{maturity_level || "—"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ color: "var(--c-64748b)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Executive Summary</div>
          <div style={{ color: "var(--c-94a3b8)", fontSize: 12, lineHeight: 1.6 }}>{executive_summary}</div>
        </div>
      </div>

      {/* Cost comparison */}
      {cost_comparison && (
        <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 16, padding: "20px 24px" }}>
          <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
            Cost Impact — IaaS vs Modernized
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#ef4444", fontSize: 22, fontWeight: 800 }}>${(cost_comparison.current_monthly_iaas || 0).toLocaleString()}</div>
              <div style={{ color: "var(--c-64748b)", fontSize: 9, fontWeight: 600, textTransform: "uppercase" }}>Current IaaS/mo</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#22c55e", fontSize: 22, fontWeight: 800 }}>${(cost_comparison.projected_monthly_paas || 0).toLocaleString()}</div>
              <div style={{ color: "var(--c-64748b)", fontSize: 9, fontWeight: 600, textTransform: "uppercase" }}>Projected PaaS/mo</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#3b82f6", fontSize: 22, fontWeight: 800 }}>{cost_comparison.projected_savings_pct || 0}%</div>
              <div style={{ color: "var(--c-64748b)", fontSize: 9, fontWeight: 600, textTransform: "uppercase" }}>Cost Reduction</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#8b5cf6", fontSize: 22, fontWeight: 800 }}>{cost_comparison.operational_hours_saved_monthly || 0}h</div>
              <div style={{ color: "var(--c-64748b)", fontSize: 9, fontWeight: 600, textTransform: "uppercase" }}>Ops Hours Saved/mo</div>
            </div>
          </div>
          {/* Visual bar comparison */}
          <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "var(--c-64748b)", fontSize: 10 }}>Current (IaaS-heavy)</span>
                <span style={{ color: "#ef4444", fontSize: 10, fontWeight: 600 }}>100%</span>
              </div>
              <div style={{ height: 12, background: "#ef444440", borderRadius: 6 }} />
            </div>
            <div style={{ color: "var(--c-475569)", fontSize: 16 }}>→</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "var(--c-64748b)", fontSize: 10 }}>Projected (Modernized)</span>
                <span style={{ color: "#22c55e", fontSize: 10, fontWeight: 600 }}>{100 - (cost_comparison.projected_savings_pct || 0)}%</span>
              </div>
              <div style={{ height: 12, background: "var(--c-1e293b)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${100 - (cost_comparison.projected_savings_pct || 0)}%`, background: "#22c55e60", borderRadius: 6 }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* IaaS to PaaS opportunities */}
      {iaas_to_paas_opportunities.length > 0 && (
        <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 16, padding: "20px 24px" }}>
          <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
            IaaS → PaaS Migration Opportunities ({iaas_to_paas_opportunities.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {iaas_to_paas_opportunities.map((opp, i) => {
              const approachColor = { "Rehost": "var(--c-64748b)", "Refactor": "#3b82f6", "Rearchitect": "#8b5cf6", "Replace": "#06b6d4" }[opp.migration_approach] || "var(--c-64748b)";
              return (
                <div key={i} style={{ background: "var(--c-1e293b)", borderRadius: 12, padding: "14px 16px", border: "1px solid var(--c-334155)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--c-f1f5f9)", fontSize: 13, fontWeight: 700 }}>{opp.current_service}</span>
                    <span style={{ color: "var(--c-475569)" }}>→</span>
                    <span style={{ color: "#3b82f6", fontSize: 13, fontWeight: 700 }}>{opp.recommended_target}</span>
                    <span style={{ background: `${approachColor}20`, color: approachColor, fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 10 }}>
                      {opp.migration_approach}
                    </span>
                    {opp.estimated_monthly_savings > 0 && (
                      <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 700, marginLeft: "auto" }}>
                        -${opp.estimated_monthly_savings.toLocaleString()}/mo
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {(opp.benefits || []).map((b, j) => (
                      <span key={j} style={{ background: "var(--c-0f172a)", color: "var(--c-94a3b8)", fontSize: 9, padding: "2px 7px", borderRadius: 8, border: "1px solid var(--c-334155)" }}>{b}</span>
                    ))}
                    {opp.effort_weeks && (
                      <span style={{ background: "var(--c-0f172a)", color: "#eab308", fontSize: 9, padding: "2px 7px", borderRadius: 8, border: "1px solid #eab30825" }}>
                        ~{opp.effort_weeks}w effort
                      </span>
                    )}
                  </div>
                  {opp.steps && opp.steps.length > 0 && (
                    <div style={{ color: "var(--c-64748b)", fontSize: 10, lineHeight: 1.6 }}>
                      {opp.steps.map((s, j) => <div key={j}>• {s}</div>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Migration Waves */}
      {migration_waves.length > 0 && (
        <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 16, padding: "20px 24px" }}>
          <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
            Migration Waves — Phased Approach
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {migration_waves.map((wave, i) => {
              const waveColors = ["#3b82f6", "#8b5cf6", "#06b6d4", "#22c55e", "#f97316"];
              const color = waveColors[i % waveColors.length];
              return (
                <div key={i} style={{ background: "var(--c-1e293b)", borderRadius: 12, padding: "14px", borderLeft: `3px solid ${color}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ color, fontSize: 12, fontWeight: 700 }}>Wave {wave.wave}</span>
                    <span style={{ color: "var(--c-475569)", fontSize: 9 }}>{wave.timeframe}</span>
                  </div>
                  <div style={{ color: "var(--c-e2e8f0)", fontSize: 11, fontWeight: 600, marginBottom: 8 }}>{wave.theme}</div>
                  {(wave.actions || []).map((a, j) => (
                    <div key={j} style={{ color: "var(--c-94a3b8)", fontSize: 10, lineHeight: 1.6 }}>• {a}</div>
                  ))}
                  {wave.expected_savings > 0 && (
                    <div style={{ color: "#22c55e", fontSize: 10, fontWeight: 600, marginTop: 6 }}>
                      Expected: -${wave.expected_savings.toLocaleString()}/mo
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cloud Native Gaps */}
      {cloud_native_gaps.length > 0 && (
        <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 16, padding: "20px 24px" }}>
          <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
            Cloud-Native Gaps ({cloud_native_gaps.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cloud_native_gaps.map((gap, i) => (
              <div key={i} style={{ background: "var(--c-1e293b)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--c-334155)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ color: "var(--c-f1f5f9)", fontSize: 12, fontWeight: 600 }}>{gap.gap}</span>
                  {gap.affected_count > 0 && (
                    <span style={{ color: "#f97316", fontSize: 9, fontWeight: 700, background: "#f9731610", padding: "1px 6px", borderRadius: 8 }}>
                      {gap.affected_count} affected
                    </span>
                  )}
                </div>
                <div style={{ color: "var(--c-64748b)", fontSize: 11, marginBottom: 4 }}>{gap.impact}</div>
                <div style={{ color: "#3b82f6", fontSize: 11 }}>→ {gap.recommendation}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modernization Recommendations */}
      {modernization_recommendations.length > 0 && (
        <div style={{ background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)", borderRadius: 16, padding: "20px 24px" }}>
          <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
            Modernization Recommendations ({modernization_recommendations.length})
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
            {modernization_recommendations.map((rec, i) => {
              const prioColor = { P1: "#ef4444", P2: "#f97316", P3: "#eab308" }[rec.priority] || "var(--c-64748b)";
              return (
                <div key={i} style={{ background: "var(--c-1e293b)", borderRadius: 10, padding: "12px 14px", border: `1px solid ${prioColor}20`, borderLeft: `3px solid ${prioColor}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ color: prioColor, fontSize: 9, fontWeight: 700 }}>{rec.priority}</span>
                    <span style={{ color: "var(--c-94a3b8)", fontSize: 9 }}>{rec.category}</span>
                    {rec.monthly_value > 0 && <span style={{ color: "#22c55e", fontSize: 9, fontWeight: 700, marginLeft: "auto" }}>${rec.monthly_value}/mo</span>}
                  </div>
                  <div style={{ color: "var(--c-e2e8f0)", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{rec.title}</div>
                  <div style={{ color: "var(--c-64748b)", fontSize: 11, lineHeight: 1.5 }}>{rec.description}</div>
                  {rec.affected_resources && rec.affected_resources.length > 0 && (
                    <div style={{ marginTop: 6, color: "var(--c-475569)", fontSize: 10 }}>
                      Resources: {rec.affected_resources.slice(0, 3).join(", ")}{rec.affected_resources.length > 3 ? ` +${rec.affected_resources.length - 3} more` : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export default function CloudAdoptionPanel({ acrOpportunities }) {
  const [activeTab,     setActiveTab]    = useState("overview");
  const [filterSev,     setFilterSev]    = useState("all");
  const [filterCat,     setFilterCat]    = useState(null);
  const [filterImpact,  setFilterImpact] = useState("all");
  const [aiData,        setAiData]       = useState(null);
  const [aiLoading,     setAiLoading]    = useState(false);
  const [aiError,       setAiError]      = useState(null);

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

  const runAiAnalysis = useCallback(async (refresh = false) => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch(`/api/ai/cloud-adoption?refresh=${refresh}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setAiData(json);
    } catch (e) {
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  }, []);

  if (!opps) {
    return (
      <div style={{
        textAlign: "center", padding: "60px 20px",
        color: "var(--c-475569)", background: "var(--c-0f172a)",
        borderRadius: 16, border: "1px solid var(--c-1e293b)",
      }}>
        <div style={{ fontSize: 40, marginBottom: 12, color: 'var(--c-60a5fa)' }}>☁</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--c-94a3b8)", marginBottom: 6 }}>
          Cloud adoption analysis not yet available
        </div>
        <div style={{ fontSize: 12 }}>Run a full scan to discover migration and modernization opportunities.</div>
      </div>
    );
  }

  const tabs = [
    { key: "overview",  label: "Overview" },
    { key: "migration", label: "Migration Paths" },
    { key: "ai",        label: "AI Deep Analysis" },
    { key: "findings",  label: `All Findings (${allGaps.length})` },
  ];

  return (
    <div style={{ fontFamily: "inherit" }}>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--c-1e293b)", paddingBottom: 8 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            background: activeTab === t.key ? "var(--c-1e293b)" : "transparent",
            border: activeTab === t.key ? "1px solid var(--c-334155)" : "1px solid transparent",
            borderRadius: 8, padding: "6px 14px", color: activeTab === t.key ? "var(--c-f1f5f9)" : "var(--c-64748b)",
            fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ──────────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <>
          <AdoptionHero opps={opps} />
          <MigrationSummaryCards categories={allCats} />
          <CategoryGrid categories={allCats} activeCategory={filterCat} onSelect={(cat) => { setFilterCat(cat); if (cat) setActiveTab("findings"); }} />
        </>
      )}

      {/* ── Migration Paths Tab ──────────────────────────────────────────── */}
      {activeTab === "migration" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
            <AdoptionMaturityChart categories={allCats} />
            <MigrationApproachChart categories={allCats} />
          </div>

          {/* Migration strategy explanation */}
          <div style={{
            background: "var(--c-0f172a)", border: "1px solid var(--c-1e293b)",
            borderRadius: 16, padding: "20px 24px", marginBottom: 24,
          }}>
            <div style={{ color: "var(--c-64748b)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 }}>
              Recommended Migration Strategy
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {[
                { phase: "1. Assess", desc: "Identify IaaS workloads eligible for PaaS migration", color: "#3b82f6" },
                { phase: "2. Modernize", desc: "Enable managed services (monitoring, security, DR)", color: "#8b5cf6" },
                { phase: "3. Migrate", desc: "Move from self-managed to Azure platform services", color: "#06b6d4" },
                { phase: "4. Optimize", desc: "Right-size, auto-scale, and reduce operational cost", color: "#22c55e" },
              ].map(s => (
                <div key={s.phase} style={{
                  background: "var(--c-1e293b)", borderRadius: 10, padding: "14px",
                  borderTop: `3px solid ${s.color}`,
                }}>
                  <div style={{ color: s.color, fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{s.phase}</div>
                  <div style={{ color: "var(--c-94a3b8)", fontSize: 11, lineHeight: 1.5 }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── AI Deep Analysis Tab ─────────────────────────────────────────── */}
      {activeTab === "ai" && (
        <AIAdoptionAnalysis data={aiData} loading={aiLoading} error={aiError} onRun={runAiAnalysis} />
      )}

      {/* ── Findings Tab ──────────────────────────────────────────────────── */}
      {activeTab === "findings" && (
        <>
          {/* Filter bar */}
          <div style={{
            display: "flex", gap: 8, flexWrap: "wrap",
            padding: "12px 16px", background: "var(--c-0f172a)",
            border: "1px solid var(--c-1e293b)", borderRadius: 12, marginBottom: 16,
          }}>
            {/* Severity */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "var(--c-475569)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginRight: 4 }}>Priority:</span>
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

            {/* Impact */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", borderLeft: "1px solid var(--c-1e293b)", paddingLeft: 10 }}>
              <span style={{ color: "var(--c-475569)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginRight: 4 }}>Impact:</span>
              {[["all","All"],["high","High"],["medium","Medium"],["low","Low"]].map(([v,l]) => {
                const c = IMPACT_COLOR[v] || "var(--c-64748b)";
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

            {filterCat && (
              <button onClick={() => setFilterCat(null)} style={{
                background: "#1e3a5f18", color: 'var(--c-60a5fa)',
                border: "1px solid #1d4ed830", borderRadius: 20,
                padding: "2px 10px", fontSize: 11, cursor: "pointer",
              }}>
                ✕ Clear category
              </button>
            )}
          </div>

          {/* Results count */}
          <div style={{ color: "var(--c-475569)", fontSize: 11, marginBottom: 12 }}>
            Showing {filteredGaps.length} of {allGaps.length} adoption opportunities
            {filterCat && <span style={{ color: 'var(--c-60a5fa)', marginLeft: 6 }}>
              — {allCats.find(c => c.category_key === filterCat)?.category}
            </span>}
          </div>

          {/* Cards */}
          {filteredGaps.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "40px 20px",
              color: "var(--c-475569)", background: "var(--c-0f172a)",
              borderRadius: 12, border: "1px solid var(--c-1e293b)",
            }}>
              <div style={{ fontSize: 32, marginBottom: 10, color: '#22c55e' }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-94a3b8)" }}>
                No items match the current filter
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredGaps.map((g, i) => (
                <AdoptionCard key={g.resource_id + i} gap={g} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
