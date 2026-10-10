/**
 * Comparison rendering: side-by-side, slider, overlay, toggle.
 * The one visual primitive the fleet does not already own.
 *
 * compareHtml(block, ctx): renders a comparison
 * slopeSvg(pairs, opts): before/after dumbbell chart
 */

import { escHtml } from '../neorgon-dom.js';
import { safeImageSrc } from './url.js';
import { emptyFrame } from './markdown.js';

/**
 * Render a comparison block (before/after).
 */
export function compareHtml(block, ctx = {}) {
  const mode = block.mode || 'side';
  const kind = block.kind || 'text';

  if (!block.left || !block.right) {
    return '<div class="block-empty">Comparison missing left or right side</div>';
  }

  switch (mode) {
    case 'side':
      return compareSide(block, kind);
    case 'slider':
      return compareSlider(block, kind);
    case 'overlay':
      return compareOverlay(block, kind);
    case 'toggle':
      return compareToggle(block, kind);
    default:
      return '<div class="block-empty">Unknown comparison mode</div>';
  }
}

function compareSide(block, kind) {
  let html = '<div class="compare-side">';
  html += `<div class="compare-panel"><h4>${escHtml(block.left.label || 'Before')}</h4>`;
  html += renderCompareContent(block.left, kind, block.language);
  html += '</div>';
  html += `<div class="compare-panel"><h4>${escHtml(block.right.label || 'After')}</h4>`;
  html += renderCompareContent(block.right, kind, block.language);
  html += '</div>';
  html += '</div>';
  return html;
}

function compareSlider(block, kind) {
  if (kind !== 'image') {
    return '<div class="block-empty">Slider mode requires image kind</div>';
  }
  return `<div class="compare-slider">
    <img src="${escHtml(safeImageSrc(block.left.src) || '')}" alt="before" />
    <input type="range" min="0" max="100" value="50" />
  </div>`;
}

function compareOverlay(block, kind) {
  if (kind !== 'image') {
    return '<div class="block-empty">Overlay mode requires image kind</div>';
  }
  return `<div class="compare-overlay">
    <img src="${escHtml(safeImageSrc(block.left.src) || '')}" alt="before" />
    <img src="${escHtml(safeImageSrc(block.right.src) || '')}" alt="after" style="opacity: 0.5;" />
    <input type="range" min="0" max="100" value="50" data-action="compare-opacity" />
  </div>`;
}

function compareToggle(block, kind) {
  return `<div class="compare-toggle">
    <button data-action="compare-toggle" data-show="left">
      ${escHtml(block.left.label || 'Before')}
    </button>
    <button data-action="compare-toggle" data-show="right">
      ${escHtml(block.right.label || 'After')}
    </button>
    <div class="compare-content">
      ${renderCompareContent(block.left, kind, block.language)}
    </div>
  </div>`;
}

function renderCompareContent(side, kind, language) {
  if (!side) return '';
  switch (kind) {
    case 'text':
      return `<p>${escHtml(side.value || '')}</p>`;
    case 'code':
      return `<pre><code>${escHtml(side.value || '')}</code></pre>`;
    case 'log':
      return `<pre><code>${escHtml(side.value || '')}</code></pre>`;
    case 'image':
      return `<img src="${escHtml(safeImageSrc(side.src) || '')}" alt="image" />`;
    case 'metrics':
    case 'table':
      return `<div>Comparison content</div>`;
    default:
      return `<div>${escHtml(side.value || '')}</div>`;
  }
}

/**
 * Slope chart: before/after dumbbell visualization.
 * Returns SVG string. Pure, deterministic with stable uid.
 */
export function slopeSvg(pairs, opts = {}) {
  const uid = opts.uid || 'slope-default';
  const title = opts.title || '';
  const width = opts.width || 400;
  const height = opts.height || Math.max(100, pairs.length * 40);
  const animate = opts.animate !== false;

  if (!Array.isArray(pairs) || pairs.length === 0) {
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="currentColor">No data</text>
    </svg>`;
  }

  const padding = 60;
  const plotWidth = width - padding * 2;
  const rowHeight = height / pairs.length;

  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escHtml(title)}" data-uid="${escHtml(uid)}">`;

  if (title) {
    svg += `<title>${escHtml(title)}</title>`;
  }

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const y = rowHeight * i + rowHeight / 2;
    const x1 = padding + (pair.before / 100) * plotWidth;
    const x2 = padding + (pair.after / 100) * plotWidth;

    const animStyle = animate ? ' style="transition: x 0.3s ease-out;"' : '';

    svg += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--text-secondary)" stroke-width="1"/>`;
    svg += `<circle cx="${x1}" cy="${y}" r="4" fill="var(--text-secondary)"><title>${pair.label}: before ${pair.before}</title></circle>`;
    svg += `<circle cx="${x2}" cy="${y}" r="4" fill="var(--accent)"><title>${pair.label}: after ${pair.after}</title></circle>`;
    svg += `<text x="10" y="${y + 4}" font-size="12" fill="currentColor">${escHtml(pair.label)}</text>`;
  }

  svg += '</svg>';
  return svg;
}
