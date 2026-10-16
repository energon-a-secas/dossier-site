/**
 * A trend chart's plot (chart forms `line` and `area`), drawn here rather
 * than by the Viz Kit's `line`.
 *
 * The kit draws into a viewBox scaled with the column's width, so the plot
 * grew to 353 px tall in a wide report, its tick text ranged from 10.5 to
 * 13.4 px with the width, and a value label drawn inside it would scale the
 * same way. Here only the lines are SVG, stretched to a fixed-height box with
 * `preserveAspectRatio="none"` and a stroke that does not scale; every piece
 * of text (ticks, values, the x labels, a reference's label) is HTML placed
 * by percentage, so it stays 13 px at every width and the x labels sit under
 * their points.
 *
 * The y axis keeps its zero baseline: a tool that sets a human's report
 * beside an agent's must not make a gap look larger than it is. A missing
 * value is a gap in the line, not a false 0 (the data table says "Not
 * recorded"), and `reference` draws the dashed line the format promises.
 *
 * DOM-free: node imports it, and the tests read its markup.
 */

import { escHtml } from '../neorgon-dom.js';
import { formatNumber } from './format.js';
import { chartColor } from './chart-data.js';

/** Value labels on every point only while they fit: few points, one or two series. */
const LABEL_EVERY_POINT = { points: 8, series: 2 };
/** End labels closer than this, in percent of the plot's height, are pushed apart. */
const END_GAP = 9;
/** X labels shown on a narrow sheet: about this many, the last always. */
const X_LABELS = 6;

const pct = (value) => `${Number(value.toFixed(3))}%`;

/** The smallest of 1, 2, 2.5, 5 and 10 times a power of ten at or above `value`. */
function niceCeil(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= value - power * 1e-9) return step * power;
  }
  return 10 * power;
}

function measured(raw) {
  return raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

/**
 * @param {object} block the chart block
 * @param {Array<{label?: string, values?: Array}>} series
 * @param {string[]} labels one per point
 * @param {{area?: boolean, uid?: string}} [opts] uid prefixes the gradient ids
 * @returns {string} the `.trend-plot` markup
 */
export function trendPlot(block, series, labels, { area = false, uid = 'c-chart' } = {}) {
  const n = labels.length;
  const colors = series.map((s, i) => chartColor(s, i));
  const vals = series.map((s) => labels.map((_, i) => measured(Array.isArray(s.values) ? s.values[i] : null)));
  const finite = vals.flat().filter((v) => v !== null);
  const ref = block.reference && typeof block.reference === 'object' ? measured(block.reference.value) : null;
  const extra = ref === null ? [] : [ref];

  const lo = Math.min(0, ...finite, ...extra);
  const top = Math.max(...finite, ...extra, lo + 1e-9);
  const max = Number(block.max);
  const hi = max > 0 ? Math.max(max, top) : niceCeil(top);
  const x = (i) => (n === 1 ? 50 : 3 + (i * 94) / (n - 1));
  const y = (v) => ((hi - v) / (hi - lo || 1)) * 100;

  const ticks = [hi, (lo + hi) / 2, lo];
  if (lo < 0) ticks.push(0);
  const tickText = ticks.map((t) => formatNumber(t));
  const widest = tickText.reduce((a, b) => (b.length > a.length ? b : a), '');

  const everyPoint = n <= LABEL_EVERY_POINT.points && series.length <= LABEL_EVERY_POINT.series;
  const k = series.length;
  const title = block.title || 'Trend';

  const yAxis = `<div class="trend-y" aria-hidden="true"><span class="trend-y__sizer">${escHtml(widest)}</span>${
    ticks.map((t, i) => `<span style="top:${pct(y(t))}">${escHtml(tickText[i])}</span>`).join('')}</div>`;
  const grid = ticks.map((t) => `<span class="trend-grid" style="top:${pct(y(t))}"></span>`).join('');

  const defs = [];
  const shapes = [];
  vals.forEach((values, si) => {
    const color = escHtml(colors[si]);
    if (area) {
      const id = `${uid}-area-${si}`;
      defs.push(`<linearGradient id="${escHtml(id)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:${color};stop-opacity:.3"/><stop offset="100%" style="stop-color:${color};stop-opacity:0"/></linearGradient>`);
      for (const run of runsOf(values)) {
        if (run.length < 2) continue;
        const d = run.map((i, j) => `${j ? 'L' : 'M'}${x(i).toFixed(3)} ${y(values[i]).toFixed(3)}`).join(' ');
        shapes.push(`<path class="trend-fill" d="${d} L${x(run.at(-1)).toFixed(3)} ${y(lo).toFixed(3)} L${x(run[0]).toFixed(3)} ${y(lo).toFixed(3)} Z" fill="url(#${escHtml(id)})"/>`);
      }
    }
    const d = runsOf(values).map((run) => run.map((i, j) => `${j ? 'L' : 'M'}${x(i).toFixed(3)} ${y(values[i]).toFixed(3)}`).join(' ')).join(' ');
    if (d) shapes.push(`<path class="viz-line" d="${d}" style="stroke:${color}"/>`);
  });
  const svg = `<svg class="trend-svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${escHtml(`${title}: ${k} series over ${n} points. The values are in the table below.`)}">${
    defs.length ? `<defs>${defs.join('')}</defs>` : ''}${shapes.join('')}</svg>`;

  const marks = [];
  if (ref !== null) {
    const words = `${block.reference.label || 'target'} ${formatNumber(ref)}`;
    marks.push(`<span class="trend-ref" style="top:${pct(y(ref))}"><span>${escHtml(words)}</span></span>`);
  }
  vals.forEach((values, si) => values.forEach((v, i) => {
    if (v === null) return;
    marks.push(`<span class="trend-dot" style="left:${pct(x(i))};top:${pct(y(v))};background:${escHtml(colors[si])}"></span>`);
  }));
  if (everyPoint) marks.push(...valueLabels(vals, n, x, y));
  else marks.push(...endLabels(vals, colors, y));

  const xLabels = labels.map((label, i) => {
    const minor = n > X_LABELS && i !== n - 1 && (i % Math.ceil(n / X_LABELS) !== 0 || n - 1 - i < Math.ceil(n / X_LABELS));
    // Classed, so Dossier format (js/compare/normalize-inline.js) reads the
    // row as separate labels ("Run 1 · Run 2"), not one glued word.
    return `<span class="trend-x__label${minor ? ' trend-x__minor' : ''}" style="left:${pct(x(i))}">${escHtml(label)}</span>`;
  }).join('');

  return `<div class="trend-plot ${everyPoint ? 'trend-plot--values' : 'trend-plot--ends'}">${yAxis}`
    + `<div class="trend-area">${grid}${svg}<div class="trend-marks" aria-hidden="true">${marks.join('')}</div></div>`
    + `<div class="chart-x-labels trend-x">${xLabels}</div></div>`;
}

/** Runs of consecutive measured indexes: the line lifts its pen at a gap. */
function runsOf(values) {
  const runs = [];
  let run = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push(i);
    }
  });
  if (run.length) runs.push(run);
  return runs;
}

/** A value over each point: the higher of two above its dot, the lower below. */
function valueLabels(vals, n, x, y) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const here = vals.map((values) => values[i]).filter((v) => v !== null).sort((a, b) => b - a);
    here.forEach((v, rank) => {
      const side = rank === 0 ? 'above' : 'below';
      const last = i === n - 1 ? ' trend-value--last' : '';
      out.push(`<span class="trend-value trend-value--${side}${last}" style="left:${pct(x(i))};top:${pct(y(v))}">${escHtml(formatNumber(v))}</span>`);
    });
  }
  return out;
}

/** Each series' last value beside the plot, pulled apart so no two overlap. */
function endLabels(vals, colors, y) {
  const ends = [];
  vals.forEach((values, si) => {
    for (let i = values.length - 1; i >= 0; i -= 1) {
      if (values[i] === null) continue;
      ends.push({ si, value: values[i], top: y(values[i]) });
      break;
    }
  });
  ends.sort((a, b) => a.top - b.top);
  for (let j = 1; j < ends.length; j += 1) ends[j].top = Math.max(ends[j].top, ends[j - 1].top + END_GAP);
  const over = ends.length ? ends.at(-1).top - 104 : 0;
  if (over > 0) for (const end of ends) end.top -= over;
  return ends.map((end) => `<span class="trend-end" style="top:${pct(end.top)}"><i style="background:${escHtml(colors[end.si])}"></i>${escHtml(formatNumber(end.value))}</span>`);
}
