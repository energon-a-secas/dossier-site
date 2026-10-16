/**
 * Synchronised scrolling between compare columns.
 *
 *   sections  matched headings line up: a position in the leader maps to the
 *             follower piecewise-linearly between aligned heading anchors
 *             (js/compare/align.js), read at the reading line, 30 % down,
 *             which slides in from the top edge as the leader leaves its
 *             top and out to the bottom edge as it reaches its end
 *             (`followerTarget`), so the mapping has no jump anywhere
 *   scroll    proportional: the same fraction of each column's length
 *   off       each column scrolls on its own
 *
 * The leader is the column the reader is scrolling: the one under the
 * pointer or with focus, and any column that scrolls without having been
 * driven from here. Writes to the followers happen in one animation frame,
 * instantly (never smooth, which would replay as a stream of scroll events),
 * and a follower ignores its own scroll events within 2 px or 150 ms of a
 * write, so two columns never chase each other. Focus is never moved.
 *
 * A jump can also place every column itself (`jump` with `matches`: the
 * Sections panel names each column's own heading for a row, moved sections
 * included, which the alignment sync follows does not pair). Those columns
 * are held for a moment, so the leader's own scroll event does not pull
 * them back to where the alignment would put them.
 *
 * Heading pairs are aligned once per unordered pair of columns, from each
 * column's headings prepared once (js/compare/align.js), and the mirror is
 * kept for the other direction. They are worked out in idle time after a
 * column registers, so the first scroll of a long report does not stop the
 * page while they are: with 400 headings it used to, for seconds.
 *
 * A scroller is anything with `y()`, `set(y, smooth)`, `height()`, `view()`,
 * `anchors()` and `listen(fn)`: a column's own scrolling element
 * (`elementScroller`) or a static Original frame (js/compare/frame.js).
 */

import { alignHeadings, mapPosition, prepareHeadings } from './align.js';
import { reducedMotion } from '../motion.js';

/** Where a reader's eye rests, as a fraction of the column's height. */
export const READING_LINE = 0.3;
const ECHO_PX = 2;
const ECHO_MS = 150;
/** Heading positions are re-measured at most this often while scrolling. */
const ANCHOR_TTL_MS = 500;
/** A jump puts the heading this far under the top of the column. */
export const JUMP_OFFSET = 16;
/** How long a column placed by a jump is left where it was put. */
const HOLD_MS = 300;
const HOLD_SMOOTH_MS = 1200;

/**
 * A light-DOM scroller: a column's scrolling element and its heading elements.
 *
 * @param {HTMLElement} el
 * @param {HTMLElement[]} headingEls in document order
 */
export function elementScroller(el, headingEls) {
  return {
    element: el,
    y: () => el.scrollTop,
    set: (y, smooth = false) => el.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'instant' }),
    height: () => el.scrollHeight,
    view: () => el.clientHeight,
    anchors: () => {
      const origin = el.getBoundingClientRect().top - el.scrollTop;
      return headingEls.map((h) => h.getBoundingClientRect().top - origin);
    },
    listen: (fn) => {
      el.addEventListener('scroll', fn, { passive: true });
      return () => el.removeEventListener('scroll', fn);
    },
  };
}

/**
 * Where a follower goes for a leader at `y`. Pure, so it is tested without
 * a page.
 *
 * Sections mode reads the leader at a line `f` of its view down and puts the
 * matching point the same `f` down the follower's view. A reader at the top
 * is looking at the top, not 30 % down: with the line fixed at 30 %, a 1 px
 * scroll of the leader sent the follower about 100 px down. So `f` is 0 at
 * the leader's top and grows to READING_LINE over the first READING_LINE of
 * a view of travel. The end had the same jump the other way (the follower
 * leapt to its end on the leader's last pixel), so over the last READING_LINE
 * of a view `f` grows on to 1, where the bottom edges meet. Every piece is
 * continuous: 0 at the top, the follower's end at the leader's end, and the
 * reading line itself everywhere between. A leader too short for both
 * stretches gives each half of its range.
 *
 * Scroll mode, or a column with no headings: the same fraction of each range.
 *
 * @param {{y: number, leadView: number, leadHeight: number, followView: number,
 *   followHeight: number, anchors?: Array<[number, number]>, sections?: boolean}} at
 * @returns {number}
 */
export function followerTarget({
  y, leadView, leadHeight, followView, followHeight, anchors = [], sections = true,
}) {
  const leadRange = Math.max(0, leadHeight - leadView);
  const followRange = Math.max(0, followHeight - followView);
  if (!leadRange || !followRange) return 0;
  const pos = Math.max(0, Math.min(leadRange, Number(y) || 0));
  if (!sections) return (pos / leadRange) * followRange;
  const band = Math.min(READING_LINE * leadView, leadRange / 2);
  const enter = band;
  const exit = band;
  let f = READING_LINE;
  if (enter && pos < enter) f = READING_LINE * (pos / enter);
  else if (exit && pos > leadRange - exit) f = READING_LINE + (1 - READING_LINE) * ((pos - (leadRange - exit)) / exit);
  const mapped = mapPosition(pos + f * leadView, anchors, leadHeight, followHeight);
  return Math.max(0, Math.min(followRange, mapped - f * followView));
}

/**
 * @param {{onScroll?: (colId: string) => void}} [hooks] called after any
 *   column scrolls (the view updates the section counter from it)
 */
export function createSync(hooks = {}) {
  const cols = new Map();
  const pairCache = new Map();
  let mode = 'sections';
  let leader = null;
  let frame = 0;

  function entry(colId) {
    return cols.get(colId) || null;
  }

  /**
   * Heading positions, measured at most every ANCHOR_TTL_MS. A column with
   * no box (the view hidden, another tab in the focus layout) reads every
   * heading at 0, so that reading is used once and never kept: kept, the
   * example opened from the welcome screen said "8 of 8 headings" until the
   * first scroll.
   */
  function anchorsOf(col) {
    const now = performance.now();
    if (col.anchorCache && now - col.anchorAt <= ANCHOR_TTL_MS) return col.anchorCache;
    let ys = [];
    try {
      ys = col.scroller.anchors();
    } catch {
      ys = [];
    }
    if (col.scroller.view() > 0) {
      col.anchorCache = ys;
      col.anchorAt = now;
    }
    return ys;
  }

  /** A column as one side of a cached pair: its id and the version registered. */
  const sideOf = (col) => `${col.id}:${col.version}`;

  /** A column's headings, prepared once for every pair it is aligned in. */
  function preparedOf(col) {
    if (!col.prepared) col.prepared = prepareHeadings(col.headings);
    return col.prepared;
  }

  /**
   * The aligned pairs of two columns. One alignment per unordered pair: the
   * side whose key sorts first leads it, and the mirror is stored for the
   * other direction, so `targetFor` never allocates.
   */
  function pairsBetween(a, b) {
    const key = `${sideOf(a)}|${sideOf(b)}`;
    const cached = pairCache.get(key);
    if (cached) return cached;
    const flip = sideOf(b) < sideOf(a);
    const x = flip ? b : a;
    const y = flip ? a : b;
    const forward = alignHeadings(preparedOf(x), preparedOf(y));
    const mirror = forward.map((p) => ({ a: p.b, b: p.a, sim: p.sim }));
    pairCache.set(`${sideOf(x)}|${sideOf(y)}`, forward);
    pairCache.set(`${sideOf(y)}|${sideOf(x)}`, mirror);
    return flip ? mirror : forward;
  }

  const idle = typeof requestIdleCallback === 'function'
    ? { start: (fn) => requestIdleCallback(fn, { timeout: 2000 }), stop: (h) => cancelIdleCallback(h) }
    : { start: (fn) => setTimeout(fn, 50), stop: (h) => clearTimeout(h) };

  /**
   * Align a newly registered column with every other one in idle time, one
   * pair per idle slot, so the work is done before the reader scrolls.
   */
  function warm(col) {
    if (mode === 'off') return;
    const others = [...cols.values()].filter((other) => other !== col);
    let next = 0;
    const run = () => {
      col.idle = 0;
      if (cols.get(col.id) !== col) return;
      while (next < others.length) {
        const other = others[next];
        next += 1;
        if (cols.get(other.id) !== other || !col.headings.length || !other.headings.length) continue;
        pairsBetween(col, other);
        break;
      }
      if (next < others.length) col.idle = idle.start(run);
    };
    if (others.length) col.idle = idle.start(run);
  }

  /** Where the follower should be, given the leader's position. */
  function targetFor(lead, follow) {
    const ls = lead.scroller;
    const fs = follow.scroller;
    const sections = mode !== 'scroll' && lead.headings.length > 0 && follow.headings.length > 0;
    let anchors = [];
    if (sections) {
      const la = anchorsOf(lead);
      const fa = anchorsOf(follow);
      anchors = pairsBetween(lead, follow)
        .map((p) => [la[p.a], fa[p.b]])
        .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    }
    return followerTarget({
      y: ls.y(), leadView: ls.view(), leadHeight: ls.height(), followView: fs.view(), followHeight: fs.height(), anchors, sections,
    });
  }

  function apply() {
    frame = 0;
    const lead = entry(leader);
    if (!lead || mode === 'off') return;
    const now = performance.now();
    for (const col of cols.values()) {
      if (col === lead || col.hold > now) continue;
      const y = targetFor(lead, col);
      if (!Number.isFinite(y) || Math.abs(col.scroller.y() - y) < 1) continue;
      col.driven = { y, at: now };
      col.scroller.set(y, false);
    }
  }

  function onScroll(col) {
    const driven = col.driven;
    if (driven) {
      const y = col.scroller.y();
      if (Math.abs(y - driven.y) <= ECHO_PX || performance.now() - driven.at < ECHO_MS) {
        if (typeof hooks.onScroll === 'function') hooks.onScroll(col.id);
        return;
      }
      col.driven = null;
    }
    leader = col.id;
    col.hold = 0;
    if (mode !== 'off' && !frame) frame = requestAnimationFrame(apply);
    if (typeof hooks.onScroll === 'function') hooks.onScroll(col.id);
  }

  return {
    /**
     * Add or replace a column.
     *
     * @param {string} colId
     * @param {object} scroller
     * @param {Array<{text: string, level: number}>} headings same order as anchors()
     * @param {HTMLElement} [element] the column, for pointer and focus
     */
    register(colId, scroller, headings, element) {
      this.unregister(colId);
      if (!scroller) return;
      const col = {
        id: colId, scroller, headings: headings || [], version: Math.random().toString(36).slice(2),
        driven: null, hold: 0, anchorCache: null, anchorAt: 0, offs: [], prepared: null, idle: 0,
      };
      col.offs.push(scroller.listen(() => onScroll(col)));
      if (element) {
        const lead = () => { leader = colId; };
        element.addEventListener('pointerenter', lead);
        element.addEventListener('focusin', lead);
        col.offs.push(() => {
          element.removeEventListener('pointerenter', lead);
          element.removeEventListener('focusin', lead);
        });
      }
      cols.set(colId, col);
      warm(col);
    },
    unregister(colId) {
      const col = cols.get(colId);
      if (!col) return;
      if (col.idle) idle.stop(col.idle);
      col.idle = 0;
      for (const off of col.offs) off();
      cols.delete(colId);
      if (leader === colId) leader = null;
      // Its pairs were cached under a version no column carries any more:
      // a redrawn column registers with a new one, so they would only pile up.
      const side = sideOf(col);
      for (const key of [...pairCache.keys()]) {
        if (key.startsWith(`${side}|`) || key.endsWith(`|${side}`)) pairCache.delete(key);
      }
    },
    clear() {
      for (const id of [...cols.keys()]) this.unregister(id);
      pairCache.clear();
    },
    has: (colId) => cols.has(colId),
    setMode(next) {
      mode = ['sections', 'scroll', 'off'].includes(next) ? next : 'sections';
    },
    get mode() { return mode; },
    get leader() { return leader; },
    setLeader(colId) { if (cols.has(colId)) leader = colId; },
    /** Heading positions moved (a resize, a font, a reading size): measure again. */
    remeasure() {
      for (const col of cols.values()) col.anchorCache = null;
    },
    /** Bring every follower to the leader now, for example after a layout change. */
    follow(colId = leader) {
      if (colId && cols.has(colId)) leader = colId;
      if (mode !== 'off' && !frame) frame = requestAnimationFrame(apply);
    },
    headings: (colId) => entry(colId)?.headings || [],
    anchors: (colId) => {
      const col = entry(colId);
      return col ? anchorsOf(col) : [];
    },
    scroller: (colId) => entry(colId)?.scroller || null,
    /**
     * Put heading `index` of `colId` just under the top of its column, or on
     * its reading line with `line`, and every other column at its matching
     * heading the same way.
     *
     * `matches` (colId to heading index) names each other column's heading,
     * and those columns are placed directly, whatever the sync mode; a
     * column it leaves out follows through sync, or stays put with sync off.
     * Without `matches`, the others follow through sync when it is on, and
     * are placed at their aligned heading when it is off.
     *
     * @param {{smooth?: boolean, line?: boolean, matches?: Map<string, number>|null}} [opts]
     */
    jump(colId, index, { smooth = !reducedMotion(), line = false, matches = null } = {}) {
      const col = entry(colId);
      if (!col) return false;
      const ys = anchorsOf(col);
      if (!Number.isFinite(ys[index])) return false;
      const at = (c, y) => {
        const top = y - (line ? READING_LINE * c.scroller.view() : JUMP_OFFSET);
        return Math.max(0, Math.min(Math.max(0, c.scroller.height() - c.scroller.view()), top));
      };
      leader = colId;
      col.driven = null;
      col.hold = 0;
      col.scroller.set(at(col, ys[index]), smooth);
      let targets = matches;
      if (!targets && mode === 'off') {
        targets = new Map();
        for (const other of cols.values()) {
          const pair = other === col ? null : pairsBetween(col, other).find((p) => p.a === index);
          if (pair) targets.set(other.id, pair.b);
        }
      }
      if (!targets) return true;
      const now = performance.now();
      for (const other of cols.values()) {
        // A column not on screen (another tab in the focus layout) has no
        // positions to read.
        if (other === col || !targets.has(other.id) || !other.scroller.view()) continue;
        const oy = anchorsOf(other)[targets.get(other.id)];
        if (!Number.isFinite(oy)) continue;
        const y = at(other, oy);
        other.driven = { y, at: now };
        other.hold = now + (smooth ? HOLD_SMOOTH_MS : HOLD_MS);
        other.scroller.set(y, false);
      }
      return true;
    },
    /**
     * The heading at the reading line of a column, or -1 above the first.
     * By default the line sits near the top, where a jump puts a heading;
     * with `line` it is the reading line itself, 30 % down.
     */
    currentHeading(colId, { line: atReading = false } = {}) {
      const col = entry(colId);
      if (!col) return -1;
      const ys = anchorsOf(col);
      const line = col.scroller.y() + (atReading
        ? READING_LINE * col.scroller.view() + 8
        : Math.max(JUMP_OFFSET + 8, READING_LINE * col.scroller.view() * 0.25));
      let at = -1;
      for (let i = 0; i < ys.length; i += 1) {
        if (ys[i] <= line) at = i;
        else break;
      }
      return at;
    },
    /** The pairs between two columns' headings, for the Sections panel. */
    pairs(a, b) {
      const ca = entry(a);
      const cb = entry(b);
      return ca && cb ? pairsBetween(ca, cb) : [];
    },
  };
}
