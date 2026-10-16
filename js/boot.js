/**
 * The boot sequence, in the order that matters.
 *
 * The order is not arbitrary. A report in the URL must win over the last
 * report in this browser, or a shared link opens someone else's draft. The
 * mode is decided before the first render, so a reader never sees the editor
 * appear and then leave: js/appearance.js guesses it before the first paint
 * and keeps the shell hidden (`data-dossier-booting`) until the first render
 * here, which removes the marker.
 *
 * A first visit opens on the welcome screen, not on an example: the welcome
 * screen is the front door and says what the tool is for.
 *
 * Controls, shortcuts and the router are live before the initial report
 * arrives. Every open takes a ticket (js/open.js), and the initial load
 * commits only if no other open happened while it was loading, so a file
 * dropped during boot is not replaced by the stored report a moment later.
 */

import { loadSaved, setPreference, forgetPreference } from './state.js';
import { rerender } from './pipeline.js';
import { reportOf } from './render/index.js';
import { loadFromUrl, fragmentCarriesReport, say, sentence } from './share.js';
import { readReport, listReports, onExternalChange } from './store.js';
import { refreshLibrary, persistCurrent } from './library.js';
import {
  initialMode, registerShortcuts, toggleMode, mode, setMode, setView, view,
  initialRail, followRailWidth, setRail, railOpen, railDocked, followFooterHeight,
} from './chrome.js';
import { bindEvents, elements } from './events.js';
import { showFindings, showSourceTab } from './source-pane.js';
import {
  beginOpen, openGeneration, readRecord, applyRead, readLink, applyLink, openLink,
  replaceDeleted,
} from './open.js';
import { shareCurrent, showExportChoices } from './export-dialog.js';
import { renderExamples } from './catalog.js';
import { parseRoute, routeFor, isAnchor } from './router.js';
import {
  initCompare, compareSettled, compareStep, focusCompareFilter,
} from './compare/index.js';
import { exampleCard } from './compare/example.js';
import { copyComparisonLink } from './compare/export.js';
import { init as initKeys } from './neokeys/index.js';
import { initYaml } from './parse.js';

/** Our own text surfaces, beyond the inputs and textareas NeoKeys already knows. */
const TYPING_SURFACES = '.editor-textarea, [data-text-surface]';

/**
 * How many report example cards the welcome screen shows, after the example
 * comparison; the Open dialog lists all.
 */
const WELCOME_EXAMPLES = 3;

export async function boot(state) {
  const root = document.documentElement;
  // Tell js/appearance.js's fallback that boot is running, so a slow link
  // does not reveal a half-built page.
  if ('dossierBooting' in root.dataset) root.dataset.dossierBooting = 'started';
  try {
    await start(state);
  } finally {
    // Whatever happened, the page is shown: a boot that failed half way
    // writes its reason into the report area, which must not stay hidden.
    // The "Loading" line js/appearance.js may have shown goes with it.
    delete root.dataset.dossierBooting;
    delete root.dataset.dossierLoading;
    const line = document.getElementById('bootStatus');
    if (line) line.textContent = '';
  }
}

async function start(state) {
  loadSaved(state);
  const els = elements();

  // The kit owns H, the ? sheet and the remap panel. init is idempotent, so
  // calling it here rather than through boot.js's script tag is safe and
  // keeps the page free of one more script element.
  try {
    initKeys({ chromeToggle: true, typingSelector: TYPING_SURFACES });
  } catch {
    // A page with no shortcuts still works. This is not worth failing over.
  }

  bindEvents(state, els);
  bindShortcuts(state, els);
  followRailWidth(() => state.preferences.railOpen);
  followFooterHeight();
  // The Compare view listens for the view and route events, so it starts
  // before the first of them.
  initCompare();
  const first = parseRoute();
  setView(first.view || (first.key === 'dc' ? 'compare' : document.documentElement.dataset.dossierView));
  // Each change is read from its own event: two changes queued in one task
  // (a tab click, then the skip link) must not both read the last address.
  window.addEventListener('hashchange', (event) => {
    let hash = location.hash;
    let previous = '';
    try { hash = new URL(event.newURL).hash; } catch { /* keep the live hash */ }
    try { previous = new URL(event.oldURL).hash; } catch { /* no previous address */ }
    followRoute(state, els, hash, previous);
  });
  // The skip link moves focus to the content and leaves the address alone.
  // Following its `#main` added a history entry that followRoute then turned
  // back into the previous address, so the next Back press seemed to do
  // nothing. A bare anchor reached any other way still goes to followRoute,
  // which keeps the view.
  document.querySelector('.skip-link')?.addEventListener('click', (event) => {
    const href = event.currentTarget.getAttribute('href') || '';
    const target = isAnchor(href) ? document.getElementById(parseRoute(href).anchor) : null;
    if (!target) return;
    event.preventDefault();
    target.focus();
  });
  // Another tab wrote or deleted a report. Refresh the list rather than the
  // document: overwriting what this tab has open would be the bug we avoid.
  onExternalChange((ids, kind) => {
    if (kind === 'delete') forgetDeleted(state, els, ids);
    refreshLibrary(state, els);
  });
  refreshLibrary(state, els);
  // Warm the local parser so a YAML file dropped early still reads.
  initYaml();
  // Both example lists, read once. The welcome screen waits for its list
  // before it is first shown, so its cards do not arrive after it.
  // The example comparison leads both lists: it is what the tool is for.
  const examples = Promise.all([
    renderExamples(els.welcomeExamples, { limit: WELCOME_EXAMPLES }),
    renderExamples(els.openExamples),
  ]).then(() => {
    for (const list of [els.welcomeExamples, els.openExamples]) list?.prepend(exampleCard());
  });

  const ticket = beginOpen();
  const { claimed, rewrite } = await loadInitialReport(state, ticket);
  initialRail({ fromLink: claimed === 'url', preference: state.preferences.railOpen });

  if (claimed === 'superseded') {
    // Something the visitor opened while we loaded owns the stage now. If it
    // opened, it drew itself (js/open.js finishOpen). If it failed, it gave
    // its ticket back (releaseOpen): when that happened before we checked,
    // we were never superseded and drew the stored report below; when after,
    // the failed open drew the empty state itself (openFailed). Either way
    // the stage is never left blank.
    if (!document.documentElement.dataset.dossierMode) {
      setMode(state.preferences.readMode ? 'read' : 'build');
    }
  } else {
    if (claimed === 'none') await examples;
    showRoutePage(state, parseRoute());
    initialMode({
      preferRead: claimed === 'url' || state.preferences.readMode,
      documentChrome: reportOf(state.model)?.chrome || 'auto',
    });
    rerender(state, els);
    refreshLibrary(state, els);
    // The source pane starts on whichever tab the visitor last used.
    showSourceTab(state, els, state.preferences.sourceTab || 'form');
    document.dispatchEvent(new CustomEvent('dossier-opened'));
    if (state.findings.length && state.preferences.showFindings) showFindings(state, els, true);
    // A record from before stored documents were authored-only is saved once
    // without its derived ids (js/open.js readRecord), so it stops warning.
    if (rewrite) persistCurrent(state, els);
  }

  announceRoute(state, parseRoute());
  // A comparison in the address is on screen before the page is shown.
  await compareSettled();
}

/**
 * Where the first report comes from, in priority order.
 *
 * A URL payload wins because that is the whole point of a shared link. A
 * hosted document is next. Then this browser's own last report, or, when that
 * is gone, the most recent one still saved, so a saved list never ends up out
 * of reach behind the welcome screen; a link that fails to load says why and
 * falls through to them as well. Nothing at all is a real state with its
 * own screen (the welcome screen), distinct from a document that failed to
 * load.
 *
 * @returns {Promise<{claimed: 'url'|'store'|'none'|'superseded', rewrite: boolean}>}
 *   `rewrite` is true for a stored record that still carries derived ids.
 */
async function loadInitialReport(state, ticket) {
  const stillOurs = () => openGeneration() === ticket;
  const done = (claimed, rewrite = false) => ({ claimed, rewrite });

  if (loadFromUrl()) {
    const link = await readLink();
    if (!stillOurs()) return done('superseded');
    if (link.found && link.ok) {
      applyLink(state, link);
      return done('url');
    }
    // Say which failure it was. A link that did not work and a page with
    // nothing open are different situations and never share a message.
    // Then carry on as if there had been no link: stopping here left a
    // visitor with saved reports on the welcome screen, with their list out
    // of reach until they found the reload without the link.
    say(link.reason || 'That link carried no readable report. Open a file to try again.');
    // Drop a broken payload from the address once it has been explained.
    // Left there, it rode along with every report opened next (js/open.js
    // never rewrites a payload address), and a reload or Back from a page
    // tab raised the same failure again. A failed `?src=` stays, so a reload
    // tries that server again.
    if (fragmentCarriesReport()) history.replaceState(history.state, '', location.pathname + location.search);
  }

  const lastId = state.preferences.lastReportId;
  const candidates = lastId ? [lastId] : [];
  const saved = (await listReports()) || [];
  if (!stillOurs()) return done('superseded');
  const newest = saved.find((item) => item.id !== lastId);
  if (newest) candidates.push(newest.id);

  for (const id of candidates) {
    const record = await readReport(id);
    if (!stillOurs()) return done('superseded');
    if (!record || !record.document) continue;
    const { read, stale } = readRecord(record);
    if (!read.ok) continue;
    applyRead(state, read);
    state.reportId = id;
    if (id !== lastId) setPreference(state, 'lastReportId', id);
    return done('store', stale);
  }
  return done('none');
}

/**
 * Another tab deleted reports. If one of them is open here, close it: left
 * open, it still said "Saved in this browser", and this tab's next edit wrote
 * it back under the same id, so the deleted report came back. The remembered
 * last report is forgotten too, but only where it still names a deleted
 * report: decided from this tab's memory, the write put back this tab's stale
 * preferences and wiped the newer `lastReportId` the other tab had saved.
 */
async function forgetDeleted(state, els, ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  forgetPreference(state, 'lastReportId', ids);
  if (!state.reportId || !ids.includes(state.reportId)) return;
  const instead = await replaceDeleted(state, els);
  say(instead
    ? sentence(`This report was deleted in another tab. Showing "${instead.title}"`)
    : 'This report was deleted in another tab, so it was closed here.');
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * React to a hash change: Back, Forward, a page tab, an outline link, or a
 * share link pasted into this tab.
 */
function followRoute(state, els, hash = location.hash, previous = '') {
  const route = parseRoute(hash);
  if (route.anchor) {
    // The skip link, or an in-page anchor: the browser has scrolled to it.
    // It is not a route, so the view and page stay, and the address goes
    // back to naming them, which keeps Reload and a copied link right.
    // Accepted residual: the anchor's own history entry stays, now with the
    // same address as the one before it, so the next Back seems to do
    // nothing. `history.back()` here would undo the scroll the reader just
    // asked for. The skip link, the common case, adds no entry at all (see
    // its click handler in `boot`).
    if (!parseRoute(previous).anchor) {
      history.replaceState(history.state, '', previous || location.pathname + location.search);
    }
    return;
  }
  if (route.payload) {
    // A report link pasted into an open tab used to do nothing. `#dc=` is a
    // comparison and belongs to the Compare view.
    if (route.key === 'dc') setView('compare');
    else openLink(state, els);
    announceRoute(state, route);
    return;
  }
  setView(route.view);
  if (route.view === 'reports' && showRoutePage(state, route)) {
    rerender(state, els);
    showSourceTab(state, els, state.preferences.sourceTab);
  }
  announceRoute(state, route);
}

/**
 * Point `state.page` at the page a route names. No page (Back to the bare
 * URL) means page one. An id the report does not have also means page one,
 * and the URL is corrected so the active tab and the address agree. A bare
 * `#anchor` (the skip link) leaves the page alone.
 *
 * @returns {boolean} true when the page changed
 */
function showRoutePage(state, route) {
  if (route.view !== 'reports' || route.anchor) return false;
  const pages = reportOf(state.model || state.lastGood)?.pages || [];
  if (!pages.length) return false;
  const target = pages.find((p) => p.id === route.page) || pages[0];
  if (route.page && target.id !== route.page) {
    history.replaceState(null, '', routeFor({ page: target.id }));
  }
  if (target.id === state.page) return false;
  state.page = target.id;
  return true;
}

/** Tell any view that listens (the Compare view) which route is current. */
function announceRoute(state, route) {
  if (route.view) state.view = route.view;
  document.dispatchEvent(new CustomEvent('dossier-route', { detail: route }));
}

/** `[` and `]`: a history entry per page, like a tab click, so Back works. */
function stepPage(state, by) {
  if (view() !== 'reports') return false;
  const pages = reportOf(state.model || state.lastGood)?.pages || [];
  if (pages.length < 2) return false;
  const at = Math.max(0, pages.findIndex((p) => p.id === state.page));
  const next = pages[(at + by + pages.length) % pages.length];
  if (!next) return false;
  location.hash = routeFor({ page: next.id });
  return true;
}

// ── Shortcuts ────────────────────────────────────────────────────────────────

/**
 * Each shortcut acts directly rather than clicking a control, because on a
 * phone-width window the control may sit inside the kit's closed overflow
 * menu. A shortcut with nothing to act on declines (`false`), so the key does
 * whatever it would have done without us.
 */
function bindShortcuts(state, els) {
  const reading = () => view() === 'reports' && Boolean(state.model || state.lastGood);
  const actions = {
    filter: () => {
      if (view() === 'compare') return focusCompareFilter();
      if (!reading()) return false;
      if (!railOpen()) {
        setRail(true);
        if (railDocked()) setPreference(state, 'railOpen', true);
      }
      els.reportFilter?.focus();
      return true;
    },
    // In Compare, `s` and `e` act on the open comparison.
    share: () => (view() === 'compare' ? (copyComparisonLink(), true) : state.document ? shareCurrent(state) : false),
    export: () => {
      if (view() !== 'compare' && !state.document) return false;
      showExportChoices(state, els, document.activeElement);
      return true;
    },
    prev: () => (view() === 'compare' ? compareStep(-1) : stepPage(state, -1)),
    next: () => (view() === 'compare' ? compareStep(1) : stepPage(state, 1)),
    toggleMode: () => {
      if (!reading()) return false;
      toggleMode({ viaKey: true });
      setPreference(state, 'readMode', mode() === 'read');
      return true;
    },
  };
  const shortcuts = registerShortcuts(actions);
  if (shortcuts && shortcuts.deferred) {
    // The kit had not booted yet. One retry on load covers the slow path.
    window.addEventListener('load', () => registerShortcuts(actions), { once: true });
  }
}
