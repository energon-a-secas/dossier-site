/**
 * The open report and other tabs.
 *
 * A second tab on the same report is the default (both open the last
 * report), and an old forgotten tab used to save its stale copy over newer
 * work the next time anything was edited in it. Two things stop that:
 *
 * - When another tab saves the open report and nothing here is waiting (no
 *   save under way, no typing the editor has not parsed, no form field in
 *   use), the newer version is loaded in place, on the same page.
 * - Otherwise every save checks the revision it was made on (js/store.js),
 *   and a refused save shows a notice above the report: show the newer
 *   version, or keep this one and save it over the other.
 */

import { registerActions } from './actions.js';
import { say } from './share.js';
import { readReport } from './store.js';
import { readRecord, applyRead } from './open.js';
import { rerender, pageFocusOrigin, restorePageFocus } from './pipeline.js';
import {
  syncEditor, showSourceTab, refreshFindings, editorPending,
} from './source-pane.js';
import { onSaveConflict, persistCurrent, focusReport } from './library.js';

const NOTICE_ID = 'reportConflict';
const CONFLICT = 'This report was changed in another tab, so this edit was not saved.';

/** Wire the conflict notice and its two actions. Called once by js/boot.js. */
export function bindReportSync(state, els) {
  onSaveConflict(() => showConflict(state, els));
  registerActions({
    'report-reload': () => reloadOpen(state, els),
    'report-keep-mine': () => keepMine(state, els),
  });
}

/**
 * Another tab saved reports. If the open one is among them, and nothing of
 * this tab's is waiting, the newer version replaces it on screen.
 *
 * @param {string[]} ids
 */
export async function followOtherTab(state, els, ids) {
  const id = state.reportId;
  if (!id || !Array.isArray(ids) || !ids.includes(id) || busy(state, els)) return;
  const record = await readReport(id);
  if (!record || state.reportId !== id || record.meta?.updated === state.reportRev) return;
  // Checked again: the reader may have started typing while it was read.
  if (busy(state, els)) return;
  if (applyRecord(state, els, id, record)) say('This report was changed in another tab, so that version is shown.');
}

/** Something here would be lost by loading another version over it. */
function busy(state, els) {
  if (state.savePending || editorPending() || state.reportConflict !== null) return true;
  const active = document.activeElement;
  const pane = els.formPane?.closest('#sourcePane') || els.formPane;
  return Boolean(active && pane?.contains(active) && active.matches('input, textarea, select, [contenteditable]'));
}

/** Show a stored record as the open report, on the same page. */
function applyRecord(state, els, id, record) {
  const { read } = readRecord(record);
  if (!read.ok) return false;
  // A tab or link in the report that had focus is rebuilt below.
  const origin = pageFocusOrigin(document.activeElement, els);
  // applyRead keeps the page when the new version still has it.
  applyRead(state, read);
  state.reportId = id;
  state.reportRev = record.meta?.updated ?? null;
  state.reportConflict = null;
  syncEditor(state);
  rerender(state, els);
  restorePageFocus(origin, els);
  showSourceTab(state, els, state.preferences.sourceTab);
  refreshFindings(state, els);
  hideConflict();
  return true;
}

/** The notice above the report, with the choice. Said once, shown until chosen. */
function showConflict(state, els) {
  let notice = document.getElementById(NOTICE_ID);
  if (notice && notice.dataset.reportId === state.reportId) return;
  notice?.remove();
  notice = document.createElement('div');
  notice.id = NOTICE_ID;
  notice.className = 'ds-conflict';
  notice.dataset.reportId = state.reportId;
  notice.setAttribute('role', 'group');
  notice.setAttribute('aria-labelledby', `${NOTICE_ID}Text`);
  const text = document.createElement('p');
  text.id = `${NOTICE_ID}Text`;
  text.textContent = CONFLICT;
  const actions = document.createElement('div');
  actions.className = 'ds-conflict__actions';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'btn btn--sm btn--primary';
  reload.dataset.action = 'report-reload';
  reload.textContent = 'Show the newer version';
  const keep = document.createElement('button');
  keep.type = 'button';
  keep.className = 'btn btn--sm';
  keep.dataset.action = 'report-keep-mine';
  keep.textContent = 'Keep mine';
  actions.append(reload, keep);
  notice.append(text, actions);
  const stage = els.stage;
  if (stage?.parentElement) stage.parentElement.insertBefore(notice, stage);
  say(`${CONFLICT} Choose which version to keep, above the report.`);
}

function hideConflict() {
  const notice = document.getElementById(NOTICE_ID);
  if (!notice) return;
  const hadFocus = notice.contains(document.activeElement);
  notice.remove();
  return hadFocus;
}

/** "Show the newer version": the stored report replaces this tab's edit. */
async function reloadOpen(state, els) {
  const id = state.reportId;
  const record = id ? await readReport(id) : null;
  if (!record || state.reportId !== id) {
    say('That version could not be read back. Nothing was changed.');
    return;
  }
  const hadFocus = document.getElementById(NOTICE_ID)?.contains(document.activeElement);
  if (!applyRecord(state, els, id, record)) {
    say('That version could not be read. Nothing was changed.');
    return;
  }
  if (hadFocus) focusReport(els);
  say('The version saved in the other tab is shown.');
}

/** "Keep mine": this tab's version is saved over the other tab's. */
async function keepMine(state, els) {
  if (state.reportConflict === null || !state.reportId) {
    hideConflict();
    return;
  }
  // The other tab's revision becomes the one this save is made on, so a
  // third save, from anywhere, is still caught.
  state.reportRev = state.reportConflict;
  state.reportConflict = null;
  const hadFocus = hideConflict();
  const outcome = await persistCurrent(state, els);
  if (hadFocus) focusReport(els);
  if (outcome === 'saved') say('Your version is saved.');
}
