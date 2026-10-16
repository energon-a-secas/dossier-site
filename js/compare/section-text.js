/**
 * What a section says, for the Sections panel when headings alone do not
 * match. DOM-free: node imports it.
 *
 * An agent rewords headings as a matter of course, so a section that is
 * there under another heading read as Missing, and again as "Only in" the
 * other column. Two fallbacks find it, and both are matching, never
 * scoring: the panel shows which sections line up, not how well.
 *
 *   label    a short line printed just above a heading (a slide eyebrow,
 *            "The cost of EOL today" over "201 EOL tickets in 52 Jira
 *            projects") is an alternate name for that heading
 *   wording  the words of a section's body: two sections whose bodies
 *            share at least half their words (Dice) are the same section
 *            under different headings
 *
 * The section texts come from the IR (js/compare/ir.js) and are put on the
 * heading list a column registered, which may come from the page or a
 * frame, by heading text (`withSectionText`).
 */

import { visitUnits } from './ir.js';
import { normHeading } from './align.js';

/** Two section bodies sharing at least this share of their words are one section. */
export const CONTENT_MATCH = 0.5;
/** A body shorter than this says too little to match on. */
export const CONTENT_MIN_WORDS = 15;
/** Only the first words of a body are compared. */
export const BODY_WORDS = 600;
const LABEL_WORDS = 8;
const LABEL_CHARS = 60;
/** How far ahead a registered heading is looked for among the IR's. */
const LOOKAHEAD = 12;

/** Lowercase words, accents and punctuation removed. */
export function wordsOf(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function newBag() {
  return { counts: new Map(), size: 0 };
}

function addWords(bag, text) {
  if (bag.size >= BODY_WORDS) return;
  for (const word of wordsOf(text)) {
    if (bag.size >= BODY_WORDS) return;
    bag.counts.set(word, (bag.counts.get(word) || 0) + 1);
    bag.size += 1;
  }
}

/**
 * Dice similarity of two section bodies' words, 0 to 1. A body under
 * CONTENT_MIN_WORDS scores 0: a line or two in common is not a section.
 *
 * @param {{counts: Map<string, number>, size: number}|null} a
 * @param {{counts: Map<string, number>, size: number}|null} b
 */
export function wordDice(a, b) {
  if (!a || !b || a.size < CONTENT_MIN_WORDS || b.size < CONTENT_MIN_WORDS) return 0;
  const [small, large] = a.counts.size <= b.counts.size ? [a, b] : [b, a];
  let shared = 0;
  for (const [word, n] of small.counts) shared += Math.min(n, large.counts.get(word) || 0);
  return (2 * shared) / (a.size + b.size);
}

/**
 * A short line just above a heading that names it: one paragraph, a few
 * words, no closing punctuation. A line that is the whole body of a sibling
 * or deeper heading before it is that heading's text, not a label; a label
 * right under a higher-level title is fine.
 */
function isLabel(unit, before, level) {
  if (!unit || unit.kind !== 'p') return false;
  const text = String(unit.text || '').trim();
  if (!text || text.length > LABEL_CHARS) return false;
  if (text.split(/\s+/).length > LABEL_WORDS) return false;
  if (/[.!?:;,]$/.test(text)) return false;
  return !(before?.kind === 'h' && (Number(before.level) || 2) >= level);
}

/**
 * Every heading of a block list with its label line and the words of its
 * body: the units after it up to the next heading at its level or above
 * (that heading's own label line left out).
 *
 * @param {Array} blocks
 * @returns {Array<{text: string, level: number, alt: string, words: {counts: Map, size: number}}>}
 */
export function sectionTexts(blocks) {
  const units = [];
  visitUnits(blocks, (unit) => units.push(unit));
  const entries = [];
  units.forEach((unit, at) => {
    if (unit.kind !== 'h') return;
    const level = Number(unit.level) || 2;
    const alt = isLabel(units[at - 1], units[at - 2], level) ? String(units[at - 1].text).trim() : '';
    entries.push({ at, text: String(unit.text || '').trim(), level, alt });
  });
  // A label two headings share ("Appendix") is a category, not a name.
  const seen = new Map();
  for (const e of entries) if (e.alt) seen.set(normHeading(e.alt), (seen.get(normHeading(e.alt)) || 0) + 1);
  for (const e of entries) if (e.alt && seen.get(normHeading(e.alt)) > 1) e.alt = '';
  return entries.map((e, i) => {
    let end = units.length;
    for (let j = i + 1; j < entries.length; j += 1) {
      if (entries[j].level <= e.level) {
        end = entries[j].at - (entries[j].alt ? 1 : 0);
        break;
      }
    }
    const words = newBag();
    for (let k = e.at + 1; k < end && words.size < BODY_WORDS; k += 1) addWords(words, units[k].text);
    return { text: e.text, level: e.level, alt: e.alt, words };
  });
}

/**
 * A registered heading list with each heading's label line (`alt`) and body
 * words (`words`), matched to the IR's headings by their text, in order. A
 * heading the IR does not have (a frame reads a few more) is returned as it
 * was. Neither the list nor its objects are changed: sync owns them.
 *
 * @param {Array<{text: string, level?: number}>} headings
 * @param {Array} blocks the column's IR
 */
export function withSectionText(headings, blocks) {
  const ir = sectionTexts(blocks);
  const keys = ir.map((e) => normHeading(e.text));
  let from = 0;
  return (headings || []).map((h) => {
    const key = normHeading(h.text);
    const stop = Math.min(ir.length, from + LOOKAHEAD);
    for (let k = from; k < stop; k += 1) {
      if (keys[k] === key) {
        from = k + 1;
        return { ...h, alt: ir[k].alt, words: ir[k].words };
      }
    }
    return h;
  });
}
