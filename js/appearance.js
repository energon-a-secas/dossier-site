/*
 * Runs in <head>, before the first paint. A classic script on purpose: an ES
 * module is deferred, and anything decided after the first paint is a flash.
 * External rather than inline, so the page policy needs no new hash.
 *
 * Two jobs, both read from storage and the address only:
 *
 * 1. Colour. `html[data-appearance]` is the resolved light or dark palette and
 *    `html[data-appearance-pref]` the visitor's choice: system, light or dark.
 *    js/display.js changes the choice by dispatching `dossier-appearance`.
 *    "System" is stored as no value, so an older stored "light" or "dark"
 *    still reads the same.
 *
 * 2. The shape of the workspace, so the first frame is already the right one:
 *    `data-dossier-view` (reports or compare), `data-dossier-mode` (read or
 *    build) and `data-dossier-booting`, which keeps the shell out of sight
 *    until js/boot.js has rendered once. Without it the first frame was an
 *    empty editor skeleton that the report then replaced.
 *
 *    No timer ever reveals the shell. An earlier 8 s fallback could not tell a
 *    slow connection from a broken one and showed an empty "Nothing open"
 *    shell for seconds while the modules were still arriving. Instead a boot
 *    that takes a while says so (`data-dossier-loading="slow"`, the
 *    `#bootStatus` line), and only a real failure to load the app's code says
 *    that (`"failed"`). Neither shows the shell: without its modules every
 *    control in it is dead.
 *
 * Do not use `data-theme` here: that is the Header Kit's visitor palette.
 */
(() => {
  const root = document.documentElement;
  const APPEARANCE_KEY = 'dossier-site:appearance';
  const PREFERENCES_KEY = 'dossier-site:preferences';
  // A boot still running after this long gets a visible "Loading" line.
  const SLOW_BOOT_MS = 900;

  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = (value) => (value === 'light' || value === 'dark' ? value : 'system');

  let preference = 'system';
  try { preference = valid(localStorage.getItem(APPEARANCE_KEY)); } catch { /* Session-only choice. */ }

  function apply() {
    const dark = preference === 'dark' || (preference === 'system' && system.matches);
    root.dataset.appearance = dark ? 'dark' : 'light';
    root.dataset.appearancePref = preference;
  }

  function choose(next) {
    preference = valid(next);
    try {
      if (preference === 'system') localStorage.removeItem(APPEARANCE_KEY);
      else localStorage.setItem(APPEARANCE_KEY, preference);
    } catch { /* Keep the session choice. */ }
    apply();
  }

  /** Mirrors js/router.js and js/share.js, which are modules and not loaded yet. */
  function shapeWorkspace() {
    const raw = String(location.hash || '').replace(/^#/, '');
    let route = raw;
    try { route = decodeURIComponent(raw); } catch { /* Keep the raw hash. */ }
    const comparison = /^dc=/.test(raw) || /^\/~compare(\/|$)/.test(route);
    const sharedReport = /^(dz|d1)=/.test(raw) || /^v1:(dz|d1):/.test(raw)
      || /[?&]src=/.test(location.search);

    let readMode = true;
    try {
      const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || 'null');
      if (saved && saved.data && saved.data.readMode === false) readMode = false;
    } catch { /* No stored preference: read mode. */ }

    root.dataset.dossierView = comparison ? 'compare' : 'reports';
    root.dataset.dossierMode = sharedReport || readMode ? 'read' : 'build';
    root.dataset.dossierBooting = '';
  }

  // ── A boot that is slow, or that cannot happen ────────────────────────────
  //
  // js/boot.js marks the attribute "started" when it runs and removes it, and
  // `data-dossier-loading`, when it is done, however long a link takes.

  const booting = () => 'dossierBooting' in root.dataset;

  function bootStatus(kind, text) {
    if (!booting()) return;
    root.dataset.dossierLoading = kind;
    const line = document.getElementById('bootStatus');
    if (line) line.textContent = text;
  }

  function watchBoot() {
    setTimeout(() => {
      if (booting() && root.dataset.dossierLoading !== 'failed') bootStatus('slow', 'Loading Dossier…');
    }, SLOW_BOOT_MS);

    // A module that fails to fetch, anywhere in the import graph, fires
    // `error` on its <script type="module"> element; a module that throws
    // while it is evaluated reports an ErrorEvent naming its own file. Either
    // before boot started means boot never will. Errors from the classic
    // scripts (the kits, this file) and from other origins are not ours to
    // judge, and an error after boot started is boot's to show.
    window.addEventListener('error', (event) => {
      if (root.dataset.dossierBooting !== '') return;
      const target = event.target;
      let ours = false;
      if (target instanceof HTMLScriptElement) {
        ours = target.type === 'module';
      } else if (event instanceof ErrorEvent && event.filename) {
        const classic = [...document.querySelectorAll('script[src]:not([type="module"])')].map((s) => s.src);
        ours = event.filename.startsWith(`${location.origin}/js/`) && !classic.includes(event.filename);
      }
      if (ours) bootStatus('failed', 'Dossier did not finish loading. Reload the page to try again.');
    }, true);
  }

  shapeWorkspace();
  watchBoot();
  apply();

  document.addEventListener('dossier-appearance', (event) => choose(event.detail && event.detail.preference));
  system.addEventListener('change', apply);
  window.addEventListener('storage', (event) => {
    if (event.key !== APPEARANCE_KEY && event.key !== null) return;
    preference = valid(event.key === null ? null : event.newValue);
    apply();
  });
})();
