/**
 * The inline half of js/compare/normalize.js: which source elements are
 * skipped, how running text becomes inline runs, and how images and inline
 * SVG are described. Same rule as the rest: read the inert tree, build plain
 * data, never move a source node into the page.
 */

import { safeImageSrc } from '../render/url.js';
import { wrapperOf } from './ir.js';

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'base', 'title', 'head',
  'input', 'button', 'select', 'textarea', 'option', 'optgroup', 'datalist', 'output', 'progress', 'meter',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'video', 'audio', 'source', 'track', 'canvas',
  'map', 'area', 'dialog', 'slot', 'param', 'applet', 'portal']);
const CHROME = new Set(['nav', 'header', 'footer', 'aside']);
export const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'br', 'cite', 'code', 'data', 'del', 'dfn',
  'em', 'font', 'i', 'img', 'ins', 'kbd', 'label', 'mark', 'nobr', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'small', 'span', 'strike', 'strong', 'sub', 'sup', 'svg', 'time', 'tt', 'u', 'var', 'wbr', 'acronym']);
/** An inline SVG larger than this, serialised, is described rather than shown. */
const SVG_MAX_CHARS = 300000;
/** The SVG elements that paint a shape, whose colours a drawing must carry. */
const SHAPES = 'path, circle, rect, polygon, polyline, ellipse, line, use';
/**
 * Inline elements a page often lays out as boxes of their own with CSS: a
 * stat tile's number over its label, a bar chart row's label, value and tag.
 */
const BOXLIKE = new Set(['span', 'small', 'big', 'label', 'time', 'data', 'font', 'abbr']);
export const clean = (text) => String(text).replace(/\s+/g, ' ').trim();
export const nameOf = (el) => String(el.localName || '').toLowerCase();

export function skipped(el, ctx) {
  const name = nameOf(el);
  if (SKIP.has(name)) return true;
  if (ctx.dropChrome && CHROME.has(name)) return true;
  if (el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const style = el.getAttribute('style');
  if (style && /(^|;)\s*display\s*:\s*none\b/i.test(style)) return true;
  return BOXLIKE.has(name) && slideCounter(el);
}

/**
 * A slide deck's "02 / 13" in its footer. It belongs to the deck's chrome,
 * not to the slide, and left in it glues itself onto the footer's note and
 * makes every footer differ between two decks of different lengths.
 */
function slideCounter(el) {
  const raw = String(el.textContent || '');
  if (raw.length > 40) return false;
  const text = clean(raw);
  return text.length <= 11 && /^\d{1,4}\s*\/\s*\d{1,4}$/.test(text) && Boolean(el.closest('footer'));
}

/** Images inside running text read as their description, if they have one. */
export function withoutImages(runs) {
  const out = [];
  for (const run of runs) {
    if (run.img) {
      if (run.img.alt && run.img.labelled) out.push({ text: run.img.alt });
      continue;
    }
    const key = wrapperOf(run);
    out.push(key ? { ...run, [key]: withoutImages(run[key]) } : run);
  }
  return out;
}

// ── Inline runs ──────────────────────────────────────────────────────────────

export function inlineOf(el, ctx) {
  const runs = [];
  for (const node of el.childNodes) {
    if (node.nodeType === 3) runs.push({ text: node.data });
    else if (node.nodeType === 1 && !skipped(node, ctx)) inlineInto(node, runs, ctx);
  }
  return runs;
}

export function inlineInto(el, runs, ctx) {
  const apart = setApart(el, ctx);
  if (apart) runs.push({ text: apart });
  // A box the page lays out on its own, set in running text or next to a
  // bold word: without the page's CSS it would glue onto its neighbours
  // ("plansTICK-101", "1Finding"). Seams on both sides let tidy put a space
  // there, and only where two words would otherwise join.
  const seam = apart === null && isSeamBox(el);
  if (seam) runs.push({ seam: 1 });
  inlineBody(el, runs, ctx);
  if (seam) runs.push({ seam: 1 });
}

function inlineBody(el, runs, ctx) {
  const name = nameOf(el);
  switch (name) {
    case 'br': runs.push({ br: 1 }); return;
    case 'wbr': return;
    case 'b': case 'strong': runs.push({ b: inlineOf(el, ctx) }); return;
    case 'i': case 'em': case 'cite': case 'dfn': case 'var': runs.push({ i: inlineOf(el, ctx) }); return;
    case 'code': case 'kbd': case 'samp': case 'tt': runs.push({ code: String(el.textContent || '') }); return;
    case 'sub': case 'sup': case 'mark': runs.push({ [name]: inlineOf(el, ctx) }); return;
    case 'q': runs.push({ text: '“' }, ...inlineOf(el, ctx), { text: '”' }); return;
    case 'a': {
      const anchor = el.getAttribute('name') || el.id;
      if (anchor) ctx.pending.push(anchor);
      // One shared reference per link: tidying copies runs, and the target
      // is decided only once every heading is known (resolveLinks).
      const ref = { raw: el.getAttribute('href') || '' };
      ctx.links.push(ref);
      runs.push({ a: inlineOf(el, ctx), ref });
      return;
    }
    case 'img': {
      const img = imageInfo(el, ctx);
      if (img) runs.push({ img });
      return;
    }
    case 'svg': {
      const img = svgInfo(el, ctx);
      if (img) runs.push({ img });
      return;
    }
    default:
      if (name.includes('-')) ctx.customElements += 1;
      if (!INLINE.has(name)) {
        // A block inside running text (a card made of a link around a div):
        // its words stay, set apart by spaces.
        runs.push({ text: ' ' }, ...inlineOf(el, ctx), { text: ' ' });
        return;
      }
      runs.push(...inlineOf(el, ctx));
  }
}

/**
 * What to put before `el` when it is a box in a container made only of
 * boxes, or null when its container is not one. A stat tile, `<div
 * class="stat"><span class="num">201</span><span class="lbl">EOL
 * tickets</span></div>`, sets its number above its label with the page's
 * CSS. Without that CSS the two would run together as "201EOL tickets", so
 * each box after the first is set apart by a space. Three or more boxes with
 * words in them (a bar chart row's label, value and tag; a flow diagram's
 * chips) are set apart by " · ", so they read as items rather than one
 * sentence; an empty box (a bar's track) gets nothing. Only when every child
 * is a classed box: running text with a styled word inside it,
 * `5<span class="unit">%</span>`, has text of its own and is left to the
 * seams.
 */
function setApart(el, ctx) {
  const parent = el.parentElement;
  if (!parent || !isBox(el)) return null;
  if (!ctx.boxed) ctx.boxed = new WeakMap();
  if (!ctx.boxed.has(parent)) ctx.boxed.set(parent, onlyBoxes(parent, ctx) ? wordyBoxes(parent, ctx) : -1);
  const wordy = ctx.boxed.get(parent);
  if (wordy < 0) return null;
  if (wordy >= 3) {
    if (!hasWords(el)) return '';
    for (let prev = el.previousElementSibling; prev; prev = prev.previousElementSibling) {
      if (!skipped(prev, ctx) && hasWords(prev)) return ' · ';
    }
    return '';
  }
  for (let prev = el.previousElementSibling; prev; prev = prev.previousElementSibling) {
    if (!skipped(prev, ctx)) return ' ';
  }
  return '';
}

function isBox(el) {
  return BOXLIKE.has(nameOf(el)) && el.hasAttribute('class');
}

/** A box, or a `small` or `label` with or without a class: both are often display:block. */
function isSeamBox(el) {
  const name = nameOf(el);
  return name === 'small' || name === 'label' || isBox(el);
}

const hasWords = (el) => Boolean(clean(el.textContent || ''));

function onlyBoxes(parent, ctx) {
  let boxes = 0;
  for (const node of parent.childNodes) {
    if (node.nodeType === 3) {
      if (node.data.trim()) return false;
    } else if (node.nodeType === 1 && !skipped(node, ctx)) {
      if (!isBox(node)) return false;
      boxes += 1;
    }
  }
  return boxes > 1;
}

function wordyBoxes(parent, ctx) {
  let count = 0;
  for (const child of parent.children) if (!skipped(child, ctx) && hasWords(child)) count += 1;
  return count;
}

/** Two characters that would read as one word run together: letters or digits, not both lower case. */
export function joinsWords(a, b) {
  const word = /[\p{L}\p{N}]/u;
  const lower = /\p{Ll}/u;
  return word.test(a) && word.test(b) && !(lower.test(a) && lower.test(b));
}

/** The first character a run would print, or '' when it prints nothing. */
function firstChar(run) {
  if (!run || typeof run !== 'object') return '';
  if (typeof run.text === 'string') return run.text.replace(/\s+/g, ' ')[0] || '';
  if (typeof run.code === 'string') return run.code.replace(/\s+/g, ' ').trim()[0] || '';
  if (run.br || run.img) return ' ';
  const key = wrapperOf(run);
  if (!key) return '';
  for (const inner of run[key]) {
    const first = firstChar(inner);
    if (first) return first;
  }
  return '';
}

/**
 * Collapse whitespace across run boundaries, trim the ends, drop empty
 * wrappers and merge neighbouring text. Returns new runs.
 */
export function tidy(runs) {
  let space = true;
  // The last character printed, and whether a seam (a box's edge) waits to
  // be resolved against the next thing printed.
  let lastChar = ' ';
  let seam = false;
  const resolveSeam = (run, out) => {
    if (!seam) return;
    seam = false;
    if (!joinsWords(lastChar, firstChar(run))) return;
    const last = out[out.length - 1];
    if (last && typeof last.text === 'string') last.text += ' ';
    else out.push({ text: ' ' });
    space = true;
    lastChar = ' ';
  };
  const pass = (list) => {
    const out = [];
    for (const run of list) {
      if (!run || typeof run !== 'object') continue;
      if (run.seam) {
        seam = true;
      } else if (typeof run.text === 'string') {
        resolveSeam(run, out);
        let text = run.text.replace(/\s+/g, ' ');
        if (space) text = text.replace(/^ /, '');
        if (!text) continue;
        space = text.endsWith(' ');
        lastChar = text[text.length - 1];
        const last = out[out.length - 1];
        if (last && typeof last.text === 'string') last.text += text;
        else out.push({ text });
      } else if (run.br) {
        trimEnd(out);
        if (out.length) out.push({ br: 1 });
        space = true;
        lastChar = ' ';
      } else if (typeof run.code === 'string') {
        resolveSeam(run, out);
        const code = run.code.replace(/\s+/g, ' ').trim();
        if (!code) continue;
        out.push({ code });
        space = false;
        lastChar = code[code.length - 1];
      } else if (run.img) {
        out.push(run);
        lastChar = ' ';
      } else {
        const key = wrapperOf(run);
        if (!key) continue;
        resolveSeam(run, out);
        const inner = pass(run[key]);
        if (!inner.length) continue;
        const next = { [key]: inner };
        if (key === 'a') {
          if (run.ref) next.ref = run.ref;
          if (run.href) next.href = run.href;
          if (run.local) next.local = run.local;
        }
        out.push(next);
      }
    }
    return out;
  };
  const out = pass(runs);
  trimEnd(out);
  while (out.length && out[out.length - 1].br) out.pop();
  return out;
}

function trimEnd(list) {
  const last = list[list.length - 1];
  if (!last) return;
  if (typeof last.text === 'string') {
    last.text = last.text.replace(/ $/, '');
    if (!last.text) list.pop();
    return;
  }
  const key = wrapperOf(last);
  if (key) trimEnd(last[key]);
}

// ── Images ───────────────────────────────────────────────────────────────────

function hostOf(src) {
  try {
    return new URL(src, 'https://invalid.invalid/').host || 'another site';
  } catch {
    return 'another site';
  }
}

export function imageInfo(img, ctx) {
  const src = String(img.getAttribute('src') || '').trim();
  const alt = clean(img.getAttribute('alt') || img.getAttribute('title') || '');
  const labelled = Boolean(alt);
  if (/^data:image\//i.test(src)) {
    const safe = safeImageSrc(src);
    return safe ? { src: safe, alt, labelled } : { alt, labelled, note: 'An embedded image in a format this page does not show' };
  }
  if (/^(https?:)?\/\//i.test(src)) {
    ctx.remoteImages += 1;
    return { alt, labelled, note: `Remote image from ${hostOf(src)} not loaded` };
  }
  if (!src) return labelled ? { alt, labelled, note: 'Image with no source' } : null;
  const name = src.split(/[?#]/)[0].split('/').pop() || src;
  return { alt, labelled, note: `Image ${name.slice(0, 80)} is not part of the file` };
}

/**
 * An inline SVG becomes an image of itself. An `<img>` never runs script, and
 * scripts, foreign objects, handlers and outside references are removed first
 * anyway, so the drawing shows and nothing in it acts.
 */
export function svgInfo(svg, ctx) {
  const label = clean(svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || '');
  if (!ctx.svg) return { alt: label || 'Drawing', labelled: Boolean(label), note: 'Drawing' };
  const width = Number(svg.getAttribute('width'));
  if (!label && Number.isFinite(width) && width > 0 && width <= 24) return null;
  if (styledByPage(svg)) {
    return { alt: label, labelled: Boolean(label), note: 'A drawing coloured by its page’s stylesheet, so it shows only in Original' };
  }
  let xml = '';
  try {
    const copy = svg.cloneNode(true);
    for (const bad of copy.querySelectorAll('script, foreignObject, foreignobject')) bad.remove();
    for (const el of [copy, ...copy.querySelectorAll('*')]) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'xlink:href') && !attr.value.trim().startsWith('#')) el.removeAttribute(attr.name);
      }
    }
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    xml = new XMLSerializer().serializeToString(copy);
  } catch {
    xml = '';
  }
  if (!xml) return { alt: label || 'Drawing', labelled: Boolean(label), note: 'A drawing that could not be shown' };
  if (xml.length > SVG_MAX_CHARS) return { alt: label || 'Drawing', labelled: Boolean(label), note: 'A drawing too large to show here' };
  const src = safeImageSrc(`data:image/svg+xml,${encodeURIComponent(xml)}`);
  return src ? { src, alt: label || 'Drawing', labelled: Boolean(label) } : null;
}

/**
 * True when a drawing takes its colours from the page's stylesheet: a shape
 * with a class (on itself or a group around it) and no fill or stroke of its
 * own, in an SVG with no style sheet of its own. Drawn as an image on its own
 * it loses that stylesheet and every such shape paints solid black (the
 * owner's roadmap showed its constellation as one black polygon), so it is
 * described instead. Text is not counted: unstyled text is still legible.
 */
function styledByPage(svg) {
  if (svg.querySelector('style')) return false;
  const paints = (el) => el.hasAttribute('fill') || el.hasAttribute('stroke')
    || /(^|;)\s*(fill|stroke)\s*:/i.test(el.getAttribute('style') || '');
  for (const shape of svg.querySelectorAll(SHAPES)) {
    let classed = false;
    let painted = false;
    for (let el = shape; el; el = el === svg ? null : el.parentElement) {
      if (paints(el)) { painted = true; break; }
      if (el.hasAttribute('class')) classed = true;
    }
    if (classed && !painted) return true;
  }
  return false;
}
