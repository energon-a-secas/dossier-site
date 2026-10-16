/**
 * Myers' O(ND) diff, and the word marks of one changed unit built on it.
 * DOM-free: node imports it.
 *
 * Every run has an edit cap and draws on a work budget, both counted in
 * steps, never in time, so the same two reports always get the same marks
 * whatever the machine or its load: a budget in milliseconds marked 300
 * changed paragraphs on a fast machine and none on a slow one. Past the cap
 * a unit is marked as changed without word marks, and says so. A small
 * equality caught between two edits is folded into them, so "changed the
 * cache TTL" reads as one replacement rather than four (diff-match-patch's
 * semantic cleanup, with a stricter threshold so a figure both sides share
 * stays visible).
 */

import { inlineTokens, tokensToInline, wordKey, withoutLinks } from './diff-tokens.js';

/** A word diff that keeps less than this share of the longer side is not worth marking. */
const WORDS_MIN_KEPT = 0.25;
/** The edit cap of one unit's word diff. Word marks turned on by hand raise it. */
export const WORD_MAX_D = 400;
export const WORD_MAX_D_FORCED = 4000;

// ── Myers ────────────────────────────────────────────────────────────────────

/**
 * Myers' O(ND) diff of two integer sequences.
 *
 * `budget` is shared work: each edit step `d` costs its 2d + 1 diagonals and
 * each matching step along a diagonal costs one, so a column's units and
 * all their word diffs draw on one bounded amount of work.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @param {{maxD?: number, budget?: {left: number}|null}} [limits]
 * @returns {Array<{t: 'eq'|'del'|'ins', a: number, b: number, n: number}>|null}
 *   runs in order (`a` and `b` are where each run starts in its sequence),
 *   or null when the edit distance passed `maxD` or the budget ran out
 *   (then `budget.left` is below 0)
 */
export function myers(a, b, { maxD = Infinity, budget = null } = {}) {
  const n = a.length;
  const m = b.length;
  let pre = 0;
  while (pre < n && pre < m && a[pre] === b[pre]) pre += 1;
  let endA = n;
  let endB = m;
  while (endA > pre && endB > pre && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const N = endA - pre;
  const M = endB - pre;
  const ops = [];
  if (N === 0 || M === 0) {
    if (N) ops.push(['del', N]);
    if (M) ops.push(['ins', M]);
  } else {
    const max = Math.min(N + M, maxD);
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    let done = false;
    for (let d = 0; d <= max && !done; d += 1) {
      if (budget) {
        budget.left -= 2 * d + 1;
        if (budget.left < 0) return null;
      }
      trace.push(v.slice(off - d - 1, off + d + 2));
      let steps = 0;
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        const from = x;
        while (x < N && y < M && a[pre + x] === b[pre + y]) {
          x += 1;
          y += 1;
        }
        steps += x - from;
        v[off + k] = x;
        if (x >= N && y >= M) {
          done = true;
          break;
        }
      }
      if (budget) budget.left -= steps;
    }
    if (!done) return null;
    // Walk back through the snapshots. Each holds k from -d-1 to d+1.
    let x = N;
    let y = M;
    const rev = [];
    for (let d = trace.length - 1; d >= 0; d -= 1) {
      const snap = trace[d];
      const at = (k) => snap[k + d + 1];
      const k = x - y;
      const prevK = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
      const prevX = d === 0 ? 0 : at(prevK);
      const prevY = d === 0 ? 0 : prevX - prevK;
      while (x > prevX && y > prevY) {
        rev.push('eq');
        x -= 1;
        y -= 1;
      }
      if (d > 0) rev.push(x === prevX ? 'ins' : 'del');
      x = prevX;
      y = prevY;
    }
    for (let i = rev.length - 1; i >= 0; i -= 1) {
      const t = rev[i];
      const last = ops[ops.length - 1];
      if (last && last[0] === t) last[1] += 1;
      else ops.push([t, 1]);
    }
  }
  const runs = [];
  let ai = 0;
  let bi = 0;
  const push = (t, count) => {
    if (!count) return;
    const last = runs[runs.length - 1];
    if (last && last.t === t) {
      last.n += count;
    } else {
      runs.push({ t, a: ai, b: bi, n: count });
    }
    if (t !== 'ins') ai += count;
    if (t !== 'del') bi += count;
  };
  push('eq', pre);
  for (const [t, count] of ops) push(t, count);
  push('eq', n - endA);
  return orderEdits(runs);
}

/** Within each stretch between equal runs, removals come before additions. */
function orderEdits(runs) {
  const out = [];
  let dels = [];
  let inss = [];
  const flush = () => {
    out.push(...dels, ...inss);
    dels = [];
    inss = [];
  };
  for (const run of runs) {
    if (run.t === 'eq') {
      flush();
      out.push(run);
    } else if (run.t === 'del') dels.push(run);
    else inss.push(run);
  }
  flush();
  return mergeRuns(out);
}

function mergeRuns(runs) {
  const out = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && last.t === run.t && run.n) last.n += run.n;
    else if (run.n) out.push({ ...run });
  }
  return out;
}

/** Turn strings into small integers, shared across both sides. */
export function intern(keysA, keysB) {
  const ids = new Map();
  const id = (key) => {
    let value = ids.get(key);
    if (value === undefined) {
      value = ids.size;
      ids.set(key, value);
    }
    return value;
  };
  return [Int32Array.from(keysA, id), Int32Array.from(keysB, id)];
}

// ── Words ────────────────────────────────────────────────────────────────────

/** The tokens of each side that are compared: words, and punctuation unless ignored. */
function compared(tokens, opts) {
  const idx = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.kind === 'w' || (tok.kind === 'p' && !opts.ignorePunctuation)) idx.push(i);
  }
  return idx;
}

/**
 * Fold a short equality caught between two edits into them, the way
 * diff-match-patch's semantic cleanup does, so a replaced phrase reads as one
 * replacement and not as words that happen to survive inside it.
 */
function cleanupSemantic(runs, lenA, lenB) {
  let changed = true;
  let out = runs;
  let guard = 0;
  while (changed && guard < 8) {
    changed = false;
    guard += 1;
    const next = [];
    for (let i = 0; i < out.length; i += 1) {
      const run = out[i];
      if (run.t === 'eq' && i > 0 && i < out.length - 1) {
        const before = editSize(out, i - 1, -1, lenA, lenB);
        const after = editSize(out, i + 1, 1, lenA, lenB);
        // Twice the equality must fit in the edits on both sides: "the"
        // inside "changed the cache TTL" folds, a figure that both sides
        // share ("1,940") stays visible.
        const size = 2 * lenA(run.a, run.n);
        if (before && after && size <= before && size <= after) {
          next.push({ t: 'del', a: run.a, b: run.b, n: run.n }, { t: 'ins', a: run.a + run.n, b: run.b, n: run.n });
          changed = true;
          continue;
        }
      }
      next.push(run);
    }
    out = changed ? reorder(next) : next;
  }
  return out;
}

/** The larger side (in characters) of the edits next to an equality. */
function editSize(runs, from, dir, lenA, lenB) {
  let del = 0;
  let ins = 0;
  for (let i = from; i >= 0 && i < runs.length && runs[i].t !== 'eq'; i += dir) {
    if (runs[i].t === 'del') del += lenA(runs[i].a, runs[i].n);
    else ins += lenB(runs[i].b, runs[i].n);
  }
  return Math.max(del, ins);
}

/** Rebuild runs after folding: the `a` and `b` starts are recomputed in order. */
function reorder(runs) {
  const grouped = orderEdits(runs.map((r) => ({ ...r })));
  // Starts are positions in each sequence; dels and inss of one stretch keep
  // theirs, which stay contiguous after sorting because they were contiguous.
  const out = [];
  for (const run of grouped) {
    const last = out[out.length - 1];
    if (last && last.t === run.t) last.n += run.n;
    else out.push(run);
  }
  return out;
}

/**
 * The word marks of a changed unit: segments of the new unit's text, each
 * `{type: 'eq'|'ins'|'del', inl}`, ready for js/compare/ir-render.js, with
 * the words kept and the words of the longer side (`kept`, `total`), which
 * js/compare/diff.js sums to tell a light edit from a rewrite.
 *
 * @param {Array} baseInl inline runs of the base unit
 * @param {Array} inl inline runs of this column's unit
 * @param {{ignoreCase?: boolean, ignorePunctuation?: boolean, force?: boolean}} opts
 *   `force`: Word marks turned on by hand, so mark even a unit that is mostly new
 * @param {{left: number}|null} [budget] shared work (see `myers`)
 * @param {{maxD?: number}} [limits]
 * @returns {{segments: Array<{type: string, inl: Array}>, edits: number, kept: number, total: number}
 *   | {reason: 'cap'|'budget', segments?: undefined}}
 *   a reason instead of segments when the words cannot be marked within the
 *   cap or the budget, or would be noise (`cap`)
 */
export function wordDiff(baseInl, inl, opts = {}, budget = null, { maxD = WORD_MAX_D } = {}) {
  const aTok = inlineTokens(baseInl);
  const bTok = inlineTokens(inl);
  const key = wordKey(opts);
  const aIdx = compared(aTok, opts);
  const bIdx = compared(bTok, opts);
  const [a, b] = intern(aIdx.map((i) => key(aTok[i].text)), bIdx.map((i) => key(bTok[i].text)));
  const runs0 = myers(a, b, { maxD: Math.min(maxD, a.length + b.length), budget });
  if (!runs0) return { reason: budget && budget.left < 0 ? 'budget' : 'cap' };
  const lenA = (from, n) => {
    let s = 0;
    for (let i = from; i < from + n; i += 1) s += aTok[aIdx[i]].text.length;
    return s;
  };
  const lenB = (from, n) => {
    let s = 0;
    for (let i = from; i < from + n; i += 1) s += bTok[bIdx[i]].text.length;
    return s;
  };
  const runs = cleanupSemantic(runs0, lenA, lenB);
  let kept = 0;
  let keptWords = 0;
  let edits = 0;
  for (const run of runs) {
    if (run.t === 'eq') {
      kept += run.n;
      for (let i = run.a; i < run.a + run.n; i += 1) if (aTok[aIdx[i]].kind === 'w') keptWords += 1;
    } else edits += 1;
  }
  const words = (tokens) => tokens.reduce((n, tok) => n + (tok.kind === 'w' ? 1 : 0), 0);
  const total = Math.max(words(aTok), words(bTok));
  if (!edits) return { segments: [{ type: 'eq', inl }], edits: 0, kept: keptWords, total };
  if (!opts.force && kept < WORDS_MIN_KEPT * Math.max(a.length, b.length)) return { reason: 'cap' };

  // Lay the edits over this column's own tokens, spaces and ignored
  // punctuation included, so its text reads as it was written. Removed words
  // come from the base, without its links.
  const SPACE = { text: ' ', kind: 's', ctx: [] };
  const out = [];
  const emit = (type, tok) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.tokens.push(tok);
    else out.push({ type, tokens: [tok] });
  };
  const lastTok = () => {
    const last = out[out.length - 1];
    return last ? last.tokens[last.tokens.length - 1] : null;
  };
  let bPos = 0;
  // A removed word that stood before a space in the base keeps that space
  // after it, outside the mark, so it does not glue to the next word.
  let spaceOwed = false;
  const pushB = (type, tok) => {
    if (spaceOwed && tok.kind !== 's' && lastTok()?.kind !== 's') emit('eq', SPACE);
    spaceOwed = false;
    emit(type, tok);
  };
  const gap = (to) => {
    for (; bPos < to; bPos += 1) pushB('eq', bTok[bPos]);
  };
  for (const run of runs) {
    if (run.t === 'eq') {
      gap(bIdx[run.b + run.n - 1] + 1);
    } else if (run.t === 'ins') {
      gap(bIdx[run.b]);
      const prev = out[out.length - 1];
      // "changed the cache TTL" then "lowered the pool": a space between the
      // two marks, so they read as two phrases.
      if (prev?.type === 'del' && lastTok()?.kind === 'w' && bTok[bPos]?.kind === 'w') emit('eq', SPACE);
      const end = bIdx[run.b + run.n - 1] + 1;
      for (; bPos < end; bPos += 1) pushB('ins', bTok[bPos]);
    } else {
      gap(run.b < bIdx.length ? bIdx[run.b] : bTok.length);
      const from = aIdx[run.a];
      const to = aIdx[run.a + run.n - 1];
      const before = lastTok();
      if (before && before.kind !== 's' && from > 0 && aTok[from - 1].kind === 's') emit('eq', SPACE);
      spaceOwed = false;
      for (let i = from; i <= to; i += 1) emit('del', { ...aTok[i], ctx: withoutLinks(aTok[i].ctx) });
      spaceOwed = to + 1 < aTok.length && aTok[to + 1].kind === 's';
    }
  }
  gap(bTok.length);
  return {
    segments: out.map((seg) => ({ type: seg.type, inl: tokensToInline(seg.tokens) })),
    edits,
    kept: keptWords,
    total,
  };
}

