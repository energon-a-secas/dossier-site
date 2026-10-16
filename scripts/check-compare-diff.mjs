/**
 * Browser checks for what the Compare view's differences are marked
 * against, and where they land:
 *
 *   - a Fixes column getting its report changes what the columns are marked
 *     against: it is said, with an Undo that keeps the choice from before;
 *     a base picked by hand, even the default one, stays where it is
 *   - at 768 px, where three columns do not fit, previous and next change
 *     bring their column into view sideways, the page itself unmoved
 *   - a table's header row holds no hidden words and no ghost row: its
 *     column headers are named "UTC" and "Event"
 *   - with C as the base, a section another column has under a different
 *     heading is matched by its wording
 *   - with the Sections panel open, a toolbar click does not build its
 *     matrix again when the headings did not change (counted with V8's
 *     precise coverage, so the machine's load does not matter)
 *
 * Run against the dev server: `node scripts/check-compare-diff.mjs`
 * (DOSSIER_URL overrides http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  base, watch, openExample, chooseFile,
} from './check-helpers.mjs';

const browser = await chromium.launch();
const errors = [];
const fresh = () => `${base}/?check=diff&v=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A new comparison with the human draft in A and the agent output in B. */
async function twoReports(context) {
  const page = await context.newPage();
  watch({ page, errors });
  await page.goto(fresh(), { waitUntil: 'networkidle' });
  await page.bringToFront();
  await page.locator('#welcome [data-action="view"][data-view="compare"]').click();
  await page.locator('#compareView .cmp-toolbar').waitFor();
  await chooseFile(page, 'k1', 'reports/compare/human-draft.html');
  await chooseFile(page, 'k2', 'reports/compare/agent-output.md');
  await page.waitForFunction(() => document.querySelector('#cmp-col-k1 .tag--base'));
  return page;
}

/** Add a Fixes column (it fixes B, the last column that is not a fix) and give it its report. */
async function addFixes(page) {
  await page.locator('[data-action="cmp-add-menu"]:visible').first().click();
  await page.locator('#cmpAddMenu [data-action="cmp-add-column"][data-role="fix"]').click();
  await page.locator('#cmp-col-k3 [data-action="cmp-choose-file"]').waitFor();
  await chooseFile(page, 'k3', 'reports/compare/fixes.html');
}

const storedBase = (page) => page.evaluate(async () => (await import('/js/compare/index.js')).compare.set.view.diff.base);

try {
  // ── A Fixes column gets its report: said, with an Undo ───────────────────
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await twoReports(context);
    assert.equal(await page.locator('#cmpAgainst .rb').innerText(), 'A');
    await addFixes(page);
    const toast = page.locator('#cmpToast');
    await page.waitForFunction(() => /Differences are now marked against each column's source/.test(document.querySelector('#cmpToast')?.textContent || ''));
    assert.match(await toast.innerText(), /C against B, the column it fixes, and the rest against A/);
    assert.equal(await page.locator('#cmpAgainst .picker__name').innerText(), 'its source');
    assert.match(await page.locator('#cmp-col-k3 .col__diff').innerText(), /\d+ differences from B/);
    assert.match(await page.locator('#cmp-col-k2 .col__diff').innerText(), /\d+ differences from A/, 'B still reads against A');
    await toast.locator('button', { hasText: 'Undo' }).click();
    await page.waitForFunction(() => document.querySelector('#cmpAgainst .rb')?.textContent === 'A');
    assert.equal(await storedBase(page), 'k1', 'Undo keeps A, chosen');
    assert.match(await page.locator('#cmp-col-k3 .col__diff').innerText(), /\d+ differences from A/);
    await page.waitForFunction(() => document.activeElement?.id === 'cmpAgainst');
    await context.close();
  }

  // ── A base picked by hand stays, even the one that was the default ───────
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await twoReports(context);
    await page.locator('#cmpAgainst').click();
    await page.locator('#cmpDiffMenu [data-action="cmp-set-base"][data-col="k1"]').click();
    await page.waitForFunction(() => /stay marked against A/.test(document.querySelector('#app-toast')?.textContent || ''));
    assert.equal(await storedBase(page), 'k1', 'Picking the default base made no choice');
    await page.keyboard.press('Escape');
    await addFixes(page);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#cmpAgainst .rb').innerText(), 'A', 'A base picked by hand moved');
    assert.ok(!/Differences are now marked/.test(await page.locator('#cmpToast').innerText()), 'A move was said that did not happen');
    assert.match(await page.locator('#cmp-col-k3 .col__diff').innerText(), /\d+ differences from A/);
    await context.close();
  }

  // ── 768 px: a step brings its column into view sideways ───────────────────
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ viewport: { width: 768, height: 1024 }, reducedMotion });
    const page = await context.newPage();
    watch({ page, errors, label: `768 ${reducedMotion}: ` });
    await page.goto(fresh(), { waitUntil: 'networkidle' });
    await page.bringToFront();
    await openExample(page);
    await page.waitForFunction(() => /^1 of \d+$/.test(document.querySelector('.counter__main')?.textContent || ''));
    assert.equal(await page.locator('#cmpColumns').evaluate((el) => el.scrollLeft), 0);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press(']');
    await page.waitForFunction(() => /^2 of \d+$/.test(document.querySelector('.counter__main')?.textContent || ''));
    const inView = () => page.evaluate(() => {
      const r = document.querySelector('#compareView .u-current')?.getBoundingClientRect();
      return Boolean(r) && r.left >= 0 && r.right <= innerWidth;
    });
    if (reducedMotion === 'reduce') assert.ok(await inView(), 'The change is not in view at once with reduced motion');
    else await page.waitForFunction(() => {
      const r = document.querySelector('#compareView .u-current')?.getBoundingClientRect();
      return Boolean(r) && r.left >= 0 && r.right <= innerWidth;
    });
    assert.ok(await page.locator('#cmpColumns').evaluate((el) => el.scrollLeft) > 0, 'The row of columns did not scroll');
    assert.equal(await page.evaluate(() => scrollY), 0, 'The page scrolled');
    await context.close();
  }

  // ── The example with B as the base: a table head, and Sections by wording ─
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    watch({ page, errors });
    await page.goto(fresh(), { waitUntil: 'networkidle' });
    await page.bringToFront();
    await openExample(page);
    await page.locator('#cmpAgainst').click();
    await page.locator('#cmpDiffMenu [data-action="cmp-set-base"][data-col="k2"]').click();
    await page.waitForFunction(() => document.querySelector('#cmp-col-k2 .tag--base'));
    await page.keyboard.press('Escape');
    const head = page.locator('#cmp-col-k1 .r-table').first();
    assert.equal(await head.locator('thead th .visually-hidden').count(), 0, 'Hidden words in a column header');
    assert.equal(await head.locator('thead .ghost-row').count(), 0, 'A ghost row in the table head');
    const snapshot = await head.locator('table').ariaSnapshot();
    assert.deepEqual([...snapshot.matchAll(/columnheader "([^"]*)"/g)].map((m) => m[1]), ['UTC', 'Event']);

    // C as the base: A's "Follow-up actions" is C's "Action items", by its wording.
    await page.locator('#cmpAgainst').click();
    await page.locator('#cmpDiffMenu [data-action="cmp-set-base"][data-col="k3"]').click();
    await page.waitForFunction(() => document.querySelector('#cmp-col-k3 .tag--base'));
    await page.keyboard.press('Escape');
    await page.locator('.cmp-toolbar [data-action="cmp-panel"][data-panel="sections"]').click();
    await page.locator('#cmpPanel .secmap').waitFor();
    const row = page.locator('#cmpPanel .secmap tr', { hasText: 'Action items' }).first();
    assert.match(await row.locator('td[data-col="k1"]').innerText(), /By wording/);
    assert.match(await row.locator('button').innerText(), /A has it as "Follow-up actions", matched by wording/);
    assert.match(await page.locator('#cmpPanel .coverage').innerText(), /matched by wording/);
    await context.close();
  }

  // ── The Sections panel open: a toolbar click builds nothing again ─────────
  {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1000 } });
    const page = await context.newPage();
    watch({ page, errors });
    await page.goto(fresh(), { waitUntil: 'networkidle' });
    await page.locator('#welcome [data-action="view"][data-view="compare"]').click();
    await page.locator('#compareView .cmp-toolbar').waitFor();
    const topics = ['cache', 'queue', 'deploy', 'owner'];
    const big = `# Big\n\n${Array.from({ length: 60 }, (_, i) => `## Heading number ${i} about the ${topics[i % 4]}\n\n${'lorem ipsum dolor sit amet '.repeat(20)}`).join('\n\n')}`;
    await page.evaluate(async (text) => {
      const { api } = await import('/js/compare/index.js');
      const { newSet, addColumn } = await import('/js/compare/model.js');
      let set = newSet({ title: 'Sixty sections' });
      const src = (t, name) => ({ kind: 'markdown', name, text: t });
      set = addColumn(set, { role: 'human', source: src(text, 'a.md') }).set;
      set = addColumn(set, { role: 'agent', source: src(text.replace(/number 1/g, 'no. 1'), 'b.md') }).set;
      set = addColumn(set, { role: 'other', source: src(text.replace(/about the/g, 'regarding the'), 'c.md') }).set;
      set = addColumn(set, { role: 'other', source: src(text.replace(/Heading/g, 'Section'), 'd.md') }).set;
      api.openSet(set, { saved: false });
    }, big);
    await page.waitForFunction(() => document.querySelectorAll('#compareView .col__scroll').length === 4);
    await page.bringToFront();
    await page.locator('.cmp-toolbar [data-action="cmp-panel"][data-panel="sections"]').click();
    await page.locator('#cmpPanel .secmap').waitFor();
    await page.waitForTimeout(500);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
    const builds = async () => {
      const { result } = await cdp.send('Profiler.takePreciseCoverage');
      let n = 0;
      for (const script of result) {
        if (!/compare\/(sections-panel|align)\.js/.test(script.url)) continue;
        for (const fn of script.functions) if (fn.functionName === 'buildSections' || fn.functionName === 'sectionMatrix') n += fn.ranges[0].count;
      }
      return n;
    };
    await builds();
    const click = (opt) => page.evaluate(async (o) => {
      document.querySelector(`#compareView [data-action="cmp-diff-opt"][data-opt="${o}"]`).click();
      await new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); });
    }, opt);
    for (let i = 0; i < 6; i += 1) await click('showRemoved');
    assert.equal(await builds(), 0, 'Show removed words built the Sections matrix again');
    for (let i = 0; i < 4; i += 1) await click('ignoreCase');
    await page.waitForTimeout(300);
    const again = await builds();
    assert.ok(again <= 4 * 2, `Ignore case built the Sections matrix ${again / 2} times a click`);
    // The count sees a build when there is one: a new base changes every row.
    await page.evaluate(() => document.querySelector('#cmpDiffMenu [data-action="cmp-set-base"][data-col="k2"]').click());
    await page.waitForFunction(() => document.querySelector('#cmp-col-k2 .tag--base'));
    assert.ok(await builds() >= 1, 'The coverage count does not see the matrix being built');
    await cdp.send('Profiler.stopPreciseCoverage');
    await context.close();
  }

  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: a Fixes column getting its report said with an Undo that keeps A chosen, focus back on the picker, and a base picked by hand staying put when a fix arrives; at 768 px a step bringing its column into view sideways with the page unmoved, smooth and with reduced motion; a table head with no hidden words or ghost row and its headers named UTC and Event; a section matched by its wording with C as the base; and the Sections panel not built again by Show removed words, and at most once a click by Ignore case.');
} finally {
  await browser.close();
}
