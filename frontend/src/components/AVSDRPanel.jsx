/**
 * AVSDRPanel.jsx — Azure VMware Solution DR Panel
 * 
 * Features:
 * - Detects AVS resources in customer environment before doing anything
 * - Shows AVS inventory with proper Microsoft Azure icons
 * - Two implementation reference sections: Cross-Zone DR and Cross-Regional DR
 * - Optional AI analysis button (does NOT auto-start)
 */
import React, { useState, useEffect } from "react";
import { api } from "../api/client";
import { ResourceIconImg, getResourceIcon } from "../utils/resourceIcons";
import { Brain } from "lucide-react";

const AVS_ICON = "/icons/other/01219-icon-service-Azure-VMware-Solution.svg";
const EXPRESSROUTE_ICON = "/icons/networking/10079-icon-service-ExpressRoute-Circuits.svg";
const VNET_ICON = "/icons/networking/10061-icon-service-Virtual-Networks.svg";
const RECOVERY_ICON = "/icons/storage/00017-icon-service-Recovery-Services-Vaults.svg";
const GLOBE_ICON = "/icons/networking/10065-icon-service-Traffic-Manager-Profiles.svg";

// ── Cross-Zone DR Implementation Steps ────────────────────────────────────────
const CROSS_ZONE_DR = {
  title: "Cross-Zone DR (Availability Zone Protection)",
  subtitle: "Protect AVS workloads across Availability Zones within the same region",
  icon: AVS_ICON,
  rto: "< 30 minutes",
  rpo: "Near-zero (synchronous replication)",
  costImpact: "Moderate — additional AVS nodes in second AZ",
  description:
    "Deploy a secondary AVS private cloud in a different Availability Zone within the same Azure region. " +
    "This provides protection against single-AZ failures while maintaining low-latency connectivity between environments.",
  architecture: [
    { label: "Primary AVS Private Cloud", detail: "AV36P nodes in AZ1 running production workloads", icon: AVS_ICON },
    { label: "Secondary AVS Private Cloud", detail: "AV36P or AV64 nodes in AZ2 for DR workloads", icon: AVS_ICON },
    { label: "VMware HCX", detail: "Stretched networking & workload mobility between AZs", icon: AVS_ICON },
    { label: "vSAN Stretched Cluster (optional)", detail: "Synchronous replication of VM storage across AZs", icon: AVS_ICON },
    { label: "ExpressRoute / Global Reach", detail: "High-bandwidth connectivity between private clouds", icon: EXPRESSROUTE_ICON },
  ],
  implementationSteps: [
    {
      phase: "Phase 1 — Planning (Week 1-2)",
      steps: [
        "Inventory current AVS private cloud: node count, SKU (AV36P/AV64), storage used",
        "Identify critical VMs and workloads requiring cross-zone protection",
        "Confirm target AZ supports AVS deployment (check quota & availability)",
        "Define RPO/RTO requirements per workload tier",
        "Size secondary AVS environment (can be smaller for DR-only)",
      ],
    },
    {
      phase: "Phase 2 — Infrastructure Provisioning (Week 2-4)",
      steps: [
        "Deploy secondary AVS private cloud in different AZ via Azure Portal or CLI",
        "Configure ExpressRoute Global Reach between primary and secondary private clouds",
        "Set up Azure Virtual Network peering for management connectivity",
        "Configure NSX-T segments on secondary private cloud to mirror primary",
        "Deploy VMware HCX on both private clouds and establish site pairing",
      ],
    },
    {
      phase: "Phase 3 — Replication Setup (Week 4-6)",
      steps: [
        "Option A: Configure VMware SRM (Site Recovery Manager) for automated failover",
        "Option B: Configure vSphere Replication for VM-level RPO protection",
        "Option C: Enable vSAN Stretched Cluster for synchronous replication (if supported)",
        "Create protection groups and recovery plans in SRM",
        "Map networks, IP customization rules, and resource pools for DR site",
      ],
    },
    {
      phase: "Phase 4 — Validation & Runbook (Week 6-8)",
      steps: [
        "Execute test failover for each protection group",
        "Validate application connectivity and DNS resolution post-failover",
        "Document runbook: failover procedures, escalation contacts, recovery validation steps",
        "Schedule quarterly DR drills",
        "Configure Azure Monitor alerts for replication health",
      ],
    },
  ],
};

const CROSS_REGIONAL_DR = {
  title: "Cross-Regional DR (Geographic Protection)",
  subtitle: "Protect AVS workloads across Azure regions for maximum resilience",
  icon: GLOBE_ICON,
  rto: "1-4 hours (depending on approach)",
  rpo: "15 min – 1 hour (asynchronous replication)",
  costImpact: "Higher — full AVS deployment in secondary region + network costs",
  description:
    "Deploy a secondary AVS private cloud in a different Azure region to protect against " +
    "regional disasters. This provides geographic isolation and meets compliance requirements " +
    "for cross-region data protection.",
  architecture: [
    { label: "Primary Region AVS", detail: "Production AVS private cloud (e.g., Qatar Central)", icon: AVS_ICON },
    { label: "DR Region AVS", detail: "Secondary AVS private cloud (e.g., UAE North or paired region)", icon: AVS_ICON },
    { label: "ExpressRoute Global Reach", detail: "Cross-region connectivity between private clouds", icon: EXPRESSROUTE_ICON },
    { label: "VMware SRM / HCX", detail: "DR orchestration and network extension across regions", icon: AVS_ICON },
    { label: "Azure Virtual WAN (optional)", detail: "Hub-to-hub transit connectivity for management", icon: VNET_ICON },
  ],
  implementationSteps: [
    {
      phase: "Phase 1 — Regional Planning (Week 1-3)",
      steps: [
        "Select DR region based on: latency requirements, compliance, data residency, paired region availability",
        "Confirm AVS availability and quota in DR region",
        "Design IP addressing scheme — avoid overlaps between primary and DR environments",
        "Define cross-region network topology (ExpressRoute Global Reach vs VPN)",
        "Identify workloads by tier: Tier 1 (active-active), Tier 2 (warm standby), Tier 3 (cold DR)",
      ],
    },
    {
      phase: "Phase 2 — DR Environment Build (Week 3-6)",
      steps: [
        "Deploy AVS private cloud in DR region (minimum 3 nodes)",
        "Establish ExpressRoute Global Reach between primary and DR private clouds",
        "Configure NSX-T networking in DR site — segments, T1 gateways, firewall rules",
        "Deploy and pair VMware HCX between sites for network extension",
        "Set up identity sources (vCenter SSO, Active Directory) in DR site",
      ],
    },
    {
      phase: "Phase 3 — Replication & DR Automation (Week 6-10)",
      steps: [
        "Deploy VMware SRM in both sites and configure site pairing",
        "Configure vSphere Replication with RPO targets per workload tier",
        "Create protection groups aligned to application tiers",
        "Build recovery plans with ordered VM startup, IP re-mapping, and custom scripts",
        "Configure HCX Network Extension for stretched L2 segments (if needed for seamless failover)",
      ],
    },
    {
      phase: "Phase 4 — Testing & Governance (Week 10-12)",
      steps: [
        "Execute non-disruptive test failover in isolated network",
        "Validate DNS failover (Azure Traffic Manager or Global DNS)",
        "Test application-level connectivity, load balancer re-configuration",
        "Document detailed runbook with region-specific procedures",
        "Establish monthly replication health monitoring and quarterly DR drill schedule",
        "Set up cost governance: auto-scale DR nodes down during non-drill periods",
      ],
    },
  ],
};

// ── Styles ────────────────────────────────────────────────────────────────────
const cardStyle = {
  background: "var(--c-0f172a)",
  border: "1px solid var(--c-1e293b)",
  borderRadius: 12,
  padding: 18,
  marginBottom: 14,
};

const phaseHeaderStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--c-60a5fa)',
  marginBottom: 8,
};

const stepStyle = {
  fontSize: 11,
  color: "var(--c-cbd5e1)",
  paddingLeft: 14,
  borderLeft: "2px solid var(--c-1e293b)",
  marginBottom: 4,
  lineHeight: 1.6,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function AvsIcon({ src, size = 20 }) {
  return <img src={src} alt="" style={{ width: size, height: size, flexShrink: 0 }} />;
}

function DRImplementationCard({ data }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ ...cardStyle, border: "1px solid var(--c-334155)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <AvsIcon src={data.icon} size={28} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-f1f5f9)" }}>{data.title}</div>
          <div style={{ fontSize: 11, color: "var(--c-64748b)" }}>{data.subtitle}</div>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { label: "RTO", value: data.rto, color: "#22c55e" },
          { label: "RPO", value: data.rpo, color: "#3b82f6" },
          { label: "Cost Impact", value: data.costImpact, color: "#f97316" },
        ].map(k => (
          <div key={k.label} style={{ background: "var(--c-1e293b)", borderRadius: 8, padding: "8px 14px", flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: 9, color: "var(--c-64748b)", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>{k.label}</div>
            <div style={{ fontSize: 12, color: k.color, fontWeight: 600 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Description */}
      <p style={{ fontSize: 12, color: "var(--c-94a3b8)", lineHeight: 1.7, marginBottom: 14 }}>{data.description}</p>

      {/* Architecture Components */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-a78bfa)', marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Architecture Components</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
          {data.architecture.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "var(--c-1e293b)", borderRadius: 8, padding: 10 }}>
              <AvsIcon src={a.icon} size={22} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-e2e8f0)" }}>{a.label}</div>
                <div style={{ fontSize: 10, color: "var(--c-64748b)" }}>{a.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Implementation Steps (collapsible) */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "var(--c-1e293b)", border: "1px solid var(--c-334155)", borderRadius: 8,
          padding: "8px 16px", color: 'var(--c-60a5fa)', fontSize: 12, fontWeight: 600,
          cursor: "pointer", width: "100%", textAlign: "left",
        }}
      >
        {expanded ? "▾" : "▸"} Implementation Steps ({data.implementationSteps.length} phases)
      </button>
      {expanded && (
        <div style={{ marginTop: 12 }}>
          {data.implementationSteps.map((phase, pi) => (
            <div key={pi} style={{ marginBottom: 16 }}>
              <div style={phaseHeaderStyle}>{phase.phase}</div>
              {phase.steps.map((s, si) => (
                <div key={si} style={stepStyle}>{s}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AVSDRPanel() {
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  // On mount: check if AVS exists (lightweight inventory call, no AI)
  useEffect(() => {
    api._request("/bcdr/avs/inventory")
      .then(data => { setInventory(data); setLoading(false); })
      .catch(() => { setInventory({ avs_found: false, private_clouds: [], related_resources: [] }); setLoading(false); });
  }, []);

  const runAiAnalysis = () => {
    setAiLoading(true);
    api._request("/ai/bcdr/avs?refresh=true")
      .then(data => { setAiData(data); setAiLoading(false); })
      .catch(() => { setAiLoading(false); });
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 32, color: "var(--c-64748b)" }}>
        <AvsIcon src={AVS_ICON} size={24} />
        <span style={{ fontSize: 13 }}>Checking for Azure VMware Solution resources…</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <AvsIcon src={AVS_ICON} size={32} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--c-f1f5f9)" }}>Azure VMware Solution — DR Planning</div>
          <div style={{ fontSize: 11, color: "var(--c-64748b)" }}>Inventory detection, cross-zone and cross-regional disaster recovery implementation</div>
        </div>
      </div>

      {/* ── AVS Inventory Section ───────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <AvsIcon src={AVS_ICON} size={20} />
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-f1f5f9)" }}>AVS Inventory</span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
            background: inventory.avs_found ? "#22c55e20" : "#f9731620",
            color: inventory.avs_found ? "#22c55e" : "#f97316",
            border: `1px solid ${inventory.avs_found ? "#22c55e40" : "#f9731640"}`,
          }}>
            {inventory.avs_found ? `${inventory.private_clouds.length} Private Cloud(s) Detected` : "No AVS Resources Found"}
          </span>
        </div>

        {!inventory.avs_found ? (
          <div style={{ padding: "24px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "var(--c-64748b)", marginBottom: 8 }}>
              No Azure VMware Solution (AVS) private clouds were detected in your environment.
            </div>
            <div style={{ fontSize: 11, color: "var(--c-475569)" }}>
              The DR implementation guides below are still available for planning purposes if you are considering AVS deployment.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {inventory.private_clouds.map((pc, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--c-1e293b)", borderRadius: 10, padding: "12px 16px" }}>
                <AvsIcon src={AVS_ICON} size={24} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-e2e8f0)" }}>{pc.resource_name}</div>
                  <div style={{ fontSize: 10, color: "var(--c-64748b)" }}>{pc.resource_type}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "var(--c-94a3b8)" }}>{pc.location}</div>
                  {pc.sku && <div style={{ fontSize: 10, color: 'var(--c-a78bfa)', fontWeight: 600 }}>SKU: {typeof pc.sku === 'object' ? pc.sku.name || JSON.stringify(pc.sku) : pc.sku}</div>}
                </div>
                <div style={{ textAlign: "right", minWidth: 120 }}>
                  <div style={{ fontSize: 10, color: "var(--c-64748b)" }}>{pc.resource_group}</div>
                  <div style={{ fontSize: 10, color: "var(--c-475569)" }}>{pc.subscription_name}</div>
                </div>
              </div>
            ))}

            {/* Related resources */}
            {inventory.related_resources?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--c-64748b)", marginBottom: 6 }}>Related Resources</div>
                {inventory.related_resources.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: "1px solid var(--c-1e293b)" }}>
                    <ResourceIconImg resourceType={r.resource_type} size={16} />
                    <span style={{ fontSize: 11, color: "var(--c-cbd5e1)", flex: 1 }}>{r.resource_name}</span>
                    <span style={{ fontSize: 10, color: "var(--c-64748b)" }}>{r.resource_type}</span>
                    <span style={{ fontSize: 10, color: "var(--c-475569)" }}>{r.location}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Cross-Zone DR ───────────────────────────────────────── */}
      <DRImplementationCard data={CROSS_ZONE_DR} />

      {/* ── Cross-Regional DR ───────────────────────────────────── */}
      <DRImplementationCard data={CROSS_REGIONAL_DR} />

      {/* ── Optional AI Analysis ────────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 18, color: 'var(--c-a78bfa)', display: 'flex' }}>{React.createElement(Brain, { size: 18 })}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-f1f5f9)" }}>AI-Powered AVS DR Analysis</span>
          <span style={{ fontSize: 10, color: "var(--c-64748b)" }}>(Optional)</span>
        </div>
        <p style={{ fontSize: 11, color: "var(--c-94a3b8)", marginBottom: 12 }}>
          Run an AI analysis against your environment to get personalized AVS DR recommendations, gap identification, and a readiness score.
        </p>
        {!aiData ? (
          <button
            onClick={runAiAnalysis}
            disabled={aiLoading}
            style={{
              background: aiLoading ? "var(--c-334155)" : "#3b82f6",
              color: "#fff", border: "none", borderRadius: 8,
              padding: "10px 20px", fontSize: 12, fontWeight: 700,
              cursor: aiLoading ? "default" : "pointer",
              opacity: aiLoading ? 0.6 : 1,
            }}
          >
            {aiLoading ? "Analyzing…" : "Run AI Analysis"}
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* AI Results summary */}
            {aiData.readiness_score != null && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ background: "var(--c-1e293b)", borderRadius: 8, padding: 14, minWidth: 140 }}>
                  <div style={{ fontSize: 9, color: "var(--c-64748b)", fontWeight: 700, textTransform: "uppercase" }}>DR Readiness</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: aiData.readiness_score >= 70 ? "#22c55e" : aiData.readiness_score >= 40 ? "#eab308" : "#ef4444" }}>
                    {aiData.readiness_score}%
                  </div>
                </div>
                {aiData.recommended_strategy && (
                  <div style={{ background: "var(--c-1e293b)", borderRadius: 8, padding: 14, flex: 1 }}>
                    <div style={{ fontSize: 9, color: "var(--c-64748b)", fontWeight: 700, textTransform: "uppercase" }}>Recommended Strategy</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-a78bfa)', marginTop: 4 }}>{aiData.recommended_strategy}</div>
                  </div>
                )}
              </div>
            )}
            {aiData.executive_summary && (
              <div style={{ background: "var(--c-1e293b)", borderRadius: 8, padding: 14 }}>
                <p style={{ fontSize: 12, color: "var(--c-94a3b8)", lineHeight: 1.7 }}>{aiData.executive_summary}</p>
              </div>
            )}
            {aiData.critical_gaps?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 6 }}>Critical Gaps ({aiData.critical_gaps.length})</div>
                {aiData.critical_gaps.map((g, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--c-fca5a5)', paddingLeft: 12, borderLeft: "2px solid #ef4444", marginBottom: 4 }}>
                    {typeof g === "string" ? g : g.title || g.description || JSON.stringify(g)}
                  </div>
                ))}
              </div>
            )}
            {aiData.recommendations?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-60a5fa)', marginBottom: 6 }}>Recommendations ({aiData.recommendations.length})</div>
                {aiData.recommendations.map((r, i) => (
                  <div key={i} style={{ fontSize: 11, color: "var(--c-cbd5e1)", paddingLeft: 12, borderLeft: "2px solid #3b82f6", marginBottom: 4 }}>
                    {typeof r === "string" ? r : r.title || r.description || JSON.stringify(r)}
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={runAiAnalysis}
              disabled={aiLoading}
              style={{
                background: "var(--c-1e293b)", border: "1px solid var(--c-334155)", borderRadius: 8,
                padding: "8px 16px", fontSize: 11, fontWeight: 600, color: 'var(--c-60a5fa)',
                cursor: aiLoading ? "default" : "pointer", alignSelf: "flex-start",
              }}
            >
              {aiLoading ? "Re-analyzing…" : "↻ Re-run Analysis"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
