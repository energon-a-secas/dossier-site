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
 */

import { escHtml } from '../neorgon-dom.js';
import { view as currentView } from '../chrome.js';
import { say } from '../share.js';
import { columnMarks, countsSentence, baseName } from './marks.js';
import { bodyKey } from './column.js';
import { columnEl } from './view.js';
import { icon } from './icons.js';
import { columnById } from './model.js';
import { nameOf, displayColumns } from './blind.js';
import { isPhone } from './popover.js';
import { attachRuler, keepRulers } from './ruler.js';
import { createPanel } from './panel.js';
import { renderSections, markSectionRow } from './sections-panel.js';
import { createReview } from './review.js';
import { bindDiffControls } from './diff-controls.js';
import { createChanges, TICK_OFFSET } from './changes.js';
import { createPlans, sourceId } from './plans.js';

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

  const { baseId, planFor } = createPlans(compare, ui.wordMarks);

  const refOf = (colId) => nameOf(compare.set, colId).ref;

  // ── Hooks for the core ─────────────────────────────────────────────────────

  function bodyHooks(col) {
    const set = compare.set;
    const plan = planFor(col);
    if (!plan) return {};
    const baseRef = refOf(baseId(set));
    // A column in Original or running its scripts says why it is not marked
    // in its head's difference line, once (`headInfo`), not again here.
    if (!plan.result) return {};
    if (plan.result.failed) {
      return { notes: baseNote(`<b>Too different from ${baseName(baseRef)} to compare part by part.</b> Its sections still line up in the Sections panel.`) };
    }
    if (plan.counted) {
      return { notes: baseNote(`Differences from ${baseName(baseRef)} are counted above, not marked in the text: this column holds a Dossier document.`) };
    }
    const hooks = { marks: columnMarks(plan.result, { colId: col.id, baseRef, bars: plan.bars }) };
    if (plan.bars) hooks.notes = barsNote(baseRef);
    return hooks;
  }

  /**
   * A column notice naming the base, as js/compare/column.js `note` draws
   * one. `html` is our own markup; the base's name goes in through
   * `baseName`, escaped there and renamed in place (`relabel`).
   */
  function baseNote(html) {
    return `<p class="col-note">${icon('info')}<span>${html}</span></p>`;
  }

  /**
   * The notice of a column too different to mark word by word. Its last
   * sentence points at the Word marks button, which the one-file export
   * does not carry, so it is a span of its own that the export leaves out
   * (js/compare/export.js `readerCopy`).
   */
  function barsNote(baseRef) {
    return baseNote(`<b>Too different from ${baseName(baseRef)} to mark word by word.</b> `
      + 'Margin bars show where it differs, and its sections still line up. '
      + '<span class="col-note__live">Turn on Word marks to see every word anyway.</span>');
  }

  /**
   * Name the base as it is named now everywhere a column's text names it.
   * Its name is not part of a body's key (`bodyKeyExtra`): Blind and a move
   * rename the base without changing a mark, and a body drawn again starts
   * at its top and drops focus, which with Sync off nothing put back.
   */
  function relabel(base) {
    const ref = base ? refOf(base) : '';
    for (const el of refs.columns.querySelectorAll('[data-base-ref]')) {
      if (el.textContent !== ref) el.textContent = ref;
    }
  }

  function bodyKeyExtra(col) {
    const set = compare.set;
    const plan = planFor(col);
    // An Original or interactive column's body does not change with the
    // differences, so toggling them never reloads its frame.
    if (!plan || plan.base || plan.off) return '';
    if (plan.pending) return '|dp';
    if (plan.unreadable) return `|du:${plan.unreadable}`;
    const base = baseId(set);
    const d = set.view.diff;
    // The base's name is left out on purpose: `relabel` keeps it current.
    return `|d:${base}:${sourceId(columnById(set, base)?.source)}:${d.ignoreCase ? 1 : 0}${d.ignorePunctuation ? 1 : 0}`
      + `:${plan.bars ? 'b' : 'w'}`;
  }

  function headInfo(col, record) {
    const set = compare.set;
    if (!col.source) return {};
    if (!set.view.diff.on) return { diffLine: '<span>Differences are off.</span>' };
    const base = baseId(set);
    if (!base) return {};
    if (col.id === base) {
      const diffLine = planFor(col, record)?.unreadable
        ? '<span>Base for differences, but it could not be read, so no column is marked. Choose another base in Differences against.</span>'
        : '<span>Base for differences. Other columns are marked against this one.</span>';
      return { isBase: true, diffLine };
    }
    const baseRef = refOf(base);
    const info = { baseStats: compare.ui.records.get(base)?.stats || null, baseLetter: baseRef };
    const plan = planFor(col, record);
    if (!plan) return info;
    if (plan.off === 'scripts') info.diffLine = '<span>Differences are off for a column that runs its scripts.</span>';
    else if (plan.off) info.diffLine = '<span>Differences show in Dossier format.</span>';
    else if (plan.unreadable === 'column') info.diffLine = '<span>Not compared: this Dossier document could not be read.</span>';
    else if (plan.unreadable) info.diffLine = `<span>Not compared: ${escHtml(baseRef)}, the base, could not be read.</span>`;
    else if (plan.pending) info.diffLine = `<span>Counting differences from ${escHtml(baseRef)}.</span>`;
    else if (plan.result.failed) info.diffLine = `<span>Too different from ${escHtml(baseRef)} to compare.</span>`;
    else info.diffLine = diffLine(col, plan, baseRef);
    return info;
  }

  /**
   * "15 differences from B" and what they are: "6 changed, 6 added, 3
   * removed". Where the column is marked word by word, each part is drawn
   * the way its marks are (a changed tint, an inserted word, a struck one),
   * so the parts are the key as well (design spec 7.3.4).
   */
  function diffLine(col, plan, baseRef) {
    const { counts } = plan.result;
    const total = counts.total;
    const words = total
      ? `<b>${total}</b> difference${total === 1 ? '' : 's'} from ${escHtml(baseRef)}`
      : `No differences from ${escHtml(baseRef)}`;
    const count = `<span class="col__count" title="${escHtml(countsSentence(counts))}">${words}</span>`;
    const parts = [['k-chg', counts.changed, 'changed'], ['k-ins', counts.added, 'added'], ['k-del', counts.removed, 'removed']]
      .filter(([, n]) => n)
      .map(([cls, n, word]) => `<span class="${cls}">${n} ${word}</span>`);
    const keyed = !plan.counted && !plan.bars;
    const key = parts.length
      ? `<span class="key${keyed ? '' : ' key--plain'}"><span class="visually-hidden">: </span>${parts.join('<span class="visually-hidden">, </span>')}</span>`
      : '';
    if (plan.result.tooDifferent && !plan.counted) {
      return `${count}${key}<button type="button" class="btn btn--xs toggle col__words" data-action="cmp-word-marks" data-col="${col.id}"`
        + ` aria-pressed="${plan.forced}"><span class="box">${icon('check')}</span>Word marks</button>`;
    }
    return `${count}${key}`;
  }

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

  function headingsOf(colId) {
    const rec = compare.ui.records.get(colId);
    if (rec?.kind === 'interactive') return null;
    return compare.sync.has(colId) ? compare.sync.headings(colId) : [];
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
    relabel(base);
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
    panel,
    goToSection,
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
  return { baseId, changeColumn };
}
