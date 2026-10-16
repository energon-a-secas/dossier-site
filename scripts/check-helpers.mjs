/**
 * What the browser checks share: where the app is, the project's files, a
 * folder of this run's own for screenshots and exported files, an error
 * watch, and the steps and measures more than one check takes.
 *
 * Imported by scripts/check-compare.mjs, check-compare-hostile.mjs,
 * check-compare-analysis.mjs, check-compare-export.mjs,
 * check-compare-columns.mjs, check-compare-brief.mjs,
 * check-compare-bridge.mjs, check-compare-focus.mjs, check-workspace.mjs,
 * check-narrow.mjs, check-html-import.mjs and check-html-import-fit.mjs.
 * (check-standalone.mjs runs its own server and keeps to itself.)
 *
 * Paths resolve from this file, never from the current directory, so a check
 * run from anywhere reads the project's fixtures and writes inside the
 * project. Output goes to `.verify/<port>/`, the port of the server the run
 * is against: two runs against two servers at once (as concurrent agents
 * do) never read each other's exports.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const base = (process.env.DOSSIER_URL || 'http://127.0.0.1:8899').replace(/\/+$/, '');
export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** A project file, by its path from the project root. */
export const file = (rel) => path.join(root, rel);
/** This run's name: the port of the server it runs against. */
export const run = new URL(base).port || 'default';
export const verify = path.join(root, '.verify', run);
await fs.mkdir(verify, { recursive: true });
/** Where this run writes `name`. */
export const out = (name) => path.join(verify, name);
/** The address the server gives a file this run wrote. */
export const verifyUrl = (name) => `${base}/.verify/${run}/${name}`;

/**
 * Collect a page's errors and console errors into `errors`, each prefixed
 * with `label`. One object, so a call cannot swap the page and the list.
 */
export function watch({ page, errors, label = '' }) {
  page.on('pageerror', (error) => errors.push(`${label}${page.url()}: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${label}${page.url()}: console: ${msg.text()}`);
  });
}

export async function noOverflow(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(over <= 1, `${label}: the page scrolls sideways by ${over}px`);
}

/** Wait until focus is on an element matching `selector`; fail with `why`. */
export async function focusOn(page, selector, why) {
  try {
    await page.waitForFunction((sel) => Boolean(document.activeElement?.matches?.(sel)), selector, { timeout: 2000 });
  } catch {
    const at = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.localName}${el.id ? `#${el.id}` : ''}${el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : ''}` : 'nothing';
    });
    assert.fail(`${why}: focus is on ${at}, not ${selector}`);
  }
}

/**
 * The Compare view is the window under the header: the toolbar right under
 * the bar, the columns down to the window's bottom edge, the footer below
 * the fold and reachable by scrolling the page, and the toolbar back in view
 * when focus moves into it from there. A column read to its end does not
 * carry on into the page. (The view used to stop above the footer, which
 * cost every column 70 to 98 px.)
 */
export async function fillsWindow(page, label) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const at = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    return {
      header: box('.header-bar').bottom,
      toolbar: box('#cmpToolbar').top,
      columns: box('#cmpColumns').bottom,
      footer: box('.neo-footer').top,
      window: innerHeight,
    };
  });
  assert.ok(Math.abs(at.toolbar - at.header) <= 1, `${label}: the toolbar is at ${at.toolbar}px, not under the header at ${at.header}px`);
  assert.ok(Math.abs(at.columns - at.window) <= 1, `${label}: the columns end at ${at.columns}px, not at the window's bottom edge (${at.window}px)`);
  assert.ok(at.footer >= at.window - 1, `${label}: the footer shows at ${at.footer}px, inside the ${at.window}px window`);
  const reached = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const footer = document.querySelector('.neo-footer').getBoundingClientRect();
    const result = { bottom: footer.bottom, height: footer.height, window: innerHeight, y: scrollY };
    window.scrollTo(0, 0);
    return result;
  });
  assert.ok(Math.abs(reached.bottom - reached.window) <= 1 && reached.height > 0, `${label}: the footer cannot be reached (its bottom at ${reached.bottom}px after scrolling ${reached.y}px)`);
  // Scrolled to the footer, the toolbar is under the sticky header; focus
  // that moves into it brings it back below the header (WCAG 2.4.11).
  const refocused = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const control = [...document.querySelectorAll('#cmpToolbar button, #cmpToolbar select, #cmpToolbar input')]
      .find((el) => el.getClientRects().length && !el.disabled);
    control.focus();
    const result = { toolbar: document.querySelector('#cmpToolbar').getBoundingClientRect().top, header: document.querySelector('.header-bar').getBoundingClientRect().bottom };
    control.blur();
    window.scrollTo(0, 0);
    return result;
  });
  assert.ok(Math.abs(refocused.toolbar - refocused.header) <= 1, `${label}: focus in the toolbar left it at ${refocused.toolbar}px, under the header that ends at ${refocused.header}px`);
  // A column read to its end keeps the wheel to itself.
  const scroller = page.locator('#compareView .col__scroll:visible').first();
  if (await scroller.count()) {
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await scroller.hover();
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => scrollY), 0, `${label}: a wheel past a column's end scrolled the page`);
    await scroller.evaluate((el) => { el.scrollTop = 0; });
  }
}

/** Put a project file into a column through its "Choose a file" button. */
export async function chooseFile(page, colId, rel) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator(`#cmp-col-${colId} [data-action="cmp-choose-file"]`).click(),
  ]);
  await chooser.setFiles(file(rel));
  await page.locator(`#cmp-col-${colId} .col__scroll, #cmp-col-${colId} .col__frame`).first().waitFor();
}

/** A heading's distance from the top of its column's scroller. */
export function headingTop(page, colId, text) {
  return page.evaluate(([id, wanted]) => {
    // The heading as the report wrote it: without the difference marks'
    // hidden words ("Changed heading:"), removed words or "Added" label.
    const plain = (h) => {
      const c = h.cloneNode(true);
      c.querySelectorAll('.visually-hidden, del, .u-label, .cur-tag').forEach((e) => e.remove());
      return c.textContent.replace(/\s+/g, ' ').trim();
    };
    const scroller = document.querySelector(`#cmp-col-${id} .col__scroll`);
    const heading = [...scroller.querySelectorAll('.r-h')].find((h) => plain(h) === wanted);
    return heading ? heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null;
  }, [colId, text]);
}

/** Open the bundled example from the Open dialog and wait for its marks. */
export async function openExample(page) {
  await page.locator('#openReport').click();
  await page.locator('#openExamples [data-action="cmp-example"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#compareView .col .reader').length === 3);
  await page.locator('#cmp-col-k3 .ruler').waitFor();
}

/**
 * The column shown first while blind: Report 1, first on the page and the
 * leftmost, clear of a panel over the right.
 */
export function firstReport(page) {
  return page.evaluate(() => document.querySelector('#compareView .col')?.dataset.col);
}
