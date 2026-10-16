/**
 * Browser regressions for the first moments of a page: what is painted
 * before and while the app boots. Run by scripts/check-workspace.mjs, which
 * owns the browser; the frame recorder and first-paint check are shared with
 * it.
 *
 * The rule under test: the shell (report bar, rail, an empty report) is never
 * on screen before boot has rendered once, however slow the connection, and a
 * boot whose code cannot load says so instead of revealing a shell whose
 * controls are dead.
 */
import assert from 'node:assert/strict';

/**
 * Record every animation frame from navigation: how many header bars are
 * painted, and whether an empty report shell (the old build skeleton) or a
 * second toolbar is on screen. Installed before any page script runs.
 *
 * It also records every stylesheet or script element that fails to load. A
 * shell on screen during boot is either a boot bug or a page whose
 * css/shell.css never arrived (a request the dev server dropped), and the
 * failure message has to say which.
 */
export function recordFrames() {
  const frames = [];
  window.__dossierFrames = frames;
  const failed = [];
  window.__dossierLoadFailures = failed;
  window.addEventListener('error', (event) => {
    const el = event.target;
    if (el instanceof HTMLLinkElement || el instanceof HTMLScriptElement) {
      failed.push({ t: Math.round(performance.now()), url: el.href || el.src || el.outerHTML.slice(0, 120) });
    }
  }, true);
  const shown = (el) => Boolean(el) && el.getClientRects().length > 0
    && getComputedStyle(el).visibility !== 'hidden';
  const tick = () => {
    const shell = document.getElementById('shell');
    const stage = document.getElementById('stage');
    frames.push({
      t: Math.round(performance.now()),
      bars: [...document.querySelectorAll('.header-bar, .ds-workbar')].filter(shown).length,
      skeleton: shown(shell) && Boolean(stage) && stage.childElementCount === 0,
      editor: document.documentElement.dataset.dossierMode === 'read' && shown(document.getElementById('sourcePane')),
    });
    if (performance.now() < 3000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export async function checkFirstPaint(target, label) {
  await target.waitForFunction(() => (window.__dossierFrames || []).some((f) => f.t > 1500));
  const frames = await target.evaluate(() => window.__dossierFrames);
  const why = loadReport(await target.evaluate(loadFailures));
  assert.ok(frames.length > 5, `${label}: too few frames sampled`);
  const two = frames.find((f) => f.bars > 1);
  assert.equal(two, undefined, `${label}: a frame at ${two?.t} ms painted two header bars${why}`);
  const skeleton = frames.find((f) => f.skeleton);
  assert.equal(skeleton, undefined, `${label}: a frame at ${skeleton?.t} ms showed an empty report shell${why}`);
  const editor = frames.find((f) => f.editor);
  assert.equal(editor, undefined, `${label}: a frame at ${editor?.t} ms showed the editor in read mode${why}`);
  assert.equal(frames.at(-1).bars, 1, `${label}: the header is not on screen after boot${why}`);
}

/**
 * In the page: the load failures of this origin the recorder saw, and every
 * stylesheet of this origin with no rules now (Chromium gives a link whose
 * load failed an empty sheet). Other origins (the fleet CDN) are not this
 * check's concern.
 */
function loadFailures() {
  const own = (href) => {
    try { return new URL(href).origin === location.origin; } catch { return false; }
  };
  return {
    failed: (window.__dossierLoadFailures || []).filter((f) => own(f.url)),
    unstyled: [...document.querySelectorAll('link[rel="stylesheet"]')]
      .filter((link) => {
        if (!own(link.href)) return false;
        try { return !link.sheet || link.sheet.cssRules.length === 0; } catch { return true; }
      })
      .map((link) => new URL(link.href).pathname),
  };
}

/**
 * The clause a first-paint failure ends with: what did not load, or that
 * all of it did, so a failure says whether the page or the server is at fault.
 */
function loadReport({ failed, unstyled }) {
  if (!failed.length && !unstyled.length) return '. Every stylesheet and script from this server loaded.';
  const parts = [];
  if (failed.length) parts.push(`failed to load: ${failed.map((f) => `${f.url} at ${f.t} ms`).join(', ')}`);
  if (unstyled.length) parts.push(`stylesheets with no rules: ${unstyled.join(', ')}`);
  return `. A request to the server failed, so the page ran without its own files (${parts.join('; ')}).`;
}

/**
 * A slow boot says Loading and a boot whose code cannot load says so; neither
 * reveals the shell, and no time limit does either.
 *
 * @param {{browser: import('playwright').Browser, base: string, errors: string[]}} opts
 */
export async function checkBoot({ browser, base, errors }) {
  const slowContext = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  const slow = await slowContext.newPage();
  slow.on('pageerror', (error) => errors.push(error.message));
  await slow.addInitScript(recordFrames);
  await slow.route('**/js/app.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await route.continue();
  });
  await slow.goto(`${base}/?check=slow`, { waitUntil: 'commit' });
  await slow.locator('#bootStatus').filter({ hasText: 'Loading' }).waitFor({ timeout: 3000 });
  assert.equal(await slow.locator('#shell').isVisible(), false, 'A slow boot showed the shell');
  assert.equal(await slow.locator('#welcome').isVisible(), false, 'A slow boot showed the welcome screen before boot');
  await slow.locator('#welcome').waitFor({ state: 'visible' });
  await checkFirstPaint(slow, 'Slow boot');
  assert.equal(await slow.locator('#bootStatus').isVisible(), false, 'The Loading line stayed after boot');
  const broken = await slowContext.newPage();
  await broken.route('**/js/open.js', (route) => route.abort());
  await broken.goto(`${base}/?check=broken`, { waitUntil: 'commit' });
  await broken.locator('#bootStatus').filter({ hasText: 'did not finish loading' }).waitFor({ timeout: 4000 });
  assert.equal(await broken.locator('html').getAttribute('data-dossier-loading'), 'failed');
  assert.equal(await broken.locator('#shell').isVisible(), false, 'A failed boot revealed a dead shell');
  assert.equal(await broken.locator('#welcome').isVisible(), false, 'A failed boot revealed a dead welcome screen');
  await slowContext.close();
}
