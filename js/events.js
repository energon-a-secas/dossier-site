/**
 * Every listener on the page, bound once.
 *
 * One delegated click handler over `[data-action]`, routed through the action
 * registry in js/actions.js. No inline onclick, which is why this page's
 * policy needs no 'unsafe-inline' for scripts. The handlers themselves live
 * with what they act on: opening in js/open.js, the edit pane in
 * js/source-pane.js, sharing and export in js/export-dialog.js.
 */

import { openDialog, bindDialog } from './dialogs.js';
import { setPreference } from './state.js';
import {
  toggleMode, mode, view, setRail, railOpen, railDocked,
} from './chrome.js';
import {
  filterLibrary, confirmDelete, removeStored, focusAfterDelete, focusOpened,
} from './library.js';
import { openCatalog, isExampleFile } from './catalog.js';
import { bindComparisons } from './comparison-controls.js';
import { bindEmbeds } from './embeds.js';
import { bindDisplay, openDisplay } from './display.js';
import { registerActions, runAction } from './actions.js';
import {
  openText, openStored, openBlank, loadFixture, replaceDeleted,
  describeDetected,
} from './open.js';
import {
  mountEditor, mountFindings, mountCatalog, syncEditor, insertBlock,
  showFindings, showSourceTab, gotoHeading,
} from './source-pane.js';
import { registerExportActions } from './export-dialog.js';
import { routeFor } from './router.js';
import { showToast } from './neorgon-dom.js';
import { sentence } from './share.js';

const $ = (id) => document.getElementById(id);

/** Everything the rest of the app reaches for, resolved once. */
export function elements() {
  return {
    shell: $('shell'),
    rail: $('rail'),
    stage: $('stage'),
    outline: $('outline'),
    library: $('library'),
    reportFilter: $('reportFilter'),
    formPane: $('formPane'),
    jsonPane: $('jsonPane'),
    findingsPanel: $('findingsPanel'),
    findingsBody: $('findingsBody'),
    findingsCount: $('findingsCount'),
    toggleFindings: $('toggleFindings'),
    toggleModeBtn: $('toggleMode'),
    shareReport: $('shareReport'),
    importDialog: $('importDialog'),
    importFile: $('importFile'),
    importText: $('importText'),
    importDetected: $('importDetected'),
    exportDialog: $('exportDialog'),
    exportBody: $('exportBody'),
    displayDialog: $('displayDialog'),
    welcomeExamples: $('welcomeExamples'),
    openExamples: $('openExamples'),
  };
}

export function bindEvents(state, els) {
  mountEditor(state, els);
  mountFindings(state, els);
  mountCatalog((block, type, template) => {
    if (template) {
      loadFixture(state, els, `reports/${template}`);
    } else if (block) {
      if (!state.model) openBlank(state, els);
      insertBlock(state, els, structuredClone(block));
    }
  });
  bindComparisons(document);
  bindEmbeds();
  document.addEventListener('dossier-opened', () => syncEditor(state));

  // No fallback of their own: js/dialogs.js returns focus to the kit's menu
  // button or <main> when the opener is gone (it sat in the closed phone menu).
  for (const dialog of [els.importDialog, els.exportDialog]) {
    if (dialog) bindDialog(dialog);
  }
  bindDisplay(els.displayDialog, document.getElementById('displayOptions'));

  registerReportActions(state, els);
  registerExportActions(state, els);

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (target) runAction(target.dataset.action, target, event);
  });

  els.importFile?.addEventListener('change', async () => {
    const file = els.importFile.files && els.importFile.files[0];
    if (!file) return;
    const text = await file.text();
    if (els.importText) els.importText.value = text;
    describeDetected(els, text);
  });
  els.importText?.addEventListener('input', () => describeDetected(els, els.importText.value));
  els.reportFilter?.addEventListener('input', () => filterLibrary(els, els.reportFilter.value));

  // A dropped file anywhere on the page opens it. The page is one surface and
  // making the reader find a target is a courtesy nobody asked for.
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      document.body.classList.add('is-dropping');
    }
  });
  document.addEventListener('dragleave', () => document.body.classList.remove('is-dropping'));
  document.addEventListener('drop', async (e) => {
    document.body.classList.remove('is-dropping');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    openText(state, els, await file.text(), file.name);
  });

  document.addEventListener('dossier-mode', () => {
    const btn = els.toggleModeBtn;
    const reading = mode() === 'read';
    if (btn) {
      // Pressed means editing: the button is a switch for the editor, and its
      // label says what pressing it does next.
      btn.setAttribute('aria-pressed', String(!reading));
      const label = btn.querySelector('span');
      if (label) label.textContent = reading ? 'Edit' : 'Done';
    }
    if (!reading) showSourceTab(state, els, state.preferences.sourceTab);
  });

  // Focus left in the view that just hid moves somewhere visible. The
  // Compare view (js/compare/index.js) shows and hides itself.
  document.addEventListener('dossier-view', (event) => {
    const { view: next, previous } = event.detail || {};
    if (next !== previous) keepFocusVisible(next);
  });

  // A drawer rail closes once its link has done its job: it covers the report.
  els.rail?.addEventListener('click', (event) => {
    if (railDocked() || !railOpen()) return;
    if (event.target.closest('a[href], [data-action="open-report"]')) setRail(false);
  });
}

/**
 * Focus left inside a region that just hid (the welcome screen's "Compare
 * reports", an example card) moves into the view now shown: its own header
 * button, which says it is the current page. On a narrow phone only the
 * other view's button shows, and that one leads back out, so Compare falls
 * to its first toolbar control instead; then the page itself.
 *
 * @param {'reports'|'compare'} next the view now shown
 */
function keepFocusVisible(next) {
  const active = document.activeElement;
  if (active && active !== document.body && active.getClientRects().length) return;
  const byId = (id) => document.getElementById(id);
  const toolbar = byId('cmpToolbar');
  const candidates = next === 'compare'
    ? [byId('viewCompare'), ...(toolbar ? [...toolbar.querySelectorAll('button, select')].filter((el) => el.tabIndex >= 0) : [])]
    : [byId('viewReports'), byId('viewCompare')];
  const target = [...candidates, byId('main')]
    .find((el) => el && !el.disabled && el.getClientRects().length);
  target?.focus({ preventScroll: true });
}

/** Go to a view through the address, so Back and Forward move between views. */
function goToView(state, next) {
  if (next === view()) return;
  location.hash = next === 'compare' ? routeFor({ view: 'compare' }) : routeFor({ page: state.page || undefined });
}

function registerReportActions(state, els) {
  registerActions({
    view: (el) => goToView(state, el.dataset.view === 'compare' ? 'compare' : 'reports'),
    open: (el) => openDialog(els.importDialog, el),
    display: (el) => openDisplay(els.displayDialog, el),
    'import-confirm': () => {
      if (openText(state, els, els.importText?.value || '', 'Pasted text')) els.importDialog?.close();
    },
    'new-report': () => openBlank(state, els),
    example: (el) => {
      const file = el.dataset.file;
      if (!isExampleFile(file)) return;
      els.importDialog?.close();
      loadFixture(state, els, `reports/${file}`);
    },
    catalog: (el) => openCatalog(el),
    findings: () => showFindings(state, els, els.findingsPanel?.hidden !== false),
    'source-tab': (el) => showSourceTab(state, els, el.dataset.pane),
    'toggle-mode': () => {
      toggleMode();
      setPreference(state, 'readMode', mode() === 'read');
    },
    'toggle-rail': (el) => {
      const open = !railOpen();
      // Focus follows a drawer, and leaves a docked rail's own Hide button
      // before that button disappears.
      setRail(open, { focus: !railDocked() || Boolean(el.closest('#rail')) });
      if (railDocked()) setPreference(state, 'railOpen', open);
    },
    'open-report': async (el) => {
      const id = el.dataset.reportId;
      // Opening rebuilds the list, so a keyboard user would land on the body.
      if (await openStored(state, els, id)) focusOpened(els, id);
    },
    'delete-report': async (el) => {
      if (!confirmDelete(el)) return;
      const title = el.dataset.reportTitle || 'the report';
      const { deleted, wasOpen, index } = await removeStored(state, els, el.dataset.reportId);
      if (!deleted) return;
      // The open report went: show the next saved one, or the welcome screen
      // when it was the last.
      const instead = wasOpen ? await replaceDeleted(state, els) : null;
      const deletedLine = sentence(`Deleted "${title}"`);
      showToast(instead ? `${deletedLine} ${sentence(`Showing "${instead.title}"`)}` : deletedLine);
      focusAfterDelete(els, index);
    },
    'outline-heading': (el, event) => {
      // A modified click opens the heading's page link in a new tab or
      // window, which is what its href is kept for (js/pipeline.js).
      if (event && (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
      if (gotoHeading(els, el.dataset.blockId)) event?.preventDefault();
    },
  });
}
