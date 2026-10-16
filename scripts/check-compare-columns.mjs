/**
 * Browser checks for what goes into a Compare column and the Review panel
 * before anything has: a report at the size cap (Edit source past it is
 * refused in the form with the text kept, a minified Dossier document under
 * it goes in as written, a source the column cannot keep changes nothing and
 * says why), and the Review panel with no report in any column (criteria to
 * set up, nothing to mark, prefer, note or copy, the Share choice disabled
 * with its reason, and the whole panel back once a report lands).
 *
 * Kept apart from scripts/check-compare.mjs, which is near the 500-line
 * limit. Run against the dev server: `node scripts/check-compare-columns.mjs`
 * (DOSSIER_URL overrides http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  base, watch, noOverflow, chooseFile,
} from './check-helpers.mjs';

const browser = await chromium.launch();
const errors = [];
const MAX = 2000000;

/** The stored copy of the open set, read back from IndexedDB. */
const stored = (page) => page.evaluate(async () => {
  const { compare } = await import('/js/compare/index.js');
  const { readSet } = await import('/js/compare/store.js');
  return readSet(compare.set.id);
});

try {
  await checkCap();
  await checkEmptyReview();
  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: a column at the size cap (Edit source past it refused in the form with the text kept and the stored report unchanged, a minified Dossier document under the cap whose pretty form is over it put in by Replace as written, and a source the column cannot keep leaving it filled with the reason and no "now shows"), and the Review panel with no report (criteria to set up and renamed, nothing to mark, prefer, note or copy, the notice spaced from the Blind hint, the Share choice disabled with its reason outside it, no sideways scroll at 390, and the whole panel back once a report lands).');
} finally {
  await browser.close();
}

async function checkCap() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  watch({ page, errors });
  await page.goto(`${base}/?check=compare-cap`, { waitUntil: 'networkidle' });
  await page.locator('#welcome [data-action="view"][data-view="compare"]').click();
  await page.locator('#compareView .cmp-toolbar').waitFor();
  // A Markdown report just under the cap, saved.
  const near = MAX - 50000;
  await page.evaluate(async (length) => {
    const { api, compare } = await import('/js/compare/index.js');
    const { updateColumn } = await import('/js/compare/model.js');
    const text = `# Near the cap\n\n${'word '.repeat(Math.floor((length - 16) / 5))}`;
    api.commit(updateColumn(compare.set, 'k1', { source: { kind: 'markdown', name: 'near.md', text } }));
    await api.flushSave();
  }, near);
  await page.waitForFunction(() => /^#\/~compare\/c-/.test(location.hash));
  const before = (await stored(page)).columns[0].source.text.length;
  assert.ok(before > MAX - 60000 && before <= MAX, `The report stored ${before} characters`);

  // Edit source pushed past the cap: refused in the form, nothing lost.
  await page.locator('#cmp-col-k1 .col__menu').click();
  await page.locator('#cmpColumnMenu [data-action="cmp-edit-source"]').click();
  const area = page.locator('#cmp-col-k1 textarea');
  await area.waitFor();
  const overLength = await area.evaluate((el, add) => {
    el.value += 'x'.repeat(add);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value.length;
  }, 110000);
  assert.ok(overLength > MAX);
  await page.locator('#cmp-col-k1 form').getByRole('button', { name: 'Save' }).click();
  const error = page.locator('#cmp-col-k1 .col-form__error');
  await error.waitFor();
  assert.match(await error.innerText(), new RegExp(`^The edited source is ${overLength.toLocaleString('en-US')} characters long, over the 2,000,000 character limit`));
  assert.equal(await area.evaluate((el) => el.value.length), overLength, 'The form lost the edit');
  assert.equal(await page.locator('#cmpToast').innerText(), '', 'A refused edit said it saved');
  await page.waitForTimeout(600);
  assert.equal((await stored(page)).columns[0].source.text.length, before, 'The stored report changed');
  await page.locator('#cmp-col-k1 form').getByRole('button', { name: 'Cancel' }).click();
  await page.locator('#cmp-col-k1 .col__scroll').waitFor();

  // A minified Dossier document under the cap, whose pretty form is over it,
  // goes in through Replace as its author wrote it.
  const blocks = Array.from({ length: 2600 }, () => ({ type: 'list', items: Array.from({ length: 100 }, (_, j) => `w${j % 10}`) }));
  const mini = JSON.stringify({ dossier: { version: 1, title: 'Minified', pages: [{ title: 'P', blocks }] } });
  assert.ok(mini.length < MAX && JSON.stringify(JSON.parse(mini), null, 2).length > MAX);
  await page.locator('#cmp-col-k1 .col__menu').click();
  await page.locator('#cmpColumnMenu [data-action="cmp-replace"]').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#cmp-col-k1 [data-action="cmp-choose-file"]').click()]);
  await chooser.setFiles({ name: 'mini.json', mimeType: 'application/json', buffer: Buffer.from(mini) });
  await page.locator('#cmp-col-k1 .reader--dossier .report-title', { hasText: 'Minified' }).waitFor({ timeout: 20000 });
  assert.match(await page.locator('#cmpToast').innerText(), /now shows mini\.json/);
  await page.waitForTimeout(600);
  const kept = (await stored(page)).columns[0].source;
  assert.equal(kept.kind, 'dossier');
  assert.equal(kept.text.length, mini.length, 'The stored text is not the file as written');

  // A source the column cannot keep changes nothing and says why.
  const refused = await page.evaluate(async (max) => {
    const { api, compare } = await import('/js/compare/index.js');
    const toast = document.getElementById('cmpToast');
    toast.textContent = '';
    const ok = api.setColumnSource('k1', { kind: 'dossier', name: 'huge.json', text: 'x'.repeat(max + 10) });
    return { ok, kind: compare.set.columns[0].source?.kind, length: compare.set.columns[0].source?.text.length, toast: toast.textContent };
  }, MAX);
  assert.equal(refused.ok, false);
  assert.equal(refused.kind, 'dossier', 'The column was emptied');
  assert.equal(refused.length, mini.length);
  assert.ok(!/now shows/.test(refused.toast), 'A refused source said the column now shows it');
  assert.match(await page.locator('#app-toast').innerText(), /^huge\.json is 2,000,010 characters long, over the 2,000,000 character limit/);
  await context.close();
}

async function checkEmptyReview() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  watch({ page, errors });
  await page.goto(`${base}/?check=compare-empty-review`, { waitUntil: 'networkidle' });
  await page.locator('#welcome [data-action="view"][data-view="compare"]').click();
  await page.locator('#compareView .cmp-toolbar').waitFor();
  await page.locator('#cmpToolbar [data-action="cmp-panel"][data-panel="review"]:visible').click();
  await page.locator('#cmpPanel .panel__empty').waitFor();
  const count = (sel) => page.locator(`#cmpPanel ${sel}`).count();
  assert.equal(await count('details.crit'), 0, 'An empty review opens criteria with nothing in them');
  assert.equal(await count('.crit--idle'), 5);
  for (const sel of ['.prefer', '.notes', '[data-summary]', '.panel__foot']) assert.equal(await count(sel), 0, `${sel} shows with no report`);
  const gap = await page.evaluate(() => document.querySelector('#cmpPanel .panel__empty').getBoundingClientRect().top
    - document.querySelector('#cmpPanel .blind-hint').getBoundingClientRect().bottom);
  assert.ok(gap >= 8, `The notice sits ${gap}px under the Blind hint`);
  // The criteria can be set up before the reports go in.
  await page.locator('#cmpPanel .crit__more[data-crit="accuracy"]').click();
  await page.locator('#cmpPanel [data-action="cmp-crit-rename"][data-crit="accuracy"]').click();
  await page.locator('#cmpPanel .crit__input').fill('Accuracy of figures');
  await page.keyboard.press('Enter');
  await page.locator('#cmpPanel .crit__name', { hasText: 'Accuracy of figures' }).waitFor();
  // Nothing to copy: the Share choice says so, outside the disabled button.
  await page.locator('#shareReport').click();
  const choice = page.locator('#exportBody [data-action="cmp-export-review"]');
  await choice.waitFor();
  assert.equal(await choice.isDisabled(), true);
  assert.equal(await page.locator('#exportWhy-cmp-export-review').innerText(), 'No column holds a report yet, so there is no review to copy.');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow(page, 'The empty Review at 390');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  if (!(await page.locator('#cmpPanel').isVisible())) await page.locator('#cmpToolbar [data-action="cmp-panel"][data-panel="review"]:visible').click();
  // The first report brings the whole panel back.
  await chooseFile(page, 'k1', 'reports/compare/human-draft.html');
  await page.locator('#cmpPanel .tally').waitFor();
  assert.equal(await count('details.crit'), 5);
  assert.equal(await count('details.crit[open]'), 2, 'The first two criteria open');
  assert.equal(await count('.prefer label'), 2);
  assert.equal(await count('.panel__foot'), 1);
  assert.equal(await count('.panel__empty'), 0);
  assert.equal(await page.locator('#cmpPanel .crit__name').first().innerText(), 'Accuracy of figures', 'The renamed criterion kept its name');
  await context.close();
}
