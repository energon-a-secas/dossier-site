/**
 * The way between the Reports view and Compare, in three entry points.
 *
 *   Compare (the report bar)   the report being read starts a new comparison:
 *                              column A holds it, B is an empty slot with
 *                              focus on its "Choose a file". Unsaved, like the
 *                              example, until B gets a report.
 *   Use a saved report (slot)  a report from the Reports view's library goes
 *                              into a column, from a menu of the most recent.
 *   Add to column C (Open)     in Compare, the Open dialog puts what it was
 *                              given into the first empty column, or a new
 *                              one, instead of leaving for the Reports view;
 *                              "Read on its own" still opens it there.
 *
 * Nothing here decides how a report becomes a column source: that is
 * js/compare/sources.js (`sourceFromReport`, `readSource`). Putting it in a
 * column goes through the column's own `setSource` (api.setColumnSource),
 * which refuses what does not fit, offers an undo and moves focus.
 */

import { registerActions } from '../actions.js';
import { state } from '../state.js';
import { view } from '../chrome.js';
import { routeFor } from '../router.js';
import { say, sentence } from '../share.js';
import { listReports, readReport } from '../store.js';
import { escHtml } from '../neorgon-dom.js';
import { readSource, sourceFromReport, comparisonFromReport } from './sources.js';
import {
  addColumn, columnById, letterOf, LETTERS, MAX_COLUMNS,
} from './model.js';
import { nameOf } from './blind.js';
import { openPopover, closePopover } from './popover.js';

/** How many saved reports the menu lists; the rest are in the Reports view. */
const SAVED_LIMIT = 30;

/**
 * Where the Open dialog would put a report in this comparison: the first
 * empty column, else a new one, else nowhere (four columns, all filled).
 *
 * @returns {{colId: string|null, label: string}|null}
 */
export function openTarget(set) {
  const empty = (set?.columns || []).find((col) => !col.source);
  if (empty) {
    const name = nameOf(set, empty);
    return { colId: empty.id, label: name.blind ? `Add to ${name.label}` : `Add to column ${letterOf(set, empty.id)}` };
  }
  if ((set?.columns || []).length < MAX_COLUMNS) {
    return { colId: null, label: set.view.blind ? 'Add as a new column' : `Add as column ${LETTERS[set.columns.length]}` };
  }
  return null;
}

/** @param {object} api from js/compare/index.js */
export function initBridge(api) {
  const { compare } = api;
  /** The name of the file the Open dialog read, kept until the text is typed over. */
  let fileName = null;

  const byId = (id) => document.getElementById(id);

  /** The Open dialog's buttons, for the view it is opened from. Never moves focus. */
  function syncOpenDialog() {
    const toColumn = byId('importToColumn');
    const confirm = byId('importConfirm');
    if (!toColumn || !confirm) return;
    const target = view() === 'compare' && compare.set ? openTarget(compare.set) : null;
    toColumn.hidden = !target;
    if (target && toColumn.textContent !== target.label) toColumn.textContent = target.label;
    const word = target ? 'Read on its own' : 'Open it';
    if (confirm.textContent !== word) confirm.textContent = word;
    confirm.classList.toggle('btn--primary', !target);
  }

  compare.hooks.afterRender.push(syncOpenDialog);
  document.addEventListener('dossier-view', syncOpenDialog);
  byId('importFile')?.addEventListener('change', (event) => {
    fileName = event.target.files?.[0]?.name || null;
  });
  // Filled from a file by property, which fires no input event, so the name
  // survives that and goes once the reader types or pastes over it.
  byId('importText')?.addEventListener('input', () => { fileName = null; });
  syncOpenDialog();

  registerActions({
    // The report bar: this report in A, B waiting for the one to compare.
    'cmp-compare-report': () => {
      if (!state.document) {
        say('Open a report first.');
        return;
      }
      const result = comparisonFromReport(state.document);
      if (!result.ok) {
        say(result.message);
        return;
      }
      api.openSet(result.set, { saved: false });
      const onView = (event) => {
        document.removeEventListener('dossier-view', onView);
        if (event.detail?.view !== 'compare') return;
        requestAnimationFrame(() => api.focusColumn(result.emptyId, '[data-action="cmp-choose-file"]'));
      };
      document.addEventListener('dossier-view', onView);
      location.hash = routeFor({ view: 'compare' });
      say(sentence(`Column A shows "${result.title}". Add a report to column B to compare them`));
    },

    'cmp-use-saved': async (el) => {
      const colId = el.dataset.col;
      const set = compare.set;
      const col = columnById(set, colId);
      if (!col) return;
      const rows = await listReports();
      if (!rows.length) {
        say('No reports are saved in this browser yet. A report you open in the Reports view is saved there.');
        return;
      }
      const menu = compare.refs.columnMenu;
      const items = rows.slice(0, SAVED_LIMIT).map((row) => {
        const pages = Number(row.pages) || 0;
        const meta = [row.kind, pages ? `${pages} page${pages === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
        return `<button type="button" role="menuitem" data-action="cmp-use-saved-pick" data-col="${escHtml(colId)}" data-report-id="${escHtml(row.id)}">`
          + `<span class="cmp-menu__title">${escHtml(row.title || 'Untitled report')}</span>`
          + `${meta ? `<span class="cmp-menu__meta">${escHtml(meta)}</span>` : ''}</button>`;
      }).join('');
      const more = rows.length > SAVED_LIMIT
        ? `<p class="cmp-menu__note">The ${SAVED_LIMIT} most recent are listed. Older reports are in the Reports view.</p>`
        : '';
      menu.innerHTML = items + more;
      menu.classList.add('cmp-menu--saved');
      const name = nameOf(set, col);
      menu.setAttribute('aria-label', `Saved reports for ${name.blind ? name.label : `column ${name.ref}`}`);
      openPopover(menu, el, { focus: 'first', onClose: () => menu.classList.remove('cmp-menu--saved') });
    },

    'cmp-use-saved-pick': async (el) => {
      closePopover({ restore: false });
      const record = await readReport(el.dataset.reportId);
      if (!record) {
        say('That report could not be read back. Nothing was changed.');
        return;
      }
      const read = sourceFromReport(record.document);
      if (!read.ok) {
        say(read.message);
        return;
      }
      api.setColumnSource(el.dataset.col, read.source);
    },

    // In Compare, the Open dialog's "Add to column C".
    'cmp-import-to-column': async () => {
      const dialog = byId('importDialog');
      const read = await readSource(byId('importText')?.value || '', fileName || 'Pasted text');
      if (!read.ok) {
        const detected = byId('importDetected');
        if (detected) detected.textContent = read.message;
        return;
      }
      if (read.bundle) {
        await api.openBundle(read.bundle);
        dialog?.close();
        return;
      }
      const set = compare.set;
      const target = set ? openTarget(set) : null;
      if (!target) {
        say('This comparison has four columns. Use Read on its own, or replace a column’s report from its menu.');
        return;
      }
      let colId = target.colId;
      if (!colId) {
        const added = addColumn(set, { role: 'other' });
        api.commit(added.set, { save: false });
        colId = added.id;
      }
      if (!api.setColumnSource(colId, read.source)) return;
      // After the dialog's own close handler has put focus back on its opener.
      dialog?.addEventListener('close', () => api.focusColumn(colId), { once: true });
      dialog?.close();
    },
  });
}
