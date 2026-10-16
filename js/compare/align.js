/**
 * Which heading in one column is which heading in another. DOM-free: node
 * imports it.
 *
 * Headings are matched by their words, never by meaning, and the order is
 * kept: a Needleman-Wunsch alignment over a similarity score, with no score
 * for a gap, so the result is the order-preserving set of pairs whose summed
 * similarity is greatest. Similarity is the Dice coefficient over the
 * character bigrams of each word, after lowercasing and removing numbering
 * and punctuation, so "2. Root causes" and "Root cause" match and "Impact"
 * and "Customer impact" match, while "Remediation" and "What we did" do not.
 * A pair needs 0.5 to count. Different heading levels cost a little.
 *
 * Each heading is prepared once (`prepareHeadings`: its normalised text and
 * its bigrams as sorted integer ids), so scoring a pair is a merge of two
 * short integer arrays, and a pair that cannot reach 0.5 is skipped on its
 * bigram totals alone. Aligning 400 headings against 400 used to take
 * seconds and froze the first synced scroll; it now takes milliseconds.
 *
 * Sync uses the pairs as anchors, and the Sections panel uses them to say
 * which sections a column has, has under another name, or left out.
 */

/** A pair below this is not a match. */
export const MATCH = 0.5;
/** A pair at or above this reads as the same heading; between, "renamed". */
export const SAME = 0.85;
const LEVEL_COST = 0.1;
/** Past this many headings a column is aligned on its first ones only. */
const MAX_HEADINGS = 600;

/** Lowercase, no leading numbering, no punctuation, single spaces. */
export function normHeading(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/^\s*(?:(?:section|part|chapter)\s+)?(?:\d+(?:\.\d+)*|[ivxlc]{1,6}|[a-z])[.):]\s+/, '')
    .replace(/^\s*\d+(?:\.\d+)+\s+/, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(text) {
  const grams = new Map();
  for (const word of text.split(' ')) {
    if (!word) continue;
    if (word.length === 1) {
      grams.set(word, (grams.get(word) || 0) + 1);
      continue;
    }
    for (let i = 0; i < word.length - 1; i += 1) {
      const gram = word.slice(i, i + 2);
      grams.set(gram, (grams.get(gram) || 0) + 1);
    }
  }
  return grams;
}

/**
 * Small integer ids for bigrams, shared by every prepared heading, so two
 * headings compare by merging two sorted integer arrays. Bounded by the
 * number of distinct bigrams ever seen.
 */
const gramIds = new Map();
function gramId(gram) {
  let id = gramIds.get(gram);
  if (id === undefined) {
    id = gramIds.size;
    gramIds.set(gram, id);
  }
  return id;
}

/**
 * One heading, ready to be compared many times: its normalised text, its
 * bigram ids sorted ascending with their counts, and their total. Its text
 * is read once, here.
 *
 * @param {{text: string, level?: number}} heading
 */
export function prepareHeading(heading) {
  const text = heading ? heading.text : '';
  const norm = normHeading(text);
  const entries = norm ? [...bigrams(norm)].map(([gram, n]) => [gramId(gram), n]).sort((x, y) => x[0] - y[0]) : [];
  const gram = new Int32Array(entries.length);
  const count = new Int32Array(entries.length);
  let total = 0;
  entries.forEach(([id, n], i) => {
    gram[i] = id;
    count[i] = n;
    total += n;
  });
  return { text: String(text ?? ''), norm, gram, count, total, level: heading ? heading.level : undefined };
}

/**
 * Prepare a heading list once, for many alignments (sync keeps one per
 * registered column).
 *
 * @param {Array<{text: string, level?: number}>} list
 */
export function prepareHeadings(list) {
  return (list || []).map(prepareHeading);
}

/**
 * Dice similarity of two prepared headings. With `floor`, a pair whose best
 * possible score (the Dice bound of their bigram totals) is under it scores
 * 0 at once: it could not count as a match anyway.
 */
export function simPrepared(x, y, floor = 0) {
  if (!x.norm || !y.norm) return 0;
  if (x.norm === y.norm) return 1;
  const sum = x.total + y.total;
  if (!sum) return 0;
  if (floor && (2 * Math.min(x.total, y.total)) / sum < floor) return 0;
  let both = 0;
  let i = 0;
  let j = 0;
  const a = x.gram;
  const b = y.gram;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      both += Math.min(x.count[i], y.count[j]);
      i += 1;
      j += 1;
    } else if (a[i] < b[j]) i += 1;
    else j += 1;
  }
  return (2 * both) / sum;
}

/**
 * Dice similarity of two headings, 0 to 1.
 *
 * @param {string} a
 * @param {string} b
 */
export function similarity(a, b) {
  return simPrepared(prepareHeading({ text: a }), prepareHeading({ text: b }), 0);
}

const isPrepared = (list) => list.length > 0 && list[0] instanceof Object && list[0].gram instanceof Int32Array;

/**
 * Align two heading lists, raw or already prepared (`prepareHeadings`).
 * Each heading's text is read once: the scores of a pair come from the
 * prepared forms, and the score of each cell is kept for the way back.
 *
 * @param {Array<{text: string, level?: number}>} a
 * @param {Array<{text: string, level?: number}>} b
 * @returns {Array<{a: number, b: number, sim: number}>} index pairs, in order
 */
export function alignHeadings(a, b) {
  const rawLeft = (a || []).slice(0, MAX_HEADINGS);
  const rawRight = (b || []).slice(0, MAX_HEADINGS);
  const n = rawLeft.length;
  const m = rawRight.length;
  if (!n || !m) return [];
  const left = isPrepared(rawLeft) ? rawLeft : prepareHeadings(rawLeft);
  const right = isPrepared(rawRight) ? rawRight : prepareHeadings(rawRight);

  // dp[i][j]: the best total for left[0..i) against right[0..j).
  const width = m + 1;
  const dp = new Float64Array((n + 1) * width);
  const sims = new Float64Array(n * m);
  const raw = new Float64Array(n * m);
  for (let i = 1; i <= n; i += 1) {
    const x = left[i - 1];
    for (let j = 1; j <= m; j += 1) {
      const y = right[j - 1];
      const sim = simPrepared(x, y, MATCH);
      let s = 0;
      if (sim >= MATCH) {
        const cost = x.level && y.level && x.level !== y.level ? LEVEL_COST : 0;
        s = Math.max(0.01, sim - cost);
      }
      const cell = (i - 1) * m + (j - 1);
      sims[cell] = s;
      raw[cell] = sim;
      const diag = s > 0 ? dp[(i - 1) * width + (j - 1)] + s : -1;
      dp[i * width + j] = Math.max(diag, dp[(i - 1) * width + j], dp[i * width + (j - 1)]);
    }
  }

  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const cell = (i - 1) * m + (j - 1);
    const s = sims[cell];
    const here = dp[i * width + j];
    if (s > 0 && Math.abs(here - (dp[(i - 1) * width + (j - 1)] + s)) < 1e-9) {
      pairs.push({ a: i - 1, b: j - 1, sim: raw[cell] });
      i -= 1;
      j -= 1;
    } else if (dp[(i - 1) * width + j] >= dp[i * width + (j - 1)]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return pairs.reverse();
}

/**
 * Map a position in one column to the matching position in another, through
 * matched headings: piecewise linear between neighbouring anchors, with the
 * start and the end of both columns as anchors too.
 *
 * @param {number} y the position in the leader, in content pixels
 * @param {Array<[number, number]>} anchors [leaderY, followerY] pairs
 * @param {number} leaderEnd the leader's content height
 * @param {number} followerEnd the follower's content height
 * @returns {number}
 */
export function mapPosition(y, anchors, leaderEnd, followerEnd) {
  const points = [[0, 0]];
  for (const [ay, by] of anchors || []) {
    const last = points[points.length - 1];
    // Anchors must climb in both columns; one that does not is dropped.
    if (Number.isFinite(ay) && Number.isFinite(by) && ay > last[0] && by >= last[1]) points.push([ay, by]);
  }
  const end = points[points.length - 1];
  if (leaderEnd > end[0] && followerEnd >= end[1]) points.push([leaderEnd, followerEnd]);
  if (y <= 0) return 0;
  for (let k = 1; k < points.length; k += 1) {
    const [a0, b0] = points[k - 1];
    const [a1, b1] = points[k];
    if (y <= a1) {
      const t = a1 === a0 ? 0 : (y - a0) / (a1 - a0);
      return b0 + t * (b1 - b0);
    }
  }
  const [aN, bN] = points[points.length - 1];
  return bN + (y - aN);
}

/**
 * Sections of a base column against the others, for the Sections panel.
 *
 * @param {Array<{text: string, level?: number}>} base
 * @param {Record<string, Array<{text: string, level?: number}>>} others by column id
 * @returns {{rows: Array<{index: number, text: string, cells: Record<string, {state: 'present'|'renamed'|'missing', index?: number, text?: string}>}>,
 *   extra: Record<string, Array<{index: number, text: string}>>}}
 *   `extra` lists, per column, its headings that match nothing in the base.
 */
export function sectionMatrix(base, others) {
  const prepared = prepareHeadings(base);
  const rows = prepared.map((h, index) => ({ index, text: h.text, level: h.level, cells: {} }));
  const extra = {};
  for (const [colId, headings] of Object.entries(others || {})) {
    const pairs = alignHeadings(prepared, headings);
    const byBase = new Map(pairs.map((p) => [p.a, p]));
    const used = new Set(pairs.map((p) => p.b));
    for (const row of rows) {
      const pair = byBase.get(row.index);
      row.cells[colId] = !pair
        ? { state: 'missing' }
        : { state: pair.sim >= SAME ? 'present' : 'renamed', index: pair.b, text: headings[pair.b].text };
    }
    extra[colId] = (headings || []).map((h, index) => ({ index, text: h.text, level: h.level }))
      .filter((h) => !used.has(h.index));
  }
  return { rows, extra };
}
