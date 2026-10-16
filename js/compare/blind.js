/**
 * Blind review: who wrote each report stays hidden until Reveal.
 * DOM-free: node imports it.
 *
 * With Blind on, every column is "Report N", numbered in an order shuffled
 * deterministically from the set's id, so the same comparison always deals
 * the same numbers and nobody can work the order back from the setup (the
 * human draft is usually put in column A). The view lays the columns out in
 * report order, and every list keyed by column follows it.
 *
 * Once a review is started under Blind (a mark, the preferred report, a note
 * or the summary), the deal is stored with it (`review.blindOrder`, set by
 * js/compare/review-model.js). A bundle or a link opens under a new set id,
 * which would shuffle again, so the stored deal wins while it still covers
 * exactly the set's columns: "Report 1" in a note is the same report for
 * whoever opens the comparison. Adding or removing a column deals again.
 *
 * Every place that names a column asks `nameOf` instead of reading the
 * letter and label itself, so turning Blind on renames all of them at once.
 */

import { LETTERS, ROLE_WORDS, indexOfColumn } from './model.js';
import { fnv1a } from '../hash.js';

/** mulberry32: a small seeded generator, enough for a shuffle of four. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new WeakMap();

/**
 * The stored deal, when it numbers exactly these columns 1 to n.
 *
 * @param {object|null} order column id to report number
 * @param {string[]} ids
 * @returns {Map<string, number>|null}
 */
function storedDeal(order, ids) {
  if (!order || typeof order !== 'object') return null;
  const keys = Object.keys(order);
  if (keys.length !== ids.length || !ids.every((id) => keys.includes(id))) return null;
  const numbers = ids.map((id) => order[id]);
  const want = ids.map((_, i) => i + 1);
  if ([...numbers].sort((a, b) => a - b).join(',') !== want.join(',')) return null;
  return new Map(ids.map((id) => [id, order[id]]));
}

/**
 * Each column's report number, 1 to 4: the deal the review was entered
 * under when it covers these columns, else a shuffle seeded by the set id
 * and the column ids, so adding a column deals again.
 *
 * @param {object} set
 * @returns {Map<string, number>}
 */
export function reportNumbers(set) {
  const cols = set?.columns || [];
  const order = set?.review?.blindOrder || null;
  // The shuffle is seeded by the set and its columns only; the stored deal
  // is part of the cache key, so a change to it is seen.
  const seed = `${set?.id || ''}|${cols.map((c) => c.id).join(',')}`;
  const key = `${seed}|${order ? JSON.stringify(order) : ''}`;
  const hit = cache.get(cols);
  if (hit && hit.key === key) return hit.numbers;
  const ids = cols.map((col) => col.id);
  const stored = storedDeal(order, ids);
  if (stored) {
    cache.set(cols, { key, numbers: stored });
    return stored;
  }
  // The shuffle's seed: a 32-bit FNV-1a hash of the set and its columns.
  const next = random(fnv1a(seed));
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const numbers = new Map(ids.map((id, i) => [id, i + 1]));
  cache.set(cols, { key, numbers });
  return numbers;
}

function isBlind(set) {
  return Boolean(set?.view?.blind);
}

/**
 * How a column is named everywhere in the view.
 *
 *   mark   what its badge shows: "B", or "3" while blind
 *   label  its name: "Agent output", or "Report 3"
 *   ref    how other places refer to it: "B", or "Report 3"
 *   role   its role word, or "" while blind
 *
 * @param {object} set
 * @param {object|string} col a column or its id
 */
export function nameOf(set, col) {
  const column = typeof col === 'string' ? (set?.columns || []).find((c) => c.id === col) : col;
  if (!column) return { mark: '?', label: '', ref: '?', role: '', blind: false };
  if (isBlind(set)) {
    const n = reportNumbers(set).get(column.id) || 0;
    return { mark: String(n), label: `Report ${n}`, ref: `Report ${n}`, role: '', blind: true };
  }
  const letter = LETTERS[indexOfColumn(set, column.id)] || '?';
  return { mark: letter, label: column.label, ref: letter, role: ROLE_WORDS[column.role] || '', blind: false };
}

/**
 * The role a column carries in the markup, for its colours: its own, or
 * "other" while blind. The colours turn neutral under Blind anyway; the
 * real role stays out of the markup too, where anyone looking at the page
 * source could read which report the agent wrote.
 *
 * @param {object} set
 * @param {object} col
 */
export function roleAttr(set, col) {
  return isBlind(set) ? 'other' : col?.role || 'other';
}

/**
 * The columns in the order the view lays them out: the set's order, or
 * report order while blind.
 */
export function displayColumns(set) {
  const cols = [...(set?.columns || [])];
  if (!isBlind(set)) return cols;
  const numbers = reportNumbers(set);
  return cols.sort((a, b) => (numbers.get(a.id) || 0) - (numbers.get(b.id) || 0));
}
