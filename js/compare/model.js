/**
 * A comparison set: its shape, its defaults and every change to it, as pure
 * functions. DOM-free: node imports it.
 *
 * Every function returns a new set and leaves the one it was given alone, so
 * an undo is keeping the previous object, and the view can compare objects to
 * know what changed. `sanitizeSet` is the one door in: a record read back from
 * IndexedDB, a bundle from a file and a link payload all pass through it, and
 * anything it does not recognise is dropped rather than trusted.
 *
 * A column whose `source` is null is an empty slot: the view shows the drop
 * zone there. Reading a set from outside (a stored record, a bundle) is
 * js/compare/records.js.
 */

import { HTML_MAX_CHARS } from '../embed-policy.js';

export const ROLES = Object.freeze(['human', 'agent', 'fix', 'other']);
export const ROLE_WORDS = Object.freeze({ human: 'Human', agent: 'Agent', fix: 'Fixes', other: 'Other' });
export const KINDS = Object.freeze(['html', 'markdown', 'text', 'dossier']);
export const KIND_WORDS = Object.freeze({ html: 'HTML', markdown: 'Markdown', text: 'Text', dossier: 'Dossier' });
export const MODES = Object.freeze(['format', 'original', 'interactive']);
export const MODE_WORDS = Object.freeze({ format: 'Dossier format', original: 'Original', interactive: 'Interactive' });
export const SYNC_MODES = Object.freeze(['sections', 'scroll', 'off']);
export const LAYOUTS = Object.freeze(['columns', 'focus']);
export const PANELS = Object.freeze(['sections', 'review']);
export const MARKS = Object.freeze(['strong', 'adequate', 'weak', 'na']);
export const LETTERS = Object.freeze(['A', 'B', 'C', 'D']);
export const MAX_COLUMNS = 4;
/** One cap for every source, the same number the HTML import uses. */
export const MAX_SOURCE_CHARS = HTML_MAX_CHARS;
export const LIMITS = Object.freeze({
  title: 120, label: 40, author: 80, name: 200, prompt: 4000,
  note: 4000, summary: 8000, criterion: 60, criteria: 12,
});
export const BUNDLE_VERSION = 1;

const DEFAULT_CRITERIA = Object.freeze([
  ['accuracy', 'Accuracy'],
  ['completeness', 'Completeness'],
  ['clarity', 'Clarity'],
  ['evidence', 'Evidence'],
  ['actionability', 'Actionability'],
]);

export const SET_ID = /^c-[a-z0-9-]{1,40}$/i;
export const COLUMN_ID = /^k(\d{1,6})$/;
export const CRITERION_ID = /^[a-z0-9-]{1,40}$/;

// ── Small helpers ────────────────────────────────────────────────────────────

export const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** One line of text, trimmed and cut to `max` characters. */
export function clampLine(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Free text (newlines kept), cut to `max` characters. */
export function clampText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}

export function pickOne(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/** A short random id. Not secret, only unique enough within one browser. */
export function newSetId(random = Math.random) {
  let out = '';
  while (out.length < 10) out += random().toString(36).slice(2);
  return `c-${out.slice(0, 10)}`;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export function defaultView() {
  return {
    mode: 'format',
    layout: 'columns',
    focus: null,
    sync: 'sections',
    diff: { on: true, base: null, showRemoved: true, ignoreCase: false, ignorePunctuation: false },
    panel: null,
    blind: false,
  };
}

export function defaultReview() {
  return {
    criteria: DEFAULT_CRITERIA.map(([id, label]) => ({ id, label })),
    marks: {},
    notes: {},
    preferred: null,
    summary: '',
    blindAtVerdict: false,
  };
}

/**
 * An empty set. `id` and `now` are parameters so a test can pin them.
 *
 * @param {{id?: string, now?: number, title?: string}} [opts]
 */
export function newSet({ id, now = Date.now(), title } = {}) {
  return {
    id: id && SET_ID.test(id) ? id : newSetId(),
    title: clampLine(title, LIMITS.title) || 'Untitled comparison',
    created: now,
    updated: now,
    prompt: '',
    seq: 0,
    columns: [],
    view: defaultView(),
    review: defaultReview(),
  };
}

/** The set a visitor starts from: two empty columns, A Human and B Agent. */
export function blankSet(opts = {}) {
  let set = newSet(opts);
  set = addColumn(set, { role: 'human' }).set;
  set = addColumn(set, { role: 'agent' }).set;
  return set;
}

// ── Reading a set ────────────────────────────────────────────────────────────

export function columnById(set, id) {
  return (set?.columns || []).find((col) => col.id === id) || null;
}

export function indexOfColumn(set, id) {
  return (set?.columns || []).findIndex((col) => col.id === id);
}

/** A column's letter, A to D, from its position. */
export function letterOf(set, id) {
  const i = indexOfColumn(set, id);
  return i >= 0 ? LETTERS[i] || '?' : '?';
}

export function filledColumns(set) {
  return (set?.columns || []).filter((col) => col.source);
}

/** The label a new column of this role gets: "Agent", then "Agent 2". */
export function defaultLabel(set, role) {
  const word = ROLE_WORDS[role] || ROLE_WORDS.other;
  const taken = new Set((set?.columns || []).map((col) => col.label));
  if (!taken.has(word)) return word;
  for (let n = 2; n < 10; n += 1) {
    if (!taken.has(`${word} ${n}`)) return `${word} ${n}`;
  }
  return word;
}

/**
 * The column differences are measured against when the reader has not chosen
 * one: what a Fixes column corrects, so the view shows the fix; otherwise the
 * first column with a report in it.
 */
export function defaultBase(set) {
  const cols = set?.columns || [];
  const fix = cols.find((col) => col.role === 'fix' && col.source && col.fixes && columnById(set, col.fixes)?.source);
  if (fix) return fix.fixes;
  return (cols.find((col) => col.source) || cols[0] || {}).id || null;
}

/** The column a new Fixes column corrects: the last column that is not a fix. */
function fixTargetFor(set) {
  const others = (set.columns || []).filter((col) => col.role !== 'fix');
  return others.length ? others[others.length - 1].id : null;
}

// ── Changing a set ───────────────────────────────────────────────────────────

function withColumns(set, columns, extra = {}) {
  const next = { ...set, ...extra, columns };
  return repair(next);
}

/**
 * Add a column. With four already there it refuses: `id` is null and the set
 * comes back unchanged.
 *
 * @returns {{set: object, id: string|null}}
 */
export function addColumn(set, { role = 'other', label, author, source = null, fixes, mode = null, at } = {}) {
  if ((set.columns || []).length >= MAX_COLUMNS) return { set, id: null };
  const seq = (set.seq || 0) + 1;
  const id = `k${seq}`;
  const cleanRole = pickOne(role, ROLES, 'other');
  const column = {
    id,
    role: cleanRole,
    label: clampLine(label, LIMITS.label) || defaultLabel(set, cleanRole),
    author: clampLine(author, LIMITS.author),
    fixes: cleanRole === 'fix' ? (fixes && columnById(set, fixes) ? fixes : fixTargetFor(set)) : null,
    source: sanitizeSource(source),
    mode: pickOne(mode, MODES, null),
  };
  const columns = [...set.columns];
  const index = Number.isInteger(at) ? Math.max(0, Math.min(columns.length, at)) : columns.length;
  columns.splice(index, 0, column);
  return { set: withColumns(set, columns, { seq }), id };
}

/** Change a column's fields. Unknown fields are ignored; values are cleaned. */
export function updateColumn(set, id, patch = {}) {
  const at = indexOfColumn(set, id);
  if (at < 0) return set;
  const col = { ...set.columns[at] };
  if (own(patch, 'role')) {
    col.role = pickOne(patch.role, ROLES, col.role);
    if (col.role !== 'fix') col.fixes = null;
    else if (!col.fixes) col.fixes = fixTargetFor({ columns: set.columns.filter((c) => c.id !== id) });
  }
  if (own(patch, 'label')) col.label = clampLine(patch.label, LIMITS.label) || defaultLabel(set, col.role);
  if (own(patch, 'author')) col.author = clampLine(patch.author, LIMITS.author);
  if (own(patch, 'fixes') && col.role === 'fix') {
    col.fixes = patch.fixes && patch.fixes !== id && columnById(set, patch.fixes) ? patch.fixes : null;
  }
  if (own(patch, 'source')) col.source = sanitizeSource(patch.source);
  if (own(patch, 'mode')) col.mode = pickOne(patch.mode, MODES, null);
  const columns = [...set.columns];
  columns[at] = col;
  return withColumns(set, columns);
}

export function removeColumn(set, id) {
  if (indexOfColumn(set, id) < 0) return set;
  const columns = set.columns.filter((col) => col.id !== id)
    .map((col) => (col.fixes === id ? { ...col, fixes: null } : col));
  return withColumns(set, columns);
}

/** Move a column by `delta` places (-1 left, 1 right), within the row. */
export function moveColumn(set, id, delta) {
  const from = indexOfColumn(set, id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= set.columns.length) return set;
  const columns = [...set.columns];
  const [col] = columns.splice(from, 1);
  columns.splice(to, 0, col);
  return withColumns(set, columns);
}

/** A copy of a column, placed after it. Refuses at four columns. */
export function duplicateColumn(set, id) {
  const col = columnById(set, id);
  if (!col) return { set, id: null };
  return addColumn(set, {
    role: col.role,
    label: clampLine(`${col.label} copy`, LIMITS.label),
    author: col.author,
    fixes: col.fixes,
    source: col.source,
    mode: col.mode,
    at: indexOfColumn(set, id) + 1,
  });
}

export function setTitle(set, title) {
  return { ...set, title: clampLine(title, LIMITS.title) || 'Untitled comparison' };
}

/** Merge view fields. Each is checked again by `repair`. */
export function setView(set, patch = {}) {
  const view = { ...set.view, ...patch };
  if (patch.diff) view.diff = { ...set.view.diff, ...patch.diff };
  return repair({ ...set, view });
}

function sameSource(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.name === b.name && a.text === b.text && (a.note || '') === (b.note || '');
}

/**
 * True when two versions of a set hold the same things and differ at most in
 * how they are shown: the view (focus, layout, sync, render mode, the
 * difference options, the open panel) and each column's own render mode.
 * The title, the prompt, the columns (their order, role, label, author, fix
 * target and report) and the review are what a set holds.
 *
 * @param {object|null} a
 * @param {object|null} b
 */
export function sameContent(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.id !== b.id || a.title !== b.title || (a.prompt || '') !== (b.prompt || '')) return false;
  const ac = a.columns || [];
  const bc = b.columns || [];
  if (ac.length !== bc.length) return false;
  for (let i = 0; i < ac.length; i += 1) {
    const x = ac[i];
    const y = bc[i];
    if (x.id !== y.id || x.role !== y.role || x.label !== y.label || x.author !== y.author
      || (x.fixes || null) !== (y.fixes || null) || !sameSource(x.source, y.source)) return false;
  }
  return a.review === b.review || JSON.stringify(a.review || null) === JSON.stringify(b.review || null);
}

/**
 * Keep the references inside a set pointing at columns that exist: the focus,
 * the difference base, each fix target and the review's per-column entries.
 */
export function repair(set) {
  const ids = new Set(set.columns.map((col) => col.id));
  const view = { ...set.view, diff: { ...set.view.diff } };
  if (!ids.has(view.focus)) view.focus = set.columns[0]?.id || null;
  if (!ids.has(view.diff.base)) view.diff.base = null;
  const columns = set.columns.map((col) => {
    if (col.role !== 'fix') return col.fixes === null ? col : { ...col, fixes: null };
    if (col.fixes && (!ids.has(col.fixes) || col.fixes === col.id)) return { ...col, fixes: null };
    return col;
  });
  const review = { ...set.review };
  review.marks = Object.fromEntries(Object.entries(review.marks || {}).map(([crit, byCol]) => [
    crit, Object.fromEntries(Object.entries(byCol || {}).filter(([colId]) => ids.has(colId))),
  ]));
  review.notes = Object.fromEntries(Object.entries(review.notes || {}).filter(([colId]) => ids.has(colId)));
  if (review.preferred && review.preferred !== 'none' && !ids.has(review.preferred)) review.preferred = null;
  return { ...set, columns, view, review };
}

// ── Sanitising ───────────────────────────────────────────────────────────────

/** A source, or null when it is missing, malformed or over the cap. */
export function sanitizeSource(source) {
  if (!isObj(source)) return null;
  if (!KINDS.includes(source.kind) || typeof source.text !== 'string') return null;
  if (!source.text.trim() || source.text.length > MAX_SOURCE_CHARS) return null;
  const out = { kind: source.kind, name: clampLine(source.name, LIMITS.name) || 'Pasted text', text: source.text };
  const note = clampLine(source.note, LIMITS.name);
  if (note) out.note = note;
  return out;
}
