/**
 * The open report's last edit, kept through a reload.
 *
 * A report is saved to IndexedDB as it is edited (js/library.js). A write
 * started while the page unloads never commits (Chromium drops the
 * transaction with the page, and js/store.js reads the record before it
 * writes), so an edit made in the last moment before a reload, a link or a
 * closed browser was lost. When the page hides with a save still under way,
 * js/boot.js writes this journal to localStorage, which is synchronous, and
 * the next visit replays it before it opens a report. A save that lands
 * removes it.
 *
 * What is kept is the authored document, which is what the record holds.
 * It is replayed only over a version it knows: a record that is missing (a
 * new report whose first save did not land), still at the revision the edit
 * was made on, or last written by this same tab. A record another tab saved
 * since keeps that tab's version.
 */

import { safeGetJSON, safeSetJSON, safeRemove } from './neorgon-persist.js';
import { reportOf } from './render/model.js';

export const REPORTS_JOURNAL_KEY = 'dossier-site:reports-journal';

/** A document larger than this (as JSON) is not journaled. */
export const REPORTS_JOURNAL_MAX = 2_000_000;

/** This tab, as the writer of the records it saves (js/library.js stamps it). */
export const TAB_ID = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The meta a report's record carries, from its derived model. */
export function reportMeta(model, id) {
  const report = reportOf(model) || {};
  return {
    id,
    title: report.title || 'Untitled report',
    kind: report.kind || null,
    status: report.status || null,
    pages: (report.pages || []).length,
    writer: TAB_ID,
  };
}

/**
 * Keep the open report's edit, now, when a save of it is still under way.
 *
 * @param {object} state
 * @param {{now?: number}} [opts]
 * @returns {boolean} true when a journal was written
 */
export function writeReportJournal(state, { now = Date.now() } = {}) {
  if (!state || !state.savePending || !state.reportId || !state.document) return false;
  let text;
  try {
    text = JSON.stringify(state.document);
  } catch {
    return false;
  }
  if (text.length > REPORTS_JOURNAL_MAX) return false;
  return safeSetJSON(REPORTS_JOURNAL_KEY, {
    id: state.reportId,
    at: now,
    base: Number.isFinite(state.reportRev) ? state.reportRev : null,
    writer: TAB_ID,
    document: state.document,
  });
}

/** A save of this report landed: its journal, if any, is out of date. */
export function clearReportJournal(id) {
  const journal = safeGetJSON(REPORTS_JOURNAL_KEY, null);
  if (journal && journal.id === id) safeRemove(REPORTS_JOURNAL_KEY);
}

/** The journal, taken out of storage (it is replayed at most once). */
export function takeReportJournal() {
  const journal = safeGetJSON(REPORTS_JOURNAL_KEY, null);
  if (journal !== null) safeRemove(REPORTS_JOURNAL_KEY);
  const ok = journal && typeof journal === 'object' && typeof journal.id === 'string' && journal.id
    && Number.isFinite(journal.at) && journal.document && typeof journal.document === 'object';
  return ok ? journal : null;
}

/**
 * Whether a journal may be written over what is stored now.
 *
 * @param {object} journal
 * @param {{meta: object, document: object}|null} record js/store.js readReport
 * @returns {boolean}
 */
export function journalApplies(journal, record) {
  if (!journal) return false;
  if (!record || !record.meta) return true;
  const updated = record.meta.updated;
  const untouched = journal.base !== null && updated === journal.base;
  const own = Boolean(record.meta.writer) && record.meta.writer === journal.writer && updated < journal.at;
  if (!untouched && !own) return false;
  try {
    return JSON.stringify(record.document) !== JSON.stringify(journal.document);
  } catch {
    return true;
  }
}

/**
 * Replay the last visit's journal into storage, before a report is opened.
 *
 * @param {{readReport: Function, writeReport: Function, readText: Function}} deps
 * @returns {Promise<string|null>} the id of the report it saved, or null
 */
export async function replayReportJournal({ readReport, writeReport, readText }) {
  const journal = takeReportJournal();
  if (!journal) return null;
  try {
    const record = await readReport(journal.id);
    if (!journalApplies(journal, record)) return null;
    const read = readText(JSON.stringify(journal.document, null, 2));
    if (!read.ok) return null;
    const written = await writeReport(journal.id, read.document, reportMeta(read.model, journal.id));
    return written && !written.conflict ? journal.id : null;
  } catch {
    return null;
  }
}
