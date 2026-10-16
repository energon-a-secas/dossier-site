/**
 * The workspace's own state on <html>: mode, view and rail, plus the keyboard
 * shortcuts.
 *
 * The page has one header, the fleet Header Kit bar, and `H` belongs to
 * NeoKeys alone: it hides and shows that bar, and nothing here reacts to it.
 * An earlier build hid the kit bar behind a second, site-made toolbar and
 * handed it back on the first H press, which showed two bars on load and a
 * "Chrome hidden" toast at the moment the bar appeared.
 *
 *   html[data-dossier-mode]   read | build   the editor pane is shown in build
 *   html[data-dossier-view]   reports | compare
 *   html[data-dossier-rail]   open | closed  saved reports and the outline
 *
 * js/appearance.js writes the first two before the first paint, from the
 * address and the stored preference, so the first frame has the right shape.
 *
 * Also here: the rail's small behaviours (a cut outline link's title, the
 * filter's key hint) and opening a report's closed disclosures for print.
 *
 * NeoKeys owns `H`, the `?` sheet, the `G` switcher and the WCAG 2.1.4 remap
 * panel. We register through it and never write `if (e.key === 'h')`: a bare
 * letter binding with no way to turn it off or move it is an accessibility
 * failure, and the kit's disable switch and rebind panel are the whole reason
 * the fleet is allowed single-key shortcuts at all.
 */

import { showToast } from './neorgon-dom.js';

const root = () => document.documentElement;

// ── Mode ─────────────────────────────────────────────────────────────────────

/** Read mode: the report has the window. Build mode adds the editor pane. */
export function setMode(mode) {
  const next = mode === 'read' ? 'read' : 'build';
  root().dataset.dossierMode = next;
  document.dispatchEvent(new CustomEvent('dossier-mode', { detail: { mode: next } }));
  return next;
}

export function mode() {
  return root().dataset.dossierMode === 'read' ? 'read' : 'build';
}

/**
 * Switch between reading and editing. Only a key press gets a toast: a click
 * already changed the button the reader is looking at, and a toast that names
 * a key means nothing on a touch screen.
 */
export function toggleMode({ viaKey = false } = {}) {
  const next = setMode(mode() === 'read' ? 'build' : 'read');
  if (viaKey) showToast(next === 'read' ? 'Reading. R opens the editor again.' : 'Editing. R puts the editor away.');
  return next;
}

/**
 * The mode a newly opened report starts in. The document's own `chrome` field
 * can insist: `hidden` opens it for reading, `shown` opens it in the editor,
 * and `auto` (or no field) leaves it to the reader's last choice. A report
 * that arrived in a link opens for reading unless the document says otherwise.
 */
export function initialMode({ preferRead = true, documentChrome = 'auto' } = {}) {
  if (documentChrome === 'hidden') return setMode('read');
  if (documentChrome === 'shown') return setMode('build');
  return setMode(preferRead ? 'read' : 'build');
}

// ── View ─────────────────────────────────────────────────────────────────────

/**
 * Reports or Compare. Marks the matching header button as the current page
 * and tells the views (`dossier-view`), which show and hide themselves.
 */
export function setView(view) {
  const next = view === 'compare' ? 'compare' : 'reports';
  const previous = root().dataset.dossierView;
  root().dataset.dossierView = next;
  for (const button of document.querySelectorAll('.header-actions [data-action="view"]')) {
    if (button.dataset.view === next) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  document.dispatchEvent(new CustomEvent('dossier-view', { detail: { view: next, previous } }));
  return next;
}

export function view() {
  return root().dataset.dossierView === 'compare' ? 'compare' : 'reports';
}

// ── Rail ─────────────────────────────────────────────────────────────────────

/**
 * Wide enough to dock the rail beside the report (and the editor). Narrower,
 * the rail opens as a drawer over the report and always starts closed, so a
 * stored "open" never covers the report on a laptop or a phone.
 */
const DOCKED = '(min-width: 1280px)';

export function railDocked() {
  return window.matchMedia(DOCKED).matches;
}

export function railOpen() {
  return root().dataset.dossierRail === 'open';
}

/**
 * @param {boolean} open
 * @param {{focus?: boolean}} [opts] focus moves into a drawer that opens and
 *   back to the toggle when it closes; a docked rail leaves focus alone
 */
export function setRail(open, { focus = false } = {}) {
  root().dataset.dossierRail = open ? 'open' : 'closed';
  for (const toggle of document.querySelectorAll('[data-action="toggle-rail"][aria-controls="rail"]')) {
    toggle.setAttribute('aria-expanded', String(Boolean(open)));
  }
  if (!focus) return;
  if (open) {
    document.getElementById('reportFilter')?.focus();
  } else {
    document.getElementById('toggleRail')?.focus({ preventScroll: true });
  }
}

/**
 * Where the rail starts. A shared link opens closed: its reader came for
 * that one report. Otherwise a docked rail follows the stored choice and is
 * open when there is none.
 */
export function initialRail({ fromLink = false, preference = null } = {}) {
  setRail(!fromLink && railDocked() && preference !== false);
}

/**
 * Keep the rail sensible across a resize: leaving the docked width closes the
 * drawer it would become, and reaching it restores the stored choice. An
 * outline link cut short by the rail's width shows its full text as a title.
 *
 * @param {() => boolean|null} preference the stored `railOpen`
 */
export function followRailWidth(preference) {
  titleCutLinks(document.getElementById('rail'));
  const mq = window.matchMedia(DOCKED);
  mq.addEventListener('change', () => {
    if (mq.matches) setRail(preference() !== false);
    else setRail(false);
  });
  // Escape closes the drawer, never a docked rail, which is page layout.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || railDocked() || !railOpen() || event.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    setRail(false, { focus: true });
  });
}

/**
 * A heading longer than the rail is wide ends in an ellipsis (css/shell.css,
 * the outline). Its full text goes in a title when the pointer or focus
 * reaches the link, and only on a link that is actually cut, so the tooltip
 * follows the rail's width and never repeats text that is already shown.
 * The outline is rebuilt on every render (js/pipeline.js), which is why this
 * listens on the rail rather than setting titles on the links.
 */
function titleCutLinks(rail) {
  if (!rail) return;
  const update = (event) => {
    const link = event.target instanceof Element ? event.target.closest('.ds-outline a') : null;
    if (!link) return;
    if (link.scrollWidth > link.clientWidth + 1) link.title = link.textContent.trim();
    else link.removeAttribute('title');
  };
  rail.addEventListener('pointerover', update);
  rail.addEventListener('focusin', update);
}

// ── Footer ───────────────────────────────────────────────────────────────────

/**
 * Publish the footer's height as `--ds-footer-h` on <html>. The sticky rail
 * and side column take it off their height (css/shell.css --ds-pane-cut, which
 * grows to it while the footer scrolls into view) so that at the end of the
 * page they still fit above the footer and keep their headings in the
 * window. The footer belongs to the kit and its height is the kit's (and the
 * site may tune its padding), so it is measured rather than assumed.
 */
export function followFooterHeight() {
  const footer = document.querySelector('.neo-footer');
  if (!footer) return;
  const write = () => {
    const height = Math.ceil(footer.getBoundingClientRect().height);
    if (height > 0) root().style.setProperty('--ds-footer-h', `${height}px`);
  };
  write();
  if (typeof ResizeObserver === 'function') new ResizeObserver(write).observe(footer);
}

// ── Shortcuts ────────────────────────────────────────────────────────────────

/** The key that focuses the rail's filter, unless the visitor remaps it. */
const FILTER_KEY = '/';

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
    { key: FILTER_KEY, label: 'Find a saved report', hint: 'Opens the side panel first if it is closed', run: actions.filter },
    { key: 's', label: 'Copy a share link', hint: 'The report travels inside the link', run: actions.share },
    { key: 'e', label: 'Share and export', hint: 'A link, one HTML file, JSON, YAML, print or a deck', run: actions.export },
    { key: '[', label: 'Previous page', run: actions.prev },
    { key: ']', label: 'Next page', run: actions.next },
    { key: 'r', label: 'Edit or done', hint: 'Open the editor, or put it away', run: actions.toggleMode },
  ].filter((d) => typeof d.run === 'function');

  const result = keys.register(defs);
  showFilterKey(keys);
  if (typeof keys.onChange === 'function') keys.onChange(() => showFilterKey(keys));
  return result;
}

/**
 * The key hint inside the rail's filter says the key that focuses it now:
 * the visitor can remap it or turn single-key shortcuts off in the kit's
 * panel (WCAG 2.1.4), and a hint naming a dead key would be wrong. The hint
 * is decoration (aria-hidden); the field's aria-keyshortcuts carries it.
 */
function showFilterKey(keys) {
  const hint = document.getElementById('reportFilterKey');
  const field = document.getElementById('reportFilter');
  if (!hint || !field) return;
  const entry = (keys.list?.() || []).find((e) => e.owner === 'site' && e.defaultKey === FILTER_KEY);
  const key = entry && !keys.isDisabled?.() ? (keys.activeKey?.(entry) || entry.key) : '';
  hint.textContent = key;
  hint.hidden = !key;
  if (key) field.setAttribute('aria-keyshortcuts', key);
  else field.removeAttribute('aria-keyshortcuts');
}

// ── Print ────────────────────────────────────────────────────────────────────

/**
 * A closed disclosure prints open: on paper nobody can open it. Chromium
 * keeps a closed <details> element's content in a slot that the print
 * stylesheet cannot reach with `details > *` (css/shell.css keeps that rule,
 * and a `::details-content` one, as the fallback), so every closed disclosure
 * in a report is opened just before printing and closed again afterwards.
 * Only a report's: the editor's form sections build themselves when opened.
 * Installed when this module loads, because a reader can print at any time,
 * boot included.
 */
const openedForPrint = new Set();

function openDisclosuresForPrint() {
  for (const details of document.querySelectorAll('.report-shell details:not([open])')) {
    details.open = true;
    openedForPrint.add(details);
  }
}

function closeDisclosuresAfterPrint() {
  for (const details of openedForPrint) details.open = false;
  openedForPrint.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', openDisclosuresForPrint);
  window.addEventListener('afterprint', closeDisclosuresAfterPrint);
}
