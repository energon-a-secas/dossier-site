/**
 * Two tabs, one comparison: a three-way merge, so neither tab's edit is lost.
 *
 * `base` is the version both edits started from (the last one this tab knew
 * was stored), `mine` is this tab's set and `theirs` the one another tab
 * saved. A field takes mine when mine changed it from the base, and theirs
 * otherwise. Notes, marks, criteria and columns are merged key by key (notes
 * by column, marks by criterion and column), so a note typed in one tab and a
 * mark clicked in the other both stay. The view (focus, layout, panels,
 * Blind) is always this tab's own: it is how this window is being read.
 *
 * Before this, a tab that heard another tab's save while it had a save of
 * its own waiting ignored it, then wrote its whole set over it.
 *
 * DOM-free: node imports it.
 */

import { sanitizeSet } from './records.js';
import { isObj } from './model.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Mine when mine changed it from the base, otherwise theirs. */
function pick(base, mine, theirs) {
  return same(mine, base) ? theirs : mine;
}

/** A keyed map merged key by key; a key that ends up undefined is left out. */
function mergeMap(base = {}, mine = {}, theirs = {}) {
  const out = {};
  const keys = new Set([...Object.keys(mine || {}), ...Object.keys(theirs || {})]);
  for (const key of keys) {
    const value = pick(base?.[key], mine?.[key], theirs?.[key]);
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

const COLUMN_FIELDS = ['role', 'label', 'author', 'fixes', 'source', 'mode'];

/** True when an entry exists on one side only and differs from the base. */
const changedFrom = (entry, baseEntry, fields) => fields.some((f) => !same(entry?.[f], baseEntry?.[f]));

/**
 * Items keyed by `id` (columns, criteria): kept when either side added one,
 * dropped when one side removed it and the other did not change it, and
 * merged field by field when both have it. Mine's order comes first; items
 * only theirs has follow, in their order.
 */
function mergeList(base = [], mine = [], theirs = [], fields) {
  const byId = (list) => new Map((Array.isArray(list) ? list : []).map((item) => [item.id, item]));
  const b = byId(base);
  const m = byId(mine);
  const t = byId(theirs);
  const out = [];
  for (const item of m.values()) {
    const other = t.get(item.id);
    const was = b.get(item.id);
    if (other) {
      const merged = { ...item };
      for (const f of fields) merged[f] = pick(was?.[f], item[f], other[f]);
      out.push(merged);
    } else if (!was || changedFrom(item, was, fields)) {
      // Added here, or removed there after it was changed here: kept.
      out.push(item);
    }
  }
  for (const item of t.values()) {
    if (m.has(item.id)) continue;
    const was = b.get(item.id);
    // Added there, or removed here after it was changed there: kept.
    if (!was || changedFrom(item, was, fields)) out.push(item);
  }
  return out;
}

/**
 * Both tabs added a column under the same id (ids come from a counter, so
 * the next one is the same in both). Theirs moves to a fresh id, and its
 * notes and marks go with it, so the two columns stay two.
 */
function separateNewColumns(base, mine, theirs) {
  const inBase = new Set((base?.columns || []).map((c) => c.id));
  const mineById = new Map((mine.columns || []).map((c) => [c.id, c]));
  const clashes = (theirs.columns || []).filter((c) => !inBase.has(c.id) && mineById.has(c.id)
    && !same(c.source, mineById.get(c.id).source));
  if (!clashes.length) return theirs;
  let seq = Math.max(Number(mine.seq) || 0, Number(theirs.seq) || 0, Number(base?.seq) || 0);
  const moved = new Map();
  for (const col of clashes) {
    seq += 1;
    moved.set(col.id, `k${seq}`);
  }
  const to = (id) => moved.get(id) || id;
  const review = theirs.review || {};
  const marks = {};
  for (const [crit, row] of Object.entries(review.marks || {})) {
    marks[crit] = Object.fromEntries(Object.entries(row || {}).map(([col, mark]) => [to(col), mark]));
  }
  return {
    ...theirs,
    seq,
    columns: theirs.columns.map((c) => ({ ...c, id: to(c.id), fixes: c.fixes ? to(c.fixes) : c.fixes })),
    review: {
      ...review,
      notes: Object.fromEntries(Object.entries(review.notes || {}).map(([col, note]) => [to(col), note])),
      marks,
      preferred: review.preferred ? to(review.preferred) : review.preferred,
    },
  };
}

function mergeReview(base = {}, mine = {}, theirs = {}) {
  const out = {};
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
  for (const key of keys) {
    if (key === 'notes') out.notes = mergeMap(base.notes, mine.notes, theirs.notes);
    else if (key === 'marks') {
      out.marks = {};
      const crits = new Set([...Object.keys(mine.marks || {}), ...Object.keys(theirs.marks || {})]);
      for (const crit of crits) out.marks[crit] = mergeMap(base.marks?.[crit], mine.marks?.[crit], theirs.marks?.[crit]);
    } else if (key === 'criteria') out.criteria = mergeList(base.criteria, mine.criteria, theirs.criteria, ['label']);
    else out[key] = pick(base[key], mine[key], theirs[key]);
  }
  return out;
}

/**
 * @param {object|null} base the version both started from, or null (all of
 *   mine counts as changed then, and theirs fills in the rest)
 * @param {object} mine this tab's set
 * @param {object} theirs the set another tab saved
 * @returns {object|null} the merged set, cleaned (`sanitizeSet`), with
 *   theirs' revision, so the next save expects it
 */
export function mergeSets(base, mine, theirs) {
  if (!isObj(theirs)) return mine || null;
  if (!isObj(mine)) return theirs;
  const b = isObj(base) ? base : {};
  const other = separateNewColumns(b, mine, theirs);
  const merged = {
    ...other,
    id: mine.id,
    title: pick(b.title, mine.title, other.title),
    prompt: pick(b.prompt, mine.prompt, other.prompt),
    created: Math.min(Number(mine.created) || Infinity, Number(other.created) || Infinity),
    updated: other.updated,
    seq: Math.max(Number(mine.seq) || 0, Number(other.seq) || 0),
    columns: mergeList(b.columns, mine.columns, other.columns, COLUMN_FIELDS),
    view: mine.view,
    review: mergeReview(b.review, mine.review || {}, other.review || {}),
  };
  if (!Number.isFinite(merged.created)) delete merged.created;
  return sanitizeSet(merged);
}
