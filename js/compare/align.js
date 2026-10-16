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
 * Dice similarity of two headings, 0 to 1.
 *
 * @param {string} a
 * @param {string} b
 */
export function similarity(a, b) {
  const x = normHeading(a);
  const y = normHeading(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let both = 0;
  let total = 0;
  for (const count of gx.values()) total += count;
  for (const count of gy.values()) total += count;
  for (const [gram, count] of gx) both += Math.min(count, gy.get(gram) || 0);
  return total ? (2 * both) / total : 0;
}

/**
 * Align two heading lists.
 *
 * @param {Array<{text: string, level?: number}>} a
 * @param {Array<{text: string, level?: number}>} b
 * @returns {Array<{a: number, b: number, sim: number}>} index pairs, in order
 */
export function alignHeadings(a, b) {
  const left = (a || []).slice(0, MAX_HEADINGS);
  const right = (b || []).slice(0, MAX_HEADINGS);
  const n = left.length;
  const m = right.length;
  if (!n || !m) return [];

  const score = (i, j) => {
    const sim = similarity(left[i].text, right[j].text);
    if (sim < MATCH) return 0;
    const cost = left[i].level && right[j].level && left[i].level !== right[j].level ? LEVEL_COST : 0;
    return Math.max(0.01, sim - cost);
  };

  // dp[i][j]: the best total for left[0..i) against right[0..j).
  const width = m + 1;
  const dp = new Float64Array((n + 1) * width);
  const sims = new Float64Array(n * m);
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const s = score(i - 1, j - 1);
      sims[(i - 1) * m + (j - 1)] = s;
      const diag = s > 0 ? dp[(i - 1) * width + (j - 1)] + s : -1;
      dp[i * width + j] = Math.max(diag, dp[(i - 1) * width + j], dp[i * width + (j - 1)]);
    }
  }

  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const s = sims[(i - 1) * m + (j - 1)];
    const here = dp[i * width + j];
    if (s > 0 && Math.abs(here - (dp[(i - 1) * width + (j - 1)] + s)) < 1e-9) {
      pairs.push({ a: i - 1, b: j - 1, sim: similarity(left[i - 1].text, right[j - 1].text) });
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
  const rows = (base || []).map((h, index) => ({ index, text: h.text, level: h.level, cells: {} }));
  const extra = {};
  for (const [colId, headings] of Object.entries(others || {})) {
    const pairs = alignHeadings(base, headings);
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
