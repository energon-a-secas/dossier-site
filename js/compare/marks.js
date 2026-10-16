/**
 * Difference marks for one column, as the `marks` function the IR renderer
 * (js/compare/ir-render.js) calls for each unit. DOM-free: node imports it.
 *
 * Marks are tracked changes against the column's reference, with three cues
 * each and colour last (design spec 3.3 and 7.3.6):
 *
 *   changed unit  a single revision bar and "~" in the gutter, a neutral
 *                 tint, hidden "Changed paragraph:", and inside it the
 *                 inserted words (`ins`, underlined) and removed base words
 *                 (`del`, struck, hidden by "Show removed words" off). One
 *                 that could not be marked word by word says why, visibly
 *   added unit    a double bar and "+", a blue-grey tint, a visible "Added"
 *   removed run   a ghost row, dashed, collapsed to one line: "Removed from
 *                 B: Contributing factors, 19 words", with Show to expand
 *   moved part    a dotted bar and an arrow in the gutter at its start, and
 *                 "Moved from after “Root cause” in B"; inside it, word
 *                 marks against where it came from
 *
 * A column too different from the base for word marks to help gets margin
 * bars only (`bars`): no tints, no labels, and no word marks except the
 * numbers that changed (js/compare/numbers.js), which stay marked.
 *
 * A table's header row never holds hidden text in its cells, which would
 * become every column header's name: its label (`label`) and any ghost
 * stand before the table (js/compare/ir-render.js).
 *
 * Each mark carries `data-chg` (its number in the column, from 1) and
 * `data-d` (chg, add, del, mov), which the change ruler, the counter and the
 * previous and next buttons read. Every string from a report is escaped
 * here or by `renderInline`.
 */

import { escHtml } from '../neorgon-dom.js';
import { renderInline } from './ir-render.js';
import { describeRemoved } from './diff.js';
import { numberMarks } from './numbers.js';

const KIND_WORDS = { h: 'heading', p: 'paragraph', li: 'list item', tr: 'table row', pre: 'code block' };
/** What a changed unit left without word marks says, visibly. */
const UNMARKED_WORDS = {
  cap: 'Changed: too many edits to mark word by word',
  budget: 'Changed: too many edits to mark word by word',
  cells: 'Changed: its cells do not line up to mark word by word',
  code: 'Changed code block',
};

const hidden = (text) => `<span class="visually-hidden u-sr">${escHtml(text)}</span>`;

/**
 * The base column's name inside a column's text. Blind or a move renames the
 * base without changing a mark, so js/compare/analysis.js renames these in
 * place rather than draw the column again, which lost its scroll position
 * and focus.
 *
 * @param {string} ref
 */
export function baseName(ref) {
  return `<span data-base-ref>${escHtml(ref)}</span>`;
}

/** Word segments to markup: unchanged words plain, `ins` and `del` marked. */
function segmentsHtml(segments, colId) {
  return (segments || []).map((seg) => {
    const html = renderInline(seg.inl, colId);
    if (seg.type === 'ins') return `<ins><span class="visually-hidden">inserted: </span>${html}</ins>`;
    if (seg.type === 'del') return `<del><span class="visually-hidden">deleted: </span>${html}</del>`;
    return html;
  }).join('');
}

/**
 * Word segments with only the kept ones marked (a changed number in a
 * column shown with margin bars): other insertions read as plain text and
 * other removals are left out, so the unit reads as its own text.
 */
function numbersOnlyHtml(segments, keep, colId) {
  const parts = [];
  let dropped = false;
  segments.forEach((seg, i) => {
    if (seg.type === 'del' && !keep.has(i)) {
      dropped = true;
      return;
    }
    const text = seg.inl;
    const plain = renderInline(text, colId);
    // The space a dropped removal left would sit before punctuation or
    // next to another space.
    if (dropped && seg.type === 'eq' && plain === ' ') {
      const next = segments[i + 1];
      const nextText = next ? renderInline(next.inl, colId) : '';
      const prev = parts[parts.length - 1] || '';
      if (/\s$/.test(prev) || /^[,.;:)%]/.test(nextText) || !prev) {
        dropped = false;
        return;
      }
    }
    dropped = false;
    if (!keep.has(i) || seg.type === 'eq') parts.push(plain);
    else if (seg.type === 'ins') parts.push(`<ins><span class="visually-hidden">inserted: </span>${plain}</ins>`);
    else parts.push(`<del><span class="visually-hidden">deleted: </span>${plain}</del>`);
  });
  return parts.join('');
}

/** "moved from after “Root cause” in B", the base named so Blind can rename it. */
function movedFrom(move, baseRef) {
  const where = baseName(baseRef);
  if (!move.after) return `moved from the start of ${where}`;
  const raw = move.after.length > 60 ? `${move.after.slice(0, 59).trimEnd()}\u2026` : move.after;
  const quoted = `\u201c${escHtml(raw)}\u201d`;
  return move.section ? `moved from after ${quoted} in ${where}` : `moved from ${quoted} in ${where}`;
}

/** The ghost row of a run of removed base units, in the container it stands in. */
function ghostHtml(run, number, { baseUnits, baseRef, container, cells }) {
  const info = describeRemoved(baseUnits, run.units);
  const words = `${info.words} word${info.words === 1 ? '' : 's'}`;
  const full = run.units.map((i) => baseUnits[i]).filter(Boolean)
    .map((u) => `<p class="ghost__unit${u.kind === 'h' ? ' ghost__unit--h' : ''}"><del><span class="visually-hidden">deleted: </span>${escHtml(u.text.trim())}</del></p>`)
    .join('');
  const body = `<span class="ghost__what"><b>Removed from ${baseName(baseRef)}:</b> ${escHtml(info.what)}, ${words}</span>`
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
  const moves = result.moves || [];
  const keep = bars ? numberMarks(result) : null;

  /** Word marks of a changed unit, or only its changed numbers with bars. */
  const wordMarks = (mark, slot, index, kind) => {
    const k = keep ? keep.get(index) : null;
    if (bars && !k) return;
    if (kind === 'tr' && slot.cells) {
      mark.cells = slot.cells.map((segs, c) => {
        if (!segs) return null;
        if (!bars) return segmentsHtml(segs, colId);
        return k.cells?.get(c) ? numbersOnlyHtml(segs, k.cells.get(c), colId) : null;
      });
    } else if (slot.words && (!bars || k.words)) {
      const html = bars ? numbersOnlyHtml(slot.words, k.words, colId) : segmentsHtml(slot.words, colId);
      mark.inner = kind === 'pre' ? `<code>${html}</code>` : html;
    }
  };

  return (unit, index) => {
    const head = unit.kind === 'tr' && unit.head === true;
    const cells = Array.isArray(unit.node) ? unit.node.reduce((n, cell) => n + Math.max(1, cell?.colspan | 0 || 1), 0) : 1;
    const container = unit.kind === 'li' ? 'li' : unit.kind === 'tr' && !head ? 'tr' : 'block';
    const ghost = (runIndex) => (runIndex === undefined ? ''
      : ghostHtml(result.removed[runIndex], numberOfRemoved.get(runIndex), {
        baseUnits: result.baseUnits, baseRef, container, cells,
      }));
    const before = ghost(removedAt.get(index));
    const after = index === last ? ghost(removedAt.get(index + 1)) : '';
    const slot = result.units[index];
    const mark = { before, after };
    // A header row's hidden words go before the table, never into a header cell.
    const lead = (html) => {
      if (head) mark.label = html;
      else mark.prefix = html;
    };
    const kindWord = head ? 'table header row' : KIND_WORDS[unit.kind] || 'paragraph';
    const move = slot && slot.move !== undefined ? moves[slot.move] : null;
    if (move && move.units[0] === index) {
      mark.attrs = ` data-chg="${numberOfUnit.get(index)}" data-d="mov"`;
      mark.cls = bars ? 'unit u-bar-mov u-move-start' : 'unit u-moved u-move-start';
      const from = movedFrom(move, baseRef);
      if (unit.kind === 'tr' || bars) lead(`${hidden(`Moved ${kindWord}: `)}<span class="visually-hidden">${from}. </span>`);
      else lead(`<span class="u-label u-label--moved">M${from.slice(1)}</span>${hidden(': ')}`);
      if (slot.state === 'changed') wordMarks(mark, slot, index, unit.kind);
      return mark;
    }
    const number = numberOfUnit.get(index);
    if (!slot || !number) {
      if (move && slot.state === 'same') {
        mark.cls = bars ? 'unit u-bar-mov' : 'unit u-moved';
        return mark;
      }
      return before || after ? mark : null;
    }

    mark.attrs = ` data-chg="${number}" data-d="${slot.state === 'added' ? 'add' : 'chg'}"`;
    if (slot.state === 'added') {
      mark.cls = bars ? 'unit u-bar-add' : 'unit u-added';
      if (unit.kind === 'tr' || bars) lead(hidden(`Added ${kindWord}: `));
      else lead(`<span class="u-label">Added</span>${hidden(': ')}`);
      return mark;
    }
    mark.cls = bars ? 'unit u-bar-chg' : 'unit u-changed';
    const reason = slot.unmarked || (unit.kind === 'tr' && !slot.cells ? 'cells' : null);
    if (reason && !bars) lead(`<span class="u-label u-label--changed">${UNMARKED_WORDS[reason] || UNMARKED_WORDS.cap}</span>${hidden(`, ${kindWord}: `)}`);
    else lead(hidden(`Changed ${kindWord}: `));
    wordMarks(mark, slot, index, unit.kind);
    return mark;
  };
}

/** "9 differences from B" with the parts behind it: "4 changed, 3 added, 2 removed". */
export function countsSentence(counts) {
  const parts = [];
  if (counts.changed) parts.push(`${counts.changed} changed`);
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  if (counts.moved) parts.push(`${counts.moved} moved`);
  return parts.join(', ') || 'no differences';
}
