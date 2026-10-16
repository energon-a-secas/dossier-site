/**
 * Browser regressions for reading a report with a keyboard and in both
 * appearances, run by scripts/check-workspace.mjs:
 *
 * - Focus reached by Shift+Tab is never hidden under the sticky header (the
 *   kit's app-mode header comes back on any upward scroll), and an outline
 *   jump lands a heading just under it, not 56 px lower (WCAG 2.4.11).
 * - The back-to-top button, which the Footer Kit appends outside the footer,
 *   keeps a legible arrow at rest and on hover and a visible focus ring, in
 *   light and dark, with and without a visitor theme (WCAG 1.4.11).
 * - An imported report's headings in Dossier format step up from the body
 *   text as Compare's do, and the rail outline indents an h3 under its h2.
 * - The editor's form names each field once, in a reader's words.
 *
 * Each check that needs its own page opens its own browser context.
 */
import assert from 'node:assert/strict';

/** A synthetic report with three heading levels (never the owner's files). */
const LEVELS_HTML = '<!doctype html><html><head><title>Levels</title></head><body><main>'
  + '<h1>Levels report</h1><p>An opening paragraph of body text, long enough to be read as one.</p>'
  + '<h2>First section</h2><p>Body text of the first section, in the reading face.</p>'
  + '<h3>A detail inside it</h3><p>More body text under the detail.</p>'
  + '<h2>Second section</h2><p>The last of the body text.</p></main></body></html>';

export async function checkReading({ browser, base, errors }) {
  await checkFocusBelowHeader({ browser, base, errors });
  await checkBackToTop({ browser, base, errors });
  await checkImportedHeadings({ browser, base, errors });
}

/**
 * Dossier format in the Reports view squeezed every heading into 17 to 20
 * px (h2 1.08 of the body, h3 the body's size), and the outline listed an h3
 * as a sibling of its h2.
 */
async function checkImportedHeadings({ browser, base, errors }) {
  const { context, page } = await fresh(browser, base, errors, 'levels', { viewport: { width: 1440, height: 900 } });
  await page.locator('#openReport').click();
  await page.locator('#importText').fill(LEVELS_HTML);
  await page.waitForFunction(() => /HTML/.test(document.getElementById('importDetected')?.textContent || ''));
  await page.locator('#importDialog [data-action="import-confirm"]').click();
  await page.locator('#stage .report-title').waitFor();
  await page.getByRole('radio', { name: 'Dossier format', exact: true }).click();
  await page.locator('#stage .block-embed-reader .r-h3').waitFor();
  const m = await page.evaluate(() => {
    const size = (selector) => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
    const link = (text) => [...document.querySelectorAll('#outline a')].find((a) => a.textContent.trim() === text);
    const textLeft = (a) => {
      const range = document.createRange();
      range.selectNodeContents(a);
      return range.getBoundingClientRect().left;
    };
    return {
      body: size('#stage .block-embed-reader p:not(.embed-note)'),
      h1: size('#stage .block-embed-reader .r-h1'),
      h2: size('#stage .block-embed-reader .r-h2'),
      h3: size('#stage .block-embed-reader .r-h3'),
      title: size('#stage .report-title'),
      h2Left: textLeft(link('First section')),
      h3Left: textLeft(link('A detail inside it')),
      railOverflow: document.getElementById('rail').scrollWidth - document.getElementById('rail').clientWidth,
    };
  });
  assert.ok(m.h2 >= m.body * 1.15, `Dossier format's h2 is ${m.h2}px over ${m.body}px body text`);
  assert.ok(m.h1 > m.h2 && m.h2 > m.h3 && m.h3 > m.body, `Dossier format's headings do not step: h1 ${m.h1}, h2 ${m.h2}, h3 ${m.h3}, body ${m.body}`);
  assert.ok(m.h1 <= m.title, `An imported h1 (${m.h1}px) is larger than the report's title (${m.title}px)`);
  assert.ok(m.h3Left > m.h2Left + 6, `The outline does not indent an h3 under its h2 (${m.h3Left} against ${m.h2Left})`);
  assert.ok(m.railOverflow <= 0, 'The indented outline scrolls the rail sideways');
  await context.close();
}

async function fresh(browser, base, errors, label, options = {}, query = '') {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  await page.goto(`${base}/?check=${label}${query}`, { waitUntil: 'networkidle' });
  await page.bringToFront();
  return { context, page };
}

async function openFirstExample(page) {
  await page.locator('#welcomeExamples [data-file="responses.json"]').click();
  await page.locator('#stage .report-title').waitFor();
}

/**
 * Shift+Tab up from the footer, and at every stop look under the focused
 * element's corners and centre: a stop where all five points land on the
 * header bar is a control the reader cannot see.
 */
async function checkFocusBelowHeader({ browser, base, errors }) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { context, page } = await fresh(browser, base, errors, `focus-${viewport.width}`, { viewport });
    await openFirstExample(page);
    await page.locator('.neo-footer a').first().focus();
    const hidden = [];
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('Shift+Tab');
      // The header slides back in on the upward scroll: measure once it has.
      await page.waitForTimeout(220);
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el.closest('.header-bar')) return null;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        const points = [[r.left + 1, r.top + 1], [r.right - 1, r.top + 1], [r.left + 1, r.bottom - 1], [r.right - 1, r.bottom - 1], [r.left + r.width / 2, r.top + r.height / 2]];
        const under = points.every(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.header-bar')));
        return { name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40), top: Math.round(r.top), under };
      });
      if (stop?.under) hidden.push(`"${stop.name}" at ${stop.top}px`);
    }
    assert.deepEqual(hidden, [], `At ${viewport.width}px, Shift+Tab left focus under the header: ${hidden.join(', ')}`);
    await context.close();
  }

  // An outline jump lands its heading 16 px under the 56 px header.
  const { context, page } = await fresh(browser, base, errors, 'outline-jump', { viewport: { width: 1440, height: 600 }, reducedMotion: 'reduce' });
  await page.locator('#openReport').click();
  await page.locator('#openExamples [data-file="audit.json"]').click();
  await page.locator('#stage .report-title').waitFor();
  await page.locator('#stage').getByRole('link', { name: 'Query details' }).click();
  const link = page.locator('#outline a[data-action="outline-heading"]').filter({ hasText: 'Query 2' });
  await link.click();
  await page.waitForTimeout(150);
  const landed = await page.evaluate((id) => {
    const target = [...document.querySelectorAll('#stage [id]')].find((el) => el.id === id);
    return { top: Math.round(target.getBoundingClientRect().top), y: scrollY, end: document.documentElement.scrollHeight - innerHeight };
  }, await link.getAttribute('data-block-id'));
  assert.ok(landed.y > 0 && landed.y < landed.end - 1, `The outline jump was limited by the page's length (scrolled ${landed.y} of ${landed.end}), so it proves nothing`);
  assert.ok(landed.top >= 60 && landed.top <= 80, `An outline jump left its heading ${landed.top}px from the top of the window, not just under the header`);
  await context.close();
}

/** In the page: WCAG contrast of two CSS colours, the first composited over the second. */
function contrastIn(page, pairs) {
  return page.evaluate((list) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = (color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top, under) => top.slice(0, 3).map((c, i) => c * top[3] + under[i] * (1 - top[3]));
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return list.map(([fg, bg, desk]) => {
      const ground = over(rgba(bg), rgba(desk || '#fff'));
      const ink = over(rgba(fg), ground);
      const [l1, l2] = [lum(ink), lum(ground)].sort((a, b) => b - a);
      return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
    });
  }, pairs);
}

/**
 * The back-to-top button lives outside .neo-footer, so the footer's token
 * override never reached it: 1.9:1 at rest, 1.2:1 on hover and a 2.0:1 ring
 * on the light desk. Each state is measured on the page, in four looks.
 */
async function checkBackToTop({ browser, base, errors }) {
  for (const colorScheme of ['light', 'dark']) {
    for (const theme of ['', 'rain']) {
      const label = `top-${colorScheme}${theme ? `-${theme}` : ''}`;
      const { context, page } = await fresh(browser, base, errors, label, { viewport: { width: 1280, height: 700 }, colorScheme }, theme ? `&theme=${theme}` : '');
      await openFirstExample(page);
      await page.locator('#stage').getByRole('link', { name: 'Scores & runs' }).click();
      await page.locator('#stage .trend-chart').waitFor();
      const top = page.locator('.neo-top');
      await page.evaluate(() => window.scrollTo(0, Math.min(1600, document.documentElement.scrollHeight - innerHeight)));
      await page.waitForFunction(() => scrollY >= 1000 && document.querySelector('.neo-top')?.classList.contains('is-visible'));
      const desk = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const rest = await top.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
      await top.hover();
      await page.waitForTimeout(250);
      const hover = await top.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
      await page.mouse.move(5, 5);
      await page.keyboard.press('Shift');
      await top.focus();
      const ring = await top.evaluate((el) => ({ visible: el.matches(':focus-visible'), color: getComputedStyle(el).outlineColor }));
      assert.ok(ring.visible, `${label}: the back-to-top button did not take a visible focus from the keyboard`);
      const [atRest, onHover, focusRing] = await contrastIn(page, [[...rest, desk], [...hover, desk], [ring.color, desk, desk]]);
      assert.ok(atRest >= 4.5, `${label}: the back-to-top arrow is ${atRest}:1 against its disc`);
      assert.ok(onHover >= 3, `${label}: on hover the back-to-top arrow is ${onHover}:1`);
      assert.ok(focusRing >= 3, `${label}: the back-to-top focus ring is ${focusRing}:1 against the desk`);
      await context.close();
    }
  }
}

/**
 * The editor names each field once, in a reader's words: no label pointing
 * at nothing, no "Item-0", no second "Document properties" heading, enum
 * options as the report shows them, and the product's chevron on sections.
 */
export async function checkFormWords(page) {
  const pane = page.locator('#formPane');
  const report = await pane.evaluate((root) => {
    const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
      && !(el.closest('.sr-only'));
    const texts = [...root.querySelectorAll('label, legend, summary, button, option')].filter(shown).map((el) => el.textContent.trim());
    const status = [...root.querySelectorAll('select')].find((select) => [...select.options].some((o) => o.value === 'in-review'));
    const details = [...root.querySelectorAll('.ds-form-section > summary')].find((s) => s.textContent.trim() === 'Report details');
    return {
      dangling: [...root.querySelectorAll('label[for]')].filter((l) => !document.getElementById(l.htmlFor)).map((l) => l.textContent.trim()),
      items: texts.filter((t) => /^Item-\d/.test(t)),
      properties: texts.filter((t) => t === 'Document properties').length,
      period: [...root.querySelectorAll('label, legend')].filter((el) => shown(el) && el.textContent.replace('*', '').trim() === 'Period').map((el) => el.tagName),
      options: status ? [...status.options].map((o) => o.textContent) : [],
      marker: details ? getComputedStyle(details).listStyleType : '',
      chevron: details ? getComputedStyle(details, '::before').content : '',
    };
  });
  assert.deepEqual(report.dangling, [], `Edit form labels point at nothing: ${report.dangling.join(', ')}`);
  assert.deepEqual(report.items, [], 'The edit form shows machine labels like "Item-0"');
  assert.equal(report.properties, 0, 'The edit form repeats "Document properties" under "Report details"');
  assert.deepEqual(report.period, ['LEGEND'], `"Period" is named ${report.period.length} times in the edit form`);
  assert.ok(report.options.includes('In review') && report.options.includes('Rolled back'), `Status options read ${report.options.join(', ')}`);
  assert.ok(!report.options.includes('in-review'), 'Status options show the raw format value');
  assert.equal(report.marker, 'none', 'Report details shows the browser\'s disclosure marker');
  assert.equal(report.chevron, '"›"', 'Report details lacks the product chevron');
}
