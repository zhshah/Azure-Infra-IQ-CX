/**
 * subscriptionNames.js
 * Utility to resolve Azure subscription IDs to display names.
 * Used across all report DataTable views.
 */

/**
 * Build a lookup map from a subscriptions array (from dashboard API).
 * @param {Array} subscriptions - [{id, name, display_name, ...}]
 * @returns {Object} { "sub-id-lower": "Display Name" }
 */
export function buildSubNameMap(subscriptions = []) {
  const map = {};
  (subscriptions || []).forEach(s => {
    const id = (s.id || s.subscription_id || '').toLowerCase();
    if (id) map[id] = s.name || s.display_name || s.subscription_name || id;
  });
  return map;
}

/**
 * Resolve a subscription ID to its display name.
 * @param {string} subId - Raw subscription GUID
 * @param {Object|Array} subscriptions - Map from buildSubNameMap OR raw array
 * @returns {string} Display name or short GUID fallback
 */
export function resolveSubName(subId, subscriptions) {
  if (!subId) return '—';
  const id = subId.toLowerCase();
  // Accept either a pre-built map or a raw array
  const map = Array.isArray(subscriptions)
    ? buildSubNameMap(subscriptions)
    : (subscriptions || {});
  return map[id] || subId.slice(0, 8) + '…';
}

/**
 * React-ready cell renderer for subscription column in DataTable.
 * Usage: { key: 'subscription_id', label: 'Subscription', render: subNameRenderer(subMap) }
 */
export function subNameRenderer(subMap) {
  return (value) => {
    if (!value) return '—';
    const name = resolveSubName(value, subMap);
    return (
      <span title={value} style={{ cursor: 'default' }}>{name}</span>
    );
  };
}

/**
 * Score badge renderer for DataTable cells.
 * Usage: { key: 'final_score', label: 'Score', render: scoreBadgeRenderer }
 */
export function scoreBadgeRenderer(value) {
  if (value == null || value === '') return '—';
  const score = Math.round(Number(value));
  if (isNaN(score)) return String(value);
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 36, padding: '2px 8px', borderRadius: 12,
      background: color + '22', color, border: `1px solid ${color}55`,
      fontWeight: 700, fontSize: 11,
    }}>{score}</span>
  );
}

/**
 * Boolean badge renderer (Yes/No with color).
 */
export function boolBadgeRenderer(trueLabel = 'Yes', falseLabel = 'No') {
  return (value) => {
    const isTrue = value === true || value === 'true' || value === 1;
    const color = isTrue ? '#22c55e' : '#ef4444';
    const label = isTrue ? trueLabel : falseLabel;
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '1px 7px', borderRadius: 10,
        background: color + '22', color, border: `1px solid ${color}44`,
        fontWeight: 600, fontSize: 10,
      }}>{label}</span>
    );
  };
}

/**
 * Severity badge renderer.
 */
export function severityBadgeRenderer(value) {
  if (!value) return '—';
  const COLORS = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e', informational: '#38bdf8' };
  const sev = String(value).toLowerCase();
  const color = COLORS[sev] || '#94a3b8';
  return (
    <span style={{
      display: 'inline-flex', padding: '1px 7px', borderRadius: 10,
      background: color + '20', color, border: `1px solid ${color}44`,
      fontWeight: 700, fontSize: 10, textTransform: 'uppercase',
    }}>{value}</span>
  );
}

/**
 * Cost renderer.
 */
export function costRenderer(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (isNaN(n) || n === 0) return '—';
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
