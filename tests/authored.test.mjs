/**
 * What is saved, shared and exported is the authored document.
 *
 * The bug this guards: `state.document` used to be the derived model, so every
 * save carried derived page ids, block ids and computed fields, and the next
 * parse stripped each one with a warning. The bundled example gained eleven
 * warnings after one save and reopen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyText, applyDocument, authored, carryDerivedMarks } from '../js/pipeline.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reports = fs.readdirSync(path.join(root, 'reports'))
  .filter((f) => f.endsWith('.json') && f !== 'index.json');

const fresh = () => ({ preferences: {}, findings: [], page: null });
const serious = (findings) => findings.filter((f) => f.level === 'warn' || f.level === 'error');
const derivedWarnings = (findings) => findings.filter((f) => /is derived and supplied/.test(f.message));

for (const file of reports) {
  test(`${file}: save and reopen adds no findings`, () => {
    const first = fresh();
    assert.equal(applyText(first, fs.readFileSync(path.join(root, 'reports', file), 'utf8')).ok, true);

    // What persistCurrent stores and copyShareLink encodes.
    const stored = JSON.parse(JSON.stringify(first.document));
    const second = fresh();
    assert.equal(applyText(second, JSON.stringify(stored, null, 2)).ok, true);

    assert.deepEqual(derivedWarnings(second.findings), []);
    assert.equal(serious(second.findings).length, serious(first.findings).length);
    // The editor shows the same authored text the store holds.
    assert.deepEqual(JSON.parse(second.sourceText), stored);
  });
}

test('the bundled example stores no page or block ids', () => {
  const state = fresh();
  applyText(state, fs.readFileSync(path.join(root, 'reports', 'responses.json'), 'utf8'));
  assert.ok(state.model.dossier.pages.every((p) => p.id), 'the model still has derived page ids');
  for (const page of state.document.dossier.pages) {
    assert.equal(page.id, undefined);
    for (const block of page.blocks) assert.equal(block.id, undefined);
  }
});

test('authored() returns an equal copy of a plain document', () => {
  const doc = { dossier: { version: 1, title: 'T', pages: [{ title: 'One', blocks: [{ type: 'prose', text: 'x' }] }] } };
  const copy = authored(doc);
  assert.deepEqual(copy, doc);
  assert.notEqual(copy, doc);
});

test('a form edit built with spreads keeps derived ids out of the source', () => {
  const state = fresh();
  applyText(state, fs.readFileSync(path.join(root, 'reports', 'responses.json'), 'utf8'));
  const report = state.model.dossier;
  // The shape js/authoring.js hands back: a spread page with one block replaced.
  const next = {
    dossier: {
      ...report,
      title: 'Edited',
      pages: report.pages.map((p, i) => (i === 0 ? { ...p, blocks: p.blocks.map((b) => ({ ...b })) } : p)),
    },
  };
  applyDocument(state, carryDerivedMarks(next, state.model));
  assert.equal(state.document.dossier.title, 'Edited');
  assert.deepEqual(derivedWarnings(state.findings), []);
  assert.equal(JSON.parse(state.sourceText).dossier.pages[0].id, undefined);
});

test('an edited value that was derived stays the author\'s', () => {
  const state = fresh();
  applyText(state, JSON.stringify({
    dossier: { version: 1, title: 'T', pages: [{ title: 'One', blocks: [{ type: 'prose', title: 'Intro', text: 'x' }] }] },
  }));
  const page = state.model.dossier.pages[0];
  const next = { dossier: { ...state.model.dossier, pages: [{ ...page, id: 'renamed' }] } };
  carryDerivedMarks(next, state.model);
  assert.equal(authored(next).dossier.pages[0].id, 'renamed');
});
