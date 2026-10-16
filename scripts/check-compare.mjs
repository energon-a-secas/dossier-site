/**
 * Browser checks for the Compare view: building a comparison from files,
 * sections sync, stepping, the focus layout and the phone switcher, saving
 * and reopening, the Comparisons switcher (rename, delete, undo), the
 * bundled example, the empty column, and a view that fills the window with
 * the footer below the fold. The hostile report, SVG links and the frame
 * backstop are in scripts/check-compare-hostile.mjs, run at the end.
 *
 * Run against the dev server: `node scripts/check-compare.mjs`
 * (DOSSIER_URL overrides http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  base, file, watch, noOverflow, fillsWindow, focusOn, chooseFile, headingTop,
} from './compare-check-helpers.mjs';

const browser = await chromium.launch();
const errors = [];
await fs.mkdir(file('.verify'), { recursive: true });

try {
  // ── A new comparison, built from two files ─────────────────────────────────
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  watch(page, errors);
  // From the welcome screen: its button hides with it, so focus moves to the
  // Compare view's own header button, not to the one that leads back.
  await page.goto(`${base}/?check=compare`, { waitUntil: 'networkidle' });
  await page.locator('#welcome [data-action="view"][data-view="compare"]').click();
  await page.locator('#compareView .cmp-toolbar').waitFor();
  await page.waitForFunction(() => location.hash === '#/~compare');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'viewCompare', 'Entering Compare left focus behind');
  assert.equal(await page.locator('html').getAttribute('data-dossier-view'), 'compare');
  assert.equal(await page.locator('#viewCompare').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('#shell').isVisible(), false);
  assert.equal(await page.locator('#compareView .col').count(), 2);
  assert.equal(await page.locator('#compareView .col--empty').count(), 2);
  assert.match(await page.locator('#cmp-col-k1 .drop').innerText(), /Drop a report here/);
  // An empty column's who line is plain text, and it promises nothing about
  // differences before there is a report (design spec 7.3.11).
  assert.equal(await page.locator('#cmp-col-k1 .col__who').innerText(), 'Human, no report yet');
  assert.equal(await page.locator('#compareView .col--empty .col__who .role-name').count(), 0, 'An empty column inks its role word');
  assert.equal(await page.locator('#compareView .col--empty .col__diff').count(), 0, 'An empty column talks about differences');

  await chooseFile(page, 'k1', 'reports/compare/human-draft.html');
  await chooseFile(page, 'k2', 'reports/compare/agent-output.md');
  await page.waitForFunction(() => /^#\/~compare\/c-[a-z0-9]+$/.test(location.hash));
  const setRoute = await page.evaluate(() => location.hash);
  assert.match(await page.locator('#cmp-col-k1 .col__kind').innerText(), /HTML/);
  assert.match(await page.locator('#cmp-col-k2 .col__kind').innerText(), /Markdown/);
  assert.match(await page.locator('#cmp-col-k1 .col__stats').innerText(), /words/);
  // The human draft's own styling is gone in Dossier format: same typography.
  const fonts = await page.evaluate(() => ['k1', 'k2'].map((id) => getComputedStyle(document.querySelector(`#cmp-col-${id} .r-h2`)).fontFamily));
  assert.equal(fonts[0], fonts[1], 'Both columns read in one typeface');
  assert.equal(await page.locator('#cmp-col-k1 .reader').getByText('Payments platform: incident notes').count(), 0, 'Page chrome outside main was kept');
  await fillsWindow(page, '1440px');
  // The toolbar's title is chrome in the product's fixed serif: Display's
  // Typeface changes the reading text, not it.
  const faces = await page.evaluate(() => {
    const read = () => ({
      title: getComputedStyle(document.querySelector('.cmp-toolbar .set-title')).fontFamily,
      reader: getComputedStyle(document.querySelector('#cmp-col-k1 .reader')).fontFamily,
      serif: getComputedStyle(document.documentElement).getPropertyValue('--font-serif').trim(),
    });
    const before = read();
    document.documentElement.dataset.typeface = 'sans';
    const sans = read();
    delete document.documentElement.dataset.typeface;
    return { before, sans };
  });
  assert.equal(faces.sans.title, faces.before.title, 'The toolbar title followed the Typeface option');
  assert.notEqual(faces.sans.reader, faces.before.reader, 'The Typeface option did not reach the reading text');
  assert.equal(faces.before.title.replace(/\s/g, ''), faces.before.serif.replace(/\s/g, ''), 'The toolbar title is not in the product serif');

  // The skip link moves focus and adds no history entry for Back to undo.
  const historyBefore = await page.evaluate(() => history.length);
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'main', 'The skip link did not move focus');
  assert.equal(await page.evaluate(() => history.length), historyBefore, 'The skip link added a history entry');
  assert.equal(await page.locator('html').getAttribute('data-dossier-view'), 'compare');

  // ── Sections sync: A's third heading brings B's matching one along ─────────
  await page.locator('#cmp-col-k1 .col__scroll').hover();
  await page.evaluate(() => {
    const scroller = document.querySelector('#cmp-col-k1 .col__scroll');
    const third = scroller.querySelectorAll('.r-h')[2];
    scroller.scrollTop += third.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
  });
  await page.waitForTimeout(250);
  assert.equal(Math.round(await headingTop(page, 'k1', 'Customer impact')), 16);
  const impact = await headingTop(page, 'k2', 'Impact');
  const viewB = await page.locator('#cmp-col-k2 .col__scroll').evaluate((el) => el.clientHeight);
  assert.ok(impact > -24 && impact < viewB * 0.35, `B's "Impact" should be near the reading line, not at ${impact}px`);

  // With sync off, scrolling one column leaves the other where it was.
  await page.locator('select[data-change="cmp-sync"]').selectOption('off');
  const before = await page.locator('#cmp-col-k2 .col__scroll').evaluate((el) => el.scrollTop);
  await page.locator('#cmp-col-k1 .col__scroll').hover();
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#cmp-col-k2 .col__scroll').evaluate((el) => el.scrollTop), before, 'Sync off still moved B');
  await page.locator('select[data-change="cmp-sync"]').selectOption('sections');

  // With differences off, `]` steps to the next heading of the column being
  // read. (With them on it steps through changes: see the analysis checks.)
  await page.locator('.cmp-toolbar [data-action="cmp-toggle-diff"]').click();
  assert.equal(await page.locator('.cmp-toolbar [data-action="cmp-toggle-diff"]').getAttribute('aria-pressed'), 'false');
  await page.locator('#cmp-col-k1 .col__scroll').focus();
  const counterBefore = await page.locator('.counter__main').innerText();
  await page.keyboard.press(']');
  await page.waitForFunction((text) => document.querySelector('.counter__main').textContent !== text, counterBefore, { timeout: 3000 });
  // The counter counts headings (the stats line counts sections, a smaller
  // set) and is not a live region; the step itself is announced, once.
  assert.match(await page.locator('.counter__sub').innerText(), /headings in A/);
  assert.equal(await page.locator('.counter').getAttribute('aria-live'), null, 'The counter would be read out on every scroll');
  assert.match(await page.locator('#cmpLive').innerText(), /^Heading \d+ of \d+ in A: /);
  await page.locator('.cmp-toolbar [data-action="cmp-toggle-diff"]').click();
  await page.screenshot({ path: file('.verify/compare-1440.png') });

  // ── Focus layout from the column menu, and back ────────────────────────────
  await page.locator('#cmp-col-k2 .col__menu').click();
  assert.equal(await page.locator('#cmpColumnMenu').isVisible(), true);
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Edit source/, 'The menu takes focus');
  // The three render modes are one named group, so "Original layout" is heard
  // as a choice of "Show as".
  assert.equal(await page.locator('#cmpColumnMenu [role="group"][aria-label^="Show as"] [role="menuitemradio"]').count(), 3, 'The render modes are not one labelled group');
  await page.locator('#cmpColumnMenu [data-action="cmp-focus-col"]').click();
  assert.equal(await page.locator('#cmp-col-k1').isVisible(), false);
  assert.equal(await page.locator('#cmp-col-k2').isVisible(), true);
  assert.equal(await page.locator('.focus-switch [role="tab"]').count(), 2);
  await page.locator('.focus-switch [data-col="k1"]').click();
  assert.equal(await page.locator('#cmp-col-k1').isVisible(), true);
  assert.equal(await page.locator('#cmp-col-k2').isVisible(), false);
  // Under the tabs a column is the panel its tab names.
  assert.equal(await page.locator('#cmp-col-k1').getAttribute('role'), 'tabpanel');
  assert.equal(await page.locator('#cmp-col-k1').getAttribute('aria-labelledby'), 'cmp-tab-k1');
  await page.locator('.cmp-toolbar [data-action="cmp-layout"]').click();
  assert.equal(await page.locator('#cmp-col-k2').isVisible(), true);
  assert.equal(await page.locator('#cmp-col-k1').getAttribute('aria-labelledby'), 'cmp-col-k1-label');
  // "All columns" hides itself: focus goes to the column being read.
  await focusOn(page, '#cmp-col-k1 .col__menu', 'All columns dropped focus');

  // ── Original mode is a static frame: never scripts with same-origin ────────
  // B, read at its "Impact", keeps its place; A is rebuilt as a frame and
  // catches up with it instead of waiting at its top for the next scroll.
  await page.locator('#cmp-col-k2 .col__scroll').hover();
  await page.evaluate(() => {
    const scroller = document.querySelector('#cmp-col-k2 .col__scroll');
    const plain = (h) => { const c = h.cloneNode(true); c.querySelectorAll('.visually-hidden, del, .u-label, .cur-tag').forEach((e) => e.remove()); return c.textContent.trim(); };
    const impactB = [...scroller.querySelectorAll('.r-h')].find((h) => plain(h) === 'Impact');
    scroller.scrollTop += impactB.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
  });
  await page.waitForTimeout(250);
  await page.locator('.cmp-toolbar [data-action="cmp-set-mode"][data-value="original"]').click();
  await page.locator('#cmp-col-k1 .col__frame').waitFor();
  await page.waitForFunction(() => document.querySelector('#cmp-col-k1 .col__frame')?.contentWindow?.scrollY > 0, null, { timeout: 3000 });
  await page.waitForTimeout(150);
  const caught = await page.evaluate(() => {
    const frame = document.querySelector('#cmp-col-k1 .col__frame');
    const heading = [...frame.contentDocument.querySelectorAll('h1, h2, h3')].find((h) => h.textContent.trim() === 'Customer impact');
    return { top: heading.getBoundingClientRect().top, view: frame.contentWindow.innerHeight };
  });
  assert.ok(caught.top > -24 && caught.top < caught.view * 0.35, `A's frame did not catch up with B: its "Customer impact" is at ${caught.top}px`);
  assert.equal(await page.locator('#cmp-col-k1 .col__frame').getAttribute('sandbox'), 'allow-same-origin');
  assert.equal(await page.locator('#cmp-col-k2 .col__frame').count(), 0, 'Markdown has no original layout');
  // A frame read to its end keeps the wheel too: the page does not move.
  await page.locator('#cmp-col-k1 .col__frame').evaluate((f) => f.contentWindow.scrollTo(0, f.contentDocument.documentElement.scrollHeight));
  await page.locator('#cmp-col-k1 .col__frame').hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => scrollY), 0, 'A wheel past an Original frame\'s end scrolled the page');
  await page.locator('.cmp-toolbar [data-action="cmp-set-mode"][data-value="format"]').click();
  await page.locator('#cmp-col-k1 .col__scroll').waitFor();
  // The change is saved 400 ms after the click. A reload inside that wait
  // flushes it on pagehide, but IndexedDB does not always finish a write the
  // page started while unloading, so the reload waits for the save.
  await page.waitForTimeout(600);

  // ── Saved: a reload reopens the same comparison ────────────────────────────
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#cmp-col-k2 .col__scroll').waitFor();
  assert.equal(await page.evaluate(() => location.hash), setRoute);
  assert.equal(await page.locator('#compareView .col').count(), 2);
  // Leaving for Reports and coming back keeps each column where it was.
  await page.locator('#cmp-col-k1 .col__scroll').evaluate((el) => { el.scrollTop = 300; });
  await page.locator('#viewReports').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'reports');
  await page.locator('#viewCompare').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'compare');
  await page.waitForTimeout(100);
  assert.ok(Math.abs(await page.locator('#cmp-col-k1 .col__scroll').evaluate((el) => el.scrollTop) - 300) < 2, 'Scroll position was lost');
  assert.equal(await page.evaluate(() => location.hash), setRoute, 'Coming back changed the comparison');

  // `/` in Compare opens the Comparisons switcher at its filter.
  await page.locator('#cmpHeading').evaluate((el) => el.closest('#main')?.focus());
  await page.keyboard.press('/');
  await page.waitForFunction(() => document.activeElement?.id === 'cmpSwitcherFilter');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cmpSwitcher').isVisible(), false);

  // ── Rename, a second set, delete with undo ─────────────────────────────────
  await page.locator('.cmp-toolbar .set-title').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Checkout review');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.cmp-toolbar .set-title__text').innerText(), 'Checkout review');
  // Straight away, inside the save's 400 ms wait: the switcher writes the
  // waiting change before it reads the list, so the row has the new title.
  await page.locator('#cmpSwitcherBtn').click();
  // The list is read from storage first, then focus lands in the filter.
  await page.waitForFunction(() => document.activeElement?.id === 'cmpSwitcherFilter');
  assert.equal(await page.locator('#cmpSwitcher .sw__row.is-current .sw__title').innerText(), 'Checkout review', 'The switcher listed the old title');
  await page.locator('#cmpSwitcher [data-action="cmp-new-set"]').click();
  assert.equal(await page.locator('#compareView .col--empty').count(), 2);
  await chooseFile(page, 'k1', 'reports/compare/fixes.html');
  await page.waitForTimeout(600);
  await page.locator('#cmpSwitcherBtn').click();
  await page.waitForFunction(() => document.activeElement?.id === 'cmpSwitcherFilter');
  assert.equal(await page.locator('#cmpSwitcher .sw__row[data-set-id]').count(), 2);
  const target = page.locator('#cmpSwitcher .sw__row', { hasText: 'Checkout review' });
  await target.locator('[data-action="cmp-delete-set"]').click();
  await page.locator('#cmpToast').getByRole('button', { name: 'Undo' }).waitFor();
  assert.equal(await page.locator('#cmpSwitcher .sw__row[data-set-id]').count(), 1);
  await page.locator('#cmpToast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#cmpSwitcher .sw__row[data-set-id]').length === 2);
  // The Undo button takes itself away; focus lands on the comparison it brought back.
  await focusOn(page, '#cmpSwitcher .sw__row .sw__open', 'Undoing a deletion dropped focus');
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Checkout review/);
  // Rename from the switcher row.
  await page.locator('#cmpSwitcher .sw__row', { hasText: 'Checkout review' }).locator('[data-action="cmp-rename-row"]').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Checkout review, renamed');
  await page.keyboard.press('Enter');
  await page.locator('#cmpSwitcher .sw__title', { hasText: 'Checkout review, renamed' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cmpSwitcher').isVisible(), false);

  // Removing a column offers an undo.
  await page.locator('#cmp-col-k1 .col__menu').click();
  await page.locator('#cmpColumnMenu [data-action="cmp-remove"]').click();
  assert.equal(await page.locator('#cmp-col-k1').count(), 0);
  await page.locator('#cmpToast').getByRole('button', { name: 'Undo' }).click();
  await page.locator('#cmp-col-k1 .col__scroll').waitFor();
  await focusOn(page, '#cmp-col-k1 .col__menu', 'Undoing a removal dropped focus');

  // ── The bundled example, from the Open dialog ──────────────────────────────
  await page.locator('#openReport').click();
  await page.locator('#openExamples [data-action="cmp-example"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#compareView .col .reader').length === 3);
  assert.equal(await page.locator('.cmp-toolbar .set-title__text').innerText(), 'Illustrative example: checkout latency incident');
  assert.equal(await page.evaluate(() => location.hash), '#/~compare', 'The example is not saved until it is changed');
  assert.match(await page.locator('#cmp-col-k3 .col__who').innerText(), /Fixes to B/);
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    await noOverflow(page, `Example at ${width}px`);
  }
  // A phone shows one column at a time, chosen with the tabs.
  assert.equal(await page.locator('#compareView .col:visible').count(), 1);
  assert.equal(await page.locator('.focus-switch').isVisible(), true);
  await page.locator('.focus-switch [data-col="k2"]').click();
  assert.equal(await page.locator('#cmp-col-k2').isVisible(), true);
  assert.equal(await page.locator('#compareView .col:visible').count(), 1);
  // On a phone the columns are the tabs' panels whatever the layout says.
  assert.equal(await page.locator('#cmp-col-k2').getAttribute('aria-labelledby'), 'cmp-tab-k2');
  // Reading the example (a tab tap is a view change) does not save it.
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => location.hash), '#/~compare', 'Choosing a tab saved the example');
  const savedTitles = await page.evaluate(async () => (await (await import('/js/compare/store.js')).listSets()).map((item) => item.title));
  assert.ok(!savedTitles.includes('Illustrative example: checkout latency incident'), 'Choosing a tab saved a copy of the example');
  await fillsWindow(page, '390px');
  await page.locator('#cmpOptionsBtn').click();
  assert.equal(await page.locator('#cmpOptions').isVisible(), true);
  assert.equal(await page.locator('#cmpScrim').isVisible(), true, 'Options opens as a sheet over a scrim');
  // The sheet and its scrim start right under the 56 px bar, and the set's
  // title ends in an ellipsis inside the sheet (measured once it has slid in).
  const sheet = await page.evaluate(async () => {
    await Promise.all(document.getElementById('cmpOptions').getAnimations().map((animation) => animation.finished.catch(() => {})));
    const box = (el) => el.getBoundingClientRect();
    const title = document.querySelector('#cmpOptions .opt__title');
    return {
      header: box(document.querySelector('.header-bar')).bottom,
      top: box(document.getElementById('cmpOptions')).top,
      scrim: box(document.getElementById('cmpScrim')).top,
      right: box(title).right,
      limit: box(document.getElementById('cmpOptions')).right - parseFloat(getComputedStyle(document.getElementById('cmpOptions')).paddingRight),
    };
  });
  assert.equal(sheet.top, sheet.header, `The Options sheet starts at ${sheet.top}px, not under the bar at ${sheet.header}px`);
  assert.equal(sheet.scrim, sheet.header, `The scrim starts at ${sheet.scrim}px, not under the bar at ${sheet.header}px`);
  assert.ok(sheet.right <= sheet.limit + 0.5, `The set title in Options runs ${sheet.right - sheet.limit}px past the sheet's padding`);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cmpOptionsBtn');
  // A tap on the scrim closes the sheet too, and focus goes back the same way.
  await page.locator('#cmpOptionsBtn').click();
  await page.mouse.click(195, 800);
  assert.equal(await page.locator('#cmpOptions').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cmpOptionsBtn');
  await page.screenshot({ path: file('.verify/compare-390.png') });

  // ── Options on a wide screen: Tab past its end closes it ───────────────────
  await page.setViewportSize({ width: 1024, height: 844 });
  await page.locator('#cmpOptionsBtn').click();
  assert.equal(await page.locator('#cmpScrim').isVisible(), false, 'Options at 1024px is a popover, not a sheet');
  let closed = false;
  for (let i = 0; i < 12 && !closed; i += 1) {
    await page.keyboard.press('Tab');
    closed = !(await page.locator('#cmpOptions').isVisible());
    if (!closed) assert.ok(await page.evaluate(() => document.getElementById('cmpOptions').contains(document.activeElement)), 'Tab left Options while it stayed open');
  }
  assert.ok(closed, 'Tab never left Options');
  assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest('#compareView'))), 'Tab out of Options went past the comparison');
  assert.equal(await page.locator('#cmpOptionsBtn').getAttribute('aria-expanded'), 'false');
  // Shift+Tab before its first control lands on the Options button.
  await page.locator('#cmpOptionsBtn').click();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#cmpOptions').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cmpOptionsBtn');

  // ── A Dossier document in a column, pasted, then edited in place ───────────
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.cmp-toolbar [data-action="cmp-add-menu"]').click();
  await page.locator('#cmpAddMenu [data-action="cmp-add-column"][data-role="other"]').click();
  await page.locator('#cmp-col-k4 [data-action="cmp-paste"]').click();
  const incident = await fs.readFile(file('reports/incident.json'), 'utf8');
  await page.locator('#cmp-col-k4 textarea').fill(incident);
  await page.locator('#cmp-col-k4 form').getByRole('button', { name: 'Use this text' }).click();
  await page.locator('#cmp-col-k4 .reader--dossier .report-title').waitFor();
  assert.match(await page.locator('#cmp-col-k4 .col__kind').innerText(), /Dossier/);
  await page.waitForFunction(() => /^#\/~compare\/c-/.test(location.hash));
  const ids = await page.evaluate(() => {
    const all = [...document.querySelectorAll('[id]')].map((el) => el.id);
    return { dupes: all.filter((id, i) => all.indexOf(id) !== i), prefixed: [...document.querySelectorAll('#cmp-col-k4 .col__body [id]')].map((el) => el.id).filter((id) => !id.startsWith('cmp-k4-')) };
  });
  assert.deepEqual(ids.dupes, [], 'Two elements share an id');
  assert.deepEqual(ids.prefixed, [], 'A Dossier column wrote an id without its prefix');
  await page.locator('#cmp-col-k4 .col__menu').click();
  await page.locator('#cmpColumnMenu [data-action="cmp-edit-source"]').click();
  const edited = incident.replace(/"title":\s*"[^"]*"/, '"title": "Edited in the column"');
  await page.locator('#cmp-col-k4 textarea').fill(edited);
  await page.locator('#cmp-col-k4 form').getByRole('button', { name: 'Save' }).click();
  await page.locator('#cmp-col-k4 .report-title', { hasText: 'Edited in the column' }).waitFor();
  // A broken edit is refused in place, with the reason, and nothing is lost.
  await page.locator('#cmp-col-k4 .col__menu').click();
  await page.locator('#cmpColumnMenu [data-action="cmp-edit-source"]').click();
  await page.locator('#cmp-col-k4 textarea').fill('{"dossier": ');
  await page.locator('#cmp-col-k4 form').getByRole('button', { name: 'Save' }).click();
  await page.locator('#cmp-col-k4 .col-form__error').waitFor();
  await page.locator('#cmp-col-k4 form').getByRole('button', { name: 'Cancel' }).click();
  await page.locator('#cmp-col-k4 .report-title', { hasText: 'Edited in the column' }).waitFor();
  // A Dossier column's headings sit under its label (an h2), as an HTML or
  // Markdown column's do: the report title at level 3, its pages at 4.
  assert.equal(await page.locator('#cmp-col-k4 .report-title').getAttribute('aria-level'), '3');
  assert.deepEqual([...new Set(await page.locator('#cmp-col-k4 .report-page__head h2').evaluateAll((els) => els.map((el) => el.getAttribute('aria-level'))))], ['4']);

  // Move: the bodies are not drawn again, and their names follow the letters.
  await page.locator('#cmp-col-k4 .col__menu').click();
  await page.locator('#cmpColumnMenu [data-action="cmp-move"][data-dir="-1"]').click();
  assert.equal(await page.locator('#cmp-col-k4 .col__scroll').getAttribute('aria-label'), 'Column C text');
  assert.equal(await page.locator('#cmp-col-k3 .col__scroll').getAttribute('aria-label'), 'Column D text');

  // Four columns, so Add column is off: the phone's Options sheet still keeps Tab.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#cmpOptionsBtn').click();
  await page.locator('#cmpOptions').waitFor();
  assert.equal(await page.locator('#cmpOptions [data-action="cmp-add-menu"]').isDisabled(), true);
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press(key);
      const inside = await page.evaluate(() => {
        const active = document.activeElement;
        // The undo toast, while it shows, is part of the round.
        return document.getElementById('cmpOptions').contains(active) || document.getElementById('cmpToast').contains(active);
      });
      assert.ok(inside, `${key} ${i + 1} left the Options sheet with four columns`);
    }
  }
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── A comparison bundle given to the Open dialog opens in Compare ──────────
  await page.locator('#viewReports').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'reports');
  const bundle = {
    dossierCompare: {
      version: 1,
      title: 'Bundled comparison',
      columns: [
        { id: 'k1', role: 'human', label: 'Draft', source: { kind: 'markdown', name: 'a.md', text: '# A\n\n## Summary\n\nOne.' } },
        { id: 'k2', role: 'agent', label: 'Agent', source: { kind: 'text', name: 'b.txt', text: 'Two.' } },
      ],
    },
  };
  await page.locator('#openReport').click();
  await page.locator('#importText').fill(JSON.stringify(bundle));
  assert.match(await page.locator('#importDetected').innerText(), /comparison/i);
  await page.locator('#importDialog [data-action="import-confirm"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'compare');
  await page.locator('.cmp-toolbar .set-title__text', { hasText: 'Bundled comparison' }).waitFor();
  assert.equal(await page.locator('#compareView .col .reader').count(), 2);
  await page.waitForFunction(() => /^#\/~compare\/c-/.test(location.hash));

  await context.close();

  await checkHiddenStart();

  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: Compare entered from the welcome screen with focus on its own button, empty columns that say "Human, no report yet" in plain text and nothing about differences, a comparison built from an HTML and a Markdown file in one typeface, a view that fills the window under the header at 1440 and 390 with the footer below the fold, reachable, a toolbar that focus brings back from under the header, and a column that keeps the wheel at its end, a toolbar title in the fixed serif whatever the Typeface, a skip link with no history entry, sections sync and sync off, ] steps headings and announces them, focus layout and back with focus kept and the columns named by their tabs, Original as a static frame that catches up with the column being read and keeps the wheel at its end, saved and reopened at the same address, scroll kept across views, rename shown in the switcher at once, delete with undo, remove a column with undo (focus back on what returned), the bundled example unsaved even after a tab tap, a pasted Dossier document with prefixed ids and nested heading levels, an Edit source that refuses a broken document, Move renaming the bodies, the phone Options sheet keeping Tab with four columns, Options at 1024 closing when Tab leaves it, a comparison bundle from the Open dialog, no sideways scroll at 1440, 1024, 768 and 390, / opens the switcher, one column at a time on a phone with the Options sheet under the bar, its title inside it, closed by Escape or the scrim, and a comparison opened while the view was hidden counting its headings from the first one.');
} finally {
  await browser.close();
}

// The second area: untrusted HTML, in every mode and in both views.
await import('./check-compare-hostile.mjs');

/**
 * A comparison opened while the view is hidden (from the Reports view's Open
 * dialog, as the welcome screen's example card does) is drawn before it can
 * be measured. Its heading counter must start at the first heading, not say
 * "4 of 4" until the first scroll.
 */
async function checkHiddenStart() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  watch(page, errors);
  await page.goto(`${base}/?check=hidden-start`, { waitUntil: 'networkidle' });
  // The Open button does nothing until boot has wired it.
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-dossier-booting'));
  const sections = (name) => `# ${name}\n\n${['One', 'Two', 'Three'].map((h) => `## ${h}\n\n${'Words in a section. '.repeat(40)}`).join('\n\n')}`;
  const bundle = {
    dossierCompare: {
      version: 1,
      title: 'Opened while hidden',
      view: { diff: { on: false } },
      columns: [
        { id: 'k1', role: 'human', label: 'Draft', source: { kind: 'markdown', name: 'a.md', text: sections('A') } },
        { id: 'k2', role: 'agent', label: 'Agent', source: { kind: 'markdown', name: 'b.md', text: sections('B') } },
      ],
    },
  };
  await page.locator('#openReport').click();
  await page.locator('#importDialog').waitFor({ state: 'visible' });
  await page.locator('#importText').fill(JSON.stringify(bundle));
  await page.locator('#importDialog [data-action="import-confirm"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'compare');
  await page.waitForFunction(() => document.querySelectorAll('#compareView .col .reader').length === 2);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.cmp-toolbar [data-action="cmp-toggle-diff"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.counter__main').innerText(), '1 of 4', 'A comparison opened while hidden counted from its last heading');
  // The column under the pointer leads (the Open dialog's button was over B).
  assert.match(await page.locator('.counter__sub').innerText(), /^headings in [AB]$/);
  await context.close();
}
