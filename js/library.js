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
import { reportMeta, clearReportJournal } from './report-journal.js';

// ── Storage ──────────────────────────────────────────────────────────────────

/** Saves run one after another, never two at once (see `persistCurrent`). */
let queue = Promise.resolve();
let inFlight = 0;
/** Saves queued or running, by report id. */
const queuedFor = new Map();
/**
 * The revision the next save of each report is made on: the one this tab
 * holds when a save is asked for with none under way, then whatever each
 * save of it leaves. A save refused because another tab saved first leaves
 * it as it was, so the saves queued behind it are refused too, rather than
 * one of them landing with no check at all.
 */
const baseRev = new Map();
let conflictHandler = null;

/**
 * Who handles a save refused because another tab saved the report first
 * (js/report-sync.js shows the choice). Without one, a toast says so.
 *
 * @param {(state: object, els: object, current: object) => void} fn
 */
export function onSaveConflict(fn) {
  conflictHandler = typeof fn === 'function' ? fn : null;
}

/**
 * Save the open report. What is stored is `state.document`, the authored
 * document, so reopening it raises no "derived and supplied" warnings.
 * js/store.js keeps the record's `created` time and sets `updated`.
 *
 * Every save says which revision of the record it was made on, and the
 * store refuses one made on an older revision than it holds: a second tab
 * that still showed an old version saved it over the newer one, silently,
 * on its next edit. Saves are queued, so this tab's own saves never race
 * each other's revision. What is saved, and under which id, is decided when
 * this is called; the revision when the save runs.
 *
 * @returns {Promise<'saved'|'conflict'|'failed'|'skipped'>} how it went
 */
export function persistCurrent(state, els) {
  if (state.fatal) return Promise.resolve('skipped');
  const report = reportOf(state.model);
  if (!report || !state.document) return Promise.resolve('skipped');
  const isNew = !state.reportId;
  const id = state.reportId || uid('r-');
  // Reserve the identity before storage yields. A new document can open while
  // this write is pending, and completion must not take over its identity.
  state.reportId = id;
  // Behind another save of the same report, the revision is the one that
  // save leaves; otherwise the one this tab holds now.
  if (!isNew && !(queuedFor.get(id) > 0)) baseRev.set(id, state.reportRev);
  const job = {
    id,
    isNew,
    document: state.document,
    meta: reportMeta(state.model, id),
  };
  queuedFor.set(id, (queuedFor.get(id) || 0) + 1);
  inFlight += 1;
  state.savePending = true;
  const run = queue.then(() => writeOnce(state, els, job)).catch(() => 'failed').finally(() => {
    queuedFor.set(id, queuedFor.get(id) - 1);
    if (!queuedFor.get(id)) queuedFor.delete(id);
    inFlight -= 1;
    if (!inFlight) state.savePending = false;
  });
  queue = run;
  return run;
}

async function writeOnce(state, els, job) {
  const { id, isNew } = job;
  const rev = baseRev.get(id);
  const result = await writeReport(id, job.document, job.meta, {
    expect: isNew || rev === null || rev === undefined ? undefined : rev,
  });
  if (!result) {
    if (isNew && state.reportId === id) state.reportId = null;
    const usage = await estimateUsage();
    showToast(usage && usage.pct
      ? `Could not save: storage is about ${Math.round(usage.pct)}% full. This session still works.`
      : 'Could not save this report. This session still works.');
    // The open report may no longer exist (site data cleared): the list
    // says what is really saved.
    await refreshLibrary(state, els);
    return 'failed';
  }
  if (result.conflict) {
    if (state.reportId === id) {
      state.reportConflict = result.current.updated;
      if (conflictHandler) conflictHandler(state, els, result.current);
      else showToast('This report was changed in another tab, so this edit was not saved.');
    } else {
      // Saved after another report opened: there is no notice to show it
      // in, so the toast says which report kept the other tab's version.
      showToast(`"${job.meta.title}" was changed in another tab, so the last edit to it was not saved.`);
    }
    return 'conflict';
  }
  baseRev.set(id, result.updated);
  clearReportJournal(id);
  if (state.reportId === id) {
    state.reportRev = result.updated;
    state.isExample = false;
    updateReportBar(state);
    setPreference(state, 'lastReportId', id);
  }
  await refreshLibrary(state, els);
  return 'saved';
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

/** How long an armed button waits when focus is not on it (a pointer press). */
const UNFOCUSED_CONFIRM_MS = 20000;
const armed = new WeakMap();

/**
 * Ask before deleting, in place. The first press turns the button into
 * "Delete?" and says so in the toast, which is a polite live region; a second
 * press confirms. It stays armed while it has focus, for as long as that
 * takes: a fixed four seconds could not be met by a switch or a screen reader
 * user, and the prompt was only a change of the focused button's name, which
 * some screen readers do not read. It disarms when focus leaves it, on
 * Escape, on a press anywhere else, or (when it was armed by a pointer that
 * did not focus it, as in Safari) after twenty seconds. Leaving and coming
 * back therefore starts again: the next press arms it, it does not delete.
 *
 * @param {HTMLButtonElement} button
 * @returns {boolean} true when this press confirms the delete
 */
export function confirmDelete(button) {
  if (!button) return false;
  if (armed.has(button)) {
    armed.get(button)();
    return true;
  }
  const title = button.dataset.reportTitle || 'this report';
  button.textContent = 'Delete?';
  button.dataset.confirm = 'armed';
  // The name still starts with the word on screen (WCAG 2.5.3).
  button.setAttribute('aria-label', `Delete ${title}: press again to confirm`);
  showToast(`Press Delete again to remove "${title}".`, { duration: 6000 });
  let timer = 0;
  const cleanup = () => {
    clearTimeout(timer);
    armed.delete(button);
    button.removeEventListener('focusout', disarm);
    button.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointer, true);
  };
  function disarm() {
    cleanup();
    delete button.dataset.confirm;
    button.textContent = 'Delete';
    button.setAttribute('aria-label', `Delete ${title}`);
  }
  function onKey(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    disarm();
  }
  function onPointer(event) {
    if (!(event.target instanceof Node) || !button.contains(event.target)) disarm();
  }
  button.addEventListener('focusout', disarm);
  button.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointer, true);
  if (document.activeElement !== button) timer = setTimeout(disarm, UNFOCUSED_CONFIRM_MS);
  armed.set(button, cleanup);
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

/**
 * Put focus on a report that just opened from an example card. The card
 * hides with the welcome screen, and a focused element that stops being
 * rendered loses focus: the body had it, and the next Tab went to the
 * footer, past the whole report (WCAG 2.4.3). The report's title takes it,
 * or <main>. Focus the visitor already moved somewhere visible is left alone.
 *
 * @param {object} els
 */
export function focusReport(els) {
  const active = document.activeElement;
  // getClientRects forces layout, so a card that just went display:none
  // counts as lost even before the browser blurs it.
  if (active && active !== document.body && active.isConnected && active.getClientRects().length) return;
  const title = els.stage?.querySelector('.report-title');
  if (title) {
    // Set on the live heading, not in the renderer, which the one-file
    // export shares; every render rebuilds the heading anyway.
    if (!title.hasAttribute('tabindex')) title.tabIndex = -1;
    title.focus();
    if (document.activeElement === title) return;
  }
  document.getElementById('main')?.focus();
}

function visibleOpenButtons(els) {
  return Array.from(els.library?.querySelectorAll('.ds-library__open') || []).filter(isVisible);
}

function isVisible(el) {
  return Boolean(el) && !el.disabled && el.getClientRects().length > 0;
}
