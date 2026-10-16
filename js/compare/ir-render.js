/**
 * The compare IR to HTML, for a column in Dossier format. DOM-free: node
 * imports it.
 *
 * Every string from a report is escaped here, every link goes through
 * `safeHref` and every image through `safeImageSrc`, and nothing else is
 * emitted. The IR carries no markup of its own, so this file is the only
 * place a report's words become markup, and it writes only what it chose.
 *
 * Heading levels move down two (a source h1 renders as an h3 with the class
 * `r-h1`): the page's h1 is the site name and each column's label is an h2,
 * so a report's headings sit under its column for a screen reader, and the
 * class keeps the reading sizes. Heading ids are `<colId>-h<n>`, unique per
 * column, so two reports with a "Summary" never share an id.
 *
 * Units (headings, paragraphs, list items, table rows, code blocks, and the
 * paragraphs inside quotes and disclosures) carry `data-u`, numbered in the
 * order of `flattenUnits` (js/compare/ir.js). `opts.marks(unit, index)` may
 * return `{cls, attrs, prefix, label, inner, before, after}` for a unit:
 *   cls     classes added to the unit element
 *   attrs   extra attributes, already escaped, starting with a space
 *   prefix  markup put first inside the unit (a tag, a visually hidden label)
 *   label   for a table's header row, the label that would be its prefix
 *   inner   markup that replaces the unit's own content (word marks)
 *   before, after  markup placed around the unit (a removed unit's ghost row)
 *   cells   for a table row, one entry per cell: markup that replaces that
 *           cell's content, or null to keep it
 * A row's prefix goes into its first cell, since a row holds only cells, but
 * only in the table's body: in its header row it would become the name of
 * every column header, so a header row's `before` and `label` stand just
 * before the table and its `after` just after it, and the first row of the
 * table head is always the header row.
 * The marks function owns escaping whatever it returns; `renderInline` is
 * the escaping path for inline runs it builds (the word marks).
 *
 * A table's scrolling wrapper is named from the IR, never from the page,
 * which holds the marks' words: by its caption, its header cells, the
 * heading above it, or its place. js/scroll-regions.js then drops the region
 * role and the Tab stop while the table fits.
 */

import { escHtml } from '../neorgon-dom.js';
import { safeHref, safeImageSrc } from '../render/url.js';
import { inlineText } from './ir.js';

/**
 * @param {Array} blocks
 * @param {{colId?: string, marks?: (unit: object, index: number) => object|null}} [opts]
 * @returns {string}
 */
export function renderIr(blocks, { colId = 'c', marks = null } = {}) {
  const ctx = {
    colId: safeId(colId), marks: typeof marks === 'function' ? marks : null, unit: 0, heading: 0, lastHeading: '', tables: 0,
  };
  return blockList(blocks, ctx);
}

/**
 * Inline runs to HTML, escaped, with links checked, exactly as inside a
 * rendered unit. For marks that rebuild a unit's content (word marks).
 *
 * @param {Array} inl
 * @param {string} [colId] the column, for in-page links to its headings
 */
export function renderInline(inl, colId = 'c') {
  return inline(inl, { colId: safeId(colId) });
}

function safeId(value) {
  return String(value || 'c').replace(/[^A-Za-z0-9_-]/g, '') || 'c';
}

function blockList(blocks, ctx) {
  let html = '';
  for (const block of Array.isArray(blocks) ? blocks : []) html += renderBlock(block, ctx);
  return html;
}

/**
 * One unit element: its tag, its own content, and whatever the marks say.
 */
function unit(tag, attrs, content, kind, node, text, ctx) {
  const index = ctx.unit;
  ctx.unit += 1;
  const mark = ctx.marks ? ctx.marks({ kind, node, text }, index) : null;
  const cls = [attrs.cls, mark?.cls].filter(Boolean).join(' ');
  const open = `<${tag}${attrs.id ? ` id="${attrs.id}"` : ''}${cls ? ` class="${escHtml(cls)}"` : ''}`
    + `${attrs.extra || ''} data-u="${index}"${mark?.attrs || ''}>`;
  const inner = mark && typeof mark.inner === 'string' ? mark.inner : content;
  return `${mark?.before || ''}${open}${mark?.prefix || ''}${inner}</${tag}>${mark?.after || ''}`;
}

function renderBlock(block, ctx) {
  if (!block || typeof block !== 'object') return '';
  switch (block.t) {
    case 'h': {
      const level = clampLevel(block.level);
      ctx.heading += 1;
      ctx.lastHeading = inlineText(block.inl);
      const tag = `h${Math.min(6, level + 2)}`;
      return unit(tag, { id: `${ctx.colId}-h${ctx.heading}`, cls: `r-h r-h${level}` },
        inline(block.inl, ctx), 'h', block, inlineText(block.inl), ctx);
    }
    case 'p':
      return unit('p', {}, inline(block.inl, ctx), 'p', block, inlineText(block.inl), ctx);
    case 'list':
      return list(block, ctx);
    case 'table':
      return table(block, ctx);
    case 'pre': {
      const lang = block.lang ? ` data-lang="${escHtml(String(block.lang).slice(0, 30))}"` : '';
      return unit('pre', { extra: lang }, `<code>${escHtml(block.text)}</code>`, 'pre', block, String(block.text || ''), ctx);
    }
    case 'quote':
      return `<blockquote>${blockList(block.blocks, ctx)}</blockquote>`;
    case 'fig':
      return figure(block);
    case 'hr':
      return '<hr>';
    case 'details': {
      const summary = unit('summary', {}, inline(block.summary, ctx), 'p', block, inlineText(block.summary), ctx);
      return `<details>${summary}${blockList(block.blocks, ctx)}</details>`;
    }
    default:
      return '';
  }
}

function clampLevel(level) {
  const n = Number(level);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : 2;
}

function list(block, ctx) {
  const tag = block.ordered ? 'ol' : 'ul';
  let html = `<${tag}>`;
  for (const item of block.items || []) {
    const sub = item.sub ? null : '';
    // The item is one unit; a nested list follows its own units, inside it.
    const index = ctx.unit;
    ctx.unit += 1;
    const mark = ctx.marks ? ctx.marks({ kind: 'li', node: item, text: inlineText(item.inl) }, index) : null;
    const content = mark && typeof mark.inner === 'string' ? mark.inner : inline(item.inl, ctx);
    const nested = item.sub ? list(item.sub, ctx) : sub;
    const cls = mark?.cls ? ` class="${escHtml(mark.cls)}"` : '';
    html += `${mark?.before || ''}<li${cls} data-u="${index}"${mark?.attrs || ''}>${mark?.prefix || ''}${content}${nested}</li>${mark?.after || ''}`;
  }
  return `${html}</${tag}>`;
}

const squash = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/**
 * A table's name, plain text: its caption, its header cells ("Table: UTC,
 * Event"), the heading above it, or its place ("Table 2"). Read from the IR,
 * so no mark's words ("Added table row:") get into it.
 */
export function tableLabel(block, ctx) {
  if (block.caption) return `Table: ${squash(inlineText(block.caption)).slice(0, 80)}`;
  const cells = (block.head?.[0] || []).map((cell) => squash(inlineText(cell?.inl)).slice(0, 30)).filter(Boolean);
  if (cells.length) {
    if (cells.length <= 3) return `Table: ${cells.join(', ')}`;
    const more = cells.length - 3;
    return `Table: ${cells.slice(0, 3).join(', ')} and ${more} more column${more === 1 ? '' : 's'}`;
  }
  const heading = squash(ctx.lastHeading);
  if (heading) return `Table under ${heading.slice(0, 80)}`;
  return `Table ${ctx.tables}`;
}

function table(block, ctx) {
  ctx.tables += 1;
  const label = tableLabel(block, ctx);
  const caption = block.caption ? `<caption>${inline(block.caption, ctx)}</caption>` : '';
  let lead = '';
  let trail = '';
  const row = (cells, cellTag) => {
    const index = ctx.unit;
    ctx.unit += 1;
    const head = cellTag === 'th';
    const text = (cells || []).map((cell) => inlineText(cell.inl)).join(' | ');
    const mark = ctx.marks ? ctx.marks({ kind: 'tr', node: cells, text, head }, index) : null;
    const content = (cells || []).map((cell, i) => {
      const span = (cell.colspan > 1 ? ` colspan="${Math.min(50, cell.colspan | 0)}"` : '')
        + (cell.rowspan > 1 ? ` rowspan="${Math.min(500, cell.rowspan | 0)}"` : '');
      const scope = head ? ' scope="col"' : '';
      const own = mark?.cells && typeof mark.cells[i] === 'string' ? mark.cells[i] : inline(cell.inl, ctx);
      return `<${cellTag}${scope}${span}>${i === 0 && !head ? mark?.prefix || '' : ''}${own}</${cellTag}>`;
    }).join('');
    const cls = mark?.cls ? ` class="${escHtml(mark.cls)}"` : '';
    const tr = `<tr${cls} data-u="${index}"${mark?.attrs || ''}>${content}</tr>`;
    if (!head) return `${mark?.before || ''}${tr}${mark?.after || ''}`;
    lead += `${mark?.before || ''}${mark?.label || ''}`;
    trail += mark?.after || '';
    return tr;
  };
  const head = (block.head || []).length ? `<thead>${block.head.map((r) => row(r, 'th')).join('')}</thead>` : '';
  const body = `<tbody>${(block.rows || []).map((r) => row(r, 'td')).join('')}</tbody>`;
  return `${lead}<div class="r-table" tabindex="0" role="region" aria-label="${escHtml(label)}"><table>${caption}${head}${body}</table></div>${trail}`;
}

/** Only a data: image is drawn. Anything else is described, never fetched. */
function figure(block) {
  const src = typeof block.src === 'string' && /^data:image\//i.test(block.src) ? safeImageSrc(block.src) : null;
  const alt = escHtml(block.alt || '');
  const caption = block.caption ? `<figcaption>${escHtml(block.caption)}</figcaption>` : '';
  if (src) {
    return `<figure class="r-fig"><img src="${escHtml(src)}" alt="${alt}" loading="lazy" decoding="async">${caption}</figure>`;
  }
  const note = block.note || 'Image not included';
  const label = block.alt ? `${escHtml(block.alt)}. ` : '';
  return `<figure class="r-fig r-fig--missing"><p class="r-fig__note">${label}${escHtml(note)}.</p>${caption}</figure>`;
}

// ── Inline ───────────────────────────────────────────────────────────────────

function inline(inl, ctx) {
  let html = '';
  for (const run of Array.isArray(inl) ? inl : []) {
    if (!run || typeof run !== 'object') continue;
    if (typeof run.text === 'string') html += escHtml(run.text);
    else if (typeof run.code === 'string') html += `<code>${escHtml(run.code)}</code>`;
    else if (run.br) html += '<br>';
    else if (Array.isArray(run.b)) html += `<strong>${inline(run.b, ctx)}</strong>`;
    else if (Array.isArray(run.i)) html += `<em>${inline(run.i, ctx)}</em>`;
    else if (Array.isArray(run.sub)) html += `<sub>${inline(run.sub, ctx)}</sub>`;
    else if (Array.isArray(run.sup)) html += `<sup>${inline(run.sup, ctx)}</sup>`;
    else if (Array.isArray(run.mark)) html += `<mark>${inline(run.mark, ctx)}</mark>`;
    else if (Array.isArray(run.a)) html += anchor(run, ctx);
  }
  return html;
}

function anchor(run, ctx) {
  const words = inline(run.a, ctx);
  if (Number.isInteger(run.local) && run.local > 0) {
    return `<a href="#${ctx.colId}-h${run.local}" data-local="${run.local}">${words}</a>`;
  }
  const href = typeof run.href === 'string' ? safeHref(run.href) : null;
  if (!href || !/^(https?:|mailto:)/i.test(href)) return words;
  return `<a href="${escHtml(href)}" target="_blank" rel="noopener noreferrer">${words}</a>`;
}
