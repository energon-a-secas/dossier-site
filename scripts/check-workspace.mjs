/** Browser regressions for the report, composer, editing and offline export. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.DOSSIER_URL || 'http://127.0.0.1:8899';
const browser = await chromium.launch();
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
await fs.mkdir('.verify', { recursive: true });

async function noOverflow(target, label) {
  assert.equal(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${label} overflows the viewport`);
}

try {
  await page.goto(`${base}/?check=workspace`, { waitUntil: 'networkidle' });
  await page.locator('.report-title').waitFor();
  assert.match(await page.locator('.report-title').innerText(), /Two responses/);
  assert.equal(await page.locator('#sourcePane').isVisible(), false);
  await noOverflow(page, 'Desktop report');
  await page.screenshot({ path: '.verify/report-desktop.png', fullPage: true });

  const comparison = page.locator('#stage .compare');
  await comparison.getByRole('button', { name: 'Highlight changes' }).click();
  assert.equal(await comparison.getAttribute('data-highlight'), 'on');
  await comparison.getByRole('button', { name: 'One at a time' }).click();
  assert.equal(await comparison.locator('[data-side="right"].compare__face').isVisible(), false);
  await comparison.getByRole('button', { name: 'Response B', exact: true }).click();
  assert.equal(await comparison.locator('[data-side="left"].compare__face').isVisible(), false);
  assert.equal(await comparison.locator('[data-side="right"].compare__face').isVisible(), true);
  await comparison.getByRole('button', { name: 'Side by side' }).click();
  assert.equal(await comparison.locator('.compare__face:visible').count(), 2);

  await page.getByRole('link', { name: 'Scores & runs' }).click();
  await page.locator('#stage .grouped-chart').waitFor();
  assert.equal(await page.locator('#stage .chart-bar').count(), 8);
  await page.locator('#stage .chart-values summary').click();
  assert.match(await page.locator('#stage .chart-values').innerText(), /Run 5/);
  await page.screenshot({ path: '.verify/report-charts.png', fullPage: true });

  // Templates must open a report, not insert a null block into the current one.
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await page.locator('[data-template="executions.json"]').click();
  await page.locator('.report-title').filter({ hasText: 'A faster run' }).waitFor();
  assert.equal(await page.locator('#stage .block-error').count(), 0);
  await page.getByRole('link', { name: 'Verification', exact: true }).click();
  await page.locator('#stage .block-table').waitFor();
  assert.match(await page.locator('#stage .block-table').innerText(), /Failed checks\s+0\s+0/);

  // The no-JSON path preserves both texts and produces a saved report.
  await page.getByRole('button', { name: 'Compare responses', exact: true }).first().click();
  const form = page.locator('#comparisonForm');
  await form.locator('[name="title"]').fill('Review of two responses');
  await form.locator('[name="prompt"]').fill('Summarize a change.');
  await form.locator('[name="left"]').fill('First line\n\nKeep this paragraph.');
  await form.locator('[name="right"]').fill('First line\n\nA revised paragraph.');
  await form.getByRole('button', { name: 'Create comparison' }).click();
  await page.locator('.report-title').filter({ hasText: 'Review of two responses' }).waitFor();
  await page.waitForFunction(() => document.getElementById('reportOrigin').textContent === 'Saved in this browser');

  await page.getByRole('button', { name: 'Edit report', exact: true }).click();
  assert.equal(await page.locator('.header-bar').isVisible(), false, 'Global header overlaps the editor');
  assert.equal(await page.locator('.ds-wordmark').isVisible(), true, 'Editor lost its application navigation');
  const title = page.locator('#formPane .form-field').filter({ has: page.locator('label', { hasText: /^Title/ }) }).first().locator('input');
  const subtitle = page.locator('#formPane .form-field').filter({ has: page.locator('label', { hasText: /^Subtitle/ }) }).first().locator('input');
  await title.fill('Edited title');
  await subtitle.fill('Edited subtitle');
  assert.equal(await page.locator('.report-title').innerText(), 'Edited title');
  assert.equal(await page.locator('.report-subtitle').innerText(), 'Edited subtitle');
  await page.locator('#formPane summary').filter({ hasText: 'Side-by-side comparison' }).click();
  await page.locator('#formPane').getByRole('group', { name: 'Right', exact: true }).getByLabel('Value', { exact: true }).fill('A revised answer with specifics.');
  await subtitle.fill('Edited subtitle after response change');
  assert.match(await page.locator('#stage .compare__face[data-side="right"]').innerText(), /A revised answer with specifics/);
  await noOverflow(page, 'Report editor');
  await page.screenshot({ path: '.verify/report-editor.png', fullPage: true });
  await page.getByRole('tab', { name: 'JSON', exact: true }).click();
  const source = JSON.parse(await page.locator('.editor-textarea').inputValue());
  assert.equal(source.dossier.title, 'Edited title');
  assert.equal(source.dossier.subtitle, 'Edited subtitle after response change');
  assert.equal(source.dossier.pages[0].blocks[0].right.value, 'A revised answer with specifics.');
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.report-title').innerText(), 'Edited title');
  assert.match(await page.locator('.editor-textarea').inputValue(), /Keep this paragraph/);
  await page.locator('.editor-textarea').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.editor-textarea').evaluate((el) => el === document.activeElement), false, 'Keyboard focus is trapped in the editor');

  // Importing bad JSON retains the last valid report and keeps the input open.
  await page.getByRole('button', { name: 'Open report', exact: true }).click();
  await page.locator('#importText').fill('{ "broken": ');
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  assert.equal(await page.locator('#importDialog').isVisible(), true);
  assert.equal(await page.locator('.report-title').innerText(), 'Edited title');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Separate imports must not overwrite the saved comparison.
  await page.getByRole('button', { name: 'Open report', exact: true }).click();
  await page.locator('#importText').fill(JSON.stringify({ dossier: { version: 1, title: 'Another report', pages: [{ title: 'Summary', blocks: [{ type: 'prose', text: 'A separate document.' }] }] } }));
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  await page.waitForFunction(async () => (await import('/js/store.js')).listReports().then((rows) => rows.length === 2));

  const yamlRoundtrip = await page.evaluate(async () => {
    const { exportYaml } = await import('/js/export.js');
    const { load } = await import('/js/vendor/js-yaml.mjs');
    const original = URL.createObjectURL;
    let captured;
    const doc = { dossier: { version: 1, title: 'Quotes "and" punctuation: #', pages: [{ title: 'One', blocks: [{ type: 'prose', text: 'First\nSecond' }] }] } };
    URL.createObjectURL = (blob) => { captured = blob; return original.call(URL, blob); };
    try { await exportYaml(doc); } finally { URL.createObjectURL = original; }
    return JSON.stringify(load(await captured.text())) === JSON.stringify(doc);
  });
  assert.equal(yamlRoundtrip, true, 'YAML export lost nested fields or multiline text');

  // A self-contained export keeps all pages and the actual comparison controls.
  const html = await page.evaluate(async () => {
    const doc = await (await fetch('/reports/responses.json')).json();
    const { parse } = await import('/js/parse.js');
    const { exportStandaloneHtml } = await import('/js/export.js');
    const original = URL.createObjectURL;
    let captured;
    URL.createObjectURL = (blob) => { captured = blob; return original.call(URL, blob); };
    try { await exportStandaloneHtml(parse(JSON.stringify(doc)).model); }
    finally { URL.createObjectURL = original; }
    return captured.text();
  });
  await fs.writeFile('.verify/comparison-standalone.html', html);
  const offline = await context.newPage();
  const requests = [];
  await offline.route('**/*', (route) => {
    if (route.request().url() === `${base}/.verify/comparison-standalone.html`) return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  await offline.goto(`${base}/.verify/comparison-standalone.html`);
  assert.equal(await offline.locator('.report-page').count(), 3);
  await offline.getByRole('button', { name: 'One at a time' }).click();
  await offline.getByRole('button', { name: 'Response B', exact: true }).click();
  assert.equal(await offline.locator('.compare__face[data-side="right"]').isVisible(), true);
  assert.equal(await offline.locator('.compare__face[data-side="left"]').isVisible(), false);
  await noOverflow(offline, 'Offline report');
  assert.deepEqual(requests, [], 'Offline report made a network request');

  await offline.emulateMedia({ media: 'print' });
  assert.equal(await offline.locator('.compare__face:visible').count(), 2, 'Print hides a response');
  assert.equal(await offline.locator('.compare__tools').isVisible(), false);
  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  const noScript = await noScriptContext.newPage();
  await noScript.goto(`${base}/.verify/comparison-standalone.html`);
  assert.equal(await noScript.locator('.compare__face:visible').count(), 2);
  assert.equal(await noScript.locator('.compare__tools').isVisible(), false);
  await noScriptContext.close();

  // A quick report switch must save the edit, never the newly opened example.
  const switchingContext = await browser.newContext();
  const switching = await switchingContext.newPage();
  switching.on('pageerror', (error) => errors.push(error.message));
  await switching.goto(`${base}/?check=switching`, { waitUntil: 'networkidle' });
  await switching.getByRole('button', { name: 'Edit report', exact: true }).click();
  await switching.locator('#formPane .form-field').filter({ has: switching.locator('label', { hasText: /^Title/ }) }).first().locator('input').fill('Edited sample');
  await switching.getByRole('button', { name: 'Examples', exact: true }).click();
  await switching.locator('[data-template="executions.json"]').click();
  await switching.locator('.report-title').filter({ hasText: 'A faster run' }).waitFor();
  await switching.getByRole('button', { name: 'Edit report', exact: true }).click();
  await switching.getByRole('tab', { name: 'JSON', exact: true }).click();
  const execution = JSON.parse(await switching.locator('.editor-textarea').inputValue());
  execution.dossier.title = 'Edited execution';
  await switching.locator('.editor-textarea').fill(JSON.stringify(execution));
  await switching.getByRole('button', { name: 'Examples', exact: true }).click();
  await switching.locator('[data-template="impact.json"]').click();
  await switching.waitForTimeout(500);
  const savedTitles = await switching.evaluate(async () => (await (await import('/js/store.js')).listReports()).map((row) => row.title).sort());
  assert.deepEqual(savedTitles, ['Edited execution', 'Edited sample'], 'A pending edit saved the wrong report');
  assert.equal(await switching.locator('#reportOrigin').innerText(), 'Example report · illustrative data');
  await switchingContext.close();

  for (const width of [390, 768, 1024]) {
    const narrow = await browser.newPage({ viewport: { width, height: 844 } });
    await narrow.goto(`${base}/?check=${width}`, { waitUntil: 'networkidle' });
    await narrow.locator('#stage .compare').waitFor();
    await noOverflow(narrow, `${width}px report`);
    await narrow.getByRole('link', { name: 'Scores & runs' }).click();
    await narrow.locator('#stage .grouped-chart').waitFor();
    await noOverflow(narrow, `${width}px charts`);
    if (width === 390) {
      await narrow.screenshot({ path: '.verify/report-mobile.png', fullPage: true });
      await narrow.getByRole('button', { name: 'Compare responses', exact: true }).first().click();
      await noOverflow(narrow, 'Mobile composer');
    }
    await narrow.close();
  }
  assert.deepEqual(errors, [], 'Page raised JavaScript errors');
  console.log('Passed: comparison controls, charts, templates, composer, editing, persistence, rapid report switches, import recovery, YAML export, offline HTML, print, keyboard access and 4 viewport sizes.');
} finally {
  await browser.close();
}
