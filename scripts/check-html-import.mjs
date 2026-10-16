/**
 * Display options, the header mark, and imported HTML reports: static by
 * default, sized to their document with working links and an outline, in
 * Dossier format on request, running their scripts only when asked (and then
 * isolated), and exported offline in the view on screen.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { checkFitAndCopies } from './check-html-import-fit.mjs';

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

/** Frames on the page that carry both allow-scripts and allow-same-origin: never any. */
async function sandboxClash(target) {
  return target.evaluate(() => [...document.querySelectorAll('iframe')]
    .filter((f) => {
      const tokens = (f.getAttribute('sandbox') || '').split(/\s+/);
      return tokens.includes('allow-scripts') && tokens.includes('allow-same-origin');
    })
    .map((f) => f.title || f.className));
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

/**
 * The palette's main pairs, measured as rendered (WCAG 2.x ratio, alpha
 * composited over its background the way the browser paints it): reading
 * text, secondary and muted ink, the header bar's labels on each gradient
 * stop, and the difference marks from their token values. Text needs 4.5:1;
 * a line, a bar or a focus ring needs 3:1. Design spec section 4 has the
 * full table these are taken from.
 */
async function checkPalette(target, label) {
  const failures = await target.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const paint = (...colors) => {
      ctx.clearRect(0, 0, 1, 1);
      for (const color of colors) { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); }
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (rgb) => {
      const [r, g, b] = rgb.map((value) => {
        const c = value / 255;
        return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      });
      return r * .2126 + g * .7152 + b * .0722;
    };
    const ratio = (fg, bg) => {
      const back = paint('#fff', bg);
      const front = paint('#fff', bg, fg);
      const [hi, lo] = [luminance(front), luminance(back)].sort((a, b) => b - a);
      return (hi + .05) / (lo + .05);
    };
    const root = getComputedStyle(document.documentElement);
    const token = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();
    const color = (selector, prop = 'color') => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el)[prop] : null;
    };
    const paper = color('.report-shell', 'backgroundColor');
    const desk = getComputedStyle(document.body).backgroundColor;
    const bar = document.querySelector('.header-bar');
    const stops = ['--header-bg-start', '--header-bg-mid', '--header-bg-end'].map((name) => token(name, bar));
    const pairs = [
      ['reading text on paper', color('.report-title'), paper, 4.5],
      ['secondary text on paper', root.getPropertyValue('--text-secondary'), paper, 4.5],
      ['muted text on paper', root.getPropertyValue('--text-muted'), paper, 4.5],
      ['muted text on desk', root.getPropertyValue('--text-muted'), desk, 4.5],
      ['report bar text on desk', color('.ds-reportbar'), desk, 4.5],
      ['tab number on manila', root.getPropertyValue('--text-muted'), root.getPropertyValue('--manila'), 4.5],
      // A hovered tab takes the stronger manila, and its number secondary ink.
      ['tab number on a hovered tab', root.getPropertyValue('--text-secondary'), root.getPropertyValue('--manila-strong'), 4.5],
      ['primary button label', root.getPropertyValue('--on-action'), root.getPropertyValue('--action'), 4.5],
      ['focus ring on paper', root.getPropertyValue('--focus'), paper, 3],
      ['focus ring on desk', root.getPropertyValue('--focus'), desk, 3],
      ['text on an inserted word', root.getPropertyValue('--text-primary'), root.getPropertyValue('--diff-ins-word'), 4.5],
      ['deleted word in secondary ink', root.getPropertyValue('--text-secondary'), root.getPropertyValue('--diff-del-word'), 4.5],
      ['text in a changed unit', root.getPropertyValue('--text-primary'), root.getPropertyValue('--diff-change-unit'), 4.5],
      ['current change tag', root.getPropertyValue('--on-accent'), root.getPropertyValue('--diff-current'), 4.5],
      ['insertion underline on its tint', root.getPropertyValue('--diff-ins-line'), root.getPropertyValue('--diff-ins-word'), 3],
      ['deletion strike on its tint', root.getPropertyValue('--diff-del-line'), root.getPropertyValue('--diff-del-word'), 3],
    ];
    stops.forEach((stop, i) => {
      pairs.push([`header button label, stop ${i + 1}`, color('#openReport'), stop, 4.5]);
      pairs.push([`header subtitle, stop ${i + 1}`, color('.header-subtitle'), stop, 4.5]);
      pairs.push([`header focus ring, stop ${i + 1}`, token('--header-focus', bar), stop, 3]);
      const [r, g, b] = paint(stop, token('--header-current-bg', bar));
      pairs.push([`current view label, stop ${i + 1}`, color('#viewReports'), `rgb(${r}, ${g}, ${b})`, 4.5]);
    });
    return pairs
      .map(([name, fg, bg, need]) => {
        if (!fg || !bg) return `${name}: not measurable`;
        const measured = ratio(fg, bg);
        return measured >= need ? null : `${name}: ${measured.toFixed(2)}:1, needs ${need}:1`;
      })
      .filter(Boolean);
  });
  assert.deepEqual(failures, [], `${label}: contrast below the palette's floor`);
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
  await checkPalette(page, 'Dark');
  await page.screenshot({ path: '.verify/appearance-dark.png', fullPage: true });
  await chooseTheme(page, 'Light');
  assert.equal(await page.locator('html').getAttribute('data-appearance'), 'light');
  await checkContrast(page);
  await checkPalette(page, 'Light');
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

  // ── An imported HTML report opens static; its scripts run only on request ──
  await page.locator('#openReport').click();
  await page.locator('#importFile').setInputFiles('fixtures/foreign/presentation.html');
  await page.waitForFunction(() => document.getElementById('importDetected').textContent.startsWith('HTML report.'));
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  assert.equal(await page.locator('#importDialog').isVisible(), false);
  assert.equal(await page.locator('.report-title').innerText(), 'Sample HTML presentation');
  const still = page.locator('#stage iframe.block-embed--static');
  await still.waitFor();
  assert.equal(await still.getAttribute('sandbox'), 'allow-same-origin', 'A scripted import did not open static');
  const frame = page.frameLocator('#stage iframe.block-embed--static');
  await frame.locator('#first h1').waitFor();
  assert.equal(await frame.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(238, 242, 246)', 'Head styles were dropped');
  assert.equal(await frame.locator('body').getAttribute('data-ready'), null, 'The report ran its script in the static view');
  assert.equal(await frame.locator('#second').isVisible(), false);
  await page.getByRole('button', { name: 'Run the report’s scripts' }).click();
  const sealed = page.locator('#stage iframe.block-embed--interactive');
  const live = page.frameLocator('#stage iframe.block-embed--interactive');
  await live.locator('body[data-ready="true"]').waitFor();
  assert.equal(await sealed.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await sealed.getAttribute('src'), 'embed.html');
  assert.equal(await page.locator('#stage iframe.block-embed--static').count(), 0, 'The static frame stayed beside the scripted one');
  await live.getByRole('button', { name: 'Next page' }).click();
  assert.equal(await live.locator('#second').isVisible(), true);
  await live.locator('#amount').fill('230');
  await live.locator('#amount').dispatchEvent('input');
  assert.equal(await live.locator('#measurement').getAttribute('width'), '230', 'Chart interaction failed');

  const requests = [];
  await context.route('https://example.invalid/**', (route) => { requests.push(route.request().url()); return route.abort(); });
  const isolation = await live.locator('body').evaluate(async () => {
    let parentBlocked = false, storageBlocked = false, networkBlocked = false;
    try { parent.document.body; } catch { parentBlocked = true; }
    try { localStorage.getItem('dossier-site:preferences'); } catch { storageBlocked = true; }
    try { await fetch('https://example.invalid/network-test'); } catch { networkBlocked = true; }
    return { parentBlocked, storageBlocked, networkBlocked };
  });
  assert.deepEqual(isolation, { parentBlocked: true, storageBlocked: true, networkBlocked: true });
  assert.deepEqual(requests, [], 'Imported HTML attempted a network request');
  assert.deepEqual(await sandboxClash(page), [], 'A frame is both scripted and same origin');
  await page.reload({ waitUntil: 'networkidle' });
  // The choice is the reader's and is remembered for this report.
  await page.frameLocator('#stage iframe.block-embed--interactive').locator('body[data-ready="true"]').waitFor();
  assert.equal(await page.locator('.report-title').innerText(), 'Sample HTML presentation', 'Saved HTML did not restore');
  assert.equal(await page.locator('html').getAttribute('data-appearance'), 'dark');
  await fs.writeFile('.verify/html-import-export.html', await exportHtml(page));
  await page.getByRole('button', { name: 'Run the report’s scripts' }).click();
  await page.locator('#stage iframe.block-embed--static').waitFor();
  // Reader state, never document state.
  const blockKeys = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return Object.keys(state.document.dossier.pages[0].blocks[0]).sort();
  });
  assert.deepEqual(blockKeys, ['html', 'scripts', 'type'], 'The view choice was written into the document');

  // ── A tall static report: one scroll, working links, the outline, Dossier format ──
  const remote = [];
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => { remote.push(route.request().url()); return route.abort(); });
  requests.length = 0;
  await page.locator('#openReport').click();
  await page.locator('#importFile').setInputFiles('fixtures/embed/tall-report.html');
  await page.waitForFunction(() => document.getElementById('importDetected').textContent.startsWith('HTML report.'));
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  const tall = page.frameLocator('#stage iframe.block-embed--static');
  await tall.locator('#costs').waitFor();
  const fitted = () => page.waitForFunction(() => {
    const f = document.querySelector('#stage iframe.block-embed--static');
    const d = f?.contentDocument?.documentElement;
    return Boolean(d && parseFloat(f.style.height) > 1500 && d.scrollHeight <= d.clientHeight + 1
      && Math.abs(f.getBoundingClientRect().height - d.scrollHeight) <= 2);
  }, null, { timeout: 5000 }).catch(() => assert.fail('The static frame was not sized to its document'));
  await fitted();
  const fit = await page.evaluate(() => {
    const f = document.querySelector('#stage iframe.block-embed--static');
    return { height: f.getBoundingClientRect().height, held: f.getAttribute('data-embed-fit'), ran: f.contentDocument.body.dataset.ran || null };
  });
  assert.ok(fit.height < 10000, `The full-screen hero ran the frame away to ${fit.height}px`);
  assert.equal(fit.held, '', 'The frame stopped fitting its document');
  assert.equal(fit.ran, null, 'The report ran its script in the static view');
  assert.equal(await page.locator('.embed-note').filter({ hasText: 'were not loaded' }).count(), 1, 'Nothing said what the frame did not load');
  await page.waitForTimeout(1300);
  assert.equal(await page.evaluate(() => document.querySelector('#stage iframe').contentWindow.location.href), 'about:srcdoc', 'A meta refresh moved the frame');
  assert.deepEqual([...requests, ...remote], [], 'The static view fetched from another site');
  // Opening a disclosure grows the frame instead of scrolling it.
  const closedHeight = fit.height;
  await tall.locator('summary').click();
  await page.waitForFunction((h) => document.querySelector('#stage iframe.block-embed--static').getBoundingClientRect().height > h + 40, closedHeight, { timeout: 3000 })
    .catch(() => assert.fail('The frame did not grow with its document'));
  await fitted();
  // A web link opens a new tab with no way back to this page, and the report stays.
  const [popup] = await Promise.all([context.waitForEvent('page'), tall.getByRole('link', { name: 'payments runbook' }).click()]);
  assert.equal(await popup.evaluate(() => window.opener).catch(() => null), null, 'The new tab can reach this page');
  await popup.close();
  assert.ok(requests.some((url) => url.includes('/runbook')), 'The web link did not open');
  assert.equal(await page.evaluate(() => document.querySelector('#stage iframe').contentWindow.location.href), 'about:srcdoc');
  await tall.getByRole('link', { name: 'appendix beside this file' }).click();
  await page.locator('#app-toast').filter({ hasText: 'beside the report' }).waitFor();
  assert.equal(await tall.locator('a', { hasText: 'this script link' }).getAttribute('href'), null, 'A script link survived the static copy');
  // An in-page link scrolls the page, since the frame has nothing to scroll.
  const headingTop = (id) => page.evaluate((key) => {
    const f = document.querySelector('#stage iframe.block-embed--static');
    return f.getBoundingClientRect().top + f.contentDocument.getElementById(key).getBoundingClientRect().top;
  }, id);
  await page.evaluate(() => scrollTo(0, 0));
  await tall.getByRole('link', { name: 'Costs' }).click();
  await page.waitForFunction(() => {
    const f = document.querySelector('#stage iframe.block-embed--static');
    const top = f.getBoundingClientRect().top + f.contentDocument.getElementById('costs').getBoundingClientRect().top;
    return top >= 0 && top < 200;
  }, null, { timeout: 4000 }).catch(async () => assert.fail(`An in-page link left its target at ${await headingTop('costs')}px`));
  assert.equal(page.url().includes('#costs'), false, 'An in-page link changed the page address');
  // The rail lists the report's headings and reaches them in the Original view.
  const outlineNames = await page.locator('#outline a').allInnerTexts();
  for (const name of ['Summary', 'Why it happened', 'Costs', 'Follow-up']) assert.ok(outlineNames.includes(name), `The outline is missing "${name}": ${outlineNames.join(', ')}`);
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('#outline a', { hasText: 'Impact' }).click();
  await page.waitForFunction(() => {
    const f = document.querySelector('#stage iframe.block-embed--static');
    const h = [...f.contentDocument.querySelectorAll('h2')].find((el) => el.textContent === 'Impact');
    const top = f.getBoundingClientRect().top + h.getBoundingClientRect().top;
    return top >= 0 && top < 200 && f.contentDocument.activeElement === h;
  }, null, { timeout: 4000 }).catch(() => assert.fail('The outline did not bring the heading, and focus, to it in the Original view'));
  // Dossier format: the same headings, in the reader's typography.
  await page.getByRole('button', { name: 'Dossier format', exact: true }).click();
  const reader = page.locator('#stage .block-embed-reader');
  await reader.waitFor();
  assert.equal(await page.locator('#stage .block-embed-html iframe').count(), 0, 'Dossier format kept a frame');
  const readerHeadings = await reader.locator('.r-h').allInnerTexts();
  for (const name of ['Summary', 'Timeline', 'Costs', 'Appendix: the queries']) assert.ok(readerHeadings.includes(name), `Dossier format lost "${name}"`);
  assert.match(await reader.locator('p:not(.embed-note)').first().evaluate((el) => getComputedStyle(el).fontFamily), /Iowan|Charter|Georgia|serif/);
  // The report's sections sit one level under the report's title, with no
  // level skipped (its h1 is outside `main`, so its sections open at h2),
  // and its text and notes start at the title's left edge.
  const shape = await page.evaluate(() => {
    const shell = document.querySelector('.report-shell');
    const tags = [...shell.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => h.getClientRects().length).map((h) => Number(h.localName[1]));
    const left = (selector) => Math.round(shell.querySelector(selector).getBoundingClientRect().left);
    const width = (selector) => Math.round(shell.querySelector(selector).getBoundingClientRect().width);
    return {
      tags,
      title: left('.report-title'),
      doc: left('.block-embed-reader .reader__doc'),
      note: left('.block-embed-reader .embed-note'),
      docWidth: width('.block-embed-reader .reader__doc'),
      noteWidth: width('.block-embed-reader .embed-note'),
      face: getComputedStyle(shell.querySelector('.block-embed-reader .r-h')).fontFamily,
    };
  });
  assert.equal(shape.tags[0], 2, 'The report title is not the first heading');
  assert.equal(shape.tags[1], 3, `Dossier format's first heading is h${shape.tags[1]}, not one under the title`);
  shape.tags.forEach((level, i) => assert.ok(i === 0 || level <= shape.tags[i - 1] + 1, `Dossier format skips from h${shape.tags[i - 1]} to h${level}`));
  assert.ok(Math.abs(shape.doc - shape.title) <= 1, `Dossier format text starts ${shape.doc - shape.title}px from the title`);
  assert.ok(Math.abs(shape.note - shape.doc) <= 1 && Math.abs(shape.noteWidth - shape.docWidth) <= 1, `The notice (${shape.noteWidth}px) is not the text column's width (${shape.docWidth}px)`);
  assert.match(shape.face, /Iowan|Charter|Georgia|serif/, 'Dossier format headings left the reading face');
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('#outline a', { hasText: 'Why it happened' }).click();
  await page.waitForFunction(() => {
    const el = document.activeElement;
    const top = el?.getBoundingClientRect().top;
    return el?.classList.contains('r-h') && el.textContent === 'Why it happened' && top >= 0 && top < 200;
  }, null, { timeout: 4000 }).catch(() => assert.fail('The outline did not reach the heading in Dossier format'));
  assert.deepEqual([...remote], [], 'Dossier format fetched from another site');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
    for (const view of ['Original', 'Dossier format']) {
      await page.getByRole('button', { name: view, exact: true }).click();
      if (view === 'Original') await fitted();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}px ${view} overflows the page`);
    }
  }
  // The file carries the view on screen: Original, here.
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await fitted();
  await fs.writeFile('.verify/html-import-static.html', await exportHtml(page));
  // Printed from the browser's menu, the frame gives way on paper to a
  // Dossier format copy, which goes once printing is over.
  await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  const paper = await page.evaluate(() => ({
    frame: getComputedStyle(document.querySelector('#stage .block-embed__frame')).display,
    copy: document.querySelector('#stage .block-embed__print')?.getClientRects().length > 0,
    headings: [...document.querySelectorAll('#stage .block-embed__print .r-h')].map((h) => h.textContent),
    block: getComputedStyle(document.querySelector('#stage .block:has(.block-embed__frame)')).breakInside,
  }));
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  assert.equal(paper.frame, 'none', 'The frame prints, sliced at each page break');
  assert.equal(paper.copy, true, 'Nothing prints in the frame\'s place');
  assert.ok(paper.headings.includes('Costs'), 'The printed copy lost the report\'s sections');
  assert.equal(paper.block, 'auto', 'The block moves whole to the next page when printed');
  assert.equal(await page.locator('#stage .block-embed__print').count(), 0, 'The printed copy stayed after printing');
  assert.equal(await page.locator('#stage iframe.block-embed--static').count(), 1, 'Printing rebuilt the frame');
  // Running its scripts, the report is handed over without the loads its
  // sealed frame refuses (a remote font, a remote image, a refresh), so the
  // console holds no refusals for them.
  const refusals = [];
  const onConsole = (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/i.test(message.text())) refusals.push(message.text());
  };
  page.on('console', onConsole);
  await page.getByRole('button', { name: 'Run the report’s scripts' }).click();
  await page.frameLocator('#stage iframe.block-embed--interactive').locator('body[data-ran="true"]').waitFor();
  await page.waitForTimeout(300);
  page.off('console', onConsole);
  assert.deepEqual(refusals, [], 'The scripted view logged refused loads');
  await page.getByRole('button', { name: 'Run the report’s scripts' }).click();
  await fitted();
  await context.unroute(/fonts\.(googleapis|gstatic)\.com/);

  const offlineContext = await browser.newContext();
  const offline = await offlineContext.newPage();
  const offlineRequests = [];
  const exports = ['html-import-export.html', 'html-import-static.html', 'dark-report.html'].map((name) => `${base}/.verify/${name}`);
  await offline.route('**/*', (route) => {
    if (exports.includes(route.request().url())) return route.continue();
    offlineRequests.push(route.request().url()); return route.abort();
  });
  await offline.goto(`${base}/.verify/html-import-export.html`);
  const exportedFrame = offline.frameLocator('iframe');
  await exportedFrame.locator('body[data-ready="true"]').waitFor();
  assert.equal(await offline.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  await exportedFrame.getByRole('button', { name: 'Next page' }).click();
  assert.equal(await exportedFrame.locator('#second').isVisible(), true);
  // The static view travels as a static frame, fitted to its document by the
  // file's own script, with its in-page links still working.
  await offline.goto(`${base}/.verify/html-import-static.html`);
  assert.equal(await offline.locator('iframe').getAttribute('sandbox'), 'allow-same-origin');
  await offline.waitForFunction(() => {
    const f = document.querySelector('iframe');
    const d = f?.contentDocument?.documentElement;
    return Boolean(d && parseFloat(f.style.height) > 1500 && d.scrollHeight <= d.clientHeight + 1);
  }, null, { timeout: 5000 }).catch(() => assert.fail('The exported static frame was not sized to its document'));
  assert.equal(await offline.frameLocator('iframe').locator('body').getAttribute('data-ran'), null, 'The exported static frame ran a script');
  await offline.frameLocator('iframe').getByRole('link', { name: 'Follow-up' }).first().click();
  await offline.waitForFunction(() => scrollY > 500, null, { timeout: 4000 }).catch(() => assert.fail('An in-page link in the exported file did not scroll'));
  assert.equal(await offline.evaluate(() => document.querySelector('iframe').contentWindow.location.href), 'about:srcdoc');
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
  await page.waitForFunction(async () => (await (await import('/js/store.js')).listReports()).length === 3);
  await page.frameLocator('#stage iframe.block-embed--static').locator('#first h1').waitFor();
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

  await checkFitAndCopies(page);

  assert.deepEqual(errors, [], 'Page raised JavaScript errors');
  console.log('Passed: logo, system and saved themes, contrast, paper printing, HTML file/paste/drop imports opening static, auto height (shrinking again for a full-height root, held for an app shell, whose own scrolling pane links, the outline and the export reach), links, outline, Dossier format levels and alignment, printing a frame, scripts on request with sandbox isolation and no refused loads, persistence, offline exports and responsive layout.');
} finally {
  await browser.close();
}
