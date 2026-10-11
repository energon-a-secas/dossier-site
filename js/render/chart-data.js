/** Chart labels, accessible values and colors, independent of drawing. */
import { escHtml } from '../neorgon-dom.js';
import { formatNumber } from './format.js';

export function chartColor(series, index) {
  const color = String(series.color || '');
  return /^(#[\da-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla|oklch)\([\d.% ,/+-]+\)|var\(--[a-z\d-]+\))$/i.test(color)
    ? color : `var(--viz-c${index % 8 + 1})`;
}

export function chartLegend(series) {
  return `<ul class="chart-legend" aria-label="Data series">${series.map((item, i) =>
    `<li><span class="chart-legend__swatch" style="background:${escHtml(chartColor(item, i))}" aria-hidden="true"></span>${escHtml(item.label || `Series ${i + 1}`)}</li>`
  ).join('')}</ul>`;
}

export function chartValues(block, series, labels) {
  const header = series.map((s, i) => `<th scope="col">${escHtml(s.label || `Series ${i + 1}`)}</th>`).join('');
  const rows = labels.map((label, i) => `<tr><th scope="row">${escHtml(label)}</th>${series.map((s) =>
    `<td>${s.values?.[i] == null ? 'Not recorded' : escHtml(formatNumber(s.values[i]))}</td>`
  ).join('')}</tr>`).join('');
  return `<details class="chart-values"><summary>View data${block.unit ? ` (${escHtml(block.unit)})` : ''}</summary><div class="table-wrapper"><table class="block-table"><thead><tr><th scope="col">Category</th>${header}</tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

/** A shared axis compares series without adding unrelated measurements. */
export function groupedBars(block, series, labels) {
  const values = series.flatMap((s) => s.values || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  const low = Math.min(0, ...values);
  const high = Math.max(0, Number(block.max) || 0, ...values);
  const span = high - low || 1;
  const zero = -low / span * 100;
  const groups = labels.map((label, i) => {
    const bars = series.map((s, j) => {
      const raw = s.values?.[i];
      const measured = raw != null && Number.isFinite(Number(raw));
      const value = measured ? Number(raw) : 0;
      const offset = (Math.min(0, value) - low) / span * 100;
      const width = Math.abs(value) / span * 100;
      return `<div class="chart-bar-row"><span class="chart-bar-row__series">${escHtml(s.label || `Series ${j + 1}`)}</span><div class="chart-bar-track" style="--zero:${zero}%" aria-hidden="true"><span class="chart-bar" style="left:${offset}%;width:${width}%;background:${escHtml(chartColor(s, j))}"></span></div><span class="chart-bar-value">${measured ? escHtml(formatNumber(value)) : 'Not recorded'}</span></div>`;
    }).join('');
    return `<div class="chart-bar-group"><h4>${escHtml(label)}</h4>${bars}</div>`;
  }).join('');
  return `<figure class="grouped-chart"><figcaption><strong>${escHtml(block.title || 'Comparison')}</strong><span>${escHtml(block.unit || '')} · shared scale</span></figcaption>${chartLegend(series)}<div class="chart-bar-groups">${groups}</div><p class="chart-axis-note">Scale: ${formatNumber(low)} to ${formatNumber(high)}${block.unit ? ` ${escHtml(block.unit)}` : ''}</p></figure>`;
}
