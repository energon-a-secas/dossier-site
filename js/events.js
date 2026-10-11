/**
 * Every listener on the page, bound once.
 *
 * One delegated click handler over `[data-action]`. No inline onclick, which
 * is why this page's policy needs no 'unsafe-inline' for scripts, and why a
 * control cannot end up with no handler at all: an action with no case lands
 * in the default branch and says so in the console rather than doing nothing.
 */

import { showToast } from './neorgon-dom.js';
import { openDialog, bindDialog } from './dialogs.js';
import { applyText, applyParsed, applyDocument, rerender } from './pipeline.js';
import { reportOf } from './render/index.js';
import { setPreference } from './state.js';
import { toggleMode, setMode, mode } from './chrome.js';
import {
  persistCurrent, refreshLibrary, filterLibrary, openStored, removeStored,
} from './library.js';
import { copyShareLink, encodeDocument } from './share.js';
import {
  exportJson, exportYaml, exportStandaloneHtml, exportPrint, exportSageDeck,
} from './export.js';
import { createCatalogDialog, openCatalog } from './catalog.js';
import { createEditor, formatJson } from './editor.js';
import { createFindingsPanel, updateFindingsPanel } from './findings-panel.js';
import { reportForm } from './authoring.js';
import { detect } from './adapters/index.js';
import { bindComparisons } from './comparison-controls.js';
import { bindComposer, showComposer } from './compose.js';
import { bindEmbeds } from './embeds.js';

const $ = (id) => document.getElementById(id);

/** Everything the rest of the app reaches for, resolved once. */
export function elements() {
  return {
    stage: $('stage'),
    shell: $('shell'),
    rail: $('rail'),
    outline: $('outline'),
    library: $('library'),
    reportFilter: $('reportFilter'),
    sourcePane: $('sourcePane'),
    formPane: $('formPane'),
    jsonPane: $('jsonPane'),
    findingsPanel: $('findingsPanel'),
    findingsBody: $('findingsBody'),
    findingsCount: $('findingsCount'),
    toggleFindings: $('toggleFindings'),
    toggleModeBtn: $('toggleMode'),
    shareReport: $('shareReport'),
    exportReport: $('exportReport'),
    importDialog: $('importDialog'),
    importFile: $('importFile'),
    importText: $('importText'),
    importDetected: $('importDetected'),
    exportDialog: $('exportDialog'),
    exportBody: $('exportBody'),
    welcome: $('welcome'),
    pageTabs: $('pageTabs'),
  };
}

let editor = null;
let findingsPanel = null;
let catalogDialog = null;

export function bindEvents(state, els) {
  mountEditor(state, els);
  mountFindings(state, els);
  mountCatalog(state, els);
  bindComparisons(document);
  bindEmbeds();
  bindComposer((document) => {
    applyDocument(state, document);
    state.reportId = null;
    state.isExample = false;
    setMode('read');
    finishOpen(state, els);
  });
  document.addEventListener('dossier-opened', () => {
    if (editor) editor.setValue?.(state.sourceText || '');
  });

  for (const dialog of [els.importDialog, els.exportDialog]) {
    if (dialog) bindDialog(dialog, els.stage);
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || target.dataset.action.startsWith('compare-')) return;
    const action = target.dataset.action;
    runAction(action, { state, els, target, event });
  });

  els.importFile?.addEventListener('change', async () => {
    const file = els.importFile.files && els.importFile.files[0];
    if (!file) return;
    const text = await file.text();
    if (els.importText) els.importText.value = text;
    describeDetected(els, text);
  });

  els.importText?.addEventListener('input', () => {
    describeDetected(els, els.importText.value);
  });

  els.reportFilter?.addEventListener('input', () => {
    filterLibrary(els, els.reportFilter.value);
  });

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
    if (!btn) return;
    const reading = mode() === 'read';
    btn.setAttribute('aria-pressed', String(reading));
    const label = btn.querySelector('span');
    if (label) label.textContent = reading ? 'Edit report' : 'Read report';
    if (!reading) showSourceTab(state, els, state.preferences.sourceTab);
  });
}

function runAction(action, ctx) {
  const { state, els, target } = ctx;
  switch (action) {
    case 'open':
      openDialog(els.importDialog, target);
      break;
    case 'import-confirm':
      if (openText(state, els, els.importText?.value || '', 'Pasted text')) els.importDialog?.close();
      break;
    case 'compose':
      showComposer(true);
      break;
    case 'compose-cancel':
      showComposer(false);
      break;
    case 'new-report':
      applyDocument(state, blankReport());
      state.reportId = null;
      state.isExample = false;
      finishOpen(state, els);
      setMode('build');
      break;
    case 'templates':
      els.importDialog?.close();
      openCatalog(target, 'templates');
      break;
    case 'demo':
      els.importDialog?.close();
      loadFixture(state, els, 'reports/responses.json');
      break;
    case 'catalog':
      openCatalog(target);
      break;
    case 'share':
      shareCurrent(state, els);
      break;
    case 'export':
      showExportChoices(state, els, target);
      break;
    case 'export-json':
      exportJson(state.model);
      break;
    case 'export-yaml':
      exportYaml(state.model);
      break;
    case 'export-html':
      exportStandalone(state, els);
      break;
    case 'export-print':
      els.exportDialog?.close();
      exportPrint(state.model, els.stage, { page: state.page });
      break;
    case 'export-deck':
      exportSageDeck(state.model);
      break;
    case 'findings':
      showFindings(state, els, els.findingsPanel?.hidden !== false);
      break;
    case 'format-json':
      formatCurrent(state, els);
      break;
    case 'source-tab':
      showSourceTab(state, els, target.dataset.pane);
      break;
    case 'toggle-mode':
      toggleMode();
      setPreference(state, 'readMode', mode() === 'read');
      break;
    case 'open-report':
      openStored(state, els, target.dataset.reportId, finishOpen);
      break;
    case 'delete-report':
      removeStored(state, els, target.dataset.reportId);
      break;
    case 'goto-page':
      state.page = target.dataset.page;
      rerender(state, els);
      break;
    default:
      // A control with an action nobody handles is a dead button, which is a
      // defect worth seeing rather than a silent no-op.
      // eslint-disable-next-line no-console
      console.warn(`No handler for data-action="${action}"`);
  }
}

// ── Opening ──────────────────────────────────────────────────────────────────

function openText(state, els, text, label) {
  if (!text || !text.trim()) {
    showToast('There was nothing to read in that.');
    return false;
  }

  const adapter = detect(text);
  if (adapter && adapter.toDossier) {
    const converted = adapter.toDossier(text);
    if (converted && converted.document) {
      const candidate = { ...state };
      const result = applyDocument(candidate, converted.document);
      if (!result.ok) {
        if (els.importDetected) els.importDetected.textContent = result.fatal.message;
        return false;
      }
      Object.assign(state, candidate);
      state.findings = [...state.findings, ...(converted.findings || [])];
      state.reportId = null;
      state.isExample = false;
      showToast(`Opened ${adapter.label} report.`);
      showComposer(false);
      setMode('read');
      finishOpen(state, els);
      return true;
    }
  }

  // Do not replace a saved report or its source with a failed import.
  const candidate = { ...state };
  const result = applyText(candidate, text);
  if (!result.ok) {
    showToast(`${label} could not be read: ${result.fatal.message}`);
    if (els.importDetected) els.importDetected.textContent = result.fatal.message;
    return false;
  }
  Object.assign(state, candidate, { reportId: null, isExample: false });
  showComposer(false);
  setMode('read');
  finishOpen(state, els);
  return true;
}

function finishOpen(state, els) {
  if (editor && state.sourceText) editor.setValue?.(state.sourceText);
  rerender(state, els);
  showSourceTab(state, els, state.preferences.sourceTab);
  persistCurrent(state, els);
  if (state.findings.some((f) => f.level === 'error')) showFindings(state, els, true);
}

async function loadFixture(state, els, path) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    applyText(state, await res.text());
    state.reportId = null;
    state.isExample = true;
    showComposer(false);
    setMode('read');
    if (editor) editor.setValue?.(state.sourceText);
    rerender(state, els);
    showSourceTab(state, els, state.preferences.sourceTab);
  } catch {
    // A failed fetch is not an empty report, and must not look like one.
    showToast(`Could not load ${path}. The example is missing, not empty.`);
  }
}

// ── Sharing and exporting ────────────────────────────────────────────────────

async function shareCurrent(state, els) {
  if (!state.document) {
    showToast('There is no report open to share.');
    return;
  }
  await copyShareLink(state.document);
}

async function showExportChoices(state, els, opener) {
  if (!state.model) {
    showToast('There is no report open to export.');
    return;
  }
  const body = els.exportBody;
  if (body) {
    const encoded = await encodeDocument(state.document).catch(() => null);
    const budget = encoded
      ? `A share link for this report is about ${encoded.payload.length.toLocaleString()} characters, which ${tierSentence(encoded.tier)}`
      : 'The share link size could not be measured.';
    body.innerHTML = '';
    const choices = [
      ['export-html', 'One HTML file', 'Opens with no account, no install and no network. The one to send.'],
      ['export-json', 'JSON document', 'The source, for editing or for another tool.'],
      ['export-yaml', 'YAML document', 'The same document, for hand editing.'],
      ['export-print', 'Print or PDF', 'Every page in sequence, with the links printed.'],
      ['export-deck', 'Presentation Sage deck', 'Hand it to the deck tool when a report has to be presented.'],
    ];
    const list = document.createElement('div');
    list.className = 'ds-export__choices';
    for (const [action, name, note] of choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ds-export__choice';
      btn.dataset.action = action;
      const h = document.createElement('strong');
      h.textContent = name;
      const p = document.createElement('span');
      p.textContent = note;
      btn.append(h, p);
      list.appendChild(btn);
    }
    const note = document.createElement('p');
    note.className = 'ds-export__budget';
    note.textContent = budget;
    body.append(list, note);
  }
  openDialog(els.exportDialog, opener);
}

function tierSentence(tier) {
  switch (tier) {
    case 'travels': return 'travels anywhere.';
    case 'fine': return 'is fine for a message or a ticket.';
    case 'large': return 'works in a browser, though some chat clients will cut it. Send the file instead.';
    default: return 'is too long for a link. Send the file instead.';
  }
}

async function exportStandalone(state, els) {
  const ok = await exportStandaloneHtml(state.model);
  if (ok === false) {
    showToast('The one-file export could not be built. Nothing was downloaded.');
  }
}

// ── Panels ───────────────────────────────────────────────────────────────────

function mountEditor(state, els) {
  if (!els.jsonPane) return;
  editor = createEditor(state.sourceText || '', {
    onChange: (result) => {
      if (!result) return;
      applyParsed(state, result, editor.getValue ? editor.getValue() : undefined);
      rerender(state, els);
      refreshFindings(state, els);
    },
    onFormat: () => formatCurrent(state, els),
    autoSave: () => persistCurrent(state, els),
  });
  if (editor) els.jsonPane.replaceChildren(editor);
}

function mountFindings(state, els) {
  if (!els.findingsBody) return;
  findingsPanel = createFindingsPanel({
    findings: state.findings,
    onFindingClick: (finding) => gotoFinding(state, els, finding),
  });
  if (findingsPanel) els.findingsBody.replaceChildren(findingsPanel);
}

function refreshFindings(state, els) {
  if (findingsPanel) {
    updateFindingsPanel(findingsPanel, state.findings, (f) => gotoFinding(state, els, f));
  }
}

function mountCatalog(state, els) {
  catalogDialog = createCatalogDialog((block, type, template) => {
    if (template) loadFixture(state, els, `reports/${template}`);
    else if (block) insertBlock(state, els, structuredClone(block));
  });
  if (catalogDialog && !catalogDialog.isConnected) document.body.appendChild(catalogDialog);
}

function insertBlock(state, els, block) {
  const report = reportOf(state.model);
  if (!report || !Array.isArray(report.pages) || !report.pages.length) {
    applyDocument(state, blankReport());
  }
  const current = reportOf(state.model);
  const page = current.pages.find((p) => p.id === state.page) || current.pages[0];
  page.blocks = Array.isArray(page.blocks) ? page.blocks : [];
  page.blocks.push(block);
  applyDocument(state, state.model);
  if (editor && state.sourceText) editor.setValue?.(state.sourceText);
  rerender(state, els);
  refreshFindings(state, els);
  showSourceTab(state, els, state.preferences.sourceTab);
  persistCurrent(state, els);
  showToast(`Added a ${block.type} block to "${page.title || 'this page'}".`);
}

export function showFindings(state, els, show) {
  if (!els.findingsPanel) return;
  els.findingsPanel.hidden = !show;
  els.toggleFindings?.setAttribute('aria-expanded', String(Boolean(show)));
  setPreference(state, 'showFindings', Boolean(show));
  if (show) refreshFindings(state, els);
}

function gotoFinding(state, els, finding) {
  if (!finding) return;
  const m = /pages\[(\d+)\]/.exec(finding.path || '');
  const pages = reportOf(state.model || state.lastGood)?.pages || [];
  if (m && pages[Number(m[1])]) {
    state.page = pages[Number(m[1])].id;
    rerender(state, els);
  }
}

export function showSourceTab(state, els, pane) {
  const which = pane === 'json' ? 'json' : 'form';
  if (els.jsonPane) els.jsonPane.hidden = which !== 'json';
  if (els.formPane) els.formPane.hidden = which !== 'form';
  document.getElementById('tabJson')?.setAttribute('aria-selected', String(which === 'json'));
  document.getElementById('tabForm')?.setAttribute('aria-selected', String(which === 'form'));
  setPreference(state, 'sourceTab', which);

  if (which === 'form' && els.formPane) {
    if (state.model) {
      // The wrapped document goes in, and a wrapped document comes back.
      const form = reportForm(state, (next) => {
        applyDocument(state, next);
        if (editor) editor.setValue?.(state.sourceText);
        rerender(state, els);
        refreshFindings(state, els);
        persistCurrent(state, els);
      });
      if (form) els.formPane.replaceChildren(form);
    } else {
      els.formPane.replaceChildren();
    }
  }
}

function formatCurrent(state, els) {
  if (!state.model) return;
  const text = formatJson ? formatJson(state.model) : JSON.stringify(state.model, null, 2);
  applyText(state, text);
  if (editor) editor.setValue?.(text);
  rerender(state, els);
  showToast('Formatted.');
}

function describeDetected(els, text) {
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

function blankReport() {
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

export { refreshLibrary };
