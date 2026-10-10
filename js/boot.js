/**
 * The boot sequence, in the order that matters.
 *
 * The order is not arbitrary. A report in the URL must win over the last
 * report in this browser, or a shared link opens someone else's draft. The
 * mode is decided before the first render, so a reader never sees the editor
 * appear and then leave. Shortcuts are registered after the kit has booted,
 * because the kit refuses a key it has not claimed yet.
 */

import { loadSaved, setPreference } from './state.js';
import { applyText, applyDocument, rerender } from './pipeline.js';
import { reportOf } from './render/index.js';
import { loadFromUrl, loadFromUrlAsync } from './share.js';
import { readReport, onExternalChange } from './store.js';
import {
  initialMode, registerShortcuts, guardTypingSurfaces,
  followVisitorChromeChoice, setMode, toggleMode, mode,
} from './chrome.js';
import { bindEvents, elements, refreshLibrary, showFindings, showSourceTab } from './events.js';
import { showToast } from './neorgon-dom.js';
import { init as initKeys } from './neokeys/index.js';

export async function boot(state) {
  loadSaved(state);
  const els = elements();

  // The kit owns H, the ? sheet and the remap panel. init is idempotent, so
  // calling it here rather than through boot.js's script tag is safe and
  // keeps the page free of one more script element.
  try {
    initKeys({ chromeToggle: true, typingSelector: '.ds-editor, [data-text-surface]' });
  } catch {
    // A page with no shortcuts still works. This is not worth failing over.
  }
  guardTypingSurfaces();
  followVisitorChromeChoice();

  bindEvents(state, els);

  const claimed = await loadInitialReport(state, els);

  // A page in the hash wins over the report's first page, whatever the report
  // came from. This used to be read only when nothing loaded, so a link to
  // page four of a restored report opened page one.
  const wanted = pageFromHash();
  if (wanted) {
    const pages = reportOf(state.model || state.lastGood)?.pages || [];
    if (pages.some((p) => p.id === wanted)) state.page = wanted;
  }

  initialMode({
    fromUrl: claimed === 'url',
    documentChrome: reportOf(state.model)?.chrome || 'auto',
  });

  rerender(state, els);
  refreshLibrary(state, els);
  // The source pane starts on whichever tab the visitor last used, and the
  // Form tab has to be built rather than merely shown.
  showSourceTab(state, els, state.preferences.sourceTab || 'form');

  if (state.findings.length && state.preferences.showFindings) {
    showFindings(state, els, true);
  }

  const shortcuts = registerShortcuts({
    filter: () => { els.reportFilter?.focus(); },
    share: () => els.shareReport?.click(),
    export: () => els.exportReport?.click(),
    prev: () => stepPage(state, els, -1),
    next: () => stepPage(state, els, 1),
    toggleMode: () => {
      toggleMode();
      setPreference(state, 'readMode', mode() === 'read');
    },
  });
  if (shortcuts && shortcuts.deferred) {
    // The kit had not booted yet. One retry on load covers the slow path.
    window.addEventListener('load', () => registerShortcuts({
      filter: () => { els.reportFilter?.focus(); },
      share: () => els.shareReport?.click(),
      export: () => els.exportReport?.click(),
      prev: () => stepPage(state, els, -1),
      next: () => stepPage(state, els, 1),
      toggleMode: () => toggleMode(),
    }), { once: true });
  }

  // Another tab wrote a report. Refresh the list rather than the document:
  // overwriting what this tab has open would be the bug we are avoiding.
  onExternalChange(() => refreshLibrary(state, els));

  window.addEventListener('hashchange', () => {
    const id = pageFromHash();
    if (id && id !== state.page) {
      state.page = id;
      rerender(state, els);
    }
  });
}

/**
 * Where the first report comes from, in priority order.
 *
 * A URL payload wins because that is the whole point of a shared link. A
 * hosted document is next. Only then does this browser's own last report
 * load, and nothing at all is a real state with its own screen, distinct
 * from a document that failed to load.
 */
async function loadInitialReport(state, els) {
  if (loadFromUrl()) {
    let claimed = false;
    try {
      await loadFromUrlAsync((payload) => {
        if (!payload) return;
        // The transport hands over `{document, findings}`. Treating that as
        // the document itself is why a share link opened an empty page: the
        // wrapper has no title and no pages, and nothing said so.
        const doc = payload.document || payload;
        if (!doc) return;
        applyDocument(state, doc);
        if (Array.isArray(payload.findings) && payload.findings.length) {
          state.findings = [...payload.findings, ...state.findings];
        }
        state.fromUrl = true;
        claimed = true;
      });
    } catch {
      showToast('That link carried a report this page could not read.');
    }
    if (claimed) return 'url';
    // Say which failure it was. A link that did not work and a page with
    // nothing open are different situations and never share a message.
    showToast('That link carried no readable report. Nothing was opened.');
  }

  const lastId = state.preferences.lastReportId;
  if (lastId) {
    const record = await readReport(lastId);
    if (record && record.document) {
      applyDocument(state, record.document);
      state.reportId = lastId;
      return 'store';
    }
  }

  return 'none';
}

function pageFromHash() {
  const m = /^#\/(.+)$/.exec(location.hash || '');
  return m ? decodeURIComponent(m[1]) : null;
}

function stepPage(state, els, by) {
  const pages = reportOf(state.model || state.lastGood)?.pages || [];
  if (pages.length < 2) return false;
  const at = Math.max(0, pages.findIndex((p) => p.id === state.page));
  const next = pages[(at + by + pages.length) % pages.length];
  if (!next) return false;
  state.page = next.id;
  history.replaceState(null, '', `#/${encodeURIComponent(next.id)}`);
  rerender(state, els);
  return true;
}

export { applyText };
