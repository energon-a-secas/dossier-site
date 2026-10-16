/**
 * Descriptive counts of a column, from its IR. DOM-free: node imports it.
 *
 * These are counts, not judgements: words, reading time, sections, lists,
 * tables, links, figures, code blocks and numbers. Length and formatting are
 * what sway a reader most without being quality, so showing them side by side
 * lets a reviewer notice when "longer" is doing the persuading. Nothing here
 * scores anything, and the stats line says it is descriptive.
 */

import { inlineText, headingsOf, wrapperOf } from './ir.js';

/** Words a minute for the reading time. */
export const READING_WPM = 230;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.,:%-]*/gu;
/** A number as a report states it: digits, with a currency sign or a percent. */
const NUMBER = /[$€£¥]?\d[\d,.:]*(?:\s?%|\s?(?:ms|s|min|h|kb|mb|gb|x)\b)?/giu;

export function countWords(text) {
  return (String(text || '').match(WORD) || []).length;
}

export function countNumbers(text) {
  return (String(text || '').match(NUMBER) || []).length;
}

/**
 * @param {Array} blocks the IR
 * @returns {{words: number, minutes: number, headings: Record<number, number>,
 *   sections: number, paragraphs: number, lists: number, listItems: number,
 *   tables: number, links: number, hosts: string[], figures: number,
 *   code: number, numbers: number}}
 */
export function extract(blocks) {
  const stats = {
    words: 0, minutes: 0, headings: {}, sections: 0, paragraphs: 0, lists: 0, listItems: 0,
    tables: 0, links: 0, hosts: [], figures: 0, code: 0, numbers: 0,
  };
  const hosts = new Set();
  const text = [];

  const runs = (inl) => {
    for (const run of Array.isArray(inl) ? inl : []) {
      const key = wrapperOf(run);
      if (key === 'a' && (run.href || run.local)) {
        stats.links += 1;
        if (run.href) {
          try { hosts.add(new URL(run.href).host); } catch { /* a mailto has no host */ }
        }
      }
      if (key) runs(run[key]);
    }
  };
  const items = (list) => {
    stats.lists += 1;
    for (const item of list.items || []) {
      stats.listItems += 1;
      text.push(inlineText(item.inl));
      runs(item.inl);
      if (item.sub) items(item.sub);
    }
  };
  const visit = (list) => {
    for (const block of Array.isArray(list) ? list : []) {
      if (!block) continue;
      switch (block.t) {
        case 'h':
          stats.headings[block.level] = (stats.headings[block.level] || 0) + 1;
          text.push(inlineText(block.inl));
          runs(block.inl);
          break;
        case 'p':
          stats.paragraphs += 1;
          text.push(inlineText(block.inl));
          runs(block.inl);
          break;
        case 'list':
          items(block);
          break;
        case 'table':
          stats.tables += 1;
          if (block.caption) text.push(inlineText(block.caption));
          for (const row of [...(block.head || []), ...(block.rows || [])]) {
            for (const cell of row) {
              text.push(inlineText(cell.inl));
              runs(cell.inl);
            }
          }
          break;
        case 'pre':
          stats.code += 1;
          text.push(String(block.text || ''));
          break;
        case 'quote':
          visit(block.blocks);
          break;
        case 'fig':
          stats.figures += 1;
          if (block.caption) text.push(block.caption);
          break;
        case 'details':
          text.push(inlineText(block.summary));
          visit(block.blocks);
          break;
        default:
          break;
      }
    }
  };
  visit(blocks);

  const all = text.join('\n');
  stats.words = countWords(all);
  stats.minutes = stats.words ? Math.max(1, Math.round(stats.words / READING_WPM)) : 0;
  stats.numbers = countNumbers(all);
  stats.sections = sectionCount(headingsOf(blocks));
  stats.hosts = [...hosts].sort();
  return stats;
}

/**
 * Sections are the headings one level under the document's title. A report
 * that opens with a single top heading is titled by it, so its sections are
 * the next level down; otherwise the top level is the section level.
 */
export function sectionCount(headings) {
  if (!headings.length) return 0;
  const top = Math.min(...headings.map((h) => h.level));
  const atTop = headings.filter((h) => h.level === top);
  if (atTop.length === 1 && headings[0].level === top && headings.length > 1) {
    const below = headings.filter((h) => h.level > top);
    if (!below.length) return 0;
    const next = Math.min(...below.map((h) => h.level));
    return below.filter((h) => h.level === next).length;
  }
  return atTop.length;
}

/** "1 table", "2 tables". */
function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

const MINUS = '−';

function delta(value, base) {
  if (!Number.isFinite(base)) return '';
  const d = value - base;
  if (!d) return '';
  return d > 0 ? `+${d}` : `${MINUS}${Math.abs(d)}`;
}

/**
 * The stats line, as items the view lays out: `{value, label, delta}`, where
 * `delta` is "+1", a real minus sign and a number, or empty. Counts that are
 * zero in this column and in the base are left out, so a column of prose is
 * not padded with "0 tables, 0 figures".
 *
 * @param {object} stats from `extract`
 * @param {object|null} [base] the base column's stats, for the deltas
 */
export function statsItems(stats, base = null) {
  if (!stats) return [];
  const items = [];
  const add = (key, one, many, always = false) => {
    const value = stats[key] || 0;
    const baseValue = base ? base[key] || 0 : null;
    if (!always && !value && !baseValue) return;
    const words = plural(value, one, many).split(' ').slice(1).join(' ');
    items.push({ key, value, label: words, delta: base ? delta(value, baseValue) : '' });
  };
  add('words', 'word', 'words', true);
  items.push({ key: 'minutes', value: stats.minutes || 0, label: 'min', delta: '' });
  add('sections', 'section', 'sections', true);
  add('tables', 'table', 'tables');
  add('figures', 'figure', 'figures');
  add('listItems', 'list item', 'list items');
  add('links', 'link', 'links');
  add('code', 'code block', 'code blocks');
  add('numbers', 'number', 'numbers');
  return items;
}

/** The stats line as one sentence, for a screen reader or a copied review. */
export function statsSentence(stats, base = null) {
  return statsItems(stats, base)
    .map((item) => `${item.value} ${item.label}${item.delta ? ` (${item.delta})` : ''}`)
    .join(', ');
}
