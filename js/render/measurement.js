/**
 * Measurement block renderers: metrics, charts, gauges, scorecards, tables.
 */

import { escHtml } from '../neorgon-dom.js';
import { spark, gauge as vizGauge } from '../viz.js';
import { renderChartBlock } from './charts.js';
import { emptyFrame, inlineMarkdown } from './markdown.js';
// One formatter. This module carried its own copy of formatNumber, so fixing
// the one in format.js changed nothing on screen: an error rate of 0.3 still
// rendered as 0 and 1420000 requests still rendered as seven loose digits.
import { formatNumber, formatCell } from './format.js';
import { pick, enumValues } from './enums.js';
import { safeDomId } from './ids.js';

const VERDICTS = enumValues('scorecard', 'criteria', 'verdict');

/** The types this module renders. js/render/dispatch.js builds its
 *  table from these declarations, so a type cannot be routed to a module
 *  that does not handle it. */
export const MEASUREMENT_TYPES = Object.freeze(['metrics', 'chart', 'gauge', 'scorecard', 'table']);

export function renderMeasurementBlock(block, ctx) {
  const type = block.type;
  switch (type) {
    case 'metrics':
      return renderMetrics(block);
    case 'chart':
      return renderChart(block);
    case 'gauge':
      return renderGauge(block);
    case 'scorecard':
      return renderScorecard(block);
    case 'table':
      return renderTable(block);
    default:
      return null;
  }
}

/**
 * Metric tiles: the block a reader looks at first.
 *
 * Built here rather than with the kit's `statGrid`, and the reason is the
 * whole point of the block. `statGrid` derives the arrow and the colour from
 * one value, the sign of the delta, so a number going up is green. In a work
 * report that is wrong half the time: latency going up is bad and throughput
 * going up is good, and the block knows which from `better`.
 *
 * So the arrow says which way the number moved and the colour says whether
 * that was good, which are two different facts. The kit's `.viz-stat` classes
 * are reused for everything else, so these tiles sit in the same type scale
 * and spacing as every chart beside them, and `spark` is the kit's.
 */
function renderMetrics(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  if (!items.length) {
    return emptyFrame('Metric tiles: add "items", each with a "label" and a "value".');
  }
  const tiles = items.map(renderMetricTile).join('');
  return `<div class="block-metrics viz-stats">${tiles}</div>`;
}

function renderMetricTile(metric) {
  if (!metric || typeof metric !== 'object') return '';

  const value = formatNumber(metric.value, metric.precision);
  const unit = metric.unit ? `<span class="metric-unit">${escHtml(metric.unit)}</span>` : '';
  const parts = [
    `<span class="viz-stat__label">${escHtml(metric.label || '')}</span>`,
    `<span class="viz-stat__value">${value}${unit}</span>`,
  ];

  // delta and direction are derived in js/derive.js. direction is goodness,
  // not arithmetic: "good", "bad" or "neutral", already corrected for
  // `better: lower`.
  if (metric.delta !== undefined && metric.delta !== null && Number.isFinite(Number(metric.delta))) {
    const d = Number(metric.delta);
    const arrow = d > 0 ? '\u25b2' : d < 0 ? '\u25bc' : '\u25a0';
    const moved = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    const tone = metric.direction === 'good' ? 'good'
      : metric.direction === 'bad' ? 'bad' : 'flat';
    const pct = Number.isFinite(Number(metric.deltaPct))
      ? ` (${Number(metric.deltaPct) > 0 ? '+' : ''}${formatNumber(metric.deltaPct, 1)}%)`
      : '';
    // The word is there so the colour is never the only carrier: about one
    // reader in twelve cannot use the hue to tell good from bad.
    parts.push(
      `<span class="metric-delta metric-delta--${tone}">`
      + `<span aria-hidden="true">${arrow}</span> `
      + `${formatNumber(Math.abs(d), metric.precision)}${pct}`
      + `<span class="metric-delta__word"> ${moved}${tone === 'flat' ? '' : tone === 'good' ? ', improved' : ', regressed'}</span>`
      + '</span>',
    );
  }

  if (metric.baseline !== undefined && Number.isFinite(Number(metric.baseline))) {
    parts.push(`<span class="metric-baseline">was ${formatNumber(metric.baseline, metric.precision)}</span>`);
  }
  if (metric.target !== undefined && Number.isFinite(Number(metric.target))) {
    parts.push(`<span class="metric-target">target ${formatNumber(metric.target, metric.precision)}</span>`);
  }
  if (Array.isArray(metric.spark) && metric.spark.length > 1) {
    const values = metric.spark.map((v) => Number(v) || 0);
    parts.push(`<span class="metric-spark">${spark(values, { width: 96, height: 22 })}</span>`);
  }

  return `<div class="viz-stat metric-tile">${parts.join('')}</div>`;
}

function renderChart(block) {
  return renderChartBlock(block);
}

/**
 * One value against its range, drawn by the kit. `bands` turns the ring into
 * a banded meter, which is what a budget or a threshold wants.
 */
function renderGauge(block) {
  const value = Number(block.value);
  if (!Number.isFinite(value)) {
    return emptyFrame('Gauge: add a numeric "value".');
  }
  const max = Number.isFinite(Number(block.max)) ? Number(block.max) : 100;
  const opts = {
    uid: block.id ? `g-${safeDomId(block.id)}` : 'g-gauge',
    max,
    title: block.title || '',
    scale: block.unit ? String(block.unit) : '',
    ariaLabel: `${block.title || 'Gauge'}: ${value} of ${max}`,
  };
  if (block.label) opts.label = String(block.label);

  if (Array.isArray(block.bands) && block.bands.length) {
    opts.mode = 'band';
    opts.bands = block.bands
      .filter((b) => b && Number.isFinite(Number(b.to)))
      .map((b) => ({ to: Number(b.to), color: toneColor(b.tone) }));
  }
  return vizGauge(value, opts);
}

/** Report tones map onto the fleet's semantic tokens, not onto new colours. */
function toneColor(tone) {
  switch (tone) {
    case 'good': return 'var(--ok, #22c55e)';
    case 'bad': return 'var(--danger-hover, #f43f5e)';
    case 'warn': return 'var(--warn, #fbbf24)';
    case 'info': return 'var(--viz-accent, #0080ff)';
    default: return 'var(--viz-ink-mute, #8b94a7)';
  }
}

function renderScorecard(block) {
  const criteria = Array.isArray(block.criteria) ? block.criteria : [];
  if (criteria.length === 0) return '';
  let html = '<table class="block-scorecard"><tbody>';
  for (const c of criteria) {
    if (!c || typeof c !== 'object') continue;
    // The verdict was written raw into a class and a cell. The detail is what
    // the linter asks for on anything that did not pass, and it was not shown.
    const verdict = pick(c.verdict, VERDICTS, 'unknown');
    const detail = c.detail ? `<p class="scorecard-detail">${inlineMarkdown(String(c.detail))}</p>` : '';
    html += `<tr><td class="scorecard-label">${escHtml(String(c.label || ''))}${detail}</td>`;
    html += `<td class="scorecard-verdict verdict--${verdict}">${verdict}</td></tr>`;
  }
  html += '</tbody></table>';
  return html;
}

const ALIGNS = ['left', 'right', 'center'];

function renderTable(block) {
  // A column that is null or a bare string is drawn as a label, not read as
  // an object: reading .align off null threw and the table became an error card.
  const columns = (Array.isArray(block.columns) ? block.columns : [])
    .map((c) => (c && typeof c === 'object' ? c : { label: String(c ?? '') }));
  const rows = Array.isArray(block.rows) ? block.rows : [];
  if (columns.length === 0 || rows.length === 0) return '';
  const aligns = columns.map((c) => (ALIGNS.includes(c.align) ? c.align : 'left'));
  let html = `<div class="table-wrapper" tabindex="0" role="region" aria-label="${escHtml(block.title || 'Report table')}"><table class="block-table"><thead><tr>`;
  columns.forEach((col, i) => {
    html += `<th scope="col" align="${aligns[i]}">${escHtml(String(col.label ?? ''))}</th>`;
  });
  html += '</tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr>';
    if (Array.isArray(row)) {
      for (let i = 0; i < columns.length; i++) {
        html += `<td align="${aligns[i]}">${escHtml(formatCell(row[i], columns[i].format))}</td>`;
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

