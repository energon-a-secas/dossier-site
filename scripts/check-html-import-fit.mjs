/**
 * Part of scripts/check-html-import.mjs, kept apart so neither file grows
 * past a readable length: how an imported report's static frame is sized
 * when its document has no height of its own to read, how links and the
 * outline reach a heading in such a frame's own scrolling pane (in the app
 * and in the export), and the two copies a report is handed over as (Dossier
 * format headings, the scripted copy).
 *
 * Runs on the check's page, at the end, after its other imports.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { file, out, verifyUrl } from './check-helpers.mjs';

/** @param {import('playwright').Page} page */
export async function checkFitAndCopies(page) {
  // ── A report whose root is as tall as its window (html, body {height: 100%}) ──
  // Measured at its own height such a document reads the frame back, so a
  // frame could grow when the window narrowed and never shrink again.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#openReport').click();
  await page.locator('#importFile').setInputFiles(file('fixtures/embed/full-height.html'));
  await page.waitForFunction(() => document.getElementById('importDetected').textContent.startsWith('HTML report.'));
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  await page.frameLocator('#stage iframe.block-embed--static').locator('#decision').waitFor();
  // Fitted means no blank paper: the frame ends where the plan does.
  const snug = (label) => page.waitForFunction(() => {
    const f = document.querySelector('#stage iframe.block-embed--static');
    const deck = f?.contentDocument?.querySelector('.deck');
    return Boolean(deck && f.style.height && Math.abs(f.getBoundingClientRect().height - deck.getBoundingClientRect().bottom) <= 2);
  }, null, { timeout: 5000 }).catch(async () => assert.fail(`${label}: the frame does not end where the report does (${await page.evaluate(() => {
    const f = document.querySelector('#stage iframe.block-embed--static');
    return `${Math.round(f.getBoundingClientRect().height)}px frame, report ends at ${Math.round(f.contentDocument.querySelector('.deck').getBoundingClientRect().bottom)}px`;
  })})`));
  const frameHeight = () => page.evaluate(() => Math.round(document.querySelector('#stage iframe.block-embed--static').getBoundingClientRect().height));
  await snug('1440px');
  const wide = await frameHeight();
  for (let width = 1440; width >= 600; width -= 40) await page.setViewportSize({ width, height: 900 });
  await snug('narrowed to 600px');
  assert.ok(await frameHeight() > wide, 'A narrower window did not make the report longer');
  for (let width = 600; width <= 1440; width += 40) await page.setViewportSize({ width, height: 900 });
  await snug('widened to 1440px again');
  assert.ok(Math.abs(await frameHeight() - wide) <= 2, `Widened again, the frame is ${await frameHeight()}px against ${wide}px when opened`);
  // A phone turned from portrait to landscape.
  await page.setViewportSize({ width: 390, height: 844 });
  await snug('390px portrait');
  await page.setViewportSize({ width: 844, height: 390 });
  await snug('turned to landscape');
  // A disclosure opened inside it grows the frame, which no observer of its
  // full-height root and body would see.
  const closedPlan = await frameHeight();
  await page.frameLocator('#stage iframe.block-embed--static').locator('summary').click();
  await page.waitForFunction((h) => document.querySelector('#stage iframe.block-embed--static').getBoundingClientRect().height > h + 20, closedPlan, { timeout: 3000 })
    .catch(() => assert.fail('An opened disclosure did not grow the frame'));
  await snug('disclosure open');
  // The height kept for a rebuilt frame is only where it starts.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('radio', { name: 'Dossier format', exact: true }).click();
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.getByRole('radio', { name: 'Original', exact: true }).click();
  await snug('rebuilt at 1100px');
  assert.equal(await page.evaluate(() => document.querySelector('#stage iframe.block-embed--static').getAttribute('data-embed-fit')), '');

  // ── A saved app shell: no height of its own, so the frame holds and scrolls ──
  await page.locator('#openReport').click();
  await page.locator('#importFile').setInputFiles(file('fixtures/embed/app-shell.html'));
  await page.waitForFunction(() => document.getElementById('importDetected').textContent.startsWith('HTML report.'));
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#stage iframe.block-embed--static')?.getAttribute('data-embed-fit') === 'held', null, { timeout: 5000 })
    .catch(() => assert.fail('A document that fills any frame was not held'));
  const held = await page.evaluate(() => ({ height: document.querySelector('#stage iframe.block-embed--static').getBoundingClientRect().height, screen: innerHeight }));
  assert.ok(held.height >= held.screen * 0.8 && held.height <= held.screen, `The held frame is ${held.height}px on a ${held.screen}px window`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'The held frame overflows the page');

  await checkLongPane(page);

  // The two copies a report is handed over as, read directly.
  const copies = await page.evaluate(async () => {
    const { htmlToIr } = await import('/js/compare/normalize.js');
    const { scriptedCopy } = await import('/js/compare/frame.js');
    const levels = (html) => {
      const out = [];
      const visit = (list) => { for (const b of list) { if (b.t === 'h') out.push(b.level); if (b.blocks) visit(b.blocks); } };
      visit(htmlToIr(html).blocks);
      return out;
    };
    const scripted = scriptedCopy(`<html><head><link rel="stylesheet" href="https://fonts.example.invalid/a.css">
      <style>@import url("https://example.invalid/b.css"); body { background: url(https://example.invalid/c.png); } i { background: url(data:image/png;base64,AA==); }</style>
      <script src="https://cdn.example.invalid/lib.js"></script><meta http-equiv="refresh" content="0; url=https://example.invalid/">
      </head><body><img src="https://example.invalid/d.png" alt="chart"><img src="data:image/png;base64,AA==" alt="inline">
      <button onclick="go()">Go</button><script>window.go = () => 1;</script></body></html>`);
    return {
      lifted: levels('<header><h1>Title</h1></header><main><h2>A</h2><h3>B</h3><details><summary>S</summary><h4>C</h4></details></main>'),
      kept: levels('<main><h1>A</h1><h3>B</h3></main>'),
      scripted: {
        remote: /example\.invalid/.test(scripted),
        refresh: /http-equiv/i.test(scripted),
        inlineScript: scripted.includes('window.go = () => 1;'),
        handler: scripted.includes('onclick="go()"'),
        dataImage: scripted.includes('src="data:image/png;base64,AA=="') && scripted.includes('url(data:image/png;base64,AA==)'),
        alt: scripted.includes('alt="chart"'),
      },
    };
  });
  assert.deepEqual(copies.lifted, [1, 2, 3], 'Dossier format headings were not lifted so the shallowest is level 1');
  assert.deepEqual(copies.kept, [1, 3], 'Dossier format moved headings that already start at level 1');
  assert.deepEqual(copies.scripted, { remote: false, refresh: false, inlineScript: true, handler: true, dataImage: true, alt: true }, 'The scripted copy dropped what runs, or kept what its frame refuses');
}

/**
 * The app shell again, with a pane far longer than the frame. Its window does
 * not scroll, its `main` does, so a link in the report, the rail outline and
 * the exported file's link handler all have to move that pane as well as the
 * page: a scroll of the frame's window alone leaves the heading thousands of
 * pixels below what the frame shows.
 *
 * @param {import('playwright').Page} page
 */
async function checkLongPane(page) {
  const shell = await fs.readFile(file('fixtures/embed/app-shell.html'), 'utf8');
  const filler = Array.from({ length: 60 }, (_, i) => `    <p>Review note ${i + 1}: the numbers above were read from the release dashboard on the day.</p>`).join('\n');
  const long = shell.replace('    <h1 id="r11">', `${filler}\n    <h1 id="r11">`);
  assert.notEqual(long, shell, 'The app shell fixture no longer has the heading the long pane goes before');
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.locator('#openReport').click();
  await page.locator('#importFile').setInputFiles({ name: 'release-dashboard-long.html', mimeType: 'text/html', buffer: Buffer.from(long) });
  await page.waitForFunction(() => document.getElementById('importDetected').textContent.startsWith('HTML report.'));
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  const frame = page.frameLocator('#stage iframe.block-embed--static');
  await frame.locator('#r11').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#stage iframe.block-embed--static')?.getAttribute('data-embed-fit') === 'held', null, { timeout: 5000 })
    .catch(() => assert.fail('The long app shell was not held'));
  const reset = () => page.evaluate(() => {
    document.querySelector('#stage iframe.block-embed--static').contentDocument.querySelector('main').scrollTop = 0;
    scrollTo(0, 0);
  });
  const where = () => page.evaluate(() => {
    const f = document.querySelector('#stage iframe.block-embed--static');
    const d = f.contentDocument;
    const inner = d.getElementById('r11').getBoundingClientRect().top;
    return `pane at ${Math.round(d.querySelector('main').scrollTop)}px, heading ${Math.round(inner)}px into a ${f.clientHeight}px frame, ${Math.round(f.getBoundingClientRect().top + inner)}px down a ${innerHeight}px window`;
  });
  const reached = (label, focus) => page.waitForFunction((wantFocus) => {
    const f = document.querySelector('#stage iframe.block-embed--static');
    const d = f.contentDocument;
    const h = d.getElementById('r11');
    const inner = h.getBoundingClientRect().top;
    const onPage = f.getBoundingClientRect().top + inner;
    return d.querySelector('main').scrollTop > 0 && inner >= 0 && inner < f.clientHeight - 24
      && onPage >= 0 && onPage < innerHeight - 24 && (!wantFocus || d.activeElement === h);
  }, focus, { timeout: 4000 }).catch(async () => assert.fail(`${label} did not bring the heading into view (${await where()})`));

  // A link in the report's own navigation.
  await reset();
  assert.ok((await page.evaluate(() => document.querySelector('#stage iframe.block-embed--static').contentDocument.getElementById('r11').getBoundingClientRect().top)) > 2000, 'The long pane is not long enough to test');
  await frame.getByRole('link', { name: 'Release 11', exact: true }).click();
  await reached('A link in a held frame', false);
  assert.equal(page.url().includes('#r11'), false, 'An in-page link changed the page address');
  // The rail outline, which focuses the heading too.
  await reset();
  await page.locator('#outline a', { hasText: 'Release 11' }).click();
  await reached('The outline, for a held frame,', true);

  // The exported file, whose own script handles the links.
  const html = await page.evaluate(async () => {
    const { exportStandaloneHtml } = await import('/js/export.js');
    const { state } = await import('/js/state.js');
    let captured;
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return original.call(URL, blob); };
    try { await exportStandaloneHtml(state.model); }
    finally { URL.createObjectURL = original; }
    return captured.text();
  });
  await fs.writeFile(out('html-import-held.html'), html);
  const exported = await page.context().newPage();
  try {
    await exported.setViewportSize({ width: 1440, height: 560 });
    await exported.goto(verifyUrl('html-import-held.html'));
    await exported.waitForFunction(() => document.querySelector('iframe[data-embed-fit]')?.getAttribute('data-embed-fit') === 'held', null, { timeout: 5000 })
      .catch(() => assert.fail('The exported long app shell was not held'));
    await exported.frameLocator('iframe').getByRole('link', { name: 'Release 11', exact: true }).click();
    await exported.waitForFunction(() => {
      const f = document.querySelector('iframe');
      const d = f.contentDocument;
      const inner = d.getElementById('r11').getBoundingClientRect().top;
      const onPage = f.getBoundingClientRect().top + inner;
      return d.querySelector('main').scrollTop > 0 && inner >= 0 && inner < f.clientHeight - 24 && onPage >= 0 && onPage < innerHeight - 24;
    }, null, { timeout: 4000 }).catch(() => assert.fail('A link in the exported held frame did not bring its heading into view'));
    assert.equal(await exported.evaluate(() => document.querySelector('iframe').contentWindow.location.href), 'about:srcdoc');
  } finally {
    await exported.close();
  }
}
