/**
 * Before and after: the one visual primitive the fleet does not already own.
 *
 * The Viz Kit has thirteen builders and not one of them renders two things
 * next to each other, which is the most common shape in a report about a fix:
 * it was like this, now it is like that. So this module is the reason the site
 * exists, and `slopeSvg` is written to the kit's conventions so it can be
 * contributed upstream once its shape has survived real use.
 *
 * Four modes, and the choice is about what the reader has to do:
 *   side     read both at once, which is right for text, code and numbers
 *   slider   wipe between two images, for a visual change in one place
 *   overlay  fade between two images, for alignment and drift
 *   toggle   flip between them, which beats side by side when each is wide
 *
 * For text, code and logs the differing lines are marked. A diff the reader
 * has to find themselves is two blocks of text, not a comparison.
 */

import { escHtml } from '../neorgon-dom.js';
import { safeImageSrc } from './url.js';
import { emptyFrame } from './markdown.js';
import { formatNumber } from './format.js';

const TEXTUAL = new Set(['text', 'code', 'log']);

export function compareHtml(block, ctx = {}) {
  const kind = block.kind || 'text';
  const mode = block.mode || 'side';

  if (!block.left || !block.right) {
    return emptyFrame('Comparison: it needs a "left" and a "right" side.');
  }

  if ((mode === 'slider' || mode === 'overlay') && kind !== 'image') {
    return emptyFrame(`Comparison: mode "${mode}" wipes between two images. With kind "${kind}" there is nothing to wipe, so use "side" or "toggle".`);
  }

  switch (mode) {
    case 'slider': return slider(block);
    case 'overlay': return overlay(block);
    case 'toggle': return toggle(block, kind);
    case 'side':
    default: return side(block, kind);
  }
}

/* ── Modes ──────────────────────────────────────────────────────────────── */

function side(block, kind) {
  const marked = TEXTUAL.has(kind) && block.highlightChanges !== false
    ? lineDiff(String(block.left.value || ''), String(block.right.value || ''))
    : null;

  const left = panel(block.left, 'Before', kind, block, marked && marked.left);
  const right = panel(block.right, 'After', kind, block, marked && marked.right);
  const summary = marked ? diffSummary(marked) : '';

  return `<div class="compare compare--side" data-kind="${escHtml(kind)}">${left}${right}</div>${summary}`;
}

function toggle(block, kind) {
  const leftLabel = block.left.label || 'Before';
  const rightLabel = block.right.label || 'After';
  const marked = TEXTUAL.has(kind) && block.highlightChanges !== false
    ? lineDiff(String(block.left.value || ''), String(block.right.value || ''))
    : null;

  return `<div class="compare compare--toggle" data-kind="${escHtml(kind)}">
    <div class="compare__switch" role="group" aria-label="Which side to show">
      <button type="button" data-action="compare-toggle" data-side="left" aria-pressed="true">${escHtml(leftLabel)}</button>
      <button type="button" data-action="compare-toggle" data-side="right" aria-pressed="false">${escHtml(rightLabel)}</button>
    </div>
    <div class="compare__face" data-side="left">${body(block.left, kind, block, marked && marked.left)}</div>
    <div class="compare__face" data-side="right" hidden>${body(block.right, kind, block, marked && marked.right)}</div>
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
  const leftLabel = block.left.label || 'Before';
  const rightLabel = block.right.label || 'After';

  return `<div class="compare compare--slider" style="--wipe: 50%">
    <div class="compare__frame">
      <img class="compare__img compare__img--after" src="${escHtml(after)}" alt="${escHtml(rightLabel)}">
      <img class="compare__img compare__img--before" src="${escHtml(before)}" alt="${escHtml(leftLabel)}">
      <span class="compare__seam" aria-hidden="true"></span>
    </div>
    <label class="compare__control">
      <span class="visually-hidden">Wipe between ${escHtml(leftLabel)} and ${escHtml(rightLabel)}</span>
      <input type="range" min="0" max="100" value="50" step="1"
             data-action="compare-wipe"
             aria-valuetext="${escHtml(leftLabel)} on the left, ${escHtml(rightLabel)} on the right">
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
  const leftLabel = block.left.label || 'Before';
  const rightLabel = block.right.label || 'After';

  return `<div class="compare compare--overlay" style="--fade: .5">
    <div class="compare__frame">
      <img class="compare__img" src="${escHtml(before)}" alt="${escHtml(leftLabel)}">
      <img class="compare__img compare__img--fade" src="${escHtml(after)}" alt="${escHtml(rightLabel)}">
    </div>
    <label class="compare__control">
      <span class="visually-hidden">Fade from ${escHtml(leftLabel)} to ${escHtml(rightLabel)}</span>
      <input type="range" min="0" max="100" value="50" step="1" data-action="compare-opacity">
    </label>
    <div class="compare__legend"><span>${escHtml(leftLabel)}</span><span>${escHtml(rightLabel)}</span></div>
  </div>`;
}

/* ── Sides ──────────────────────────────────────────────────────────────── */

function panel(sideData, fallbackLabel, kind, block, marks) {
  const label = sideData.label || fallbackLabel;
  return `<section class="compare__panel">
    <h4 class="compare__label">${escHtml(label)}</h4>
    ${body(sideData, kind, block, marks)}
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
  const lines = String(value || '').split('\n');
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    return emptyFrame('Comparison: this side has no content.');
  }
  const rows = lines.map((line, i) => {
    const state = marks ? marks[i] || 'same' : 'same';
    return `<span class="compare__line compare__line--${state}">${escHtml(line) || '&nbsp;'}</span>`;
  }).join('\n');
  const lang = language ? ` data-language="${escHtml(language)}"` : '';
  return `<pre class="compare__code"${lang}><code>${rows}</code></pre>`;
}

function markedProse(value, marks) {
  const lines = String(value || '').split('\n');
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    return emptyFrame('Comparison: this side has no content.');
  }
  return `<div class="compare__prose">${lines.map((line, i) => {
    const state = marks ? marks[i] || 'same' : 'same';
    return `<p class="compare__line compare__line--${state}">${escHtml(line) || '&nbsp;'}</p>`;
  }).join('')}</div>`;
}

/**
 * Metric tiles on both sides, with the change between them derived here
 * rather than asked for. `better` is honoured, so a latency drop reads as an
 * improvement and a throughput drop does not.
 */
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
export function lineDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const LIMIT = 400;
  if (a.length > LIMIT || b.length > LIMIT) {
    return { left: null, right: null, added: 0, removed: 0, gaveUp: true };
  }

  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const left = new Array(a.length).fill('same');
  const right = new Array(b.length).fill('same');
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    if (table[i + 1][j] >= table[i][j + 1]) {
      left[i] = 'removed'; removed += 1; i += 1;
    } else {
      right[j] = 'added'; added += 1; j += 1;
    }
  }
  while (i < a.length) { left[i] = 'removed'; removed += 1; i += 1; }
  while (j < b.length) { right[j] = 'added'; added += 1; j += 1; }

  return { left, right, added, removed, gaveUp: false };
}

function diffSummary(marked) {
  if (marked.gaveUp) {
    return '<p class="compare__summary">Too many lines to mark the differences. Use a diff block for a change this size.</p>';
  }
  if (!marked.added && !marked.removed) {
    return '<p class="compare__summary">Both sides are identical, so this block shows a change that did not happen.</p>';
  }
  const bits = [];
  if (marked.removed) bits.push(`${marked.removed} line${marked.removed === 1 ? '' : 's'} gone`);
  if (marked.added) bits.push(`${marked.added} new`);
  return `<p class="compare__summary">${bits.join(', ')}</p>`;
}

/* ── The slope chart ────────────────────────────────────────────────────── */

/**
 * A before and after dumbbell, one row per label.
 *
 * Written to the Viz Kit's conventions so moving it into
 * packages/neorgon-ui/js/viz.js is a copy: a string in, a string out, a stable
 * `uid`, a `<title>` on every point, `--viz-*` tokens only, and nothing
 * animated unless asked.
 *
 * The first version divided every value by 100, so any measurement that was
 * not a percentage drew off the end of the plot.
 */
export function slopeSvg(pairs, opts = {}) {
  const rows = (Array.isArray(pairs) ? pairs : []).filter(
    (p) => p && Number.isFinite(Number(p.before)) && Number.isFinite(Number(p.after)),
  );
  const width = opts.width || 520;
  const rowHeight = 34;
  const height = opts.height || Math.max(72, rows.length * rowHeight + 24);
  const uid = opts.uid || 'slope';

  if (!rows.length) {
    return frame(
      `<div class="viz-empty">No before and after pairs to plot</div>`,
      opts,
    );
  }

  const labelWidth = opts.labelWidth || 150;
  const padRight = 56;
  const plot = width - labelWidth - padRight;

  const values = rows.flatMap((p) => [Number(p.before), Number(p.after)]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const span = max - min || 1;
  const xAt = (v) => labelWidth + ((Number(v) - min) / span) * plot;

  const colorBefore = 'var(--viz-ink-mute, #8b94a7)';
  const colorAfter = 'var(--viz-accent-bright, #0080ff)';

  const marks = rows.map((p, i) => {
    const y = 16 + i * rowHeight;
    const x1 = xAt(p.before);
    const x2 = xAt(p.after);
    const label = escHtml(String(p.label || ''));
    const unit = p.unit ? ` ${escHtml(p.unit)}` : '';
    return `
      <text class="viz-label" x="0" y="${(y + 4).toFixed(1)}">${label}</text>
      <line class="viz-line" x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${colorBefore}" stroke-width="1.4"/>
      <circle class="viz-dot" cx="${x1.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${colorBefore}"><title>${label}: before ${escHtml(formatNumber(p.before))}${unit}</title></circle>
      <circle class="viz-dot" cx="${x2.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${colorAfter}"><title>${label}: after ${escHtml(formatNumber(p.after))}${unit}</title></circle>
      <text class="viz-value-label" x="${(width - padRight + 8).toFixed(1)}" y="${(y + 4).toFixed(1)}">${escHtml(formatNumber(p.after))}</text>`;
  }).join('');

  const svg = `<svg class="viz-svg" viewBox="0 0 ${width} ${height}" role="img"
    aria-label="${escHtml(opts.ariaLabel || opts.title || 'Before and after')}" data-uid="${escHtml(uid)}">${marks}
  </svg>`;

  return frame(svg, opts);
}

/** The Viz Kit's panel wrapper, reproduced so this module can move as-is. */
function frame(bodyHtml, opts = {}) {
  if (opts.frame === false) return bodyHtml;
  const head = opts.title || opts.scale
    ? `<div class="viz-head"><span class="viz-title">${escHtml(opts.title || '')}</span><span class="viz-scale">${escHtml(opts.scale || '')}</span></div>`
    : '';
  return `<div class="viz-panel">${head}${bodyHtml}</div>`;
}
