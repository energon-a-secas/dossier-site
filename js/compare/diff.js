/**
 * What changed between two reports, unit by unit and word by word.
 * DOM-free: node imports it.
 *
 * Both reports are IR (js/compare/ir.js). The diff runs in three steps:
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
 *      TTL" reads as one replacement rather than four.
 *
 * Every Myers run has an edit cap and the whole column a time budget, so two
 * very different reports cost a bounded amount: a unit whose words cannot be
 * marked within the cap is marked as changed without word marks, and a
 * column that differs in most of its units says so (`tooDifferent`).
 *
 * Results are memoised by the IR arrays (the column renderer keeps one per
 * source) and by a hash of the content, so a redraw that changed nothing in
 * either report does not diff again.
 */

import { visitUnits } from './ir.js';
import { tokenize } from './diff-tokens.js';
import { myers, intern, wordDiff, now } from './diff-words.js';

export { tokenize, inlineTokens, tokensToInline } from './diff-tokens.js';
export { myers, wordDiff } from './diff-words.js';

/** A removed and an added unit with at least this much in common are one changed unit. */
const PAIR_MIN = 0.4;
/** Above this share of changed or added units, a column is too different to mark word by word. */
const TOO_DIFFERENT = 0.5;
const UNIT_MAX_D = 1500;
const BUDGET_MS = 250;
/** A pairing matrix larger than this pairs in order instead. */
const PAIR_MATRIX_MAX = 20000;
const MEMO_MAX = 24;

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

/** Dice similarity of two units' words, 0 to 1. */
function unitSimilarity(x, y) {
  if (x.group !== y.group) return 0;
  const a = wordBag(x);
  const b = wordBag(y);
  let total = 0;
  let both = 0;
  for (const c of a.values()) total += c;
  for (const c of b.values()) total += c;
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
function rowDiff(baseUnit, unit, opts, deadline) {
  if (!baseUnit.cells || !unit.cells || baseUnit.cells.length !== unit.cells.length) return null;
  const cells = [];
  for (let c = 0; c < unit.cells.length; c += 1) {
    const words = wordDiff(baseUnit.cells[c], unit.cells[c], opts, deadline);
    if (!words) return null;
    cells.push(words.edits ? words.segments : null);
  }
  return cells;
}

/**
 * Compare a column's IR against the base column's.
 *
 * @param {Array} baseBlocks
 * @param {Array} blocks
 * @param {{ignoreCase?: boolean, ignorePunctuation?: boolean}} [opts]
 * @returns {{
 *   units: Array<{state: 'same'|'changed'|'added', base: number|null,
 *     words: Array|null, cells: Array|null}>,
 *   removed: Array<{at: number, units: number[]}>,
 *   changes: Array<{kind: 'chg'|'add'|'del', unit?: number, removed?: number}>,
 *   counts: {changed: number, added: number, removed: number, total: number},
 *   tooDifferent: boolean, failed: boolean, baseUnits: Array, colUnits: Array}}
 *   `removed[].at` is the column unit the removed run stands before (the
 *   number of units when it stands at the end).
 */
export function diffBlocks(baseBlocks, blocks, opts = {}) {
  const options = { ignoreCase: Boolean(opts.ignoreCase), ignorePunctuation: Boolean(opts.ignorePunctuation) };
  const memo = recall(baseBlocks, blocks, options);
  if (memo) return memo;
  const result = compute(baseBlocks, blocks, options);
  remember(baseBlocks, blocks, options, result);
  return result;
}

function compute(baseBlocks, blocks, opts) {
  const deadline = now() + BUDGET_MS;
  const baseUnits = unitsOf(baseBlocks);
  const colUnits = unitsOf(blocks);
  const keyOf = (u) => `${u.group}\u0001${normText(u.text, opts)}`;
  const [a, b] = intern(baseUnits.map(keyOf), colUnits.map(keyOf));
  const runs = myers(a, b, { maxD: UNIT_MAX_D, deadline: deadline + BUDGET_MS });

  const units = colUnits.map(() => ({ state: 'same', base: null, words: null, cells: null }));
  const removed = [];
  if (!runs) {
    return finish({ units, removed, baseUnits, colUnits, failed: true });
  }

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
      for (let k = 0; k < run.n; k += 1) units[run.b + k].base = run.a + k;
      i += 1;
      continue;
    }
    const dels = [];
    const inss = [];
    let next = i;
    while (next < runs.length && runs[next].t !== 'eq') {
      const r = runs[next];
      for (let k = 0; k < r.n; k += 1) {
        if (r.t === 'del') dels.push(r.a + k);
        else inss.push(r.b + k);
      }
      next += 1;
    }
    // Where this stretch ends in the column: the unit after it.
    const after = next < runs.length ? runs[next].b : colUnits.length;
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
      markChanged(units[inss[pi]], baseUnits[dels[pd]], colUnits[inss[pi]], dels[pd], opts, deadline);
      dPos = pd + 1;
      iPos = pi + 1;
    }
    place(dels.length, inss.length, after);
    i = next;
  }
  return finish({ units, removed, baseUnits, colUnits, failed: false });
}

function markChanged(slot, baseUnit, unit, baseIndex, opts, deadline) {
  slot.base = baseIndex;
  slot.state = 'changed';
  if (now() > deadline) return;
  if (unit.kind === 'tr') {
    slot.cells = rowDiff(baseUnit, unit, opts, deadline);
    return;
  }
  if (unit.kind === 'pre' || !unit.inl || !baseUnit.inl) return;
  const words = wordDiff(baseUnit.inl, unit.inl, opts, deadline);
  if (words && !words.edits) {
    // Only spaces or ignored characters differ: the unit is the same.
    slot.state = 'same';
    return;
  }
  slot.words = words ? words.segments : null;
}

function finish({ units, removed, baseUnits, colUnits, failed }) {
  const changes = [];
  let r = 0;
  const counts = { changed: 0, added: 0, removed: removed.length, total: 0 };
  for (let u = 0; u <= units.length; u += 1) {
    while (r < removed.length && removed[r].at === u) {
      changes.push({ kind: 'del', removed: r });
      r += 1;
    }
    if (u === units.length) break;
    const state = units[u].state;
    if (state === 'changed') {
      counts.changed += 1;
      changes.push({ kind: 'chg', unit: u });
    } else if (state === 'added') {
      counts.added += 1;
      changes.push({ kind: 'add', unit: u });
    }
  }
  counts.total = changes.length;
  const differing = counts.changed + counts.added;
  return {
    units,
    removed,
    changes,
    counts,
    tooDifferent: failed || (units.length >= 3 && differing / units.length > TOO_DIFFERENT),
    failed,
    baseUnits,
    colUnits,
  };
}

// ── Memo ─────────────────────────────────────────────────────────────────────

const byBlocks = new WeakMap();
const byHash = new Map();

function optsKey(opts) {
  return `${opts.ignoreCase ? 1 : 0}${opts.ignorePunctuation ? 1 : 0}`;
}

/** A cheap fingerprint of a block list's content. */
function hashBlocks(blocks) {
  let h = 0x811c9dc5;
  const text = JSON.stringify(blocks || []);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

const hashes = new WeakMap();
function hashOf(blocks) {
  if (!blocks || typeof blocks !== 'object') return 'none';
  if (!hashes.has(blocks)) hashes.set(blocks, hashBlocks(blocks));
  return hashes.get(blocks);
}

function recall(baseBlocks, blocks, opts) {
  const key = optsKey(opts);
  const inner = baseBlocks && typeof baseBlocks === 'object' ? byBlocks.get(baseBlocks)?.get(blocks) : null;
  if (inner?.has(key)) return inner.get(key);
  const hashed = byHash.get(`${hashOf(baseBlocks)}|${hashOf(blocks)}|${key}`);
  if (hashed) {
    byHash.delete(hashed.key);
    byHash.set(hashed.key, hashed);
    return hashed.result;
  }
  return null;
}

function remember(baseBlocks, blocks, opts, result) {
  const key = optsKey(opts);
  if (baseBlocks && typeof baseBlocks === 'object' && blocks && typeof blocks === 'object') {
    if (!byBlocks.has(baseBlocks)) byBlocks.set(baseBlocks, new WeakMap());
    const outer = byBlocks.get(baseBlocks);
    if (!outer.has(blocks)) outer.set(blocks, new Map());
    outer.get(blocks).set(key, result);
  }
  const hk = `${hashOf(baseBlocks)}|${hashOf(blocks)}|${key}`;
  byHash.set(hk, { key: hk, result });
  while (byHash.size > MEMO_MAX) byHash.delete(byHash.keys().next().value);
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
