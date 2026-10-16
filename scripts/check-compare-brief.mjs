/**
 * Browser checks for the brief (js/compare/brief.js): what every report in a
 * comparison was asked to write, as a strip above the columns. The example's
 * brief on screen in one line that keeps the view filling the window, Show
 * all, editing in place (Ctrl+Enter saves, Escape cancels, an undo), removing
 * it and adding it again from the Review panel, the copied review and the
 * one-file export carrying it, Blind leaving it shown, a phone, and a reload.
 *
 * Run against the dev server: `node scripts/check-compare-brief.mjs`
 * (DOSSIER_URL overrides http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  base, file, out, watch, noOverflow, fillsWindow, focusOn,
} from './check-helpers.mjs';

const browser = await chromium.launch();
const errors = [];
const brief = JSON.parse(await fs.readFile(file('reports/compare/index.json'), 'utf8')).prompt;

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  watch({ page, errors });
  await page.goto(`${base}/?check=compare-brief`, { waitUntil: 'networkidle' });
  await page.locator('#welcome [data-action="cmp-example"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#compareView .col .reader').length === 3);
  const strip = page.locator('#cmpBrief');
  const text = page.locator('#cmpBrief .cmp-brief__text');
  const toggle = page.locator('#cmpBrief [data-action="cmp-brief-toggle"]');
  const edit = page.getByRole('button', { name: 'Edit the brief' });

  // ── On screen: one line, the view still filling the window ───────────────
  assert.equal(await strip.isVisible(), true, 'The example\'s brief is not shown');
  assert.equal(await text.innerText(), brief);
  assert.equal(await strip.getAttribute('aria-labelledby'), 'cmpBriefLbl');
  assert.ok((await strip.boundingBox()).height <= 40, `The brief strip is ${(await strip.boundingBox()).height}px tall`);
  await fillsWindow(page, 'With the brief at 1440px');
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(250);
    await noOverflow(page, `The brief at ${width}px`);
  }

  // ── Show all, where the line is cut ───────────────────────────────────────
  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(250);
  assert.equal(await toggle.isVisible(), true, 'A brief cut short offers no Show all');
  const oneLine = (await text.boundingBox()).height;
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await toggle.innerText(), 'Show less');
  assert.ok((await text.boundingBox()).height > oneLine * 1.5, 'Show all left the brief on one line');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);

  // ── Edit in place: Ctrl+Enter saves, with an undo ──────────────────────────
  await edit.click();
  await focusOn(page, '#cmpBriefInput', 'Edit did not put focus in the brief');
  assert.equal(await page.locator('#cmpBriefInput').inputValue(), brief);
  await page.locator('#cmpBriefInput').fill('Write the incident report in one page.');
  await page.keyboard.press('Control+Enter');
  await page.locator('#cmpBrief .cmp-brief__text', { hasText: 'Write the incident report in one page.' }).waitFor();
  await page.waitForFunction(() => /^#\/~compare\/c-/.test(location.hash));
  assert.match(await page.locator('#cmpToast').innerText(), /^Saved the brief\./);
  await focusOn(page, '#cmpBrief [data-action="cmp-brief-edit"]', 'Saving left focus nowhere');
  await page.locator('#cmpToast').getByRole('button', { name: 'Undo' }).click();
  await page.locator('#cmpBrief .cmp-brief__text', { hasText: brief.slice(0, 40) }).waitFor();
  assert.equal(await text.innerText(), brief);

  // ── Escape cancels, with nothing changed ──────────────────────────────────
  await edit.click();
  await page.locator('#cmpBriefInput').fill('Not kept.');
  await page.keyboard.press('Escape');
  await focusOn(page, '#cmpBrief [data-action="cmp-brief-edit"]', 'Escape left focus nowhere');
  assert.equal(await text.innerText(), brief);

  // ── Removed, then added again from the Review panel ───────────────────────
  await edit.click();
  await page.locator('#cmpBriefInput').fill('');
  await page.locator('#cmpBrief').getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => document.getElementById('cmpBrief').hidden);
  assert.match(await page.locator('#cmpToast').innerText(), /^Removed the brief\./);
  await page.locator('#cmpToolbar [data-action="cmp-panel"][data-panel="review"]:visible').click();
  const add = page.locator('#cmpPanel [data-action="cmp-brief-edit"]');
  await add.waitFor();
  assert.equal(await add.innerText(), 'Add the brief');
  await add.click();
  await focusOn(page, '#cmpBriefInput', 'Add the brief did not open the editor');
  await page.locator('#cmpBriefInput').fill(brief);
  await page.keyboard.press('Control+Enter');
  await page.locator('#cmpBrief .cmp-brief__text').waitFor();
  assert.equal(await text.innerText(), brief);
  assert.equal(await page.locator('#cmpPanel .brief-add').isHidden(), true, 'Add the brief stays offered with a brief set');

  // ── Copied with the review, and in the one-file export ────────────────────
  await page.locator('#cmpPanel [data-action="cmp-copy-review"]').click();
  await page.waitForTimeout(200);
  const md = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(md, /## Brief\n\n> Write the incident report for the checkout latency incident/);
  await page.locator('#shareReport').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="cmp-export-html"]').click()]);
  const exported = out('compare-brief-export.html');
  await download.saveAs(exported);
  const offline = await browser.newContext({ viewport: { width: 1440, height: 900 }, offline: true });
  const op = await offline.newPage();
  watch({ page: op, errors });
  const requests = [];
  op.on('request', (req) => { if (!/^(file|data):|^about:srcdoc$/.test(req.url())) requests.push(req.url()); });
  await op.goto(pathToFileURL(exported).href);
  await op.waitForTimeout(300);
  assert.equal(await op.locator('.cmp-brief__text').innerText(), brief, 'The file does not carry the brief');
  assert.equal(await op.locator('.cmp-brief button').count(), 0, 'The file has buttons for an editor it does not have');
  assert.deepEqual(requests, [], 'The file asked the network for something');
  await offline.close();

  // ── Blind leaves it shown: it is every report's ───────────────────────────
  await page.evaluate(() => document.querySelector('.cmp-toolbar [data-action="cmp-toggle-blind"]').click());
  await page.waitForFunction(() => document.querySelector('#compareView').classList.contains('blind'));
  assert.equal(await strip.isVisible(), true, 'Blind hid the brief');
  await page.evaluate(() => document.querySelector('.cmp-toolbar [data-action="cmp-toggle-blind"]').click());
  await page.waitForFunction(() => !document.querySelector('#compareView').classList.contains('blind'));
  await page.waitForTimeout(600);

  // ── Kept across a reload ──────────────────────────────────────────────────
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#cmpBrief .cmp-brief__text').waitFor();
  assert.equal(await text.innerText(), brief, 'The brief was not kept');

  // ── A phone: Add the brief from the Review sheet ──────────────────────────
  await page.evaluate(async () => {
    const { api, compare } = await import('/js/compare/index.js');
    const { setPrompt } = await import('/js/compare/model.js');
    api.commit(setPrompt(compare.set, ''));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  if (await page.locator('#cmpPanel').isVisible()) await page.keyboard.press('Escape');
  await page.locator('#cmpOptionsBtn').click();
  await page.locator('#cmpOptions [data-action="cmp-panel"][data-panel="review"]').click();
  await page.waitForFunction(() => document.querySelector('#cmpPanel.is-sheet:not([hidden])'));
  await page.locator('#cmpPanel [data-action="cmp-brief-edit"]').click();
  await focusOn(page, '#cmpBriefInput', 'Add the brief on a phone did not open the editor');
  assert.equal(await page.locator('#cmpPanel').isVisible(), false, 'The Review sheet stayed over the editor');
  const box = await page.locator('#cmpBriefInput').boundingBox();
  assert.ok(box && box.y >= 0 && box.y + 20 < 844, `The editor is out of view at ${box?.y}px`);
  await noOverflow(page, 'The brief editor at 390');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('cmpBrief').hidden);
  await context.close();

  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: the brief on screen in one line no taller than 40 px with the view still filling the window, no sideways scroll at 1440, 1024 and 390, Show all where it is cut, Edit with Ctrl+Enter saving the comparison and an undo, Escape cancelling, removed and added again from the Review panel, in the copied review and in the one-file export offline with no request, shown under Blind, kept across a reload, and on a phone added from the Review sheet with the editor in view.');
} finally {
  await browser.close();
}
