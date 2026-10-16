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
 * and re-exported from here. What a static frame's links do is
 * js/frame-links.js, the one copy the app and both one-file exports share.
 */

import { embedDocument } from '../embed-policy.js';
import { safeHref } from '../render/url.js';
import { guardFrameLinks } from '../frame-links.js';
import { staticCopy, scriptedCopy } from './static-copy.js';
import { icon } from './icons.js';

export {
  staticCopy, scriptedCopy, stripRefresh, remoteResources, blockedSentence,
} from './static-copy.js';

// The link policy lives in js/frame-links.js, one copy for the app and both
// one-file exports; these names stay importable from here.
export { LINK_SELECTOR, linkAddress, scrollInsideFrame } from '../frame-links.js';

/** What a frame that keeps leaving its report shows in its place. */
const LEFT_NOTICE = embedDocument('<html lang="en"><head><title>Report not shown</title></head>'
  + '<body style="font: 15px/1.5 system-ui, sans-serif; margin: 24px; color: #333">'
  + '<p>This report kept opening other pages in its frame, so it is not shown here. Dossier format still shows its text.</p></body></html>', false);

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
  frame.srcdoc = embedDocument(staticCopy(html, { viewportHeight }), false);
  // Links, any other navigation, and the backstop that puts the frame back
  // on its report when something takes it away anyway: js/frame-links.js,
  // whose load listener is registered first, so nothing else reads a page
  // that is not the report.
  guardFrameLinks(frame, {
    onBlockedLink,
    onAnchor,
    contain,
    safeHref,
    leftNotice: LEFT_NOTICE,
    onRestored: typeof onRestored === 'function' ? onRestored : (left) => restoredNote(frame, left),
  });
  return frame;
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

/** The visible headings of a loaded static frame, in document order. */
export function frameHeadings(frame) {
  let doc = null;
  try {
    doc = frame.contentDocument;
  } catch {
    return [];
  }
  if (!doc) return [];
  // The prototype's own method: a named element in the report shadows a
  // member of its document (`<img name="querySelectorAll">`).
  return [...Document.prototype.querySelectorAll.call(doc, 'h1, h2, h3, h4, h5, h6')]
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
