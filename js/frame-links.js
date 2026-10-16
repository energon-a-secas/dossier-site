/**
 * The one link policy for a static report frame: a srcdoc frame with
 * `sandbox="allow-same-origin"` and no scripts, whose links the parent page
 * handles from listeners of its own. Used by the app (js/compare/frame.js
 * `staticFrame`, for a compare column and the Reports view) and shipped as
 * source in both one-file exports: js/export.js beside `fitEmbedFrames`, and
 * js/compare/export.js beside `comparisonRuntime`. The comparison export used
 * to carry no link handling at all, so a link in an Original column loaded
 * the whole comparison, or the server's 404 page, into the column, and its
 * scroll sync was lost until the file was opened again.
 *
 * Self-contained on purpose, because it travels by `.toString()`: no
 * imports, no module constants, and nothing outside its own body.
 *
 * What a reader gets, without the report deciding anything:
 * - an in-page link (`#key`, or `about:srcdoc#key`) scrolls to its target
 *   inside the frame, panes of the report's own included, and puts every
 *   scroller of the parent page back; `opts.onAnchor(el|null)` replaces that
 *   for a frame sized to its document, which has nothing to scroll;
 * - a web or mail address opens in a new tab on a click or a middle click,
 *   through `opts.safeHref` when the caller has it;
 * - anything else stays put, and `opts.onBlockedLink(raw)` hears about it.
 * SVG links count (`xlink:href`, an animated address), and so do links in
 * declarative shadow roots, read from the click's composed path. Any other
 * navigation of the frame is stopped before it starts where the browser has
 * the Navigation API. For the browsers without it, the load backstop puts a
 * frame that left its report back on it, at most three times, then shows a
 * notice; `opts.onRestored(left)` hears about it, or a status note is written
 * above the frame.
 *
 * The report's document is not trusted to answer for itself: a named element
 * shadows the members of `document` (`<img name="addEventListener">`), so
 * the methods this calls on it are the prototypes' own, and what it marks as
 * done lives in this function's closure, never as an expando on the document.
 * The static copy also takes such names out (js/compare/static-copy.js).
 *
 * `guardFrameLinks(null)` returns the pieces other modules share, so there
 * is one copy of each: `{selector, address, inside}`.
 *
 * @param {HTMLIFrameElement|null} frame
 * @param {{onBlockedLink?: (raw: string) => void, onAnchor?: (el: Element|null) => void,
 *   onRestored?: (left: boolean) => void, contain?: boolean,
 *   safeHref?: (raw: string) => string|null, leftNotice?: string}} [opts]
 *   `contain` stops a frame that scrolls inside itself from scrolling the
 *   page at its ends. `leftNotice` is the document a frame that keeps
 *   leaving its report shows instead.
 * @returns {{follow: (raw: string, middle: boolean) => void, inside: (el: Element|null) => void}
 *   |{selector: string, address: (el: Element) => string, inside: (frame: HTMLIFrameElement, el: Element|null) => void}}
 */
export function guardFrameLinks(frame, opts) {
  var o = opts || {};
  var MAX_RESTORES = 3;
  var SELF = 'about:srcdoc#';
  var XLINK = 'http://www.w3.org/1999/xlink';
  var SVG = 'http://www.w3.org/2000/svg';
  // Everything a click could follow: HTML links and image map areas, and
  // every SVG link, whether its address is `href`, `xlink:href` or an
  // animation's.
  var LINK = 'a[href], a[*|href], area[href], svg a';
  var SUBMIT = 'button:not([type]), button[type="submit" i], input[type="submit" i], input[type="image" i]';
  var LEFT = 'This report kept opening other pages in its frame, so it is not shown here.';
  var BACK = 'Something in this report opened another page in its frame, so the report was loaded again from the top.';
  var DOC = typeof Document === 'function' ? Document.prototype : null;
  var EVENTS = typeof EventTarget === 'function' ? EventTarget.prototype : null;
  var MATCHES = typeof Element === 'function' ? Element.prototype.matches : null;

  if (!frame) return { selector: LINK, address: linkAddress, inside: inside };
  if (frame.dossierLinks) return frame.dossierLinks;

  var source = frame.getAttribute('srcdoc') || '';
  var bound = new WeakSet();
  var navs = new WeakSet();
  var shown = false;
  var restores = 0;
  var handle = {
    follow: follow,
    inside: function (el) { inside(frame, el); },
  };
  frame.dossierLinks = handle;
  // Registered first, before anything else listens for a load, so a page
  // that is not the report is stopped here and nothing else reads it.
  frame.addEventListener('load', onLoad);
  // A frame already showing its report (the export's script runs after its
  // frames may have loaded) is bound now.
  if (showsSource()) {
    shown = true;
    bind();
  }
  return handle;

  function documentOf() {
    try {
      return frame.contentDocument;
    } catch (e) {
      return null;
    }
  }

  /** True while the frame shows its own srcdoc, false for any other page. */
  function showsSource() {
    try {
      return frame.contentWindow.location.href === 'about:srcdoc';
    } catch (e) {
      // Another origin's page: its address cannot even be read.
      return false;
    }
  }

  /**
   * The backstop. Links are caught and other navigations stopped where the
   * browser can, so nothing should take the frame away; if something does,
   * the next load is another page, and the frame is put back on the report.
   * `location.replace` works on another origin's page and adds no history
   * entry of its own; setting the attribute again is the fallback. The stray
   * navigation made an entry, which nothing here can take back.
   */
  function onLoad(event) {
    if (showsSource()) {
      shown = true;
      bind();
      return;
    }
    if (!shown) return;
    event.stopImmediatePropagation();
    restores += 1;
    var left = restores > MAX_RESTORES;
    if (left) {
      frame.setAttribute('srcdoc', o.leftNotice || ('<!DOCTYPE html><meta charset="utf-8">'
        + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'
        + '<title>Report not shown</title><p style="font: 15px/1.5 system-ui, sans-serif; margin: 24px; color: #333">' + LEFT + '</p>'));
    } else {
      try {
        frame.contentWindow.location.replace('about:srcdoc');
      } catch (e) {
        frame.setAttribute('srcdoc', source);
      }
    }
    if (typeof o.onRestored === 'function') o.onRestored(left);
    else note(left);
  }

  /**
   * Say above the frame that it left the report and was put back, for a
   * caller with no place of its own to say it. A status, so it is read out
   * as it appears. A frame in a holder (the Reports view lays the outline's
   * anchors over it) gets the note before the holder.
   */
  function note(left) {
    var holder = frame.parentElement;
    var spot = holder && holder.classList && holder.classList.contains('block-embed__frame') ? holder : frame;
    if (!spot.isConnected || !spot.parentNode) return;
    var line = spot.previousElementSibling;
    if (!line || !line.hasAttribute('data-embed-restored')) {
      line = frame.ownerDocument.createElement('p');
      line.className = 'embed-note';
      line.setAttribute('role', 'status');
      line.setAttribute('data-embed-restored', '');
      spot.parentNode.insertBefore(line, spot);
    }
    var text = left ? LEFT : BACK;
    if (line.textContent !== text) line.textContent = text;
  }

  /** Bind the report's document once: its clicks, its navigations, its ends. */
  function bind() {
    var doc = documentOf();
    if (!doc || bound.has(doc)) return;
    bound.add(doc);
    listen(doc, 'click', handler);
    listen(doc, 'auxclick', handler);
    guardNavigation();
    if (o.contain) {
      try {
        rootOf(doc).style.setProperty('overscroll-behavior', 'contain');
      } catch (e) {
        // No root to hold: nothing scrolls past it either.
      }
    }
  }

  function listen(doc, type, fn) {
    if (EVENTS) EVENTS.addEventListener.call(doc, type, fn, true);
    else doc.addEventListener(type, fn, true);
  }

  function rootOf(doc) {
    var d = DOC && Object.getOwnPropertyDescriptor(DOC, 'documentElement');
    return d && d.get ? d.get.call(doc) : doc.documentElement;
  }

  function matches(node, selector) {
    return MATCHES ? MATCHES.call(node, selector) : node.matches(selector);
  }

  function handler(event) {
    // Read from the click's composed path, not with `closest`: inside a
    // declarative shadow root (which the parser builds with no script) a
    // listener on the document sees the click retargeted to the root's
    // host. A closed root would hide its links from this path, so the
    // static copy builds every root open.
    var path = [];
    if (typeof event.composedPath === 'function') path = event.composedPath();
    else for (var node = event.target; node; node = node.parentNode) path.push(node);
    var closest = function (selector) {
      for (var i = 0; i < path.length; i += 1) {
        if (path[i] && path[i].nodeType === 1 && matches(path[i], selector)) return path[i];
      }
      return null;
    };
    // A form in the report never submits (the sandbox has no allow-forms);
    // cancelling the click first spares the console the refusal.
    var submit = closest(SUBMIT);
    if (submit && submit.form) {
      event.preventDefault();
      return;
    }
    var target = closest(LINK);
    if (!target) {
      // A link an SVG <use> draws lives in a copy no listener out here can
      // read, so its address is unknown. A click there reaches the
      // navigation guard; a middle click, or a click with a modifier key,
      // would open a tab or window that no guard sees, so it does nothing.
      var elsewhere = event.type === 'auxclick' ? event.button === 1
        : event.type === 'click' && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
      var inner = null;
      for (var j = 0; j < path.length && !inner; j += 1) if (path[j] && path[j].nodeType === 1) inner = path[j];
      if (elsewhere && inner && inner.localName === 'use' && inner.namespaceURI === SVG) event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // A middle click opens a web link in a new tab, as a click does; a
    // right click follows nothing.
    var middle = event.type === 'auxclick' && event.button === 1;
    if (event.type !== 'click' && !middle) return;
    var raw = linkAddress(target);
    // An SVG <a> with no address is not a link.
    if (raw) follow(raw, middle);
  }

  /** The address a link follows now: an SVG link's animated one when it has one. */
  function linkAddress(el) {
    var animated = el && el.href && typeof el.href === 'object' ? el.href.animVal : '';
    return String(animated || (el && el.getAttribute('href')) || (el && el.getAttributeNS && el.getAttributeNS(XLINK, 'href')) || '').trim();
  }

  /**
   * Stop a navigation of the frame before it starts, where the browser has
   * the Navigation API (its `navigate` event fires in the frame's window for
   * a navigation the report's document starts, and this listener can cancel
   * it). The frame keeps its report and the history gets no entry, which the
   * backstop cannot undo. A reader who clicked something gets what a caught
   * link gives. Back, Forward and a reload of the report are left alone.
   */
  function guardNavigation() {
    var nav = null;
    try {
      nav = (frame.contentWindow && frame.contentWindow.navigation) || null;
    } catch (e) {
      nav = null;
    }
    if (!nav || navs.has(nav)) return;
    navs.add(nav);
    nav.addEventListener('navigate', function (event) {
      if (!event.cancelable || event.navigationType === 'traverse' || event.navigationType === 'reload') return;
      event.preventDefault();
      if (!event.userInitiated) return;
      var raw = String((event.destination && event.destination.url) || '');
      var written = asWritten(raw);
      if (written === null) follow(raw, false);
      else if (written) follow(written, false);
    });
  }

  /**
   * A navigation's destination in the report's own terms. A srcdoc document
   * has no address of its own, so its relative links resolve against the
   * parent page's: `other.html` arrives as a file beside this page and
   * `#notes` as this page's address with `#notes` on it. Opened as they
   * arrive, they would load the parent page itself. Back in the report's
   * terms they are what a caught link is: `#key` for a place in the report,
   * a relative path for a file beside it, or '' for the report itself
   * (nothing to do). Null for an address elsewhere.
   */
  function asWritten(raw) {
    var url = null;
    var base = null;
    try {
      url = new URL(raw);
      base = new URL((frame.ownerDocument || document).baseURI);
    } catch (e) {
      return null;
    }
    var where = url.href.split('#');
    if (where[0] === base.href.split('#')[0]) {
      var mark = where.slice(1).join('#');
      return mark ? '#' + mark : '';
    }
    if (url.origin === 'null' || url.origin !== base.origin) return null;
    var dir = new URL('.', base).href;
    var rel = url.href.indexOf(dir) === 0 ? url.href.slice(dir.length) : url.pathname + url.search + url.hash;
    try { rel = decodeURI(rel); } catch (e) { /* keep it encoded */ }
    // A first segment with a colon in it would read as a scheme.
    if (!rel || /^[^/?#]*:/.test(rel)) rel = './' + rel;
    return rel;
  }

  /** What following `raw` does here: never a navigation of the frame. */
  function follow(raw, middle) {
    var key = raw.charAt(0) === '#' ? raw.slice(1) : raw.indexOf(SELF) === 0 ? raw.slice(SELF.length) : null;
    if (key !== null) {
      if (middle) return;
      var el = anchorTarget(key);
      if (typeof o.onAnchor === 'function') o.onAnchor(el);
      else scrollToAnchor(el);
      return;
    }
    var href = webAddress(raw);
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (typeof o.onBlockedLink === 'function') o.onBlockedLink(raw);
  }

  /**
   * A web or mail address, parsed the way the browser would follow it, so a
   * script address cannot hide behind a tab, a line break or an entity. A
   * relative address names a file the frame does not have.
   */
  function webAddress(raw) {
    var href = typeof o.safeHref === 'function' ? o.safeHref(raw) : raw;
    if (!href) return null;
    var url = null;
    try {
      url = new URL(href);
    } catch (e) {
      return null;
    }
    return /^(https?:|mailto:)$/.test(url.protocol) ? url.href : null;
  }

  /** The element an in-page link names, by id or by name, or null for the top. */
  function anchorTarget(key) {
    var doc = documentOf();
    if (!doc) return null;
    var name = key;
    try { name = decodeURIComponent(key); } catch (e) { /* keep the raw key */ }
    if (!name) return null;
    var byId = DOC ? DOC.getElementById.call(doc, name) : doc.getElementById(name);
    if (byId) return byId;
    var named = DOC ? DOC.getElementsByName.call(doc, name) : doc.getElementsByName(name);
    return (named && named[0]) || null;
  }

  function scrollToAnchor(el) {
    var win = frame.contentWindow;
    if (!win) return;
    var top = el ? el.getBoundingClientRect().top + win.scrollY - 16 : 0;
    win.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    // A report whose window does not scroll (an app shell, its `main` the
    // scroller) leaves the target where it was; its own panes have to move.
    if (el) {
      var at = el.getBoundingClientRect().top;
      if (at < 0 || at >= win.innerHeight) inside(frame, el);
    }
  }

  /**
   * Bring an element of a static frame's document into view inside the
   * frame, in whatever scrolls there: the frame's window, or a pane of the
   * report's own, which a scroll of the frame's window never moves. The
   * browser carries `scrollIntoView` on out of the frame into the page;
   * every scroller of the page is put back where it was, so the caller
   * decides how, and whether, the page moves.
   */
  function inside(box, el) {
    if (!box || !el || typeof el.scrollIntoView !== 'function') return;
    var kept = [];
    for (var up = box.parentElement; up; up = up.parentElement) kept.push([up, up.scrollTop, up.scrollLeft]);
    var x = window.scrollX;
    var y = window.scrollY;
    el.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    for (var k = 0; k < kept.length; k += 1) {
      if (kept[k][0].scrollTop !== kept[k][1] || kept[k][0].scrollLeft !== kept[k][2]) {
        kept[k][0].scrollTo({ top: kept[k][1], left: kept[k][2], behavior: 'instant' });
      }
    }
    if (window.scrollX !== x || window.scrollY !== y) window.scrollTo({ left: x, top: y, behavior: 'instant' });
  }
}

/** The pieces js/compare/frame.js re-exports, taken from the one copy above. */
const shared = guardFrameLinks(null);

/** Everything a click in a static frame could follow. */
export const LINK_SELECTOR = shared.selector;

/** The address a link follows now: an SVG link's animated one when it has one. */
export const linkAddress = shared.address;

/**
 * Bring an element of a static frame's document into view inside the frame,
 * putting every scroller of this page back where it was.
 *
 * @param {HTMLIFrameElement} frame
 * @param {Element|null} el
 */
export const scrollInsideFrame = shared.inside;
