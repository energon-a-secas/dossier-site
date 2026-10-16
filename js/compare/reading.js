/**
 * Where the reader is in the Compare view: each column's scroll position
 * across leaving the view and coming back, the heading counter between
 * previous and next, stepping through headings with `[` and `]`, and
 * bringing a redrawn column level with the others.
 *
 * The counter counts every heading in the column ("3 of 8 headings"), title
 * included, because that is what `[` and `]` step through. The stats line's
 * "7 sections" is a different count (js/compare/extract.js: the headings one
 * level under the title), so the two never share a word.
 *
 * Positions are recorded as columns scroll (`lastY`, fed by js/compare/sync.js
 * through js/compare/index.js), because once the view is hidden every
 * position reads as 0.
 */

import { say } from '../share.js';
import { updateCounter } from './toolbar.js';
import { nameOf } from './blind.js';

/** @param {object} compare the view's state, from js/compare/index.js */
export function createReading(compare) {
  function rememberScroll() {
    for (const col of compare.set?.columns || []) {
      const y = compare.ui.lastY.get(col.id);
      if (Number.isFinite(y)) compare.ui.scroll.set(col.id, y);
    }
  }

  function restoreScroll(colId) {
    const y = compare.ui.scroll.get(colId);
    if (!Number.isFinite(y)) return;
    requestAnimationFrame(() => {
      const scroller = compare.sync.scroller(colId);
      if (scroller && scroller.height() > 0) {
        scroller.set(y, false);
        compare.ui.scroll.delete(colId);
      }
    });
  }

  let counterFrame = 0;

  function scheduleCounter() {
    if (counterFrame) return;
    counterFrame = requestAnimationFrame(() => {
      counterFrame = 0;
      if (compare.refs) updateCounter(compare.refs.root, counterInfo());
    });
  }

  /** The column `[` and `]` move through: the one being read. */
  function readingColumn() {
    const set = compare.set;
    if (!set) return null;
    if (set.view.layout === 'focus' || phone()) return compare.sync.has(set.view.focus) ? set.view.focus : null;
    const leader = compare.sync.leader;
    if (leader && compare.sync.has(leader)) return leader;
    return set.columns.map((col) => col.id).find((id) => compare.sync.has(id)) || null;
  }

  function phone() {
    return typeof matchMedia === 'function' && matchMedia('(max-width: 699px)').matches;
  }

  function counterInfo() {
    if (typeof compare.hooks.counter === 'function') {
      const custom = compare.hooks.counter();
      if (custom) return custom;
    }
    const colId = readingColumn();
    // Nothing to step through: the counter says so and previous and next
    // are off (js/compare/toolbar.js `updateCounter`).
    if (!colId) return { main: '0 of 0', sub: 'headings', unit: 'heading', empty: true };
    const total = compare.sync.headings(colId).length;
    const at = compare.sync.currentHeading(colId);
    const letter = nameOf(compare.set, colId).ref;
    return {
      main: total ? `${Math.max(1, at + 1)} of ${total}` : 'No headings',
      sub: `headings in ${letter}`,
      unit: 'heading',
      empty: !total,
    };
  }

  /**
   * Tell a screen reader, and only a screen reader, where a step landed.
   * Emptied first, so the same words twice in a row are read twice.
   */
  function announce(text) {
    const live = compare.refs?.live;
    if (!live || !text) return;
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = text; });
  }

  function stepSection(dir) {
    const colId = readingColumn();
    if (!colId) return false;
    const headings = compare.sync.headings(colId);
    const total = headings.length;
    if (!total) return false;
    const at = compare.sync.currentHeading(colId);
    const next = Math.max(0, Math.min(total - 1, at + dir));
    if (next === at && at >= 0) {
      say(dir > 0 ? 'That was the last heading.' : 'That was the first heading.');
      return true;
    }
    compare.sync.jump(colId, next);
    // Said from the target, not read back from the counter, which catches
    // up only once a smooth scroll has arrived.
    const text = String(headings[next]?.text || '').slice(0, 120);
    announce(`Heading ${next + 1} of ${total} in ${nameOf(compare.set, colId).ref}${text ? `: ${text}` : ''}`);
    return true;
  }

  /**
   * `[`, `]` and the previous and next buttons: the next change when an
   * analysis feature takes the step (`compare.hooks.step`), otherwise the
   * next heading. Either way the result is announced; scrolling is not.
   */
  function step(dir) {
    if (typeof compare.hooks.step === 'function' && compare.hooks.step(dir)) {
      const info = counterInfo();
      // A feature may say more than the counter shows ("Change 2 of 9 in
      // C: changed paragraph").
      announce(info.spoken || `${info.main} ${info.sub || ''}`.trim());
      return true;
    }
    return stepSection(dir);
  }

  // ── Catching up after a redraw ─────────────────────────────────────────────

  /**
   * A redrawn body starts at its top. Switching the set between Dossier format
   * and Original rebuilt the HTML columns at the top while a Markdown column
   * kept its place, and the columns stayed out of step until the next scroll;
   * a column's own mode change did the same. So once each redrawn column can
   * scroll (a frame only after it has loaded), it is brought level: with a
   * column that kept its place, or, when every column was redrawn, the column
   * being read goes back to the heading it was at and the others follow it.
   */
  function catchUp(redrawn, place) {
    const moved = new Set(redrawn);
    const ids = [compare.sync.leader, ...compare.set.columns.map((col) => col.id)];
    const keeper = ids.find((id) => id && !moved.has(id) && compare.sync.has(id)) || null;
    compare.ui.catchUp = { keeper, place: keeper ? null : place, waiting: moved };
    for (const colId of redrawn) caughtUp(colId, compare.ui.records.get(colId));
  }

  /** Where the column being read is: its heading at the reading line. */
  function readingPlace() {
    const sync = compare.sync;
    const colId = sync?.leader;
    if (!colId || !sync.has(colId)) return null;
    const index = sync.currentHeading(colId);
    if (index < 0) return null;
    return { colId, index, text: sync.headings(colId)[index]?.text || '' };
  }

  function caughtUp(colId, record) {
    const plan = compare.ui.catchUp;
    if (!plan || !record || !plan.waiting.has(colId) || !compare.sync.has(colId)) return;
    if (record.kind === 'frame' && !record.loaded) return;
    plan.waiting.delete(colId);
    requestAnimationFrame(() => {
      const sync = compare.sync;
      sync.remeasure();
      if (plan.place && plan.place.colId === colId) {
        const norm = (text) => String(text || '').toLowerCase();
        const list = sync.headings(colId);
        let index = list.findIndex((h) => norm(h.text) === norm(plan.place.text));
        if (index < 0) index = Math.min(plan.place.index, list.length - 1);
        if (index >= 0) sync.jump(colId, index, { smooth: false });
      }
      const lead = plan.keeper || plan.place?.colId || null;
      if (lead && sync.has(lead)) sync.follow(lead);
      scheduleCounter();
    });
  }

  return {
    rememberScroll, restoreScroll, scheduleCounter, counterInfo, step, announce,
    readingPlace, catchUp, caughtUp,
  };
}
