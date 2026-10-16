/** Display options, the header mark, and complete HTML artifacts, including isolation and offline use. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.DOSSIER_URL || 'http://127.0.0.1:8899';
const browser = await chromium.launch();
const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await fs.mkdir('.verify', { recursive: true });

async function exportHtml(target) {
  return target.evaluate(async () => {
    const { exportStandaloneHtml } = await import('/js/export.js');
    const { state } = await import('/js/state.js');
    let captured;
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return original.call(URL, blob); };
    try { await exportStandaloneHtml(state.model); }
    finally { URL.createObjectURL = original; }
    return captured.text();
  });
}

/** Choose a theme in the Display dialog, the way a reader does. */
async function chooseTheme(target, label) {
  const dialog = target.locator('#displayDialog');
  const menu = target.locator('.header-overflow-toggle');
  if (await menu.isVisible()) await menu.click();
  await target.locator('#displayOptions').click();
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('radio', { name: label, exact: true }).check();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}

async function checkContrast(target) {
  const ratio = await target.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    function luminance(color) {
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      const linear = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
        const c = value / 255;
        return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      });
      return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
    }
    const text = luminance(getComputedStyle(document.querySelector('.report-subtitle')).color);
    const bg = luminance(getComputedStyle(document.querySelector('.report-shell')).backgroundColor);
    return (Math.max(text, bg) + .05) / (Math.min(text, bg) + .05);
  });
  assert.ok(ratio >= 4.5, `Text contrast is ${ratio}`);
}

try {
  await page.goto(`${base}/?check=appearance`, { waitUntil: 'networkidle' });
  // The page's one mark is the Header Kit's, painted from this site's logo.svg.
  assert.equal(await page.locator('.header-bar .header-logo-mark').isVisible(), true);
  assert.match(await page.locator('.header-bar .header-logo-mark').evaluate((el) => getComputedStyle(el).maskImage), /logo\.svg/);
  assert.equal(await page.locator('.ds-logo, #toggleAppearance').count(), 0, 'The old toolbar logo or Dark mode button is back');
  await page.locator('#welcomeExamples [data-file="responses.json"]').click();
  await page.locator('.report-title').waitFor();
  // System is the default, and follows the operating system.
  assert.equal(await page.locator('html').getAttribute('data-appearance'), 'dark');
  await page.locator('#displayOptions').click();
  assert.equal(await page.locator('#displayDialog').getByRole('radio', { name: 'System', exact: true }).isChecked(), true);
  await page.locator('#displayDialog').getByRole('button', { name: 'Close', exact: true }).click();
  await checkContrast(page);
  await page.screenshot({ path: '.verify/appearance-dark.png', fullPage: true });
  await chooseTheme(page, 'Light');
  assert.equal(await page.locator('html').getAttribute('data-appearance'), 'light');
  await checkContrast(page);
  // Reopened, the dialog starts on the choice in effect, so Space cannot
  // quietly switch a reader back to System; Close returns focus to Aa.
  await page.locator('#displayOptions').click();
  assert.equal(await page.locator('#displayDialog').getByRole('radio', { name: 'Light', exact: true }).evaluate((el) => el === document.activeElement), true, 'Display options did not start on the checked theme');
  await page.locator('#displayDialog').getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.locator('#displayOptions').evaluate((el) => el === document.activeElement), true, 'Focus did not return to Display options');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('data-appearance'), 'light', 'Explicit light choice was lost');
  await page.locator('#welcomeExamples [data-file="responses.json"]').click();
  await page.locator('.report-title').waitFor();
  await page.screenshot({ path: '.verify/appearance-light.png', fullPage: true });
  await chooseTheme(page, 'Dark');
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await page.locator('html').getAttribute('data-appearance'), 'dark', 'OS preference overrode the saved choice');
  await chooseTheme(page, 'System');
  assert.equal(await page.locator('html').getAttribute('data-appearance'), 'light', 'System did not follow the operating system');
  await page.emulateMedia({ colorScheme: 'dark' });
  // The media query's change event arrives on a later task than emulateMedia.
  await page.waitForFunction(() => document.documentElement.dataset.appearance === 'dark', null, { timeout: 3000 })
    .catch(() => assert.fail('System did not follow a change of the operating system'));
  await page.emulateMedia({ colorScheme: 'light' });
  await chooseTheme(page, 'Dark');
  assert.equal(await page.locator('html').getAttribute('data-appearance'), 'dark');
  await fs.writeFile('.verify/dark-report.html', await exportHtml(page));

  await page.locator('#openReport').click();
  await page.locator('#importFile').setInputFiles('fixtures/foreign/presentation.html');
  await page.waitForFunction(() => document.getElementById('importDetected').textContent.startsWith('HTML report.'));
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  assert.equal(await page.locator('#importDialog').isVisible(), false);
  assert.equal(await page.locator('.report-title').innerText(), 'Sample HTML presentation');
  const frame = page.frameLocator('#stage iframe');
  await frame.locator('body[data-ready="true"]').waitFor();
  assert.equal(await page.locator('#stage iframe').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await frame.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(238, 242, 246)', 'Head styles were dropped');
  await frame.getByRole('button', { name: 'Next page' }).click();
  assert.equal(await frame.locator('#second').isVisible(), true);
  await frame.locator('#amount').fill('230');
  await frame.locator('#amount').dispatchEvent('input');
  assert.equal(await frame.locator('#measurement').getAttribute('width'), '230', 'Chart interaction failed');

  const requests = [];
  await context.route('https://example.invalid/**', (route) => { requests.push(route.request().url()); return route.abort(); });
  const isolation = await frame.locator('body').evaluate(async () => {
    let parentBlocked = false, storageBlocked = false, networkBlocked = false;
    try { parent.document.body; } catch { parentBlocked = true; }
    try { localStorage.getItem('dossier-site:preferences'); } catch { storageBlocked = true; }
    try { await fetch('https://example.invalid/network-test'); } catch { networkBlocked = true; }
    return { parentBlocked, storageBlocked, networkBlocked };
  });
  assert.deepEqual(isolation, { parentBlocked: true, storageBlocked: true, networkBlocked: true });
  assert.deepEqual(requests, [], 'Imported HTML attempted a network request');
  await page.reload({ waitUntil: 'networkidle' });
  await page.frameLocator('#stage iframe').locator('body[data-ready="true"]').waitFor();
  assert.equal(await page.locator('.report-title').innerText(), 'Sample HTML presentation', 'Saved HTML did not restore');
  assert.equal(await page.locator('html').getAttribute('data-appearance'), 'dark');
  await fs.writeFile('.verify/html-import-export.html', await exportHtml(page));

  const offlineContext = await browser.newContext();
  const offline = await offlineContext.newPage();
  const offlineRequests = [];
  await offline.route('**/*', (route) => {
    if ([`${base}/.verify/html-import-export.html`, `${base}/.verify/dark-report.html`].includes(route.request().url())) return route.continue();
    offlineRequests.push(route.request().url()); return route.abort();
  });
  await offline.goto(`${base}/.verify/html-import-export.html`);
  const exportedFrame = offline.frameLocator('iframe');
  await exportedFrame.locator('body[data-ready="true"]').waitFor();
  await exportedFrame.getByRole('button', { name: 'Next page' }).click();
  assert.equal(await exportedFrame.locator('#second').isVisible(), true);
  assert.deepEqual(offlineRequests, [], 'Export needs a hosted helper or another network resource');
  await offline.goto(`${base}/.verify/dark-report.html`);
  assert.equal(await offline.locator('html').getAttribute('data-appearance'), 'dark');
  await checkContrast(offline);
  const screenBg = await offline.locator('.report-shell').evaluate((el) => getComputedStyle(el).backgroundColor);
  await offline.emulateMedia({ media: 'print' });
  const printBg = await offline.locator('.report-shell').evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.notEqual(screenBg, printBg, 'Printing a dark export did not use the paper palette');
  await offlineContext.close();

  // Paste and drop use the same import path as the file picker.
  const source = await fs.readFile('fixtures/foreign/presentation.html', 'utf8');
  await page.evaluate((html) => {
    const data = new DataTransfer();
    data.items.add(new File([html], 'another-report.html', { type: 'text/html' }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  }, source);
  await page.waitForFunction(async () => (await (await import('/js/store.js')).listReports()).length === 2);
  await page.frameLocator('#stage iframe').locator('body[data-ready="true"]').waitFor();
  await page.locator('#openReport').click();
  await page.locator('#importText').fill('# A Markdown report\n\nA preserved paragraph.');
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  await page.locator('.block-prose').filter({ hasText: 'A preserved paragraph.' }).waitFor();

  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    // The kit moves controls into its menu from a media query change event,
    // which lands on a later task than the resize. Read nothing until the
    // menu matches the width: hidden above 700 px, shown at or below it.
    await page.waitForFunction((w) => {
      const overflow = document.querySelector('.header-overflow');
      return !overflow || overflow.hidden === (w > 700);
    }, width, { timeout: 3000 }).catch(() => assert.fail(`${width}px: the header menu never settled`));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}px viewport overflows`);
    assert.equal(await page.locator('.header-bar .header-logo-mark').isVisible(), true);
    const bars = await page.evaluate(() => [...document.querySelectorAll('.header-bar')].filter((el) => el.getClientRects().length).length);
    assert.equal(bars, 1, `${width}px shows ${bars} header bars`);
    // Display options stay reachable: in the bar, or in the kit's menu on a phone.
    const phone = width <= 700;
    if (phone) await page.locator('.header-overflow-toggle').click();
    assert.equal(await page.locator('#displayOptions').isVisible(), true, `${width}px hides Display options`);
    if (phone) {
      await page.keyboard.press('Escape');
      await page.locator('#displayOptions').waitFor({ state: 'hidden' });
    }
  }
  await page.screenshot({ path: '.verify/appearance-tablet.png', fullPage: true });
  assert.deepEqual(errors, [], 'Page raised JavaScript errors');
  console.log('Passed: logo, system and saved themes, contrast, paper printing, HTML file/paste/drop imports, styles, charts, controls, sandbox isolation, persistence, offline exports and responsive layout.');
} finally {
  await browser.close();
}
