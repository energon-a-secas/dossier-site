/**
 * The edit pane: the JSON editor, the Form tab, the findings panel and the
 * block catalog, plus the two ways a reader is taken to a place in the report
 * (a finding, an outline heading).
 *
 * Split out of js/events.js. Nothing here opens a document: js/open.js does,
 * and calls back into this module to refresh what it shows.
 */

import { showToast } from './neorgon-dom.js';
import { sentence } from './share.js';
import {
  applyText, applyParsed, applyDocument, rerender, carryDerivedMarks,
} from './pipeline.js';
import { reportOf } from './render/index.js';
import { setPreference } from './state.js';
import { mode } from './chrome.js';
import { persistCurrent } from './library.js';
import { createCatalogDialog } from './catalog.js';
import { createEditor, formatJson } from './editor.js';
import { createFindingsPanel, updateFindingsPanel, findingPlace } from './findings-panel.js';
import { reportForm } from './authoring.js';
import { routeFor } from './router.js';
import { reducedMotion } from './motion.js';

let editor = null;
let findingsPanel = null;
let catalogDialog = null;

// ── Editor ───────────────────────────────────────────────────────────────────

export function mountEditor(state, els) {
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

/** Show the state's source text in the editor, without re-parsing it. */
export function syncEditor(state) {
  editor?.setValue?.(state.sourceText || '');
}

/**
 * Parse and save an edit still waiting for the editor's pause, now. The page
 * is hiding (js/boot.js) and a timer will not get another turn.
 */
export function flushEditor() {
  editor?.flush?.();
}

/** True while the editor holds typing it has not parsed yet. */
export function editorPending() {
  return Boolean(editor?.pending?.());
}

/**
 * The editor toolbar's Format button lands here. It formats the authored
 * document: formatting the derived model wrote derived ids into the source,
 * and the next parse warned about each one.
 */
export function formatCurrent(state, els) {
  if (!state.document) return;
  const text = formatJson(state.document);
  applyText(state, text);
  syncEditor(state);
  rerender(state, els);
  refreshFindings(state, els);
  showToast('Formatted.');
}

// ── Form tab ─────────────────────────────────────────────────────────────────

export function showSourceTab(state, els, pane) {
  const which = pane === 'json' ? 'json' : 'form';
  if (els.jsonPane) els.jsonPane.hidden = which !== 'json';
  if (els.formPane) els.formPane.hidden = which !== 'form';
  document.getElementById('tabJson')?.setAttribute('aria-selected', String(which === 'json'));
  document.getElementById('tabForm')?.setAttribute('aria-selected', String(which === 'form'));
  // Roving tabindex: the tab list is one Tab stop, and the arrow keys move
  // between the tabs (js/events.js binds js/seg.js `bindGroupKeys` on it).
  const tabJson = document.getElementById('tabJson');
  const tabForm = document.getElementById('tabForm');
  if (tabJson) tabJson.tabIndex = which === 'json' ? 0 : -1;
  if (tabForm) tabForm.tabIndex = which === 'form' ? 0 : -1;
  if (state.preferences.sourceTab !== which) setPreference(state, 'sourceTab', which);

  if (which !== 'form' || !els.formPane) return;
  // The pane is hidden while reading, so the form is built when editing
  // starts (js/events.js calls this again on `dossier-mode`).
  if (!state.model) {
    els.formPane.replaceChildren();
    return;
  }
  if (mode() === 'read') return;
  // The wrapped document goes in, and a wrapped document comes back.
  const form = reportForm(state, (next) => {
    applyDocument(state, carryDerivedMarks(next, state.model));
    syncEditor(state);
    rerender(state, els);
    refreshFindings(state, els);
    persistCurrent(state, els);
  });
  if (form) els.formPane.replaceChildren(form);
}

// ── Catalog ──────────────────────────────────────────────────────────────────

/**
 * @param {(block: object|null, type: string|null, template?: string) => void} onPick
 *   a block card hands over its sample; a template card hands over a file name
 */
export function mountCatalog(onPick) {
  catalogDialog = createCatalogDialog(onPick);
  if (catalogDialog && !catalogDialog.isConnected) document.body.appendChild(catalogDialog);
}

/** Append a block to the current page. The caller makes sure a report is open. */
export function insertBlock(state, els, block) {
  const current = reportOf(state.model);
  if (!current || !Array.isArray(current.pages) || !current.pages.length) return false;
  const page = current.pages.find((p) => p.id === state.page) || current.pages[0];
  page.blocks = Array.isArray(page.blocks) ? page.blocks : [];
  page.blocks.push(block);
  applyDocument(state, state.model);
  syncEditor(state);
  rerender(state, els);
  refreshFindings(state, els);
  showSourceTab(state, els, state.preferences.sourceTab);
  persistCurrent(state, els);
  showToast(sentence(`Added a ${block.type} block to "${page.title || 'this page'}"`));
  return true;
}

// ── Findings ─────────────────────────────────────────────────────────────────

export function mountFindings(state, els) {
  if (!els.findingsBody) return;
  findingsPanel = createFindingsPanel({
    findings: state.findings,
    onFindingClick: (finding) => gotoFinding(state, els, finding),
  });
  if (findingsPanel) els.findingsBody.replaceChildren(findingsPanel);
}

/**
 * Redraw the panel from `state.findings`. The panel element is replaced each
 * time, so the new node has to be kept: holding on to the first one left this
 * module pointing at a detached node, and every later refresh did nothing.
 * A hidden panel is redrawn when it is shown instead.
 */
export function refreshFindings(state, els) {
  if (!els.findingsBody) return;
  if (els.findingsPanel?.hidden) {
    findingsPanel = null;
    return;
  }
  const next = updateFindingsPanel(findingsPanel, state.findings, (f) => gotoFinding(state, els, f));
  if (!next.isConnected) els.findingsBody.replaceChildren(next);
  findingsPanel = next;
}

/**
 * Open or close Check report. While reading it is a popover over the sheet
 * (css/shell.css), so opening it from its button moves focus into it, like
 * the Compare view's popovers; beside the editor it is a docked panel and
 * focus stays put. Closing it with focus inside puts focus back on the
 * button, in both modes: the Close button went with the panel, and focus
 * fell to the body.
 *
 * @param {{focus?: boolean}} [opts] focus: the reader pressed the button
 */
export function showFindings(state, els, show, { focus = false } = {}) {
  if (!els.findingsPanel) return;
  const hadFocus = !show && els.findingsPanel.contains(document.activeElement);
  els.findingsPanel.hidden = !show;
  els.toggleFindings?.setAttribute('aria-expanded', String(Boolean(show)));
  setPreference(state, 'showFindings', Boolean(show));
  if (show) refreshFindings(state, els);
  if (hadFocus && els.toggleFindings?.getClientRects().length) els.toggleFindings.focus({ preventScroll: true });
  if (show && focus && mode() === 'read') els.findingsPanel.querySelector('button')?.focus({ preventScroll: true });
}

/** Where Check report floats over the sheet; matches css/shell.css. */
const FINDINGS_OVER = '(min-width: 960px)';

/**
 * Check report as a popover while reading: a press anywhere outside it (and
 * outside its button) closes it, and so does Escape, which puts focus back on
 * the button when focus was in the panel or on it. Bound once. Focus leaving
 * the panel does not close it: a finding moves focus to its block, and the
 * panel stays so the reader can walk through the findings. Escape listens in
 * the capture phase, so it is handled before the rail drawer's (js/chrome.js).
 */
export function bindFindingsPopover(state, els) {
  const panel = els.findingsPanel;
  const toggle = els.toggleFindings;
  if (!panel || !toggle) return;
  const floating = () => mode() === 'read' && !panel.hidden;
  document.addEventListener('pointerdown', (event) => {
    if (!floating() || !window.matchMedia(FINDINGS_OVER).matches) return;
    const target = event.target;
    if (target instanceof Node && (panel.contains(target) || toggle.contains(target))) return;
    showFindings(state, els, false);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !floating()) return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    const active = document.activeElement;
    const refocus = panel.contains(active) || active === toggle;
    showFindings(state, els, false);
    if (refocus && toggle.getClientRects().length) toggle.focus({ preventScroll: true });
  }, true);
}

/** Hide the panel without recording a preference, for a report that closed. */
export function hideFindings(els) {
  if (els.findingsPanel) els.findingsPanel.hidden = true;
  els.toggleFindings?.setAttribute('aria-expanded', 'false');
}

/**
 * Take the reader to what a finding is about (js/findings-panel.js
 * findingPlace): switch to its page, scroll to its block and mark it briefly.
 * A document field (`dossier.subtitle`) goes to the report header, and so does
 * a page index the report no longer has.
 */
export function gotoFinding(state, els, finding) {
  if (!finding || !els.stage) return;
  const place = findingPlace(finding.path);
  if (!place) return;
  const pages = reportOf(state.model || state.lastGood)?.pages || [];
  const page = place.header ? null : pages[place.page];
  if (!page) {
    const header = els.stage.querySelector('.report-header');
    if (header) revealBlock(header, 'start');
    return;
  }
  if (page.id !== state.page) {
    state.page = page.id;
    history.replaceState(null, '', routeFor({ page: page.id }));
    rerender(state, els);
    showSourceTab(state, els, state.preferences.sourceTab);
  }
  const target = place.block === null
    ? els.stage.querySelector('.report-page__head') || els.stage.querySelector('.report-page')
    : els.stage.querySelectorAll('.report-blocks > *')[place.block];
  if (target) revealBlock(target.firstElementChild || target, 'center');
}

/** An outline heading: scroll to it and keep the page route in the URL. */
export function gotoHeading(els, blockId) {
  if (!blockId || !els.stage) return false;
  const target = Array.from(els.stage.querySelectorAll('[id]')).find((el) => el.id === blockId);
  if (!target) return false;
  revealBlock(target, 'start');
  return true;
}

const MARK_MS = 1600;

/**
 * Scroll an element into view, move focus to it without a second scroll, and
 * mark it for a moment. The mark is `data-marked` plus an outline set through
 * the CSSOM, so it shows even before a stylesheet styles the attribute.
 */
export function revealBlock(el, block = 'center') {
  const still = reducedMotion();
  el.scrollIntoView({ block, behavior: still ? 'auto' : 'smooth' });
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  el.dataset.marked = '';
  el.style.outline = '2px solid var(--accent, currentColor)';
  el.style.outlineOffset = '4px';
  clearTimeout(Number(el.dataset.markTimer));
  el.dataset.markTimer = String(setTimeout(() => {
    delete el.dataset.marked;
    delete el.dataset.markTimer;
    el.style.outline = '';
    el.style.outlineOffset = '';
  }, MARK_MS));
}
