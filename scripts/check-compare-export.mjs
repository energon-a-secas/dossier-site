/**
 * Browser checks for the Compare view's analysis, part two (part one is
 * scripts/check-compare-analysis.mjs): every way a comparison leaves the
 * browser, opened again. The Share and export choices, the `#dc=` link, the
 * one-file export opened with the network cut (marks, steps to the last
 * change, sync, the review, no request) and at phone width (the counter and
 * the buttons act on the column shown), the bundle round trip, and a link
 * too long to offer. Also a panel open while the window crosses 700 px (the
 * sheet, Escape, focus, and back), the Review sheet keeping Tab on a phone,
 * and a Dossier column that cannot be read, as the base and as another
 * column: left out of the differences with a notice, never redrawn for good.
 *
 * Run against the dev server: `node scripts/check-compare-export.mjs`
 * (DOSSIER_URL overrides http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  base, verify, watch, noOverflow, focusOn, openExample,
} from './analysis-check-helpers.mjs';

const browser = await chromium.launch();
const errors = [];

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  watch(errors, page);
  await page.goto(`${base}/?check=export`, { waitUntil: 'networkidle' });
  await openExample(page);
  // The review part one enters by hand, entered here at once: marks, the
  // preferred report, a note and a summary, and one mark made while blind.
  await page.evaluate(async () => {
    const { api } = await import('/js/compare/index.js');
    const { setView } = await import('/js/compare/model.js');
    const r = await import('/js/compare/review-model.js');
    let s = api.compare.set;
    for (const [col, mark] of [['k1', 'strong'], ['k2', 'weak'], ['k3', 'strong']]) s = r.setMark(s, 'accuracy', col, mark);
    s = r.setSummary(r.setNote(r.setPreferred(s, 'k3'), 'k2', 'Wrong trigger and an inflated latency figure.'), 'Ship C.');
    s = r.setMark(setView(s, { blind: true }), 'completeness', 'k1', 'weak');
    api.commit(setView(s, { blind: false }));
  });
  await page.waitForFunction(() => /^#\/~compare\/c-/.test(location.hash));

  // ── Share and export in Compare ──────────────────────────────────────────
  // The file starts on the column whose changes the counter shows: C, read last.
  await page.locator('#cmp-col-k3 .col__scroll').focus();
  await page.waitForFunction(() => document.querySelector('.counter__sub')?.textContent === 'in C');
  await page.locator('#shareReport').click();
  const choices = await page.locator('#exportBody .ds-export__choice').evaluateAll((list) => list.map((b) => [b.dataset.action, b.disabled]));
  assert.deepEqual(choices, [['cmp-share-link', false], ['cmp-export-html', false], ['cmp-export-bundle', false], ['cmp-export-review', false]]);
  await page.locator('[data-action="cmp-share-link"]').click();
  await page.waitForTimeout(300);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(link, /#dc=[A-Za-z0-9_-]+$/);

  await page.locator('#shareReport').click();
  const [htmlDownload] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="cmp-export-html"]').click()]);
  const exported = path.join(verify, 'compare-export.html');
  await htmlDownload.saveAs(exported);
  const file = await fs.readFile(exported, 'utf8');
  assert.match(file, /Too different from B to mark word by word/);
  assert.match(file, /<b>Removed from B:<\/b>/);
  assert.ok(!file.includes('data-base-ref'), 'The file keeps the hook that renames the base on screen');
  assert.ok(!file.includes('Turn on Word marks'), 'The file points at a Word marks button it does not have');
  await page.locator('#shareReport').click();
  const [bundleDownload] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="cmp-export-bundle"]').click()]);
  assert.match(bundleDownload.suggestedFilename(), /\.dossier-compare\.json$/);
  const bundleFile = path.join(verify, 'compare.dossier-compare.json');
  await bundleDownload.saveAs(bundleFile);
  const before = await page.evaluate(async () => {
    const { compare } = await import('/js/compare/index.js');
    const { toBundle } = await import('/js/compare/records.js');
    return toBundle(compare.set);
  });

  // The file opens with the network cut, still syncs and still steps.
  const offline = await browser.newContext({ viewport: { width: 1440, height: 900 }, offline: true });
  const op = await offline.newPage();
  watch(errors, op, 'export: ');
  const requests = [];
  op.on('request', (req) => { if (!req.url().startsWith('file:') && !req.url().startsWith('data:') && req.url() !== 'about:srcdoc') requests.push(req.url()); });
  await op.goto(pathToFileURL(exported).href);
  await op.waitForTimeout(500);
  assert.equal(await op.locator('#compareView .col').count(), 3);
  assert.ok(await op.locator('#compareView ins').count() > 3, 'The marks travel in the file');
  assert.match(await op.locator('#xCounter .counter__main').innerText(), /^\d+ of \d+$/, 'The file runs its script');
  assert.equal(await op.locator('iframe').count(), 0);
  await op.locator('#xNext').click();
  await op.waitForTimeout(200);
  await op.locator('#xNext').click();
  await op.waitForTimeout(300);
  assert.equal(await op.locator('.counter__sub').innerText(), 'in C');
  assert.ok(await op.locator('[data-col="k3"] .col__scroll').evaluate((el) => el.scrollTop) > 0, 'Next moved C');
  // ] reaches the last change in the file too, and says so past it.
  const fileTotal = await op.locator('[data-col="k3"] [data-chg]').count();
  await op.locator('[data-col="k3"] .col__scroll').focus();
  for (let i = 0; i < fileTotal + 1; i += 1) {
    await op.keyboard.press(']');
    await op.waitForTimeout(80);
  }
  assert.equal(await op.locator('#xCounter .counter__main').innerText(), `${fileTotal} of ${fileTotal}`, '] reaches the last change in the file');
  assert.equal(await op.locator('#xLive').innerText(), 'That was the last change in C.');
  await op.keyboard.press('[');
  await op.waitForTimeout(80);
  assert.equal(await op.locator('#xCounter .counter__main').innerText(), `${fileTotal - 1} of ${fileTotal}`);
  await op.locator('[data-col="k2"] .col__scroll').hover();
  await op.locator('[data-col="k2"] .col__scroll').evaluate((el) => { el.scrollTop = 600; });
  await op.waitForTimeout(300);
  const followed = await op.locator('[data-col="k3"] .col__scroll').evaluate((el) => el.scrollTop);
  assert.ok(followed > 200, `C did not follow B in the file (${followed})`);
  await op.locator('#xReview').click();
  assert.match(await op.locator('#xPanel').innerText(), /Recorded while blind[\s\S]*Wrong trigger/);
  assert.deepEqual(requests, [], 'The exported file asked the network for something');
  await offline.close();

  // On a phone the file shows one column, and the counter and the buttons
  // act on that one: they used to act on C, the column the counter showed
  // on the desktop it was made on, whichever tab was shown.
  const small = await browser.newContext({ viewport: { width: 390, height: 844 }, offline: true });
  const sp = await small.newPage();
  watch(errors, sp, 'export at 390: ');
  await sp.goto(pathToFileURL(exported).href);
  await sp.waitForTimeout(300);
  assert.equal(await sp.locator('.counter__sub').innerText(), `in ${await sp.locator('#compareView .col.is-focus').getAttribute('data-name')}`, 'The counter names the column shown');
  await sp.locator('.focus-switch [role="tab"][data-col="k1"]').click();
  assert.equal(await sp.locator('.counter__sub').innerText(), 'in A');
  await sp.locator('#xNext').click();
  await sp.waitForTimeout(200);
  assert.ok(await sp.locator('[data-col="k1"] .col__scroll').evaluate((el) => el.scrollTop) > 0, 'Next moved A, the column shown');
  assert.match(await sp.locator('#xCounter .counter__main').innerText(), /^1 of \d+$/);
  await sp.locator('.focus-switch [role="tab"][data-col="k2"]').click();
  assert.equal(await sp.locator('#xCounter .counter__main').innerText(), 'No changes', 'B, the base, has none to step through');
  await sp.locator('#xNext').click();
  await sp.waitForTimeout(100);
  assert.equal(await sp.locator('#xLive').innerText(), 'No changes are marked in B.');
  await small.close();

  // The bundle and the link reopen the same comparison.
  await page.locator('#openReport').click();
  await page.locator('#importText').fill(await fs.readFile(bundleFile, 'utf8'));
  await page.locator('#importDialog [data-action="import-confirm"]').click();
  await page.waitForTimeout(800);
  const reopened = await page.evaluate(async () => {
    const { compare } = await import('/js/compare/index.js');
    const { toBundle } = await import('/js/compare/records.js');
    return { bundle: toBundle(compare.set), id: compare.set.id };
  });
  // The panel that was open is not part of what the comparison holds: at
  // this width it opens closed, by design.
  const same = (b) => ({ ...b.dossierCompare, created: 0, updated: 0, view: { ...b.dossierCompare.view, panel: null } });
  assert.deepEqual(same(reopened.bundle), same(before), 'A bundle round trip reopens identically');
  const lp = await context.newPage();
  watch(errors, lp, 'link: ');
  await lp.goto(link);
  await lp.locator('#cmp-col-k3 .ruler').waitFor();
  assert.equal(await lp.locator('.cmp-toolbar .set-title__text').innerText(), 'Illustrative example: checkout latency incident');
  assert.match(await lp.evaluate(() => location.hash), /^#\/~compare\/c-/, 'The link becomes a saved comparison');
  await lp.close();

  // ── A panel open across 700 px: the sheet below it, the panel again above ─
  await page.locator('.cmp-toolbar [data-action="cmp-panel"][data-panel="sections"]').click();
  await page.locator('#cmpPanel .secmap').waitFor();
  await page.setViewportSize({ width: 600, height: 844 });
  await page.waitForFunction(() => document.querySelector('#cmpPanel.is-sheet:not([hidden])'));
  assert.equal(await page.locator('#cmpScrim').isVisible(), true, 'The open panel became the sheet, with its scrim');
  assert.ok(await page.evaluate(() => document.querySelector('#cmpPanel').contains(document.activeElement)), 'Focus is in the sheet');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cmpPanel').isVisible(), false, 'Escape closes the sheet');
  await focusOn(page, '#cmpOptionsBtn', 'Closing the sheet returns focus to Options');
  assert.deepEqual(await page.locator('[data-action="cmp-panel"]').evaluateAll((list) => [...new Set(list.map((b) => b.getAttribute('aria-pressed')))]), ['false']);
  await page.locator('#cmpOptionsBtn').click();
  await page.locator('#cmpOptions [data-action="cmp-panel"][data-panel="review"]').click();
  await page.locator('#cmpPanel textarea[data-summary]').focus();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => document.querySelector('#compareView').classList.contains('panel-overlay'));
  assert.equal(await page.locator('#cmpScrim').isVisible(), false);
  await focusOn(page, '#cmpPanel textarea[data-summary]', 'Widened, the panel stays open with focus where it was');
  await page.locator('#cmpPanel [data-action="cmp-close-panel"]').click();
  assert.equal(await page.locator('#cmpPanel').isVisible(), false);
  await focusOn(page, '.cmp-toolbar [data-action="cmp-panel"][data-panel="review"]', 'Close returns focus to the toggle');

  // ── Phone: one column, panels as sheets under the header ─────────────────

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await noOverflow(page, 'Compare at 390');
  assert.equal(await page.locator('#cmpPanel').isVisible(), false, 'A phone never opens on a panel');
  await page.locator('#cmpOptionsBtn').click();
  await page.locator('#cmpOptions [data-action="cmp-panel"][data-panel="review"]').click();
  await page.waitForFunction(() => document.querySelector('#cmpPanel.is-sheet:not([hidden])'));
  assert.equal(await page.locator('#cmpScrim').isVisible(), true);
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.querySelector('#cmpPanel').contains(document.activeElement)), `Tab ${i + 1} left the Review sheet`);
  }
  await noOverflow(page, 'Review sheet at 390');
  await page.screenshot({ path: path.join(verify, 'compare-analysis-390.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cmpPanel').isVisible(), false);
  await focusOn(page, '#cmpOptionsBtn', 'Closing the sheet returns focus to Options');

  // ── A comparison too long for a link says why, outside the dimmed choice ─
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    const { api } = await import('/js/compare/index.js');
    const { addColumn } = await import('/js/compare/model.js');
    const bytes = crypto.getRandomValues(new Uint8Array(60000));
    const text = Array.from(bytes, (b) => String.fromCharCode(33 + (b % 90))).join('');
    api.commit(addColumn(api.compare.set, { role: 'other', source: { kind: 'text', name: 'noise.txt', text } }).set);
  });
  await page.locator('#shareReport').click();
  const linkChoice = page.locator('#exportBody [data-action="cmp-share-link"]');
  await linkChoice.waitFor();
  assert.equal(await linkChoice.isDisabled(), true);
  const why = page.locator('#exportBody .ds-export__why');
  assert.match(await why.innerText(), /^The link would be [\d,]+ characters, over the 32,000 a link can carry\./);
  assert.equal(await linkChoice.getAttribute('aria-describedby'), await why.getAttribute('id'));
  assert.equal(await why.evaluate((el) => getComputedStyle(el).opacity), '1', 'The reason is not dimmed with the button');
  await page.keyboard.press('Escape');

  // ── A Dossier column that cannot be read, as the base and as another ─────
  const unreadable = await page.evaluate(async () => {
    const { api, compare } = await import('/js/compare/index.js');
    const { newSet, addColumn, setView } = await import('/js/compare/model.js');
    const md = (fig) => `# Incident\n\n## Summary\n\nLatency rose to ${fig} s for 40 minutes.\n\n## Impact\n\nSome customers saw errors.\n`;
    let set = newSet({ id: 'c-unreadable-check', title: 'Unreadable' });
    set = addColumn(set, { role: 'human', source: { kind: 'markdown', name: 'a.md', text: md('2.9') } }).set;
    set = addColumn(set, { role: 'agent', source: { kind: 'dossier', name: 'broken.json', text: '{"dossier": {"title": "x", "pages": [' } }).set;
    set = addColumn(set, { role: 'fix', source: { kind: 'markdown', name: 'c.md', text: md('3.4') } }).set;
    let renders = 0;
    compare.hooks.afterRender.push(() => { renders += 1; });
    const out = {};
    for (const baseCol of ['k2', 'k1']) {
      renders = 0;
      api.openSet(setView(set, { diff: { on: true, base: baseCol } }), { saved: false });
      await new Promise((done) => { setTimeout(done, 1000); });
      out[baseCol] = {
        renders,
        lines: [...document.querySelectorAll('#compareView .col__diff')].map((el) => el.textContent),
        marked: document.querySelectorAll('#cmp-col-k3 [data-chg]').length,
      };
    }
    return out;
  });
  // It used to read as pending for good, and the view redrew every frame.
  assert.ok(unreadable.k2.renders <= 3 && unreadable.k1.renders <= 3, `The view kept redrawing: ${unreadable.k2.renders} and ${unreadable.k1.renders} renders in a second`);
  assert.deepEqual(unreadable.k2.lines, [
    'Not compared: B, the base, could not be read.',
    'Base for differences, but it could not be read, so no column is marked. Choose another base in Differences against.',
    'Not compared: B, the base, could not be read.',
  ]);
  assert.equal(unreadable.k2.marked, 0);
  assert.equal(unreadable.k1.lines[1], 'Not compared: this Dossier document could not be read.');
  assert.match(unreadable.k1.lines[2], /^1 difference from A/, 'C is still marked against A');
  assert.ok(unreadable.k1.marked > 0);

  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: Share and export in Compare (the choices, a #dc= link), the one-file export offline (marks, steps to the last change, sync, the review, no request) and at 390 (the counter and the buttons follow the column shown, and say when it has no changes), the bundle round trip, the #dc= link opening as a saved comparison, a panel crossing 700 px both ways (the sheet with its scrim, Escape and focus to Options, the panel again with focus kept, Close back to its toggle), the Review sheet keeping Tab on a phone, the reason a link is too long said outside the dimmed choice, and an unreadable Dossier column, as the base and as another, left out of the differences with a notice and drawn at most three times.');
} finally {
  await browser.close();
}
