/**
 * Two tabs on one comparison (js/compare/merge.js and the revision check in
 * js/compare/store.js). A tab that heard another tab's save while a save of
 * its own was waiting used to ignore it and then write its whole set over
 * it: a note typed in one tab and a mark clicked in the other could not both
 * survive. Now the store refuses a save made on an older revision and the
 * two versions are merged key by key.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIndexedDB } from './fake-idb.mjs';

const fake = createFakeIndexedDB();
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: fake.indexedDB });
Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });

const { mergeSets } = await import('../js/compare/merge.js');
const {
  newSet, addColumn, setTitle, setView, updateColumn, removeColumn,
} = await import('../js/compare/model.js');
const { setNote, setMark, setSummary, setPreferred } = await import('../js/compare/review-model.js');
const { writeSet, readSet, readSetRecord, TAB_ID } = await import('../js/compare/store.js');

const text = (body, name = 'r.txt') => ({ kind: 'text', name, text: body });

/** A saved-looking set with two filled columns, k1 and k2. */
function twoColumns(id = 'c-merge0001') {
  let set = newSet({ id, title: 'Incident review', now: 1_700_000_000_000 });
  set = addColumn(set, { role: 'human', source: text('Human draft.') }).set;
  set = addColumn(set, { role: 'agent', source: text('Agent output.') }).set;
  return set;
}

test('a note in each tab, on different columns: both are kept', () => {
  const base = twoColumns();
  const mine = setNote(base, 'k1', 'Mine on A');
  const theirs = setNote(base, 'k2', 'Theirs on B');
  const merged = mergeSets(base, mine, theirs);
  assert.deepEqual(merged.review.notes, { k1: 'Mine on A', k2: 'Theirs on B' });
});

test('the same note edited in both tabs: this tab wins', () => {
  const base = setNote(twoColumns(), 'k1', 'Before');
  const merged = mergeSets(base, setNote(base, 'k1', 'Mine'), setNote(base, 'k1', 'Theirs'));
  assert.equal(merged.review.notes.k1, 'Mine');
});

test('a note left alone here takes the other tab\'s edit', () => {
  const base = setNote(twoColumns(), 'k1', 'Before');
  const mine = setSummary(base, 'A summary typed here');
  const merged = mergeSets(base, mine, setNote(base, 'k1', 'Edited there'));
  assert.equal(merged.review.notes.k1, 'Edited there');
  assert.equal(merged.review.summary, 'A summary typed here');
});

test('marks merge by criterion and column, and a cleared mark stays cleared', () => {
  let base = twoColumns();
  base = setMark(base, 'accuracy', 'k1', 'adequate');
  const mine = setMark(setMark(base, 'clarity', 'k1', 'strong'), 'accuracy', 'k1', null);
  const theirs = setMark(base, 'accuracy', 'k2', 'weak');
  const merged = mergeSets(base, mine, theirs);
  assert.equal(merged.review.marks.accuracy?.k1, undefined, 'a mark cleared here came back');
  assert.equal(merged.review.marks.accuracy.k2, 'weak');
  assert.equal(merged.review.marks.clarity.k1, 'strong');
});

test('title, brief and preferred follow whoever changed them; the view is always this tab\'s', () => {
  const base = twoColumns();
  const mine = setView(setPreferred(base, 'k2'), { layout: 'focus', focus: 'k2' });
  const theirs = setView(setTitle(base, 'Renamed there'), { layout: 'columns', panel: 'review' });
  const merged = mergeSets(base, mine, theirs);
  assert.equal(merged.title, 'Renamed there');
  assert.equal(merged.review.preferred, 'k2');
  assert.equal(merged.view.layout, 'focus');
  assert.equal(merged.view.panel, mine.view.panel);
});

test('a column removed in one tab stays removed unless the other changed it', () => {
  const base = twoColumns();
  // Removed there, untouched here: gone, with its note.
  const removed = mergeSets(base, setNote(base, 'k1', 'Here'), removeColumn(base, 'k2'));
  assert.deepEqual(removed.columns.map((c) => c.id), ['k1']);
  assert.equal(removed.review.notes.k1, 'Here');
  // Removed there, but its label changed here: kept.
  const kept = mergeSets(base, updateColumn(base, 'k2', { label: 'Agent, relabelled' }), removeColumn(base, 'k2'));
  assert.deepEqual(kept.columns.map((c) => c.id), ['k1', 'k2']);
  assert.equal(kept.columns[1].label, 'Agent, relabelled');
});

test('a column added in each tab under the same id stays two columns', () => {
  const base = twoColumns();
  const mine = addColumn(base, { role: 'fix', fixes: 'k2', source: text('Fixed here.') }).set;
  const theirsAdded = addColumn(base, { role: 'other', source: text('Another there.') });
  assert.equal(theirsAdded.id, 'k3', 'the check needs both tabs to pick the same next id');
  const theirs = setNote(theirsAdded.set, 'k3', 'Note on the other one');
  const merged = mergeSets(base, mine, theirs);
  assert.equal(merged.columns.length, 4);
  const moved = merged.columns.find((c) => c.source?.text === 'Another there.');
  assert.notEqual(moved.id, 'k3');
  assert.equal(merged.review.notes[moved.id], 'Note on the other one', 'the note did not follow its column');
  assert.equal(merged.columns.find((c) => c.id === 'k3').source.text, 'Fixed here.');
});

test('a merge with no base keeps what this tab has and fills in the rest', () => {
  const base = twoColumns();
  const merged = mergeSets(null, setNote(base, 'k1', 'Mine'), setNote(base, 'k2', 'Theirs'));
  assert.deepEqual(merged.review.notes, { k1: 'Mine', k2: 'Theirs' });
});

test('the store refuses a save made on an older revision, and the merge then lands', async () => {
  const set = twoColumns('c-store0001');
  const first = await writeSet(set);
  assert.ok(first && Number.isFinite(first.updated));
  assert.equal((await readSetRecord(set.id)).writer, TAB_ID, 'the record does not say which tab wrote it');
  // Another tab writes a note on k2 over the first revision.
  const theirs = await writeSet(setNote(first, 'k2', 'Theirs'), { expect: first.updated });
  assert.ok(theirs && !theirs.conflict && theirs.updated > first.updated);
  // This tab, still on the first revision, saves its note on k1.
  const mine = setNote(first, 'k1', 'Mine');
  const refused = await writeSet(mine, { expect: first.updated });
  assert.equal(refused.conflict, true, 'a save on an old revision was written over the newer one');
  assert.equal((await readSet(set.id)).review.notes.k2, 'Theirs', 'the refused save changed the record');
  const merged = mergeSets(first, mine, refused.current);
  const landed = await writeSet(merged, { expect: refused.current.updated });
  assert.ok(landed && !landed.conflict);
  assert.deepEqual((await readSet(set.id)).review.notes, { k1: 'Mine', k2: 'Theirs' });
});

test('saving a comparison recovers after the site data is cleared', async () => {
  const set = twoColumns('c-clear0001');
  assert.ok(await writeSet(set));
  fake.killConnections({ fireClose: false });
  const again = await writeSet(setNote(set, 'k1', 'After the clear'));
  assert.ok(again && !again.conflict, 'the first save after the clear failed');
  assert.equal((await readSet(set.id)).review.notes.k1, 'After the clear');
});
