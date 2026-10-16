/**
 * The report library: saving, listing, opening and deleting.
 *
 * Split out of js/events.js when that file crossed the fleet's 500 line cap.
 * The boundary is real rather than arbitrary: everything here talks to
 * js/store.js and nothing here knows about a click.
 */

import { showToast, uid } from './neorgon-dom.js';
import { reportOf } from './render/index.js';
import { setPreference } from './state.js';
import { updateReportBar } from './pipeline.js';
import { listReports, readReport, writeReport, deleteReport, estimateUsage } from './store.js';

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * Save the open report. What is stored is `state.document`, the authored
 * document, so reopening it raises no "derived and supplied" warnings.
 * js/store.js keeps the record's `created` time and sets `updated`.
 */
export async function persistCurrent(state, els) {
  if (state.fatal) return;
  const report = reportOf(state.model);
  if (!report || !state.document) return;
  const isNew = !state.reportId;
  const id = state.reportId || uid('r-');
  // Reserve the identity before storage yields. A new document can open while
  // this write is pending, and completion must not take over its identity.
  state.reportId = id;
  const meta = {
    id,
    title: report.title || 'Untitled report',
    kind: report.kind || null,
    status: report.status || null,
    pages: (report.pages || []).length,
  };
  const ok = await writeReport(id, state.document, meta);
  if (!ok) {
    if (isNew && state.reportId === id) state.reportId = null;
    const usage = await estimateUsage();
    showToast(usage && usage.pct
      ? `Could not save: storage is about ${Math.round(usage.pct)}% full. This session still works.`
      : 'Could not save this report. This session still works.');
    return;
  }
  if (state.reportId === id) {
    state.isExample = false;
    updateReportBar(state);
    setPreference(state, 'lastReportId', id);
  }
  await refreshLibrary(state, els);
}

export async function refreshLibrary(state, els) {
  if (!els.library) return;
  const items = (await listReports()) || [];
  els.library.replaceChildren();

  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'ds-library__empty';
    li.textContent = 'No reports saved here yet.';
    els.library.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'ds-library__item';
    if (item.id === state.reportId) li.setAttribute('aria-current', 'true');

    const title = item.title || 'Untitled report';
    const open = document.createElement('button');
    open.type = 'button';
    open.dataset.action = 'open-report';
    open.dataset.reportId = item.id;
    open.className = 'ds-library__open';
    const name = document.createElement('span');
    name.className = 'ds-library__title';
    name.textContent = title;
    const meta = document.createElement('span');
    meta.className = 'ds-library__meta';
    const pages = Number(item.pages) || 0;
    meta.textContent = [item.kind, pages ? `${pages} page${pages === 1 ? '' : 's'}` : null]
      .filter(Boolean).join(' · ');
    open.append(name, meta);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.action = 'delete-report';
    remove.dataset.reportId = item.id;
    remove.dataset.reportTitle = title;
    remove.className = 'ds-library__delete';
    remove.setAttribute('aria-label', `Delete ${title}`);
    remove.textContent = 'Delete';

    li.append(open, remove);
    els.library.appendChild(li);
  }
  // A rebuild shows every item again; a filter still typed in the box applies.
  if (els.reportFilter?.value) filterLibrary(els, els.reportFilter.value);
}

export function filterLibrary(els, query) {
  const needle = String(query || '').trim().toLowerCase();
  for (const li of els.library?.children || []) {
    const text = li.textContent.toLowerCase();
    li.hidden = Boolean(needle) && !text.includes(needle);
  }
}

/** Read one stored report back, or null with a toast saying nothing changed. */
export async function readStored(id) {
  if (!id) return null;
  const record = await readReport(id);
  if (!record || !record.document) {
    showToast('That report could not be read back. Nothing was changed.');
    return null;
  }
  return record;
}

// ── Deleting ─────────────────────────────────────────────────────────────────

const CONFIRM_MS = 4000;
const armed = new WeakMap();

/**
 * Ask before deleting, in place. The first press turns the button into
 * "Delete?" for four seconds; a second press inside that time confirms.
 *
 * @param {HTMLButtonElement} button
 * @returns {boolean} true when this press confirms the delete
 */
export function confirmDelete(button) {
  if (!button) return false;
  if (armed.has(button)) {
    clearTimeout(armed.get(button));
    armed.delete(button);
    return true;
  }
  const title = button.dataset.reportTitle || 'this report';
  button.textContent = 'Delete?';
  button.dataset.confirm = 'armed';
  button.setAttribute('aria-label', `Press again to delete ${title}`);
  armed.set(button, setTimeout(() => {
    armed.delete(button);
    delete button.dataset.confirm;
    button.textContent = 'Delete';
    button.setAttribute('aria-label', `Delete ${title}`);
  }, CONFIRM_MS));
  return false;
}

/**
 * Delete a stored report. The list is rebuilt before this resolves.
 *
 * @returns {Promise<{deleted: boolean, wasOpen: boolean, index: number}>}
 *   `wasOpen` tells the caller to close the report on screen: left open, it
 *   said "Saved in this browser" and the next edit saved it again under a new
 *   id. `index` is where the item stood among the visible items, for
 *   `focusAfterDelete`.
 */
export async function removeStored(state, els, id) {
  if (!id) return { deleted: false, wasOpen: false, index: -1 };
  const wasOpen = state.reportId === id;
  const index = visibleOpenButtons(els).findIndex((b) => b.dataset.reportId === id);
  const deleted = await deleteReport(id);
  if (!deleted) {
    showToast('That report could not be deleted. It is still saved here.');
    return { deleted: false, wasOpen, index };
  }
  if (state.preferences.lastReportId === id) setPreference(state, 'lastReportId', null);
  await refreshLibrary(state, els);
  return { deleted: true, wasOpen: wasOpen || state.reportId === id, index };
}

/**
 * Put focus back somewhere sensible after a delete rebuilt the list, which
 * dropped it on the body, so a keyboard user lost their place. In order: the
 * item that took the deleted one's place, the one before it, the filter, the
 * New report button, then the first control on the welcome screen (the rail is
 * hidden once nothing is open). Focus the visitor already moved is left alone.
 *
 * @param {object} els
 * @param {number} index the deleted item's place among the visible items
 */
export function focusAfterDelete(els, index) {
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  const opens = visibleOpenButtons(els);
  const at = Math.max(0, index);
  const target = [
    opens[at],
    opens[at - 1],
    els.reportFilter,
    document.querySelector('[data-action="new-report"]'),
    document.querySelector('#welcome button'),
  ].find(isVisible);
  target?.focus();
}

/**
 * Put focus back on a report's item after opening it rebuilt the list, which
 * dropped focus on the body. Same rule as `focusAfterDelete`: focus the
 * visitor already moved somewhere is left alone.
 *
 * @param {object} els
 * @param {string} id the opened report's id
 */
export function focusOpened(els, id) {
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  visibleOpenButtons(els).find((b) => b.dataset.reportId === id)?.focus();
}

function visibleOpenButtons(els) {
  return Array.from(els.library?.querySelectorAll('.ds-library__open') || []).filter(isVisible);
}

function isVisible(el) {
  return Boolean(el) && !el.disabled && el.getClientRects().length > 0;
}
