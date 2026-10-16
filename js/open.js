/**
 * Opening a report: from text, a file, a link, the library or an example.
 *
 * Reading and committing are separate on purpose. `readText` is pure: it
 * detects the format, converts it, parses it and validates it, and touches no
 * state, so a failed import can never replace what is on screen and another
 * view (a Compare column) can read a file without opening it here. It lives
 * in js/read.js with `readRecord`. `applyRead` is the commit. Every open path
 * below is copy-then-commit.
 *
 * Every open also takes a ticket (`beginOpen`). Boot compares tickets before
 * committing the initial report, so a file dropped while the stored report is
 * still loading is not replaced by it a moment later. An open that fails
 * gives its ticket back (`releaseOpen`) and leaves a drawn stage behind.
 */

import { showToast } from './neorgon-dom.js';
import { initYaml, needsYaml } from './parse.js';
import { detect } from './adapters/index.js';
import { HTML_MAX_CHARS, reportTooLargeMessage } from './embed-policy.js';
import { notText } from './text-check.js';
import { markDetected, tooLargeSentence } from './open-line.js';
import { authored, commitModel, rerender } from './pipeline.js';
import { persistCurrent, refreshLibrary, readStored } from './library.js';
import { setPreference } from './state.js';
import {
  setMode, setView, view, initialMode, mode as currentMode,
} from './chrome.js';
import { listReports } from './store.js';
import {
  syncEditor, showSourceTab, refreshFindings, showFindings, hideFindings,
} from './source-pane.js';
import { readUrlPayload, say, sentence } from './share.js';
import { parseRoute, routeFor } from './router.js';
import { reportOf } from './render/index.js';
import { readText, readRecord, plainFatal } from './read.js';

// The pure half lives in js/read.js, and the Open dialog's line in
// js/open-line.js; these names stay importable from here.
export {
  readText, readRecord, carriesDerived, plainFatal,
} from './read.js';
export { describeDetected, markDetected, htmlSentence } from './open-line.js';

// ── Tickets ──────────────────────────────────────────────────────────────────

let generation = 0;

/** Take a ticket for an open. Any open in flight with an older one has lost. */
export function beginOpen() {
  generation += 1;
  return generation;
}

/** The newest ticket. Equal to yours means nothing opened since you started. */
export function openGeneration() {
  return generation;
}

/**
 * Give a ticket back after an open that failed, when nothing has opened
 * since. A failed open is not an open: holding on to its ticket told the
 * open it superseded (the stored report boot was loading) that it had lost,
 * and nothing was left to draw the stage. Tickets are taken one at a time,
 * so the one before `ticket` is the open that was current before it.
 *
 * @param {number} ticket
 */
export function releaseOpen(ticket) {
  if (generation === ticket) generation = ticket - 1;
}

/**
 * The end of every failed open: the ticket goes back, and a stage that has
 * nothing on it is drawn, so the reader gets the empty state (the welcome
 * screen) instead of a blank page. While boot is still loading the stage is
 * hidden, and boot draws its own report over this.
 */
function openFailed(state, els, ticket) {
  if (ticket !== undefined) releaseOpen(ticket);
  if (!state.model && !state.lastGood) rerender(state, els);
  return false;
}

/**
 * Commit a successful read. The report is new and unsaved until
 * `finishOpen` persists it.
 */
export function applyRead(state, read) {
  commitModel(state, { model: read.model, document: read.document, findings: read.findings, text: read.text });
  state.reportId = null;
  // No stored revision yet: the first save creates the record (js/library.js).
  state.reportRev = null;
  state.isExample = false;
  state.fromUrl = false;
}

// ── Opening ──────────────────────────────────────────────────────────────────

// ── Comparison bundles ───────────────────────────────────────────────────────

let bundleOpener = null;

/**
 * The Compare view registers how a comparison bundle opens. A bundle given
 * to the Open dialog, or dropped on the page, is a whole comparison rather
 * than a report, so it goes there instead of being read here.
 *
 * @param {(text: string, label: string) => unknown} fn
 */
export function onComparisonBundle(fn) {
  bundleOpener = typeof fn === 'function' ? fn : null;
}

/**
 * Pasted text, a chosen file or a dropped file.
 *
 * Every kind gets the cap HTML and the Compare view have, checked on the raw
 * text before anything detects or parses it, and binary input is refused
 * (js/text-check.js). YAML is read once its parser is in, which only text
 * that no adapter claims and that does not open as JSON loads.
 *
 * A failure while the Open dialog is open is said in the dialog's own line,
 * a status region inside the modal, and not in the toast, which a modal
 * dialog covers (no z-index rises above the top layer). Dropped on the page,
 * it is the toast.
 *
 * @param {string} text
 * @param {string} label the file name, or "Pasted text"
 * @returns {Promise<boolean>} true when it opened, or went to the Compare view
 */
export async function openText(state, els, text, label) {
  const name = label && label !== 'Pasted text' ? label : undefined;
  if (typeof text === 'string' && text.length > HTML_MAX_CHARS) {
    return refuseOpen(els, name ? reportTooLargeMessage(text.length, name) : tooLargeSentence(text));
  }
  const binary = notText(text);
  if (!binary && bundleOpener && detect(text)?.bundle) {
    bundleOpener(text, label);
    return true;
  }
  if (!binary && needsYaml(text) && !detect(text)) await initYaml();
  const read = readText(text, { name });
  if (!read.ok) {
    const empty = !text || !String(text).trim();
    const plain = plainFatal(read.fatal, text);
    const inDialog = Boolean(els.importDialog?.open);
    if (empty) return refuseOpen(els, inDialog ? 'Paste a report or choose a file first.' : plain);
    return refuseOpen(els, read.label || (inDialog && !name) ? plain : `${label} could not be read. ${plain}`);
  }
  beginOpen();
  applyRead(state, read);
  keepMode(state);
  finishOpen(state, els, {
    announce: read.label ? sentence(`Opened the ${read.label} report "${titleOf(state)}"`) : undefined,
  });
  return true;
}

/**
 * Say why an open was refused: in the Open dialog's line, marked as an
 * error, while the dialog is open; in the toast otherwise.
 *
 * @returns {false}
 */
function refuseOpen(els, message) {
  if (els.importDialog?.open) markDetected(els, message, true);
  else say(message);
  return false;
}

/**
 * Everything that follows a commit, in one place for every open path.
 *
 * The open is announced in the toast, which is a polite live region. The
 * report area itself is not live: announcing every re-render read the whole
 * report aloud on each keystroke in the editor.
 *
 * @param {{persist?: boolean, announce?: string|false}} [opts] `announce`
 *   replaces the default sentence; false says nothing (the first report at
 *   boot, which the page title already names)
 * @returns {Promise<void>} resolves once the saved-report list is rebuilt
 */
export function finishOpen(state, els, { persist = true, announce } = {}) {
  showReportsView();
  syncEditor(state);
  rerender(state, els);
  syncRoute(state);
  showSourceTab(state, els, state.preferences.sourceTab);
  refreshFindings(state, els);
  const listed = persist ? persistCurrent(state, els) : refreshLibrary(state, els);
  // A report with errors opens unobstructed for reading: the red count on
  // Check report carries the signal, and the panel opens on its own only
  // where it docks, beside the editor (design 7.3.13).
  if (currentMode() === 'build' && state.findings.some((f) => f.level === 'error')) showFindings(state, els, true);
  if (announce !== false) say(announce || sentence(`Opened "${titleOf(state)}"`));
  return Promise.resolve(listed).catch(() => {});
}

/**
 * The mode a report opens in. Opening another report does not change what the
 * reader is doing: an example picked while editing opens in the editor. A
 * shared link opens for reading. The document's own `chrome` field can insist
 * either way (js/chrome.js initialMode).
 */
function keepMode(state, { fromLink = false } = {}) {
  initialMode({
    preferRead: fromLink || currentMode() === 'read',
    documentChrome: reportOf(state.model)?.chrome || 'auto',
  });
}

function titleOf(state) {
  return reportOf(state.model || state.lastGood)?.title || 'Untitled report';
}

/**
 * Opening a report shows it, so it leaves the Compare view. The Compare
 * route gets its own history entry first, so Back returns to it.
 */
function showReportsView() {
  if (view() !== 'compare' && parseRoute().view !== 'compare') return;
  if (parseRoute().view === 'compare') history.pushState(null, '', routeFor({}));
  setView('reports');
}

/**
 * Keep the address on the page that is shown. A new report starts on its first
 * page (or on the page it shares an id with), and the old report's `#/<page>`
 * left in the address made Reload and Back resolve against the wrong report.
 * A bare `#anchor`, a payload and the Compare route are left alone.
 */
function syncRoute(state) {
  const route = parseRoute();
  if (route.view !== 'reports' || route.anchor || !state.page) return;
  const pages = reportOf(state.model || state.lastGood)?.pages || [];
  const named = route.page || pages[0]?.id || null;
  if (named !== state.page) history.replaceState(null, '', routeFor({ page: state.page }));
}

/**
 * A report from the library.
 *
 * @param {{announce?: string|false}} [opts] passed to finishOpen
 */
export async function openStored(state, els, id, { announce } = {}) {
  const ticket = beginOpen();
  const record = await readStored(id);
  if (ticket !== openGeneration()) return false;
  if (!record) {
    // A report that cannot be read back (storage cleared, or deleted
    // elsewhere) leaves the list instead of staying there to fail again.
    refreshLibrary(state, els);
    return openFailed(state, els, ticket);
  }
  const { read, stale } = readRecord(record);
  if (!read.ok) {
    say(`That saved report could not be read: ${read.fatal.message}`);
    return openFailed(state, els, ticket);
  }
  applyRead(state, read);
  state.reportId = id;
  // The stored revision this tab now holds; a save checks it (js/store.js).
  state.reportRev = record.meta?.updated ?? null;
  setPreference(state, 'lastReportId', id);
  keepMode(state);
  // Opening is not editing: only a stale record (readRecord) is saved, once,
  // without its derived ids. Saving every open moved the report's `updated`
  // time and sent it to the top of the list.
  await finishOpen(state, els, { persist: stale, announce });
  return true;
}

/**
 * A bundled example or template. Copy-then-commit like every other path, so
 * a broken file leaves the open report alone. Not saved until it is edited.
 */
export async function loadFixture(state, els, path) {
  const ticket = beginOpen();
  let text;
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  } catch {
    if (ticket !== openGeneration()) return false;
    // A failed fetch is not an empty report, and must not look like one.
    showToast(`Could not load ${path}. The example is missing, not empty.`);
    return openFailed(state, els, ticket);
  }
  if (ticket !== openGeneration()) return false;
  const read = readText(text);
  if (!read.ok) {
    say(`The example ${path} could not be read: ${read.fatal.message}`);
    return openFailed(state, els, ticket);
  }
  applyRead(state, read);
  state.isExample = true;
  keepMode(state);
  finishOpen(state, els, { persist: false, announce: `${sentence(`Opened the example "${titleOf(state)}"`)} It is not saved until you edit it.` });
  return true;
}

/** A blank report, saved at once and opened for editing. */
export function openBlank(state, els) {
  return openDocument(state, els, blankReport(), { mode: 'build', announce: 'Started a new report. It is saved in this browser as you edit.' });
}

/**
 * A document object from elsewhere in the app (a new blank report). It may be
 * a derived model; only its authored fields are read.
 */
export function openDocument(state, els, document, { mode = 'read', announce } = {}) {
  const read = readText(JSON.stringify(authored(document), null, 2));
  if (!read.ok) {
    say(`That could not be opened: ${read.fatal.message}`);
    return false;
  }
  beginOpen();
  applyRead(state, read);
  setMode(mode);
  finishOpen(state, els, { announce });
  return true;
}

/**
 * The open report was deleted (here or in another tab). Open the most recent
 * report still saved, so the saved-report list stays in reach; with none
 * left, close it and show the welcome screen.
 *
 * @returns {Promise<{title: string}|null>} the report that was opened instead
 */
export async function replaceDeleted(state, els) {
  const next = ((await listReports()) || []).find((item) => item.id !== state.reportId);
  if (next && await openStored(state, els, next.id, { announce: false })) {
    return { title: titleOf(state) };
  }
  closeReport(state, els);
  return null;
}

/**
 * Close the report on screen and go back to the empty state. Used when the
 * last saved report is deleted, so nothing is left to be saved again later.
 */
export function closeReport(state, els) {
  beginOpen();
  Object.assign(state, {
    model: null,
    lastGood: null,
    document: null,
    sourceText: '',
    findings: [],
    fatal: null,
    page: null,
    reportId: null,
    isExample: false,
    fromUrl: false,
  });
  syncEditor(state);
  hideFindings(els);
  rerender(state, els);
  showSourceTab(state, els, state.preferences.sourceTab);
  refreshFindings(state, els);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

// ── Links ────────────────────────────────────────────────────────────────────

/**
 * Read a report carried by the URL (`#dz=`, `#d1=` or `?src=`), with no
 * side effects on the state. Each failure has its own reason.
 *
 * @returns {Promise<{found: false}
 *   | {found: true, ok: true, read: object, findings: Array}
 *   | {found: true, ok: false, reason: string}>}
 */
export async function readLink() {
  const carried = await readUrlPayload();
  if (!carried.found || !carried.ok) return carried;
  // YAML parses synchronously only once its module is loaded.
  if (!/^\s*[{[]/.test(carried.text)) await initYaml().catch(() => {});
  const read = readText(carried.text);
  if (!read.ok) {
    return {
      found: true,
      ok: false,
      reason: carried.source === 'src'
        ? `The document at ${carried.host} could not be read: ${read.fatal.message}`
        : `That link opened, but what it carries is not a Dossier report: ${read.fatal.message}`,
    };
  }
  return { found: true, ok: true, read, findings: carried.findings || [] };
}

/** Commit a link read. Shared reports open for reading and are not saved. */
export function applyLink(state, link) {
  applyRead(state, link.read);
  if (link.findings.length) state.findings = [...link.findings, ...state.findings];
  state.fromUrl = true;
}

/** A share link pasted into a tab that is already open. */
export async function openLink(state, els) {
  const ticket = beginOpen();
  const link = await readLink();
  if (ticket !== openGeneration()) return false;
  if (!link.found) return openFailed(state, els, ticket);
  if (!link.ok) {
    say(link.reason);
    // The report on screen stays, so the address goes back to naming it.
    // Left in place, the broken payload failed again on reload or Back.
    if (parseRoute().payload) {
      const back = state.model && state.page ? routeFor({ page: state.page }) : '';
      history.replaceState(null, '', location.pathname + location.search + back);
    }
    return openFailed(state, els, ticket);
  }
  applyLink(state, link);
  keepMode(state, { fromLink: true });
  finishOpen(state, els, { persist: false, announce: `Opened "${titleOf(state)}" from the link.` });
  return true;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function blankReport() {
  return {
    dossier: {
      version: 1,
      title: 'Untitled report',
      kind: 'summary',
      status: 'draft',
      pages: [{ title: 'Overview', blocks: [{ type: 'prose', text: 'What happened, in a sentence.' }] }],
    },
  };
}
