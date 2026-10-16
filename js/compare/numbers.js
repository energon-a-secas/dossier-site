/**
 * The numbers that changed between a column and its reference: in a human
 * against agent comparison, a wrong figure is usually the finding that
 * matters, and it hid among every other difference. DOM-free: node imports
 * it.
 *
 * Read from the word marks of changed units (js/compare/diff.js): a group
 * is a run of removed and inserted segments (a space between them does not
 * end it), and it is a changed number when each side holds one to three
 * number tokens and they differ: "1,105" became "1,150", "$19.8M" became
 * "$21.4M". A rewrite that happens to hold a number on one side only, or a
 * dozen, is not listed. Numbers in passages added or removed whole are not
 * listed either: nothing lines them up with anything.
 *
 * This lists differences. It never weighs or scores them.
 */

import { tokenize } from './diff-tokens.js';
import { inlineText } from './ir.js';

const NUMBER = /^[$€£¥]?\p{N}/u;
const MAX_PER_SIDE = 3;

/** A word token that is a number as a report states it: "1,105", "$19.8M", "6.2%". */
export function isNumberToken(text) {
  return NUMBER.test(text);
}

const numbersIn = (text) => tokenize(text).filter((tok) => tok.kind === 'w' && isNumberToken(tok.text)).map((tok) => tok.text);
const squash = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Groups of non-equal segments in one unit's (or one cell's) segment list. */
function groups(segments) {
  const out = [];
  let cur = null;
  segments.forEach((seg, i) => {
    if (seg.type === 'ins' || seg.type === 'del') {
      if (!cur) {
        cur = { segs: new Set(), was: '', now: '' };
        out.push(cur);
      }
      cur.segs.add(i);
      if (seg.type === 'del') cur.was += `${inlineText(seg.inl)} `;
      else cur.now += `${inlineText(seg.inl)} `;
    } else if (cur && /^\s*$/.test(inlineText(seg.inl))) {
      // A space between two marks belongs to the group: "1,105" "1,150".
      cur.segs.add(i);
    } else {
      cur = null;
    }
  });
  return out;
}

const memo = new WeakMap();

/**
 * The changed numbers of a diff result, in the column's order.
 *
 * @param {object} result js/compare/diff.js `diffBlocks`
 * @returns {Array<{n: number, unit: number, cell: number|null, kind: string,
 *   wasText: string, nowText: string, context: string, segs: Set<number>}>}
 *   `n` is the change's number in the column, as the marks number it
 */
export function numberChanges(result) {
  if (!result || result.failed) return [];
  if (memo.has(result)) return memo.get(result);
  const list = [];
  result.changes.forEach((change, index) => {
    if (change.kind !== 'chg' && change.kind !== 'mov') return;
    const slot = result.units[change.unit];
    const unit = result.colUnits[change.unit];
    if (!slot || slot.state !== 'changed' || !unit) return;
    const lists = slot.cells
      ? slot.cells.map((segs, cell) => ({ segs, cell })).filter((x) => x.segs)
      : slot.words ? [{ segs: slot.words, cell: null }] : [];
    for (const { segs, cell } of lists) {
      for (const g of groups(segs)) {
        const was = numbersIn(g.was);
        const now = numbersIn(g.now);
        if (!was.length || !now.length || was.length > MAX_PER_SIDE || now.length > MAX_PER_SIDE) continue;
        if (was.join('|') === now.join('|')) continue;
        list.push({
          n: index + 1,
          unit: change.unit,
          cell,
          kind: unit.kind,
          wasText: cut(squash(g.was), 48),
          nowText: cut(squash(g.now), 48),
          context: cut(squash(unit.text), 60),
          segs: g.segs,
        });
      }
    }
  });
  memo.set(result, list);
  return list;
}

const marksMemo = new WeakMap();

/**
 * Which segments of which units to keep marked when a column shows margin
 * bars only: the segments of its changed numbers.
 *
 * @param {object} result
 * @returns {Map<number, {words?: Set<number>, cells?: Map<number, Set<number>>}>}
 */
export function numberMarks(result) {
  if (!result) return new Map();
  if (marksMemo.has(result)) return marksMemo.get(result);
  const out = new Map();
  for (const change of numberChanges(result)) {
    const entry = out.get(change.unit) || {};
    if (change.cell === null) {
      entry.words ||= new Set();
      for (const i of change.segs) entry.words.add(i);
    } else {
      entry.cells ||= new Map();
      if (!entry.cells.has(change.cell)) entry.cells.set(change.cell, new Set());
      for (const i of change.segs) entry.cells.get(change.cell).add(i);
    }
    out.set(change.unit, entry);
  }
  marksMemo.set(result, out);
  return out;
}
