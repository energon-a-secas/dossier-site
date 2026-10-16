/**
 * Reading a report back from the library (js/open.js readRecord).
 *
 * A record saved before stored documents were authored-only carries derived
 * page ids, block ids and computed fields. readRecord reads it clean and says
 * it is stale, so it is saved once and stops warning. It decides that from the
 * document's shape, not from the wording of parse.js's warning, so a reworded
 * message cannot quietly turn the rewrite off. A clean record is not stale, so
 * opening it does not save it again and move it to the top of the list.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyText } from '../js/pipeline.js';
import { readRecord, carriesDerived } from '../js/open.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reports = fs.readdirSync(path.join(root, 'reports'))
  .filter((f) => f.endsWith('.json') && f !== 'index.json');

const fresh = () => ({ preferences: {}, findings: [], page: null });
const copy = (value) => JSON.parse(JSON.stringify(value));
const derivedWarnings = (findings) => findings.filter((f) => /derived/i.test(f.message || ''));

function opened(file) {
  const state = fresh();
  const text = fs.readFileSync(path.join(root, 'reports', file), 'utf8');
  assert.equal(applyText(state, text).ok, true, `${file} should open`);
  return state;
}

for (const file of reports) {
  test(`${file}: a clean stored record is not stale`, () => {
    const state = opened(file);
    const stored = copy(state.document);
    assert.equal(carriesDerived(stored), false);
    const { read, stale } = readRecord({ document: stored });
    assert.equal(read.ok, true);
    assert.equal(stale, false);
    assert.deepEqual(derivedWarnings(read.findings), []);
  });
}

test('a record saved as the derived model is stale and reads clean', () => {
  for (const file of reports) {
    const state = opened(file);
    const legacy = copy(state.model);
    if (!carriesDerived(legacy)) continue;
    const { read, stale } = readRecord({ document: legacy });
    assert.equal(read.ok, true, file);
    assert.equal(stale, true, file);
    assert.deepEqual(derivedWarnings(read.findings), [], file);
    // The clean read is what gets saved, and it is not stale itself.
    assert.equal(carriesDerived(read.document), false, file);
  }
});

test('a supplied page id or block id marks a record stale', () => {
  const base = {
    dossier: {
      version: 1,
      title: 'T',
      kind: 'summary',
      pages: [{ title: 'P', blocks: [{ type: 'prose', text: 'x' }] }],
    },
  };
  assert.equal(carriesDerived(base), false);

  const pageId = copy(base);
  pageId.dossier.pages[0].id = 'p';
  assert.equal(carriesDerived(pageId), true);
  assert.equal(readRecord({ document: pageId }).stale, true);

  const blockId = copy(base);
  blockId.dossier.pages[0].blocks[0].id = 'b';
  assert.equal(carriesDerived(blockId), true);
  assert.equal(readRecord({ document: blockId }).stale, true);
});

test('carriesDerived tolerates documents of the wrong shape', () => {
  for (const doc of [null, undefined, {}, { dossier: {} }, { dossier: { pages: 'x' } },
    { dossier: { pages: [null, 3, { blocks: [null, 'x', {}] }] } }]) {
    assert.equal(carriesDerived(doc), false);
  }
});
