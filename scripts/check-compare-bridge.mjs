/**
 * Browser checks for the way between the Reports view and Compare
 * (js/compare/bridge.js): the report bar's Compare button starting a
 * comparison from the report being read (unsaved, focus on the empty
 * column, Back to the report), hidden beside the editor; "Use a saved
 * report" filling a column from the library, and saying so when the library
 * is empty; and the Open dialog, in Compare, adding to a column instead of
 * leaving, while in Reports it still reads "Open it". Also the report bar at
 * 390 px with the button on its second row.
 *
 * Run against the dev server: `node scripts/check-compare-bridge.mjs`
 * (DOSSIER_URL overrides http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  base, watch, noOverflow, focusOn,
} from './check-helpers.mjs';

const browser = await chromium.launch();
const errors = [];
const HTML = '<!doctype html><html><head><title>Bridge report</title></head><body><h1>Bridge report</h1><h2>Plan for the bridge</h2><p>Ship the bridge in October.</p></body></html>';
const MARKDOWN = '# Pasted into C\n\n## Findings\n\nThe pasted report.\n';

const savedSets = (page) => page.evaluate(async () => (await (await import('/js/compare/store.js')).listSets()).length);

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  watch({ page, errors });
  await page.goto(`${base}/?check=compare-bridge`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-dossier-booting'));

  // ── (1) Reports: an HTML report, then Compare with another report ────────
  await page.locator('#openReport').click();
  await page.locator('#importDialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#importToColumn').isHidden(), true, 'Reports offers to add to a column');
  assert.equal(await page.locator('#importConfirm').innerText(), 'Open it');
  await page.locator('#importText').fill(HTML);
  await page.locator('#importConfirm').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'reports' && !document.getElementById('importDialog').open);
  const compareButton = page.getByRole('button', { name: 'Compare with another report' });
  await compareButton.waitFor();
  assert.equal(await compareButton.isVisible(), true);
  await compareButton.click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'compare');
  assert.equal(await page.evaluate(() => location.hash), '#/~compare');
  await page.locator('#cmp-col-k1 .reader').waitFor();
  assert.equal(await page.locator('#cmp-col-k1 .col__kind').innerText(), 'HTML');
  assert.match(await page.locator('#cmp-col-k1 .reader').innerText(), /Plan for the bridge/);
  assert.equal(await page.locator('#cmp-col-k2.col--empty').count(), 1, 'B is not the empty slot');
  await focusOn(page, '#cmp-col-k2 [data-action="cmp-choose-file"]', 'Compare did not put focus on B');
  assert.equal(await savedSets(page), 0, 'Starting a comparison from a report saved it before anything was added');
  await page.goBack();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'reports');
  assert.match(await page.title(), /^Bridge report \| Dossier$/, 'Back did not return to the report');

  // ── (2) Beside the editor the button waits for Done ──────────────────────
  await page.locator('#toggleMode').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierMode === 'build');
  assert.equal(await page.locator('#compareReport').isVisible(), false, 'Compare shows beside the editor');
  await page.locator('#toggleMode').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierMode !== 'build');
  assert.equal(await page.locator('#compareReport').isVisible(), true, 'Done did not bring Compare back');

  // ── (3) Compare: "Use a saved report" fills B from the library ───────────
  await page.locator('#viewCompare').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'compare');
  await page.locator('#cmp-col-k2 [data-action="cmp-use-saved"]').click();
  const menu = page.locator('#cmpColumnMenu.cmp-menu--saved');
  await menu.waitFor();
  assert.equal(await menu.getAttribute('aria-label'), 'Saved reports for column B');
  const pick = menu.locator('[data-action="cmp-use-saved-pick"]', { hasText: 'Bridge report' });
  assert.equal(await pick.count(), 1, 'The saved HTML report is not listed');
  await focusOn(page, '#cmpColumnMenu [role="menuitem"]', 'The menu did not take focus');
  await pick.click();
  await page.locator('#cmp-col-k2 .reader').waitFor();
  assert.equal(await page.locator('#cmp-col-k2.col--empty').count(), 0);
  assert.equal(await page.locator('#cmp-col-k2 .col__kind').innerText(), 'HTML');
  await page.waitForFunction(() => /^#\/~compare\/c-/.test(location.hash));
  assert.equal(await page.locator('#cmpColumnMenu').evaluate((el) => el.classList.contains('cmp-menu--saved')), false, 'The menu kept the saved-reports look after closing');

  // ── (4) Compare: the Open dialog adds to a column ────────────────────────
  await page.locator('.cmp-toolbar [data-action="cmp-add-menu"]').click();
  await page.locator('#cmpAddMenu [data-action="cmp-add-column"][data-role="other"]').click();
  await page.locator('#cmp-col-k3.col--empty').waitFor();
  await page.locator('#openReport').click();
  await page.locator('#importDialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#importToColumn').innerText(), 'Add to column C');
  assert.equal(await page.locator('#importConfirm').innerText(), 'Read on its own');
  assert.equal(await page.locator('#importConfirm').evaluate((el) => el.classList.contains('btn--primary')), false, 'Two primary buttons');
  await page.locator('#importText').fill(MARKDOWN);
  await page.locator('#importToColumn').click();
  await page.waitForFunction(() => !document.getElementById('importDialog').open);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.dossierView), 'compare', 'Adding to a column left Compare');
  await page.locator('#cmp-col-k3 .reader').waitFor();
  assert.equal(await page.locator('#cmp-col-k3 .col__kind').innerText(), 'Markdown');
  await page.waitForFunction(() => document.getElementById('cmp-col-k3').contains(document.activeElement));
  // With four columns filled or not, a full comparison offers a new column.
  await page.locator('#openReport').click();
  await page.locator('#importDialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#importToColumn').innerText(), 'Add as column D');
  await page.keyboard.press('Escape');
  // In Reports the dialog opens as it always did.
  await page.locator('#viewReports').click();
  await page.waitForFunction(() => document.documentElement.dataset.dossierView === 'reports');
  await page.locator('#openReport').click();
  await page.locator('#importDialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#importToColumn').isHidden(), true);
  assert.equal(await page.locator('#importConfirm').innerText(), 'Open it');
  await page.keyboard.press('Escape');

  // ── (6) The report bar at 390: Compare on its second row ─────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await noOverflow(page, 'Reports with the report bar at 390');
  const rows = await page.evaluate(() => {
    const top = (id) => Math.round(document.getElementById(id).getBoundingClientRect().top);
    return { compare: top('compareReport'), check: top('toggleFindings'), edit: top('toggleMode') };
  });
  assert.ok(rows.compare > rows.edit, `Compare is on the first row (${rows.compare} against ${rows.edit})`);
  assert.equal(rows.compare, rows.check, 'Compare is not beside Check report');
  await context.close();

  // ── (5) A fresh browser: an empty library says so, with no menu ──────────
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const fp = await fresh.newPage();
  watch({ page: fp, errors });
  await fp.goto(`${base}/?check=compare-bridge-empty`, { waitUntil: 'networkidle' });
  await fp.locator('#welcome [data-action="view"][data-view="compare"]').click();
  await fp.locator('#compareView .cmp-toolbar').waitFor();
  await fp.locator('#cmp-col-k1 [data-action="cmp-use-saved"]').click();
  await fp.waitForFunction(() => /No reports are saved in this browser yet/.test(document.getElementById('app-toast')?.textContent || ''));
  assert.equal(await fp.locator('#cmpColumnMenu').isVisible(), false, 'An empty library opened a menu');
  await fresh.close();

  assert.deepEqual(errors, [], 'The page raised errors');
  console.log('Passed: the report bar\'s Compare starting an unsaved comparison from an HTML report (A as HTML, B empty with focus on Choose a file, Back to the report), hidden beside the editor and back after Done, Use a saved report filling B from the library and saving the comparison, the Open dialog in Compare adding to column C (then offering column D) with Read on its own as the second choice and focus in the column, Open it in Reports as before, the report bar at 390 with no sideways scroll and Compare on its second row, an empty library said in a toast with no menu, and no console error.');
} finally {
  await browser.close();
}
