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
 *
 * The documents the frames are handed are made in js/compare/static-copy.js
 * and re-exported from here.
 */

import { embedDocument } from '../embed-policy.js';
import { safeHref } from '../render/url.js';
import { staticCopy, scriptedCopy } from './static-copy.js';
import { icon } from './icons.js';

export {
  staticCopy, scriptedCopy, stripRefresh, remoteResources, blockedSentence,
} from './static-copy.js';

/** How many times a frame is put back before it shows a notice instead. */
const MAX_RESTORES = 3;

/** What a frame that keeps leaving its report shows in its place. */
const LEFT_NOTICE = embedDocument('<html lang="en"><head><title>Report not shown</title></head>'
  + '<body style="font: 15px/1.5 system-ui, sans-serif; margin: 24px; color: #333">'
  + '<p>This report kept opening other pages in its frame, so it is not shown here. Dossier format still shows its text.</p></body></html>', false);

/** True while a frame shows its own srcdoc, false for any other page. */
function showsSource(frame) {
  try {
    return frame.contentWindow?.location.href === 'about:srcdoc';
  } catch {
    // Another origin's page: its address cannot even be read.
    return false;
  }
}

/**
 * Put a frame that left its srcdoc back on it. `location.replace` works on
 * another origin's page too and adds no history entry of its own, so Back
 * never steps into the stray page; setting the attribute again is the
 * fallback.
 *
 * The stray navigation itself made an entry, and nothing here can take it
 * back: after a restore the first Back only returns the frame to the report.
 * A fresh frame element does not help (tried in Chromium: the entry stays,
 * pointing at a frame that is gone, and that Back does nothing at all). So
 * where the browser has the Navigation API the navigation is stopped before
 * it starts (`guardNavigation`) and this backstop is never reached; it is
 * for the browsers without it.
 */
function restoreSource(frame, source) {
  try {
    frame.contentWindow.location.replace('about:srcdoc');
  } catch {
    frame.setAttribute('srcdoc', source);
  }
}

/**
 * @param {string} html
 * @param {{title: string, onBlockedLink?: (href: string) => void,
 *   onAnchor?: (el: Element) => void, onRestored?: (left: boolean) => void,
 *   contain?: boolean, className?: string, viewportHeight?: number}} opts
 *   `onAnchor` replaces the frame's own scroll for an in-page link, for a
 *   frame sized to its document, which has nothing to scroll (the Reports
 *   view scrolls the page instead). `viewportHeight` goes to `staticCopy`.
 *   `onRestored` hears that the frame left the report and was put back
 *   (`left` true once it kept leaving and shows a notice instead); without
 *   it, the frame says so itself in a note above it (`restoredNote`). `contain` keeps a
 *   frame that scrolls inside itself from scrolling this page at its ends
 *   (a compare column; a frame sized to its document has no ends of its own).
 * @returns {HTMLIFrameElement}
 */
export function staticFrame(html, {
  title, onBlockedLink, onAnchor, onRestored, contain = false, className = 'col__frame', viewportHeight = 0,
} = {}) {
  const frame = document.createElement('iframe');
  frame.className = className;
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = title || 'Report, original layout';
  const source = embedDocument(staticCopy(html, { viewportHeight }), false);
  frame.srcdoc = source;
  // The backstop. Links are caught (`bindLinks`), what writes an address
  // with no click is taken out (`staticCopy`) and any other navigation is
  // stopped before it starts where the browser can (`guardNavigation`), so
  // nothing should take the frame away from its report; if something does,
  // the next load is another page, and the frame is put back on the report.
  // That load is stopped here, registered first, so nothing else reads a
  // page that is not the report.
  let loads = 0;
  let restores = 0;
  frame.addEventListener('load', (event) => {
    loads += 1;
    if (loads > 1 && !showsSource(frame)) {
      event.stopImmediatePropagation();
      restores += 1;
      const left = restores > MAX_RESTORES;
      if (left) frame.setAttribute('srcdoc', LEFT_NOTICE);
      else restoreSource(frame, source);
      if (typeof onRestored === 'function') onRestored(left);
      else restoredNote(frame, left);
      return;
    }
    bindLinks(frame, onBlockedLink, onAnchor);
    if (contain) containScroll(frame);
  });
  return frame;
}

/**
 * A static frame's own scroll stops at its ends instead of carrying on into
 * this page: the Compare view's page scrolls only to reach the footer, and a
 * column read to its end must not take the toolbar with it.
 */
function containScroll(frame) {
  try {
    frame.contentDocument?.documentElement?.style.setProperty('overscroll-behavior', 'contain');
  } catch {
    // Not the report's own page; the load that follows puts it back.
  }
}

/**
 * Say above a frame that it left the report and was put back, or that it
 * kept leaving and is shown no more, for a caller with no place of its own to
 * say it (the Reports view; a compare column passes `onRestored`). A status,
 * so it is read out as it appears. In the Reports view the frame sits in a
 * holder that also lays the outline's anchors over it at the frame's own
 * coordinates, so the note goes before the holder and the anchors stay put.
 */
function restoredNote(frame, left) {
  const holder = frame.parentElement;
  const spot = holder && holder.classList.contains('block-embed__frame') ? holder : frame;
  if (!spot.isConnected || !spot.parentNode) return;
  let line = spot.previousElementSibling;
  if (!line || !line.hasAttribute('data-embed-restored')) {
    line = document.createElement('p');
    line.className = 'embed-note';
    line.setAttribute('role', 'status');
    line.setAttribute('data-embed-restored', '');
    spot.before(line);
  }
  const text = left
    ? 'This report kept opening other pages in its frame, so it is not shown here. Dossier format still shows its text.'
    : 'Something in this report opened another page in its frame, so the report was loaded again from the top.';
  if (line.textContent === text) return;
  line.innerHTML = `${icon('info')}<span></span>`;
  line.lastElementChild.textContent = text;
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

const XLINK = 'http://www.w3.org/1999/xlink';

/**
 * Everything a click could follow: HTML links and image map areas, and every
 * SVG link, whether its address is `href`, `xlink:href` or an animation's.
 */
export const LINK_SELECTOR = 'a[href], a[*|href], area[href], svg a';

/** The address a link follows now: an SVG link's animated one when it has one. */
export function linkAddress(el) {
  const animated = el && el.href && typeof el.href === 'object' ? el.href.animVal : '';
  return String(animated || el?.getAttribute('href') || el?.getAttributeNS?.(XLINK, 'href') || '').trim();
}

/** The address of the frame's own document, as a navigation names it. */
const SELF = 'about:srcdoc#';

/**
 * Links in a static frame do what a reader expects without the report
 * deciding anything: an in-page link scrolls the frame, a web or mail
 * address opens in a new tab through `safeHref` (on a click or a middle
 * click), and anything else stays put and says why. The listener is this
 * page's, on the frame's document.
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
  /** What following `raw` does here: never a navigation of the frame. */
  const follow = (raw, middle) => {
    const key = raw.startsWith('#') ? raw.slice(1) : raw.startsWith(SELF) ? raw.slice(SELF.length) : null;
    if (key !== null) {
      if (middle) return;
      if (typeof onAnchor === 'function') onAnchor(anchorTarget(frame.contentDocument, key));
      else scrollToAnchor(frame, key);
      return;
    }
    const href = safeHref(raw);
    if (href && /^(https?:|mailto:)/i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (typeof onBlockedLink === 'function') onBlockedLink(raw);
  };
  const handler = (event) => {
    // Read from the click's composed path, not with `closest`: inside a
    // declarative shadow root (which the parser builds with no script) a
    // listener on the document sees the click retargeted to the root's host.
    // A closed root would hide its links from this path, so the static copy
    // builds every root open (js/compare/static-copy.js).
    const path = eventPath(event);
    const closest = (selector) => path.find((node) => node && node.nodeType === 1 && node.matches(selector)) || null;
    // A form in the report never submits (the sandbox has no allow-forms);
    // cancelling the click first spares the console the refusal.
    const submit = closest('button:not([type]), button[type="submit" i], input[type="submit" i], input[type="image" i]');
    if (submit && submit.form) {
      event.preventDefault();
      return;
    }
    const target = closest(LINK_SELECTOR);
    if (!target) {
      // A link an SVG <use> draws lives in a copy no listener out here can
      // read, so its address is unknown. A click there reaches the
      // navigation guard; a middle click, or a click with a modifier key,
      // would open a tab or window that no guard sees, so it does nothing.
      if (opensElsewhere(event) && drawnByUse(path)) event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // A middle click opens a web link in a new tab, as a click does; a right
    // click follows nothing.
    const middle = event.type === 'auxclick' && event.button === 1;
    if (event.type !== 'click' && !middle) return;
    const raw = linkAddress(target);
    // An SVG <a> with no address is not a link.
    if (raw) follow(raw, middle);
  };
  doc.addEventListener('click', handler, true);
  doc.addEventListener('auxclick', handler, true);
  guardNavigation(frame, follow);
}

/** The nodes an event passed through, innermost first, shadow roots included. */
function eventPath(event) {
  if (typeof event.composedPath === 'function') return event.composedPath();
  const chain = [];
  for (let node = event.target; node; node = node.parentNode) chain.push(node);
  return chain;
}

/** A middle click, or a click that a modifier key sends to a new tab or window. */
function opensElsewhere(event) {
  if (event.type === 'auxclick') return event.button === 1;
  return event.type === 'click' && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/** True when the innermost element an event reached is an SVG `<use>`. */
function drawnByUse(path) {
  const inner = path.find((node) => node && node.nodeType === 1);
  return Boolean(inner && inner.localName === 'use' && inner.namespaceURI === 'http://www.w3.org/2000/svg');
}

/** The frames' Navigation objects already guarded, one per document shown. */
const guarded = new WeakSet();

/**
 * Stop a navigation of the frame before it starts, where the browser has the
 * Navigation API (its `navigate` event fires in the frame's window for a
 * navigation the report's document starts, and this page's listener can
 * cancel it). Nothing should get this far, since links are caught first; a
 * navigation that does is cancelled, so the frame keeps its report and the
 * history gets no entry, which the load backstop in `staticFrame` cannot
 * undo. A reader who clicked something gets what a caught link gives;
 * anything else just does not happen. Back, Forward and a reload of the
 * report itself are left alone.
 */
function guardNavigation(frame, follow) {
  let nav = null;
  try {
    nav = frame.contentWindow?.navigation || null;
  } catch {
    nav = null;
  }
  if (!nav || guarded.has(nav)) return;
  guarded.add(nav);
  nav.addEventListener('navigate', (event) => {
    if (!event.cancelable || event.navigationType === 'traverse' || event.navigationType === 'reload') return;
    event.preventDefault();
    if (!event.userInitiated) return;
    const raw = String(event.destination?.url || '');
    const written = asWritten(frame, raw);
    if (written === null) follow(raw, false);
    else if (written) follow(written, false);
  });
}

/**
 * A navigation's destination in the report's own terms, when the report
 * wrote a relative address. A srcdoc document has no address of its own, so
 * its relative links resolve against this page's: `other.html` arrives as
 * this site's `/other.html` and `#notes` as this page's address with
 * `#notes` on it. Opened as they arrive, they would load Dossier itself in a
 * new tab. Back in the report's terms they are what a caught link is: `#key`
 * for a place in the report, a relative path for a file beside it, or ''
 * for the report itself (nothing to do). Null for an address elsewhere.
 */
function asWritten(frame, raw) {
  let url = null;
  let base = null;
  try {
    url = new URL(raw);
    base = new URL(frame.contentDocument?.baseURI || document.baseURI);
  } catch {
    return null;
  }
  if (url.origin === 'null' || url.origin !== base.origin) return null;
  const [where, ...hash] = url.href.split('#');
  if (where === base.href.split('#')[0]) return hash.length && hash.join('#') ? `#${hash.join('#')}` : '';
  const dir = new URL('.', base).href;
  let rel = url.href.startsWith(dir) ? url.href.slice(dir.length) : `${url.pathname}${url.search}${url.hash}`;
  try { rel = decodeURI(rel); } catch { /* keep it encoded */ }
  // A first segment with a colon in it would read as a scheme.
  if (!rel || /^[^/?#]*:/.test(rel)) rel = `./${rel}`;
  return rel;
}

/** The longest link address a toast repeats; a longer one is cut short. */
const LINK_SHOWN = 80;

/**
 * Why a link in a static frame did nothing, for `onBlockedLink`. A relative
 * address names a file that sat beside the report; anything with a scheme of
 * its own (`data:`, `file:`, `javascript:`) was refused, and the sentence
 * says so without repeating it.
 */
export function blockedLinkSentence(href) {
  const raw = String(href || '').trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
    return 'That link was not opened: Dossier only opens web and mail links.';
  }
  const shown = raw.length > LINK_SHOWN ? `${raw.slice(0, LINK_SHOWN - 1)}\u2026` : raw;
  return `That link points at ${shown}, a file beside the report that Dossier does not have.`;
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
