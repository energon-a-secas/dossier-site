/**
 * The Compare view's analysis: differences against a base column, the change
 * ruler and counter, the Sections and Review panels, and Blind. It plugs
 * into the core through `compare.hooks` (js/compare/index.js), so the core
 * draws columns without knowing any of this exists.
 *
 *   plan      per column (js/compare/plans.js): is it the base, is it marked
 *             (and how), or why not
 *   marks     drawn by the IR renderer through `bodyHooks().marks`
 *   current   the change the counter points at: outlined, tagged "2 of 9",
 *             followed as the column scrolls, moved by `[`, `]` and the ruler
 *
 * Differences are computed for columns in Dossier format only. A column in
 * Original or running its scripts says so, and a Dossier document is counted
 * against the base but not marked (its text is drawn by the report renderer,
 * not from the IR). Design spec 7.3.
 *
 * Each column is marked against its reference (js/compare/model.js
 * `diffAgainst`): the base, or with "Each against its source" the column a
 * fix corrects. The head line and notes of each column are
 * js/compare/diff-heads.js, the numbers that changed js/compare/numbers.js,
 * and a choice that changes on its own is said by js/compare/base-watch.js.
 */

import { view as currentView } from '../chrome.js';
import { say } from '../share.js';
import { bodyKey } from './column.js';
import { columnEl } from './view.js';
import { columnById } from './model.js';
import { nameOf, displayColumns } from './blind.js';
import { isPhone } from './popover.js';
import { attachRuler, keepRulers } from './ruler.js';
import { createPanel } from './panel.js';
import { renderSections, markSectionRow } from './sections-panel.js';
import { createReview } from './review.js';
import { bindDiffControls } from './diff-controls.js';
import { createChanges, TICK_OFFSET } from './changes.js';
import { createPlans } from './plans.js';
import { createDiffHeads } from './diff-heads.js';
import { watchBase } from './base-watch.js';
import { withSectionText } from './section-text.js';

/** @param {object} api from js/compare/index.js */
export function initAnalysis(api) {
  const { compare } = api;
  const refs = compare.refs;
  const root = refs.root;
  const ui = {
    /** Columns whose Word marks were turned on: `${setId}:${colId}`. */
    wordMarks: new Set(),
    current: { setId: null, colId: null, n: 0 },
    lockUntil: 0,
    scrollFrame: 0,
    pendingFrame: 0,
    shareWas: null,
    /** The column the reader last pointed at, scrolled or focused. */
    reading: null,
    /**
     * The Sections row last chosen, and where its column was left: it stays
     * the marked row until that column moves, even when the column could
     * not bring the heading all the way to its reading line (its last
     * section, near the end).
     */
    chosenRow: null,
  };
  // Sync's leader also moves when the browser adjusts a scroll position on
  // its own (a font arriving), so the column being read is what the reader
  // last touched.
  for (const type of ['pointerdown', 'wheel', 'focusin', 'touchstart']) {
    refs.columns.addEventListener(type, (event) => {
      const col = event.target.closest?.('.col');
      if (col?.dataset.col) ui.reading = col.dataset.col;
    }, { passive: true });
  }

  // ── Plans ──────────────────────────────────────────────────────────────────

  const plans = createPlans(compare, ui.wordMarks);
  const {
    baseId, planFor, refFor, isEach,
  } = plans;

  const refOf = (colId) => nameOf(compare.set, colId).ref;

  // ── Hooks for the core ─────────────────────────────────────────────────────

  const {
    bodyHooks, bodyKeyExtra, headInfo, relabel,
  } = createDiffHeads({ compare, plans, refOf });
  watchBase(api, refOf);

  const changes = createChanges({
    api, ui, planFor, refOf, baseId,
  });
  const {
    changeColumn, showCurrent, goTo, counter, step,
  } = changes;
  // The view is drawn before it is shown when a comparison opens from the
  // welcome screen or the Open dialog: the first layout places the counter.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (ui.current.unplaced && compare.set) changes.follow();
    }).observe(refs.columns);
  }

  // ── Scrolling ──────────────────────────────────────────────────────────────

  function onScroll() {
    if (ui.scrollFrame) return;
    ui.scrollFrame = requestAnimationFrame(() => {
      ui.scrollFrame = 0;
      changes.follow();
      markSections();
    });
  }

  // ── Panels ─────────────────────────────────────────────────────────────────

  /**
   * A column's headings for the Sections panel, each with its label line and
   * body words from the IR (js/compare/section-text.js), worked out once per
   * registered list.
   */
  const withText = new WeakMap();
  function headingsOf(colId) {
    const rec = compare.ui.records.get(colId);
    if (rec?.kind === 'interactive') return null;
    if (!compare.sync.has(colId)) return [];
    const list = compare.sync.headings(colId);
    const blocks = plans.irOf(columnById(compare.set, colId), rec || null);
    if (!list.length || !Array.isArray(blocks) || !blocks.length) return list;
    if (!withText.has(list)) withText.set(list, withSectionText(list, blocks));
    return withText.get(list);
  }

  const review = createReview(api);
  let sectionsHost = null;
  const panel = createPanel(api, {
    render(name, host) {
      if (name === 'review') {
        sectionsHost = null;
        review.render(host);
      } else {
        sectionsHost = host;
        renderSections(host, compare.set, baseId(), headingsOf);
        markSections();
      }
    },
  });

  /** The column the Sections panel follows: the base, or the one column shown. */
  function sectionsColumn(set) {
    const single = set.view.layout === 'focus' || isPhone();
    return single ? set.view.focus : baseId(set);
  }

  /** The row of the section at the reading line of the column being read. */
  function markSections() {
    const host = sectionsHost;
    const data = host?.isConnected ? host.sectionData : null;
    if (!data) return;
    const set = compare.set;
    const base = baseId(set);
    const colId = sectionsColumn(set);
    if (!compare.sync.has(colId)) {
      markSectionRow(host, -1);
      return;
    }
    const chosen = ui.chosenRow;
    const y = compare.sync.scroller(colId)?.y();
    if (chosen && chosen.setId === set.id && chosen.colId === colId && Math.abs(y - chosen.y) <= 2) {
      markSectionRow(host, chosen.row);
      return;
    }
    ui.chosenRow = null;
    const at = compare.sync.currentHeading(colId, { line: true });
    let row = -1;
    data.rows.forEach((r, i) => {
      const h = colId === base ? r.heading : r.cells[colId]?.heading;
      if (Number.isInteger(h) && h <= at) row = i;
    });
    markSectionRow(host, row);
  }

  /**
   * A Sections row: bring its section to the reading line of every column
   * that has it (design spec 7.3.8). Each column is put at its own heading
   * for the row, the ones the panel matched as moved included; a column
   * without the section follows through sync.
   */
  function goToSection(el) {
    const host = sectionsHost;
    const data = host?.sectionData;
    if (!data) return;
    const set = compare.set;
    const base = baseId(set);
    const isExtra = el.dataset.extra !== undefined;
    const row = isExtra ? data.extras[Number(el.dataset.extra)] : data.rows[Number(el.dataset.row)];
    if (!row) return;
    const single = set.view.layout === 'focus' || isPhone();
    let colId = single ? set.view.focus : (isExtra ? row.owner : base);
    let heading = colId === base && !isExtra ? row.heading : row.cells[colId]?.heading;
    if (!Number.isInteger(heading) && !single) {
      // The lead column lacks it: lead from a column that has it.
      const has = displayColumns(set).find((col) => Number.isInteger(row.cells[col.id]?.heading));
      colId = has?.id || colId;
      heading = row.cells[colId]?.heading;
    }
    if (!Number.isInteger(heading)) {
      say(`${refOf(colId)} has no section called "${row.text}".`);
      return;
    }
    const headingIn = (col) => (col.id === base && !isExtra ? row.heading : row.cells[col.id]?.heading);
    const matches = new Map();
    const lacking = [];
    for (const col of displayColumns(set)) {
      // A column running its scripts has no headings to read or place.
      if (!col.source || col.id === colId || !compare.sync.has(col.id)) continue;
      const h = headingIn(col);
      if (Number.isInteger(h)) matches.set(col.id, h);
      else lacking.push(refOf(col.id));
    }
    compare.sync.jump(colId, heading, { smooth: false, line: true, matches });
    const marking = sectionsColumn(set);
    ui.chosenRow = !isExtra && marking === colId
      ? { setId: set.id, colId, row: Number(el.dataset.row), y: compare.sync.scroller(colId)?.y() }
      : null;
    markSections();
    const others = single ? '' : lacking.length
      ? `. ${lacking.join(' and ')} ${lacking.length === 1 ? 'has' : 'have'} no section like it`
      : ', in every column';
    api.announce(`${row.text}, at the reading line${others}.`);
    if (panel.overlay() || panel.asSheet()) panel.close();
  }

  // ── After every render ─────────────────────────────────────────────────────

  function afterRender() {
    const set = compare.set;
    if (!set) return;
    if (ui.setId !== set.id) {
      ui.setId = set.id;
      ui.reading = null;
    }
    const d = set.view.diff;
    root.classList.toggle('diff-off', !d.on);
    root.classList.toggle('hide-removed', !d.showRemoved);
    root.classList.toggle('blind', Boolean(set.view.blind));
    const base = baseId(set);
    let stale = false;
    const marked = new Set();
    // Blind's report order is the page's own order (js/compare/view.js
    // `renderColumns`), so print, Tab and a screen reader follow it too.
    for (const col of set.columns) {
      const el = columnEl(refs, col.id);
      if (!el) continue;
      el.classList.toggle('is-base', Boolean(d.on && col.id === base));
      const plan = planFor(col);
      if (staleBody(set, col, el)) stale = true;
      const rec = compare.ui.records.get(col.id);
      if (plan?.result && !plan.counted && !plan.result.failed && rec?.kind === 'reader' && rec.scrollEl?.isConnected) {
        marked.add(col.id);
        attachRuler(col.id, el.querySelector('.col__body'), rec.scrollEl, {
          onTick: (n) => goTo(col.id, n, { smooth: false, offset: TICK_OFFSET }),
          onTrack: (y) => compare.sync.scroller(col.id)?.set(Math.max(0, y), false),
        });
      }
    }
    keepRulers(marked);
    relabel();
    if (ui.current.setId === set.id && !marked.has(ui.current.colId)) ui.current = { setId: set.id, colId: null, n: 0 };
    showCurrent();
    // The counter starts where the column being read is, and once more at
    // the first layout when it was worked out while the view was hidden.
    const reading = changeColumn();
    if (reading && performance.now() > ui.lockUntil
      && (ui.current.setId !== set.id || ui.current.colId !== reading || ui.current.unplaced)) {
      changes.place(reading);
    }

    if (set.view.blind) {
      for (const el of root.querySelectorAll('.set-title__text')) el.textContent = 'Blind review';
      for (const el of root.querySelectorAll('.set-title')) el.setAttribute('aria-label', 'Comparison title, hidden while Blind is on');
      if (currentView() === 'compare') document.title = 'Blind review | Compare | Dossier';
    }
    controls.sync();
    panel.layout();
    keepShareOn();

    // A body drawn before what its marks depend on (a Dossier document is
    // read from its drawn record, which a column drawn before it does not
    // have yet) is drawn once more. Twice in a row at most, so nothing can
    // keep the view redrawing: an unreadable document used to, every frame.
    ui.redraws = stale ? (ui.redraws || 0) + 1 : 0;
    if (stale && ui.redraws <= 2 && !ui.pendingFrame) {
      ui.pendingFrame = requestAnimationFrame(() => {
        ui.pendingFrame = 0;
        api.render();
      });
    }
  }

  /**
   * The column's body was drawn for differences that have changed since in
   * the same render: its key, with the part this module adds, is not the
   * one it would get now.
   */
  function staleBody(set, col, el) {
    if (!col.source || compare.ui.forms.has(col.id)) return false;
    const key = el.querySelector(':scope > .col__body')?.dataset.key;
    return Boolean(key) && key !== bodyKey(set, col) + bodyKeyExtra(col);
  }

  /** The header's Share works in Compare even with no report open. */
  function keepShareOn() {
    const share = document.getElementById('shareReport');
    if (!share || currentView() !== 'compare') return;
    if (ui.shareWas === null) ui.shareWas = share.disabled;
    share.disabled = false;
  }

  document.addEventListener('dossier-view', (event) => {
    const share = document.getElementById('shareReport');
    if (event.detail?.view !== 'compare' && share && ui.shareWas !== null) {
      share.disabled = ui.shareWas;
      ui.shareWas = null;
    }
  });

  const controls = bindDiffControls(api, {
    baseId,
    isEach,
    refFor,
    planFor,
    refOf,
    panel,
    goToSection,
    goToChange: (colId, n) => goTo(colId, n),
    wordMarks: ui.wordMarks,
    onWordMarks: () => api.render(),
  });

  Object.assign(compare.hooks, {
    headInfo, bodyHooks, bodyKeyExtra, counter, step,
  });
  compare.hooks.afterRender.push(afterRender);
  (compare.hooks.onScroll ||= []).push(onScroll);
  (compare.hooks.onRegister ||= []).push(() => {
    if (sectionsHost?.isConnected && compare.set?.view.panel === 'sections') {
      renderSections(sectionsHost, compare.set, baseId(), headingsOf);
      markSections();
    }
  });
  window.addEventListener('resize', () => {
    if (compare.set) panel.layout();
  });
  for (const name of ['diff', 'panels', 'blind']) api.enableFeature(name);

  // What the one-file export needs (js/compare/export.js).
  return { baseId, changeColumn, isEach };
}
