/** Render comparisons of responses, code, images and measurements. */

import { escHtml } from '../neorgon-dom.js';
import { safeImageSrc } from './url.js';
import { emptyFrame } from './markdown.js';
import { formatNumber } from './format.js';
import { lineDiff, splitLines } from './line-diff.js';
import { pick } from './enums.js';
import { COMPARE_KINDS } from '../registry/judgment.js';
export { lineDiff } from './line-diff.js';
export { slopeSvg } from './slope.js';

const TEXTUAL = new Set(['text', 'code', 'log']);
/** Kinds read line by line, so their panels count lines, not words. */
const LINED = new Set(['code', 'log']);

/**
 * The default side names, in one place. The renderer, the registry notes and
 * the old composer each had their own pair ("Before"/"After" against
 * "Response A"/"Response B"), so an unlabelled side read differently depending
 * on which code had touched it.
 */
export const DEFAULT_SIDE_LABELS = Object.freeze(['Before', 'After']);

function sideLabels(block) {
  return [
    String(block.left?.label || DEFAULT_SIDE_LABELS[0]),
    String(block.right?.label || DEFAULT_SIDE_LABELS[1]),
  ];
}

export function compareHtml(block, ctx = {}) {
  const kind = pick(block.kind, COMPARE_KINDS, 'text');
  const mode = ctx.print && ['toggle', 'slider', 'overlay'].includes(block.mode) ? 'side' : block.mode || 'side';

  if (!block.left || !block.right) {
    return emptyFrame('Comparison: it needs a "left" and a "right" side.');
  }

  if ((mode === 'slider' || mode === 'overlay') && kind !== 'image') {
    return emptyFrame(`Comparison: mode "${mode}" wipes between two images. With kind "${kind}" there is nothing to wipe, so use "side" or "toggle".`);
  }

  switch (mode) {
    case 'slider': return slider(block);
    case 'overlay': return overlay(block);
    case 'toggle': return paired(block, kind, 'toggle', ctx);
    case 'side':
    default: return paired(block, kind, 'side', ctx);
  }
}

/* ── Modes ──────────────────────────────────────────────────────────────── */

function paired(block, kind, mode, ctx) {
  const textual = TEXTUAL.has(kind);
  const marked = textual
    ? lineDiff(String(block.left.value ?? ''), String(block.right.value ?? ''))
    : null;
  const interactive = ctx.interactive !== false && !ctx.print;
  const labels = sideLabels(block);
  const highlight = block.highlightChanges !== false;
  const prompt = block.prompt
    ? `<div class="compare__prompt"><span>Shared prompt</span><p>${escHtml(block.prompt)}</p></div>`
    : '';
  const tools = interactive ? `<div class="compare__tools">
    <div class="compare__layouts" role="group" aria-label="Comparison layout">
      <button type="button" data-compare-view="side" aria-pressed="${mode === 'side'}">Side by side</button>
      <button type="button" data-compare-view="toggle" aria-pressed="${mode === 'toggle'}">One at a time</button>
    </div>
    ${textual ? `<button type="button" class="compare__highlight" data-compare-highlight aria-pressed="${highlight}">Highlight changes</button>` : ''}
  </div>` : '';
  const switcher = interactive ? `<div class="compare__switch" role="group" aria-label="Response to show"${mode === 'side' ? ' hidden' : ''}>
    ${labels.map((label, i) => `<button type="button" data-action="compare-toggle" data-side="${i ? 'right' : 'left'}" aria-pressed="${i === 0}">${escHtml(label)}</button>`).join('')}
  </div>` : '';
  return `<div class="compare compare--${mode}" data-kind="${escHtml(kind)}" data-layout="${mode}" data-highlight="${highlight ? 'on' : 'off'}">
    ${prompt}${tools}${switcher}
    <div class="compare__panels">${panel(block.left, labels[0], kind, block, marked?.left, 'left')}${panel(block.right, labels[1], kind, block, marked?.right, 'right', mode === 'toggle')}</div>
    ${marked ? diffSummary(marked) : ''}
  </div>`;
}

/**
 * A wipe between two images.
 *
 * The handle is a real `input[type=range]`, which is the whole trick: arrow
 * keys move it, it announces itself, and a pointer drags it, all without a
 * line of drag handling. A custom drag-only handle would be unusable with a
 * keyboard, which is the usual way this control is built and broken.
 */
function slider(block) {
  const before = safeImageSrc(block.left.src);
  const after = safeImageSrc(block.right.src);
  if (!before || !after) {
    return emptyFrame('Comparison: a wipe needs an image "src" on both sides.');
  }
  const [leftLabel, rightLabel] = sideLabels(block);

  return `<div class="compare compare--slider" style="--wipe: 50%">
    <div class="compare__frame">
      <img class="compare__img compare__img--after" src="${escHtml(after)}" alt="${escHtml(rightLabel)}">
      <img class="compare__img compare__img--before" src="${escHtml(before)}" alt="${escHtml(leftLabel)}">
      <span class="compare__seam" aria-hidden="true"></span>
    </div>
    <label class="compare__control">
      <span class="visually-hidden">Wipe between ${escHtml(leftLabel)} and ${escHtml(rightLabel)}</span>
      <input type="range" min="0" max="100" value="50" step="1"
             data-action="compare-wipe" data-left="${escHtml(leftLabel)}" data-right="${escHtml(rightLabel)}"
             aria-valuetext="50% ${escHtml(leftLabel)} on the left, 50% ${escHtml(rightLabel)} on the right">
    </label>
    <div class="compare__legend"><span>${escHtml(leftLabel)}</span><span>${escHtml(rightLabel)}</span></div>
  </div>`;
}

function overlay(block) {
  const before = safeImageSrc(block.left.src);
  const after = safeImageSrc(block.right.src);
  if (!before || !after) {
    return emptyFrame('Comparison: an overlay needs an image "src" on both sides.');
  }
  const [leftLabel, rightLabel] = sideLabels(block);

  return `<div class="compare compare--overlay" style="--fade: .5">
    <div class="compare__frame">
      <img class="compare__img" src="${escHtml(before)}" alt="${escHtml(leftLabel)}">
      <img class="compare__img compare__img--fade" src="${escHtml(after)}" alt="${escHtml(rightLabel)}">
    </div>
    <label class="compare__control">
      <span class="visually-hidden">Fade from ${escHtml(leftLabel)} to ${escHtml(rightLabel)}</span>
      <input type="range" min="0" max="100" value="50" step="1" data-action="compare-opacity"
             data-left="${escHtml(leftLabel)}" data-right="${escHtml(rightLabel)}"
             aria-valuetext="${escHtml(rightLabel)} at 50% over ${escHtml(leftLabel)}">
    </label>
    <div class="compare__legend"><span>${escHtml(leftLabel)}</span><span>${escHtml(rightLabel)}</span></div>
  </div>`;
}

/* ── Sides ──────────────────────────────────────────────────────────────── */

function panel(sideData, label, kind, block, marks, side, hidden = false) {
  const caption = sideData.caption ? `<p class="compare__caption">${escHtml(sideData.caption)}</p>` : '';
  const text = String(sideData.value ?? '').trim();
  const count = TEXTUAL.has(kind) ? `<span class="compare__length">${lengthLabel(text, kind)}</span>` : '';
  return `<section class="compare__panel compare__face" data-side="${side}" data-label="${escHtml(label)}"${hidden ? ' hidden' : ''}>
    <div class="compare__panel-head"><h4 class="compare__label"><span class="compare__letter" aria-hidden="true">${side === 'left' ? 'A' : 'B'}</span>${escHtml(label)}</h4>${count}</div>
    ${caption}${body(sideData, kind, block, marks)}
  </section>`;
}

function body(sideData, kind, block, marks) {
  if (!sideData) return emptyFrame('Comparison: this side is empty.');

  switch (kind) {
    case 'image': {
      const src = safeImageSrc(sideData.src);
      if (!src) return emptyFrame('Comparison: this side has no image source.');
      return `<img class="compare__img" src="${escHtml(src)}" alt="${escHtml(sideData.label || 'Comparison image')}">`;
    }
    case 'code':
    case 'log':
      return markedPre(sideData.value, marks, block.language);
    case 'text':
      return markedProse(sideData.value, marks);
    case 'metrics':
      return metricsSide(sideData);
    case 'table':
      return tableSide(sideData);
    default:
      return markedProse(sideData.value, marks);
  }
}

function markedPre(value, marks, language) {
  const lines = splitLines(value);
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    return emptyFrame('Comparison: this side has no content.');
  }
  const rows = lines.map((line, i) => {
    const state = marks ? marks[i] || 'same' : 'same';
    return `<span class="compare__line compare__line--${state}">${changeLabel(state)}${escHtml(line) || '&nbsp;'}</span>`;
  }).join('\n');
  const lang = language ? ` data-language="${escHtml(language)}"` : '';
  return `<pre class="compare__code"${lang}><code>${rows}</code></pre>`;
}

function markedProse(value, marks) {
  const lines = splitLines(value);
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    return emptyFrame('Comparison: this side has no content.');
  }
  return `<div class="compare__prose">${lines.map((line, i) => {
    const state = marks ? marks[i] || 'same' : 'same';
    return `<p class="compare__line compare__line--${state}">${changeLabel(state)}${escHtml(line) || '&nbsp;'}</p>`;
  }).join('')}</div>`;
}

/** Raw measurements on each side; headline deltas use the metrics block. */
function metricsSide(sideData) {
  const items = Array.isArray(sideData.items) ? sideData.items : [];
  if (!items.length) return emptyFrame('Comparison: this side has no metric items.');

  const tiles = items.map((m) => {
    if (!m || typeof m !== 'object') return '';
    const unit = m.unit ? `<span class="metric-unit">${escHtml(m.unit)}</span>` : '';
    return `<div class="viz-stat metric-tile">
      <span class="viz-stat__label">${escHtml(m.label || '')}</span>
      <span class="viz-stat__value">${formatNumber(m.value, m.precision)}${unit}</span>
    </div>`;
  }).join('');
  return `<div class="viz-stats compare__metrics">${tiles}</div>`;
}

function tableSide(sideData) {
  const columns = Array.isArray(sideData.columns) ? sideData.columns : [];
  const rows = Array.isArray(sideData.items) ? sideData.items : [];
  if (!rows.length) return emptyFrame('Comparison: this side has no table rows.');

  const head = columns.length
    ? `<thead><tr>${columns.map((c) => `<th scope="col">${escHtml(typeof c === 'string' ? c : (c && c.label) || '')}</th>`).join('')}</tr></thead>`
    : '';
  const bodyRows = rows.map((row) => {
    const cells = Array.isArray(row) ? row : [row];
    return `<tr>${cells.map((cell) => `<td>${escHtml(cell === null || cell === undefined ? '' : String(cell))}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="compare__tablewrap"><table class="compare__table">${head}<tbody>${bodyRows}</tbody></table></div>`;
}

/* ── The line diff ──────────────────────────────────────────────────────── */

/**
 * A longest common subsequence over lines, which is enough for a report.
 *
 * Returns a mark per line for each side: `same`, `removed` on the left and
 * `added` on the right. No dependency, and the quadratic cost is fine for the
 * handful of lines a report shows. Over 400 lines on a side it gives up and
 * marks nothing rather than stalling the render, because a comparison that
 * large is a diff block, not a comparison.
 */

function diffSummary(marked) {
  if (marked.gaveUp) {
    return '<p class="compare__summary">Too many lines to mark the differences. Use a diff block for a change this size.</p>';
  }
  if (!marked.added && !marked.removed) {
    return '<p class="compare__summary">Both responses are identical. No differences to highlight.</p>';
  }
  const bits = [];
  if (marked.removed) bits.push(`${marked.removed} line${marked.removed === 1 ? '' : 's'} gone`);
  if (marked.added) bits.push(`${marked.added} new`);
  return `<p class="compare__summary">${bits.join(', ')}. Highlights show differences, not quality.</p>`;
}


/**
 * The marker is a visible sign plus a word for assistive technology. It used
 * to be `aria-label` on a bare span, which names a generic element: ARIA
 * prohibits that and screen readers announce it inconsistently or not at all.
 */
function changeLabel(state) {
  if (state === 'same') return '';
  const word = state === 'added' ? 'Added: ' : 'Removed: ';
  return `<span class="compare__change" aria-hidden="true">${state === 'added' ? '+' : '\u2212'}</span><span class="visually-hidden">${word}</span>`;
}

/** "12 words" for prose, "3 lines" for code and logs, which are read by line. */
function lengthLabel(text, kind) {
  if (LINED.has(kind)) {
    const lines = text ? text.split(/\r?\n/).length : 0;
    return `${lines} line${lines === 1 ? '' : 's'}`;
  }
  const words = text ? text.split(/\s+/u).length : 0;
  return `${words} word${words === 1 ? '' : 's'}`;
}
