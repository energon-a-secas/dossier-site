/**
 * Original mode: an HTML report in its own look, in a frame.
 *
 * Static (the default): a srcdoc frame with `sandbox="allow-same-origin"` and
 * nothing else. Without `allow-scripts` no script in the report runs (inline,
 * handlers, javascript: links, SVG script, nested frames), and the embed
 * policy from js/embed-policy.js blocks every remote load. Being same-origin
 * is what lets this page read the frame's headings and geometry, drive its
 * scroll and catch its link clicks, all from listeners that run here, never
 * in the report.
 *
 * Interactive (opt in, per column): the opaque `embed.html` host with
 * `sandbox="allow-scripts"` and no `allow-same-origin`, so the report's own
 * scripts run in an origin of their own, with no network, no storage and no
 * way to this page. Nothing reads or scrolls it from here.
 *
 * Never both tokens on one frame, and never a token changed on a live frame:
 * a mode change builds a new element.
 */

import { embedDocument } from '../embed-policy.js';
import { safeHref } from '../render/url.js';

const META = /<meta\b[^>]*>/gi;
const REFRESH = /http-equiv\s*=\s*["']?\s*refresh/i;
const BASE = /<base\b[^>]*>/gi;

/**
 * `&#82;` and `&#x52;` as the characters they stand for, as a parser reads
 * them: `http-equiv="&#82;efresh"` is a refresh.
 */
function decodeRefs(text) {
  return text.replace(/&#(x[0-9a-f]+|\d+);?/gi, (ref, code) => {
    const n = /^x/i.test(code) ? parseInt(code.slice(1), 16) : parseInt(code, 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ref;
  });
}

/**
 * Remove `<meta http-equiv="refresh">`, which would navigate the frame, from
 * markup handed over as text (the interactive host writes it as given). A
 * pattern, so it is hygiene and not a boundary: the static copy also removes
 * refreshes from its parsed tree (`staticCopy`), and a report allowed to run
 * its scripts can move its own sealed frame anyway.
 */
export function stripRefresh(html) {
  return String(html || '').replace(META, (tag) => (REFRESH.test(decodeRefs(tag)) ? '' : tag));
}

/**
 * Parse a report into an inert tree. A `<base>` is taken out first: even in
 * a DOMParser document this page's policy (`base-uri`) refuses it and logs
 * the refusal, once per parse, and nothing here needs it.
 */
function inertDocument(html) {
  try {
    return new DOMParser().parseFromString(String(html || '').replace(BASE, ''), 'text/html');
  } catch {
    return null;
  }
}

/**
 * What a static frame's policy lets an image load: inline data and blobs,
 * and a fragment inside the document (an SVG `<use href="#icon">` or a CSS
 * `url(#gradient)`). Anything else, here or on another site, is refused.
 */
const LOADS = /^\s*(?:data:|blob:|#)/i;
const IMPORT = /@import\s+(?:url\(\s*)?["']?\s*([^"')\s;]*)[^;]*;?/gi;
const URL_REF = /url\(\s*(["']?)\s*([^"')]*?)\s*\1\s*\)/gi;
/** Attributes that fetch something, on the elements that carry them. */
const FETCHES = [
  ['img, source, video, audio, track, input', ['src', 'srcset', 'poster']],
  ['image, use, feImage, feimage', ['href', 'xlink:href']],
];

/** A piece of CSS without the loads the frame would refuse. */
function cssWithoutLoads(css) {
  return String(css)
    .replace(IMPORT, (rule, target) => (LOADS.test(target) ? rule : ''))
    .replace(URL_REF, (ref, quote, target) => (LOADS.test(target) ? ref : 'none'));
}

/** Attributes that hold an address a click, a submit or a load would follow. */
const URL_ATTRS = new Set([
  'href', 'xlink:href', 'src', 'action', 'formaction', 'data', 'poster', 'background',
  'cite', 'longdesc', 'ping', 'codebase', 'lowsrc', 'dynsrc',
]);

/**
 * A script address, as the URL parser reads it: it drops control characters,
 * spaces, tabs and line breaks, so `java&#9;script:` is still one.
 */
function scriptUrl(value) {
  return /^(?:javascript|vbscript):/i.test(String(value || '').replace(/[\u0000-\u0020\u007f]+/g, ''));
}

/**
 * Viewport-height units (`vh`, `dvh`, `svh`, `lvh`) as fixed pixels, for a
 * frame sized to its own document. There the viewport is the document, so a
 * `min-height: 100vh` hero grows with the frame, the frame grows to fit it,
 * and the two chase each other without end. A reader's screen height is
 * what the author meant by 100vh, so that is what it becomes. A number
 * glued to a name (`.h-100vh`, a class) is a selector, not a length.
 */
const VH = /(?<![\w.-])(-?(?:\d+\.?\d*|\.\d+))(?:d|s|l)?vh\b/gi;
function fixedViewport(css, height) {
  if (!height) return String(css);
  return String(css).replace(VH, (unit, n) => `${Math.round(Number(n) * height) / 100}px`);
}

/** Elements that only load something the frames' policy refuses. */
const REFUSED = 'base, link, iframe, frame, frameset, object, embed, portal';

/**
 * Take out of an inert tree the refresh and the fetching attributes both
 * kinds of frame would refuse: a `<meta http-equiv=refresh>`, and every
 * image, media or SVG source that is not inline.
 */
function dropLoads(doc) {
  // Parsed, so a refresh is found here however its tag is written; the
  // pattern in `stripRefresh` reads text and can be talked past.
  for (const el of doc.querySelectorAll('meta[http-equiv]')) {
    if (/refresh/i.test(el.getAttribute('http-equiv') || '')) el.remove();
  }
  for (const [selector, names] of FETCHES) {
    for (const el of doc.querySelectorAll(selector)) {
      for (const name of names) {
        const value = el.getAttribute(name);
        if (value === null) continue;
        // A srcset lists several sources, and every one would be fetched. A
        // data URL has commas of its own, so the list is not split; a set
        // that opens inline and names nothing on another site stays.
        const loads = LOADS.test(value) && !(name === 'srcset' && /,\s*(?:https?:)?\/\//i.test(value));
        if (!loads) el.removeAttribute(name);
      }
    }
  }
}

/** Take out of an inert tree everything the static frame would refuse. */
function cleanTree(doc, { viewportHeight = 0 } = {}) {
  for (const el of doc.querySelectorAll(`script, ${REFUSED}`)) el.remove();
  dropLoads(doc);
  for (const style of doc.querySelectorAll('style')) {
    style.textContent = fixedViewport(cssWithoutLoads(style.textContent || ''), viewportHeight);
  }
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if (URL_ATTRS.has(name) && scriptUrl(attr.value)) el.removeAttribute(attr.name);
      else if (name === 'style' && /url\(|@import/i.test(attr.value)) el.setAttribute('style', fixedViewport(cssWithoutLoads(attr.value), viewportHeight));
      else if (name === 'style' && viewportHeight && /vh\b/i.test(attr.value)) el.setAttribute('style', fixedViewport(attr.value, viewportHeight));
    }
  }
}

/** How many times a copy is parsed again before it is taken to be settled. */
const SETTLE_PASSES = 4;

/**
 * The document a static frame shows: the report's own markup, less what the
 * frame refuses anyway. Its scripts, handler attributes and script links
 * never run without `allow-scripts`, `<base>`, nested frames and linked
 * stylesheets are refused by the policy, and so is every image, font or
 * stylesheet that is not inline (a file beside the report, or another site).
 * Taking them out first changes nothing on screen and keeps the browser from
 * logging one refusal for each (the Alioth roadmap logged three, the hostile
 * fixture dozens). The column still says what was not loaded: it counts from
 * the source (`remoteResources`), not from this copy.
 *
 * Read from an inert DOMParser tree, cleaned and serialised. Serialised
 * markup does not always parse back into the tree it came from: a `<style>`
 * that was text inside MathML in one parse holds a live `<img onerror>` in
 * the next. So the copy is parsed and cleaned again until a pass changes
 * nothing, which makes the cleaned tree the one the frame will build. Markup
 * that never settles is shown as its text alone. The sandbox, with no
 * `allow-scripts`, stops all of this from running anyway; this is so the
 * frame is never handed it.
 *
 * `opts.viewportHeight` (pixels) fixes viewport-height units for a frame
 * that is sized to its document (`fixedViewport`); without it they are left
 * alone, as a frame with its own scroll needs them.
 *
 * @param {string} html
 * @param {{viewportHeight?: number}} [opts]
 * @returns {string}
 */
export function staticCopy(html, opts = {}) {
  const text = stripRefresh(html);
  let doc = inertDocument(text);
  if (!doc || !doc.documentElement) return text;
  const clean = { viewportHeight: Math.max(0, Math.round(Number(opts.viewportHeight) || 0)) };
  let out = '';
  for (let pass = 0; pass < SETTLE_PASSES; pass += 1) {
    cleanTree(doc, clean);
    const next = `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
    if (next === out) return next;
    out = next;
    const again = inertDocument(next);
    if (!again || !again.documentElement) break;
    doc = again;
  }
  return plainCopy(doc);
}

/**
 * The markup "Run the report's scripts" hands the sealed host: the report as
 * written, its scripts and handlers included, less what the host's policy
 * refuses to load anyway (linked and remote stylesheets, script files, remote
 * fonts and images, nested frames, `<base>`, a refresh). The browser would
 * log two refusals for each of them, which buried the report's own errors
 * under dozens of lines. Hygiene, not a boundary: the sealed frame
 * (`sandbox="allow-scripts"`, an opaque origin, no network) is the boundary,
 * so the copy is cleaned in one pass and keeps everything that runs.
 *
 * @param {string} html
 * @returns {string}
 */
export function scriptedCopy(html) {
  const text = stripRefresh(html);
  const doc = inertDocument(text);
  if (!doc || !doc.documentElement) return text;
  for (const el of doc.querySelectorAll(`${REFUSED}, script[src]`)) el.remove();
  dropLoads(doc);
  for (const style of doc.querySelectorAll('style')) style.textContent = cssWithoutLoads(style.textContent || '');
  for (const el of doc.querySelectorAll('[style]')) {
    const value = el.getAttribute('style');
    if (/url\(|@import/i.test(value)) el.setAttribute('style', cssWithoutLoads(value));
  }
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}

/** A document of nothing but `doc`'s text, for markup that never settles. */
function plainCopy(doc) {
  const plain = document.implementation.createHTMLDocument(String(doc?.title || 'Report'));
  const pre = plain.createElement('pre');
  pre.textContent = String(doc?.body?.textContent || '').trim();
  plain.body.append(pre);
  return `<!DOCTYPE html>${plain.documentElement.outerHTML}`;
}

/**
 * @param {string} html
 * @param {{title: string, onBlockedLink?: (href: string) => void,
 *   onAnchor?: (el: Element) => void, className?: string,
 *   viewportHeight?: number}} opts
 *   `onAnchor` replaces the frame's own scroll for an in-page link, for a
 *   frame sized to its document, which has nothing to scroll (the Reports
 *   view scrolls the page instead). `viewportHeight` goes to `staticCopy`.
 * @returns {HTMLIFrameElement}
 */
export function staticFrame(html, {
  title, onBlockedLink, onAnchor, className = 'col__frame', viewportHeight = 0,
} = {}) {
  const frame = document.createElement('iframe');
  frame.className = className;
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = title || 'Report, original layout';
  frame.srcdoc = embedDocument(staticCopy(html, { viewportHeight }), false);
  frame.addEventListener('load', () => bindLinks(frame, onBlockedLink, onAnchor));
  return frame;
}

/**
 * @param {string} html
 * @param {{title: string, className?: string}} opts
 * @returns {HTMLIFrameElement}
 */
export function interactiveFrame(html, { title, className = 'col__frame col__frame--interactive' } = {}) {
  const frame = document.createElement('iframe');
  frame.className = className;
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = title || 'Report, running its scripts';
  // js/embeds.js answers the host's ready message with this markup, and only
  // to this frame's own window.
  frame.dataset.embedHtml = embedDocument(scriptedCopy(html), true);
  frame.src = 'embed.html';
  return frame;
}

/**
 * Links in a static frame do what a reader expects without the report
 * deciding anything: an in-page link scrolls the frame, a web or mail
 * address opens in a new tab through `safeHref`, and anything else stays
 * put and says why. The listener is this page's, on the frame's document.
 */
function bindLinks(frame, onBlockedLink, onAnchor) {
  let doc = null;
  try {
    doc = frame.contentDocument;
  } catch {
    doc = null;
  }
  if (!doc || doc.__dossierLinks) return;
  doc.__dossierLinks = true;
  const handler = (event) => {
    const closest = (selector) => (event.target && event.target.closest ? event.target.closest(selector) : null);
    // A form in the report never submits (the sandbox has no allow-forms);
    // cancelling the click first spares the console the refusal.
    const submit = closest('button:not([type]), button[type="submit" i], input[type="submit" i], input[type="image" i]');
    if (submit && submit.form) {
      event.preventDefault();
      return;
    }
    const target = closest('a[href], area[href]');
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'click') return;
    const raw = (target.getAttribute('href') || '').trim();
    if (raw.startsWith('#')) {
      if (typeof onAnchor === 'function') onAnchor(anchorTarget(frame.contentDocument, raw.slice(1)));
      else scrollToAnchor(frame, raw.slice(1));
      return;
    }
    const href = safeHref(raw);
    if (href && /^(https?:|mailto:)/i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (typeof onBlockedLink === 'function') onBlockedLink(raw);
  };
  doc.addEventListener('click', handler, true);
  doc.addEventListener('auxclick', handler, true);
}

/** The element an in-page link names, by id or by name, or null for the top. */
function anchorTarget(doc, key) {
  if (!doc) return null;
  let name = key;
  try { name = decodeURIComponent(key); } catch { /* keep the raw key */ }
  return (name && (doc.getElementById(name) || doc.getElementsByName(name)[0])) || null;
}

function scrollToAnchor(frame, key) {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) return;
  const el = anchorTarget(doc, key);
  const top = el ? el.getBoundingClientRect().top + win.scrollY - 16 : 0;
  win.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  // A report whose window does not scroll (an app shell, its `main` the
  // scroller) leaves the target where it was; its own panes have to move.
  if (el) {
    const at = el.getBoundingClientRect().top;
    if (at < 0 || at >= win.innerHeight) scrollInsideFrame(frame, el);
  }
}

/**
 * Bring an element of a static frame's document into view inside the frame,
 * in whatever scrolls there: the frame's window, or a pane of the report's
 * own (an app shell whose `main` has `overflow: auto`, which a scroll of the
 * frame's window never moves). The browser carries `scrollIntoView` on out of
 * the frame into this page; every scroller of this page is put back where it
 * was, so the caller decides how, and whether, this page moves.
 *
 * @param {HTMLIFrameElement} frame
 * @param {Element|null} el
 */
export function scrollInsideFrame(frame, el) {
  if (!frame || !el || typeof el.scrollIntoView !== 'function') return;
  const kept = [];
  for (let node = frame.parentElement; node; node = node.parentElement) kept.push([node, node.scrollTop, node.scrollLeft]);
  const x = window.scrollX;
  const y = window.scrollY;
  el.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
  for (const [node, top, left] of kept) {
    if (node.scrollTop !== top || node.scrollLeft !== left) node.scrollTo({ top, left, behavior: 'instant' });
  }
  if (window.scrollX !== x || window.scrollY !== y) window.scrollTo({ left: x, top: y, behavior: 'instant' });
}

/** The visible headings of a loaded static frame, in document order. */
export function frameHeadings(frame) {
  let doc = null;
  try {
    doc = frame.contentDocument;
  } catch {
    return [];
  }
  if (!doc) return [];
  return [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter((el) => el.getClientRects().length)
    .map((el) => ({ level: Number(el.localName[1]) || 2, text: String(el.textContent || '').replace(/\s+/g, ' ').trim(), el }))
    .filter((h) => h.text);
}

/**
 * A scroller sync can drive: the frame's own window.
 *
 * @returns {{y(): number, set(y: number): void, height(): number, view(): number,
 *   anchors(): number[], listen(fn: () => void): () => void, element: Element}|null}
 */
export function frameScroller(frame, headings) {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) return null;
  return {
    element: frame,
    y: () => win.scrollY,
    set: (y, smooth = false) => win.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' }),
    height: () => (doc.scrollingElement || doc.documentElement).scrollHeight,
    view: () => win.innerHeight,
    anchors: () => headings.map((h) => h.el.getBoundingClientRect().top + win.scrollY),
    listen: (fn) => {
      win.addEventListener('scroll', fn, { passive: true });
      return () => win.removeEventListener('scroll', fn);
    },
  };
}

// ── Remote resources ─────────────────────────────────────────────────────────

function hostOf(src) {
  try {
    return new URL(src, 'https://invalid.invalid/').host || 'another site';
  } catch {
    return 'another site';
  }
}

/**
 * Count what an Original frame will not load: images, fonts and stylesheets
 * on other sites. The frame's policy blocks every one of them; the column
 * says how many, so a reader knows the look is not quite the author's.
 *
 * @returns {{images: number, fonts: number, styles: number, hosts: string[]}}
 */
export function remoteResources(html) {
  const out = { images: 0, fonts: 0, styles: 0, hosts: [] };
  const doc = inertDocument(html);
  if (!doc) return out;
  const hosts = new Set();
  const remote = (value) => /^(https?:)?\/\//i.test(String(value || '').trim());
  const note = (value) => hosts.add(hostOf(String(value).trim()));
  for (const img of doc.querySelectorAll('img[src], img[srcset], image[href], source[srcset]')) {
    const value = img.getAttribute('src') || img.getAttribute('href') || (img.getAttribute('srcset') || '').trim().split(/\s/)[0];
    if (remote(value)) { out.images += 1; note(value); }
  }
  for (const link of doc.querySelectorAll('link[href]')) {
    const value = link.getAttribute('href');
    if (!remote(value)) continue;
    const rel = (link.getAttribute('rel') || '').toLowerCase();
    if (/fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\./i.test(value)) out.fonts += 1;
    else if (rel.includes('stylesheet')) out.styles += 1;
    else continue;
    note(value);
  }
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent || '').join('\n')
    + [...doc.querySelectorAll('[style]')].map((el) => el.getAttribute('style')).join('\n');
  for (const match of css.matchAll(/@font-face[^}]*?url\(\s*['"]?((?:https?:)?\/\/[^'")\s]+)/gi)) {
    out.fonts += 1;
    note(match[1]);
  }
  for (const match of css.matchAll(/@import\s+(?:url\()?\s*['"]?((?:https?:)?\/\/[^'")\s;]+)/gi)) {
    if (/font/i.test(match[1])) out.fonts += 1;
    else out.styles += 1;
    note(match[1]);
  }
  for (const match of css.matchAll(/url\(\s*['"]?((?:https?:)?\/\/[^'")\s]+)/gi)) {
    if (/\.(woff2?|ttf|otf|eot)(\?|$)/i.test(match[1])) continue;
    out.images += 1;
    note(match[1]);
  }
  out.hosts = [...hosts].slice(0, 6);
  return out;
}

/** The column sentence for what was not loaded, or '' when nothing was. */
export function blockedSentence(counts) {
  if (!counts) return '';
  const parts = [];
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  if (counts.fonts) parts.push(n(counts.fonts, 'web font', 'web fonts'));
  if (counts.images) parts.push(n(counts.images, 'image', 'images'));
  if (counts.styles) parts.push(n(counts.styles, 'stylesheet', 'stylesheets'));
  if (!parts.length) return '';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  const where = counts.hosts?.length ? ` from ${counts.hosts.join(', ')}` : '';
  const total = (counts.fonts || 0) + (counts.images || 0) + (counts.styles || 0);
  return `${list}${where} ${total === 1 ? 'was' : 'were'} not loaded. Dossier never fetches from other sites.`;
}
