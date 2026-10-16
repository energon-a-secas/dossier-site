/**
 * HTML to the compare IR (js/compare/ir.js), for "Dossier format".
 *
 * The source is parsed with DOMParser, which builds an inert tree: nothing in
 * it runs and nothing loads. The walk below reads that tree and builds plain
 * data. No node from the source is ever moved into the page and no source
 * markup is ever assigned to innerHTML; js/compare/ir-render.js writes fresh,
 * escaped markup from the data. That is the whole security argument for this
 * mode, so keep it that way.
 *
 * What survives: headings, paragraphs, lists, tables, preformatted text,
 * quotes, figures, rules and disclosures, with bold, italic, code, links,
 * line breaks, sub, sup and mark inside them. Everything else unwraps to its
 * text or is dropped (scripts, styles, forms, frames, media, hidden nodes).
 *
 * Scope: `main`, `[role=main]` or a single `article` when the report has
 * one; otherwise `body` minus its `nav`, `header`, `footer` and `aside`.
 */

import { safeHref } from '../render/url.js';
import { inlineText, blockText, wrapperOf, headingsOf } from './ir.js';
import { countWords } from './extract.js';
import {
  INLINE, clean, nameOf, skipped, inlineOf, inlineInto, tidy, withoutImages, imageInfo, svgInfo,
} from './normalize-inline.js';

const LISTS = new Set(['ul', 'ol', 'menu']);
/**
 * Little text and many custom elements or scripts: a saved web app, whose
 * content was drawn by script and is mostly not in the file.
 */
const APP_WORDS = 600;
const APP_ELEMENTS = 25;
const APP_SCRIPTS = 10;

/**
 * @param {string} html
 * @param {{svg?: boolean}} [opts] `svg: false` skips drawing inline SVG
 *   (statistics only, where the picture is not needed)
 * @returns {{blocks: Array, title: string, info: {words: number,
 *   customElements: number, scripts: number, remoteImages: number,
 *   looksLikeApp: boolean}}}
 */
export function htmlToIr(html, opts = {}) {
  let doc = null;
  try {
    // A `<base>` is dropped first: this page's policy refuses it even in an
    // inert document and logs the refusal, and links are judged unresolved.
    doc = new DOMParser().parseFromString(String(html || '').replace(/<base\b[^>]*>/gi, ''), 'text/html');
  } catch {
    doc = null;
  }
  if (!doc || !doc.body) return { blocks: [], title: '', info: emptyInfo() };
  const scope = doc.querySelector('main') || doc.querySelector('[role="main"]')
    || (doc.querySelectorAll('article').length === 1 ? doc.querySelector('article') : null)
    || doc.body;
  const result = elementToIr(scope, { ...opts, dropChrome: scope === doc.body });
  liftHeadings(result.blocks);
  result.title = clean(doc.title || '');
  result.info.scripts = doc.querySelectorAll('script').length;
  // Counted over the whole page, not the part read: a saved web app keeps
  // most of its custom elements in the chrome around the content.
  result.info.customElements = [...doc.querySelectorAll('*')].filter((el) => el.localName.includes('-')).length;
  result.info.looksLikeApp = result.info.words < APP_WORDS
    && (result.info.customElements >= APP_ELEMENTS || result.info.scripts >= APP_SCRIPTS);
  return result;
}

/** How many recent sources `htmlOutline` remembers. */
const OUTLINE_CACHE = 4;
const outlines = [];

/**
 * The headings of an HTML report, numbered as the Dossier format numbers
 * them (`renderIr` gives the n-th heading the id `<prefix>-h<n>`), so an
 * outline built from this list points at the headings that view draws. The
 * Reports view's rail asks on every render, so the last few answers are
 * kept: parsing a 600 KB report takes tens of milliseconds. Empty where
 * there is no DOMParser (Node).
 *
 * @param {string} html
 * @returns {Array<{n: number, level: number, text: string}>}
 */
export function htmlOutline(html) {
  const source = String(html || '');
  const hit = outlines.find((entry) => entry.source === source);
  if (hit) return hit.headings;
  const headings = typeof DOMParser === 'undefined'
    ? []
    : headingsOf(htmlToIr(source, { svg: false }).blocks).map(({ n, level, text }) => ({ n, level, text }));
  outlines.unshift({ source, headings });
  outlines.length = Math.min(outlines.length, OUTLINE_CACHE);
  return headings;
}

/**
 * The IR of an element already in a document (a rendered Dossier report, for
 * its statistics and outline). The element is read, never changed.
 */
export function elementToIr(root, { svg = true, dropChrome = false } = {}) {
  const ctx = {
    svg, dropChrome, headings: 0, ids: new Map(), pending: [], customElements: 0, remoteImages: 0, links: [],
  };
  const blocks = walk(root, ctx);
  resolveLinks(ctx);
  finishLinks(blocks);
  const words = countWords(blocks.map(blockText).join(' '));
  return {
    blocks,
    title: '',
    info: { ...emptyInfo(), words, customElements: ctx.customElements, remoteImages: ctx.remoteImages },
  };
}

function emptyInfo() {
  return { words: 0, customElements: 0, scripts: 0, remoteImages: 0, looksLikeApp: false };
}

/**
 * Move every heading up by the same amount, so the shallowest one read is
 * level 1 and the rest keep their places under it. A report whose h1 sits in
 * a header outside `main` opens its content at h2; drawn as written, the
 * page's outline went from the report's title to its sections with a level
 * missing between them. Alignment and sections read levels relative to each
 * other, which a common shift leaves as they were.
 */
function liftHeadings(blocks) {
  const headings = [];
  const visit = (list) => {
    for (const block of list || []) {
      if (block?.t === 'h') headings.push(block);
      else if (Array.isArray(block?.blocks)) visit(block.blocks);
    }
  };
  visit(blocks);
  if (!headings.length) return;
  const shift = Math.min(...headings.map((h) => h.level)) - 1;
  if (shift > 0) for (const h of headings) h.level -= shift;
}

// ── Blocks ───────────────────────────────────────────────────────────────────

function walk(container, ctx, { except = null } = {}) {
  const out = [];
  let inl = [];
  const flush = () => {
    pushParagraph(inl, out);
    inl = [];
  };
  for (const node of container.childNodes) {
    if (node === except) continue;
    if (node.nodeType === 3) {
      inl.push({ text: node.data });
      continue;
    }
    if (node.nodeType !== 1 || skipped(node, ctx)) continue;
    if (INLINE.has(nameOf(node))) {
      inlineInto(node, inl, ctx);
      continue;
    }
    flush();
    block(node, out, ctx);
  }
  flush();
  return out;
}

function block(el, out, ctx) {
  const name = nameOf(el);
  if (/^h[1-6]$/.test(name)) {
    const inl = tidy(inlineOf(el, ctx));
    if (!clean(inlineText(inl))) return;
    ctx.headings += 1;
    // Ids on the sections that open with this heading, and on empty named
    // anchors just before it, are where an in-page link to it points.
    for (const key of ctx.pending) if (!ctx.ids.has(key)) ctx.ids.set(key, ctx.headings);
    ctx.pending = [];
    if (el.id) ctx.ids.set(el.id, ctx.headings);
    for (const named of el.querySelectorAll('[id], a[name]')) {
      const key = named.id || named.getAttribute('name');
      if (key && !ctx.ids.has(key)) ctx.ids.set(key, ctx.headings);
    }
    out.push({ t: 'h', level: Number(name[1]), inl });
    return;
  }
  if (el.id && /^(section|article|div|main)$/.test(name)) ctx.pending.push(el.id);
  switch (name) {
    case 'p':
      pushParagraph(inlineOf(el, ctx), out);
      return;
    case 'ul': case 'ol': case 'menu': {
      const list = listOf(el, ctx);
      if (list) out.push(list);
      return;
    }
    case 'dl': {
      const list = definitionList(el, ctx);
      if (list) out.push(list);
      return;
    }
    case 'table': {
      const table = tableOf(el, ctx);
      if (table) out.push(table);
      return;
    }
    case 'pre': {
      const text = String(el.textContent || '').replace(/\r\n?/g, '\n').replace(/^\n/, '').replace(/\s+$/, '');
      if (!text) return;
      const code = el.querySelector('code[class*="language-"]');
      const lang = code ? /language-([\w+#.-]{1,30})/.exec(code.className)?.[1] : null;
      out.push(lang ? { t: 'pre', text, lang } : { t: 'pre', text });
      return;
    }
    case 'blockquote': {
      const blocks = walk(el, ctx);
      if (blocks.length) out.push({ t: 'quote', blocks });
      return;
    }
    case 'figure':
      figure(el, out, ctx);
      return;
    case 'hr':
      out.push({ t: 'hr' });
      return;
    case 'details': {
      const summaryEl = [...el.children].find((child) => nameOf(child) === 'summary') || null;
      const summary = summaryEl ? tidy(inlineOf(summaryEl, ctx)) : [{ text: 'Details' }];
      const blocks = walk(el, ctx, { except: summaryEl });
      out.push({ t: 'details', summary: summary.length ? summary : [{ text: 'Details' }], blocks });
      return;
    }
    default:
      if (name.includes('-')) ctx.customElements += 1;
      out.push(...walk(el, ctx));
  }
}

/** A paragraph from inline runs, or figures when the runs are only images. */
function pushParagraph(runs, out) {
  const inl = tidy(runs);
  if (!inl.length) return;
  const images = inl.filter((run) => run.img);
  const rest = inl.filter((run) => !run.img && !(typeof run.text === 'string' && !run.text.trim()) && !run.br);
  if (images.length && !rest.length) {
    for (const run of images) out.push(figureOf(run.img));
    return;
  }
  const textual = tidy(withoutImages(inl));
  if (!textual.length || !clean(inlineText(textual))) return;
  out.push({ t: 'p', inl: textual });
}

function figureOf(img, caption) {
  const fig = { t: 'fig', alt: img.alt || '' };
  if (img.src) fig.src = img.src;
  if (img.note) fig.note = img.note;
  if (caption) fig.caption = caption;
  return fig;
}

function figure(el, out, ctx) {
  const pic = el.querySelector('img, svg');
  const captionEl = el.querySelector('figcaption');
  const caption = captionEl ? clean(captionEl.textContent || '') : '';
  const hasTable = el.querySelector('table, pre, ul, ol');
  if (pic && !hasTable && !skipped(pic, ctx)) {
    const img = nameOf(pic) === 'svg' ? svgInfo(pic, ctx) : imageInfo(pic, ctx);
    if (img) out.push(figureOf(img, caption));
    else if (caption) out.push({ t: 'p', inl: [{ text: caption }] });
    return;
  }
  out.push(...walk(el, ctx));
}

function listOf(el, ctx) {
  const items = [];
  for (const child of el.children) {
    if (skipped(child, ctx)) continue;
    if (nameOf(child) !== 'li') {
      if (LISTS.has(nameOf(child)) && items.length) {
        const nested = listOf(child, ctx);
        if (nested) items[items.length - 1].sub = mergeLists(items[items.length - 1].sub, nested);
      }
      continue;
    }
    let sub = null;
    const runs = [];
    for (const node of child.childNodes) {
      if (node.nodeType === 3) { runs.push({ text: node.data }); continue; }
      if (node.nodeType !== 1 || skipped(node, ctx)) continue;
      if (LISTS.has(nameOf(node))) {
        const nested = listOf(node, ctx);
        if (nested) sub = mergeLists(sub, nested);
      } else {
        inlineInto(node, runs, ctx);
      }
    }
    const inl = tidy(withoutImages(runs));
    if (!inl.length && !sub) continue;
    items.push(sub ? { inl, sub } : { inl });
  }
  if (!items.length) return null;
  return { t: 'list', ordered: nameOf(el) === 'ol', items };
}

function mergeLists(a, b) {
  if (!a) return b;
  return { ...a, items: [...a.items, ...b.items] };
}

function definitionList(el, ctx) {
  const items = [];
  for (const child of el.children) {
    if (skipped(child, ctx)) continue;
    const name = nameOf(child);
    const inl = tidy(withoutImages(inlineOf(child, ctx)));
    if (!inl.length) continue;
    if (name === 'dt' || !items.length) items.push({ inl: name === 'dt' ? [{ b: inl }] : inl });
    else items[items.length - 1].inl.push({ text: ': ' }, ...inl);
  }
  return items.length ? { t: 'list', ordered: false, items } : null;
}

function tableOf(el, ctx) {
  const rows = [];
  const head = [];
  for (const tr of el.rows || []) {
    if (skipped(tr, ctx) || (tr.parentElement && skipped(tr.parentElement, ctx))) continue;
    const cells = [];
    for (const cell of tr.cells) {
      if (skipped(cell, ctx)) continue;
      const out = { inl: tidy(withoutImages(inlineOf(cell, ctx))) };
      const colspan = Number(cell.getAttribute('colspan'));
      const rowspan = Number(cell.getAttribute('rowspan'));
      if (Number.isInteger(colspan) && colspan > 1) out.colspan = Math.min(colspan, 50);
      if (Number.isInteger(rowspan) && rowspan > 1) out.rowspan = Math.min(rowspan, 500);
      cells.push(out);
    }
    if (!cells.length) continue;
    const inHead = tr.parentElement && nameOf(tr.parentElement) === 'thead';
    (inHead ? head : rows).push(cells);
  }
  if (!head.length && rows.length > 1 && [...(el.rows[0]?.cells || [])].every((cell) => nameOf(cell) === 'th')) {
    head.push(rows.shift());
  }
  if (!head.length && !rows.length) return null;
  const table = { t: 'table', head, rows };
  const captionEl = el.querySelector(':scope > caption');
  if (captionEl) {
    const caption = tidy(withoutImages(inlineOf(captionEl, ctx)));
    if (caption.length) table.caption = caption;
  }
  return table;
}

/**
 * Links are judged once the headings are known. An in-page link to a heading
 * becomes a `local` link to its number; an absolute http, https or mailto
 * address is kept; every other target (relative paths that would resolve
 * against this site, script schemes, data) loses its link and keeps its words.
 */
function resolveLinks(ctx) {
  for (const ref of ctx.links) {
    const raw = String(ref.raw || '').trim();
    if (raw.startsWith('#')) {
      let key = raw.slice(1);
      try { key = decodeURIComponent(key); } catch { /* keep the raw key */ }
      const n = ctx.ids.get(key);
      if (n) ref.local = n;
      continue;
    }
    const href = safeHref(raw);
    if (href && /^(https?:|mailto:)/i.test(href)) ref.href = href;
  }
}

/** Replace each link's shared reference with its final `href` or `local`. */
function finishLinks(blocks) {
  const runs = (inl) => {
    if (!Array.isArray(inl)) return;
    for (const run of inl) {
      const key = wrapperOf(run);
      if (!key) continue;
      if (key === 'a' && run.ref) {
        if (run.ref.href) run.href = run.ref.href;
        if (run.ref.local) run.local = run.ref.local;
        delete run.ref;
      }
      runs(run[key]);
    }
  };
  const visit = (list) => {
    for (const block of list || []) {
      runs(block.inl);
      runs(block.summary);
      runs(block.caption);
      if (block.items) for (const item of block.items) { runs(item.inl); if (item.sub) visit([item.sub]); }
      if (block.head) for (const row of [...block.head, ...block.rows]) for (const cell of row) runs(cell.inl);
      if (block.blocks) visit(block.blocks);
    }
  };
  visit(blocks);
}
