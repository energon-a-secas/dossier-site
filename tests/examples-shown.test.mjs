/**
 * Every word an example carries reaches the page.
 *
 * Three blocks rendered blank rows from documents the validator accepted:
 * Steps read `item.label` where the format says `title`, Facts read `item.key`
 * where it says `label`, and the Release example's checklist wrote `text`
 * where the format says `label`. Each test that existed checked that a block
 * rendered something, and a numbered list with no words in it is something.
 *
 * So this walks the text fields of every registry sample (what the catalog
 * previews), every bundled example and the complete fixture, and checks that
 * each one appears in the rendered markup.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { blockHtml } from '../js/render/index.js';
import { BLOCKS } from '../js/registry/index.js';
import { parse } from '../js/parse.js';
import { escHtml } from '../js/neorgon-dom.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The fields that carry words for the reader. Identifiers, units and enums
// are left out: they are shown as styling or in a different form.
const TEXT_KEYS = new Set([
  'title', 'label', 'text', 'value', 'detail', 'note', 'message', 'name', 'mitigation',
  'at', 'path', 'caption', 'context', 'decision', 'consequences', 'why_not', 'who',
  'owner', 'excerpt', 'suite', 'rule', 'from', 'prompt',
]);

function texts(value, out = [], key = '') {
  if (Array.isArray(value)) value.forEach((v) => texts(v, out, key));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'evidence' || k === 'blocks' || k === 'html') continue;
      texts(v, out, k);
    }
  } else if (typeof value === 'string' && TEXT_KEYS.has(key)) {
    // Multi-line values (a compare side) render a line at a time.
    for (const line of value.split('\n')) if (line.trim().length > 2) out.push([key, line.trim()]);
  }
  return out;
}

/** Markdown markers are rendered as elements, so compare against the words. */
const words = (s) => s.replace(/\*\*|`|\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

function missingText(block, ctx) {
  const html = blockHtml(block, ctx);
  const plain = html.replace(/<[^>]*>/g, '');
  return texts(block)
    .filter(([, v]) => !html.includes(escHtml(v)) && !plain.includes(escHtml(words(v))))
    .map(([k, v]) => `${block.type}.${k} "${v.slice(0, 48)}"`);
}

test('every catalog sample shows all of its text', () => {
  const missing = BLOCKS.flatMap((b) => missingText(b.sample, { interactive: false }));
  assert.deepEqual(missing, []);
});

test('every bundled example and the complete fixture show all of their text', () => {
  const files = JSON.parse(fs.readFileSync(path.join(root, 'reports/index.json'), 'utf-8'))
    .map((e) => path.join(root, 'reports', e.file));
  files.push(path.join(root, 'fixtures/complete.json'));
  const missing = [];
  for (const file of files) {
    const { model } = parse(fs.readFileSync(file, 'utf-8'));
    for (const page of model.dossier.pages) {
      for (const block of page.blocks) {
        missing.push(...missingText(block, { page }).map((m) => `${path.basename(file)}: ${m}`));
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('a steps block shows its titles, and accepts the older spellings', () => {
  const html = blockHtml({ type: 'steps', items: [{ title: 'First' }, { label: 'Second' }, { text: 'Third', detail: 'More' }] });
  for (const word of ['First', 'Second', 'Third', 'More']) assert.ok(html.includes(word), html);
});

test('a facts block shows its labels and links its href through the URL check', () => {
  const html = blockHtml({
    type: 'kv',
    items: [
      { label: 'Commit', value: '4f2a9c1', href: 'https://example.invalid/c/4f2a9c1' },
      { key: 'Old spelling', value: 'kept' },
      { label: 'Bad link', value: 'x', href: 'javascript:alert(1)' },
    ],
  });
  assert.ok(html.includes('<dt>Commit</dt>'));
  assert.ok(html.includes('<dt>Old spelling</dt>'));
  assert.ok(/<a [^>]*href="https:\/\/example\.invalid\/c\/4f2a9c1"[^>]*>4f2a9c1<\/a>/.test(html), html);
  assert.ok(!/href="javascript:/i.test(html));
});

test('a checklist shows the note the linter asks for, and names each state', () => {
  const html = blockHtml({
    type: 'checklist',
    items: [
      { label: 'Shipped', state: 'done' },
      { label: 'Per-route limits', state: 'skipped', note: 'Needs a schema change.' },
    ],
  });
  assert.ok(html.includes('Needs a schema change.'));
  assert.ok(html.includes('<span class="visually-hidden">Done: </span>'));
  assert.ok(html.includes('<span class="visually-hidden">Skipped: </span>'));
});

test('a scorecard shows the detail the linter asks for', () => {
  const html = blockHtml({ type: 'scorecard', criteria: [{ label: 'Deployed', verdict: 'fail', detail: 'Staging only.' }] });
  assert.ok(html.includes('Staging only.'));
});
