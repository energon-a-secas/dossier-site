/**
 * The behaviour of an exported comparison file, as one self-contained
 * function: js/compare/export.js writes `(${comparisonRuntime})(document)`
 * into the file's only script, the way `bindComparisons` travels inside the
 * report export. So it may use nothing from outside its own body: no
 * imports, no module state, no network.
 *
 * It syncs the columns (by matched sections, each heading carrying the
 * number of its group in `data-sync`; a column in its original layout
 * follows by proportion), steps through the changes of the column being
 * read with the previous and next buttons or `[` and `]`, opens and closes
 * removed parts and the review, shows or hides removed words, and on a
 * phone switches the one column shown.
 *
 * As in the app (js/compare/changes.js `whereRead`), a column at either end
 * keeps the change last stepped to there as its current one: at its end the
 * last few changes never reach the line under the top, and read from the
 * scroll position alone `]` stopped short of them.
 *
 * On a phone one column shows at a time, and the counter and the previous
 * and next buttons act on that one, as in the app. They used to act on the
 * column the counter showed on the desktop the file was made on, which a
 * phone may not show at all.
 *
 * @param {Document} doc
 */
export function comparisonRuntime(doc) {
  var root = doc.getElementById('compareView');
  if (!root) return;
  var cols = Array.prototype.slice.call(root.querySelectorAll('.col[data-col]'));
  var mode = 'sections';
  var leader = null;
  var frame = 0;
  var LINE = 0.3;
  var OFFSET = 48;

  function scrollerOf(col) {
    var el = col.querySelector('.col__scroll');
    if (el) {
      return {
        col: col,
        el: el,
        y: function () { return el.scrollTop; },
        set: function (v) { el.scrollTop = v; },
        h: function () { return el.scrollHeight; },
        v: function () { return el.clientHeight; },
        anchors: function () {
          var o = el.getBoundingClientRect().top - el.scrollTop;
          return Array.prototype.map.call(el.querySelectorAll('[data-sync]'), function (a) {
            return [a.getAttribute('data-sync'), a.getBoundingClientRect().top - o];
          });
        },
        listen: function (fn) { el.addEventListener('scroll', fn, { passive: true }); },
      };
    }
    var f = col.querySelector('iframe');
    if (!f) return null;
    var se = function () {
      try {
        var d = f.contentDocument;
        return d ? (d.scrollingElement || d.documentElement) : null;
      } catch (e) {
        return null;
      }
    };
    return {
      col: col,
      el: null,
      y: function () { var s = se(); return s ? s.scrollTop : 0; },
      set: function (v) { var s = se(); if (s) s.scrollTop = v; },
      h: function () { var s = se(); return s ? s.scrollHeight : 0; },
      v: function () { return f.clientHeight; },
      anchors: function () { return []; },
      listen: function (fn) {
        var bind = function () {
          try { f.contentWindow.addEventListener('scroll', fn, { passive: true }); } catch (e) { /* not readable */ }
        };
        f.addEventListener('load', bind);
        try { if (f.contentDocument && f.contentDocument.readyState === 'complete') bind(); } catch (e) { /* not readable */ }
      },
    };
  }

  var scrollers = cols.map(scrollerOf).filter(Boolean);

  function target(L, F) {
    var lr = Math.max(0, L.h() - L.v());
    var fr = Math.max(0, F.h() - F.v());
    if (L.y() <= 1) return 0;
    if (lr && L.y() >= lr - 1) return fr;
    var share = lr ? L.y() / lr * fr : 0;
    if (mode === 'scroll') return share;
    var fa = {};
    F.anchors().forEach(function (a) { fa[a[0]] = a[1]; });
    var pts = [[0, 0]];
    L.anchors().forEach(function (a) {
      if (!(a[0] in fa)) return;
      var last = pts[pts.length - 1];
      if (a[1] > last[0] && fa[a[0]] >= last[1]) pts.push([a[1], fa[a[0]]]);
    });
    if (pts.length < 2) return share;
    var end = pts[pts.length - 1];
    if (L.h() > end[0] && F.h() >= end[1]) pts.push([L.h(), F.h()]);
    var line = L.y() + LINE * L.v();
    var mapped = line;
    for (var k = 1; k < pts.length; k += 1) {
      if (line <= pts[k][0]) {
        var t = (line - pts[k - 1][0]) / ((pts[k][0] - pts[k - 1][0]) || 1);
        mapped = pts[k - 1][1] + t * (pts[k][1] - pts[k - 1][1]);
        break;
      }
      mapped = pts[k][1] + (line - pts[k][0]);
    }
    return Math.max(0, Math.min(fr, mapped - LINE * F.v()));
  }

  function apply() {
    frame = 0;
    if (!leader || mode === 'off') return;
    var now = Date.now();
    scrollers.forEach(function (s) {
      if (s === leader || !s.col.offsetParent) return;
      var y = target(leader, s);
      if (!isFinite(y) || Math.abs(s.y() - y) < 1) return;
      s.driven = { y: y, at: now };
      s.set(y);
    });
  }

  scrollers.forEach(function (s) {
    s.listen(function () {
      if (s.driven && (Math.abs(s.y() - s.driven.y) <= 2 || Date.now() - s.driven.at < 150)) return;
      s.driven = null;
      leader = s;
      if (s.el && s.el.querySelector('[data-chg]')) active = s;
      if (!frame) frame = requestAnimationFrame(apply);
      count();
    });
    s.col.addEventListener('pointerenter', function () { leader = s; });
  });

  // ── Changes ────────────────────────────────────────────────────────────
  var counter = doc.getElementById('xCounter');
  var marked = scrollers.filter(function (s) { return s.el && s.el.querySelector('[data-chg]'); });
  var active = marked.filter(function (s) { return s.col.hasAttribute('data-active'); })[0] || marked[0] || null;
  var phone = doc.defaultView && doc.defaultView.matchMedia ? doc.defaultView.matchMedia('(max-width: 699px)') : null;

  // The column the counter and the buttons act on: on a phone, the one shown.
  function current() {
    if (!phone || !phone.matches) return active;
    var shown = root.querySelector('.col.is-focus');
    return scrollers.filter(function (s) { return s.col === shown; })[0] || null;
  }

  // The change last stepped to or shown, per the column being read.
  var last = null;

  function changes(s) { return s && s.el ? Array.prototype.slice.call(s.el.querySelectorAll('[data-chg]')) : []; }
  function top(s, el) { return el.getBoundingClientRect().top - s.el.getBoundingClientRect().top + s.el.scrollTop; }
  function at(s) {
    var n = 0;
    changes(s).forEach(function (el) { if (el.getClientRects().length && top(s, el) <= s.el.scrollTop + OFFSET + 12) n = Number(el.getAttribute('data-chg')); });
    return n;
  }
  function here(s) {
    var n = at(s);
    if (!last || last.s !== s) return n;
    var end = s.el.scrollTop >= s.el.scrollHeight - s.el.clientHeight - 1;
    var start = s.el.scrollTop <= 1;
    return (end && last.n > n) || (start && last.n > 0 && last.n < n) ? last.n : n;
  }
  function say(text) {
    var live = doc.getElementById('xLive');
    if (!live) return;
    // Emptied first, so the same words twice in a row are read twice.
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }
  function count() {
    if (!counter) return;
    var s = current();
    var list = changes(s);
    var n = s && s.el ? here(s) : 0;
    if (s && s.el) last = { s: s, n: n };
    root.querySelectorAll('.u-current').forEach(function (el) { el.classList.remove('u-current'); });
    var el = s && s.el && n ? s.el.querySelector('[data-chg="' + n + '"]') : null;
    if (el) el.classList.add('u-current');
    counter.querySelector('.counter__main').textContent = list.length ? n + ' of ' + list.length : 'No changes';
    counter.querySelector('.counter__sub').textContent = s ? 'in ' + s.col.getAttribute('data-name') : '';
  }
  function step(dir) {
    var s = current();
    var list = changes(s);
    if (!list.length) {
      if (s) say('No changes are marked in ' + s.col.getAttribute('data-name') + '.');
      return;
    }
    var name = s.col.getAttribute('data-name');
    var n = here(s) + dir;
    if (n < 1 || n > list.length) {
      say(dir > 0 ? 'That was the last change in ' + name + '.' : 'That was the first change in ' + name + '.');
      return;
    }
    var el = s.el.querySelector('[data-chg="' + n + '"]');
    if (!el) return;
    last = { s: s, n: n };
    leader = s;
    s.el.scrollTop = Math.max(0, top(s, el) - OFFSET);
    if (!frame) frame = requestAnimationFrame(apply);
    say('Change ' + n + ' of ' + list.length + ' in ' + name);
    setTimeout(count, 30);
  }

  // ── Controls ───────────────────────────────────────────────────────────
  doc.addEventListener('click', function (event) {
    var t = event.target.closest ? event.target.closest('button') : null;
    if (!t) return;
    if (t.id === 'xPrev') step(-1);
    else if (t.id === 'xNext') step(1);
    else if (t.getAttribute('data-action') === 'cmp-ghost') {
      var full = t.parentNode.querySelector('.ghost__full');
      if (!full) return;
      var open = full.hidden;
      full.hidden = !open;
      t.setAttribute('aria-expanded', String(open));
      t.textContent = open ? 'Hide' : 'Show';
    } else if (t.id === 'xRemoved') {
      var on = t.getAttribute('aria-pressed') !== 'true';
      t.setAttribute('aria-pressed', String(on));
      root.classList.toggle('hide-removed', !on);
    } else if (t.id === 'xReview' || t.id === 'xReviewClose') {
      var panel = doc.getElementById('xPanel');
      var show = t.id === 'xReview' ? panel.hidden : false;
      panel.hidden = !show;
      root.classList.toggle('panel-open', show);
      root.classList.toggle('panel-overlay', show);
      var toggle = doc.getElementById('xReview');
      toggle.setAttribute('aria-pressed', String(show));
      if (!show) toggle.focus();
    } else if (t.getAttribute('role') === 'tab') {
      root.querySelectorAll('.focus-switch [role="tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b === t)); });
      cols.forEach(function (c) { c.classList.toggle('is-focus', c.getAttribute('data-col') === t.getAttribute('data-col')); });
      // The column shown is the one the counter follows.
      var shown = scrollers.filter(function (s) { return s.col.classList.contains('is-focus'); })[0];
      if (shown && marked.indexOf(shown) >= 0) active = shown;
      count();
    }
  });
  if (phone) {
    var crossed = function () { count(); };
    if (phone.addEventListener) phone.addEventListener('change', crossed);
    else if (phone.addListener) phone.addListener(crossed);
  }
  var sync = doc.getElementById('xSync');
  if (sync) sync.addEventListener('change', function () { mode = sync.value; });
  doc.addEventListener('keydown', function (event) {
    var tag = event.target && event.target.localName;
    if (event.altKey || event.ctrlKey || event.metaKey || tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (event.key === '[') step(-1);
    if (event.key === ']') step(1);
  });
  count();
}
