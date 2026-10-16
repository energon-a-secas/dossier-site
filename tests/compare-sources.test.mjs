/**
 * js/compare/sources.js: what goes into a column. A file that tries to be a
 * Dossier document or a comparison file and does not read is refused with
 * the reader's reason (R43), and what is stored is never over the cap a
 * column keeps (R4).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, looksLikeDossierYaml } from '../js/compare/sources.js';
import { MAX_SOURCE_CHARS, sourceFits } from '../js/compare/model.js';

const BROKEN_YAML = 'dossier:\n  version: 1\n  title: "x\n  pages:\n';
const GOOD_YAML = 'dossier:\n  version: 1\n  title: Fine\n  pages:\n    - title: P\n      blocks:\n        - type: prose\n          text: hello\n';

test('a broken YAML Dossier document is refused with the first line of the reason', async () => {
  const read = await readSource(BROKEN_YAML, 'bad.yaml');
  assert.equal(read.ok, false);
  assert.match(read.message, /^That looks like a Dossier document, but it could not be read: /);
  assert.ok(!read.message.includes('\n'), 'the reader\'s code frame is left out');
  // A leading comment and a document marker do not hide it (the Markdown
  // adapter claims a file that starts with "# ").
  const commented = await readSource(`# note\n---\n${BROKEN_YAML}`, 'bad2.yaml');
  assert.equal(commented.ok, false);
  assert.match(commented.message, /^That looks like a Dossier document/);
  assert.match(commented.message, /\(6:3\)|line 6\b/, 'line numbers still match the file');
});

test('a comparison file cut short is refused, not kept as text', async () => {
  const read = await readSource('{"dossierCompare": {"version": 1, "title": "x", "columns": [', 'c.json');
  assert.equal(read.ok, false);
  assert.match(read.message, /comparison file/);
  assert.ok(!read.message.includes('\n'));
  const wrong = await readSource('{"dossierCompare": "x"}', 'w.json');
  assert.equal(wrong.ok, false);
  assert.match(wrong.message, /not a comparison this version reads/);
});

test('what only mentions the words is still text, and good input still reads', async () => {
  const yaml = await readSource(GOOD_YAML, 'ok.yaml');
  assert.equal(yaml.source.kind, 'dossier');
  assert.equal(JSON.parse(yaml.source.text).dossier.title, 'Fine');
  const commented = await readSource(`# A report\n---\n${GOOD_YAML}`, 'ok2.yaml');
  assert.equal(commented.source.kind, 'dossier', 'a leading comment no longer makes it Markdown');
  assert.equal((await readSource('notes:\n  dossier: x', 'n.txt')).source.kind, 'text');
  assert.equal((await readSource('Some prose says "dossierCompare": here.', 'p.txt')).source.kind, 'text');
  const bundle = await readSource(JSON.stringify({ dossierCompare: { version: 1, columns: [] } }), 'b.json');
  assert.ok(bundle.ok && bundle.bundle, 'a valid bundle is still a bundle');
  const bad = await readSource('{"dossier": ', 'bad.json');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /^That looks like a Dossier document/);
  assert.equal(looksLikeDossierYaml('﻿# c\n\n---\ndossier:\n'), true);
  assert.equal(looksLikeDossierYaml('title: x\ndossier:\n'), false);
});

test('a minified Dossier document under the cap is kept as written, not pretty-printed past it', async () => {
  const blocks = [];
  // About 1.4 million characters minified and 5.4 million pretty-printed:
  // short list items, each a line of its own once indented.
  for (let i = 0; i < 2600; i += 1) {
    blocks.push({ type: 'list', items: Array.from({ length: 100 }, (_, j) => `w${j % 10}`) });
  }
  const text = JSON.stringify({ dossier: { version: 1, title: 'Big', pages: [{ title: 'P', blocks }] } });
  assert.ok(text.length < MAX_SOURCE_CHARS, `the input is ${text.length} characters`);
  assert.ok(JSON.stringify(JSON.parse(text), null, 2).length > MAX_SOURCE_CHARS, 'its pretty form is over the cap');
  const read = await readSource(text, 'mini.json');
  assert.equal(read.ok, true, read.message);
  assert.equal(read.source.kind, 'dossier');
  assert.equal(read.source.text, text, 'the author\'s own text');
  assert.ok(sourceFits(read.source), 'the model keeps it');
});

test('a converted document is pretty only while that fits, and refused when even one line does not', async () => {
  const lines = [];
  for (let i = 0; i < 26000; i += 1) lines.push(`${i % 97}\t${i % 13}\tsrc/module-${i}/a-long-file-name-for-the-test-${i}.js`);
  const numstat = lines.join('\n');
  assert.ok(numstat.length < MAX_SOURCE_CHARS);
  const read = await readSource(numstat, 'stats.txt');
  if (read.ok) {
    assert.equal(read.source.kind, 'dossier');
    assert.ok(read.source.text.length <= MAX_SOURCE_CHARS, `stored ${read.source.text.length} characters`);
    assert.ok(sourceFits(read.source));
    assert.match(read.source.note, /^Converted from /);
  } else {
    assert.match(read.message, /converted to a Dossier document, is [\d,]+ characters long/);
  }
});
