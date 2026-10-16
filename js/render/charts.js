/**
 * The bridge from a `chart` block to the fleet Viz Kit.
 *
 * The Viz Kit supplies plot geometry. Paired bars, legends and data tables
 * live in chart-data.js because readers need to compare individual series.
 *
 * The mapping to get right, and the one the first version had backwards: the
 * kit's `bars` takes one item per bar, `[{label, value}]`, and treats an array
 * `value` as a stack. So the bars are the block's categories, not its series.
 * Mapping series to items drew one bar per series, each stacked out of that
 * series' whole history, which is a chart of nothing.
 */

import { escHtml } from '../neorgon-dom.js';
import { bars, line, donut, radar, heatmap, empty } from '../viz.js';
import { emptyFrame } from './markdown.js';
import { chartColor, chartLegend, chartValues, groupedBars } from './chart-data.js';
import { safeDomId } from './ids.js';

/** The kit's right-aligned readout is where a unit belongs. */
function scaleText(block) {
  const bits = [];
  if (block.unit) bits.push(String(block.unit));
  if (block.reference && Number.isFinite(Number(block.reference.value))) {
    const label = block.reference.label || 'target';
    bits.push(`${label} ${block.reference.value}`);
  }
  return bits.join(' · ');
}

function baseOpts(block, extra = {}) {
  return {
    // A stable uid keeps the <defs> ids deterministic, which the tests rely on
    // and which stops two charts on one page sharing a gradient.
    // The kit writes the uid into SVG ids raw, so it is reduced to id-safe
    // characters here rather than trusted.
    uid: block.id ? `c-${safeDomId(block.id)}` : 'c-chart',
    title: block.title || '',
    scale: scaleText(block),
    ariaLabel: block.title || `${String(block.form)} chart`,
    width: 640,
    height: 280,
    animate: false,
    ...extra,
  };
}

function seriesOf(block) {
  return Array.isArray(block.series) ? block.series.filter(Boolean) : [];
}

/** Category labels, numbered when the author did not name them. */
function categoriesOf(block, length) {
  const given = Array.isArray(block.categories) ? block.categories : [];
  const out = [];
  for (let i = 0; i < length; i += 1) {
    out.push(given[i] !== undefined ? String(given[i]) : String(i + 1));
  }
  return out;
}

export function renderChartBlock(block, ctx = {}) {
  if (!block.form) {
    return emptyFrame('Chart: add "form", one of bar, stacked, line, area, donut, radar or heatmap.');
  }

  try {
    switch (block.form) {
      case 'bar':
      case 'stacked':
        return barChart(block);
      case 'line':
        return lineChart(block, false);
      case 'area':
        return lineChart(block, true);
      case 'donut':
        return donutChart(block);
      case 'radar':
        return radarChart(block);
      case 'heatmap':
        return heatmapChart(block);
      default:
        return emptyFrame(`Chart: "${block.form}" is not a form this page draws. Use bar, stacked, line, area, donut, radar or heatmap.`);
    }
  } catch (err) {
    // A chart that throws must not take the page with it. The reader gets a
    // frame that names the problem, which is more than a blank space does.
    return `<div class="block-error" role="note">Chart could not be drawn: ${escHtml(err.message)}</div>`;
  }
}

/**
 * Bars compare independent values; only an explicit stacked chart adds them.
 */
function barChart(block) {
  const series = seriesOf(block);
  if (!series.length) {
    return emptyFrame('Chart: add "series", each with a list of "values".');
  }

  const length = Math.max(...series.map((s) => (Array.isArray(s.values) ? s.values.length : 0)));
  if (!length) return emptyFrame('Chart: the series carry no values.');
  const labels = categoriesOf(block, length);

  if (block.form === 'bar') return groupedBars(block, series, labels);

  if (series.length === 1) {
    const data = labels.map((label, i) => ({
      label,
      value: Number(series[0].values[i]) || 0,
      color: chartColor(series[0], 0),
    }));
    return bars(data, baseOpts(block, { max: block.max }));
  }

  const data = labels.map((label, i) => ({
    label,
    value: series.map((s) => Number(Array.isArray(s.values) ? s.values[i] : 0) || 0),
  }));
  const totalMax = Math.max(...data.map((d) => d.value.reduce((sum, value) => sum + value, 0)));
  const opts = baseOpts(block, { max: Math.max(block.max || 0, totalMax), keys: series.map((s) => s.label || ''), colors: series.map(chartColor) });
  return bars(data, opts);
}

function lineChart(block, area) {
  const series = seriesOf(block);
  if (!series.length) {
    return emptyFrame('Chart: add "series", each with a list of "values".');
  }
  const data = series.map((s) => ({
    name: s.label || '',
    color: chartColor(s, series.indexOf(s)),
    values: Array.isArray(s.values) ? s.values.map((v) => Number(v) || 0) : [],
  }));
  if (!data.some((s) => s.values.length)) return emptyFrame('Chart: the series carry no values.');
  const labels = categoriesOf(block, Math.max(...data.map((s) => s.values.length)));
  const colors = series.map(chartColor);
  data.forEach((s, i) => { s.color = colors[i]; });
  const plot = line(data, baseOpts(block, { area, max: block.max, frame: false }));
  const ticks = `<div class="chart-x-labels">${labels.map((label) => `<span>${escHtml(label)}</span>`).join('')}</div>`;
  return `<figure class="trend-chart"><figcaption><strong>${escHtml(block.title || 'Trend')}</strong><span>${escHtml(scaleText(block))}</span></figcaption>${chartLegend(series)}${plot}${ticks}${chartValues(block, series, labels)}</figure>`;
}

function donutChart(block) {
  const series = seriesOf(block);
  const first = series[0];
  if (!first || !Array.isArray(first.values) || !first.values.length) {
    return emptyFrame('Chart: a donut needs one series of values.');
  }
  const labels = categoriesOf(block, first.values.length);
  const segments = first.values.map((v, i) => ({
    label: labels[i],
    value: Number(v) || 0,
  }));
  return donut(segments, baseOpts(block, { legend: true, size: 180 }));
}

function radarChart(block) {
  const axes = Array.isArray(block.axes) ? block.axes : [];
  const series = seriesOf(block);
  if (!axes.length) return emptyFrame('Chart: a radar needs "axes" to name its spokes.');
  if (!series.length) return emptyFrame('Chart: a radar needs at least one series.');
  // The kit does arithmetic on these and draws the result, so anything that
  // is not a number becomes 0 here rather than NaN in a points attribute.
  const mapped = series.map((s) => ({
    name: s.label || '',
    color: chartColor(s, series.indexOf(s)),
    values: Array.isArray(s.values) ? s.values.map((v) => Number(v) || 0) : [],
  }));
  const named = axes.map((a, i) => (typeof a === 'string'
    ? { key: a, label: a }
    : { key: String(a?.key ?? i), label: String(a?.label ?? a?.key ?? `Axis ${i + 1}`) }));
  return radar(named, mapped, baseOpts(block, { max: block.max }));
}

/**
 * The kit reads `o.rows` and `o.cols` as label arrays, not counts. Passing
 * counts made it reserve the gutter and then print nothing in it.
 */
function heatmapChart(block) {
  const grid = Array.isArray(block.grid)
    ? block.grid.filter(Array.isArray).map((row) => row.map((v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))))
    : [];
  if (!grid.length) return emptyFrame('Chart: a heatmap reads "grid", a list of rows of numbers.');
  const width = Math.max(...grid.map((r) => r.length));
  const opts = baseOpts(block, { max: block.max });
  const cols = Array.isArray(block.categories) ? block.categories.slice(0, width) : null;
  if (cols && cols.length) opts.cols = cols.map(String);
  return heatmap(grid, opts);
}
