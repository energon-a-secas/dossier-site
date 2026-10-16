/**
 * Browser checks for the numbers that changed in a Compare column
 * (js/compare/numbers.js): the button in a column's head, the list it opens
 * and the way from each item to its change, the numbers kept marked in a
 * column shown with margin bars only, the head growing at most a line, a
 * phone with no sideways scroll, and the one-file export keeping the count
 * as words. A list of differences, never a score.
 *
 * Run against the dev server: `node scripts/check-compare-numbers.mjs`
 * (DOSSIER_URL overrides http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  base, watch, openExample, focusOn, noOverflow, out,
} from './check-helpers.mjs';

const browser = await chromium.launch();
const errors = [];
const fresh = () => `${base}/?check=numbers&v=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const HUMAN = [
  '# EOL roadmap',
  '',
  '- **1,105** Redis 6 nodes',
  '- 40 Postgres clusters',
  '',
  'Extended support would cost $19.8M in surcharges over 3 years.',
  '',
  'The review board meets every second Tuesday to look at the progress so far and to agree on the next steps for each team in turn.',
  '',
  'Each team keeps its own list of end of life dates in a spreadsheet that nobody else reads, and the lists rarely agree with each other.',
  '',
  'Vendors announce dates with little warning, so the board keeps a margin of a quarter before every published end of support.',
].join('\n');
const AGENT = [
  '# EOL roadmap',
  '',
  '- **1,150** Redis 6 nodes',
  '- 40 Postgres clusters',
  '',
  'Extended support would cost $21.4M in surcharges over 3 years.',
  '',
  'A steering group gathers monthly to review status across every program and publishes a short written summary afterwards.',
  '',
  'Ownership of upgrade tracking moves to a central registry, which replaces scattered documents with one shared source of truth.',
  '',
  'Automated alerts warn service owners well ahead of support deadlines, removing the need for manual calendar reminders.',
].join('\n');

/** Paste Markdown into a column. */
async function paste(page, colId, text) {
  await page.locator(`#cmp-col-${colId} [data-action="cmp-paste"]`).click();
  await page.locator(`#cmp-col-${colId} textarea`).fill(text);
  await page.locator(`#cmp-col-${colId} form`).getByRole('button', { name: 'Use this text' }).click();
  await page.locator(`#cmp-col-${colId} .col__scroll`).waitFor();
}

try {
  // ── The example: C fixes two of B's figures ───────────────────────────────
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  watch({ page, errors });
  await page.goto(fresh(), { waitUntil: 'networkidle' });
  await page.bringToFront();
  await openExample(page);
  await page.waitForFunction(() => /^1 of \d+$/.test(document.querySelector('.counter__main')?.textContent || ''));
  const button = page.locator('#cmp-col-k3 .col__nums');
  assert.equal(await button.innerText(), '2 numbers changed');
  assert.equal(await page.locator('#cmp-col-k1 .col__nums, #cmp-col-k2 .col__nums').count(), 0, 'Only C changes numbers against its source');
  // The button grows the shared head row by a line at most.
  const heads = () => page.locator('#cmp-col-k3 .col__head').evaluate((el) => el.getBoundingClientRect().height);
  const withButton = await heads();
  await page.evaluate(() => { document.querySelector('#cmp-col-k3 .col__nums').style.display = 'none'; });
  const without = await heads();
  await page.evaluate(() => { document.querySelector('#cmp-col-k3 .col__nums').style.display = ''; });
  assert.ok(withButton - without <= 24, `The numbers button made the head ${withButton - without}px taller`);

  await button.click();
  const list = page.locator('#cmpNumbers');
  await list.waitFor();
  assert.equal(await button.getAttribute('aria-expanded'), 'true');
  assert.match(await list.locator('h2').innerText(), /^Numbers changed from B$/);
  const items = await list.locator('.nums__list li').evaluateAll((lis) => lis.map((li) => {
    const c = li.cloneNode(true);
    c.querySelectorAll('.visually-hidden, .nums__where, button').forEach((e) => e.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  }));
  assert.deepEqual(items, ['3.4 → 2.9', '4.1% → 6.2%']);
  await page.keyboard.press('Escape');
  assert.equal(await list.isVisible(), false, 'Escape closes the list');
  await focusOn(page, '#cmp-col-k3 .col__nums', 'Escape returns focus to the button');
  await button.click();
  await list.locator('[data-action="cmp-number-go"]').first().click();
  assert.equal(await list.isVisible(), false, 'Show closes the list');
  await page.waitForFunction(() => document.querySelector('.counter__main')?.textContent === '4 of 15');
  assert.equal(await page.locator('#cmp-col-k3 .u-current').getAttribute('data-chg'), '4');
  await focusOn(page, '#cmp-col-k3 .col__nums', 'Show returns focus to the button');
  assert.match(await page.locator('#cmpLive').innerText(), /^Change 4 of 15 in C\.$/);

  // The one-file export keeps the count as words, with no button.
  await page.locator('#shareReport').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="cmp-export-html"]').click()]);
  const saved = out('compare-numbers-export.html');
  await download.saveAs(saved);
  const file = await fs.readFile(saved, 'utf8');
  assert.match(file, /<span class="col__nums">2 numbers changed<\/span>/);
  assert.ok(!/<button[^>]*col__nums/.test(file), 'The file has a numbers button it cannot open');

  // At 390, one column at a time: no sideways scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await noOverflow(page, 'Numbers at 390');
  await context.close();

  // ── Two Markdown reports, too different for word marks ────────────────────
  const second = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await second.newPage();
  watch({ page: p2, errors });
  await p2.goto(fresh(), { waitUntil: 'networkidle' });
  await p2.bringToFront();
  await p2.locator('#welcome [data-action="view"][data-view="compare"]').click();
  await p2.locator('#compareView .cmp-toolbar').waitFor();
  await paste(p2, 'k1', HUMAN);
  await paste(p2, 'k2', AGENT);
  await p2.waitForFunction(() => document.querySelector('#cmp-col-k2 .col__nums'));
  assert.match(await p2.locator('#cmp-col-k2 .col-note').first().innerText(), /Too different from A to mark word by word\.[\s\S]*Numbers that changed are still marked\./);
  const item = p2.locator('#cmp-col-k2 li.u-bar-chg').first();
  assert.equal(await item.locator('del').count(), 1);
  assert.equal(await item.locator('ins').count(), 1);
  assert.match(await item.locator('del').innerText(), /1,105/);
  assert.match(await item.locator('ins').innerText(), /1,150/);
  assert.equal(await p2.locator('#cmp-col-k2 .col__nums').innerText(), '2 numbers changed');
  await p2.locator('#cmp-col-k2 [data-action="cmp-word-marks"]').click();
  await p2.waitForFunction(() => document.querySelector('#cmp-col-k2 [data-action="cmp-word-marks"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await p2.locator('#cmp-col-k2 .col__nums').innerText(), '2 numbers changed', 'Word marks on keeps the list');
  await p2.locator('#cmp-col-k2 [data-action="cmp-word-marks"]').click();
  await p2.waitForFunction(() => document.querySelector('#cmp-col-k2 [data-action="cmp-word-marks"]')?.getAttribute('aria-pressed') === 'false');
  assert.equal(await p2.locator('#cmp-col-k2 .col__nums').innerText(), '2 numbers changed', 'and so does Word marks off');
  await second.close();

  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: "2 numbers changed" in the head of the example\'s Fixes column only, the head a line taller at most, its list (3.4 to 2.9, 4.1% to 6.2%) closed by Escape with focus back, Show going to change 4 with the counter and the announcement, the count kept as words in the one-file export, no sideways scroll at 390, and two Markdown reports too different for word marks keeping 1,105 to 1,150 marked, saying so, with the list kept through Word marks on and off.');
} finally {
  await browser.close();
}
