/**
 * Parts of a report that moved, for js/compare/diff.js. DOM-free: node
 * imports it.
 *
 * The unit diff keeps order, so a section an agent moved past others was
 * always two things: a removed ghost where it left and a run of added units
 * where it arrived. After the unit diff, removed and added runs are cut
 * into chunks (at every heading and every gap) and a removed chunk and an
 * added chunk are the same part of the report when
 *
 *   headed  both open with a heading, and the headings read the same
 *           (js/compare/align.js `SAME`, by their words), or
 *   text    their words are at least 80% the same (Dice) and the smaller
 *           holds a few words (four when every word matches).
 *
 * Pairs are taken one to one, best first. Each is then aligned on its own,
 * so a moved section that was also reworded gets its word marks against
 * where it came from; a pair whose units do not line up (paragraphs that
 * became table rows) is let go. Neighbouring moves from neighbouring places
 * read as one. This describes the text and never scores it.
 *
 * The work is drawn from the column's budget, so the same reports always
 * get the same moves.
 */

import { prepareHeading, simPrepared, SAME } from './align.js';

const MOVE_TEXT_MIN = 0.8;
const MOVE_MIN_WORDS = 8;
const MOVE_EXACT_MIN_WORDS = 4;
const MOVE_PAIRS_MAX = 40000;

function sumBag(bag) {
  let n = 0;
  for (const c of bag.values()) n += c;
  return n;
}

function chunkBag(units, idx, bagOf) {
  const bag = new Map();
  for (const i of idx) for (const [w, c] of bagOf(units[i])) bag.set(w, (bag.get(w) || 0) + c);
  return bag;
}

function dice(a, b) {
  const total = a.words + b.words;
  if (!total) return 0;
  const [small, large] = a.bag.size <= b.bag.size ? [a.bag, b.bag] : [b.bag, a.bag];
  let both = 0;
  for (const [w, c] of small) both += Math.min(c, large.get(w) || 0);
  return (2 * both) / total;
}

/** Split ordered unit indices before every heading and at every gap. */
function split(idx, units) {
  const out = [];
  let cur = null;
  for (const i of idx) {
    if (!cur || units[i].kind === 'h' || i !== cur[cur.length - 1] + 1) {
      cur = [];
      out.push(cur);
    }
    cur.push(i);
  }
  return out;
}

function chunk(units, idx, bagOf) {
  const bag = chunkBag(units, idx, bagOf);
  const head = units[idx[0]];
  return {
    idx, bag, words: sumBag(bag), heading: head.kind === 'h' ? prepareHeading({ text: head.text }) : null,
  };
}

/**
 * Find the moves and apply them to the diff in `ctx` (its unit slots and
 * removed runs).
 *
 * @param {object} ctx js/compare/diff.js's diff state
 * @param {Function} alignRange js/compare/diff.js `alignRange`
 * @param {(unit: object) => Map<string, number>} bagOf a unit's words
 * @returns {Array<{units: number[], base: number[], after: string|null, section: boolean}>}
 */
export function findMoves(ctx, alignRange, bagOf) {
  const {
    baseUnits, colUnits, units, removed, budget,
  } = ctx;
  const rChunks = [];
  removed.forEach((run, k) => {
    for (const idx of split([...run.units].sort((x, y) => x - y), baseUnits)) rChunks.push({ run: k, ...chunk(baseUnits, idx, bagOf) });
  });
  const added = [];
  units.forEach((slot, i) => { if (slot.state === 'added') added.push(i); });
  const aChunks = split(added, colUnits).map((idx) => chunk(colUnits, idx, bagOf));
  if (!rChunks.length || !aChunks.length || rChunks.length * aChunks.length > MOVE_PAIRS_MAX) return [];

  const found = [];
  for (let ri = 0; ri < rChunks.length; ri += 1) {
    const r = rChunks[ri];
    for (let ai = 0; ai < aChunks.length; ai += 1) {
      const a = aChunks[ai];
      budget.left -= 1 + Math.min(r.bag.size, a.bag.size);
      const d = dice(r, a);
      let score = 0;
      let headed = false;
      if (r.heading && a.heading) {
        const s = simPrepared(r.heading, a.heading, SAME);
        if (s >= SAME) {
          score = 2 + s + d / 10;
          headed = true;
        }
      }
      if (!score && d >= MOVE_TEXT_MIN && Math.min(r.words, a.words) >= (d === 1 ? MOVE_EXACT_MIN_WORDS : MOVE_MIN_WORDS)) score = d;
      if (score) found.push({ ri, ai, score, headed });
    }
    if (budget.left < 0) return [];
  }
  found.sort((x, y) => y.score - x.score || x.ri - y.ri || x.ai - y.ai);
  const rTaken = new Set();
  const aTaken = new Set();
  const chosen = [];
  for (const c of found) {
    if (rTaken.has(c.ri) || aTaken.has(c.ai)) continue;
    rTaken.add(c.ri);
    aTaken.add(c.ai);
    chosen.push(c);
  }
  chosen.sort((x, y) => aChunks[x.ai].idx[0] - aChunks[y.ai].idx[0]);

  // Base units that stayed where they were, outside every move: a move does
  // not merge with the one before it across one of them.
  const stayed = new Set();
  for (const slot of units) if (slot.base !== null && slot.state !== 'added') stayed.add(slot.base);
  const moves = [];
  for (const c of chosen) {
    const r = rChunks[c.ri];
    const a = aChunks[c.ai];
    const saved = a.idx.map((i) => units[i]);
    for (const i of a.idx) units[i] = { state: 'same', base: null, words: null, cells: null };
    const inner = [];
    const aligned = alignRange({ ...ctx, removed: inner }, r.idx, a.idx, a.idx[a.idx.length - 1] + 1);
    const restore = () => a.idx.forEach((i, k) => { units[i] = saved[k]; });
    if (aligned !== true) {
      // Out of work: what is found so far stands, the rest stays as it was.
      restore();
      break;
    }
    const kept = a.idx.filter((i) => units[i].state !== 'added').length;
    if (!kept || (!c.headed && kept * 2 < a.idx.length)) {
      restore();
      continue;
    }
    const taken = new Set(r.idx);
    removed[r.run].units = removed[r.run].units.filter((i) => !taken.has(i));
    removed.push(...inner);
    const prev = moves[moves.length - 1];
    const prevEnd = prev ? prev.base[prev.base.length - 1] : -1;
    let between = false;
    for (let k = prevEnd + 1; prev && k < r.idx[0] && !between; k += 1) between = stayed.has(k);
    if (prev && a.idx[0] === prev.units[prev.units.length - 1] + 1 && r.idx[0] > prevEnd && !between) {
      prev.units.push(...a.idx);
      prev.base.push(...r.idx);
      for (const i of a.idx) units[i].move = moves.length - 1;
      continue;
    }
    for (const i of a.idx) units[i].move = moves.length;
    let after = null;
    for (let k = r.idx[0] - 1; k >= 0; k -= 1) {
      if (baseUnits[k].kind === 'h') {
        after = baseUnits[k].text.trim();
        break;
      }
    }
    moves.push({
      units: [...a.idx], base: [...r.idx], after, section: baseUnits[r.idx[0]].kind === 'h',
    });
  }

  // Removed runs again: none empty, in column order, one per place, since
  // the marks find a ghost by where it stands.
  const runs = removed.filter((run) => run.units.length).sort((x, y) => x.at - y.at);
  removed.length = 0;
  for (const run of runs) {
    const last = removed[removed.length - 1];
    if (last && last.at === run.at) last.units.push(...run.units);
    else removed.push(run);
  }
  for (const run of removed) run.units.sort((x, y) => x - y);
  return moves;
}
