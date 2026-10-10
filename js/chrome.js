/**
 * Chrome and keyboard: read mode, and the shortcuts this page claims.
 *
 * NeoKeys owns `H`, the `?` sheet, the `G` switcher and the WCAG 2.1.4 remap
 * panel. We register through it and never write `if (e.key === 'h')`: a bare
 * letter binding with no way to turn it off or move it is an accessibility
 * failure, and the kit's disable switch and rebind panel are the whole reason
 * the fleet is allowed single-key shortcuts at all.
 *
 * ── Why read mode is a separate attribute from the kit's ────────────────────
 *
 * The requirement is that the header starts hidden when a report is being
 * read, rather than authored. The obvious implementation is wrong twice:
 *
 *   - Setting `html[data-chrome="off"]` ourselves does not survive. The kit
 *     calls `chrome.restore()` at init, which paints `data-chrome` from the
 *     fleet-wide `neo_chrome` cookie, so our value is overwritten on every
 *     load where that cookie is absent or `on`.
 *   - Calling `NeoKeys.chrome.hide()` does survive, and writes the cookie,
 *     which is scoped to `.neorgon.com`. Opening one report here would hide
 *     the header on every other Neorgon site the visitor has open. A
 *     per-document view state must not become a fleet-wide preference.
 *
 * So read mode is ours: `html[data-dossier-mode="read"]`, set and cleared by
 * this module, never persisted to the kit's cookie. `H` keeps working as the
 * visitor's own preference and as the escape hatch out of either state.
 */

import { showToast } from './neorgon-dom.js';

const MODE_ATTR = 'dossierMode';
const CHROME_ATTR = 'dossierChrome';

/**
 * True while read mode, rather than the visitor, is the reason the header is
 * not on screen. Once the visitor presses H we stop deciding for them.
 */
let weHidTheHeader = false;

/** Read mode: the report fills the window and the page furniture steps back. */
export function setMode(mode) {
  const root = document.documentElement;
  const next = mode === 'read' ? 'read' : 'build';
  root.dataset[MODE_ATTR] = next;

  // Hide the header only while the visitor has not taken that decision over.
  if (next === 'read' && !hasVisitorOpinion()) {
    root.dataset[CHROME_ATTR] = 'hidden';
    weHidTheHeader = true;
  } else if (next === 'build' && weHidTheHeader) {
    delete root.dataset[CHROME_ATTR];
    weHidTheHeader = false;
  }

  document.dispatchEvent(new CustomEvent('dossier-mode', { detail: { mode: next } }));
  return next;
}

/** The visitor has pressed H at some point, so the header is theirs now. */
function hasVisitorOpinion() {
  return document.documentElement.dataset[CHROME_ATTR] === 'visitor';
}

/**
 * Hand the header back the moment the visitor asks for it.
 *
 * The awkward case this solves: read mode has hidden the header with our own
 * attribute while the kit still believes chrome is on. A press of H would
 * move the kit from on to off and fire `hidden: true`, so the header would
 * stay exactly as invisible as before and the key would feel broken. Two
 * presses would fix it, which is not an answer.
 *
 * So when that first press arrives, we drop our hide and ask the kit to show.
 * `chrome.show()` writes the fleet cookie, which is the one side effect we
 * were avoiding, but it only ever writes the value that reveals chrome and
 * never the value that hides it. Revealing furniture on another tab is a
 * harmless direction to be wrong in; hiding it is not.
 */
export function followVisitorChromeChoice() {
  document.addEventListener('neo-chrome', (e) => {
    const root = document.documentElement;
    const hidden = Boolean(e.detail && e.detail.hidden);

    // Deferred out of the event dispatch on purpose. The kit's `hide()` paints
    // first, which is what fires this event, and writes its cookie afterwards.
    // Calling `show()` from inside the handler therefore ran before that write
    // and was immediately overwritten: the header was visible and the stored
    // preference said hidden, so the next visit opened with the bar gone and a
    // toast explaining a choice the visitor never made. A microtask lets the
    // kit finish its own work before we react to it.
    queueMicrotask(() => {
      if (weHidTheHeader) {
        delete root.dataset[CHROME_ATTR];
        weHidTheHeader = false;
        if (hidden) {
          const chrome = window.NeoKeys && window.NeoKeys.chrome;
          if (chrome && typeof chrome.show === 'function') chrome.show();
        }
      }
      root.dataset[CHROME_ATTR] = 'visitor';
    });
  });
}

export function mode() {
  return document.documentElement.dataset[MODE_ATTR] === 'read' ? 'read' : 'build';
}

export function toggleMode() {
  const next = setMode(mode() === 'read' ? 'build' : 'read');
  showToast(next === 'read'
    ? 'Reading. R brings the editor back, H the header.'
    : 'Editing. R puts the editor away.');
  return next;
}

/**
 * A report that arrived in the URL is something to read, not something to
 * edit, so the page opens out of the way of it. An author who then wants the
 * editor presses one key, and the document itself can insist either way with
 * its own `chrome` field.
 */
export function initialMode({ fromUrl = false, documentChrome = 'auto' } = {}) {
  if (documentChrome === 'hidden') return setMode('read');
  if (documentChrome === 'shown') return setMode('build');
  return setMode(fromUrl ? 'read' : 'build');
}

/**
 * Register this page's shortcuts with the kit.
 *
 * The keys are the fleet's conventional ones, with their conventional
 * meanings, which is why the kit warns about them rather than refusing them:
 * `/` focuses the filter, `s` shares, `e` exports. `[` and `]` are previous
 * and next in a series, which here is the report's pages. `r` is the one
 * site-specific binding and it is not reserved or conventional.
 *
 * `h`, `g` and `?` belong to the kit. Asking for them is refused with a
 * console warning, which is how the fleet stops an eighth site reinventing H.
 *
 * @param {Record<string, () => unknown>} actions
 */
export function registerShortcuts(actions) {
  const keys = window.NeoKeys;
  if (!keys || typeof keys.register !== 'function') {
    // The kit boots as a module and may not have run yet. The caller retries
    // on load; a page with no shortcuts still works, so this is not an error.
    return { accepted: [], rejected: [], deferred: true };
  }

  const defs = [
    { key: '/', label: 'Filter this report', hint: 'Find a page, a block or a finding', run: actions.filter },
    { key: 's', label: 'Copy a share link', hint: 'The report travels inside the link', run: actions.share },
    { key: 'e', label: 'Export', hint: 'A file that opens with no account and no network', run: actions.export },
    { key: '[', label: 'Previous page', run: actions.prev },
    { key: ']', label: 'Next page', run: actions.next },
    { key: 'r', label: 'Read or edit', hint: 'Put the editor away, or bring it back', run: actions.toggleMode },
  ].filter((d) => typeof d.run === 'function');

  return keys.register(defs);
}

/**
 * Keep NeoKeys honest about our text surfaces. The kit already treats inputs,
 * textareas, selects and contenteditable as typing targets, so a bare letter
 * never fires mid-word. This adds anything of ours that is a text surface
 * without being one of those elements.
 */
export function guardTypingSurfaces() {
  const keys = window.NeoKeys;
  if (keys && typeof keys.setTypingSelector === 'function') {
    keys.setTypingSelector('.ds-editor, [data-text-surface]');
  }
}
