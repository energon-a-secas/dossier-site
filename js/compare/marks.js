/**
 * Difference marks for one column, as the `marks` function the IR renderer
 * (js/compare/ir-render.js) calls for each unit. DOM-free: node imports it.
 *
 * Marks are tracked changes against the base column, with three cues each
 * and colour last (design spec 3.3 and 7.3.6):
 *
 *   changed unit  a single revision bar and "~" in the gutter, a neutral
 *                 tint, hidden "Changed paragraph:", and inside it the
 *                 inserted words (`ins`, underlined) and removed base words
 *                 (`del`, struck, hidden by "Show removed words" off)
 *   added unit    a double bar and "+", a blue-grey tint, a visible "Added"
 *   removed run   a ghost row, dashed, collapsed to one line: "Removed from
 *                 B: Contributing factors, 19 words", with Show to expand
 *
 * A column too different from the base for word marks to help gets margin
 * bars only (`bars`): no tints, no word marks, no labels.
 *
 * Each mark carries `data-chg` (its number in the column, from 1) and
 * `data-d` (chg, add, del), which the change ruler, the counter and the
 * previous and next buttons read. Every string from a report is escaped
 * here or by `renderInline`.
 */

import { escHtml } from '../neorgon-dom.js';
import { renderInline } from './ir-render.js';
import { describeRemoved } from './diff.js';

const KIND_WORDS = { h: 'heading', p: 'paragraph', li: 'list item', tr: 'table row', pre: 'code block' };

const hidden = (text) => `<span class="visually-hidden u-sr">${escHtml(text)}</span>`;

/** Word segments to markup: unchanged words plain, `ins` and `del` marked. */
export function segmentsHtml(segments, colId) {
  return (segments || []).map((seg) => {
    const html = renderInline(seg.inl, colId);
    if (seg.type === 'ins') return `<ins><span class="visually-hidden">inserted: </span>${html}</ins>`;
    if (seg.type === 'del') return `<del><span class="visually-hidden">deleted: </span>${html}</del>`;
    return html;
  }).join('');
}

/** The ghost row of a run of removed base units, in the container it stands in. */
function ghostHtml(run, number, { baseUnits, baseRef, container, cells }) {
  const info = describeRemoved(baseUnits, run.units);
  const words = `${info.words} word${info.words === 1 ? '' : 's'}`;
  const full = run.units.map((i) => baseUnits[i]).filter(Boolean)
    .map((u) => `<p class="ghost__unit${u.kind === 'h' ? ' ghost__unit--h' : ''}"><del><span class="visually-hidden">deleted: </span>${escHtml(u.text.trim())}</del></p>`)
    .join('');
  const body = `<span class="ghost__what"><b>Removed from ${escHtml(baseRef)}:</b> ${escHtml(info.what)}, ${words}</span>`
    + `<span class="ghost__prev" aria-hidden="true"><del>${escHtml(info.preview)}</del></span>`
    + '<button type="button" class="btn btn--quiet btn--xs ghost__show" data-action="cmp-ghost" aria-expanded="false">Show</button>'
    + `<div class="ghost__full" hidden>${full}</div>`;
  const attrs = ` data-chg="${number}" data-d="del"`;
  if (container === 'li') return `<li class="ghost"${attrs}>${body}</li>`;
  if (container === 'tr') return `<tr class="ghost-row"${attrs}><td colspan="${Math.max(1, cells)}"><div class="ghost">${body}</div></td></tr>`;
  return `<div class="ghost"${attrs}>${body}</div>`;
}

/**
 * The marks function for a column.
 *
 * @param {object} result from js/compare/diff.js `diffBlocks`
 * @param {{colId: string, baseRef: string, bars?: boolean}} opts
 *   `bars`: margin bars only, for a column too different to mark word by word
 * @returns {(unit: {kind: string, node: unknown, head?: boolean}, index: number) => object|null}
 */
export function columnMarks(result, { colId, baseRef, bars = false }) {
  const numberOfUnit = new Map();
  const numberOfRemoved = new Map();
  result.changes.forEach((change, i) => {
    if (change.kind === 'del') numberOfRemoved.set(change.removed, i + 1);
    else numberOfUnit.set(change.unit, i + 1);
  });
  const removedAt = new Map();
  result.removed.forEach((run, i) => removedAt.set(run.at, i));
  const last = result.units.length - 1;

  return (unit, index) => {
    const cells = Array.isArray(unit.node) ? unit.node.reduce((n, cell) => n + Math.max(1, cell?.colspan | 0 || 1), 0) : 1;
    const container = unit.kind === 'li' ? 'li' : unit.kind === 'tr' ? 'tr' : 'block';
    const ghost = (runIndex) => (runIndex === undefined ? ''
      : ghostHtml(result.removed[runIndex], numberOfRemoved.get(runIndex), {
        baseUnits: result.baseUnits, baseRef, container, cells,
      }));
    const before = ghost(removedAt.get(index));
    const after = index === last ? ghost(removedAt.get(index + 1)) : '';
    const slot = result.units[index];
    const number = numberOfUnit.get(index);
    const mark = { before, after };
    if (!slot || !number) return before || after ? mark : null;

    const kindWord = KIND_WORDS[unit.kind] || 'paragraph';
    mark.attrs = ` data-chg="${number}" data-d="${slot.state === 'added' ? 'add' : 'chg'}"`;
    if (slot.state === 'added') {
      mark.cls = bars ? 'unit u-bar-add' : 'unit u-added';
      if (unit.kind === 'tr' || bars) mark.prefix = hidden(`Added ${kindWord}: `);
      else mark.prefix = `<span class="u-label">Added</span>${hidden(': ')}`;
      return mark;
    }
    mark.cls = bars ? 'unit u-bar-chg' : 'unit u-changed';
    mark.prefix = hidden(`Changed ${kindWord}: `);
    if (bars) return mark;
    if (unit.kind === 'tr' && slot.cells) {
      mark.cells = slot.cells.map((segs) => (segs ? segmentsHtml(segs, colId) : null));
    } else if (slot.words) {
      mark.inner = segmentsHtml(slot.words, colId);
    }
    return mark;
  };
}

/** "9 differences from B" with the parts behind it: "4 changed, 3 added, 2 removed". */
export function countsSentence(counts) {
  const parts = [];
  if (counts.changed) parts.push(`${counts.changed} changed`);
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  return parts.join(', ') || 'no differences';
}
