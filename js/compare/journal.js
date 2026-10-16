/**
 * A comparison's last change, kept through a reload.
 *
 * A set is saved to IndexedDB a moment after each change, and at once when
 * the page hides. But a write started while the page unloads never commits:
 * Chromium drops the transaction with the page, even after an explicit
 * `commit()`. So whenever a change is still waiting (or still being written)
 * as the page hides, js/compare/index.js also writes this journal to
 * localStorage, which is synchronous and survives, and replays it the next
 * time a comparison opens. A save that lands removes it.
 *
 * The journal is small on purpose (a set can hold 7 MB of reports): the
 * title, the brief, the review and the view, plus the columns only when the
 * waiting change touched them and they fit.
 *
 * It is replayed only over a version it knows: the stored set is still at
 * the revision the change was made on, or the last write to it was this
 * tab's own (it started before the page hid and happened to land). A set
 * another tab saved since keeps that tab's version.
 *
 * DOM-free apart from localStorage: node imports it.
 */

import { safeGetJSON, safeSetJSON, safeRemove } from '../neorgon-persist.js';
import { sanitizeSet } from './records.js';
import { isObj } from './model.js';

export const COMPARE_JOURNAL_KEY = 'dossier-site:compare-journal';

/** Columns larger than this (as JSON) stay out of the journal. */
export const JOURNAL_COLUMNS_MAX = 1_500_000;

const PATCH_FIELDS = ['title', 'prompt', 'review', 'view', 'seq'];

/**
 * @param {object} set the open set
 * @param {{base?: number, writer?: string, withColumns?: boolean, now?: number}} [opts]
 *   base: the stored revision the change was made on (none for a set never
 *   saved); writer: this tab (js/compare/store.js TAB_ID); withColumns: the
 *   waiting change touched a column
 * @returns {object|null}
 */
export function makeJournal(set, { base, writer = null, withColumns = false, now = Date.now() } = {}) {
  if (!isObj(set) || typeof set.id !== 'string') return null;
  const patch = {};
  for (const field of PATCH_FIELDS) if (set[field] !== undefined) patch[field] = set[field];
  const journal = {
    id: set.id,
    at: now,
    base: Number.isFinite(base) ? base : null,
    writer: typeof writer === 'string' ? writer : null,
    created: Number.isFinite(set.created) ? set.created : now,
    patch,
  };
  if (withColumns && Array.isArray(set.columns)) {
    let size = Infinity;
    try {
      size = JSON.stringify(set.columns).length;
    } catch {
      /* a value JSON cannot hold: left out */
    }
    if (size < JOURNAL_COLUMNS_MAX) journal.columns = set.columns;
  }
  return journal;
}

/** A journal read back from storage, or null when it is not one. */
export function validJournal(value) {
  return isObj(value) && typeof value.id === 'string' && Number.isFinite(value.at) && isObj(value.patch)
    && (value.columns === undefined || Array.isArray(value.columns));
}

/**
 * What to write for a journal, given what is stored now, or null when
 * nothing should be written.
 *
 * @param {object} journal
 * @param {{set: object, writer: string|null}|null} stored js/compare/store.js readSetRecord
 * @returns {object|null} the set to save
 */
export function replayJournal(journal, stored) {
  if (!validJournal(journal)) return null;
  if (!stored || !stored.set) {
    // Never saved, or its first save did not land: rebuilt from the journal,
    // which can only happen when it carries the reports themselves.
    if (!Array.isArray(journal.columns)) return null;
    return sanitizeSet({ ...journal.patch, id: journal.id, created: journal.created, updated: journal.at, columns: journal.columns });
  }
  const { set, writer } = stored;
  const untouched = journal.base !== null && set.updated === journal.base;
  const own = Boolean(writer) && writer === journal.writer && set.updated < journal.at;
  if (!untouched && !own) return null;
  const next = sanitizeSet({
    ...set,
    ...journal.patch,
    id: set.id,
    created: set.created,
    columns: journal.columns || set.columns,
  });
  if (!next) return null;
  const view = (s) => JSON.stringify([PATCH_FIELDS.map((f) => s[f]), journal.columns ? s.columns : null]);
  return view(next) === view(set) ? null : next;
}

/** Write the journal now. Never throws; a full quota just keeps nothing. */
export function saveJournal(journal) {
  if (!journal) return false;
  try {
    return safeSetJSON(COMPARE_JOURNAL_KEY, journal);
  } catch {
    return false;
  }
}

/** The journal, taken out of storage (it is replayed at most once). */
export function takeJournal() {
  const journal = safeGetJSON(COMPARE_JOURNAL_KEY, null);
  if (journal !== null) safeRemove(COMPARE_JOURNAL_KEY);
  return validJournal(journal) ? journal : null;
}

/** A save of this set landed: its journal, if any, is out of date. */
export function clearJournal(id) {
  const journal = safeGetJSON(COMPARE_JOURNAL_KEY, null);
  if (journal && journal.id === id) safeRemove(COMPARE_JOURNAL_KEY);
}
