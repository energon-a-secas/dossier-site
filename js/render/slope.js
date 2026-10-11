/** A value-scaled before/after plot. */
import { escHtml } from '../neorgon-dom.js';
import { formatNumber } from './format.js';

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
