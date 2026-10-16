/**
 * Opening a report: from text, a file, a link, the library or an example.
 *
 * Reading and committing are separate on purpose. `readText` is pure: it
 * detects the format, converts it, parses it and validates it, and touches no
 * state, so a failed import can never replace what is on screen and another
 * view (a Compare column) can read a file without opening it here.
 * `applyRead` is the commit. Every open path below is copy-then-commit.
 *
 * Every open also takes a ticket (`beginOpen`). Boot compares tickets before
 * committing the initial report, so a file dropped while the stored report is
 * still loading is not replaced by it a moment later.
 */

import { showToast } from './neorgon-dom.js';
import { parse, initYaml } from './parse.js';
import { validate } from './validate.js';
import { detect } from './adapters/index.js';
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
import { derivedFields } from './registry/index.js';

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

// ── Reading (pure) ───────────────────────────────────────────────────────────

/**
 * Read any text the Open dialog accepts, with no side effects.
 *
 * @param {string} text
 * @returns {{ok: boolean, document: object|null, model: object|null,
 *   findings: Array, label: string|null, adapter: string|null,
 *   fatal: object|null, text: string}}
 *   `document` is the authored document, `model` the derived one, `text` the
 *   source to show in the editor, `label` the format name when an adapter
 *   converted it (null for a Dossier document).
 */
export function readText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return failed(String(text || ''), 'There was nothing to read in that.', null);
  }

  const adapter = detect(text);
  if (adapter && adapter.toDossier) {
    let converted = null;
    try {
      converted = adapter.toDossier(text);
    } catch (err) {
      return failed(text, `This looks like ${adapter.label}, but it could not be converted: ${err && err.message ? err.message : 'no reason given'}.`, adapter);
    }
    if (converted && converted.document) {
      const read = parsed(JSON.stringify(converted.document, null, 2), adapter);
      if (read.ok) read.findings = [...read.findings, ...(converted.findings || [])];
      return read;
    }
  }
  return parsed(text, null);
}

function parsed(text, adapter) {
  const result = parse(text, { format: 'auto' });
  if (result.fatal || !result.model) {
    const fatal = result.fatal || {
      message: 'The document could not be read, and the reader gave no reason.',
      line: null,
      column: null,
      snippet: '',
    };
    return { ...failed(text, fatal.message, adapter), fatal, findings: result.findings || [] };
  }
  return {
    ok: true,
    document: authored(result.model),
    model: result.model,
    findings: [...(result.findings || []), ...validate(result.model)],
    label: adapter ? adapter.label : null,
    adapter: adapter ? adapter.id : null,
    fatal: null,
    text,
  };
}

function failed(text, message, adapter) {
  return {
    ok: false,
    document: null,
    model: null,
    findings: [],
    label: adapter ? adapter.label : null,
    adapter: adapter ? adapter.id : null,
    fatal: { message, line: null, column: null, snippet: '' },
    text,
  };
}

/**
 * Commit a successful read. The report is new and unsaved until
 * `finishOpen` persists it.
 */
export function applyRead(state, read) {
  commitModel(state, { model: read.model, document: read.document, findings: read.findings, text: read.text });
  state.reportId = null;
  state.isExample = false;
  state.fromUrl = false;
}

// ── Opening ──────────────────────────────────────────────────────────────────

/** Pasted text, a chosen file or a dropped file. */
export function openText(state, els, text, label) {
  const read = readText(text);
  if (!read.ok) {
    const message = read.fatal.message;
    say(read.label || !text || !String(text).trim() ? message : `${label} could not be read: ${message}`);
    if (els.importDetected && text && String(text).trim()) els.importDetected.textContent = message;
    return false;
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
  if (state.findings.some((f) => f.level === 'error')) showFindings(state, els, true);
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
 * Whether a stored document still carries a field that is derived, in the
 * places parse.js strips one from: a page id, a block id, or a field the
 * block's registry entry marks derived. Decided from the document's shape
 * rather than from a warning's wording, so rewording a message cannot quietly
 * stop old records from being rewritten.
 *
 * @param {object} document a stored, wrapped `{dossier: {...}}` document
 * @returns {boolean}
 */
export function carriesDerived(document) {
  const pages = document?.dossier?.pages;
  if (!Array.isArray(pages)) return false;
  return pages.some((page) => {
    if (!page || typeof page !== 'object') return false;
    if (supplies(page, 'id')) return true;
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    return blocks.some((block) => {
      if (!block || typeof block !== 'object') return false;
      if (supplies(block, 'id')) return true;
      return typeof block.type === 'string'
        && derivedFields(block.type).some((field) => supplies(block, field));
    });
  });
}

function supplies(obj, field) {
  return Object.prototype.hasOwnProperty.call(obj, field) && obj[field] !== undefined;
}

/**
 * Read a stored record. A record saved before stored documents were
 * authored-only still carries derived ids, and parse.js warns about each one.
 * Such a record is read a second time from its authored document, so the
 * editor and the findings show the clean version, and `stale` tells the
 * caller to save it once so the record itself is rewritten.
 *
 * @param {{document: object}} record
 * @returns {{read: object, stale: boolean}}
 */
export function readRecord(record) {
  const read = readText(JSON.stringify(record.document, null, 2));
  if (!read.ok || !carriesDerived(record.document)) return { read, stale: false };
  const clean = readText(JSON.stringify(read.document, null, 2));
  return clean.ok ? { read: clean, stale: true } : { read, stale: false };
}

/**
 * A report from the library.
 *
 * @param {{announce?: string|false}} [opts] passed to finishOpen
 */
export async function openStored(state, els, id, { announce } = {}) {
  const ticket = beginOpen();
  const record = await readStored(id);
  if (!record || ticket !== openGeneration()) return false;
  const { read, stale } = readRecord(record);
  if (!read.ok) {
    say(`That saved report could not be read: ${read.fatal.message}`);
    return false;
  }
  applyRead(state, read);
  state.reportId = id;
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
    // A failed fetch is not an empty report, and must not look like one.
    showToast(`Could not load ${path}. The example is missing, not empty.`);
    return false;
  }
  if (ticket !== openGeneration()) return false;
  const read = readText(text);
  if (!read.ok) {
    say(`The example ${path} could not be read: ${read.fatal.message}`);
    return false;
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
 * A document object from elsewhere in the app (the response composer, a new
 * blank report). It may be a derived model; only its authored fields are read.
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
  if (!link.found || ticket !== openGeneration()) return false;
  if (!link.ok) {
    say(link.reason);
    // The report on screen stays, so the address goes back to naming it.
    // Left in place, the broken payload failed again on reload or Back.
    if (parseRoute().payload) {
      const back = state.model && state.page ? routeFor({ page: state.page }) : '';
      history.replaceState(null, '', location.pathname + location.search + back);
    }
    return false;
  }
  applyLink(state, link);
  keepMode(state, { fromLink: true });
  finishOpen(state, els, { persist: false, announce: `Opened "${titleOf(state)}" from the link.` });
  return true;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function describeDetected(els, text) {
  if (!els.importDetected) return;
  if (!text || !text.trim()) {
    els.importDetected.textContent = '';
    return;
  }
  const adapter = detect(text);
  els.importDetected.textContent = adapter?.id === 'html'
    ? 'HTML report. Opens in its original layout, with inline controls enabled.'
    : adapter ? `Looks like ${adapter.label}. It will be turned into a report.`
      : 'Looks like a Dossier document.';
}

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
