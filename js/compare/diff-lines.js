/**
 * Line by line, for the units a word diff cannot take whole: a code block,
 * and a plain-text paragraph of many lines (a log or a text report with no
 * blank lines is one paragraph). DOM-free: node imports it.
 *
 * The lines are aligned first, with Myers on each line's normalised text.
 * In a code block a changed line is marked whole, removed then inserted, so
 * its indentation reads exactly as written. In text, each pair of changed
 * lines is then diffed word by word, and a line that cannot be paired is
 * marked whole. Before this a changed code block was always tinted with no
 * marks, and a 600-line log with every third line edited was one changed
 * unit with no marks at all.
 *
 * Both return what js/compare/diff-words.js `wordDiff` returns: segments of
 * the column's own text with the words kept and the longer side's words.
 */

import { myers, intern, wordDiff } from './diff-words.js';
import { tokenize } from './diff-tokens.js';
import { inlineText } from './ir.js';

/** A paragraph with more line breaks than this is diffed line by line. */
const MANY_LINES = 20;
const LINE_MAX_D = 4000;

const wordCount = (text) => tokenize(text).reduce((n, tok) => n + (tok.kind === 'w' ? 1 : 0), 0);

/** True when a paragraph's runs hold enough line breaks to diff it line by line. */
export function manyLines(inl) {
  let n = 0;
  for (const run of Array.isArray(inl) ? inl : []) if (run && run.br) n += 1;
  return n > MANY_LINES;
}

/** Inline runs split at their line breaks (top level only). */
function splitLines(inl) {
  const lines = [[]];
  for (const run of Array.isArray(inl) ? inl : []) {
    if (run && run.br) lines.push([]);
    else lines[lines.length - 1].push(run);
  }
  return lines;
}

function lineKey(text, opts) {
  let t = String(text || '').replace(/\s+$/, '');
  if (opts.ignoreCase) t = t.toLowerCase();
  return t;
}

/**
 * Lay out entries `{type, inl}` as segments, each line followed by its line
 * break inside its own segment, so a removed line hidden by "Show removed
 * words" takes its break with it. Same-type neighbours merge.
 */
function layout(entries, br) {
  const segments = [];
  entries.forEach((entry, i) => {
    const inl = i < entries.length - 1 ? [...entry.inl, br] : entry.inl;
    const last = segments[segments.length - 1];
    if (last && last.type === entry.type) last.inl.push(...inl);
    else segments.push({ type: entry.type, inl: [...inl] });
  });
  return segments;
}

/**
 * Align two line lists and hand each stretch of removed and added lines to
 * `pair`, which turns them into entries.
 */
function alignLines(aLines, bLines, aText, bText, opts, budget, pair) {
  const [a, b] = intern(aText.map((t) => lineKey(t, opts)), bText.map((t) => lineKey(t, opts)));
  const runs = myers(a, b, { maxD: LINE_MAX_D, budget });
  if (!runs) return { reason: budget && budget.left < 0 ? 'budget' : 'cap' };
  const entries = [];
  let kept = 0;
  let edits = 0;
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    if (run.t === 'eq') {
      for (let k = 0; k < run.n; k += 1) {
        entries.push({ type: 'eq', inl: bLines[run.b + k] });
        kept += wordCount(bText[run.b + k]);
      }
      continue;
    }
    const dels = [];
    const inss = [];
    while (i < runs.length && runs[i].t !== 'eq') {
      const r = runs[i];
      for (let k = 0; k < r.n; k += 1) (r.t === 'del' ? dels : inss).push(r.t === 'del' ? r.a + k : r.b + k);
      i += 1;
    }
    i -= 1;
    const out = pair(dels, inss);
    edits += out.edits;
    kept += out.kept;
    entries.push(...out.entries);
  }
  const total = Math.max(aText.reduce((n, t) => n + wordCount(t), 0), bText.reduce((n, t) => n + wordCount(t), 0));
  return { entries, edits, kept, total };
}

/**
 * A code block, line by line: changed lines are marked whole.
 *
 * @param {string} baseText
 * @param {string} text
 * @param {{ignoreCase?: boolean}} opts
 * @param {{left: number}|null} budget
 */
export function codeDiff(baseText, text, opts, budget) {
  const aText = String(baseText || '').replace(/\r\n?/g, '\n').split('\n');
  const bText = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const line = (t) => [{ text: t }];
  const done = alignLines(aText.map(line), bText.map(line), aText, bText, opts, budget, (dels, inss) => ({
    entries: [...dels.map((k) => ({ type: 'del', inl: line(aText[k]) })), ...inss.map((k) => ({ type: 'ins', inl: line(bText[k]) }))],
    edits: (dels.length ? 1 : 0) + (inss.length ? 1 : 0),
    kept: 0,
  }));
  if (done.reason) return done;
  return { segments: layout(done.entries, { text: '\n' }), edits: done.edits, kept: done.kept, total: done.total };
}

/**
 * A paragraph of many lines: lines aligned, then each pair of changed lines
 * word by word, in order.
 *
 * @param {Array} baseInl
 * @param {Array} inl
 * @param {object} opts as for `wordDiff`
 * @param {{left: number}|null} budget
 * @param {{maxD?: number}} [limits] the word cap
 */
export function textLinesDiff(baseInl, inl, opts, budget, limits = {}) {
  const aLines = splitLines(baseInl);
  const bLines = splitLines(inl);
  const aText = aLines.map(inlineText);
  const bText = bLines.map(inlineText);
  let stopped = null;
  const done = alignLines(aLines, bLines, aText, bText, opts, budget, (dels, inss) => {
    const entries = [];
    let edits = 0;
    let kept = 0;
    const n = Math.min(dels.length, inss.length);
    for (let k = 0; k < n; k += 1) {
      const words = stopped ? null : wordDiff(aLines[dels[k]], bLines[inss[k]], opts, budget, limits);
      if (words?.reason === 'budget') stopped = 'budget';
      if (words?.segments) {
        // One line's marks, then its break: the line is in this column.
        entries.push({ type: 'eq', inl: [], segments: words.segments });
        edits += words.edits;
        kept += words.kept;
      } else {
        entries.push({ type: 'del', inl: aLines[dels[k]] }, { type: 'ins', inl: bLines[inss[k]] });
        edits += 1;
      }
    }
    for (let k = n; k < dels.length; k += 1) entries.push({ type: 'del', inl: aLines[dels[k]] });
    for (let k = n; k < inss.length; k += 1) entries.push({ type: 'ins', inl: bLines[inss[k]] });
    if (dels.length > n || inss.length > n) edits += 1;
    return { entries, edits, kept };
  });
  if (done.reason) return done;
  if (stopped) return { reason: stopped };
  // A word-diffed line carries its own segments; the rest are one entry each.
  const segments = [];
  const br = { br: 1 };
  const push = (type, inl) => {
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.inl.push(...inl);
    else segments.push({ type, inl: [...inl] });
  };
  done.entries.forEach((entry, i) => {
    const tail = i < done.entries.length - 1 ? [br] : [];
    if (entry.segments) {
      for (const seg of entry.segments) push(seg.type, seg.inl);
      push('eq', tail);
    } else {
      push(entry.type, [...entry.inl, ...tail]);
    }
  });
  return { segments: segments.filter((seg) => seg.inl.length), edits: done.edits, kept: done.kept, total: done.total };
}
