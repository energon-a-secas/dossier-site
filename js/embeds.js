/**
 * Imported HTML reports in the Reports view, and the sealed host's handshake.
 *
 * js/render/embed.js renders a live embed as a shell: the view controls, an
 * empty body, and the source in `data-embed-html`. This module builds the
 * view the reader chose into that body, the moment the shell reaches the
 * stage (a MutationObserver, so the renderer stays a pure function of the
 * document and the choice stays reader state):
 *
 *   original     the static frame from js/compare/frame.js, sized to its
 *                document by js/embed-fit.js, its links opened in a new tab
 *                through `safeHref`, its in-page links scrolling the page
 *   format       Dossier format, drawn from the compare IR
 *   interactive  the sealed `embed.html` host, which the handshake below
 *                feeds
 *
 * Printed, a frame is one box sliced at every page break, so while the page
 * prints each frame's report is also there in Dossier format, shown on paper
 * in the frame's place (`addPrintCopies`).
 *
 * The rail outline (js/render/outline.js) names the headings `<prefix>-h<n>`.
 * The Dossier format writes those ids itself; for a frame, an anchor with
 * the same id is laid over each heading, so an outline link scrolls to it in
 * every view, and focus moves on into the heading inside the frame. A held
 * frame (js/embed-fit.js) scrolls inside itself, often in a pane of the
 * report's own: its anchors all sit at its top, and the heading is brought
 * into view inside the frame (`scrollInsideFrame`).
 *
 * The choice is remembered per report (its id once saved, and its content
 * for a link or an unsaved import) in a store of its own, never in the
 * document.
 */

import { registerActions } from './actions.js';
import { state } from './state.js';
import { createStore } from './neorgon-persist.js';
import { showToast } from './neorgon-dom.js';
import { staticFrame, interactiveFrame, frameHeadings, scrollInsideFrame, blockedLinkSentence } from './compare/frame.js';
import { htmlOutline } from './compare/normalize.js';
import {
  EMBED_VIEWS, embedViewOf, embedFrameTitle, embedNote, formatMarkup, originalNotes, SCRIPTS_NOTE, PRINT_CAPTION,
} from './render/embed.js';
import { fnv1a } from './hash.js';
import { reducedMotion } from './motion.js';
import { embedHeadingPrefix } from './render/outline.js';
import { fitEmbedFrames } from './embed-fit.js';
import { checkRadios, bindGroupKeys } from './seg.js';
import { bindFrameFocus } from './frame-focus.js';
import { fitScrollRegions } from './scroll-regions.js';

const LIVE = '.block-embed-html--live';
const views = createStore({ key: 'dossier-site:embed-views', version: 1 });
/** How many reports' choices the store keeps; the oldest goes first. */
const VIEW_ENTRIES = 100;
/** A choice made this session, for when storage is unavailable. */
const chosen = new Map();
/**
 * The last fitted height of each report's Original view. A re-render (Edit,
 * Done, a theme change) rebuilds the frame; starting it at its old height
 * keeps the page as long as it was while the frame reloads, so the reader's
 * place on the page is not lost. Only a placeholder: js/embed-fit.js measures
 * the document afresh once it loads, and the frame shrinks or grows to that.
 */
const heights = new Map();
/** What each shell shows: its source, read once from the attribute. */
const infos = new WeakMap();
let bound = false;

/**
 * Bind once: the handshake for the sealed host, the view controls and their
 * arrow keys, in-page links in the Dossier format, the hydration of every
 * live shell, and the focus ring for every report frame on the page
 * (js/frame-focus.js), the Compare view's included.
 */
export function bindEmbeds() {
  if (bound) return;
  bound = true;
  window.addEventListener('message', handshake);
  window.addEventListener('beforeprint', addPrintCopies);
  window.addEventListener('afterprint', removePrintCopies);
  registerActions({ 'embed-view': chooseView });
  document.addEventListener('click', localLink);
  bindFrameFocus();
  const root = document.getElementById('stage') || document.body;
  // Only the view row: no other group in the stage takes arrow keys here.
  bindGroupKeys(root, '.embed-bar__views');
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node.nodeType === 1) hydrateIn(node);
    }
  }).observe(root, { childList: true, subtree: true });
  hydrateIn(root);
}

/** Send markup only to the specific sandboxed frame that requested it. */
function handshake(event) {
  if (event.data?.type !== 'dossier-embed-ready') return;
  for (const frame of document.querySelectorAll('iframe[data-embed-html]')) {
    if (frame.contentWindow !== event.source || frame.dataset.embedLoaded) continue;
    frame.dataset.embedLoaded = 'true';
    // Opaque origins require '*'; the WindowProxy identity binds this payload.
    frame.contentWindow.postMessage({ type: 'dossier-embed-content', html: frame.dataset.embedHtml }, '*');
    break;
  }
}

function hydrateIn(node) {
  if (node.matches?.(LIVE)) hydrate(node);
  for (const el of node.querySelectorAll?.(LIVE) || []) hydrate(el);
}

function hydrate(wrapper) {
  if (infos.has(wrapper)) return;
  const html = wrapper.getAttribute('data-embed-html') || '';
  // Read once and dropped: the page keeps no second copy of a large source.
  wrapper.removeAttribute('data-embed-html');
  const info = {
    html,
    scripts: wrapper.dataset.embedScripts === 'true',
    prefix: wrapper.dataset.embedPrefix || 'embed',
    name: wrapper.dataset.embedName || 'HTML report',
    fp: fingerprint(html),
  };
  infos.set(wrapper, info);
  show(wrapper, storedView(info));
}

// ── The reader's choice ──────────────────────────────────────────────────────

const prints = [];

/** A cheap fingerprint of a source, for a report that has no id yet. */
function fingerprint(html) {
  const hit = prints.find((entry) => entry.html === html);
  if (hit) return hit.fp;
  const fp = `${html.length.toString(36)}.${fnv1a(html).toString(36)}`;
  prints.unshift({ html, fp });
  prints.length = Math.min(prints.length, 4);
  return fp;
}

function keysOf(info) {
  const keys = [];
  if (state.reportId) keys.push(`r:${state.reportId}#${info.prefix}`);
  keys.push(`h:${info.fp}`);
  return keys;
}

function readViews() {
  const all = views.load({});
  return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
}

function storedView(info) {
  const all = readViews();
  for (const key of keysOf(info)) {
    const view = chosen.get(key) || all[key];
    if (EMBED_VIEWS.includes(view)) return embedViewOf({ scripts: info.scripts }, view);
  }
  return 'original';
}

function remember(info, view) {
  const all = readViews();
  for (const key of keysOf(info)) {
    chosen.set(key, view);
    // Deleted first, so the key moves to the end: the oldest choices are
    // the ones the cap drops.
    delete all[key];
    all[key] = view;
  }
  const keys = Object.keys(all);
  for (const key of keys.slice(0, Math.max(0, keys.length - VIEW_ENTRIES))) delete all[key];
  views.save(all);
}

/**
 * The view the reader has on screen for an embed block, for the one-file
 * export (js/export.js), which exports what the reader is looking at.
 *
 * @param {object} block
 * @returns {'original'|'format'|'interactive'}
 */
export function embedViewFor(block) {
  if (!block || typeof block.html !== 'string') return 'original';
  return storedView({ scripts: block.scripts === true, prefix: embedHeadingPrefix(block), fp: fingerprint(block.html) });
}

function chooseView(el) {
  const wrapper = el.closest(LIVE);
  const info = wrapper && infos.get(wrapper);
  if (!info) return;
  let view = el.dataset.view;
  // "Run the report's scripts" is a toggle on the Original view.
  if (view === 'interactive' && wrapper.dataset.embedView === 'interactive') view = 'original';
  view = embedViewOf({ scripts: info.scripts }, view);
  if (view === wrapper.dataset.embedView) return;
  remember(info, view);
  show(wrapper, view);
}

// ── Drawing a view ───────────────────────────────────────────────────────────

/** A reader's screen, for the `vh` units of a frame sized to its document. */
function viewportHeight() {
  return Math.max(480, Math.min(1200, Math.round(window.innerHeight || 800)));
}

function show(wrapper, wanted) {
  const info = infos.get(wrapper);
  const view = embedViewOf({ scripts: info.scripts }, wanted);
  wrapper.dataset.embedView = view;
  // Running the scripts is the Original view with its toggle on.
  checkRadios(wrapper, '.embed-bar__views > [role="radio"]', view === 'format' ? 'format' : 'original', 'view');
  const run = wrapper.querySelector('.embed-bar__scripts');
  if (run) {
    run.setAttribute('aria-pressed', String(view === 'interactive'));
    run.hidden = view === 'format';
  }

  const body = wrapper.querySelector(':scope > .block-embed__body');
  if (!body) return;
  for (const frame of body.querySelectorAll('iframe')) frame.dossierFit?.stop();
  body.replaceChildren();
  body.className = `block-embed__body block-embed__body--${view}`;

  if (view === 'format') {
    body.innerHTML = formatMarkup(info.html, info.prefix);
    // A table is a focusable region only while it scrolls sideways.
    fitScrollRegions(body);
    return;
  }

  const holder = document.createElement('div');
  holder.className = 'block-embed__frame';
  const title = embedFrameTitle(info.name, view);

  if (view === 'interactive') {
    body.insertAdjacentHTML('beforeend', embedNote(SCRIPTS_NOTE, 'This view runs the report’s own scripts.'));
    holder.append(interactiveFrame(info.html, { title, className: 'block-embed block-embed--interactive' }));
    body.append(holder);
    placeAnchors(holder, info, null);
    return;
  }

  const notes = originalNotes(info.html);
  if (notes.length) body.insertAdjacentHTML('beforeend', notes.join(''));
  const frame = staticFrame(info.html, {
    title,
    className: 'block-embed block-embed--static',
    viewportHeight: viewportHeight(),
    onAnchor: (el) => revealInFrame(holder, frame, el),
    onBlockedLink: (href) => showToast(blockedLinkSentence(href), { duration: 4000 }),
  });
  frame.setAttribute('data-embed-fit', '');
  const key = `${info.fp}|${info.prefix}`;
  if (heights.has(key)) frame.style.height = `${heights.get(key)}px`;
  frame.addEventListener('dossier-embed-fit', (event) => {
    heights.set(key, event.detail.height);
    placeAnchors(holder, info, frame);
  });
  frame.addEventListener('load', () => placeAnchors(holder, info, frame));
  holder.append(frame);
  body.append(holder);
  fitEmbedFrames(holder);
}

// ── Printing ─────────────────────────────────────────────────────────────────

/**
 * Printed from the browser's own menu, a frame is one box: the block moved
 * whole to the next page, then sliced at each page break with lines cut in
 * half. So each report shown in a frame gets a Dossier format copy for the
 * paper (css/blocks.css shows it there and hides the frame), added before
 * printing and taken away after. The frames on screen are not rebuilt, so a
 * report running its scripts keeps its state. Share and export's Print
 * renders the whole report in Dossier format itself and needs none of this.
 */
function addPrintCopies() {
  for (const wrapper of document.querySelectorAll(LIVE)) {
    const info = infos.get(wrapper);
    const body = wrapper.querySelector(':scope > .block-embed__body');
    if (!info || !body || wrapper.dataset.embedView === 'format' || body.querySelector(':scope > .block-embed__print')) continue;
    // Its own heading ids, so none repeats an outline anchor's.
    const markup = formatMarkup(info.html, `${info.prefix}-print`);
    body.insertAdjacentHTML('beforeend', `<div class="block-embed__print">${PRINT_CAPTION}${markup}</div>`);
  }
}

function removePrintCopies() {
  for (const copy of document.querySelectorAll('.block-embed__print')) copy.remove();
}

// ── Headings and in-page links ───────────────────────────────────────────────

const norm = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * One anchor per heading of the report, laid over that heading in the frame
 * (or at the frame's top, for the sealed host, which cannot be read, and for
 * a held frame, whose headings move as its own panes scroll), with the id the
 * outline links to. Headings are matched in order by their text, so a
 * heading the frame hides by style takes the place of the one before.
 */
function placeAnchors(holder, info, frame) {
  let layer = holder.querySelector(':scope > .block-embed__anchors');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'block-embed__anchors';
    layer.addEventListener('focusin', (event) => focusHeading(event.target));
    holder.append(layer);
  }
  const wanted = htmlOutline(info.html).slice(0, 400);
  const found = frame ? frameHeadings(frame) : [];
  const held = isHeld(frame);
  const win = frame?.contentWindow || null;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + (win?.scrollY || 0), left: r.left, width: r.width, height: r.height };
  };
  const anchors = [];
  let next = 0;
  let last = null;
  for (const heading of wanted) {
    const text = norm(heading.text);
    let match = -1;
    for (let k = next; k < Math.min(found.length, next + 8); k += 1) {
      const seen = norm(found[k].text);
      if (seen === text || (text && (seen.startsWith(text.slice(0, 30)) || text.startsWith(seen.slice(0, 30))))) {
        match = k;
        break;
      }
    }
    if (match >= 0) {
      next = match + 1;
      last = found[match];
    }
    // Empty, so a screen reader finds nothing here: focus that lands on it
    // moves on into the heading itself (`focusHeading`).
    const span = document.createElement('span');
    span.className = 'embed-anchor';
    span.id = `${info.prefix}-h${heading.n}`;
    const spot = held ? null : match >= 0 ? box(found[match].el) : last ? box(last.el) : null;
    if (spot) {
      span.style.cssText = `top:${Math.round(spot.top)}px;left:${Math.round(spot.left)}px;width:${Math.round(spot.width)}px;height:${Math.round(spot.height)}px`;
    }
    if (match >= 0) span.dataset.matched = String(match);
    anchors.push(span);
  }
  layer.replaceChildren(...anchors);
}

/**
 * An outline link focused an anchor: move on into the heading it covers, or
 * to the sealed host's frame, whose headings cannot be reached from here.
 */
function focusHeading(anchor) {
  const holder = anchor.closest('.block-embed__frame');
  const sealed = holder?.querySelector('iframe.block-embed--interactive');
  if (sealed) {
    sealed.focus({ preventScroll: true });
    return;
  }
  const frame = holder?.querySelector('iframe.block-embed--static');
  if (!frame || !anchor.dataset.matched) return;
  const heading = frameHeadings(frame)[Number(anchor.dataset.matched)]?.el;
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  if (!isHeld(frame)) {
    heading.focus({ preventScroll: true });
    return;
  }
  // The anchor is at the frame's top: the heading comes into view inside the
  // frame, and the page goes on to the frame's top. Scrolling inside put this
  // page's scroll back, which can stop the scroll the outline started, so the
  // page is sent on to the anchor again.
  scrollInsideFrame(frame, heading);
  heading.focus({ preventScroll: true });
  anchor.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/** A frame held at most of the window's height, scrolling inside itself. */
function isHeld(frame) {
  return frame?.getAttribute('data-embed-fit') === 'held';
}

/**
 * An in-page link inside the frame. A fitted frame has no scroll of its own,
 * so the page scrolls to the target, through a marker placed over it. A held
 * frame scrolls inside itself, in its window or in a pane of the report's
 * own: the target is brought into view there, and the page scrolls to the
 * frame's top.
 */
function revealInFrame(holder, frame, el) {
  const held = isHeld(frame);
  if (held) scrollInsideFrame(frame, el || frame.contentDocument?.documentElement || null);
  const marker = document.createElement('span');
  marker.className = 'embed-anchor';
  marker.setAttribute('aria-hidden', 'true');
  marker.style.top = `${held || !el ? 0 : Math.round(el.getBoundingClientRect().top)}px`;
  holder.append(marker);
  marker.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  marker.remove();
}

/** A link to a heading inside the Dossier format: scroll to it, keep the route. */
function localLink(event) {
  const link = event.target.closest?.('.block-embed-reader a[data-local]');
  if (!link || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const target = document.getElementById((link.getAttribute('href') || '').slice(1));
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}
