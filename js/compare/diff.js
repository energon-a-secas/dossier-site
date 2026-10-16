/**
 * What changed between two reports, unit by unit and word by word.
 * DOM-free: node imports it.
 *
 * Both reports are IR (js/compare/ir.js). The diff runs in four steps:
 *
 *   1. Units (headings, paragraphs, list items, table rows, code blocks, in
 *      the order js/compare/ir-render.js numbers them) are aligned with
 *      Myers' O(ND) diff on a normalised key per unit.
 *   2. Inside each stretch of removed and added units, a removed unit and an
 *      added one of the same kind that share at least 40% of their words
 *      (Dice) are paired, in order, as one "changed" unit.
 *   3. Each changed pair is diffed word by word, again with Myers, on tokens
 *      (words, punctuation; whitespace is never compared). A small equality
 *      caught between two edits is folded into them, so "changed the cache
 *      TTL" reads as one replacement rather than four. A code block, and a
 *      paragraph of many lines (a log), is diffed line by line first
 *      (js/compare/diff-lines.js).
 *   4. A run of removed units and a run of added ones that are the same part
 *      of the report, moved, are shown once as a move and diffed against
 *      where they came from (js/compare/diff-moves.js).
 *
 * Every Myers run has an edit cap, and the whole column one work budget
 * counted in steps, not milliseconds, so two very different reports cost a
 * bounded amount and the same reports always get the same marks. A changed
 * unit whose words cannot be marked within the cap says so (`unmarked`).
 * A column whose words are mostly changed, added or removed is too different
 * to mark word by word (`tooDifferent`): the share of words, not of units, so
 * one word fixed in most paragraphs is a light edit, not a rewrite.
 *
 * Results are memoised by the IR arrays (the column renderer keeps one per
 * source) and by a hash of the content (js/compare/diff-memo.js), so a
 * redraw that changed nothing in either report does not diff again.
 */

import { visitUnits } from './ir.js';
import { tokenize } from './diff-tokens.js';
import {
  myers, intern, wordDiff, WORD_MAX_D, WORD_MAX_D_FORCED,
} from './diff-words.js';
import { codeDiff, textLinesDiff, manyLines } from './diff-lines.js';
import { findMoves } from './diff-moves.js';
import { recall, remember } from './diff-memo.js';

export { tokenize, inlineTokens, tokensToInline } from './diff-tokens.js';
export { myers, wordDiff } from './diff-words.js';

/** A removed and an added unit with at least this much in common are one changed unit. */
const PAIR_MIN = 0.4;
/**
 * Above this share of a column's words changed, added or removed (against
 * its own words and the base words it lost), it is too different to mark
 * word by word. Measured on the bundled example: the Fixes column against
 * the Agent one, which corrects figures, rewrites its intro and adds a few
 * items, is at 0.69 and reads best word by word; the Human draft against
 * the Agent output, written apart, is at 0.97. A light copy edit is near 0.
 */
const TOO_DIFFERENT_WORDS = 0.75;
/**
 * The share of units, kept only as a cost guard: when most changed units
 * could not be marked within the cap or the budget, their words are not
 * known, and the units that differ decide instead.
 */
const TOO_DIFFERENT = 0.5;
const UNIT_MAX_D = 1500;
/** Work one column may take, in Myers steps (js/compare/diff-words.js `myers`). */
const COLUMN_WORK_MAX = 8e6;
/** Word marks turned on by hand get this many times the work. */
const FORCED_WORK = 10;
/** A pairing matrix larger than this pairs in order instead. */
const PAIR_MATRIX_MAX = 20000;

// ── Units ────────────────────────────────────────────────────────────────────

const GROUP = { h: 'h', tr: 'tr', pre: 'pre' };

/** Units of a block list, in render order, with what the diff needs of each. */
function unitsOf(blocks) {
  const units = [];
  visitUnits(blocks, (u) => {
    const node = u.node;
    let inl = null;
    let cells = null;
    if (u.kind === 'tr') cells = Array.isArray(node) ? node.map((cell) => cell?.inl || []) : [];
    else if (u.kind !== 'pre') inl = node && node.t === 'details' ? node.summary : node?.inl;
    units.push({
      kind: u.kind,
      group: GROUP[u.kind] || 'x',
      text: String(u.text || ''),
      inl: inl || null,
      cells,
    });
  });
  return units;
}

function normText(text, opts) {
  let t = String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (opts.ignoreCase) t = t.toLowerCase();
  if (opts.ignorePunctuation) t = t.replace(/[^\p{L}\p{N}\s]+/gu, '').replace(/\s+/g, ' ').trim();
  return t;
}

function wordBag(unit) {
  if (!unit.bag) {
    unit.bag = new Map();
    for (const tok of tokenize(unit.text)) {
      if (tok.kind !== 'w') continue;
      const k = tok.text.toLowerCase();
      unit.bag.set(k, (unit.bag.get(k) || 0) + 1);
    }
  }
  return unit.bag;
}

/** How many words a unit holds. */
function wordCount(unit) {
  if (unit.wordTotal === undefined) {
    let n = 0;
    for (const c of wordBag(unit).values()) n += c;
    unit.wordTotal = n;
  }
  return unit.wordTotal;
}

/** Dice similarity of two units' words, 0 to 1. */
function unitSimilarity(x, y) {
  if (x.group !== y.group) return 0;
  const a = wordBag(x);
  const b = wordBag(y);
  const total = wordCount(x) + wordCount(y);
  let both = 0;
  if (!total) return x.text.trim() === y.text.trim() ? 1 : 0;
  for (const [w, c] of a) both += Math.min(c, b.get(w) || 0);
  return (2 * both) / total;
}

/**
 * Pair removed and added units in order, keeping the pairs whose summed
 * similarity is greatest (each at least PAIR_MIN).
 *
 * @returns {Array<[number, number]>} [index into dels, index into inss]
 */
function pairUnits(dels, inss, baseUnits, colUnits) {
  const n = dels.length;
  const m = inss.length;
  if (!n || !m) return [];
  const sim = (i, j) => {
    const s = unitSimilarity(baseUnits[dels[i]], colUnits[inss[j]]);
    return s >= PAIR_MIN ? s : 0;
  };
  if (n * m > PAIR_MATRIX_MAX) {
    const pairs = [];
    for (let i = 0; i < Math.min(n, m); i += 1) if (sim(i, i)) pairs.push([i, i]);
    return pairs;
  }
  const w = m + 1;
  const dp = new Float64Array((n + 1) * w);
  const s = new Float64Array(n * m);
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const here = sim(i - 1, j - 1);
      s[(i - 1) * m + (j - 1)] = here;
      const diag = here > 0 ? dp[(i - 1) * w + (j - 1)] + here : -1;
      dp[i * w + j] = Math.max(diag, dp[(i - 1) * w + j], dp[i * w + (j - 1)]);
    }
  }
  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const here = s[(i - 1) * m + (j - 1)];
    if (here > 0 && Math.abs(dp[i * w + j] - (dp[(i - 1) * w + (j - 1)] + here)) < 1e-9) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[(i - 1) * w + j] >= dp[i * w + (j - 1)]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return pairs.reverse();
}

/** Word marks for a changed table row: cell by cell when both have as many cells. */
function rowDiff(baseUnit, unit, opts, budget, limits) {
  if (!baseUnit.cells || !unit.cells || baseUnit.cells.length !== unit.cells.length) return { reason: 'cap' };
  const cells = [];
  let edits = 0;
  let kept = 0;
  let total = 0;
  for (let c = 0; c < unit.cells.length; c += 1) {
    const words = wordDiff(baseUnit.cells[c], unit.cells[c], opts, budget, limits);
    if (!words.segments) return { reason: words.reason };
    cells.push(words.edits ? words.segments : null);
    edits += words.edits;
    kept += words.kept;
    total += words.total;
  }
  return { cells, edits, kept, total };
}

/**
 * Compare a column's IR against the base column's.
 *
 * @param {Array} baseBlocks
 * @param {Array} blocks
 * @param {{ignoreCase?: boolean, ignorePunctuation?: boolean, force?: boolean}} [opts]
 *   `force`: Word marks turned on by hand: higher caps, ten times the work
 * @returns {{
 *   units: Array<{state: 'same'|'changed'|'added', base: number|null,
 *     words: Array|null, cells: Array|null, move?: number,
 *     unmarked?: 'cap'|'budget'|'code'|null, changedTokens?: number, tokens?: number}>,
 *   removed: Array<{at: number, units: number[]}>,
 *   moves: Array<{units: number[], base: number[], after: string|null, section: boolean}>,
 *   changes: Array<{kind: 'chg'|'add'|'del'|'mov', unit?: number, removed?: number, move?: number}>,
 *   counts: {changed: number, added: number, removed: number, moved: number, total: number},
 *   tooDifferent: boolean, failed: 'budget'|'different'|false, unmarked: number,
 *   stoppedAt: number, wordShare: number, baseUnits: Array, colUnits: Array}}
 *   `removed[].at` is the column unit the removed run stands before (the
 *   number of units when it stands at the end). `unmarked` counts the
 *   changed units left without word marks, and `stoppedAt` is the first one
 *   the budget cut (or -1).
 */
export function diffBlocks(baseBlocks, blocks, opts = {}) {
  const options = {
    ignoreCase: Boolean(opts.ignoreCase), ignorePunctuation: Boolean(opts.ignorePunctuation), force: Boolean(opts.force),
  };
  const memo = recall(baseBlocks, blocks, options);
  if (memo) return memo;
  const result = compute(baseBlocks, blocks, options);
  remember(baseBlocks, blocks, options, result);
  return result;
}

function compute(baseBlocks, blocks, opts) {
  const baseUnits = unitsOf(baseBlocks);
  const colUnits = unitsOf(blocks);
  const ctx = {
    baseUnits,
    colUnits,
    opts,
    units: colUnits.map(() => ({ state: 'same', base: null, words: null, cells: null })),
    removed: [],
    budget: { left: COLUMN_WORK_MAX * (opts.force ? FORCED_WORK : 1) },
    wordMaxD: opts.force ? WORD_MAX_D_FORCED : WORD_MAX_D,
  };
  const every = (n) => Array.from({ length: n }, (_, i) => i);
  const aligned = alignRange(ctx, every(baseUnits.length), every(colUnits.length), colUnits.length, UNIT_MAX_D);
  if (aligned !== true) return finish({ ...ctx, moves: [], failed: aligned });
  const moves = findMoves(ctx, alignRange, wordBag);
  return finish({ ...ctx, moves, failed: false });
}

const keyOf = (unit, opts) => {
  if (unit.key === undefined) unit.key = `${unit.group}\u0001${normText(unit.text, opts)}`;
  return unit.key;
};

/**
 * Align base units `bi` with column units `ci` (ordered index lists): equal
 * units are matched, and each stretch between them is paired into changed
 * units, added ones and removed runs. `end` is where the range ends in the
 * column, for a removed run at its end.
 *
 * @returns {true|'budget'|'different'} true, or why the units could not be aligned
 */
export function alignRange(ctx, bi, ci, end, maxD = UNIT_MAX_D) {
  const {
    baseUnits, colUnits, units, removed, opts,
  } = ctx;
  const [a, b] = intern(bi.map((i) => keyOf(baseUnits[i], opts)), ci.map((i) => keyOf(colUnits[i], opts)));
  const runs = myers(a, b, { maxD, budget: ctx.budget });
  if (!runs) return ctx.budget.left < 0 ? 'budget' : 'different';
  const addRemoved = (at, list) => {
    if (!list.length) return;
    const last = removed[removed.length - 1];
    if (last && last.at === at) last.units.push(...list);
    else removed.push({ at, units: [...list] });
  };
  // Walk the stretches between equal runs.
  let i = 0;
  while (i < runs.length) {
    const run = runs[i];
    if (run.t === 'eq') {
      for (let k = 0; k < run.n; k += 1) units[ci[run.b + k]].base = bi[run.a + k];
      i += 1;
      continue;
    }
    const dels = [];
    const inss = [];
    let next = i;
    while (next < runs.length && runs[next].t !== 'eq') {
      const r = runs[next];
      for (let k = 0; k < r.n; k += 1) {
        if (r.t === 'del') dels.push(bi[r.a + k]);
        else inss.push(ci[r.b + k]);
      }
      next += 1;
    }
    // Where this stretch ends in the column: the unit after it.
    const after = next < runs.length ? ci[runs[next].b] : end;
    const pairs = pairUnits(dels, inss, baseUnits, colUnits);
    let dPos = 0;
    let iPos = 0;
    // Removed units between two pairs stand before the first added unit
    // there, or before the next pair; added ones are marked as added.
    const place = (dTo, iTo, nextUnit) => {
      addRemoved(iPos < iTo ? inss[iPos] : nextUnit, dels.slice(dPos, dTo));
      for (let k = iPos; k < iTo; k += 1) units[inss[k]].state = 'added';
      dPos = dTo;
      iPos = iTo;
    };
    for (const [pd, pi] of pairs) {
      place(pd, pi, inss[pi]);
      markChanged(ctx, units[inss[pi]], baseUnits[dels[pd]], colUnits[inss[pi]], dels[pd]);
      dPos = pd + 1;
      iPos = pi + 1;
    }
    place(dels.length, inss.length, after);
    i = next;
  }
  return true;
}

/**
 * A changed unit's marks: word by word, line by line for a code block or a
 * paragraph of many lines, cell by cell for a table row. A unit that cannot
 * be marked keeps why (`unmarked`), and every changed unit how many of its
 * words changed, for `tooDifferent`.
 */
function markChanged(ctx, slot, baseUnit, unit, baseIndex) {
  const { opts, budget } = ctx;
  const limits = { maxD: ctx.wordMaxD };
  slot.base = baseIndex;
  slot.state = 'changed';
  slot.words = null;
  slot.cells = null;
  slot.unmarked = null;
  let words;
  if (unit.kind === 'tr') words = rowDiff(baseUnit, unit, opts, budget, limits);
  else if (unit.kind === 'pre') words = codeDiff(baseUnit.text, unit.text, opts, budget);
  else if (!unit.inl || !baseUnit.inl) words = { reason: 'cap' };
  else if (manyLines(unit.inl) || manyLines(baseUnit.inl)) words = textLinesDiff(baseUnit.inl, unit.inl, opts, budget, limits);
  else words = wordDiff(baseUnit.inl, unit.inl, opts, budget, limits);
  if (words.reason) {
    slot.unmarked = unit.kind === 'pre' && words.reason === 'cap' ? 'code' : words.reason;
    slot.changedTokens = wordCount(unit);
    slot.tokens = slot.changedTokens;
    return;
  }
  if (!words.edits) {
    // Only spaces or ignored characters differ: the unit is the same.
    slot.state = 'same';
    return;
  }
  if (unit.kind === 'tr') slot.cells = words.cells;
  else slot.words = words.segments;
  slot.tokens = words.total;
  slot.changedTokens = Math.max(0, words.total - words.kept);
}

function finish({
  units, removed, baseUnits, colUnits, moves, failed,
}) {
  const changes = [];
  let r = 0;
  const counts = {
    changed: 0, added: 0, removed: removed.length, moved: moves.length, total: 0,
  };
  for (let u = 0; u <= units.length; u += 1) {
    while (r < removed.length && removed[r].at === u) {
      changes.push({ kind: 'del', removed: r });
      r += 1;
    }
    if (u === units.length) break;
    const slot = units[u];
    if (slot.move !== undefined && moves[slot.move].units[0] === u) {
      changes.push({ kind: 'mov', unit: u, move: slot.move });
    } else if (slot.state === 'changed') {
      counts.changed += 1;
      changes.push({ kind: 'chg', unit: u });
    } else if (slot.state === 'added') {
      counts.added += 1;
      changes.push({ kind: 'add', unit: u });
    }
  }
  counts.total = changes.length;

  // How much of the column's words changed: a changed unit's changed words,
  // every word of an added unit and of a removed one.
  let colWords = 0;
  let changedWords = 0;
  let removedWords = 0;
  let changedUnits = 0;
  let cut = 0;
  let unmarked = 0;
  let stoppedAt = -1;
  units.forEach((slot, u) => {
    const n = wordCount(colUnits[u]);
    colWords += n;
    if (slot.state === 'added') changedWords += n;
    if (slot.state !== 'changed') return;
    changedUnits += 1;
    changedWords += slot.changedTokens ?? n;
    if (!slot.unmarked) return;
    unmarked += 1;
    if (colUnits[u].kind !== 'pre') cut += 1;
    if (slot.unmarked === 'budget' && stoppedAt < 0) stoppedAt = u;
  });
  for (const run of removed) for (const i of run.units) removedWords += wordCount(baseUnits[i]);
  const wordShare = (changedWords + removedWords) / Math.max(1, colWords + removedWords);
  const differing = counts.changed + counts.added;
  const share = cut * 2 > changedUnits ? differing / Math.max(1, units.length) > TOO_DIFFERENT : wordShare > TOO_DIFFERENT_WORDS;
  return {
    units,
    removed,
    moves,
    changes,
    counts,
    tooDifferent: Boolean(failed) || (units.length >= 3 && share),
    failed,
    unmarked,
    stoppedAt,
    wordShare,
    baseUnits,
    colUnits,
  };
}

/** Words of a removed run, for its ghost row: "Contributing factors, 19 words". */
export function describeRemoved(baseUnits, indices) {
  const list = indices.map((i) => baseUnits[i]).filter(Boolean);
  const heading = list.find((u) => u.kind === 'h');
  let words = 0;
  for (const u of list) words += tokenize(u.text).filter((t) => t.kind === 'w').length;
  const kinds = { h: 'heading', p: 'paragraph', li: 'list item', tr: 'table row', pre: 'code block' };
  // A run that opens with a heading is that section; any other is counted,
  // naming the first heading inside it.
  let what;
  if (list[0]?.kind === 'h') what = list[0].text.trim();
  else {
    const same = list.every((u) => u.kind === list[0].kind);
    const word = same ? (kinds[list[0]?.kind] || 'paragraph') : 'part';
    what = list.length === 1 ? `1 ${word}` : `${list.length} ${word}s`;
    if (heading) what += `, including ${heading.text.trim()}`;
  }
  return { what, words, preview: (list.find((u) => u.kind !== 'h') || list[0])?.text.trim() || '' };
}
