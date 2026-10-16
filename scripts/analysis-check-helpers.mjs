/**
 * What the two browser checks of the Compare view's analysis share
 * (scripts/check-compare-analysis.mjs and scripts/check-compare-export.mjs):
 * the address, a place for screenshots, an error watch, and the small waits
 * and measures they both use.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const base = process.env.DOSSIER_URL || 'http://127.0.0.1:8899';
export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const verify = path.join(root, '.verify');
await fs.mkdir(verify, { recursive: true });

/** Collect page errors and console errors into `errors`. */
export function watch(errors, page, label = '') {
  page.on('pageerror', (error) => errors.push(`${label}${page.url()}: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${label}${page.url()}: console: ${msg.text()}`);
  });
}

export async function noOverflow(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(over <= 1, `${label}: the page scrolls sideways by ${over}px`);
}

export async function focusOn(page, selector, why) {
  try {
    await page.waitForFunction((sel) => Boolean(document.activeElement?.matches?.(sel)), selector, { timeout: 2000 });
  } catch {
    const at = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120) || 'nothing');
    assert.fail(`${why}: focus is on ${at}, not ${selector}`);
  }
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
