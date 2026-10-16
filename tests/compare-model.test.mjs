/** js/compare/model.js and records.js: the shape of a comparison, every change to it, and reading one back. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newSet, blankSet, addColumn, updateColumn, removeColumn, moveColumn, duplicateColumn,
  setView, setTitle, defaultBase, letterOf, defaultLabel, sameContent, MAX_COLUMNS, MAX_SOURCE_CHARS,
} from '../js/compare/model.js';
import {
  sanitizeSet, toBundle, fromBundle, isBundle, describeSet,
} from '../js/compare/records.js';

const source = (text = '# Report', kind = 'markdown') => ({ kind, name: 'r.md', text });

test('a blank set starts with A Human and B Agent, empty', () => {
  const set = blankSet({ id: 'c-test', now: 1 });
  assert.equal(set.id, 'c-test');
  assert.deepEqual(set.columns.map((c) => [c.id, c.role, c.label, c.source]), [
    ['k1', 'human', 'Human', null],
    ['k2', 'agent', 'Agent', null],
  ]);
  assert.equal(set.view.focus, 'k1');
  assert.deepEqual(set.review.criteria.map((c) => c.label), ['Accuracy', 'Completeness', 'Clarity', 'Evidence', 'Actionability']);
});

test('functions return a new set and leave the old one alone', () => {
  const before = blankSet({ id: 'c-a' });
  const frozen = JSON.stringify(before);
  const after = updateColumn(before, 'k1', { label: 'Draft' });
  assert.notEqual(after, before);
  assert.equal(JSON.stringify(before), frozen);
  assert.equal(after.columns[0].label, 'Draft');
});

test('column ids are never reused, even after a removal', () => {
  let set = blankSet({ id: 'c-a' });
  set = removeColumn(set, 'k2');
  const added = addColumn(set, { role: 'agent' });
  assert.equal(added.id, 'k3');
  assert.deepEqual(added.set.columns.map((c) => c.id), ['k1', 'k3']);
});

test('four columns at most, letters follow position', () => {
  let set = blankSet({ id: 'c-a' });
  set = addColumn(set, { role: 'fix' }).set;
  set = addColumn(set, { role: 'other' }).set;
  assert.equal(set.columns.length, MAX_COLUMNS);
  const refused = addColumn(set, { role: 'other' });
  assert.equal(refused.id, null);
  assert.equal(refused.set, set);
  assert.equal(duplicateColumn(set, 'k1').id, null);
  assert.deepEqual(set.columns.map((c) => letterOf(set, c.id)), ['A', 'B', 'C', 'D']);
  const moved = moveColumn(set, 'k4', -1);
  assert.deepEqual(moved.columns.map((c) => c.id), ['k1', 'k2', 'k4', 'k3']);
  assert.equal(letterOf(moved, 'k4'), 'C');
  assert.equal(moveColumn(set, 'k1', -1), set, 'moving past the edge changes nothing');
});

test('default labels count up and a Fixes column points at what it fixes', () => {
  let set = blankSet({ id: 'c-a' });
  assert.equal(defaultLabel(set, 'agent'), 'Agent 2');
  set = addColumn(set, { role: 'fix' }).set;
  const fix = set.columns[2];
  assert.equal(fix.label, 'Fixes');
  assert.equal(fix.fixes, 'k2', 'a new fix corrects the last column that is not a fix');
  // Removing the target clears the reference rather than leaving it dangling.
  const without = removeColumn(set, 'k2');
  assert.equal(without.columns.find((c) => c.id === 'k3').fixes, null);
});

test('the default base is what a filled Fixes column fixes, else the first report', () => {
  let set = blankSet({ id: 'c-a' });
  assert.equal(defaultBase(set), 'k1');
  set = updateColumn(set, 'k2', { source: source() });
  assert.equal(defaultBase(set), 'k2');
  set = updateColumn(set, 'k1', { source: source() });
  set = addColumn(set, { role: 'fix', fixes: 'k2', source: source('# Fixed') }).set;
  assert.equal(defaultBase(set), 'k2');
});

test('removing a column drops its review entries and fixes the view', () => {
  let set = blankSet({ id: 'c-a' });
  set = setView(set, { focus: 'k2', diff: { base: 'k2' } });
  set = { ...set, review: { ...set.review, marks: { accuracy: { k1: 'strong', k2: 'weak' } }, notes: { k2: 'thin' }, preferred: 'k2' } };
  const next = removeColumn(set, 'k2');
  assert.equal(next.view.focus, 'k1');
  assert.equal(next.view.diff.base, null);
  assert.deepEqual(next.review.marks, { accuracy: { k1: 'strong' } });
  assert.deepEqual(next.review.notes, {});
  assert.equal(next.review.preferred, null);
});

test('labels, authors and titles are cut to their limits and cleaned', () => {
  let set = blankSet({ id: 'c-a' });
  set = updateColumn(set, 'k1', { label: `  ${'x'.repeat(60)}\u0000 `, author: 'A\nB' });
  assert.equal(set.columns[0].label.length, 40);
  assert.equal(set.columns[0].author, 'A B');
  assert.equal(setTitle(set, '   ').title, 'Untitled comparison');
  assert.equal(updateColumn(set, 'k1', { label: '' }).columns[0].label, 'Human');
});

test('sanitizeSet drops what it does not recognise', () => {
  const raw = {
    id: 'c-ok',
    title: 'T',
    columns: [
      { id: 'k1', role: 'robot', label: 'A', source: { kind: 'html', name: 'a.html', text: '<p>a</p>' } },
      { id: 'k1', role: 'agent', label: 'Dup id', source: { kind: 'exe', text: 'x' } },
      { id: 'zz', role: 'fix', fixes: 'k1', source: { kind: 'text', text: 'x'.repeat(MAX_SOURCE_CHARS + 1) } },
      'nonsense',
      { role: 'other' },
      { role: 'other' },
    ],
    view: { mode: 'interactive', sync: 'bogus', layout: 'focus', focus: 'k9', panel: 'review', blind: 'yes', diff: { on: 'no', base: 'k1' } },
    review: { criteria: [{ id: 'accuracy', label: 'Accuracy' }, { id: 'BAD ID', label: 'x' }], marks: { accuracy: { k1: 'great', k2: 'weak' } }, preferred: 'k7' },
    extra: 'dropped',
  };
  const set = sanitizeSet(raw);
  assert.equal(set.columns.length, 4);
  assert.deepEqual(set.columns.map((c) => c.id), ['k1', 'k2', 'k3', 'k4']);
  assert.equal(set.columns[0].role, 'other');
  assert.equal(set.columns[1].source, null, 'an unknown kind is not a source');
  assert.equal(set.columns[2].source, null, 'a source over the cap is dropped');
  assert.equal(set.columns[2].fixes, 'k1');
  assert.equal(set.view.mode, 'format', 'interactive is per column, never the set default');
  assert.equal(set.view.sync, 'sections');
  assert.equal(set.view.focus, 'k1');
  assert.equal(set.view.blind, false);
  assert.equal(set.view.diff.on, true);
  assert.equal(set.view.diff.base, 'k1');
  assert.deepEqual(set.review.criteria.map((c) => c.id), ['accuracy']);
  assert.deepEqual(set.review.marks, { accuracy: { k2: 'weak' } });
  assert.equal(set.review.preferred, null);
  assert.equal('extra' in set, false);
  assert.ok(set.seq >= 4);
  assert.equal(sanitizeSet({ id: 'not a set id' }), null);
  assert.equal(sanitizeSet(null), null);
  assert.equal(sanitizeSet([]), null);
});

test('a bundle round trip keeps the set and gives it a new id', () => {
  let set = blankSet({ id: 'c-orig', now: 5 });
  set = updateColumn(set, 'k1', { source: source('# One'), author: 'D. W.' });
  set = setTitle(set, 'Review');
  const bundle = JSON.parse(JSON.stringify(toBundle(set)));
  assert.equal(isBundle(bundle), true);
  assert.equal(bundle.dossierCompare.version, 1);
  assert.equal('id' in bundle.dossierCompare, false);
  const back = fromBundle(bundle, { id: 'c-copy' });
  assert.equal(back.id, 'c-copy');
  assert.deepEqual({ ...back, id: 'c-orig' }, set);
  assert.equal(fromBundle({ dossierCompare: { version: 99 } }), null);
  assert.equal(isBundle({ dossier: {} }), false);
});

test('new sets get distinct ids and a describable summary', () => {
  const a = newSet();
  const b = newSet();
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^c-[a-z0-9]{10}$/);
  let set = blankSet({ id: 'c-a' });
  assert.equal(describeSet(set), '2 columns, 0 with a report');
  set = updateColumn(set, 'k1', { source: source() });
  set = updateColumn(set, 'k2', { source: source() });
  assert.equal(describeSet(set), '2 columns: Human, Agent');
});

test('sameContent tells a view change from a change to what the set holds', () => {
  const set = updateColumn(blankSet({ id: 'c-same' }), 'k1', { source: source('# One') });
  // How it is shown: never a reason to save the example or a blank set.
  assert.equal(sameContent(set, setView(set, { focus: 'k2' })), true);
  assert.equal(sameContent(set, setView(set, { layout: 'focus', sync: 'off', mode: 'original' })), true);
  assert.equal(sameContent(set, setView(set, { diff: { on: false } })), true);
  assert.equal(sameContent(set, updateColumn(set, 'k1', { mode: 'original' })), true);
  // What it holds.
  assert.equal(sameContent(set, setTitle(set, 'Renamed')), false);
  assert.equal(sameContent(set, updateColumn(set, 'k1', { label: 'Draft' })), false);
  assert.equal(sameContent(set, updateColumn(set, 'k2', { source: source('# Two') })), false);
  assert.equal(sameContent(set, updateColumn(set, 'k1', { source: source('# One, edited') })), false);
  assert.equal(sameContent(set, addColumn(set, { role: 'fix' }).set), false);
  assert.equal(sameContent(set, removeColumn(set, 'k2')), false);
  assert.equal(sameContent(set, moveColumn(set, 'k1', 1)), false);
  assert.equal(sameContent(set, { ...set, review: { ...set.review, summary: 'Prefer B.' } }), false);
  assert.equal(sameContent(null, set), false);
});
