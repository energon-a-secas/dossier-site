/**
 * The Reports view's Open dialog, and the other ways into it, in a browser:
 *
 * - "Choose a file" is a product button with the chosen file's name beside
 *   it, not the platform control (which wrote "Choose File" and "No file
 *   chosen" in its own case and language);
 * - every way the dialog closes empties it, so pressing Open again does not
 *   save a second copy of the last report, and choosing the same file again
 *   still reads it;
 * - a file that fails is named, not called "Pasted text";
 * - broken JSON is never called a Dossier document, and a failure is marked
 *   as an error in the dialog's own line, never only in a toast the modal
 *   covers (at 1280 and at 375 wide);
 * - a Markdown report with no front matter is named after its own H1, or
 *   its file, never "Document";
 * - a binary file (in a Compare column too), a file over the 2,000,000
 *   character cap and a `#dz=` link that unpacks past it are refused with a
 *   sentence, and nothing is saved.
 *
 * Run by scripts/check-html-import.mjs, or on its own against the dev
 * server: `node scripts/check-open-dialog.mjs` (DOSSIER_URL overrides
 * http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const base = process.env.DOSSIER_URL || 'http://127.0.0.1:8899';
const NOT_TEXT = 'This file is not text (a PDF, an image or an archive, for example), so Dossier cannot read it. Open a JSON, YAML, HTML, Markdown or plain-text report.';
const GOOD = JSON.stringify({ dossier: { version: 1, title: 'Open dialog good report', pages: [{ title: 'One', blocks: [{ type: 'prose', text: 'Fine.' }] }] } });
const TRUNCATED = '{"dossier": {"version": 1, "title": ';

/** A file payload for a file chooser. */
const fileOf = (name, body, mimeType = 'text/plain') => ({ name, mimeType, buffer: Buffer.isBuffer(body) ? body : Buffer.from(body) });

async function openDialog(page) {
  // Through the element, since a phone keeps the button in the kit's menu.
  await page.evaluate(() => document.getElementById('openReport').click());
  await page.locator('#importDialog').waitFor({ state: 'visible' });
}

async function choose(page, file) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#importDialog [data-action="import-choose-file"]').click(),
  ]);
  await chooser.setFiles(file);
}

async function saved(page) {
  return page.evaluate(async () => (await (await import('/js/store.js')).listReports()).map((r) => r.title));
}

async function line(page) {
  return page.evaluate(() => {
    const el = document.getElementById('importDetected');
    return {
      text: el.textContent,
      state: el.dataset.state || null,
      invalid: document.getElementById('importText').getAttribute('aria-invalid'),
      toast: (document.getElementById('app-toast')?.classList.contains('visible') && document.getElementById('app-toast').textContent) || '',
    };
  });
}

/** Empty the toast, so a toast seen after an action is that action's. */
async function quietToast(page) {
  await page.evaluate(() => {
    const toast = document.getElementById('app-toast');
    if (!toast) return;
    toast.textContent = '';
    toast.classList.remove('visible');
  });
}

async function fresh(browser, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/?check=open-dialog-${Date.now()}`, { waitUntil: 'networkidle' });
  await page.bringToFront();
  return { ctx, page, errors };
}

async function cleanUp(page) {
  await page.evaluate(() => {
    indexedDB.deleteDatabase('dossier');
    indexedDB.deleteDatabase('dossier-compare');
    localStorage.removeItem('dossier-site:preferences');
    localStorage.removeItem('dossier-site:appearance');
  }).catch(() => {});
}

/** @param {import('playwright').Browser} browser */
export async function checkOpenDialog(browser) {
  // ── Desktop: the file button, emptying on close, names and error states ──
  {
    const { ctx, page, errors } = await fresh(browser, { width: 1280, height: 900 });
    try {
      await openDialog(page);
      const button = page.locator('#importDialog [data-action="import-choose-file"]');
      assert.equal(await page.locator('#importFile').isVisible(), false, 'The platform file control still shows');
      assert.equal(await button.innerText(), 'Choose a file');
      const height = await button.evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(Math.abs(height - 36) <= 1, `Choose a file is ${height}px tall, not the 36px of the dialog's buttons`);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'import-choose-file', 'The dialog does not open on its file button');

      await choose(page, fileOf('good.json', GOOD, 'application/json'));
      await page.waitForFunction(() => document.getElementById('importFileName').textContent === 'good.json');
      assert.deepEqual(await line(page), { text: 'Looks like a Dossier document.', state: null, invalid: null, toast: '' });
      await page.locator('#importDialog [data-action="import-confirm"]').click();
      await page.locator('#importDialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(async () => (await (await import('/js/store.js')).listReports()).length === 1);

      // Reopened, the dialog is empty, and pressing Open saves nothing.
      await openDialog(page);
      await quietToast(page);
      assert.deepEqual(await page.evaluate(() => ({
        text: document.getElementById('importText').value.length,
        files: document.getElementById('importFile').files.length,
        name: document.getElementById('importFileName').textContent,
        line: document.getElementById('importDetected').textContent,
      })), { text: 0, files: 0, name: '', line: '' }, 'The Open dialog kept the last file or text');
      await page.locator('#importDialog [data-action="import-confirm"]').click();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#importDialog').isVisible(), true);
      assert.deepEqual(await line(page), { text: 'Paste a report or choose a file first.', state: 'error', invalid: 'true', toast: '' },
        'An empty Open it said nothing in the dialog, or said it in a toast under the modal');
      assert.deepEqual(await saved(page), ['Open dialog good report'], 'Open it saved the same report twice');

      // A chosen file that fails is named, in the dialog's line, as an error.
      await choose(page, fileOf('bad.json', TRUNCATED, 'application/json'));
      await page.waitForFunction(() => document.getElementById('importFileName').textContent === 'bad.json');
      assert.deepEqual(await line(page), { text: 'This JSON is not complete yet, or has a syntax error.', state: 'error', invalid: 'true', toast: '' },
        'Truncated JSON was described as a Dossier document, or not marked as an error');
      const color = await page.evaluate(() => {
        const el = document.getElementById('importDetected');
        const probe = document.createElement('span');
        probe.style.color = 'var(--danger)';
        el.append(probe);
        const out = [getComputedStyle(el).color, getComputedStyle(probe).color, getComputedStyle(el).borderLeftWidth];
        probe.remove();
        return out;
      });
      assert.equal(color[0], color[1], 'The error line is not in the danger colour');
      assert.equal(color[2], '3px');
      await quietToast(page);
      await page.locator('#importDialog [data-action="import-confirm"]').click();
      await page.waitForTimeout(200);
      const failed = await line(page);
      assert.equal(failed.text, 'bad.json could not be read. The JSON ends early: check for a missing }, ] or ".', 'A chosen file that failed was not named, or the parser spoke');
      assert.equal(failed.state, 'error');
      assert.equal(failed.toast, '', 'A failure in the dialog went to a toast under the modal');

      // Typing a valid document clears the error and forgets the file.
      await page.locator('#importText').fill(GOOD);
      assert.deepEqual(await line(page), { text: 'Looks like a Dossier document.', state: null, invalid: null, toast: '' });
      assert.equal(await page.locator('#importFileName').innerText(), '', 'The edited text still claims to be the chosen file');

      // The same file chosen again, across a close, is read again.
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await openDialog(page);
      await choose(page, fileOf('bad.json', TRUNCATED, 'application/json'));
      await page.waitForFunction(() => document.getElementById('importFileName').textContent === 'bad.json');

      // A binary file never reaches the paste box, and nothing is saved.
      await choose(page, fileOf('random.bin', crypto.randomBytes(300000), 'application/octet-stream'));
      await page.waitForFunction((t) => document.getElementById('importDetected').textContent === t, NOT_TEXT);
      assert.equal(await page.locator('#importText').inputValue(), '', 'Binary bytes were copied into the paste box');
      assert.equal(await page.locator('#importFileName').innerText(), '');
      assert.equal((await line(page)).state, 'error');

      // Over the cap: refused before the paste box, with the limit.
      await choose(page, fileOf('huge.md', `# Huge\n\n${'x'.repeat(2000001)}`, 'text/markdown'));
      await page.waitForFunction(() => /over the 2,000,000 character limit Dossier opens/.test(document.getElementById('importDetected').textContent));
      assert.match((await line(page)).text, /^huge\.md is 2,000,009 characters long/);
      assert.equal(await page.locator('#importText').inputValue(), '', 'An oversized file filled the paste box');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();

      // A Markdown report with no front matter is named after its H1.
      await openDialog(page);
      await choose(page, fileOf('roadmap.md', '# Alioth FY27 Roadmap: three bets\n\nWhy now.\n\n## Bet one\n\nSearch.\n\n## Bet two\n\nSync.', 'text/markdown'));
      await page.waitForFunction(() => /^Looks like Markdown/.test(document.getElementById('importDetected').textContent));
      await page.locator('#importDialog [data-action="import-confirm"]').click();
      await page.locator('#importDialog').waitFor({ state: 'hidden' });
      await page.locator('#stage .report-title').filter({ hasText: 'Alioth FY27 Roadmap: three bets' }).waitFor();
      assert.equal(await page.locator('#app-toast').innerText(), 'Opened the Markdown report "Alioth FY27 Roadmap: three bets".');
      assert.equal(await page.locator('#stage :is(h1, h2, h3):not(.report-title)', { hasText: 'Alioth FY27 Roadmap' }).count(), 0, 'The promoted H1 also shows as a page heading');
      await openDialog(page);
      await choose(page, fileOf('agent-run_3.md', '## Findings\n\nNothing found.', 'text/markdown'));
      await page.waitForFunction(() => /^Looks like Markdown/.test(document.getElementById('importDetected').textContent));
      await page.locator('#importDialog [data-action="import-confirm"]').click();
      await page.locator('#stage .report-title').filter({ hasText: 'agent run 3' }).waitFor();
      await page.waitForFunction(async () => (await (await import('/js/store.js')).listReports()).length === 3);
      assert.deepEqual((await saved(page)).sort(), ['Alioth FY27 Roadmap: three bets', 'Open dialog good report', 'agent run 3'],
        'A binary or oversized file was saved, or a Markdown report was not named after its own text');

      // Dropped on the page: a binary file is refused in the toast, unsaved.
      await page.evaluate(() => {
        const bytes = new Uint8Array(4096);
        crypto.getRandomValues(bytes);
        bytes[8] = 0;
        const data = new DataTransfer();
        data.items.add(new File([bytes], 'picture.png', { type: 'image/png' }));
        document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
      });
      await page.locator('#app-toast').filter({ hasText: 'picture.png could not be read. This file is not text' }).waitFor();
      assert.equal((await saved(page)).length, 3, 'A dropped binary file was saved');
      assert.equal(await page.locator('#stage .report-title').innerText(), 'agent run 3', 'A dropped binary file replaced the open report');
      assert.deepEqual(errors, [], 'The page raised errors');
    } finally {
      await cleanUp(page);
      await ctx.close();
    }
  }

  // ── Phone: a failure stays in the dialog, never under its backdrop ────────
  {
    const { ctx, page, errors } = await fresh(browser, { width: 375, height: 812 });
    try {
      await openDialog(page);
      await page.locator('#importText').fill('{"dossier": {');
      await page.locator('#importDialog [data-action="import-confirm"]').click();
      await page.waitForTimeout(200);
      assert.equal(await page.locator('#importDialog').isVisible(), true);
      const failed = await line(page);
      assert.equal(failed.text, 'The JSON ends early: check for a missing }, ] or ".');
      assert.equal(failed.toast, '', 'At 375 wide a failure went to a toast the dialog hides');
      await page.locator('#importText').fill('');
      await page.locator('#importDialog [data-action="import-confirm"]').click();
      await page.waitForTimeout(200);
      assert.equal((await line(page)).text, 'Paste a report or choose a file first.');
      const box = await page.evaluate(() => {
        const dialog = document.getElementById('importDialog').getBoundingClientRect();
        const button = document.querySelector('#importDialog [data-action="import-choose-file"]').getBoundingClientRect();
        return { right: button.right, edge: dialog.right, height: button.height };
      });
      assert.ok(box.right <= box.edge + 0.5, 'The Choose a file button runs past the Open dialog');
      assert.ok(Math.abs(box.height - 40) <= 1, `On a phone Choose a file is ${box.height}px tall, not 40px`);
      assert.deepEqual(errors, [], 'The page raised errors');
    } finally {
      await cleanUp(page);
      await ctx.close();
    }
  }

  // ── A Compare column refuses binary too, and saves no comparison ───────
  {
    const { ctx, page, errors } = await fresh(browser, { width: 1280, height: 900 });
    try {
      await page.goto(`${base}/?check=compare-binary-${Date.now()}#/~compare`, { waitUntil: 'networkidle' });
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('#cmp-col-k1 [data-action="cmp-choose-file"]').click(),
      ]);
      await chooser.setFiles(fileOf('scan.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(200000)]), 'application/pdf'));
      await page.locator('#app-toast').filter({ hasText: `scan.pdf: ${NOT_TEXT}` }).waitFor({ timeout: 5000 })
        .catch(() => assert.fail('A Compare column took a PDF without saying it is not text'));
      assert.equal(await page.locator('#cmp-col-k1 .col__scroll, #cmp-col-k1 .col__frame').count(), 0, 'A PDF became a Compare column');
      assert.equal(await page.evaluate(async () => (await (await import('/js/compare/store.js')).listSets()).length), 0, 'A PDF was saved as a comparison');
      assert.deepEqual(errors, [], 'The page raised errors');
    } finally {
      await cleanUp(page);
      await ctx.close();
    }
  }

  // ── A #dz= link that unpacks past the cap: refused as too large ──────────
  {
    const json = JSON.stringify({ dossier: { version: 1, title: 'Too big', pages: [{ title: 'P', blocks: [{ type: 'prose', text: 'a'.repeat(2000001) }] }] } });
    const link = `#dz=${deflateRawSync(Buffer.from(json)).toString('base64url')}`;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(`${base}/?check=dz-cap-${Date.now()}${link}`, { waitUntil: 'networkidle' });
      await page.locator('#app-toast').filter({ hasText: 'over the 2,000,000 character limit Dossier opens' }).waitFor({ timeout: 5000 })
        .catch(() => assert.fail('A #dz= link over the cap was not refused with the limit'));
      assert.match(await page.locator('#app-toast').innerText(), /^That link carries a report of 2,000,\d{3} characters/);
      assert.equal(await page.locator('#stage .report-title').count(), 0, 'A link over the cap opened a report');
      assert.equal(await page.locator('#welcome').isVisible(), true, 'A link over the cap left no welcome screen');
      assert.deepEqual(errors, [], 'The page raised errors');
    } finally {
      await cleanUp(page);
      await ctx.close();
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch();
  try {
    await checkOpenDialog(browser);
    console.log('Passed: the Open dialog\'s file button naming the chosen file, emptying on every close with no second save, a failed file named in the dialog\'s own error line and not in a toast under the modal (desktop and phone), broken JSON never called a Dossier document, Markdown named after its H1 or file, and binary files (in a Compare column too), files over the cap and a #dz= link over it refused unsaved.');
  } finally {
    await browser.close();
  }
}
