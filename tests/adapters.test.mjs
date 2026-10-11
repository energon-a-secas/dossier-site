/**
 * Adapter tests: adapters/*.js
 *
 * Round-trip each adapter sample and assert structure.
 *
 * Plain node --test, no framework, no dependencies.
 */

import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { toDossier as numstatToDossier } from '../js/adapters/numstat.js';
import { toDossier as junitToDossier } from '../js/adapters/junit.js';
import { toDossier as sarifToDossier } from '../js/adapters/sarif.js';
import { toDossier as ctrfToDossier } from '../js/adapters/ctrf.js';
import { toDossier as markdownToDossier } from '../js/adapters/markdown.js';
import { toDossier as lighthouseToDossier } from '../js/adapters/lighthouse.js';
import { toDossier as htmlToDossier } from '../js/adapters/html.js';
import { detect } from '../js/adapters/index.js';
import { parse } from '../js/parse.js';
import { validate } from '../js/validate.js';
import { blockHtml } from '../js/render/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const fixturesDir = join(__dirname, '..', 'fixtures', 'foreign');

function readFixture(name) {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

describe('adapters', () => {
  describe('HTML', () => {
    test('detection returns a usable adapter and prioritizes the enclosing document', () => {
      const adapter = detect('<!DOCTYPE html><html><body><pre>\n# A heading\nfix: a change</pre></body></html>');
      assert.strictEqual(adapter.id, 'html');
      assert.strictEqual(typeof adapter.toDossier, 'function');
      assert.strictEqual(detect('# A heading').id, 'markdown');
      assert.strictEqual(detect('<testsuite name="unit"></testsuite>').id, 'junit');
    });

    test('native documents containing markup are not mistaken for HTML', () => {
      assert.strictEqual(detect(JSON.stringify({ dossier: { pages: [{ blocks: [{ html: '<p>Report</p>' }] }] } })), null);
      assert.strictEqual(detect('{ "html": "<p>unfinished'), null);
    });

    test('styles, SVGs and scripts survive an HTML import as a valid embed', () => {
      const source = readFixture('presentation.html');
      const converted = htmlToDossier(source);
      const block = converted.document.dossier.pages[0].blocks[0];
      assert.strictEqual(block.html, source);
      assert.strictEqual(block.scripts, true);
      const parsed = parse(JSON.stringify(converted.document));
      assert.strictEqual(parsed.fatal, null);
      assert.deepEqual(validate(parsed.model).filter((finding) => finding.level === 'error'), []);
    });

    test('passive HTML does not enable scripts', () => {
      assert.strictEqual(htmlToDossier('<h1>Report</h1>').document.dossier.pages[0].blocks[0].scripts, false);
      assert.strictEqual(htmlToDossier(' ').document, null);
    });

    test('interactive embeds use the isolated host; offline exports include the document', () => {
      const block = { type: 'embed', html: '<button onclick="this.textContent=2">1</button>', scripts: true };
      const live = blockHtml(block);
      const offline = blockHtml(block, { standalone: true });
      assert.ok(live.includes('src="embed.html"'));
      assert.ok(live.includes('sandbox="allow-scripts"'));
      assert.ok(!live.includes('allow-same-origin'));
      assert.ok(offline.includes('srcdoc='));
      assert.ok(!offline.includes('src="embed.html"'));
      assert.ok(offline.includes('Content-Security-Policy'));
      assert.ok(offline.includes('connect-src &#39;none&#39;'));
    });
  });

  describe('numstat', () => {
    test('parses git diff output', () => {
      const source = readFixture('numstat.txt');
      const result = numstatToDossier(source);
      assert.notStrictEqual(result.document, null);
      assert.strictEqual(result.document.dossier.pages.length, 1);
      const page = result.document.dossier.pages[0];
      assert.strictEqual(page.blocks.length, 2);
      assert.strictEqual(page.blocks[0].type, 'files');
      assert.strictEqual(page.blocks[1].type, 'metrics');
      assert.strictEqual(page.blocks[0].items.length, 4);
    });
  });

  describe('junit', () => {
    test('parses JUnit XML', () => {
      const source = readFixture('junit.xml');
      const result = junitToDossier(source);
      assert.notStrictEqual(result.document, null);
      const page = result.document.dossier.pages[0];
      const testsBlock = page.blocks.find((b) => b.type === 'tests');
      assert.notStrictEqual(testsBlock, undefined);
      assert.strictEqual(testsBlock.items.length, 4);
      const failed = testsBlock.items.find((t) => t.state === 'failed');
      assert.notStrictEqual(failed, undefined);
    });
  });

  describe('sarif', () => {
    test('parses SARIF findings', () => {
      const source = readFixture('sarif.json');
      const result = sarifToDossier(source);
      assert.notStrictEqual(result.document, null);
      const page = result.document.dossier.pages[0];
      const findingsBlock = page.blocks.find((b) => b.type === 'findings');
      assert.notStrictEqual(findingsBlock, undefined);
      assert.strictEqual(findingsBlock.items.length, 2);
    });
  });

  describe('ctrf', () => {
    test('parses CTRF results', () => {
      const source = readFixture('ctrf.json');
      const result = ctrfToDossier(source);
      assert.notStrictEqual(result.document, null);
      const page = result.document.dossier.pages[0];
      const testsBlock = page.blocks.find((b) => b.type === 'tests');
      assert.notStrictEqual(testsBlock, undefined);
    });
  });

  describe('markdown', () => {
    test('parses Markdown with front matter', () => {
      const source = readFixture('markdown.md');
      const result = markdownToDossier(source);
      assert.notStrictEqual(result.document, null);
      assert.strictEqual(result.document.dossier.title, 'Performance Report');
      assert.strictEqual(result.document.dossier.pages.length, 1);
    });
  });

  describe('lighthouse', () => {
    test('parses Lighthouse LHR', () => {
      const source = readFixture('lighthouse.json');
      const result = lighthouseToDossier(source);
      assert.notStrictEqual(result.document, null);
      const page = result.document.dossier.pages[0];
      const metricsBlock = page.blocks.find((b) => b.type === 'metrics');
      assert.notStrictEqual(metricsBlock, undefined);
      assert.strictEqual(metricsBlock.items.length, 4);
    });
  });
});
