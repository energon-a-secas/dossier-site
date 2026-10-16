/**
 * Values from a document that end up inside markup the renderer writes.
 *
 * Escaping a value makes it text. It does not make it a value the stylesheet
 * knows, and a class suffix such as `risk-severity--${item.severity}` was
 * written raw: `high" onmouseover="alert(1)` became a live attribute. The page
 * CSP blocked the handler in the app, and the one-file export has no CSP, so a
 * hostile shared document turned into script in a downloaded file.
 *
 * So anything built from an enum field is checked against the registry's own
 * list and falls back to a known value. The lists are read from the registry
 * rather than repeated here, so a value added to the format is accepted by the
 * renderer the same day.
 *
 * DOM-free. Node imports this.
 */

import { blockDef, ENVELOPE, TONES, WIDTHS, CHECKED_BY } from '../registry/index.js';

export { TONES, WIDTHS, CHECKED_BY };

/** The value when it is one of `values`, otherwise the fallback. */
export function pick(value, values, fallback) {
  return Array.isArray(values) && values.includes(value) ? value : fallback;
}

/**
 * The enum a registry field declares, walking through list items:
 * `enumValues('risks', 'items', 'severity')` is the severity of a risk item.
 * An unknown path is an empty list, so `pick` falls back rather than throwing.
 */
export function enumValues(type, ...names) {
  let fields = type === '$envelope' ? ENVELOPE : blockDef(type)?.fields;
  let def = null;
  for (const name of names) {
    def = fields?.[name];
    if (!def) return [];
    if (def.type === 'array' && def.of && typeof def.of === 'object') def = def.of;
    fields = def.fields;
  }
  return Array.isArray(def?.values) ? def.values : [];
}

/**
 * A whole number for an attribute or a count, or the fallback.
 *
 * `Number(null)` and `Number('')` are both 0, and the validator treats null
 * and the empty string as an absent field, so a finding with `line: null`
 * validated clean and then rendered as `a.js:0`. Absent means the fallback.
 */
export function int(value, fallback = 0) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
