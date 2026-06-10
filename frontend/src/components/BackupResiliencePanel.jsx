/**
 * BackupResiliencePanel.jsx — Comprehensive Azure Backup & DR Dashboard
 *
 * Features:
 * - Tabbed UI: Overview | Findings | Vaults | RoC Advisory | DR & Replication | Charts
 * - KPI tiles with coverage metrics, vault health, RoC warnings
 * - SVG donut and bar charts (zero external dependencies)
 * - Cards + List view with filtering, search, severity, category, export
 * - Region of Choice (RoC) advisory with migration steps
 * - Recovery Services Vault + Backup Vault health analysis
 * - ASR replication status and VM DR gaps
 * - Backup job success/failure metrics
 */
import React, { useState, useEffect, useMemo } from "react";
import ResourceDetailDrawer from "./ResourceDetailDrawer";
import { ShieldCheck, Monitor, AlertTriangle, Database, CircleSlash, Trash2, XCircle, RefreshCw, Shield, Clock, LayoutGrid, List, Globe, DollarSign, Lightbulb, CheckCircle, ChevronUp, ChevronDown, AlertOctagon } from "lucide-react";
import { api } from "../api/client";
import { ResourceIconImg } from "../utils/resourceIcons";
import KPIDrillDrawer from "./KPIDrillDrawer";
import SearchableSelect from "./shared/SearchableSelect";

// ── Color palette ──────────────────────────────────────────────────────────

const SEV_COLOR = { critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#64748b" };
const SEV_BG    = { critical: "#ef444415", high: "#f9731615", medium: "#eab30815", low: "#64748b12" };
const SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

const CHART_COLORS = [
  "#60a5fa", "#a78bfa", "#f472b6", "#fb923c", "#facc15",
  "#34d399", "#22d3ee", "#818cf8", "#f87171", "#94a3b8",
];
const REDUNDANCY_COLOR = {
  GeoRedundant: "#22c55e", ZoneRedundant: "#3b82f6",
  LocallyRedundant: "#ef4444", Unknown: "#6b7280",
};
const HEALTH_COLOR = {
  Normal: "#22c55e", Warning: "#eab308", Critical: "#ef4444", Unknown: "#6b7280",
  Completed: "#22c55e", Failed: "#ef4444", InProgress: "#3b82f6", CompletedWithWarnings: "#eab308",
};

const TABS = [
  { key: "overview",     label: "Overview" },
  { key: "findings",     label: "Findings" },
  { key: "vaults",       label: "Vaults" },
  { key: "roc",          label: "RoC Advisory" },
  { key: "dr",           label: "DR & Replication" },
  { key: "ransomware",   label: "Ransomware" },
  { key: "rpo_rto",      label: "RPO/RTO" },
  { key: "charts",       label: "Charts" },
  { key: "executive",    label: "Executive Summary" },
  { key: "timeline",     label: "Timeline" },
  { key: "testing",      label: "DR Testing Plan" },
  { key: "compliance",   label: "Compliance" },
  { key: "strategy",     label: "Strategy Ref" },
];

// ── SVG Donut Chart ────────────────────────────────────────────────────────

function DonutChart({ data, colorMap, size = 130, label }) {
  const entries = Object.entries(data || {}).filter(([, v]) => v > 0);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (!total) return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 11 }}>No data</div>
  );
  const r = 48, cx = size / 2, cy = size / 2;
  let startAngle = -Math.PI / 2;
  const slices = entries.map(([k, v], i) => {
    const angle = (v / total) * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${angle > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`;
    startAngle = endAngle;
    const color = colorMap?.[k] || CHART_COLORS[i % CHART_COLORS.length];
    return { k, v, pct: Math.round(v / total * 100), d, color };
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg width={size} height={size}>
        {slices.map(s => <path key={s.k} d={s.d} fill={s.color} opacity={0.85} />)}
        <circle cx={cx} cy={cy} r={r * 0.55} fill="#0f172a" />
        <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="middle" fill="#e2e8f0" fontSize={16} fontWeight={800}>{total}</text>
        {label && <text x={cx} y={cy + 12} textAnchor="middle" fill="#64748b" fontSize={9}>{label}</text>}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", maxWidth: 220 }}>
        {slices.map(s => (
          <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: "#94a3b8" }}>{s.k}</span>
            <span style={{ fontSize: 10, color: "#e2e8f0", fontWeight: 600 }}>{s.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Horizontal Bar Chart ───────────────────────────────────────────────────

function HBarChart({ data, maxBars = 8, colorMap }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]).slice(0, maxBars);
  const maxVal = Math.max(...entries.map(([, v]) => v), 1);
  if (!entries.length) return <div style={{ color: "#475569", fontSize: 12, padding: 16 }}>No data</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {entries.map(([k, v], i) => (
        <div key={k}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ fontSize: 11, color: "#94a3b8", maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
            <span style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>{v}</span>
          </div>
          <div style={{ height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(v / maxVal * 100).toFixed(0)}%`, background: colorMap?.[k] || CHART_COLORS[i % CHART_COLORS.length], borderRadius: 3, transition: "width 0.6s ease" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── KPI Tile ───────────────────────────────────────────────────────────────

function KPITile({ icon: Icon, label, value, sub, color = "#e2e8f0", accent, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: "#0f172a", border: `1px solid ${accent || "#1e293b"}`,
      borderRadius: 12, padding: "14px 16px", minWidth: 130, flex: 1,
      cursor: onClick ? "pointer" : "default", transition: "all 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {Icon == null
          ? null
          : (typeof Icon === "string" || typeof Icon === "number")
            ? <span style={{ fontSize: 16 }}>{Icon}</span>
            : <Icon size={15} style={{ color: color !== "#e2e8f0" ? color : "#64748b" }} />}
        <span style={{ fontSize: 9, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Coverage Arc ───────────────────────────────────────────────────────────

function CoverageArc({ pct, size = 100 }) {
  const p = Math.min(100, Math.max(0, pct || 0));
  const r = 40, circ = 2 * Math.PI * r;
  const dash = (p / 100) * circ;
  const color = p >= 80 ? "#22c55e" : p >= 60 ? "#eab308" : "#ef4444";
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={8} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fill={color} fontSize={16} fontWeight={800}>{Math.round(p)}%</text>
    </svg>
  );
}

// ── Severity Badge ─────────────────────────────────────────────────────────

function SevBadge({ severity }) {
  const col = SEV_COLOR[severity] || "#64748b";
  return (
    <span style={{
      background: `${col}18`, color: col, fontSize: 9, fontWeight: 700,
      padding: "2px 8px", borderRadius: 20, border: `1px solid ${col}35`,
      textTransform: "uppercase", letterSpacing: 0.4,
    }}>
      {SEV_LABEL[severity] || severity}
    </span>
  );
}

// ── Export to CSV ──────────────────────────────────────────────────────────

function exportCSV(items, filename) {
  if (!items?.length) return;
  const cols = Object.keys(items[0]);
  const rows = [cols.join(",")];
  for (const r of items) {
    rows.push(cols.map(c => {
      const v = r[c];
      if (v == null) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","));
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

// ── Filter Bar ─────────────────────────────────────────────────────────────

function FilterBar({ filters, setFilters, severityOptions, categoryOptions }) {
  return (
    <div style={{
      display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 14px", alignItems: "flex-end",
      background: "#111827", border: "1px solid rgba(30, 41, 59, 0.7)", borderRadius: 10, marginBottom: 14,
    }}>
      <input
        type="text" placeholder="Search resources…" value={filters.search}
        onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
        style={{
          background: "#0c1220", border: "1px solid #1e293b", borderRadius: 7,
          color: "#e2e8f0", fontSize: 11, padding: "7px 10px", outline: "none",
          flex: 1, minWidth: 180, transition: 'border-color 0.15s',
        }}
        onFocus={e => e.target.style.borderColor = '#0078d4'}
        onBlur={e => e.target.style.borderColor = '#1e293b'}
      />
      <div style={{ width: 140 }}>
        <SearchableSelect
          value={filters.severity || ''}
          onChange={v => setFilters(f => ({ ...f, severity: v }))}
          options={[{value:'',label:'All Severities'}, ...(severityOptions || ['critical','high','medium','low']).map(s => ({value:s,label:SEV_LABEL[s]||s}))]}
          compact
        />
      </div>
      {categoryOptions?.length > 0 && (
        <div style={{ width: 150 }}>
          <SearchableSelect
            value={filters.category || ''}
            onChange={v => setFilters(f => ({ ...f, category: v }))}
            options={[{value:'',label:'All Categories'}, ...categoryOptions.map(c => ({value:c,label:c}))]}
            compact
          />
        </div>
      )}
      <button onClick={() => setFilters({ search: "", severity: "", category: "" })}
        style={{
          background: "transparent", border: "1px solid #1e293b", borderRadius: 7,
          cursor: "pointer", color: "#64748b", padding: "6px 12px", fontSize: 11,
          transition: 'all 0.15s',
        }}>
        Clear
      </button>
    </div>
  );
}

// ── Finding Card ───────────────────────────────────────────────────────────

function FindingCard({ item, expanded, onToggle, onSelect }) {
  const sev = item.severity || "medium";
  const col = SEV_COLOR[sev] || "#64748b";
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
      padding: "14px 16px", borderLeft: `3px solid ${col}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <ResourceIconImg resourceType={item.resource_type} size={15} />
            <span style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 13 }}>{item.resource_name || item.vault_name || item.title}</span>
            <SevBadge severity={sev} />
            {item.category && (
              <span style={{ fontSize: 9, color: "#475569", background: "#1e293b", padding: "2px 7px", borderRadius: 10, border: "1px solid #334155" }}>
                {item.category}
              </span>
            )}
            {item.finding_type && (
              <span style={{ fontSize: 9, color: "#60a5fa", background: "#1e40af15", padding: "2px 7px", borderRadius: 10, border: "1px solid #1d4ed825" }}>
                {item.finding_type.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <div style={{ color: "#475569", fontSize: 10, marginBottom: 4 }}>
            {item.resource_group || item.location || ""}
            {item.resource_type && <span> · {item.resource_type.split("/").pop()}</span>}
            {item.location && <span> · {item.location}</span>}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }}>{item.description}</div>
          {item.last_backup_status && (
            <div style={{ color: "#475569", fontSize: 10, marginTop: 4 }}>Last backup: {item.last_backup_status}</div>
          )}
          <button onClick={onToggle} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 10, padding: 0, marginTop: 6, display: "flex", alignItems: "center", gap: 3 }}>
            {expanded ? React.createElement(ChevronUp, { size: 10 }) : React.createElement(ChevronDown, { size: 10 })} {expanded ? "Hide details" : "Show recommendation"}
          </button>
          {item.resource_id && onSelect && (
            <button onClick={() => onSelect(item)} style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 10, padding: "0 0 0 0", marginTop: 4, display: "block" }}>
              View Resource ↗
            </button>
          )}
          {expanded && (
            <div style={{ marginTop: 10, background: "#1e293b", borderRadius: 8, padding: "12px 14px", border: "1px solid #334155" }}>
              <div style={{ color: "#22c55e", fontSize: 11, fontWeight: 600, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>{React.createElement(CheckCircle, { size: 11 })} Recommendation</div>
              <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }}>{item.recommendation}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── List Row ───────────────────────────────────────────────────────────────

function ListRow({ item, onExpand }) {
  const sev = item.severity || "medium";
  const col = SEV_COLOR[sev] || "#64748b";
  return (
    <div onClick={onExpand} style={{
      display: "grid", gridTemplateColumns: "2fr 1fr 90px 1fr 1fr",
      gap: 8, padding: "10px 14px", borderBottom: "1px solid #1e293b",
      cursor: "pointer", alignItems: "center",
    }}>
      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#f1f5f9", fontSize: 12, fontWeight: 600 }}>
          <ResourceIconImg resourceType={item.resource_type} size={14} />
          {item.resource_name || item.vault_name || item.title}
        </span>
      </div>
      <div style={{ color: "#64748b", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.category || item.finding_type || ""}
      </div>
      <div><SevBadge severity={sev} /></div>
      <div style={{ color: "#475569", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.location || ""}
      </div>
      <div style={{ color: "#475569", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.resource_group || ""}
      </div>
    </div>
  );
}

// ── View Toggle (Cards / List) ─────────────────────────────────────────────

function ViewToggle({ mode, setMode }) {
  const btn = (m, label) => (
    <button onClick={() => setMode(m)} style={{
      background: mode === m ? "#1e40af30" : "transparent",
      border: `1px solid ${mode === m ? "#3b82f6" : "#334155"}`,
      color: mode === m ? "#60a5fa" : "#64748b",
      borderRadius: 8, padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: mode === m ? 700 : 500,
    }}>{label}</button>
  );
  return <div style={{ display: "flex", gap: 4 }}>{btn("cards", "Cards")}{btn("list", "List")}</div>;
}

// ── Tab Bar ────────────────────────────────────────────────────────────────

function TabBar({ active, setActive, tabs, counts }) {
  return (
    <div style={{
      display: "flex", gap: 2, padding: "4px", background: "#0f172a",
      borderRadius: 12, border: "1px solid #1e293b", marginBottom: 16, flexWrap: "wrap",
    }}>
      {tabs.map(t => {
        const isActive = active === t.key;
        const count = counts?.[t.key];
        return (
          <button key={t.key} onClick={() => setActive(t.key)} style={{
            background: isActive ? "#1e293b" : "transparent",
            border: isActive ? "1px solid #334155" : "1px solid transparent",
            borderRadius: 10, padding: "8px 16px", fontSize: 12, cursor: "pointer",
            color: isActive ? "#e2e8f0" : "#64748b", fontWeight: isActive ? 700 : 500,
            display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
          }}>
            {t.label}
            {count != null && count > 0 && (
              <span style={{
                background: isActive ? "#3b82f625" : "#1e293b",
                color: isActive ? "#60a5fa" : "#475569",
                fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
              }}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Vault Card ─────────────────────────────────────────────────────────────

function VaultCard({ vault, type }) {
  const redundancy = vault.storageRedundancy || vault.storageType || "Unknown";
  const redColor = redundancy.toLowerCase().includes("local") ? "#ef4444"
    : redundancy.toLowerCase().includes("geo") ? "#22c55e"
    : redundancy.toLowerCase().includes("zone") ? "#3b82f6" : "#6b7280";

  const sd = type === "rsv"
    ? (vault.softDeleteEnabled || "").toLowerCase()
    : (vault.softDelete || "").toLowerCase();
  const sdEnabled = ["enabled", "alwayson", "on"].includes(sd);

  const crr = (vault.crossRegionRestore || "").toLowerCase();
  const crrEnabled = ["enabled", "true"].includes(crr);

  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "14px 16px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <img src={type === "rsv" ? "/icons/storage/00017-icon-service-Recovery-Services-Vaults.svg" : "/icons/storage/00017-icon-service-Recovery-Services-Vaults.svg"} alt="" style={{ width: 18, height: 18, flexShrink: 0 }} />
            <div style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vault.name}</div>
          </div>
          <div style={{ color: "#475569", fontSize: 10, marginLeft: 26 }}>
            {vault.resourceGroup} · {vault.location}
          </div>
          {vault.sku && <div style={{ color: "#475569", fontSize: 10, marginLeft: 26 }}>SKU: {vault.sku}</div>}
        </div>
        <span style={{
          fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 8,
          textTransform: "uppercase", letterSpacing: 0.3, flexShrink: 0,
          background: type === "rsv" ? "#3b82f615" : "#a78bfa15",
          color: type === "rsv" ? "#60a5fa" : "#a78bfa",
          border: `1px solid ${type === "rsv" ? "#3b82f625" : "#a78bfa25"}`,
        }}>
          {type === "rsv" ? "RSV" : "Backup Vault"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 8,
          background: `${redColor}12`, color: redColor, border: `1px solid ${redColor}25`,
        }}>
          {redundancy}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 8,
          background: sdEnabled ? "#22c55e12" : "#ef444412",
          color: sdEnabled ? "#22c55e" : "#ef4444",
          border: `1px solid ${sdEnabled ? "#22c55e25" : "#ef444425"}`,
        }}>
          Soft-Delete: {sdEnabled ? "ON" : "OFF"}
        </span>
        {type === "rsv" && (
          <span style={{
            fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 8,
            background: crrEnabled ? "#22c55e12" : "#64748b12",
            color: crrEnabled ? "#22c55e" : "#64748b",
            border: `1px solid ${crrEnabled ? "#22c55e25" : "#64748b25"}`,
          }}>
            CRR: {crrEnabled ? "ON" : "OFF"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── RoC Finding Card ───────────────────────────────────────────────────────

function RoCFindingCard({ item }) {
  const col = item.is_roc_critical_region ? "#ef4444" : "#f97316";
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12,
      padding: "14px 16px", borderLeft: `3px solid ${col}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <ResourceIconImg resourceType={item.resource_type || "microsoft.recoveryservices/vaults"} size={15} />
        <span style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 700 }}>{item.resource_name}</span>
        <SevBadge severity={item.severity} />
        {item.is_roc_critical_region && (
          <span style={{
            fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 8,
            background: "#ef444418", color: "#ef4444", border: "1px solid #ef444430",
            textTransform: "uppercase",
          }}>
            No Paired Region
          </span>
        )}
        <span style={{ fontSize: 9, color: "#475569", background: "#1e293b", padding: "2px 7px", borderRadius: 10, border: "1px solid #334155" }}>
          {item.workload_type}
        </span>
      </div>
      <div style={{ color: "#475569", fontSize: 10, marginBottom: 4 }}>
        Source: <span style={{ color: "#94a3b8" }}>{item.source_region}</span>
        <span style={{ margin: "0 6px", color: "#334155" }}>→</span>
        Vault: <span style={{ color: "#94a3b8" }}>{item.vault_name}</span> ({item.vault_region})
      </div>
      <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }}>{item.description}</div>
    </div>
  );
}

// ── ASR Replication Row ────────────────────────────────────────────────────

function ASRRow({ item }) {
  const healthCol = HEALTH_COLOR[item.replication_health] || "#6b7280";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "2fr 1fr 1fr 90px 90px 90px",
      gap: 8, padding: "10px 14px", borderBottom: "1px solid #1e293b", alignItems: "center",
    }}>
      <span style={{ color: "#f1f5f9", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.resource_name}</span>
      <span style={{ color: "#94a3b8", fontSize: 10 }}>{item.source_region}</span>
      <span style={{ color: "#94a3b8", fontSize: 10 }}>{item.target_region}</span>
      <span style={{ fontSize: 9, fontWeight: 600, color: healthCol }}>{item.replication_health}</span>
      <span style={{ fontSize: 9, color: "#64748b" }}>{item.protection_state}</span>
      <span style={{ fontSize: 9, color: item.test_failover_state === "None" ? "#ef4444" : "#22c55e" }}>
        {item.test_failover_state === "None" ? "Never tested" : item.test_failover_state}
      </span>
    </div>
  );
}

// ── Chart Card wrapper ─────────────────────────────────────────────────────

function ChartCard({ title, children }) {
  return (
    <div style={{
      background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14,
      padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10,
      overflow: "hidden", minWidth: 0,
    }}>
      <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{title}</div>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

// ── Paginator ──────────────────────────────────────────────────────────────

function Paginator({ page, totalPages, setPage }) {
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12, alignItems: "center" }}>
      <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: page === 0 ? "default" : "pointer", color: page === 0 ? "#475569" : "#e2e8f0" }}>← Prev</button>
      <span style={{ fontSize: 11, color: "#64748b" }}>Page {page + 1} of {totalPages}</span>
      <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: page >= totalPages - 1 ? "default" : "pointer", color: page >= totalPages - 1 ? "#475569" : "#e2e8f0" }}>Next →</button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ── MAIN COMPONENT ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════

export default function BackupResiliencePanel({ backupCoverage }) {
  const [enhanced, setEnhanced] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");
  const [viewMode, setViewMode] = useState("cards");
  const [expandedId, setExpandedId] = useState(null);
  const [filters, setFilters] = useState({ search: "", severity: "", category: "" });
  const [page, setPage] = useState(0);
  const [selectedResource, setSelectedResource] = useState(null);
  const PAGE_SIZE = 25;

  // Deliverables tab data
  const [execSummary, setExecSummary] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [testingPlan, setTestingPlan] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [strategyRef, setStrategyRef] = useState(null);
  const [ransomwareData, setRansomwareData] = useState(null);
  const [rpoRtoData, setRpoRtoData] = useState(null);
  const [drill, setDrill] = useState({ open: false, title: "", items: [], columns: [], accent: "#38bdf8" });

  // Fetch enhanced backup data
  const fetchData = (forceRefresh = false) => {
    const isInitial = !enhanced;
    if (isInitial) setLoading(true);
    else setRefreshing(true);
    api.getBackupEnhanced(forceRefresh)
      .then(data => { setEnhanced(data); setError(null); })
      .catch(err => { if (isInitial) setError(err.message); })
      .finally(() => { setLoading(false); setRefreshing(false); });
  };
  useEffect(() => { fetchData(false); }, []);

  // Lazy-fetch deliverable tab data
  useEffect(() => {
    const fetchMap = {
      executive:   [execSummary, setExecSummary, "/bcdr/executive-summary"],
      timeline:    [timeline, setTimeline, "/bcdr/timeline"],
      testing:     [testingPlan, setTestingPlan, "/bcdr/testing-plan"],
      compliance:  [compliance, setCompliance, "/bcdr/compliance"],
      strategy:    [strategyRef, setStrategyRef, "/bcdr/strategy-reference"],
      ransomware:  [ransomwareData, setRansomwareData, "/backup/ransomware-readiness"],
      rpo_rto:     [rpoRtoData, setRpoRtoData, "/backup/rpo-rto-matrix"],
    };
    const entry = fetchMap[tab];
    if (entry && !entry[0]) {
      api._request(entry[2]).then(d => entry[1](d)).catch(() => {});
    }
  }, [tab]);

  const handleExcelDownload = () => {
    const a = document.createElement("a");
    a.href = "/api/bcdr/excel-report";
    a.download = "BCDR_Report.xlsx";
    a.click();
  };

  const cacheInfo = enhanced?._cache;
  const cachedAt = cacheInfo?.cached_at ? new Date(cacheInfo.cached_at) : null;
  const cacheAge = cachedAt ? Math.round((Date.now() - cachedAt.getTime()) / 1000) : null;

  const kpis = enhanced?.kpis || {};
  const charts = enhanced?.charts || {};
  const roc = enhanced?.roc_advisory || {};
  const vaults = enhanced?.vaults || {};

  // Combine all findings for the Findings tab
  const allFindings = useMemo(() => {
    const items = [];
    for (const f of (enhanced?.vault_findings || [])) items.push({ ...f, _source: "vault" });
    for (const f of (enhanced?.roc_findings || [])) items.push({ ...f, _source: "roc" });
    for (const f of (enhanced?.unprotected_resources || [])) items.push({ ...f, _source: "unprotected" });
    for (const f of (enhanced?.cosmos_findings || [])) items.push({ ...f, _source: "cosmos" });
    return items;
  }, [enhanced]);

  // Filter + paginate findings
  const filteredFindings = useMemo(() => {
    let items = allFindings;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      items = items.filter(f =>
        (f.resource_name || f.vault_name || f.title || "").toLowerCase().includes(q) ||
        (f.description || "").toLowerCase().includes(q) ||
        (f.resource_group || "").toLowerCase().includes(q)
      );
    }
    if (filters.severity) items = items.filter(f => f.severity === filters.severity);
    if (filters.category) items = items.filter(f => (f.category || f.finding_type || "") === filters.category);
    // Sort by severity
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    items.sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4));
    return items;
  }, [allFindings, filters]);

  const totalPages = Math.ceil(filteredFindings.length / PAGE_SIZE);
  const pageFindings = filteredFindings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const categoryOptions = useMemo(() => {
    const cats = new Set();
    allFindings.forEach(f => { if (f.category) cats.add(f.category); if (f.finding_type) cats.add(f.finding_type); });
    return [...cats].sort();
  }, [allFindings]);

  // Tab counts
  const tabCounts = useMemo(() => ({
    findings: allFindings.length,
    vaults: (vaults.rsv?.length || 0) + (vaults.backup_vaults?.length || 0),
    roc: enhanced?.roc_findings?.length || 0,
    dr: (enhanced?.asr_findings?.length || 0) + (enhanced?.vms_without_dr?.length || 0),
  }), [enhanced, allFindings, vaults]);

  // Also integrate backupCoverage from the main dashboard
  const coverage = backupCoverage;

  // ── Loading / Error states ────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "#475569", background: "#0f172a", borderRadius: 16, border: "1px solid #1e293b" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>{React.createElement(RefreshCw, { size: 40, className: "animate-spin", style: { color: "#3b82f6" } })}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>Loading Enhanced Backup Analysis…</div>
        <div style={{ fontSize: 12 }}>Querying Recovery Services Vaults, Backup Vaults, protected items, and ASR replication…</div>
      </div>
    );
  }

  if (error && !enhanced) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "#ef4444", background: "#0f172a", borderRadius: 16, border: "1px solid #1e293b" }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>{React.createElement(AlertTriangle, { size: 32, style: { color: "#f97316" } })}</div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Backup analysis failed</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>{error}</div>
        {/* Fallback to basic coverage */}
        {coverage && <div style={{ marginTop: 16, color: "#64748b", fontSize: 11 }}>Showing basic backup coverage from last scan below.</div>}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "inherit" }}>
      {/* ── Cache / Refresh bar ───────────────────────────────────────── */}
      <div style={{
        display: "flex", justifyContent: "flex-end", alignItems: "center",
        gap: 10, marginBottom: 10,
      }}>
        {cachedAt && (
          <span style={{ fontSize: 10, color: "#475569" }}>
            {cacheAge != null && cacheAge < 120 ? `Updated ${cacheAge}s ago` :
             cacheAge != null && cacheAge < 3600 ? `Updated ${Math.round(cacheAge / 60)}m ago` :
             `Updated ${cachedAt.toLocaleTimeString()}`}
            {cacheInfo?.stale && <span style={{ color: "#eab308", marginLeft: 4 }}>· stale</span>}
          </span>
        )}
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          style={{
            background: refreshing ? "#1e293b" : "#1e40af20",
            border: "1px solid #3b82f630", borderRadius: 8,
            padding: "4px 12px", fontSize: 10, cursor: refreshing ? "default" : "pointer",
            color: refreshing ? "#475569" : "#60a5fa", fontWeight: 600,
          }}
        >
          {refreshing ? "⟳ Refreshing…" : "Refresh Data"}
        </button>
      </div>
      {/* ── KPI Tiles ─────────────────────────────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))",
        gap: 10, marginBottom: 16,
      }}>
        <KPITile icon={ShieldCheck} label="VM Backup Coverage" value={`${kpis.vm_backup_coverage_pct || 0}%`}
          sub={`${kpis.vms_backed_up || 0}/${kpis.total_vms || 0} VMs`}
          color={kpis.vm_backup_coverage_pct >= 80 ? "#22c55e" : kpis.vm_backup_coverage_pct >= 60 ? "#eab308" : "#ef4444"} />
        <KPITile icon={Monitor} label="Unprotected VMs" value={kpis.vms_not_backed_up || 0}
          color={kpis.vms_not_backed_up > 0 ? "#ef4444" : "#22c55e"}
          accent={kpis.vms_not_backed_up > 0 ? "#ef444425" : undefined} />
        <KPITile icon={AlertTriangle} label="Same-Region Backups" value={kpis.same_region_backups || 0}
          sub="RoC recommended"
          color={kpis.same_region_backups > 0 ? "#f97316" : "#22c55e"}
          accent={kpis.same_region_backups > 0 ? "#f9731625" : undefined} />
        <KPITile icon={Database} label="Total Vaults" value={kpis.total_vaults || 0}
          sub={`${kpis.total_rsv || 0} RSV + ${kpis.total_bv || 0} BV`} />
        <KPITile icon={CircleSlash} label="LRS Vaults" value={kpis.lrs_vaults || 0}
          sub="No geo-redundancy"
          color={kpis.lrs_vaults > 0 ? "#ef4444" : "#22c55e"}
          accent={kpis.lrs_vaults > 0 ? "#ef444425" : undefined} />
        <KPITile icon={Trash2} label="Soft-Delete Off" value={kpis.softdelete_disabled || 0}
          color={kpis.softdelete_disabled > 0 ? "#ef4444" : "#22c55e"}
          accent={kpis.softdelete_disabled > 0 ? "#ef444425" : undefined} />
        <KPITile icon={XCircle} label="Failed Backup Jobs" value={kpis.failed_jobs || 0}
          color={kpis.failed_jobs > 0 ? "#ef4444" : "#22c55e"} />
        <KPITile icon={RefreshCw} label="ASR Replicated" value={kpis.asr_replicated_items || 0}
          sub={`${kpis.vms_without_dr || 0} VMs without DR`} />
      </div>

      {/* ── Tab Bar ───────────────────────────────────────────────────── */}
      <TabBar active={tab} setActive={t => { setTab(t); setPage(0); }} tabs={TABS} counts={tabCounts} />

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div>
          {/* Coverage + RoC warning banner */}
          <div style={{
            display: "grid", gridTemplateColumns: "auto 1fr", gap: 20,
            background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16,
            padding: "20px 24px", marginBottom: 16,
          }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <CoverageArc pct={kpis.vm_backup_coverage_pct} />
              <div style={{ color: "#475569", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>VM Coverage</div>
            </div>
            <div>
              <div style={{ color: "#f1f5f9", fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
                Azure Backup & DR Estate
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
                <div><span style={{ color: "#64748b", fontSize: 10 }}>Protected Items: </span><span style={{ color: "#22c55e", fontWeight: 700 }}>{kpis.total_protected_items || 0}</span></div>
                <div><span style={{ color: "#64748b", fontSize: 10 }}>Unprotected: </span><span style={{ color: "#ef4444", fontWeight: 700 }}>{kpis.total_unprotected_resources || 0}</span></div>
                <div><span style={{ color: "#64748b", fontSize: 10 }}>SQL DBs: </span><span style={{ color: "#60a5fa", fontWeight: 700 }}>{kpis.total_sql_dbs || 0}</span></div>
                <div><span style={{ color: "#64748b", fontSize: 10 }}>PostgreSQL: </span><span style={{ color: "#60a5fa", fontWeight: 700 }}>{kpis.total_pg_servers || 0}</span></div>
                <div><span style={{ color: "#64748b", fontSize: 10 }}>Cosmos DB: </span><span style={{ color: "#60a5fa", fontWeight: 700 }}>{kpis.total_cosmos_accounts || 0}</span></div>
              </div>

              {/* RoC warning */}
              {kpis.same_region_backups > 0 && (
                <div style={{
                  background: "#f9731610", border: "1px solid #f9731630", borderRadius: 10,
                  padding: "10px 14px", marginBottom: 8,
                }}>
                  <div style={{ color: "#f97316", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{React.createElement(AlertTriangle, { size: 12, style: { color: "#f97316" } })} Region of Choice Advisory — {kpis.same_region_backups} backup(s) in same region as source</span>
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.5 }}>
                    These backups are stored in the same region as the source resource. In a regional disaster,
                    both source and backup data would be unavailable. Azure Backup's <strong style={{ color: "#f97316" }}>Region of Choice (RoC)</strong> enables
                    off-site protection in an alternate region.
                    {kpis.roc_critical_items > 0 && (
                      <span style={{ color: "#ef4444" }}> {kpis.roc_critical_items} item(s) are in regions with NO native paired region — RoC is critical.</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Overview charts grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginBottom: 16, overflow: "hidden" }}>
            <ChartCard title="Vault Storage Redundancy">
              <DonutChart data={charts.vault_redundancy} colorMap={REDUNDANCY_COLOR} label="Vaults" />
            </ChartCard>
            <ChartCard title="Soft-Delete Status">
              <DonutChart data={charts.soft_delete_status} colorMap={{ Enabled: "#22c55e", Disabled: "#ef4444" }} label="Vaults" />
            </ChartCard>
            <ChartCard title="Backup Region Distribution">
              <DonutChart data={charts.roc_distribution} colorMap={{ "Same Region": "#f97316", "Cross Region": "#22c55e" }} label="Protected Items" />
            </ChartCard>
            <ChartCard title="Backup Job Status">
              <DonutChart data={charts.job_status} colorMap={HEALTH_COLOR} label="Recent Jobs" />
            </ChartCard>
          </div>

          {/* Top findings preview */}
          {allFindings.length > 0 && (
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14, padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Top Findings</span>
                <button onClick={() => setTab("findings")} style={{ background: "none", border: "none", color: "#3b82f6", fontSize: 11, cursor: "pointer" }}>
                  View all {allFindings.length} →
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {allFindings.slice(0, 5).map((f, i) => <FindingCard key={i} item={f} expanded={false} onToggle={() => {}} />)}
              </div>
            </div>
          )}

          {/* Existing basic coverage integration */}
          {coverage?.categories?.length > 0 && (
            <div style={{ marginTop: 16, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14, padding: "16px 18px" }}>
              <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>Coverage by Resource Category</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                {coverage.categories.map(cat => {
                  const pct = cat.coverage_pct;
                  const barColor = pct >= 80 ? "#22c55e" : pct >= 50 ? "#eab308" : "#ef4444";
                  return (
                    <div key={cat.category_key} style={{ background: "#1e293b", borderRadius: 10, padding: "10px 12px", border: `1px solid ${barColor}20` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>{cat.icon} {cat.category}</span>
                        <span style={{ fontSize: 10, color: barColor, fontWeight: 700 }}>{Math.round(pct)}%</span>
                      </div>
                      <div style={{ height: 4, background: "#0f172a", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 2, transition: "width 0.6s" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, color: "#475569", fontSize: 9 }}>
                        <span>{cat.protected}/{cat.eligible} protected</span>
                        {cat.gaps > 0 && <span style={{ color: "#f97316" }}>{cat.gaps} gaps</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── FINDINGS TAB ─────────────────────────────────────────────── */}
      {tab === "findings" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <ViewToggle mode={viewMode} setMode={setViewMode} />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#64748b" }}>{filteredFindings.length} finding(s)</span>
              <button onClick={() => exportCSV(filteredFindings, "backup-findings.csv")}
                style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "4px 10px", fontSize: 10, color: "#94a3b8", cursor: "pointer" }}>
                Export CSV
              </button>
            </div>
          </div>
          <FilterBar filters={filters} setFilters={setFilters} categoryOptions={categoryOptions} />

          {filteredFindings.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#475569", background: "#0f172a", borderRadius: 12, border: "1px solid #1e293b" }}>
              <div style={{ marginBottom: 8 }}>{React.createElement(CheckCircle, { size: 32, style: { color: "#22c55e" } })}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>No findings match current filters</div>
            </div>
          ) : viewMode === "cards" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pageFindings.map((f, i) => (
                <FindingCard key={f.resource_id || f.vault_id || i} item={f}
                  expanded={expandedId === (f.resource_id || f.vault_id || i)}
                  onToggle={() => setExpandedId(prev => prev === (f.resource_id || f.vault_id || i) ? null : (f.resource_id || f.vault_id || i))}
                  onSelect={f => setSelectedResource(f)}
                />
              ))}
            </div>
          ) : (
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, overflow: "hidden" }}>
              {/* Header */}
              <div style={{
                display: "grid", gridTemplateColumns: "2fr 1fr 90px 1fr 1fr",
                gap: 8, padding: "8px 14px", background: "#1e293b", borderBottom: "1px solid #334155",
              }}>
                {["Resource", "Category", "Severity", "Location", "Resource Group"].map(h => (
                  <span key={h} style={{ fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{h}</span>
                ))}
              </div>
              {pageFindings.map((f, i) => (
                <ListRow key={f.resource_id || f.vault_id || i} item={f}
                  onExpand={() => setExpandedId(prev => prev === (f.resource_id || f.vault_id || i) ? null : (f.resource_id || f.vault_id || i))}
                />
              ))}
            </div>
          )}
          <Paginator page={page} totalPages={totalPages} setPage={setPage} />

          {/* Expanded detail drawer */}
          {expandedId && viewMode === "list" && (() => {
            const item = filteredFindings.find(f => (f.resource_id || f.vault_id) === expandedId);
            if (!item) return null;
            return (
              <div style={{
                background: "#0f172a", border: "1px solid #334155", borderRadius: 12,
                padding: 16, marginTop: 10,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ color: "#f1f5f9", fontSize: 14, fontWeight: 700 }}>{item.resource_name || item.vault_name || item.title}</span>
                  <button onClick={() => setExpandedId(null)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14 }}>✕</button>
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6, marginBottom: 10 }}>{item.description}</div>
                {item.recommendation && (
                  <div style={{ background: "#1e293b", borderRadius: 8, padding: 12, border: "1px solid #334155" }}>
                    <div style={{ color: "#22c55e", fontSize: 11, fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>{React.createElement(CheckCircle, { size: 11 })} Recommendation</div>
                    <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }}>{item.recommendation}</div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── VAULTS TAB ───────────────────────────────────────────────── */}
      {tab === "vaults" && (
        <div>
          {/* Vault summary */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14, marginBottom: 16,
          }}>
            <ChartCard title="Vault Storage Redundancy">
              <DonutChart data={charts.vault_redundancy} colorMap={REDUNDANCY_COLOR} />
            </ChartCard>
            <ChartCard title="Soft-Delete Status">
              <DonutChart data={charts.soft_delete_status} colorMap={{ Enabled: "#22c55e", Disabled: "#ef4444" }} />
            </ChartCard>
          </div>

          {/* Vault findings */}
          {enhanced?.vault_findings?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#f97316", fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                {React.createElement(AlertTriangle, { size: 11 })} Vault Health Issues ({enhanced.vault_findings.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {enhanced.vault_findings.map((f, i) => <FindingCard key={i} item={f} expanded={false} onToggle={() => {}} />)}
              </div>
            </div>
          )}

          {/* RSV list */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>
              Recovery Services Vaults ({vaults.rsv?.length || 0})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
              {(vaults.rsv || []).map(v => <VaultCard key={v.id} vault={v} type="rsv" />)}
            </div>
          </div>

          {/* Backup Vaults */}
          {vaults.backup_vaults?.length > 0 && (
            <div>
              <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>
                Backup Vaults ({vaults.backup_vaults.length})
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
                {vaults.backup_vaults.map(v => <VaultCard key={v.id} vault={v} type="bv" />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── ROC ADVISORY TAB ─────────────────────────────────────────── */}
      {tab === "roc" && (
        <div>
          {/* RoC Info Banner */}
          <div style={{
            background: "linear-gradient(135deg, #1e3a5f, #0f172a)",
            border: "1px solid #1e40af40", borderRadius: 16, padding: "20px 24px", marginBottom: 16,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <span style={{ fontSize: 32 }}>{React.createElement(Globe, { size: 32, style: { color: "#3b82f6" } })}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#60a5fa", fontSize: 16, fontWeight: 800, marginBottom: 6 }}>
                  Azure Backup — Region of Choice (RoC)
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.7, marginBottom: 12 }}>
                  {roc.description || "Region of Choice enables off-site backup protection in non-paired regions."}
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                  <div style={{ background: "#22c55e15", border: "1px solid #22c55e25", borderRadius: 10, padding: "8px 14px" }}>
                    <div style={{ color: "#22c55e", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Primary RoC Region</div>
                    <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700 }}>{roc.default_primary_display || "Sweden Central"}</div>
                  </div>
                  <div style={{ background: "#3b82f615", border: "1px solid #3b82f625", borderRadius: 10, padding: "8px 14px" }}>
                    <div style={{ color: "#3b82f6", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Secondary RoC Region</div>
                    <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700 }}>{roc.default_secondary_display || "Switzerland North"}</div>
                  </div>
                  <div style={{ background: "#f9731615", border: "1px solid #f9731625", borderRadius: 10, padding: "8px 14px" }}>
                    <div style={{ color: "#f97316", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>Same-Region Backups</div>
                    <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700 }}>{roc.total_same_region || 0}</div>
                  </div>
                  <div style={{ background: "#ef444415", border: "1px solid #ef444425", borderRadius: 10, padding: "8px 14px" }}>
                    <div style={{ color: "#ef4444", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>No-Pair Region Items</div>
                    <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700 }}>{roc.roc_critical_count || 0}</div>
                  </div>
                </div>

                {/* Supported workloads */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: "#64748b", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Supported RoC Workloads</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(roc.supported_workloads || []).map(w => (
                      <span key={w} style={{
                        fontSize: 10, color: "#94a3b8", background: "#1e293b",
                        padding: "3px 8px", borderRadius: 8, border: "1px solid #334155",
                      }}>{w}</span>
                    ))}
                  </div>
                </div>

                {/* Migration steps */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: "#64748b", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>RoC Migration Steps</div>
                  <ol style={{ margin: 0, paddingLeft: 18, color: "#94a3b8", fontSize: 11, lineHeight: 2 }}>
                    {(roc.migration_steps || []).map((step, i) => <li key={i}>{step}</li>)}
                  </ol>
                </div>

                {/* Cost note */}
                {roc.cost_note && (
                  <div style={{
                    background: "#eab30810", border: "1px solid #eab30820", borderRadius: 8,
                    padding: "8px 12px", color: "#eab308", fontSize: 11, lineHeight: 1.5,
                  }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>{React.createElement(DollarSign, { size: 11, style: { color: "#eab308" } })} {roc.cost_note}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RoC findings */}
          {enhanced?.roc_findings?.length > 0 ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ color: "#f97316", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{React.createElement(AlertTriangle, { size: 11 })} Same-Region Backup Warnings ({enhanced.roc_findings.length})</span>
                </span>
                <button onClick={() => exportCSV(enhanced.roc_findings, "roc-findings.csv")}
                  style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "4px 10px", fontSize: 10, color: "#94a3b8", cursor: "pointer" }}>
                  Export
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {enhanced.roc_findings.map((f, i) => <RoCFindingCard key={i} item={f} />)}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px", color: "#22c55e", background: "#0f172a", borderRadius: 12, border: "1px solid #1e293b" }}>
              <div style={{ marginBottom: 8 }}>{React.createElement(CheckCircle, { size: 32, style: { color: "#22c55e" } })}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>All backups are stored in a different region from source</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>No Region of Choice warnings detected</div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── DR & REPLICATION TAB ─────────────────────────────────────── */}
      {tab === "dr" && (
        <div>
          {/* DR KPIs */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <KPITile icon={RefreshCw} label="ASR Replicated" value={kpis.asr_replicated_items || 0}
              color="#22c55e" sub="Cross-region replication active" />
            <KPITile icon={Monitor} label="VMs Without DR" value={kpis.vms_without_dr || 0}
              color={kpis.vms_without_dr > 0 ? "#ef4444" : "#22c55e"}
              sub="No cross-region replication" />
          </div>

          {/* ASR Health chart */}
          {Object.keys(charts.asr_health || {}).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <ChartCard title="ASR Replication Health">
                <DonutChart data={charts.asr_health} colorMap={HEALTH_COLOR} label="Replicated Items" />
              </ChartCard>
            </div>
          )}

          {/* DR info banner */}
          <div style={{
            background: "#0f172a", border: "1px solid #3b82f625", borderRadius: 14,
            padding: "16px 18px", marginBottom: 16,
          }}>
            <div style={{ color: "#60a5fa", fontSize: 12, fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
              {React.createElement(Lightbulb, { size: 12 })} Cross-Region DR with Azure Site Recovery (ASR)
            </div>
            <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.7 }}>
              Azure Site Recovery enables cross-region VM replication for high availability.
              VMs are replicated to a secondary region and can be failed over during a regional disaster.
              <strong style={{ color: "#60a5fa" }}> Recovery Services Vault </strong> based replication provides
              continuous replication with RPO of seconds and RTO of minutes. Regular DR drills
              (test failovers) are critical to validate recovery readiness.
            </div>
          </div>

          {/* ASR Replication Items */}
          {enhanced?.asr_findings?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>
                ASR Replicated Items ({enhanced.asr_findings.length})
              </div>
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, overflow: "hidden" }}>
                <div style={{
                  display: "grid", gridTemplateColumns: "2fr 1fr 1fr 90px 90px 90px",
                  gap: 8, padding: "8px 14px", background: "#1e293b", borderBottom: "1px solid #334155",
                }}>
                  {["Resource", "Source Region", "Target Region", "Health", "State", "Test Failover"].map(h => (
                    <span key={h} style={{ fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{h}</span>
                  ))}
                </div>
                {enhanced.asr_findings.map((a, i) => <ASRRow key={i} item={a} />)}
              </div>
            </div>
          )}

          {/* VMs without DR */}
          {enhanced?.vms_without_dr?.length > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
                  VMs Without Cross-Region DR ({enhanced.vms_without_dr.length})
                </span>
                <button onClick={() => exportCSV(enhanced.vms_without_dr, "vms-without-dr.csv")}
                  style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "4px 10px", fontSize: 10, color: "#94a3b8", cursor: "pointer" }}>
                  Export
                </button>
              </div>
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, overflow: "hidden" }}>
                <div style={{
                  display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr",
                  gap: 8, padding: "8px 14px", background: "#1e293b", borderBottom: "1px solid #334155",
                }}>
                  {["VM Name", "Location", "Size", "OS"].map(h => (
                    <span key={h} style={{ fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{h}</span>
                  ))}
                </div>
                {enhanced.vms_without_dr.slice(0, 50).map((vm, i) => (
                  <div key={i} style={{
                    display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr",
                    gap: 8, padding: "10px 14px", borderBottom: "1px solid #1e293b", alignItems: "center",
                  }}>
                    <span style={{ color: "#f1f5f9", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vm.resource_name}</span>
                    <span style={{ color: "#94a3b8", fontSize: 10 }}>{vm.location}</span>
                    <span style={{ color: "#64748b", fontSize: 10 }}>{vm.vm_size}</span>
                    <span style={{ color: "#64748b", fontSize: 10 }}>{vm.os_type}</span>
                  </div>
                ))}
                {enhanced.vms_without_dr.length > 50 && (
                  <div style={{ padding: "8px 14px", color: "#475569", fontSize: 11 }}>
                    … and {enhanced.vms_without_dr.length - 50} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── RANSOMWARE READINESS TAB ─────────────────────────────────── */}
      {tab === "ransomware" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!ransomwareData ? (
            <div style={{ color: "#64748b", padding: 24, textAlign: "center" }}>Loading ransomware readiness assessment…</div>
          ) : (
            <>
              {/* Score Header */}
              <div style={{ background: "#0f172a", border: `1px solid ${ransomwareData.score >= 80 ? "#22c55e" : ransomwareData.score >= 60 ? "#eab308" : "#ef4444"}30`, borderRadius: 12, padding: "20px 24px", display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{ position: "relative", width: 100, height: 100 }}>
                  <svg width={100} height={100} viewBox="0 0 100 100">
                    <circle cx={50} cy={50} r={42} fill="none" stroke="#1e293b" strokeWidth={8} />
                    <circle cx={50} cy={50} r={42} fill="none"
                      stroke={ransomwareData.score >= 80 ? "#22c55e" : ransomwareData.score >= 60 ? "#eab308" : "#ef4444"}
                      strokeWidth={8} strokeDasharray={`${2 * Math.PI * 42 * ransomwareData.score / 100} ${2 * Math.PI * 42}`}
                      strokeDashoffset={2 * Math.PI * 42 * 0.25} strokeLinecap="round" />
                    <text x={50} y={46} textAnchor="middle" fill="#f1f5f9" fontSize={22} fontWeight={800}>{ransomwareData.score}</text>
                    <text x={50} y={62} textAnchor="middle" fill="#64748b" fontSize={10}>/ 100</text>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", display: "flex", alignItems: "center", gap: 6 }}>{React.createElement(Shield, { size: 18, style: { color: "#3b82f6" } })} Ransomware Readiness</span>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                      background: ransomwareData.score >= 80 ? "#22c55e18" : ransomwareData.score >= 60 ? "#eab30818" : "#ef444418",
                      color: ransomwareData.score >= 80 ? "#22c55e" : ransomwareData.score >= 60 ? "#eab308" : "#ef4444",
                      border: `1px solid ${ransomwareData.score >= 80 ? "#22c55e" : ransomwareData.score >= 60 ? "#eab308" : "#ef4444"}40`,
                    }}>Grade {ransomwareData.grade}</span>
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }}>{ransomwareData.summary}</div>
                </div>
              </div>

              {/* Security Checks */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(ransomwareData.checks || []).map((c, i) => {
                  const statusColor = c.status === "pass" ? "#22c55e" : c.status === "warn" ? "#eab308" : "#ef4444";
                  const statusIcon = c.status === "pass" ? React.createElement(CheckCircle, { size: 12, style: { color: "#22c55e" } }) : c.status === "warn" ? React.createElement(AlertTriangle, { size: 12, style: { color: "#eab308" } }) : React.createElement(XCircle, { size: 12, style: { color: "#ef4444" } });
                  return (
                    <div key={i} style={{ background: "#0f172a", border: `1px solid ${statusColor}25`, borderRadius: 10, padding: "14px 18px", borderLeft: `3px solid ${statusColor}` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 16 }}>{c.icon}</span>
                          <span style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 700 }}>{c.check}</span>
                          <span style={{ fontSize: 12 }}>{statusIcon}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 60, height: 5, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${c.coverage_pct}%`, height: "100%", background: statusColor, borderRadius: 3 }} />
                          </div>
                          <span style={{ color: statusColor, fontSize: 11, fontWeight: 700, minWidth: 36, textAlign: "right" }}>{c.coverage_pct}%</span>
                        </div>
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.5, marginBottom: 4 }}>{c.description}</div>
                      <div style={{ color: "#64748b", fontSize: 11 }}>{c.detail}</div>
                    </div>
                  );
                })}
              </div>

              {/* Recommendations */}
              {(ransomwareData.recommendations || []).length > 0 && (
                <div style={{ background: "#0f172a", border: "1px solid #ef444425", borderRadius: 10, padding: 16 }}>
                  <div style={{ color: "#ef4444", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10, display: "flex", alignItems: "center", gap: 4 }}>{React.createElement(AlertOctagon, { size: 12 })} Action Required</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {ransomwareData.recommendations.map((r, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: "#e2e8f0", alignItems: "flex-start" }}>
                        <span style={{ color: r.status === "warn" ? "#eab308" : "#ef4444", flexShrink: 0, marginTop: 2 }}>{r.status === "warn" ? React.createElement(AlertTriangle, { size: 12 }) : React.createElement(XCircle, { size: 12 })}</span>
                        <span><strong>{r.check}</strong>: {r.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── RPO / RTO COMPLIANCE TAB ─────────────────────────────────── */}
      {tab === "rpo_rto" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!rpoRtoData ? (
            <div style={{ color: "#64748b", padding: 24, textAlign: "center" }}>Loading RPO/RTO compliance matrix…</div>
          ) : (
            <>
              {/* KPI Strip */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { label: "Assessed", value: rpoRtoData.total_assessed, color: "#f1f5f9" },
                  { label: "Compliant", value: rpoRtoData.compliant, color: "#22c55e" },
                  { label: "Partial", value: rpoRtoData.partial, color: "#eab308" },
                  { label: "Non-Compliant", value: rpoRtoData.non_compliant, color: "#ef4444" },
                  { label: "Compliance", value: `${rpoRtoData.compliance_pct}%`, color: rpoRtoData.compliance_pct >= 80 ? "#22c55e" : rpoRtoData.compliance_pct >= 50 ? "#eab308" : "#ef4444" },
                ].map((k, i) => (
                  <div key={i} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "10px 14px", minWidth: 100, flex: 1 }}>
                    <div style={{ color: "#475569", fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>{k.label}</div>
                    <div style={{ color: k.color, fontSize: 20, fontWeight: 800 }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Tier Summary */}
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 16 }}>
                <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>RPO/RTO Targets by Business Tier</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                  {(rpoRtoData.tier_summary || []).map((t, i) => {
                    const compColor = t.compliance_pct >= 80 ? "#22c55e" : t.compliance_pct >= 50 ? "#eab308" : "#ef4444";
                    return (
                      <div key={i} style={{ background: "#1e293b", borderRadius: 8, padding: 12, borderLeft: `3px solid ${compColor}` }}>
                        <div style={{ color: "#f1f5f9", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{t.label}</div>
                        <div style={{ display: "flex", gap: 12, marginBottom: 6 }}>
                          <div><span style={{ color: "#64748b", fontSize: 10 }}>RPO: </span><span style={{ color: "#38bdf8", fontSize: 12, fontWeight: 600 }}>{t.target_rpo}</span></div>
                          <div><span style={{ color: "#64748b", fontSize: 10 }}>RTO: </span><span style={{ color: "#a78bfa", fontSize: 12, fontWeight: 600 }}>{t.target_rto}</span></div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ color: "#94a3b8", fontSize: 11 }}>{t.total} resources</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <div style={{ width: 40, height: 4, background: "#0f172a", borderRadius: 2, overflow: "hidden" }}>
                              <div style={{ width: `${t.compliance_pct}%`, height: "100%", background: compColor, borderRadius: 2 }} />
                            </div>
                            <span style={{ color: compColor, fontSize: 10, fontWeight: 700 }}>{t.compliance_pct}%</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Non-compliant entries table */}
              {(rpoRtoData.entries || []).filter(e => e.compliance_status !== "compliant").length > 0 && (
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 16 }}>
                  <div style={{ color: "#ef4444", fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>Non-Compliant Resources</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #1e293b" }}>
                          {["Resource", "Category", "Tier", "Target RPO", "Target RTO", "Current Backup", "Severity"].map((h, i) => (
                            <th key={i} style={{ padding: "6px 8px", textAlign: "left", color: "#475569", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rpoRtoData.entries.filter(e => e.compliance_status !== "compliant").slice(0, 50).map((e, i) => {
                          const sevColor = SEV_COLOR[e.gap_severity] || "#64748b";
                          return (
                            <tr key={i} style={{ borderBottom: "1px solid #1e293b08" }}>
                              <td style={{ padding: "6px 8px" }}>
                                <div style={{ color: "#f1f5f9", fontWeight: 600 }}>{e.resource_name}</div>
                                <div style={{ color: "#475569", fontSize: 10 }}>{e.resource_group}</div>
                              </td>
                              <td style={{ padding: "6px 8px", color: "#94a3b8" }}>{e.category}</td>
                              <td style={{ padding: "6px 8px" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: "#38bdf8", textTransform: "capitalize" }}>{e.business_tier}</span>
                              </td>
                              <td style={{ padding: "6px 8px", color: "#38bdf8" }}>{e.target_rpo_hours}h</td>
                              <td style={{ padding: "6px 8px", color: "#a78bfa" }}>{e.target_rto_hours}h</td>
                              <td style={{ padding: "6px 8px", color: "#94a3b8" }}>{e.backup_method}</td>
                              <td style={{ padding: "6px 8px" }}>
                                <span style={{ background: `${sevColor}18`, color: sevColor, border: `1px solid ${sevColor}40`, fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, textTransform: "uppercase" }}>
                                  {e.gap_severity}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── CHARTS TAB ───────────────────────────────────────────────── */}
      {tab === "charts" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
          <ChartCard title="Vault Storage Redundancy">
            <DonutChart data={charts.vault_redundancy} colorMap={REDUNDANCY_COLOR} size={150} label="All Vaults" />
          </ChartCard>
          <ChartCard title="Soft-Delete Status">
            <DonutChart data={charts.soft_delete_status} colorMap={{ Enabled: "#22c55e", Disabled: "#ef4444" }} size={150} label="All Vaults" />
          </ChartCard>
          <ChartCard title="Backup Region — Same vs Cross">
            <DonutChart data={charts.roc_distribution} colorMap={{ "Same Region": "#f97316", "Cross Region": "#22c55e" }} size={150} label="Protected Items" />
          </ChartCard>
          <ChartCard title="Backup Job Status (Recent)">
            <DonutChart data={charts.job_status} colorMap={HEALTH_COLOR} size={150} label="Jobs" />
          </ChartCard>
          <ChartCard title="Unprotected Resources by Category">
            <HBarChart data={charts.unprotected_by_category} />
          </ChartCard>
          <ChartCard title="VMs Without Backup — by Region">
            <HBarChart data={charts.vm_no_backup_by_region} />
          </ChartCard>
          <ChartCard title="Database Backup Redundancy">
            <DonutChart data={charts.db_backup_redundancy} colorMap={{ Geo: "#22c55e", Local: "#ef4444", Zone: "#3b82f6", Unknown: "#6b7280" }} size={150} label="DB Backup Storage" />
          </ChartCard>
          <ChartCard title="ASR Replication Health">
            <DonutChart data={charts.asr_health} colorMap={HEALTH_COLOR} size={150} label="ASR Items" />
          </ChartCard>

          {/* Job failures list */}
          {enhanced?.job_failures?.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <ChartCard title={`Failed / Warning Backup Jobs (${enhanced.job_failures.length})`}>
                <div style={{ background: "#0f172a", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{
                    display: "grid", gridTemplateColumns: "2fr 1fr 80px 1fr 1fr",
                    gap: 8, padding: "8px 14px", background: "#1e293b", borderBottom: "1px solid #334155",
                  }}>
                    {["Entity", "Operation", "Status", "Start", "Type"].map(h => (
                      <span key={h} style={{ fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>{h}</span>
                    ))}
                  </div>
                  {enhanced.job_failures.slice(0, 20).map((j, i) => {
                    const statusCol = j.status === "Failed" ? "#ef4444" : "#eab308";
                    return (
                      <div key={i} style={{
                        display: "grid", gridTemplateColumns: "2fr 1fr 80px 1fr 1fr",
                        gap: 8, padding: "8px 14px", borderBottom: "1px solid #1e293b", alignItems: "center",
                      }}>
                        <span style={{ color: "#f1f5f9", fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.entity_name}</span>
                        <span style={{ color: "#94a3b8", fontSize: 10 }}>{j.operation}</span>
                        <span style={{ color: statusCol, fontSize: 10, fontWeight: 600 }}>{j.status}</span>
                        <span style={{ color: "#64748b", fontSize: 10 }}>{j.start_time?.slice(0, 16)}</span>
                        <span style={{ color: "#64748b", fontSize: 10 }}>{j.backup_type}</span>
                      </div>
                    );
                  })}
                </div>
              </ChartCard>
            </div>
          )}
        </div>
      )}

      {/* ── Executive Summary Tab ─────────────────────────────────── */}
      {tab === "executive" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={handleExcelDownload} style={{ padding: "8px 16px", background: "#22c55e", color: "#0f172a", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              ⬇ Download Excel Report
            </button>
          </div>
          {!execSummary ? <div style={{ color: "#64748b", padding: 24 }}>Loading executive summary…</div> : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
                {Object.entries(execSummary.kpis || {}).map(([k, v]) => (
                  <div key={k} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>{k.replace(/_/g, " ")}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0", marginTop: 4 }}>{typeof v === "number" ? (v % 1 ? `${v.toFixed(1)}%` : v) : v}</div>
                  </div>
                ))}
              </div>
              {execSummary.key_findings?.length > 0 && (
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", marginBottom: 10 }}>Key Findings</div>
                  {execSummary.key_findings.map((f, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <span style={{ color: SEV_COLOR[f.severity] || "#64748b", fontWeight: 700, fontSize: 11 }}>●</span>
                      <span style={{ fontSize: 11, color: "#cbd5e1" }}>{f.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Timeline Tab ──────────────────────────────────────────── */}
      {tab === "timeline" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {!timeline ? <div style={{ color: "#64748b", padding: 24 }}>Loading timeline…</div> : (
            (timeline.phases || []).map((p, i) => (
              <div key={i} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa" }}>Phase {p.phase}: {p.name}</span>
                  <span style={{ fontSize: 10, color: "#64748b" }}>{p.duration}</span>
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>{p.objective}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {(p.actions || []).map((a, j) => (
                    <div key={j} style={{ fontSize: 11, color: "#cbd5e1", paddingLeft: 12, borderLeft: "2px solid #1e293b" }}>{a}</div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── DR Testing Plan Tab ───────────────────────────────────── */}
      {tab === "testing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!testingPlan ? <div style={{ color: "#64748b", padding: 24 }}>Loading DR testing plan…</div> : (
            <>
              {testingPlan.test_types?.length > 0 && (
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", marginBottom: 10 }}>Test Types</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                    {testingPlan.test_types.map((t, i) => (
                      <div key={i} style={{ background: "#1e293b", borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa" }}>{t.name}</div>
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{t.description}</div>
                        <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Frequency: {t.frequency}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {testingPlan.success_criteria?.length > 0 && (
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", marginBottom: 10 }}>Success Criteria</div>
                  {testingPlan.success_criteria.map((c, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 4, paddingLeft: 12, borderLeft: "2px solid #22c55e" }}>{c}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Compliance Tab ────────────────────────────────────────── */}
      {tab === "compliance" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {!compliance ? <div style={{ color: "#64748b", padding: 24 }}>Loading compliance checklist…</div> : (
            (compliance.categories || []).map((cat, i) => (
              <div key={i} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa", marginBottom: 8 }}>{cat.category}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(cat.items || []).map((item, j) => (
                    <div key={j} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 12, color: item.required ? "#ef4444" : "#64748b", flexShrink: 0 }}>{item.required ? "◉" : "○"}</span>
                      <div>
                        <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>{item.item}</div>
                        {item.description && <div style={{ fontSize: 10, color: "#64748b" }}>{item.description}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Strategy Reference Tab ────────────────────────────────── */}
      {tab === "strategy" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {!strategyRef ? <div style={{ color: "#64748b", padding: 24 }}>Loading strategy reference…</div> : (
            <>
              {(strategyRef.dr_patterns || []).map((p, i) => (
                <div key={i} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa" }}>{p.name}</span>
                    <span style={{ fontSize: 10, color: "#64748b" }}>RTO: {p.rto} | RPO: {p.rpo}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{p.description}</div>
                  {p.use_cases && <div style={{ fontSize: 10, color: "#475569", marginTop: 6 }}>Use cases: {p.use_cases}</div>}
                </div>
              ))}
              {strategyRef.decision_matrix && (
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", marginBottom: 10 }}>Decision Matrix</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr>
                          {Object.keys(strategyRef.decision_matrix[0] || {}).map(h => (
                            <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: "#64748b", borderBottom: "1px solid #1e293b", fontWeight: 700, fontSize: 10, textTransform: "uppercase" }}>{h.replace(/_/g, " ")}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {strategyRef.decision_matrix.map((row, i) => (
                          <tr key={i}>
                            {Object.values(row).map((v, j) => (
                              <td key={j} style={{ padding: "6px 10px", color: "#cbd5e1", borderBottom: "1px solid #0f172a" }}>{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <KPIDrillDrawer
        open={drill.open}
        onClose={() => setDrill(d => ({ ...d, open: false }))}
        title={drill.title}
        accent={drill.accent}
        items={drill.items}
        columns={drill.columns}
      />

      {selectedResource && (
        <ResourceDetailDrawer
          resourceId={selectedResource.resource_id}
          resourceName={selectedResource.resource_name || selectedResource.vault_name}
          onClose={() => setSelectedResource(null)}
        />
      )}
    </div>
  );
}
