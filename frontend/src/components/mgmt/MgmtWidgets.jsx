/** Shared lightweight widgets + helpers for the management/governance views. */
import React, { useState, useEffect, useMemo } from 'react';
import { Download } from 'lucide-react';

export const API = import.meta.env.VITE_API_URL || '';

export async function getJSON(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path.split('/api/').pop()} → HTTP ${res.status}`);
  return res.json();
}

export function downloadCSV(filename, rows) {
  if (!rows || !rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const card = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 };
export const th = { textAlign: 'left', padding: '8px 10px', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, background: '#0b1220' };
export const td = { padding: '8px 10px', color: '#cbd5e1', fontSize: 12, borderBottom: '1px solid #111a2e' };

export function KPI({ label, value, sub, color = '#38bdf8', Icon }) {
  return (
    <div style={{ flex: '1 1 160px', minWidth: 160, ...card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
        {Icon && <Icon size={16} style={{ color }} />}
      </div>
      <div style={{ color, fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function Bar({ label, value, total, color }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ color: '#e2e8f0' }}>{value}{total ? ` · ${pct}%` : ''}</span>
      </div>
      <div style={{ height: 8, background: '#1e293b', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6 }} />
      </div>
    </div>
  );
}

export function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #1e293b', flexWrap: 'wrap' }}>
      {tabs.map(({ key, label, Icon }) => (
        <button key={key} onClick={() => onChange(key)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', fontSize: 13, fontWeight: 600,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: active === key ? '#38bdf8' : '#94a3b8',
          borderBottom: active === key ? '2px solid #38bdf8' : '2px solid transparent',
        }}>
          {Icon && <Icon size={14} />} {label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div style={{ ...card, textAlign: 'center', color: '#94a3b8', padding: 40 }}>
      <div style={{ width: 40, height: 40, border: '3px solid #1e293b', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 14px' }} />
      {label}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div style={{ ...card, borderColor: '#dc2626', color: '#fca5a5', fontSize: 13 }}>
      Failed to load: {error}
      {onRetry && <button onClick={onRetry} style={{ marginLeft: 12, background: '#1e40af', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}>Retry</button>}
    </div>
  );
}

export function ViewHeader({ title, subtitle, onRefresh, loading }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      <div>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700, margin: 0 }}>{title}</h2>
        <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 0' }}>{subtitle}</p>
      </div>
      {onRefresh && (
        <button onClick={onRefresh} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: loading ? 'default' : 'pointer' }}>
          <span style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid #475569', borderTopColor: '#38bdf8', borderRadius: '50%', animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </button>
      )}
    </div>
  );
}

const selStyle = { background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 7, padding: '5px 8px', fontSize: 12 };

// Fetch the subscription id->name map once (for friendly subscription filters/columns).
export function useSubscriptions() {
  const [subMap, setSubMap] = useState({});
  useEffect(() => {
    let alive = true;
    getJSON('/api/subscriptions').then((list) => {
      if (!alive) return;
      const m = {};
      (list || []).forEach((s) => {
        const id = (s.subscription_id || s.id || '').toLowerCase();
        if (id) m[id] = s.subscription_name || s.name || s.display_name || id;
      });
      setSubMap(m);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return subMap;
}

/**
 * Enterprise data grid: subscription/RG filters, free-text search, sortable
 * columns, and CSV export of the filtered+sorted result. `columns` is
 * [{ key, label, render?(value,row,subName), csv?(value,row), tdStyle?(value,row) }].
 */
export function DataGrid({ rows, columns, subField, rgField, searchFields, subMap = {}, csvName, filters = ['sub', 'rg', 'search'], facets = [], maxHeight = '56vh', title }) {
  const [sub, setSub] = useState('all');
  const [rg, setRg] = useState('all');
  const [q, setQ] = useState('');
  const [facetVals, setFacetVals] = useState({});
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const subName = (v) => (v ? (subMap[v.toLowerCase()] || (v.length > 12 ? v.slice(0, 8) + '…' : v)) : '—');
  const facetNorm = (f, v) => (f.normalize ? f.normalize(v) : (v == null ? '' : String(v)));

  const subOpts = useMemo(() => (subField ? [...new Set((rows || []).map((r) => r[subField]).filter(Boolean))] : []), [rows, subField]);
  const rgOpts = useMemo(() => (rgField ? [...new Set((rows || []).map((r) => r[rgField]).filter(Boolean))].sort() : []), [rows, rgField]);
  const facetOpts = useMemo(() => {
    const map = {};
    (facets || []).forEach((f) => {
      const set = new Set();
      (rows || []).forEach((r) => { const nv = facetNorm(f, r[f.field]); if (nv !== '' && nv != null) set.add(nv); });
      map[f.field] = [...set].sort();
    });
    return map;
  }, [rows, facets]);

  const filtered = useMemo(() => {
    const sf = searchFields && searchFields.length ? searchFields : columns.map((c) => c.key);
    let out = (rows || []).filter((r) => {
      if (sub !== 'all' && subField && r[subField] !== sub) return false;
      if (rg !== 'all' && rgField && r[rgField] !== rg) return false;
      for (const f of (facets || [])) {
        const sel = facetVals[f.field];
        if (sel && sel !== 'all' && facetNorm(f, r[f.field]) !== sel) return false;
      }
      if (q) {
        const hay = sf.map((f) => r[f] ?? '').join(' ').toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const na = Number(av), nb = Number(bv);
        const cmp = (av !== '' && bv !== '' && !isNaN(na) && !isNaN(nb)) ? na - nb : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, sub, rg, q, facetVals, facets, sortKey, sortDir, subField, rgField, searchFields, columns]);

  const exportRows = useMemo(() => filtered.map((r) => {
    const o = {};
    columns.forEach((c) => {
      let v = r[c.key];
      if (c.key === subField) v = subName(r[c.key]);
      else if (c.csv) v = c.csv(r[c.key], r);
      o[c.label] = v;
    });
    return o;
  }), [filtered, columns, subField, subMap]);

  function toggleSort(k) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  }

  const showSub = filters.includes('sub') && subField && subOpts.length >= 1;
  const showRg = filters.includes('rg') && rgField && rgOpts.length > 1;
  const showSearch = filters.includes('search');
  const activeFacets = (facets || []).filter((f) => (facetOpts[f.field] || []).length > 1);
  const anyFacetActive = Object.values(facetVals).some((v) => v && v !== 'all');
  const anyActive = sub !== 'all' || rg !== 'all' || q || anyFacetActive;
  const clearAll = () => { setSub('all'); setRg('all'); setQ(''); setFacetVals({}); };

  return (
    <div style={{ ...card, padding: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {title && <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{title} ({filtered.length})</span>}
          {showSub && (
            <select value={sub} onChange={(e) => setSub(e.target.value)} style={selStyle} title="Filter by subscription">
              <option value="all">All subscriptions</option>
              {subOpts.map((s) => <option key={s} value={s}>{subName(s)}</option>)}
            </select>
          )}
          {showRg && (
            <select value={rg} onChange={(e) => setRg(e.target.value)} style={selStyle} title="Filter by resource group">
              <option value="all">All resource groups</option>
              {rgOpts.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          {activeFacets.map((f) => (
            <select key={f.field} value={facetVals[f.field] || 'all'} onChange={(e) => setFacetVals((s) => ({ ...s, [f.field]: e.target.value }))} style={selStyle} title={`Filter by ${f.label}`}>
              <option value="all">All {f.label}</option>
              {(facetOpts[f.field] || []).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          ))}
          {showSearch && (
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ ...selStyle, minWidth: 160 }} />
          )}
          {anyActive && (
            <button onClick={clearAll} style={{ ...selStyle, cursor: 'pointer', color: '#94a3b8' }}>Clear</button>
          )}
        </div>
        {csvName && (
          <button onClick={() => downloadCSV(csvName, exportRows)} style={{ display: 'flex', alignItems: 'center', gap: 5, ...selStyle, cursor: 'pointer' }}>
            <Download size={12} /> CSV ({filtered.length})
          </button>
        )}
      </div>
      <div style={{ overflow: 'auto', maxHeight }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{columns.map((c) => (
            <th key={c.key} style={{ ...th, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => toggleSort(c.key)} title="Click to sort">
              {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
            </th>
          ))}</tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td style={td} colSpan={columns.length}>No matching rows.</td></tr>}
            {filtered.slice(0, 2000).map((r, i) => (
              <tr key={i}>{columns.map((c) => (
                <td key={c.key} style={{ ...td, ...(c.tdStyle ? c.tdStyle(r[c.key], r) : {}) }}>
                  {c.render ? c.render(r[c.key], r, subName) : (c.key === subField ? subName(r[c.key]) : (r[c.key] ?? '—'))}
                </td>
              ))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
