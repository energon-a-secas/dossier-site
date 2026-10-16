/**
 * A comparison from outside this tab: a record read back from IndexedDB, a
 * bundle from a file, a payload from a link. DOM-free: node imports it.
 *
 * `sanitizeSet` is the one door in. Anything it does not recognise is
 * dropped rather than trusted: columns past the fourth, unknown fields,
 * values outside their lists, sources over the cap, review entries for
 * columns that are not there.
 */

import {
  ROLES, ROLE_WORDS, MODES, SYNC_MODES, LAYOUTS, PANELS, MARKS, MAX_COLUMNS, LIMITS,
  BUNDLE_VERSION, SET_ID, COLUMN_ID, CRITERION_ID, isObj, clampLine, clampText, pickOne,
  defaultView, defaultReview, newSetId, sanitizeSource, repair,
} from './model.js';

function sanitizeView(raw, ids) {
  const base = defaultView();
  if (!isObj(raw)) return base;
  const diff = isObj(raw.diff) ? raw.diff : {};
  return {
    mode: pickOne(raw.mode, ['format', 'original'], base.mode),
    layout: pickOne(raw.layout, LAYOUTS, base.layout),
    focus: ids.includes(raw.focus) ? raw.focus : null,
    sync: pickOne(raw.sync, SYNC_MODES, base.sync),
    diff: {
      on: typeof diff.on === 'boolean' ? diff.on : base.diff.on,
      base: ids.includes(diff.base) ? diff.base : null,
      showRemoved: typeof diff.showRemoved === 'boolean' ? diff.showRemoved : base.diff.showRemoved,
      ignoreCase: diff.ignoreCase === true,
      ignorePunctuation: diff.ignorePunctuation === true,
    },
    panel: pickOne(raw.panel, PANELS, null),
    blind: raw.blind === true,
  };
}

function sanitizeReview(raw, ids) {
  const base = defaultReview();
  if (!isObj(raw)) return base;
  const seen = new Set();
  const criteria = (Array.isArray(raw.criteria) ? raw.criteria : base.criteria)
    .filter((c) => isObj(c) && typeof c.id === 'string' && CRITERION_ID.test(c.id) && !seen.has(c.id) && seen.add(c.id))
    .slice(0, LIMITS.criteria)
    .map((c) => ({ id: c.id, label: clampLine(c.label, LIMITS.criterion) || c.id }));
  const critIds = criteria.map((c) => c.id);
  const marks = {};
  if (isObj(raw.marks)) {
    for (const [crit, byCol] of Object.entries(raw.marks)) {
      if (!critIds.includes(crit) || !isObj(byCol)) continue;
      const row = {};
      for (const [colId, mark] of Object.entries(byCol)) {
        if (ids.includes(colId) && MARKS.includes(mark)) row[colId] = mark;
      }
      marks[crit] = row;
    }
  }
  const notes = {};
  if (isObj(raw.notes)) {
    for (const [colId, note] of Object.entries(raw.notes)) {
      const text = clampText(note, LIMITS.note);
      if (ids.includes(colId) && text) notes[colId] = text;
    }
  }
  return {
    criteria,
    marks,
    notes,
    preferred: raw.preferred === 'none' || ids.includes(raw.preferred) ? raw.preferred : null,
    summary: clampText(raw.summary, LIMITS.summary),
    blindAtVerdict: raw.blindAtVerdict === true,
  };
}

/**
 * A set from anywhere outside this module, or null when it cannot be one.
 * Columns past the fourth, unknown fields and bad values are dropped.
 *
 * @param {object} raw
 * @param {{id?: string}} [opts] `id` replaces the record's own (a bundle has none)
 */
export function sanitizeSet(raw, { id } = {}) {
  if (!isObj(raw)) return null;
  const setId = id || raw.id;
  if (typeof setId !== 'string' || !SET_ID.test(setId)) return null;
  const now = Date.now();

  let seq = Number.isInteger(raw.seq) && raw.seq > 0 ? raw.seq : 0;
  const usedIds = new Set();
  const columns = [];
  for (const rawCol of Array.isArray(raw.columns) ? raw.columns : []) {
    if (!isObj(rawCol) || columns.length >= MAX_COLUMNS) continue;
    let colId = typeof rawCol.id === 'string' && COLUMN_ID.test(rawCol.id) && !usedIds.has(rawCol.id) ? rawCol.id : null;
    if (colId) seq = Math.max(seq, Number(COLUMN_ID.exec(colId)[1]));
    columns.push({ rawCol, colId });
    if (colId) usedIds.add(colId);
  }
  // Columns without a usable id get fresh ones above every id in the record.
  for (const entry of columns) {
    if (entry.colId) continue;
    seq += 1;
    entry.colId = `k${seq}`;
  }
  const ids = columns.map((entry) => entry.colId);
  const cleanColumns = columns.map(({ rawCol, colId }) => {
    const role = pickOne(rawCol.role, ROLES, 'other');
    return {
      id: colId,
      role,
      label: clampLine(rawCol.label, LIMITS.label) || ROLE_WORDS[role],
      author: clampLine(rawCol.author, LIMITS.author),
      fixes: role === 'fix' && ids.includes(rawCol.fixes) && rawCol.fixes !== colId ? rawCol.fixes : null,
      source: sanitizeSource(rawCol.source),
      mode: pickOne(rawCol.mode, MODES, null),
    };
  });

  const set = {
    id: setId,
    title: clampLine(raw.title, LIMITS.title) || 'Untitled comparison',
    created: Number.isFinite(raw.created) ? raw.created : now,
    updated: Number.isFinite(raw.updated) ? raw.updated : now,
    prompt: clampText(raw.prompt, LIMITS.prompt),
    seq,
    columns: cleanColumns,
    view: sanitizeView(raw.view, ids),
    review: sanitizeReview(raw.review, ids),
  };
  return repair(set);
}

// ── Bundles ──────────────────────────────────────────────────────────────────

/** True when a parsed value is a portable comparison bundle. */
export function isBundle(value) {
  return isObj(value) && isObj(value.dossierCompare);
}

/** The portable form: everything but the local id. */
export function toBundle(set) {
  const { id, ...rest } = set;
  return { dossierCompare: { version: BUNDLE_VERSION, ...rest } };
}

/**
 * A set from a bundle, under a new id. Null when the bundle is not one this
 * version reads.
 */
export function fromBundle(value, { id = newSetId() } = {}) {
  if (!isBundle(value)) return null;
  const inner = value.dossierCompare;
  if (inner.version !== BUNDLE_VERSION) return null;
  return sanitizeSet({ ...inner, id }, { id });
}

/** A short description of a set for the switcher: "3 columns: Human, Agent, Fixes". */
export function describeSet(set) {
  const cols = set?.columns || [];
  if (!cols.length) return 'No columns';
  const filled = cols.filter((col) => col.source).length;
  const roles = cols.map((col) => ROLE_WORDS[col.role]).join(', ');
  const count = `${cols.length} column${cols.length === 1 ? '' : 's'}`;
  return filled === cols.length ? `${count}: ${roles}` : `${count}, ${filled} with a report`;
}
