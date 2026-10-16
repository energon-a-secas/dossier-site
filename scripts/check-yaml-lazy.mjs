/**
 * js-yaml loads only when YAML reaches the parser, and every path that can
 * hand the parser YAML waits for it.
 *
 * Boot used to fetch js-yaml (a quarter of the site's scripts) on every
 * visit, and the YAML paths worked only because that warm-up usually won a
 * race: with the module slow to arrive, a pasted or dropped YAML report
 * failed with "YAML parsing requires js-yaml", the editor kept that banner,
 * and a saved comparison's YAML column never recovered. Here the module is
 * held back 1.5 s and each path is taken straight after a cold boot.
 *
 * Run by scripts/check-html-import.mjs, or on its own against the dev
 * server: `node scripts/check-yaml-lazy.mjs` (DOSSIER_URL overrides
 * http://127.0.0.1:8899).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.DOSSIER_URL || 'http://127.0.0.1:8899';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const YAML = /\/js\/vendor\/js-yaml\.mjs/;

async function minimal() {
  const { dump } = await import(pathToFileURL(path.join(root, 'js/vendor/js-yaml.mjs')).href);
  const json = await fs.readFile(path.join(root, 'fixtures/minimal.json'), 'utf8');
  return { yaml: dump(JSON.parse(json)), json };
}

/** A fresh context whose js-yaml requests are counted and, when `delay`, held back. */
async function context(browser, { delay = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const seen = [];
  await ctx.route(YAML, async (route) => {
    seen.push(route.request().url());
    if (delay) await new Promise((resolve) => { setTimeout(resolve, delay); });
    await route.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { ctx, page, seen, errors };
}

async function boot(page, hash = '') {
  await page.goto(`${base}/?check=yaml-lazy-${Date.now()}${hash}`, { waitUntil: 'networkidle' });
  await page.bringToFront();
}

async function cleanUp(page) {
  await page.evaluate(() => {
    indexedDB.deleteDatabase('dossier');
    indexedDB.deleteDatabase('dossier-compare');
    localStorage.clear();
  }).catch(() => {});
}

async function readsMinimal(page, label) {
  await page.locator('#stage .report-title').filter({ hasText: 'Minimal report' }).waitFor({ timeout: 6000 })
    .catch(() => assert.fail(`${label}: the YAML report did not open while js-yaml was still on its way`));
  assert.equal(await page.evaluate(() => document.body.innerText.includes('requires js-yaml')), false, `${label}: the page says YAML needs js-yaml`);
}

/** @param {import('playwright').Browser} browser */
export async function checkYamlLazy(browser) {
  const { yaml, json } = await minimal();

  // (a) A cold boot of either view fetches no js-yaml, (b) nor does HTML.
  for (const hash of ['', '#/~compare']) {
    const { ctx, page, seen, errors } = await context(browser);
    try {
      await boot(page, hash);
      await page.waitForTimeout(500);
      assert.deepEqual(seen, [], `A cold boot of ${hash || '/'} fetched js-yaml`);
      if (!hash) {
        await page.evaluate(() => document.getElementById('openReport').click());
        await page.locator('#importText').fill('<!doctype html><title>R</title><h1>An HTML report</h1><p>Words.</p>');
        await page.locator('#importDialog [data-action="import-confirm"]').click();
        await page.locator('#stage .report-title').filter({ hasText: 'R' }).waitFor();
        await page.waitForTimeout(300);
        assert.deepEqual(seen, [], 'Opening an HTML report fetched js-yaml');
      }
      assert.deepEqual(errors, []);
    } finally {
      await cleanUp(page);
      await ctx.close();
    }
  }

  // (c) Pasted, dropped and typed YAML, straight after boot, js-yaml held back.
  const paths = {
    paste: async (page) => {
      await page.evaluate(() => document.getElementById('openReport').click());
      await page.locator('#importText').fill(yaml);
      await page.locator('#importDialog [data-action="import-confirm"]').click();
    },
    drop: async (page) => {
      await page.evaluate((text) => {
        const data = new DataTransfer();
        data.items.add(new File([text], 'report.yaml', { type: 'application/yaml' }));
        document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
      }, yaml);
    },
    editor: async (page) => {
      await page.evaluate(async () => (await import('/js/actions.js')).runAction('new-report', document.body, new Event('click')));
      await page.locator('#stage .report-title').waitFor();
      await page.locator('[data-action="source-tab"][data-pane="json"]').click();
      await page.locator('#jsonPane textarea').fill(yaml);
    },
  };
  for (const [name, take] of Object.entries(paths)) {
    const { ctx, page, seen, errors } = await context(browser, { delay: 1500 });
    try {
      await boot(page);
      await take(page);
      await readsMinimal(page, name);
      assert.equal(seen.length, 1, `${name}: js-yaml was fetched ${seen.length} times`);
      assert.deepEqual(errors, [], `${name}: the page raised errors`);
    } finally {
      await cleanUp(page);
      await ctx.close();
    }
  }

  // (d) A saved comparison with a YAML Dossier column, opened cold.
  {
    const { ctx, page, errors } = await context(browser, { delay: 1500 });
    try {
      await boot(page, '#/~compare');
      await page.evaluate(async ({ yamlText, jsonText }) => {
        const { newSet, addColumn } = await import('/js/compare/model.js');
        const { writeSet } = await import('/js/compare/store.js');
        let set = newSet({ id: 'c-yaml-lazy', title: 'YAML column' });
        set = addColumn(set, { role: 'human', label: 'YAML', source: { kind: 'dossier', name: 'report.yaml', text: yamlText } }).set;
        set = addColumn(set, { role: 'agent', label: 'JSON', source: { kind: 'dossier', name: 'report.json', text: jsonText } }).set;
        await writeSet(set);
        localStorage.setItem('dossier-site:compare', JSON.stringify({ __v: 1, data: { lastSetId: 'c-yaml-lazy' } }));
      }, { yamlText: yaml, jsonText: json });
      const cold = await ctx.newPage();
      cold.on('pageerror', (error) => errors.push(error.message));
      await cold.goto(`${base}/?check=yaml-lazy-cold-${Date.now()}#/~compare`);
      await cold.bringToFront();
      await cold.waitForFunction(() => {
        const bodies = [...document.querySelectorAll('#compareView .col__body')];
        return bodies.length === 2 && bodies.every((b) => b.textContent.includes('Minimal report') && !b.textContent.includes('could not be read'));
      }, null, { timeout: 4000 }).catch(async () => {
        const said = await cold.evaluate(() => [...document.querySelectorAll('#compareView .col__body')].map((b) => b.textContent.replace(/\s+/g, ' ').slice(0, 120)));
        assert.fail(`A saved YAML column did not read once js-yaml arrived: ${JSON.stringify(said)}`);
      });
      await cleanUp(cold);
      await cold.close();
      assert.deepEqual(errors, [], 'The comparison raised errors');
    } finally {
      await cleanUp(page);
      await ctx.close();
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch();
  try {
    await checkYamlLazy(browser);
    console.log('Passed: no js-yaml on a cold boot of either view or for an HTML report, and pasted, dropped and typed YAML and a saved YAML comparison column all reading once a held-back js-yaml arrives.');
  } finally {
    await browser.close();
  }
}
