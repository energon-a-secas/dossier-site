/**
 * Browser regressions for moving through a report, run by
 * scripts/check-reports.mjs: focus after opening an example (from the
 * welcome screen and from the Open dialog), focus, an announcement and the
 * tab title after a page change (tabs, outline links, `[` and `]`), Check
 * report floating over the sheet while reading, the example cards named by
 * their titles, the shortcut sheet true in both views, and the two-press
 * delete. Each check opens its own browser context.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const COMPLETE = fileURLToPath(new URL('../fixtures/complete.json', import.meta.url));
const MESSY = fileURLToPath(new URL('../fixtures/messy.json', import.meta.url));
const TITLE = 'Two responses. A clearer decision.';

const STEPS = {
  exampleOpensWithFocus,
  pageChangesKeepFocus,
  checkReportFloats,
  examplesNamedByTitles,
  shortcutSheetFitsBothViews,
  deleteAsksAndWaits,
};

/** @param {{only?: string}} opts only: run one step by name, while working on it */
export async function checkReportFocus({ browser, base, errors, only }) {
  for (const [name, step] of Object.entries(STEPS)) {
    if (!only || only === name) await step({ browser, base, errors });
  }
}

async function fresh(browser, base, errors, label, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  await page.goto(`${base}/?check=${label}`, { waitUntil: 'networkidle' });
  await page.bringToFront();
  return { context, page };
}

const activeIs = (page, selector) => page.evaluate((sel) => Boolean(document.activeElement?.matches(sel)), selector);
const activeText = (page) => page.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.tagName);

/**
 * Enter on an example card: the card hides with the welcome screen, and focus
 * used to fall to the body, so the next Tab went to the footer (R24).
 */
async function exampleOpensWithFocus({ browser, base, errors }) {
  for (const route of ['welcome', 'dialog']) {
    const { context, page } = await fresh(browser, base, errors, `example-focus-${route}`);
    if (route === 'dialog') {
      await page.locator('#welcome [data-action="open"]').click();
      await page.locator('#openExamples .ds-example[data-file="responses.json"]').focus();
    } else {
      await page.locator('#welcomeExamples .ds-example[data-file="responses.json"]').focus();
    }
    await page.keyboard.press('Enter');
    await page.waitForSelector('body:not(.is-empty) #stage .report-title');
    await page.waitForFunction(() => document.activeElement !== document.body, null, { timeout: 2000 })
      .catch(() => assert.fail(`${route}: opening an example left focus on the body`));
    assert.ok(await activeIs(page, '#stage .report-title'), `${route}: focus is on ${await activeText(page)}, not the report title`);
    await page.keyboard.press('Tab');
    assert.ok(await activeIs(page, '#stage *'), `${route}: the Tab after opening an example went to ${await activeText(page)}`);
    assert.equal(await activeIs(page, '.neo-footer *'), false, `${route}: the Tab after opening an example went to the footer`);
    await context.close();
  }
}

/** Tabs, outline links, `[` and `]`: focus stays, the page is said, the title names it (R25). */
async function pageChangesKeepFocus({ browser, base, errors }) {
  const { context, page } = await fresh(browser, base, errors, 'page-focus');
  await page.locator('#welcomeExamples [data-file="responses.json"]').click();
  await page.locator('#stage .report-title').waitFor();
  const live = () => page.locator('#pageLive').textContent();
  const wantTitle = (p) => `${p} | ${TITLE} | Dossier`;

  // A tab: focus stays on the current tab, and the next Tab is the next tab.
  await page.locator('#stage .report-tab', { hasText: 'Scores & runs' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Scores/.test(document.querySelector('#stage .report-tab[aria-current="page"]')?.textContent));
  assert.ok(await activeIs(page, '#stage .report-tab[aria-current="page"]'), `After Enter on a tab focus is on ${await activeText(page)}`);
  assert.match(await activeText(page), /Scores & runs/);
  await page.keyboard.press('Tab');
  assert.match(await activeText(page), /Decision/, 'The Tab after a page change did not go to the next tab');
  await page.waitForFunction(() => document.getElementById('pageLive').textContent.length > 0);
  assert.equal(await live(), 'Page 2 of 3: Scores & runs');
  assert.equal(await page.title(), wantTitle('Scores & runs'));

  // An outline link: focus on that page's link in the rebuilt outline.
  await page.locator('#outline a.ds-outline__page', { hasText: 'Responses' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Responses/.test(document.querySelector('#stage .report-tab[aria-current="page"]')?.textContent));
  assert.ok(await activeIs(page, '#outline a.ds-outline__page[aria-current="page"]'), `After an outline link focus is on ${await activeText(page)}`);
  assert.equal(await page.title(), wantTitle('Responses'));

  // `]` with focus on the body: said, titled, and focus left alone.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(']');
  await page.waitForFunction(() => document.getElementById('pageLive').textContent === 'Page 2 of 3: Scores & runs');
  assert.equal(await page.title(), wantTitle('Scores & runs'));
  assert.ok(await page.evaluate(() => document.activeElement === document.body), '] moved focus that was on the body');

  // `]` with focus on a link inside the page: the new page's heading has it.
  await page.locator('#stage .report-page summary, #stage .report-page a[href], #stage .report-page button').first().focus();
  await page.keyboard.press(']');
  await page.waitForFunction(() => /Decision/.test(document.querySelector('#stage .report-tab[aria-current="page"]')?.textContent));
  assert.ok(await activeIs(page, '#stage .report-page__head h2'), `After ] from inside the page focus is on ${await activeText(page)}`);

  // Compare and back: the report's title, with its page, comes back.
  await page.locator('#viewCompare').click();
  await page.locator('#compareView .cmp-toolbar').waitFor();
  await page.locator('#viewReports').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'reports');
  assert.equal(await page.title(), wantTitle('Decision & next steps'));

  // Typing in the editor is not a page change, and is never announced.
  const before = await live();
  await page.locator('#toggleMode').click();
  await page.getByRole('tab', { name: 'JSON', exact: true }).click();
  await page.locator('.editor-textarea').press('End');
  await page.locator('.editor-textarea').type(' ');
  await page.waitForTimeout(400);
  assert.equal(await live(), before, 'An edit was announced as a page change');
  await context.close();
}

/** Check report floats over the sheet while reading, and never moves it (R34). */
async function checkReportFloats({ browser, base, errors }) {
  for (const width of [1440, 1024]) {
    const { context, page } = await fresh(browser, base, errors, `findings-${width}`, { viewport: { width, height: width === 1440 ? 900 : 768 } });
    await page.locator('#openReport').click();
    await page.locator('#importFile').setInputFiles(COMPLETE);
    await page.locator('#importDialog [data-action="import-confirm"]').click();
    await page.locator('#stage .report-title').filter({ hasText: 'Rate limiter fix' }).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-dossier-mode'), 'read');
    const sheet = () => page.evaluate(() => document.querySelector('#stage .report-shell').getBoundingClientRect().toJSON());
    const before = await sheet();
    await page.locator('#toggleFindings').click();
    await page.locator('#findingsPanel').waitFor();
    const after = await sheet();
    assert.ok(Math.abs(after.left - before.left) <= 1 && Math.abs(after.width - before.width) <= 1, `${width}px: Check report moved the sheet from ${before.left}/${before.width} to ${after.left}/${after.width}`);
    const box = await page.evaluate(() => ({
      panel: document.getElementById('findingsPanel').getBoundingClientRect().toJSON(),
      toggle: document.getElementById('toggleFindings').getBoundingClientRect().toJSON(),
    }));
    assert.ok(Math.abs(box.panel.right - after.right) <= 2, `${width}px: the popover's right edge is at ${box.panel.right}, the sheet's at ${after.right}`);
    assert.ok(box.panel.top >= box.toggle.bottom && box.panel.top <= box.toggle.bottom + 16, `${width}px: the popover's top is at ${box.panel.top}, the button ends at ${box.toggle.bottom}`);
    assert.ok(box.panel.left > after.left, `${width}px: the popover is wider than the sheet`);
    assert.ok(await activeIs(page, '#findingsPanel *'), `${width}px: opening Check report left focus on ${await activeText(page)}`);
    const below = await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('#stage')), { x: (box.panel.left + box.panel.right) / 2, y: box.panel.bottom + 40 });
    assert.ok(below, `${width}px: the report under the popover does not take the pointer`);
    // Escape closes it and puts focus back on the button.
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#findingsPanel').isVisible(), false, `${width}px: Escape did not close Check report`);
    assert.equal(await page.locator('#toggleFindings').getAttribute('aria-expanded'), 'false');
    assert.ok(await activeIs(page, '#toggleFindings'), `${width}px: Escape left focus on ${await activeText(page)}`);
    // Open again and scroll: it stays in the window, under the header.
    await page.locator('#toggleFindings').click();
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(200);
    const top = await page.evaluate(() => document.getElementById('findingsPanel').getBoundingClientRect().top);
    assert.ok(top >= 0 && top <= 56 + 16, `${width}px: after scrolling the popover's top is at ${top}`);
    // A press on the report closes it.
    const sheetNow = await sheet();
    const panelNow = await page.evaluate(() => document.getElementById('findingsPanel').getBoundingClientRect().toJSON());
    await page.mouse.click(sheetNow.left + 40, Math.min(panelNow.bottom + 40, 760));
    assert.equal(await page.locator('#findingsPanel').isVisible(), false, `${width}px: a press on the report did not close Check report`);
    await context.close();
  }

  // A report with errors opens for reading unobstructed; Edit docks the panel.
  const { context, page } = await fresh(browser, base, errors, 'findings-messy');
  await page.locator('#openReport').click();
  await page.locator('#importFile').setInputFiles(MESSY);
  await page.locator('#importDialog [data-action="import-confirm"]').click();
  await page.locator('#stage .report-title').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-dossier-mode'), 'read');
  assert.equal(await page.locator('#findingsPanel').isVisible(), false, 'A report with errors opened with Check report over it');
  assert.match(await page.locator('#findingsCount').getAttribute('class'), /is-error/);
  await page.locator('#toggleMode').click();
  await page.locator('#findingsPanel').waitFor();
  const docked = await page.evaluate(() => ({
    panel: document.getElementById('findingsPanel').getBoundingClientRect().left,
    stage: document.getElementById('stage').getBoundingClientRect().right,
  }));
  assert.ok(docked.panel >= docked.stage, 'In the editor Check report is not docked beside the report');
  await context.close();
}

/** Each example card is named by its title, with the rest as its description (R66). */
async function examplesNamedByTitles({ browser, base, errors }) {
  const { context, page } = await fresh(browser, base, errors, 'example-names');
  const welcome = page.locator('#welcomeExamples');
  for (const name of ['Example comparison: human, agent and fixes', TITLE]) {
    assert.equal(await welcome.getByRole('button', { name, exact: true }).count(), 1, `No welcome card is named "${name}"`);
  }
  const problems = (list) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} .ds-example`)].flatMap((button) => {
    const out = [];
    const label = document.getElementById(button.getAttribute('aria-labelledby') || '');
    if (!label || label !== button.querySelector('.ds-example__title')) out.push(`${button.textContent.slice(0, 30)}: not named by its title`);
    for (const id of (button.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)) {
      const el = document.getElementById(id);
      if (!el || !button.contains(el)) out.push(`${button.textContent.slice(0, 30)}: description ${id} is missing or outside it`);
    }
    if (!button.getAttribute('aria-describedby')) out.push(`${button.textContent.slice(0, 30)}: no description`);
    return out;
  }), list);
  assert.deepEqual(await problems('#welcomeExamples'), []);
  await page.locator('#welcome [data-action="open"]').click();
  assert.deepEqual(await problems('#openExamples'), []);
  const duplicates = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('#welcomeExamples [id], #openExamples [id]')].map((el) => el.id);
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  });
  assert.deepEqual(duplicates, [], 'Two example cards share an id');
  await context.close();
}

/** The `?` sheet: every label true in Reports and in Compare (R58). */
async function shortcutSheetFitsBothViews({ browser, base, errors }) {
  const { context, page } = await fresh(browser, base, errors, 'sheet');
  for (const hash of ['#/~compare', '#/']) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(200);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('?');
    const sheet = page.locator('dialog.nk-sheet');
    await sheet.waitFor({ state: 'visible' });
    const text = await sheet.innerText();
    for (const label of ['Find a report or comparison', 'Previous page or change', 'Next page or change']) {
      assert.ok(text.includes(label), `${hash}: the shortcut sheet does not say "${label}"`);
    }
    assert.doesNotMatch(text, /Find a saved report|Next page\n|JSON, YAML, print or a deck\n/, `${hash}: the shortcut sheet still describes Reports only`);
    await page.keyboard.press('Escape');
  }
  await context.close();
}

/**
 * The two-press delete (R54): the first press says so in the toast (a live
 * region), and the button stays armed while it has focus, with no time
 * limit; Escape and focus leaving it disarm it, so coming back starts again.
 */
async function deleteAsksAndWaits({ browser, base, errors }) {
  const { context, page } = await fresh(browser, base, errors, 'delete-confirm');
  await page.locator('#openReport').click();
  await page.locator('#importText').fill(JSON.stringify({ dossier: { version: 1, title: 'To delete', pages: [{ title: 'One', blocks: [{ type: 'prose', text: 'Text.' }] }] } }));
  await page.locator('#importDialog [data-action="import-confirm"]').click();
  await page.waitForFunction(() => document.getElementById('reportOrigin').textContent === 'Saved in this browser');
  const button = page.locator('.ds-library__item[aria-current="true"] .ds-library__delete');
  const armed = () => button.getAttribute('data-confirm');
  await button.focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#app-toast').innerText(), /Press Delete again to remove "To delete"\./, 'Arming the delete was not announced');
  assert.equal(await armed(), 'armed');
  assert.equal(await button.getAttribute('aria-label'), 'Delete To delete: press again to confirm');
  await page.waitForTimeout(5000);
  assert.equal(await armed(), 'armed', 'The delete disarmed on a timer while it had focus');
  await page.keyboard.press('Escape');
  assert.equal(await armed(), null, 'Escape did not disarm the delete');
  assert.equal((await button.innerText()).trim(), 'Delete');
  // Armed, then away and back: the next press arms again rather than deleting.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.ok(await activeIs(page, '.ds-library__delete'), 'Tab did not come back to the delete button');
  assert.equal(await armed(), null, 'Leaving the button did not disarm it');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.locator('#welcome').waitFor({ state: 'visible' });
  assert.match(await page.locator('#app-toast').innerText(), /Deleted "To delete"/);
  await context.close();
}
