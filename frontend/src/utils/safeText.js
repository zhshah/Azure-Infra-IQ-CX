/**
 * safeText — coerce any value into a render-safe string.
 *
 * The backend/AI sometimes returns a finding's recommendation/remediation/description as a
 * STRUCTURED OBJECT (e.g. {id, action, notes}) instead of a plain string. Rendering a raw
 * object as a React child throws "Objects are not valid as a React child" (React error #31),
 * which crashed module views (seen first under Backup & DR). Always pass free-text fields that
 * could come from the model through asText() before rendering.
 */
export function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('; ');
  if (typeof v === 'object') {
    const main = v.action || v.text || v.recommendation || v.description || v.detail || v.title || v.message || '';
    const extra = v.notes && v.notes !== main ? ` (${v.notes})` : '';
    if (main) return `${main}${extra}`;
    const strs = Object.values(v).filter((x) => typeof x === 'string');
    return strs.length ? strs.join(' \u2014 ') : JSON.stringify(v);
  }
  return String(v);
}

export default asText;
