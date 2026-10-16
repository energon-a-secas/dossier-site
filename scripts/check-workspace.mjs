/**
 * Browser regressions for the workspace: one header, the welcome screen, the
 * report bar, the rail, editing, Check report, the Compare view, keys, sharing,
 * persistence and offline export.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { recordFrames, checkFirstPaint, checkBoot } from './check-boot.mjs';
import { checkNarrow, noOverflow, oneHeader, visibleBars } from './check-narrow.mjs';
import { checkReports } from './check-reports.mjs';

const base = process.env.DOSSIER_URL || 'http://127.0.0.1:8899';
const browser = await chromium.launch();
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
await fs.mkdir('.verify', { recursive: true });

/** What the retired response composer used to make: a saved report holding a comparison block. */
const PASTED_COMPARISON = {
  dossier: {
    version: 1,
    title: 'Review of two responses',
    kind: 'comparison',
    status: 'draft',
    pages: [{
      title: 'Responses',
      blocks: [{
        type: 'compare', kind: 'text', mode: 'side', highlightChanges: false,
        prompt: 'Summarize a change.',
        left: { label: 'Response A', value: 'First line\n\nKeep this paragraph.' },
        right: { label: 'Response B', value: 'First line\n\nA revised paragraph.' },
      }],
    }],
  },
};

try {
  // ── First visit: the welcome screen, one header, nothing auto-loaded ──────
  await page.addInitScript(recordFrames);
  await page.goto(`${base}/?check=workspace`, { waitUntil: 'networkidle' });
  await checkFirstPaint(page, 'First visit');
  assert.equal(await page.locator('#welcome').isVisible(), true, 'A first visit should open on the welcome screen');
  assert.equal(await page.locator('#stage .report-title').count(), 0, 'A first visit loaded a report on its own');
  assert.equal(await page.locator('html').getAttribute('data-dossier-booting'), null);
  await oneHeader(page, 'Welcome');
  assert.equal(await page.locator('.ds-wordmark, .ds-workbar, .ds-contextbar').count(), 0, 'The old second toolbar is back');
  assert.equal(await page.locator('.header-subtitle').innerText(), 'Read and compare reports');
  assert.equal(await page.locator('#viewReports').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('#viewCompare').getAttribute('aria-current'), null);
  // In the bar, Display options is an icon-only control (the kit draws it square).
  assert.equal(await page.locator('#displayOptions > :not(svg)').count(), 0, 'Display options carries a text label in the bar');
  assert.ok(await page.locator('#welcomeExamples .ds-example').count() >= 3, 'The welcome screen lists no examples');
  // The note under the actions has its own space (it used to touch the buttons).
  const noteGap = await page.evaluate(() => document.querySelector('.ds-welcome__note').getBoundingClientRect().top
    - document.querySelector('.ds-welcome__examples').getBoundingClientRect().bottom);
  assert.ok(noteGap >= 16, `The welcome note sits ${noteGap}px under the examples`);
  await noOverflow(page, 'Welcome');
  await page.screenshot({ path: '.verify/welcome-desktop.png', fullPage: true });

  // ── An example from the welcome screen, read mode, the report bar ──────────
  await page.locator('#welcomeExamples [data-file="responses.json"]').click();
  await page.locator('.report-title').waitFor();
  assert.match(await page.locator('.report-title').innerText(), /Two responses/);
  assert.equal(await page.locator('#sourcePane').isVisible(), false);
  assert.equal(await page.locator('#reportOrigin').innerText(), 'Example report · illustrative data');
  assert.equal(await page.locator('#reportPages').innerText(), '3 pages');
  assert.equal(await page.locator('#toggleMode').innerText(), 'Edit');
  assert.equal(await page.locator('#toggleMode').getAttribute('aria-pressed'), 'false');
  // One h1 on the page: the kit's. The report title is the heading under it.
  assert.deepEqual(await page.locator('h1').allInnerTexts(), ['Dossier']);
  assert.equal(await page.locator('.report-title').evaluate((el) => el.tagName), 'H2');
  // The report area is not a live region; opens are announced in the toast.
  assert.equal(await page.locator('#stage').getAttribute('aria-live'), null);
  assert.match(await page.locator('#app-toast').innerText(), /Opened the example/);
  // This title ends in its own full stop; the toast must not add a second one.
  assert.doesNotMatch(await page.locator('#app-toast').innerText(), /\."\./, 'The toast doubled the full stop after the title');
  assert.equal(await page.locator('#pageTabs').count(), 0, 'The dead page tab strip is back');
  // The rail is docked and open at this width, in read mode too.
  assert.equal(await page.locator('#rail').isVisible(), true, 'The rail is hidden in read mode at 1440px');
  assert.equal(await page.locator('#toggleRail').getAttribute('aria-expanded'), 'true');
  await oneHeader(page, 'Report');
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

  await page.locator('#stage').getByRole('link', { name: 'Scores & runs' }).click();
  await page.locator('#stage .grouped-chart').waitFor();
  assert.equal(await page.locator('#stage .chart-bar').count(), 8);
  await page.locator('#stage .chart-values summary').click();
  assert.match(await page.locator('#stage .chart-values').innerText(), /Run 5/);
  await page.screenshot({ path: '.verify/report-charts.png', fullPage: true });
  // `]` and `[` step through the pages, one history entry each.
  const activeTab = () => page.locator('#stage .report-tab[aria-current="page"]').innerText();
  await page.locator('body').click({ position: { x: 5, y: 600 } });
  await page.keyboard.press(']');
  await page.waitForFunction(() => /Decision/.test(document.querySelector('#stage .report-tab[aria-current="page"]')?.textContent));
  await page.keyboard.press('[');
  await page.waitForFunction(() => /Scores/.test(document.querySelector('#stage .report-tab[aria-current="page"]')?.textContent));
  assert.match(await activeTab(), /Scores & runs/);

  // ── The rail collapses in read mode, and the choice is kept ────────────────
  await page.locator('#toggleRail').click();
  assert.equal(await page.locator('#rail').isVisible(), false);
  assert.equal(await page.locator('#toggleRail').getAttribute('aria-expanded'), 'false');
  // `/` opens it again and lands in the saved-report filter.
  await page.locator('body').click({ position: { x: 5, y: 600 } });
  await page.keyboard.press('/');
  assert.equal(await page.locator('#rail').isVisible(), true, '/ did not open the rail');
  assert.equal(await page.locator('#reportFilter').evaluate((el) => el === document.activeElement), true, '/ did not focus the filter');
  await page.locator('#reportFilter').blur();

  // ── H belongs to the kit: one bar, hidden, then back. Never two. ───────────
  await page.locator('body').click({ position: { x: 5, y: 600 } });
  await page.keyboard.press('h');
  assert.equal(await visibleBars(page), 0, 'H did not hide the header');
  await page.keyboard.press('h');
  await oneHeader(page, 'After pressing H twice');

  // ── Examples from the Open dialog open a report, never insert a block ──────
  await page.locator('#openReport').click();
  assert.equal(await page.locator('#importDialog').isVisible(), true);
  assert.ok(await page.locator('#openExamples .ds-example').count() >= 10, 'The Open dialog lists no examples');
  await page.locator('#openExamples [data-file="executions.json"]').click();
  await page.locator('.report-title').filter({ hasText: 'A faster run' }).waitFor();
  assert.equal(await page.locator('#importDialog').isVisible(), false);
  assert.equal(await page.locator('#stage .block-error').count(), 0);
  await page.locator('#stage').getByRole('link', { name: 'Verification', exact: true }).click();
  await page.locator('#stage .block-table').waitFor();
  assert.match(await page.locator('#stage .block-table').innerText(), /Failed checks\s+0\s+0/);

  // ── Compare is a view of its own; Reports brings the report back ─────────
  await page.locator('#viewCompare').click();
  await page.locator('#compareView .cmp-toolbar').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-dossier-view'), 'compare');
  assert.match(await page.evaluate(() => location.hash), /^#\/~compare/);
  assert.equal(await page.locator('#viewCompare').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('#viewReports').getAttribute('aria-current'), null);
  assert.equal(await page.locator('#shell').isVisible(), false);
  assert.equal(await page.locator('#welcome').isVisible(), false);
  assert.equal(await page.locator('#compareView [data-action="cmp-choose-file"]').count(), 2, 'A new comparison starts with two empty columns');
  assert.equal(await page.locator('#comparisonComposer').count(), 0, 'The retired composer is still in the page');
  await oneHeader(page, 'Compare view');
  // The skip link is an anchor, not a route: it never leaves the Compare view.
  await page.evaluate(() => { location.hash = '#main'; });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('html').getAttribute('data-dossier-view'), 'compare', 'The skip link switched views');
  assert.match(await page.evaluate(() => location.hash), /^#\/~compare/, 'The skip link left its anchor in the address');
  await page.locator('#viewReports').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'reports');
  assert.equal(await page.locator('#compareView').isVisible(), false);
  assert.match(await page.locator('.report-title').innerText(), /A faster run/);

  // A pasted Dossier document with a comparison block opens and is saved.
  await page.locator('#openReport').click();
  await page.locator('#importText').fill(JSON.stringify(PASTED_COMPARISON));
  await page.locator('#importDialog [data-action="import-confirm"]').click();
  await page.locator('.report-title').filter({ hasText: 'Review of two responses' }).waitFor();
  await page.waitForFunction(() => document.getElementById('reportOrigin').textContent === 'Saved in this browser');
  assert.equal(await page.locator('html').getAttribute('data-dossier-view'), 'reports');
  assert.equal(await page.locator('#viewReports').getAttribute('aria-current'), 'page');

  // ── Edit and Done ──────────────────────────────────────────────────────────
  await page.locator('#toggleMode').click();
  assert.equal(await page.locator('#toggleMode').innerText(), 'Done');
  assert.equal(await page.locator('#toggleMode').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#sourcePane').isVisible(), true);
  await oneHeader(page, 'Editor');
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

  // Check report opens beside the editor, in the same column, and never under it.
  await page.locator('#toggleFindings').click();
  assert.equal(await page.locator('#findingsPanel').isVisible(), true);
  assert.equal(await page.locator('#toggleFindings').getAttribute('aria-expanded'), 'true');
  const boxes = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect().toJSON();
    return { findings: r('findingsPanel'), source: r('sourcePane'), stage: r('stage') };
  });
  assert.ok(boxes.findings.left >= boxes.stage.right, 'Check report is not beside the report');
  assert.ok(Math.abs(boxes.findings.left - boxes.source.left) < 2, 'Check report is not in the editor column');
  assert.ok(boxes.findings.bottom <= boxes.source.top + 1, 'Check report overlaps the editor');
  await noOverflow(page, 'Report editor');
  await page.screenshot({ path: '.verify/report-editor.png', fullPage: true });
  // At the end of the page the sticky side column still fits above the
  // footer: Check report's heading and Close stay in the window. A short
  // window makes sure the page scrolls.
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.evaluate(() => {
    // The column scrolls inside itself (editing a field scrolled it), which
    // is not what this checks: start it at its own top.
    document.getElementById('sidePane').scrollTop = 0;
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.waitForTimeout(250);
  const end = await page.evaluate(() => {
    const side = document.getElementById('sidePane').getBoundingClientRect();
    return {
      scrolled: scrollY > 0,
      top: side.top,
      bottom: side.bottom,
      heading: document.getElementById('findingsHeading').getBoundingClientRect().top,
      footer: document.querySelector('.neo-footer').getBoundingClientRect().top,
    };
  });
  assert.ok(end.scrolled, 'The editor layout did not scroll at 1440 x 700, so the page-end check proves nothing');
  assert.ok(end.top >= 0 && end.heading >= 0, `At the page end the side column starts ${end.top}px from the top of the window`);
  assert.ok(end.bottom <= end.footer + 1, 'At the page end the side column runs into the footer');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#findingsPanel').getByRole('button', { name: 'Close' }).click();
  assert.equal(await page.locator('#findingsPanel').isVisible(), false);

  await page.getByRole('tab', { name: 'JSON', exact: true }).click();
  const source = JSON.parse(await page.locator('.editor-textarea').inputValue());
  assert.equal(source.dossier.title, 'Edited title');
  assert.equal(source.dossier.subtitle, 'Edited subtitle after response change');
  assert.equal(source.dossier.pages[0].blocks[0].right.value, 'A revised answer with specifics.');
  await page.waitForTimeout(400);

  // A stored report reopens directly, in the mode it was left in, with no
  // empty skeleton and never two bars on the way.
  await page.reload({ waitUntil: 'networkidle' });
  await checkFirstPaint(page, 'Reload of a stored report');
  assert.equal(await page.locator('.report-title').innerText(), 'Edited title');
  assert.equal(await page.locator('#toggleMode').innerText(), 'Done');
  assert.equal(await page.locator('#rail').isVisible(), true, 'The rail choice was not restored');
  assert.match(await page.locator('.editor-textarea').inputValue(), /Keep this paragraph/);
  await page.locator('.editor-textarea').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.editor-textarea').evaluate((el) => el === document.activeElement), false, 'Keyboard focus is trapped in the editor');

  // ── Keys: r toggles Edit and Done; ] moves to the next page ────────────────
  await page.locator('body').click({ position: { x: 5, y: 900 } });
  await page.keyboard.press('r');
  assert.equal(await page.locator('#toggleMode').innerText(), 'Edit');
  assert.equal(await page.locator('#sourcePane').isVisible(), false);
  await page.keyboard.press('r');
  assert.equal(await page.locator('#toggleMode').innerText(), 'Done');
  await page.keyboard.press('r');

  // ── Share and export: one dialog; s copies the link directly ───────────────
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  await page.locator('#shareReport').click();
  const exportDialog = page.locator('#exportDialog');
  await exportDialog.waitFor({ state: 'visible' });
  assert.equal(await exportDialog.locator('h2').innerText(), 'Share and export');
  const choices = await exportDialog.locator('.ds-export__choice strong').allInnerTexts();
  assert.deepEqual(choices, ['Copy link', 'One HTML file', 'JSON document', 'YAML document', 'Print or PDF', 'Presentation Sage deck']);
  assert.match(await exportDialog.locator('[data-action="copy-link"]').innerText(), /characters, which/);
  await exportDialog.getByRole('button', { name: 'Close' }).click();
  assert.equal(await page.locator('#shareReport').evaluate((el) => el === document.activeElement), true, 'Focus did not return to Share');
  await page.locator('body').click({ position: { x: 5, y: 900 } });
  await page.keyboard.press('e');
  await exportDialog.waitFor({ state: 'visible', timeout: 3000 }).catch(() => assert.fail('e did not open Share and export'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await page.waitForFunction(() => /Link copied/.test(document.getElementById('app-toast').textContent));
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(link, /#dz=/, 's did not copy a share link');
  assert.equal(await exportDialog.isVisible(), false, 's opened the dialog instead of copying');

  // ── Importing bad JSON retains the last valid report and keeps the input ───
  await page.locator('#openReport').click();
  await page.locator('#importText').fill('{ "broken": ');
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  assert.equal(await page.locator('#importDialog').isVisible(), true);
  assert.equal(await page.locator('.report-title').innerText(), 'Edited title');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Separate imports must not overwrite the saved comparison.
  await page.locator('#openReport').click();
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

  // ── Deleting the open report shows the next one; the last one, the welcome ─
  const deleteOpen = async () => {
    const current = page.locator('.ds-library__item[aria-current="true"] .ds-library__delete');
    await current.click();
    await current.click();
  };
  await deleteOpen();
  await page.locator('.report-title').filter({ hasText: 'Edited title' }).waitFor();
  assert.match(await page.locator('#app-toast').innerText(), /Deleted "Another report"/);
  await deleteOpen();
  await page.locator('#welcome').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#shell').isVisible(), false);
  assert.equal(await page.evaluate(async () => (await (await import('/js/store.js')).listReports()).length), 0);

  // The document's `chrome` field: shown opens the editor, hidden opens it for
  // reading, and auto leaves the reader where they are.
  const openWithChrome = async (chrome, title) => {
    await page.locator('#openReport').click();
    await page.locator('#importText').fill(JSON.stringify({ dossier: { version: 1, title, chrome, pages: [{ title: 'One', blocks: [{ type: 'prose', text: 'Text.' }] }] } }));
    await page.getByRole('button', { name: 'Open it', exact: true }).click();
    await page.locator('.report-title').filter({ hasText: title }).waitFor();
    return page.locator('html').getAttribute('data-dossier-mode');
  };
  assert.equal(await openWithChrome('shown', 'Opens in the editor'), 'build');
  assert.equal(await openWithChrome('auto', 'Stays in the editor'), 'build');
  assert.equal(await openWithChrome('hidden', 'Opens for reading'), 'read');
  assert.equal(await openWithChrome('auto', 'Stays for reading'), 'read');

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
  // The exported file has no Header Kit, so its report title stays the h1.
  assert.equal(await offline.locator('h1.report-title').count(), 1);
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

  // ── A shared link opens for reading, with the rail closed ──────────────────
  const shared = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const reader = await shared.newPage();
  reader.on('pageerror', (error) => errors.push(error.message));
  await reader.addInitScript(recordFrames);
  await reader.goto(`${base}/?check=link${new URL(link).hash}`, { waitUntil: 'networkidle' });
  await checkFirstPaint(reader, 'Shared link');
  assert.equal(await reader.locator('.report-title').innerText(), 'Edited title');
  assert.equal(await reader.locator('#reportOrigin').innerText(), 'Opened from a link');
  assert.equal(await reader.locator('html').getAttribute('data-dossier-mode'), 'read');
  assert.equal(await reader.locator('#rail').isVisible(), false, 'A shared link opened with the rail');
  await shared.close();

  // A link that will not load says why, then opens what this browser has
  // saved, rather than leaving the saved list behind the welcome screen.
  await page.goto(`${base}/?check=badlink#dz=AAAA`, { waitUntil: 'networkidle' });
  await page.locator('#stage .report-title').waitFor();
  assert.equal(await page.locator('#reportOrigin').innerText(), 'Saved in this browser');
  assert.equal(await page.locator('#welcome').isVisible(), false, 'A broken link left saved reports behind the welcome screen');
  assert.match(await page.locator('#app-toast').innerText(), /link/i, 'A broken link was not explained');
  // Once explained, the broken payload leaves the address, so a reload or the
  // next report opened does not carry it and fail again.
  assert.doesNotMatch(page.url(), /#dz=/, 'The broken link stayed in the address');

  // ── Slow and failed boots: never the shell before boot (check-boot.mjs) ──
  await checkBoot({ browser, base, errors });

  // ── A quick report switch must save the edit, never the newly opened example
  const switchingContext = await browser.newContext();
  const switching = await switchingContext.newPage();
  switching.on('pageerror', (error) => errors.push(error.message));
  await switching.goto(`${base}/?check=switching`, { waitUntil: 'networkidle' });
  const openExample = async (file) => {
    await switching.locator('#openReport').click();
    await switching.locator(`#openExamples [data-file="${file}"]`).click();
  };
  await openExample('responses.json');
  await switching.locator('.report-title').waitFor();
  await switching.locator('#toggleMode').click();
  await switching.locator('#formPane .form-field').filter({ has: switching.locator('label', { hasText: /^Title/ }) }).first().locator('input').fill('Edited sample');
  await openExample('executions.json');
  await switching.locator('.report-title').filter({ hasText: 'A faster run' }).waitFor();
  // Opening an example while editing keeps the editor open.
  assert.equal(await switching.locator('#toggleMode').innerText(), 'Done');
  await switching.getByRole('tab', { name: 'JSON', exact: true }).click();
  const execution = JSON.parse(await switching.locator('.editor-textarea').inputValue());
  execution.dossier.title = 'Edited execution';
  await switching.locator('.editor-textarea').fill(JSON.stringify(execution));
  await openExample('impact.json');
  await switching.waitForTimeout(500);
  const savedTitles = await switching.evaluate(async () => (await (await import('/js/store.js')).listReports()).map((row) => row.title).sort());
  assert.deepEqual(savedTitles, ['Edited execution', 'Edited sample'], 'A pending edit saved the wrong report');
  assert.equal(await switching.locator('#reportOrigin').innerText(), 'Example report · illustrative data');
  // The block catalog's Examples tab opens a report as well, and never
  // inserts an empty block into the one being edited.
  await switching.locator('#openCatalog').click();
  const catalog = switching.locator('dialog.catalog-dialog');
  await catalog.waitFor({ state: 'visible' });
  const examplesTab = catalog.getByRole('tab', { name: 'Examples', exact: true });
  await examplesTab.click();
  assert.equal(await examplesTab.getAttribute('aria-selected'), 'true');
  assert.equal(await catalog.getByRole('tab', { name: 'Blocks', exact: true }).getAttribute('aria-selected'), 'false');
  assert.equal(await catalog.locator('#catalogHeading').innerText(), 'Examples', 'The catalog is not titled Examples on its Examples tab');
  await catalog.locator('[data-template="executions.json"]').click();
  await switching.locator('.report-title').filter({ hasText: 'A faster run' }).waitFor();
  assert.equal(await catalog.isVisible(), false);
  assert.equal(await switching.locator('#stage .block-error').count(), 0, 'An example from the catalog inserted a broken block');
  assert.equal(await switching.locator('#reportOrigin').innerText(), 'Example report · illustrative data');
  await switchingContext.close();

  // ── Narrow windows (check-narrow.mjs) ──────────────────────────────────────
  await checkNarrow({ browser, base, errors });

  // ── The reading surface: tabs in view, the rail, print, line length ───────
  await checkReports({ browser, base, errors });

  assert.deepEqual(errors, [], 'Page raised JavaScript errors');
  console.log('Passed: one header from first paint and after H, welcome front door, report bar, rail, Edit and Done, Check report beside the editor and in the window at the page end, the Compare view and the skip link inside it, examples from Open and the block catalog, focus back from the phone menu, share and export dialog and keys, delete to welcome, shared links and broken links, slow and failed boots, persistence, rapid report switches, import recovery, YAML export, offline HTML, print, the phone menu over the drawer and 4 viewport sizes; then (check-reports.mjs) the current page tab in view at 390 and 1024 px, the rail beside a short report, its filter and cut outline links, disclosures on paper, and lines of 73 characters or fewer at every Line width in both faces, with Narrow, Normal and Wide still apart.');
} finally {
  await browser.close();
}
