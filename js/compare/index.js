/**
 * The Compare view: entering and leaving it, which set is open, rendering,
 * and saving.
 *
 * Route: `#/~compare` (the last or a new set) and `#/~compare/<set id>`.
 * js/boot.js announces every route (`dossier-route`) and js/chrome.js every
 * view change (`dossier-view`); this module listens to both and owns nothing
 * of the Reports view's state (`state.model` and the rest stay that view's).
 *
 * A set is saved in IndexedDB (js/compare/store.js) a moment after each
 * change, and at once when the view is left or another set opens. A write
 * started as the page unloads never commits, so when the page hides with a
 * change still waiting (or still being written), the change also goes into a
 * small synchronous journal in localStorage (js/compare/journal.js), which
 * the next visit replays before it opens a set. A new blank set and the
 * bundled example are not saved until something is put in them or what they
 * hold is changed (a view change alone does not count), so opening, reading
 * and closing them leaves no clutter behind.
 *
 * Every save says which stored revision it was made on. When another tab has
 * saved the set since, the two versions are merged key by key
 * (js/compare/merge.js) and the merge is saved, so a note typed here and a
 * mark clicked there both stay.
 *
 * The analysis features (differences, the side panels, Blind) plug in
 * through `compare.hooks` and `enableFeature`, so this file does not need to
 * know how they work. See the `hooks` object below.
 */

import { createStore } from '../neorgon-persist.js';
import { debounce } from '../neorgon-dom.js';
import { routeFor, parseRoute } from '../router.js';
import { view as currentView } from '../chrome.js';
import { say, sentence } from '../share.js';
import { mountView, renderColumns, columnEl } from './view.js';
import { syncToolbar } from './toolbar.js';
import { createReading } from './reading.js';
import { bindPopovers, closePopover, isPhone, PHONE } from './popover.js';
import { createSync, elementScroller } from './sync.js';
import { frameScroller, blockedLinkSentence } from './frame.js';
import { blankSet, sameContent } from './model.js';
import { sanitizeSet } from './records.js';
import { initYaml, yamlReady, needsYaml } from '../parse.js';
import { readSet, listSets, onExternalChange } from './store.js';
import { createSaving } from './saving.js';
import { registerCompareActions } from './actions.js';
import { initAnalysis } from './analysis.js';
import { initExport } from './export.js';
import { initBrief } from './brief.js';
import { initBridge } from './bridge.js';

const prefs = createStore({ key: 'dossier-site:compare', version: 1 });

/**
 * Everything the view knows. One object, so the action handlers and the
 * analysis features see the same thing.
 */
export const compare = {
  refs: null,
  set: null,
  /** True once the set exists in IndexedDB. */
  saved: false,
  /**
   * The open set as it was last known to be stored (read, written, or heard
   * from another tab), and its revision (`updated`). A save expects the
   * stored set still to be at `rev`; `base` is what a merge starts from.
   */
  base: null,
  rev: undefined,
  /** The bundled example, open and unchanged. */
  example: false,
  /**
   * records: what each column's body holds. forms: a form open in a column.
   * scroll: positions to put back. lastY: where each column was last seen,
   * kept as it scrolls, because a hidden view reads every position as 0.
   * catchUp: redrawn columns still to be brought level (see `catchUp`).
   */
  ui: {
    records: new Map(), forms: new Map(), scroll: new Map(), lastY: new Map(), catchUp: null,
  },
  sync: null,
  features: new Set(),
  /**
   * Seams for the analysis features. Each is optional.
   *   headInfo(col, record) -> extra fields for the column head
   *     ({isBase, baseStats, baseLetter, diffLine}); merged over the stats.
   *     A column's head names its own reference, the column it is marked
   *     against, which with "Each against its source" is not always the base
   *   bodyHooks(col) -> extra hooks for js/compare/column.js (`marks`)
   *   bodyKeyExtra(col) -> a string that, when it changes, redraws the body
   *   step(dir) -> true when it moved (changes), else headings are stepped
   *   counter() -> {main, sub, unit} for the toolbar counter, or null
   *   loadPayload(route) -> open a comparison carried in the address (#dc=)
   *   afterRender: [fn(compare)] run after every render
   *   afterCommit: [fn(before, next)] run after a committed set is drawn
   *   onScroll: [fn(colId)] a column scrolled (by the reader or by sync)
   *   onRegister: [fn(colId)] a column's headings became readable (a frame loaded)
   *   beforeSwitch: [fn()] run before the open set changes, the view is left
   *     or the page hides; flush edits still waiting (a note being typed)
   *   pending: [fn() -> boolean] an edit is waiting that is not in the set yet
   */
  hooks: {
    afterRender: [], afterCommit: [], onScroll: [], onRegister: [], beforeSwitch: [], pending: [],
  },
};

const {
  rememberScroll, restoreScroll, scheduleCounter, counterInfo, step, announce,
  readingPlace, catchUp, caughtUp,
} = createReading(compare);

// Saving (js/compare/saving.js): the timer, the write, other tabs' saves,
// edits still waiting, and the page-hide journal.
const {
  save, flushPending, onHide, replayOnce, tookOtherTabsWrite,
} = createSaving({
  compare, render, rememberScroll, remember, syncAddress,
});

let loading = Promise.resolve();
/** The page title the Reports view uses, put back when Compare is left. */
let reportsTitle = '';

// ── Public API ───────────────────────────────────────────────────────────────

/** Build the view and start listening. Called once by js/boot.js. */
export function initCompare() {
  const root = document.getElementById('compareView');
  if (!root || compare.refs) return;
  compare.refs = mountView(root);
  reportsTitle = document.title;
  compare.sync = createSync({
    onScroll: (colId) => {
      const scroller = compare.sync.scroller(colId);
      if (scroller) compare.ui.lastY.set(colId, scroller.y());
      scheduleCounter();
      for (const fn of compare.hooks.onScroll || []) fn(colId);
    },
  });
  bindPopovers();
  registerCompareActions(api);
  // Differences, the side panels and Blind, then the comparison's exports
  // and its link; each plugs in through `compare.hooks`.
  const analysis = initAnalysis(api);
  initExport(api, analysis);
  // The brief above the columns, and the way between Reports and Compare.
  initBrief(api);
  initBridge(api);

  document.addEventListener('dossier-view', (event) => {
    const { view: next, previous } = event.detail || {};
    if (next === 'compare' && previous !== 'compare') enter();
    if (next !== 'compare' && previous === 'compare') leave();
  });
  document.addEventListener('dossier-route', (event) => {
    routeCompare(event.detail || {});
  });
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
  });
  window.addEventListener('resize', debounce(() => {
    compare.sync.remeasure();
    scheduleCounter();
  }, 150));
  // Crossing into or out of the phone layout turns the columns into tab
  // panels or back into regions (js/compare/view.js).
  if (typeof matchMedia === 'function') {
    matchMedia(PHONE).addEventListener?.('change', () => render());
  }
  onExternalChange(onOtherTab);
  // A journal the last visit left (a change it could not save as it
  // unloaded) is saved now, whichever view this visit opens on.
  replayOnce();
}

/**
 * Follow a route. Resolves once the set it names is on screen, so boot can
 * keep the view hidden until then.
 */
export function routeCompare(route = parseRoute()) {
  const isPayload = route.payload && route.key === 'dc';
  if (route.view !== 'compare' && !isPayload) return loading;
  loading = (async () => {
    await replayOnce();
    if (isPayload) {
      if (typeof compare.hooks.loadPayload === 'function' && await compare.hooks.loadPayload(route)) return;
      await ensureSet();
      return;
    }
    let missing = false;
    if (route.id && compare.set?.id !== route.id) {
      const found = await readSet(route.id);
      if (found) {
        openSet(found, { saved: true });
        return;
      }
      missing = true;
    }
    await ensureSet();
    // Say what is open instead. It used to say "the last one" over a new
    // blank set, in a browser that had never saved a comparison.
    if (missing) {
      say(`That comparison is not saved in this browser, so ${compare.saved ? 'the last one is open instead.'
        : compare.example ? 'the example stays open.' : 'a new comparison is open instead.'}`);
    }
    syncAddress();
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('The comparison could not be opened', err);
  });
  return loading;
}

/** Resolves when the comparison being opened is on screen. */
export function compareSettled() {
  return loading;
}

/** `[` and `]` in the Compare view: the next change, or the next heading. */
export function compareStep(dir) {
  if (currentView() !== 'compare' || !compare.set) return false;
  return step(dir);
}

/** `/` in the Compare view opens the Comparisons switcher at its filter. */
export function focusCompareFilter() {
  if (currentView() !== 'compare') return false;
  const button = compare.refs?.root.querySelector('#cmpSwitcherBtn');
  const visible = button && button.getClientRects().length ? button : compare.refs?.root.querySelector('#cmpOptionsBtn');
  api.openSwitcher(visible);
  return true;
}

/** A feature turns its controls on: `#compareView.has-<name>`. */
export function enableFeature(name) {
  compare.features.add(name);
  compare.refs?.root.classList.add(`has-${name}`);
}

// ── Opening sets ─────────────────────────────────────────────────────────────

async function ensureSet() {
  if (compare.set) {
    render();
    return;
  }
  const last = prefs.load({})?.lastSetId;
  let found = typeof last === 'string' ? await readSet(last) : null;
  if (!found) {
    const newest = (await listSets())[0];
    if (newest) found = await readSet(newest.id);
  }
  if (compare.set) return;
  if (found) openSet(found, { saved: true });
  else openSet(blankSet(), { saved: false });
}

/**
 * Show a set. Whatever was open is saved first.
 *
 * @param {object} set
 * @param {{saved?: boolean, example?: boolean, push?: boolean}} [opts]
 *   `push` adds a history entry, so Back returns to the previous comparison
 */
function openSet(set, { saved = false, example = false, push = false } = {}) {
  // An edit still waiting (a note being typed) lands in the set it was typed
  // in, before that set stops being the open one.
  flushPending();
  save.flush();
  closePopover({ restore: false });
  compare.sync.clear();
  compare.ui = {
    records: new Map(), forms: new Map(), scroll: new Map(), lastY: new Map(), catchUp: null,
  };
  compare.refs.columns.replaceChildren();
  compare.set = set;
  compare.saved = saved;
  compare.example = example;
  compare.base = saved ? set : null;
  compare.rev = saved ? set.updated : undefined;
  if (saved) remember(set.id);
  render();
  // A Dossier column saved as YAML (Edit source keeps the typed text) reads
  // only once the YAML parser is in, which nothing loads at boot, so those
  // columns are drawn again when it lands.
  if (!yamlReady() && set.columns.some((c) => c.source?.kind === 'dossier' && needsYaml(c.source.text))) {
    initYaml().then(() => {
      if (!yamlReady() || compare.set?.id !== set.id) return;
      for (const c of compare.set.columns) {
        if (c.source?.kind === 'dossier' && needsYaml(c.source.text)) compare.ui.records.delete(c.id);
      }
      render();
    });
  }
  syncAddress({ push });
}

function remember(id) {
  prefs.save({ ...(prefs.load({}) || {}), lastSetId: id });
}

/** Keep the address naming the open set (only while the view is Compare). */
function syncAddress({ push = false } = {}) {
  if (currentView() !== 'compare' || !compare.set) return;
  const route = parseRoute();
  if (route.payload) return;
  const want = compare.saved ? routeFor({ view: 'compare', id: compare.set.id }) : routeFor({ view: 'compare' });
  if (location.hash === want) return;
  if (push) history.pushState(null, '', want);
  else history.replaceState(history.state, '', want);
}

// ── Changing the open set ────────────────────────────────────────────────────

/**
 * The one way the open set changes. Renders, then saves a moment later.
 *
 * A change to how the set is shown (the column in focus, the layout, sync, a
 * render mode, the difference options) is saved with a set that is already
 * saved, so it reopens the same way. It does not make the bundled example or
 * a new blank set into a saved comparison: reading the example on a phone
 * means tapping its A, B and C tabs, and each tap used to add another copy of
 * it to the switcher. Only a change to what the set holds does that.
 *
 * @param {object} next
 * @param {{save?: boolean}} [opts]
 */
function commit(next, { save: shouldSave = true } = {}) {
  if (!next) return;
  const before = compare.set;
  compare.set = next;
  render();
  for (const fn of compare.hooks.afterCommit || []) fn(before, next);
  if (!shouldSave) return;
  if (!compare.saved && sameContent(before, next)) return;
  compare.example = false;
  save({ columns: before?.columns !== next.columns });
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render() {
  const { refs, set } = compare;
  if (!refs || !set) return;
  // Columns that already had a body, and where the reader was, in case a
  // body is redrawn below (a render mode change) and has to catch up.
  const had = new Set(compare.ui.records.keys());
  const place = readingPlace();
  const redrawn = [];
  renderColumns(refs, set, compare.ui, {
    tabbed: isPhone(),
    headInfo: headInfo,
    bodyHooks: (col) => ({
      ...(compare.hooks.bodyHooks ? compare.hooks.bodyHooks(col) : {}),
      onFrameReady: (record) => registerScroller(col.id, record),
      onBlockedLink: (href) => say(blockedLinkSentence(href)),
    }),
    bodyKeyExtra: compare.hooks.bodyKeyExtra,
    onBody: (col, record) => {
      if (had.has(col.id)) redrawn.push(col.id);
      registerScroller(col.id, record);
      restoreScroll(col.id);
    },
    onRemoved: (colId) => compare.sync.unregister(colId),
  });
  if (redrawn.length) catchUp(redrawn, place);
  compare.sync.setMode(set.view.sync);
  syncToolbar(refs.root, set, { counter: counterInfo() });
  if (currentView() === 'compare') document.title = `${set.title} | Compare | Dossier`;
  for (const fn of compare.hooks.afterRender || []) fn(compare);
}

function headInfo(col, record) {
  const base = { stats: record?.stats || null };
  return compare.hooks.headInfo ? { ...base, ...compare.hooks.headInfo(col, record) } : base;
}

function registerScroller(colId, record) {
  const el = columnEl(compare.refs, colId);
  // A frame that finished loading after its column was redrawn is gone.
  if (!record || !el || compare.ui.records.get(colId) !== record) return;
  if (record.kind === 'reader' || record.kind === 'error') {
    compare.sync.register(colId, elementScroller(record.scrollEl, record.headingEls), record.headings, el);
  } else if (record.kind === 'frame' && record.frame.contentDocument) {
    const scroller = frameScroller(record.frame, record.headingEls.map((h) => ({ el: h })));
    compare.sync.register(colId, scroller, record.headings, el);
    restoreScroll(colId);
  } else {
    compare.sync.unregister(colId);
  }
  scheduleCounter();
  caughtUp(colId, record);
  for (const fn of compare.hooks.onRegister || []) fn(colId);
}

/**
 * The view is shown. Columns drawn while it was hidden (the example opened
 * from the welcome screen) measured every heading at 0, so the positions are
 * taken again now and once more after layout, and the counter follows.
 */
function enter() {
  compare.sync.remeasure();
  render();
  requestAnimationFrame(() => {
    for (const colId of compare.ui.scroll.keys()) restoreScroll(colId);
    compare.sync.remeasure();
    scheduleCounter();
  });
}

function leave() {
  rememberScroll();
  closePopover({ restore: false });
  flushPending();
  save.flush();
  if (reportsTitle) document.title = reportsTitle;
}

// ── Other tabs ───────────────────────────────────────────────────────────────

async function onOtherTab(ids, kind) {
  const set = compare.set;
  if (!set || !ids.includes(set.id)) return;
  if (kind === 'delete') {
    compare.saved = false;
    compare.base = null;
    compare.rev = undefined;
    if (currentView() === 'compare') {
      // Under Blind the title stays hidden, even here.
      const what = set.view.blind ? 'This comparison' : `"${set.title}"`;
      say(sentence(`${what} was deleted in another tab. It stays open here until you leave it`));
    }
    return;
  }
  // Another tab saved this set: taken, or merged with an edit waiting here.
  await tookOtherTabsWrite();
}

// ── The API the action handlers use ──────────────────────────────────────────

export const api = {
  compare,
  commit,
  render,
  openSet,
  /** Save the open set now (in turn with any write under way). */
  persistNow: () => save.now(),
  rememberScroll,
  scheduleCounter,
  /** Save a change still waiting now; resolves once it is written. */
  flushSave: () => save.flush(),
  step,
  /**
   * A seam for the analysis features: tell a screen reader where a move
   * landed (a Sections panel row that scrolls every column). Nothing in the
   * core calls it through here; `step` announces on its own.
   */
  announce,
  /** Open a bundle's set as a new, saved comparison. */
  async openBundleSet(set) {
    const clean = sanitizeSet(set);
    if (!clean) return false;
    openSet(clean, { saved: false, push: true });
    compare.example = false;
    await save.now();
    return true;
  },
  openSwitcher: null,
  /** Set by js/compare/actions.js from the column's own actions, for js/compare/bridge.js. */
  focusColumn: null, setColumnSource: null, openBundle: null,
  /** A feature turns its controls on (see `enableFeature`). */
  enableFeature: (name) => enableFeature(name),
};
