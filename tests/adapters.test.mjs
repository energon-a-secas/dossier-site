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

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
const fixturesDir = join(__dirname, '..', 'fixtures', 'foreign');

function readFixture(name) {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

describe('adapters', () => {
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
