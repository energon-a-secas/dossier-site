/**
 * Size an imported HTML report's static frame to its document, so the report
 * scrolls with the page instead of inside a box of its own.
 *
 * The frame this works on is the static one (js/compare/frame.js): srcdoc,
 * `sandbox="allow-same-origin"`, no scripts. Being same-origin is what lets
 * this page read the document's height; nothing here runs inside the report,
 * every listener and observer belongs to this page.
 *
 * The height is measured afresh every time, from a probe, never from the
 * frame's current height. A document whose root is sized to its frame
 * (`html, body {height: 100%}`, which the Alioth roadmap uses) reports the
 * frame's own height when measured at that height, so a frame measured in
 * place could grow and never shrink: a window made narrower and then wide
 * again left thousands of pixels of blank paper under the report. The probe
 * is a frame as tall as the reader's window (so a `max-height` media query
 * reads what the author meant), then smaller ones when the document exactly
 * fills it, and the result is settled at its own height, where a height
 * media query can still move it a little. Probing, reading and setting the
 * final height all happen in one animation frame, before the browser paints,
 * so the probes are never seen.
 *
 * A document that has no height of its own (an app shell whose panes scroll,
 * a section at 100% of a body at 100%) grows with whatever frame it gets.
 * Such a frame is held at most of the window's height and scrolls inside
 * itself, as the page would in a tab of its own; it is marked
 * `data-embed-fit="held"`.
 *
 * Self-contained on purpose: js/export.js ships this function's source in
 * the one-file export, the way `bindComparisons` travels, so it must not
 * reach for anything outside its own body (no imports, no module constants).
 *
 * `opts.links` also handles the report's links, for the export, where
 * js/compare/frame.js is not there to do it: an in-page link scrolls the page
 * to its target (in a held frame, the frame's own panes to the target and the
 * page to the frame), a web or mail address opens in a new tab on a click or
 * a middle click, anything else stays put. SVG links count, `xlink:href` and
 * animated addresses included. Any other navigation of the frame is stopped
 * before it starts where the browser has the Navigation API. And, as
 * frame.js does in the app, it is the backstop for the browsers without it:
 * once the frame has shown its report, a load of any other page puts the
 * report back (at most three times, then a notice) and says so in a note
 * above the frame.
 *
 * Each fitted frame gets `frame.dossierFit = {refit, stop}` and dispatches
 * `dossier-embed-fit` (detail: `{height, locked}`) whenever its height is set.
 *
 * @param {ParentNode} [root]
 * @param {{links?: boolean}} [opts]
 */
export function fitEmbedFrames(root, opts) {
  // Shortest and tallest frame, in pixels. A document past the tallest is
  // held and scrolls inside its frame.
  var MIN = 60;
  var MAX = 100000;
  // How many times a height is tried at itself before the document is taken
  // to grow with its frame.
  var SETTLE = 4;
  var links = Boolean(opts && opts.links);
  var scope = root || document;
  var list = scope.querySelectorAll ? scope.querySelectorAll('iframe[data-embed-fit]') : [];
  for (var i = 0; i < list.length; i += 1) setup(list[i]);

  function setup(frame) {
    if (frame.dossierFit) return;
    var st = {
      raf: 0, last: 0, stopped: false, held: false, seen: '', inner: null, outer: null, doc: null,
      shown: false, restores: 0,
    };
    frame.dossierFit = { refit: schedule, stop: stop };
    // Before `attach`, so a page that is not the report is never measured.
    if (links) frame.addEventListener('load', guard);
    frame.addEventListener('load', attach);
    if (typeof ResizeObserver === 'function') {
      st.outer = new ResizeObserver(schedule);
      st.outer.observe(frame);
    }
    attach();

    function documentOf() {
      try {
        return frame.contentDocument;
      } catch (e) {
        return null;
      }
    }

    /** True while the frame shows its own srcdoc. */
    function showsSource() {
      try {
        return frame.contentWindow.location.href === 'about:srcdoc';
      } catch (e) {
        return false;
      }
    }

    /**
     * Put the report back when the frame has left it. `location.replace`
     * works on another origin's page and adds no history entry of its own
     * (the stray navigation made one, which stays: the first Back returns
     * the frame to its report).
     */
    function guard(event) {
      if (showsSource()) {
        st.shown = true;
        return;
      }
      if (!st.shown) return;
      event.stopImmediatePropagation();
      st.restores += 1;
      if (st.restores > 3) {
        frame.setAttribute('srcdoc', '<!DOCTYPE html><meta charset="utf-8"><p style="font: 15px/1.5 system-ui, sans-serif; margin: 24px">'
          + 'This report kept opening other pages in its frame, so it is not shown here.</p>');
      } else {
        try {
          frame.contentWindow.location.replace('about:srcdoc');
        } catch (e) {
          frame.setAttribute('srcdoc', frame.getAttribute('srcdoc') || '');
        }
      }
      var before = frame.previousElementSibling;
      if (before && before.getAttribute('data-embed-restored') !== null) return;
      var note = frame.ownerDocument.createElement('p');
      note.className = 'embed-note';
      note.setAttribute('role', 'status');
      note.setAttribute('data-embed-restored', '');
      note.textContent = 'Something in this report opened another page in its frame, so the report was loaded again from the top.';
      frame.parentNode.insertBefore(note, frame);
    }

    function attach() {
      var doc = documentOf();
      // An unloaded frame has an empty about:blank of its own; wait for load.
      if (!doc || !doc.documentElement || doc === st.doc) return;
      if (doc.URL === 'about:blank' && !(doc.body && doc.body.childNodes.length)) return;
      if (doc.URL === 'about:srcdoc') st.shown = true;
      st.doc = doc;
      if (st.inner) st.inner.disconnect();
      if (typeof ResizeObserver === 'function') {
        st.inner = new ResizeObserver(schedule);
        st.inner.observe(doc.documentElement);
        if (doc.body) st.inner.observe(doc.body);
      }
      // A disclosure opened in a document whose root is sized to its frame
      // changes nothing the observers above can see.
      doc.addEventListener('toggle', schedule, true);
      if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(schedule, function () {});
      if (links) bindLinks(doc);
      schedule();
    }

    function schedule() {
      if (st.raf || st.stopped) return;
      st.raf = requestAnimationFrame(measure);
    }

    function measure() {
      st.raf = 0;
      var doc = documentOf();
      // Only the report: the frame's empty first document (quirks mode, as
      // tall as any frame) would read as a document with no height.
      if (st.stopped || !doc || doc !== st.doc || !doc.documentElement || !frame.isConnected) return;
      // A frame with no box (a view that is hidden, a closed disclosure) has
      // nothing to measure. The outer observer calls again when it shows.
      if (!frame.getClientRects().length) return;
      // A held frame changes only with the width or the window's height.
      var seen = frame.clientWidth + 'x' + window.innerHeight;
      if (st.held && seen === st.seen) return;
      st.seen = seen;
      var before = frame.style.height;
      var height = natural(doc);
      var held = height < 0;
      if (held) height = Math.max(4 * MIN, Math.round((window.innerHeight || 800) * 0.9));
      if (held === st.held && Math.abs(height - st.last) < 2) {
        // Nothing to change; the probes moved the frame, so put it back.
        frame.style.height = before;
        return;
      }
      st.last = height;
      st.held = held;
      frame.style.height = height + 'px';
      frame.setAttribute('data-embed-fit', held ? 'held' : '');
      frame.dispatchEvent(new CustomEvent('dossier-embed-fit', { detail: { height: height, locked: held } }));
    }

    /**
     * The document's own height, in pixels, or -1 when it has none (it grows
     * with the frame). Each read lays the document out at the height just
     * given to the frame. Scrollbars are hidden while probing, so a short
     * probe does not narrow the text and make it taller than it is.
     */
    function natural(doc) {
      var el = doc.documentElement;
      var body = doc.body;
      var win = frame.contentWindow;
      var y = win ? win.scrollY : 0;
      var styles = [el.getAttribute('style'), body ? body.getAttribute('style') : null];
      el.style.setProperty('scrollbar-width', 'none', 'important');
      if (body) body.style.setProperty('scrollbar-width', 'none', 'important');
      try {
        var screen = Math.max(480, Math.min(1200, Math.round(window.innerHeight || 800)));
        var size = probe(screen);
        // Exactly as tall as the probe: a short document whose root is sized
        // to its frame, or one that fills any frame. Smaller probes tell.
        if (Math.abs(size - screen) <= 1) {
          size = probe(MIN);
          if (Math.abs(size - MIN) <= 1) {
            size = probe(2 * MIN);
            if (Math.abs(size - 2 * MIN) <= 1) return -1;
          }
        }
        var height = Math.max(MIN, Math.ceil(size));
        var tallest = height;
        var grew = 0;
        for (var step = 0; step < SETTLE; step += 1) {
          if (height >= MAX) return -1;
          var want = Math.max(MIN, Math.ceil(probe(height)));
          if (want === height) return height;
          if (want > height) grew += 1;
          height = want;
          tallest = Math.max(tallest, height);
        }
        // Taller every time it was given its own height: it grows with the
        // frame. Otherwise it moved both ways; the taller height shows it all.
        return grew === SETTLE ? -1 : Math.min(MAX, tallest);
      } finally {
        restore(el, styles[0]);
        if (body) restore(body, styles[1]);
        if (win && win.scrollY !== y) win.scrollTo(0, y);
      }

      function probe(px) {
        frame.style.height = px + 'px';
        return extent(el, body);
      }
    }

    /**
     * How far down the document reaches: the root's box, or what overflows
     * it, and the same for the body, which is the scroller in some reports.
     */
    function extent(el, body) {
      var size = reach(el);
      if (body) size = Math.max(size, body.getBoundingClientRect().top - el.getBoundingClientRect().top + reach(body));
      return size;
    }

    function reach(node) {
      var box = node.getBoundingClientRect().height;
      return node.scrollHeight > node.clientHeight + 1 ? Math.max(box, node.scrollHeight) : box;
    }

    function restore(node, style) {
      if (style === null) node.removeAttribute('style');
      else node.setAttribute('style', style);
    }

    function stop() {
      if (st.raf) cancelAnimationFrame(st.raf);
      st.raf = 0;
      st.stopped = true;
      if (st.inner) st.inner.disconnect();
      if (st.outer) st.outer.disconnect();
      frame.removeEventListener('load', attach);
      frame.removeEventListener('load', guard);
    }

    function bindLinks(doc) {
      guardNavigation();
      var handler = function (event) {
        // Read from the click's composed path: inside a declarative shadow
        // root a listener on the document sees the click retargeted to the
        // root's host. A closed root's links would stay out of sight (the
        // static copy builds every root open), and `guardNavigation` would
        // have those.
        var path = [];
        if (typeof event.composedPath === 'function') path = event.composedPath();
        else for (var node = event.target; node; node = node.parentNode) path.push(node);
        var closest = function (selector) {
          for (var i = 0; i < path.length; i += 1) {
            if (path[i] && path[i].nodeType === 1 && path[i].matches(selector)) return path[i];
          }
          return null;
        };
        // Every SVG link too: one written with `xlink:href`, or whose address
        // an animation sets, has no `href` attribute to match.
        var target = closest('a[href], a[*|href], area[href], svg a');
        var submit = closest('button, input[type="submit" i], input[type="image" i]');
        if (!target) {
          if (submit && submit.form) event.preventDefault();
          // A link an SVG <use> draws cannot be read from out here. A click
          // reaches `guardNavigation`; a middle click, or a click with a
          // modifier key, would open a tab or window it never sees.
          var elsewhere = event.type === 'auxclick' ? event.button === 1
            : event.type === 'click' && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
          var inner = null;
          for (var j = 0; j < path.length && !inner; j += 1) if (path[j] && path[j].nodeType === 1) inner = path[j];
          if (elsewhere && inner && inner.localName === 'use' && inner.namespaceURI === 'http://www.w3.org/2000/svg') event.preventDefault();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        // A middle click opens a web link in a new tab, as a click does.
        var middle = event.type === 'auxclick' && event.button === 1;
        if (event.type !== 'click' && !middle) return;
        var animated = target.href && typeof target.href === 'object' ? target.href.animVal : '';
        var raw = String(animated || target.getAttribute('href') || target.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '').trim();
        if (raw) follow(raw, middle);
      };
      doc.addEventListener('click', handler, true);
      doc.addEventListener('auxclick', handler, true);

      /**
       * Stop any other navigation of the frame before it starts, where the
       * browser has the Navigation API: the frame keeps its report and the
       * history gets no entry, which `guard` cannot take back. A reader who
       * clicked something gets what a caught link gives. Back, Forward and
       * a reload of the report itself are left alone.
       *
       * A srcdoc document has no address of its own, so a relative link in
       * it arrives resolved against this page's: `#notes` as this page's
       * address with `#notes` on it, `other.html` as a file beside this
       * page. The first is a place in the report; the second is a file the
       * export does not carry, and opening it would open whatever sits
       * beside this file, so it stays put like a relative link clicked.
       */
      function guardNavigation() {
        var nav = null;
        try { nav = frame.contentWindow && frame.contentWindow.navigation; } catch (e) { nav = null; }
        if (!nav || nav.dossierGuarded) return;
        nav.dossierGuarded = true;
        nav.addEventListener('navigate', function (event) {
          if (!event.cancelable || event.navigationType === 'traverse' || event.navigationType === 'reload') return;
          event.preventDefault();
          if (!event.userInitiated) return;
          var raw = String((event.destination && event.destination.url) || '');
          var url = null;
          var at = null;
          try {
            url = new URL(raw);
            at = new URL(doc.baseURI || document.baseURI);
          } catch (e) { url = null; }
          if (url && at && url.origin === at.origin && raw.indexOf('about:srcdoc#') !== 0) {
            var hash = raw.indexOf('#');
            var mark = hash < 0 ? '' : raw.slice(hash + 1);
            if (mark && url.href.split('#')[0] === at.href.split('#')[0]) follow('#' + mark, false);
            return;
          }
          follow(raw, false);
        });
      }

      /** What following `raw` does here: never a navigation of the frame. */
      function follow(raw, middle) {
        var self = 'about:srcdoc#';
        var hash = raw.charAt(0) === '#' ? raw.slice(1) : raw.indexOf(self) === 0 ? raw.slice(self.length) : null;
        if (hash !== null) {
          if (middle) return;
          var key = hash;
          try { key = decodeURIComponent(key); } catch (e) { /* keep the raw key */ }
          var spot = key ? (doc.getElementById(key) || doc.getElementsByName(key)[0]) : null;
          var top = spot ? spot.getBoundingClientRect().top : 0;
          // A held frame scrolls inside itself, in its window or in a pane
          // of the report's own: the target comes into view there, and the
          // page scrolls to the frame's top.
          if (st.held) {
            inside(spot || doc.documentElement);
            top = 0;
          }
          window.scrollTo({ top: Math.max(0, window.scrollY + frame.getBoundingClientRect().top + top - 16) });
          return;
        }
        // Parsed the way the browser would follow it, so a script address
        // cannot hide behind a tab, a line break or an entity. Relative
        // addresses point at files the export does not carry.
        var url = null;
        try { url = new URL(raw); } catch (e) { url = null; }
        if (url && /^(https?:|mailto:)$/.test(url.protocol)) window.open(url.href, '_blank', 'noopener,noreferrer');
      }
    }

    /**
     * Bring an element into view inside the frame, panes of the report's
     * own included, which `scrollIntoView` reaches and a scroll of the
     * frame's window does not. It carries on out into this page too, so
     * every scroller of this page is put back where it was.
     */
    function inside(el) {
      if (!el || typeof el.scrollIntoView !== 'function') return;
      var kept = [];
      for (var node = frame.parentElement; node; node = node.parentElement) kept.push([node, node.scrollTop, node.scrollLeft]);
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
}
