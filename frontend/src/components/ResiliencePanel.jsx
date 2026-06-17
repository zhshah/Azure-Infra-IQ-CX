import React, { useState, useMemo } from "react";
import ResourceDetailDrawer from "./ResourceDetailDrawer";
import { asText } from "../utils/safeText";

const RISK_COLOR = { Critical: "#ef4444", High: "#f97316", Medium: "#eab308", Low: "#22c55e" };

function analyzeResilience(resources) {
  const findings = [];

  // 1. Single-instance VMs (only VM in their resource group)
  const vmsByRg = {};
  resources
    .filter(r => r.resource_type?.toLowerCase() === "microsoft.compute/virtualmachines")
    .forEach(r => {
      const key = `${r.subscription_id}/${r.resource_group}`;
      if (!vmsByRg[key]) vmsByRg[key] = [];
      vmsByRg[key].push(r);
    });
  Object.values(vmsByRg)
    .filter(vms => vms.length === 1)
    .flat()
    .forEach(vm => {
      findings.push({
        id: vm.resource_id || vm.resource_name,
        name: vm.resource_name,
        type: "Virtual Machine",
        rg: vm.resource_group,
        risk: "High",
        category: "Single Instance",
        icon: "🖥️",
        description: `"${vm.resource_name}" is the only VM in resource group "${vm.resource_group}". A failure means full service outage — no redundancy exists.`,
        recommendation:
          "Add a second VM instance, or migrate to Azure Virtual Machine Scale Sets with 2+ instances spread across Availability Zones.",
        az_link: "https://learn.microsoft.com/azure/virtual-machine-scale-sets/overview",
        cost: vm.cost_current_month ?? 0,
      });
    });

  // 2. Storage without geo-replication (LRS only)
  resources
    .filter(
      r =>
        r.resource_type?.toLowerCase() === "microsoft.storage/storageaccounts" &&
        /lrs/i.test(r.sku ?? "") &&
        !/grs|gzrs|zrs/i.test(r.sku ?? "")
    )
    .forEach(r => {
      findings.push({
        id: r.resource_id || r.resource_name,
        name: r.resource_name,
        type: "Storage Account",
        rg: r.resource_group,
        risk: "Medium",
        category: "No Geo-Replication",
        icon: "💾",
        description: `"${r.resource_name}" uses ${r.sku || "LRS"} — locally redundant storage only. A datacenter-level failure could result in permanent data loss.`,
        recommendation:
          "Upgrade to GRS (Geo-Redundant Storage) or RAGRS for read-access. Use GZRS for combined zone + geo protection on critical data.",
        az_link: "https://learn.microsoft.com/azure/storage/common/storage-redundancy",
        cost: r.cost_current_month ?? 0,
      });
    });

  // 3. Unmonitored VMs (no metric data available)
  resources
    .filter(
      r =>
        r.resource_type?.toLowerCase() === "microsoft.compute/virtualmachines" &&
        r.score_label === "Unknown"
    )
    .forEach(r => {
      findings.push({
        id: `unmonitored-${r.resource_id || r.resource_name}`,
        name: r.resource_name,
        type: "Virtual Machine",
        rg: r.resource_group,
        risk: "Medium",
        category: "Unmonitored Compute",
        icon: "👁️",
        description: `"${r.resource_name}" has no performance metrics available. Failures, degradation, and capacity issues will go undetected.`,
        recommendation:
          "Enable Azure Monitor, install the Azure Monitor Agent, and configure metric alerts for CPU > 80%, available memory < 10%, and disk latency.",
        az_link:
          "https://learn.microsoft.com/azure/azure-monitor/agents/azure-monitor-agent-overview",
        cost: r.cost_current_month ?? 0,
      });
    });

  // 4. No load balancer in RGs with 2+ VMs
  const rgResources = {};
  resources.forEach(r => {
    const key = `${r.subscription_id}/${r.resource_group}`;
    if (!rgResources[key]) rgResources[key] = [];
    rgResources[key].push(r);
  });
  Object.entries(rgResources).forEach(([key, rList]) => {
    const vms = rList.filter(r => r.resource_type?.toLowerCase() === "microsoft.compute/virtualmachines");
    const hasLB = rList.some(r =>
      r.resource_type?.toLowerCase() === "microsoft.network/loadbalancers" ||
      r.resource_type?.toLowerCase() === "microsoft.network/applicationgateways"
    );
    if (vms.length >= 2 && !hasLB) {
      const [, rg] = key.split("/");
      findings.push({
        id: `no-lb-${key}`,
        name: rg,
        type: "Resource Group",
        rg: rg,
        risk: "High",
        category: "No Load Balancer",
        icon: "⚖️",
        description: `Resource group "${rg}" has ${vms.length} VMs but no Load Balancer or Application Gateway. Traffic is not distributed — a single VM failure will cause service disruption.`,
        recommendation:
          "Add an Azure Load Balancer (Layer 4) or Azure Application Gateway (Layer 7) to distribute traffic and enable automatic failover across the VM instances.",
        az_link: "https://learn.microsoft.com/azure/load-balancer/load-balancer-overview",
        cost: vms.reduce((s, v) => s + (v.cost_current_month ?? 0), 0),
      });
    }
  });

  // 5. Region concentration risk (> 80% resources in one region, with 5+ total)
  const regionCount = {};
  resources.forEach(r => {
    if (r.location) regionCount[r.location] = (regionCount[r.location] || 0) + 1;
  });
  const totalWithRegion = resources.filter(r => r.location).length;
  if (totalWithRegion >= 5) {
    const top = Object.entries(regionCount).sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const pct = Math.round((top[1] / totalWithRegion) * 100);
      if (pct >= 80) {
        findings.push({
          id: `region-concentration`,
          name: top[0],
          type: "Topology",
          rg: "Estate-wide",
          risk: "Medium",
          category: "Region Concentration",
          icon: "🌍",
          description: `${pct}% of your estate (${top[1]}/${totalWithRegion} resources) is deployed in ${top[0]}. A regional outage would affect the vast majority of your workloads.`,
          recommendation:
            "Replicate critical workloads to a paired Azure region. Use Azure Traffic Manager or Azure Front Door for geo-failover routing.",
          az_link:
            "https://learn.microsoft.com/azure/reliability/cross-region-replication-azure",
          cost: 0,
        });
      }
    }
  }

  // 6. SQL databases without backup detection (Basic/S0/S1 tier — limited backup retention)
  resources
    .filter(r => {
      const t = r.resource_type?.toLowerCase() ?? "";
      return (
        (t === "microsoft.sql/servers/databases" || t.includes("sql")) &&
        /basic|s0|s1/i.test(r.sku ?? "")
      );
    })
    .forEach(r => {
      findings.push({
        id: `sql-backup-${r.resource_id || r.resource_name}`,
        name: r.resource_name,
        type: "SQL Database",
        rg: r.resource_group,
        risk: "Medium",
        category: "Limited Backup Retention",
        icon: "🗄️",
        description: `"${r.resource_name}" is on the ${r.sku} tier, which provides only 7 days of backup retention. Data recovery beyond one week is not possible.`,
        recommendation:
          "Upgrade to Standard S2+ or General Purpose tier for 35-day retention, or configure long-term backup retention for compliance requirements.",
        az_link:
          "https://learn.microsoft.com/azure/azure-sql/database/long-term-retention-overview",
        cost: r.cost_current_month ?? 0,
      });
    });

  // Sort by risk severity
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  return findings.sort((a, b) => (order[a.risk] ?? 4) - (order[b.risk] ?? 4));
}

function ResilienceCard({ finding, onSelect }) {
  const [open, setOpen] = useState(false);
  const color = RISK_COLOR[finding.risk] || "#64748b";

  return (
    <div
      style={{
        background: "#0f172a",
        border: "1px solid #1e293b",
        borderRadius: 12,
        padding: "14px 16px",
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>{finding.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 14 }}>{finding.name}</span>
            <span
              style={{
                background: `${color}20`,
                color,
                fontSize: 9,
                fontWeight: 700,
                padding: "2px 7px",
                borderRadius: 20,
                border: `1px solid ${color}40`,
                textTransform: "uppercase",
                letterSpacing: "0.4px",
              }}
            >
              {finding.risk}
            </span>
            <span
              style={{
                background: "#1e293b",
                color: "#64748b",
                fontSize: 9,
                padding: "2px 7px",
                borderRadius: 20,
                border: "1px solid #334155",
              }}
            >
              {finding.category}
            </span>
            <span style={{ color: "#475569", fontSize: 10 }}>{finding.rg}</span>
          </div>

          {/* Description */}
          <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6, marginBottom: 6 }}>
            {finding.description}
          </div>

          {/* Cost */}
          {finding.cost > 0 && (
            <div style={{ color: "#475569", fontSize: 11, marginBottom: 6 }}>
              💰 ${Math.round(finding.cost).toLocaleString()}/mo associated cost
            </div>
          )}

          {/* Expand button */}
          <button
            onClick={() => setOpen(!open)}
            style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 10, padding: 0 }}
          >
            {open ? "▲ Hide recommendation" : "▼ Show recommendation & fix"}
          </button>
          {finding.resource_id && onSelect && (
            <button
              onClick={() => onSelect(finding)}
              style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 10, padding: "0 0 0 10px" }}
            >
              View Resource ↗
            </button>
          )}

          {open && (
            <div
              style={{
                marginTop: 10,
                background: "#1e293b",
                borderRadius: 8,
                padding: "12px 14px",
                border: "1px solid #334155",
              }}
            >
              <div style={{ color: "#22c55e", fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
                ✅ Recommendation
              </div>
              <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6, marginBottom: 10 }}>
                {asText(finding.recommendation)}
              </div>
              <a
                href={finding.az_link}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#3b82f6", fontSize: 11, textDecoration: "none" }}
              >
                📖 Microsoft Docs →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResiliencePanel({ resources = [] }) {
  const clientFindings = useMemo(() => analyzeResilience(resources), [resources]);
  const [apiFindings, setApiFindings] = useState(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [selectedResource, setSelectedResource] = useState(null);

  // Try to fetch from the backend resilience API; fall back to client-side
  React.useEffect(() => {
    setApiLoading(true);
    fetch("/api/resilience/analysis")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.findings) setApiFindings(data.findings); })
      .catch(() => {})
      .finally(() => setApiLoading(false));
  }, []);

  // Normalise API findings to the same shape as client-side findings
  const findings = useMemo(() => {
    if (apiFindings) {
      return apiFindings.map(f => ({
        id: f.resource_id || f.resource_name,
        name: f.resource_name,
        resource_id: f.resource_id,
        type: f.resource_type,
        rg: f.resource_group,
        risk: f.risk,
        category: f.category,
        icon: f.risk === "High" ? "🔴" : f.risk === "Critical" ? "💀" : "⚠️",
        description: f.description,
        recommendation: f.recommendation,
        az_link: f.az_link || "#",
        cost: f.cost_usd ?? 0,
        subscription_id: f.subscription_id,
      }));
    }
    return clientFindings;
  }, [apiFindings, clientFindings]);

  const bySev = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  findings.forEach(f => {
    if (bySev[f.risk] !== undefined) bySev[f.risk]++;
  });

  const categories = [...new Set(findings.map(f => f.category))];

  return (
    <div style={{ fontFamily: "inherit" }}>
      {/* Hero header */}
      <div
        style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 16,
          padding: "24px",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            color: "#64748b",
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginBottom: 12,
          }}
        >
          Resilience & SLA Gap Analysis
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
          <span style={{ color: "#f1f5f9", fontSize: 48, fontWeight: 800, lineHeight: 1 }}>
            {findings.length}
          </span>
          <span style={{ color: "#475569", fontSize: 20 }}>resilience risks</span>
        </div>
        <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.6, marginBottom: 20, maxWidth: 640 }}>
          Identifies single points of failure, unprotected storage, unmonitored compute,
          missing load balancers, and geographic concentration risks across your Azure estate.
          These are <strong style={{ color: "#94a3b8" }}>availability and SLA risks</strong> — not cost issues.
        </div>

        {/* Severity breakdown */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {Object.entries(bySev).map(([sev, count]) => (
            <div
              key={sev}
              style={{
                background: `${RISK_COLOR[sev]}10`,
                border: `1px solid ${RISK_COLOR[sev]}25`,
                borderRadius: 10,
                padding: "10px 18px",
                textAlign: "center",
                minWidth: 70,
              }}
            >
              <div style={{ color: RISK_COLOR[sev], fontSize: 24, fontWeight: 800 }}>{count}</div>
              <div style={{ color: "#64748b", fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>
                {sev}
              </div>
            </div>
          ))}
          {categories.length > 0 && (
            <div
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 10,
                padding: "10px 14px",
                flex: 1,
                minWidth: 180,
              }}
            >
              <div
                style={{
                  color: "#64748b",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Risk Categories
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {categories.map(c => (
                  <span
                    key={c}
                    style={{
                      background: "#0f172a",
                      color: "#94a3b8",
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 10,
                      border: "1px solid #334155",
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Findings list */}
      {findings.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "#475569",
            background: "#0f172a",
            borderRadius: 16,
            border: "1px solid #1e293b",
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>
            No resilience gaps detected
          </div>
          <div style={{ fontSize: 12 }}>
            Your estate shows healthy redundancy and monitoring patterns. Re-run a full scan for an
            updated assessment.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {findings.map((f, i) => (
            <ResilienceCard key={f.id || i} finding={f} onSelect={f => setSelectedResource(f)} />
          ))}
        </div>
      )}

      {selectedResource && (
        <ResourceDetailDrawer
          resourceId={selectedResource.resource_id}
          resourceName={selectedResource.name}
          onClose={() => setSelectedResource(null)}
        />
      )}
    </div>
  );
}
