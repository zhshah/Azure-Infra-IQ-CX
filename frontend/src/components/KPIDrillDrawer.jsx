/**
 * KPIDrillDrawer — Lightweight slide-out drawer for KPI drill-downs.
 * Shows a filtered list of items when a user clicks a KPI card in any module.
 */
import React, { useState, useMemo } from "react";
import { X, Search, Download, ChevronDown, ChevronRight } from "lucide-react";
import { ResourceIconImg } from "../utils/resourceIcons";

export default function KPIDrillDrawer({ open, onClose, title, subtitle, accent = "#38bdf8", items = [], columns = [] }) {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [expandedIdx, setExpandedIdx] = useState(null);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(it =>
      columns.some(c => String(c.value(it) ?? "").toLowerCase().includes(q))
    );
  }, [items, search, columns]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    const col = columns.find(c => c.key === sortCol);
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const va = col.value(a), vb = col.value(b);
      const na = typeof va === "number" ? va : parseFloat(va) || 0;
      const nb = typeof vb === "number" ? vb : parseFloat(vb) || 0;
      if (!isNaN(na) && !isNaN(nb)) return sortDir === "asc" ? na - nb : nb - na;
      return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }, [filtered, sortCol, sortDir, columns]);

  const exportCSV = () => {
    const hdr = columns.map(c => c.label).join(",");
    const rows = sorted.map(it => columns.map(c => `"${String(c.value(it) ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([hdr + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${title || "drill-down"}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", justifyContent: "flex-end" }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }} />

      {/* Drawer */}
      <div style={{
        position: "relative", width: "min(560px, 90vw)", height: "100vh",
        background: "var(--c-0d1117)", borderLeft: `2px solid ${accent}30`,
        display: "flex", flexDirection: "column", overflow: "hidden",
        animation: "slideIn 0.2s ease-out",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--c-1e293b)", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 style={{ color: accent, margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
              {subtitle && <p style={{ color: "var(--c-64748b)", margin: "2px 0 0", fontSize: 12 }}>{subtitle}</p>}
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--c-64748b)", cursor: "pointer", padding: 4 }}>
              <X size={18} />
            </button>
          </div>

          {/* Search + Export */}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <div style={{ flex: 1, position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--c-475569)" }} />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Filter items..."
                style={{
                  width: "100%", background: "var(--c-1e293b)", border: "1px solid var(--c-334155)", borderRadius: 8,
                  color: "var(--c-e2e8f0)", fontSize: 12, padding: "6px 10px 6px 30px", outline: "none",
                }}
              />
            </div>
            <button onClick={exportCSV} style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "var(--c-1e293b)", border: "1px solid var(--c-334155)", borderRadius: 8,
              color: "var(--c-94a3b8)", fontSize: 11, padding: "6px 10px", cursor: "pointer",
            }}>
              <Download size={12} /> CSV
            </button>
          </div>

          <div style={{ color: "var(--c-475569)", fontSize: 11, marginTop: 8 }}>
            {sorted.length} item{sorted.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Table Header */}
        <div style={{
          display: "grid", gridTemplateColumns: columns.map(c => c.width || "1fr").join(" "),
          padding: "8px 20px", borderBottom: "1px solid var(--c-1e293b)", background: "var(--c-0f172a)", flexShrink: 0,
        }}>
          {columns.map(c => (
            <div key={c.key}
              onClick={() => { setSortCol(c.key); setSortDir(d => sortCol === c.key && d === "asc" ? "desc" : "asc"); }}
              style={{
                color: "var(--c-64748b)", fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.5px", cursor: "pointer", userSelect: "none",
                display: "flex", alignItems: "center", gap: 3,
              }}>
              {c.label}
              {sortCol === c.key && <ChevronDown size={10} style={{ transform: sortDir === "desc" ? "rotate(180deg)" : "none" }} />}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          {sorted.map((item, idx) => (
            <div key={idx}>
              <div
                onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                style={{
                  display: "grid", gridTemplateColumns: columns.map(c => c.width || "1fr").join(" "),
                  padding: "10px 20px", borderBottom: "1px solid #1e293b08",
                  cursor: item.detail ? "pointer" : "default",
                  background: expandedIdx === idx ? "#1e293b30" : "transparent",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#1e293b40"}
                onMouseLeave={e => e.currentTarget.style.background = expandedIdx === idx ? "#1e293b30" : "transparent"}
              >
                {columns.map(c => {
                  const val = c.value(item);
                  return (
                    <div key={c.key} style={{
                      color: c.color ? c.color(item) : "var(--c-e2e8f0)",
                      fontSize: 12, display: "flex", alignItems: "center", gap: 6,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {c.key === "name" && item.type && <ResourceIconImg type={item.type} size={16} />}
                      {c.render ? c.render(item) : val}
                      {c.key === columns[0]?.key && item.detail && (
                        <ChevronRight size={11} style={{ color: "var(--c-475569)", marginLeft: "auto", transform: expandedIdx === idx ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Expanded detail */}
              {expandedIdx === idx && item.detail && (
                <div style={{ padding: "8px 20px 12px 36px", borderBottom: "1px solid #1e293b20", background: "var(--c-0f172a)" }}>
                  <div style={{ color: "var(--c-94a3b8)", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {item.detail}
                  </div>
                </div>
              )}
            </div>
          ))}
          {sorted.length === 0 && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--c-475569)", fontSize: 13 }}>
              No items to show
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0.8; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
