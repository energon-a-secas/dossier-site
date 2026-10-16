/**
 * The current change: which column `[` and `]` step through, the change the
 * counter points at (outlined, tagged "2 of 9", its hidden label saying
 * "change 2 of 9"), following it as the column scrolls, and moving to it.
 * Part of js/compare/analysis.js, which hands it what it needs.
 *
 * A change lands 48 px under the top of its column, room for its tag; the
 * ruler brings one 40 px under (design spec 7.3.6). The brief said "the
 * reading line", which sync puts 30 % down; under the top was chosen on
 * purpose, and the current change is read from the same 48 px line as the
 * column scrolls, so the two always agree. At 30 % the first few changes of
 * a column (a changed title, say) would all count as passed before the
 * reader stepped to any of them, and `]` would start past them. Sync still
 * brings the other columns along from the leader's reading line. (A
 * Sections row is different: it brings a heading, not a change, and puts
 * it on the reading line of every column, js/compare/analysis.js.)
 *
 * A column at its end cannot bring its last few changes under the top, and
 * one at its start cannot take its first few below it. A change stepped to
 * there stays current while the column stays at that end (`whereRead`).
 * Read from the scroll position alone, `]` near the end landed on the same
 * change again and again and never reached the last ones, nor said "That
 * was the last change".
 *
 * While a step scrolls smoothly, the scroll position does not move the
 * current change, so the outline does not run through every change on the
 * way. A current change worked out while the view was hidden (the example
 * opened from the welcome screen is drawn before the view shows) is marked
 * `unplaced` and worked out again at the first layout, or the counter read
 * "0 of 15" over a changed title at the top of the column.
 *
 * A change stays current while its top, tag and all, is inside the column.
 * Once its top goes up under the column's edge, the next change takes over
 * if it is already in the upper part of the column (above the reading
 * line); if it is not, the reader is still inside the long change, which
 * stays current with its tag held at the column's top edge. Its tag used to
 * be cut off there, over a change outlined from somewhere above the column.
 */

import { say } from '../share.js';
import { columnById } from './model.js';
import { displayColumns } from './blind.js';
import { isPhone } from './popover.js';
import { reducedMotion } from './sync.js';
import { markCurrentTick, offsetIn } from './ruler.js';

/** A change lands this far under the top of its column, room for its "2 of 9" tag. */
const CHANGE_OFFSET = 48;
/** The ruler brings a change this far under the top. */
export const TICK_OFFSET = 40;
/** While a step scrolls, the scroll position does not move the current change. */
const STEP_LOCK_MS = 700;
/** Room a change's "2 of 9" tag takes above it. */
const TAG_ROOM = 22;
/** Where sync reads a column, as a share of its height (js/compare/sync.js). */
const READING_LINE = 0.3;

/**
 * @param {{api: object, ui: object, planFor: Function, refOf: Function, baseId: Function}} ctx
 */
export function createChanges({ api, ui, planFor, refOf, baseId }) {
  const { compare } = api;
  const root = compare.refs.root;

  /** Columns whose changes can be stepped through, in the order they are laid out. */
  function markedColumns() {
    const set = compare.set;
    if (!set || !set.view.diff.on) return [];
    return displayColumns(set).filter((col) => {
      const plan = planFor(col);
      const rec = compare.ui.records.get(col.id);
      return plan?.result && !plan.counted && !plan.result.failed && rec?.kind === 'reader' && rec.scrollEl?.isConnected;
    }).map((col) => col.id);
  }

  /** The column `[` and `]` step through: the one being read, if it is marked. */
  function changeColumn() {
    const set = compare.set;
    const marked = markedColumns();
    if (!marked.length) return null;
    const single = set.view.layout === 'focus' || isPhone();
    const reading = single ? set.view.focus : ui.reading;
    if (marked.includes(reading)) return reading;
    if (single) return null;
    if (ui.current.setId === set.id && marked.includes(ui.current.colId)) return ui.current.colId;
    // The column the set opened on (the example opens on its fixes).
    return marked.includes(set.view.focus) ? set.view.focus : marked[0];
  }

  const scrollerEl = (colId) => {
    const rec = compare.ui.records.get(colId);
    return rec?.kind === 'reader' ? rec.scrollEl : null;
  };
  const changeEl = (colId, n) => scrollerEl(colId)?.querySelector(`[data-chg="${n}"]`) || null;
  const totalOf = (colId) => planFor(columnById(compare.set, colId))?.result?.changes.length || 0;

  function clearCurrent() {
    for (const tag of root.querySelectorAll('.cur-tag')) tag.remove();
    for (const el of root.querySelectorAll('.u-current')) el.classList.remove('u-current');
    for (const sr of root.querySelectorAll('.u-sr[data-text]')) {
      sr.textContent = sr.dataset.text;
      delete sr.dataset.text;
    }
  }

  /** Outline change `n` of a column and tag it "n of total". */
  function showCurrent() {
    clearCurrent();
    const { colId, n, setId } = ui.current;
    const live = Boolean(compare.set && setId === compare.set.id && colId && n);
    markCurrentTick(live ? colId : null, live ? n : 0);
    if (!live) return;
    const el = changeEl(colId, n);
    if (!el) return;
    const total = totalOf(colId);
    el.classList.add('u-current');
    const tag = `<span class="cur-tag" aria-hidden="true">${n} of ${total}</span>`;
    if (el.localName === 'tr') {
      // A row cannot hold the tag itself: a removed row's ghost does, and a
      // changed or added row's last cell, at the row's top-right corner.
      const ghost = el.querySelector('.ghost');
      if (ghost) ghost.insertAdjacentHTML('afterbegin', tag);
      else el.lastElementChild?.insertAdjacentHTML('afterbegin', tag);
    } else {
      el.insertAdjacentHTML('afterbegin', tag);
    }
    const sr = el.querySelector('.u-sr');
    if (sr) {
      sr.dataset.text = sr.textContent;
      sr.textContent = `${sr.dataset.text.replace(/:\s*$/, '')}, change ${n} of ${total}: `;
    }
    holdTag();
  }

  /**
   * Keep the current change's tag inside its column: while the change's top
   * is above the column's top edge, the tag moves down to that edge. When
   * too little of the change is left in the column to hold it, the tag goes
   * until the change comes back, rather than show cut in half.
   */
  function holdTag() {
    const tag = root.querySelector('.cur-tag');
    const scroller = scrollerEl(ui.current.colId);
    if (!tag || !scroller || !scroller.getClientRects().length) return;
    tag.style.top = '';
    tag.classList.remove('is-held', 'is-out');
    const edge = scroller.getBoundingClientRect().top + 2;
    const box = tag.getBoundingClientRect();
    const need = edge - box.top;
    if (need <= 0) return;
    const room = tag.parentElement.getBoundingClientRect().bottom - box.bottom - 2;
    if (room < need) {
      tag.classList.add('is-out');
      return;
    }
    tag.style.top = `${(parseFloat(getComputedStyle(tag).top) || 0) + need}px`;
    tag.classList.add('is-held');
  }

  function setCurrent(colId, n) {
    const set = compare.set;
    const same = ui.current.setId === set?.id && ui.current.colId === colId && ui.current.n === n;
    ui.current = { setId: set?.id || null, colId, n };
    if (!same) {
      showCurrent();
      api.scheduleCounter();
    }
  }

  /**
   * Point the counter at the change where a column is scrolled. While the
   * column is not laid out it points at none, marked to be placed again.
   */
  function place(colId) {
    const n = currentFromScroll(colId);
    setCurrent(colId, n ?? 0);
    if (n === null) ui.current.unplaced = true;
  }

  /**
   * The last change at or above the top of the column, from where it is
   * scrolled; null while the column is not laid out (the view is hidden).
   * One whose top has gone up under the column's edge gives way to the next
   * change when that one is above the reading line already.
   */
  function currentFromScroll(colId) {
    const scroller = scrollerEl(colId);
    if (!scroller || !scroller.getClientRects().length) return null;
    const top = scroller.scrollTop;
    const line = top + CHANGE_OFFSET + 12;
    let at = 0;
    let atY = 0;
    let next = null;
    for (const el of scroller.querySelectorAll('[data-chg]')) {
      if (!el.getClientRects().length) continue;
      const y = offsetIn(scroller, el);
      if (y > line) {
        next = { n: Number(el.dataset.chg), y };
        break;
      }
      at = Number(el.dataset.chg);
      atY = y;
    }
    if (at && atY < top + TAG_ROOM && next && next.y <= top + scroller.clientHeight * READING_LINE) return next.n;
    return at;
  }

  /**
   * The change a column is at: from where it is scrolled, except at either
   * end of the column, where the change last stepped to stays current. A
   * column scrolled at its end shows its last changes below the 48 px line
   * for good, so the scroll position cannot say which of them was reached.
   */
  function whereRead(colId) {
    const n = currentFromScroll(colId);
    const scroller = scrollerEl(colId);
    const same = ui.current.setId === compare.set?.id && ui.current.colId === colId && !ui.current.unplaced;
    if (n === null || !scroller || !same) return n;
    const cur = ui.current.n;
    const atEnd = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
    const atTop = scroller.scrollTop <= 1;
    if ((atEnd && cur > n) || (atTop && cur > 0 && cur < n)) return cur;
    return n;
  }

  /** Bring change `n` of a column under the top; sync brings the others along. */
  function goTo(colId, n, { smooth = !reducedMotion(), offset = CHANGE_OFFSET } = {}) {
    const el = changeEl(colId, n);
    const scroller = compare.sync.scroller(colId);
    const scrollEl = scrollerEl(colId);
    if (!el || !scroller || !scrollEl) return false;
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
    compare.sync.setLeader(colId);
    ui.reading = colId;
    ui.lockUntil = performance.now() + (smooth ? STEP_LOCK_MS : 120);
    setCurrent(colId, n);
    scroller.set(Math.max(0, offsetIn(scrollEl, el) - offset), smooth);
    return true;
  }

  function counter() {
    const colId = changeColumn();
    if (!colId) return null;
    const total = totalOf(colId);
    const n = ui.current.setId === compare.set.id && ui.current.colId === colId ? ui.current.n : 0;
    const ref = refOf(colId);
    const el = n ? changeEl(colId, n) : null;
    const what = el?.dataset.d === 'add' ? 'added' : el?.dataset.d === 'del' ? 'removed' : 'changed';
    return {
      main: `${n} of ${total}`,
      sub: `in ${ref}`,
      unit: 'change',
      spoken: n ? `Change ${n} of ${total} in ${ref}, ${what}` : `${total} changes in ${ref}`,
    };
  }

  function step(dir) {
    const colId = changeColumn();
    if (!colId) return false;
    const total = totalOf(colId);
    const ref = refOf(colId);
    if (!total) {
      say(`${ref} has no differences from ${refOf(baseId())}.`);
      return true;
    }
    const same = ui.current.setId === compare.set.id && ui.current.colId === colId;
    let n = same ? ui.current.n : 0;
    // From where the column is scrolled, which the counter follows a frame
    // behind; but never past what the counter shows when it was worked out
    // before the view was laid out: `]` from "0 of 15" goes to 1. At either
    // end of the column, the change last stepped to (`whereRead`).
    if (performance.now() > ui.lockUntil && !(same && ui.current.unplaced)) n = whereRead(colId) ?? n;
    const next = n + dir;
    if (next < 1 || next > total) {
      say(dir > 0 ? `That was the last change in ${ref}.` : `That was the first change in ${ref}.`);
      return true;
    }
    return goTo(colId, next);
  }

  /** A column scrolled: the current change follows it, unless a step is still landing. */
  function follow() {
    const colId = changeColumn();
    if (colId && performance.now() > ui.lockUntil) {
      const n = whereRead(colId);
      if (n !== null && (ui.current.unplaced || n !== ui.current.n || ui.current.colId !== colId || ui.current.setId !== compare.set.id)) {
        setCurrent(colId, n);
      }
    }
    holdTag();
  }

  return {
    changeColumn, showCurrent, place, goTo, counter, step, follow,
  };
}
