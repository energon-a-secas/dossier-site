/**
 * The page-hide journals (js/compare/journal.js and js/report-journal.js).
 *
 * A write started as the page unloads never commits, so an edit made in the
 * last moment before a reload was lost. Each view now keeps a small,
 * synchronous journal in localStorage when it hides with a save still under
 * way, and replays it on the next visit, but only over a version it knows:
 * the record is still at the revision the edit was made on, or this same tab
 * wrote it last. A record another tab saved since keeps that tab's version.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// localStorage, as the Persist Kit uses it.
const memory = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, String(v)); },
    removeItem: (k) => { memory.delete(k); },
  },
});

const {
  makeJournal, replayJournal, saveJournal, takeJournal, clearJournal, COMPARE_JOURNAL_KEY,
  JOURNAL_COLUMNS_MAX,
} = await import('../js/compare/journal.js');
const {
  journalApplies, writeReportJournal, takeReportJournal, clearReportJournal, REPORTS_JOURNAL_KEY,
  TAB_ID: REPORT_TAB,
} = await import('../js/report-journal.js');
const { newSet, addColumn } = await import('../js/compare/model.js');
const { setNote, setSummary } = await import('../js/compare/review-model.js');

const ME = 't-me';
const OTHER = 't-other';

function saved(updated = 1_000) {
  let set = newSet({ id: 'c-journal01', title: 'Journal', now: 500 });
  set = addColumn(set, { role: 'human', source: { kind: 'text', name: 'a.txt', text: 'A' } }).set;
  return { ...set, updated };
}

test('a journal over the revision its edit was made on is replayed', () => {
  const stored = saved(1_000);
  const edited = setSummary(setNote(stored, 'k1', 'Typed just before the reload'), 'And a summary');
  const journal = makeJournal(edited, { base: 1_000, writer: ME, now: 2_000 });
  const next = replayJournal(journal, { set: stored, writer: OTHER });
  assert.ok(next, 'the newer journal was dropped');
  assert.equal(next.review.notes.k1, 'Typed just before the reload');
  assert.equal(next.review.summary, 'And a summary');
  assert.equal(next.columns[0].source.text, 'A', 'the columns did not come from the stored set');
});

test('a journal over a set another tab saved since is dropped', () => {
  const stored = saved(3_000);
  const journal = makeJournal(setNote(saved(1_000), 'k1', 'Old edit'), { base: 1_000, writer: ME, now: 2_000 });
  assert.equal(replayJournal(journal, { set: stored, writer: OTHER }), null);
  // Saved by another tab after the journal, too.
  assert.equal(replayJournal(journal, { set: saved(2_500), writer: OTHER }), null);
});

test('this tab\'s own last write, landed after all, still takes the newer edit', () => {
  // The write in flight when the page hid did land (revision 1_500, by this
  // tab); the journal holds a later edit made on 1_000.
  const landed = setNote(saved(1_500), 'k1', 'First part');
  const journal = makeJournal(setNote(saved(1_000), 'k1', 'First part, then more'), { base: 1_000, writer: ME, now: 2_000 });
  const next = replayJournal(journal, { set: landed, writer: ME });
  assert.equal(next?.review.notes.k1, 'First part, then more');
  // The same journal when that write already holds everything: nothing to do.
  const all = setNote(saved(1_500), 'k1', 'First part, then more');
  assert.equal(replayJournal(journal, { set: all, writer: ME }), null);
});

test('a new comparison whose first save did not land is rebuilt only from columns in the journal', () => {
  const fresh = addColumn(newSet({ id: 'c-journal02', title: 'Pasted', now: 500 }), {
    role: 'agent', source: { kind: 'markdown', name: 'b.md', text: '# Pasted' },
  }).set;
  const withColumns = makeJournal(fresh, { writer: ME, withColumns: true, now: 2_000 });
  const rebuilt = replayJournal(withColumns, null);
  assert.equal(rebuilt?.columns[0].source.text, '# Pasted');
  assert.equal(replayJournal(makeJournal(fresh, { writer: ME, now: 2_000 }), null), null);
});

test('columns too large for the journal are left out, without throwing', () => {
  const big = addColumn(newSet({ id: 'c-journal03', now: 500 }), {
    role: 'human', source: { kind: 'text', name: 'big.txt', text: 'x'.repeat(JOURNAL_COLUMNS_MAX) },
  }).set;
  const journal = makeJournal(setNote(big, 'k1', 'Kept'), { base: 1_000, writer: ME, withColumns: true, now: 2_000 });
  assert.equal(journal.columns, undefined, 'a column over the cap went into localStorage');
  assert.equal(journal.patch.review.notes.k1, 'Kept');
  // A circular value cannot be written, and does not throw either.
  const circular = { id: 'c-journal04', columns: [] };
  circular.columns.push(circular);
  assert.doesNotThrow(() => makeJournal(circular, { withColumns: true }));
});

test('a journal is taken once, and a save that lands clears it', () => {
  const journal = makeJournal(saved(), { base: 1_000, writer: ME });
  assert.equal(saveJournal(journal), true);
  clearJournal('c-someone-else');
  assert.ok(memory.has(COMPARE_JOURNAL_KEY), 'another set\'s save cleared this journal');
  clearJournal(journal.id);
  assert.equal(memory.has(COMPARE_JOURNAL_KEY), false);
  saveJournal(journal);
  assert.equal(takeJournal()?.id, journal.id);
  assert.equal(takeJournal(), null, 'a journal was replayed twice');
  memory.set(COMPARE_JOURNAL_KEY, '{not json');
  assert.equal(takeJournal(), null);
});

// ── Reports ─────────────────────────────────────────────────────────────────

const doc = (text) => ({ dossier: { version: 1, title: 'J', pages: [{ title: 'One', blocks: [{ type: 'prose', text }] }] } });

test('the reports journal is written only while a save is under way, and only once', () => {
  const state = { savePending: false, reportId: 'r-j', reportRev: 10, document: doc('edited') };
  assert.equal(writeReportJournal(state), false, 'a journal was written with nothing waiting');
  state.savePending = true;
  assert.equal(writeReportJournal(state, { now: 20 }), true);
  const journal = takeReportJournal();
  assert.deepEqual({ id: journal.id, at: journal.at, base: journal.base, writer: journal.writer }, { id: 'r-j', at: 20, base: 10, writer: REPORT_TAB });
  assert.equal(takeReportJournal(), null);
  writeReportJournal(state);
  clearReportJournal('r-j');
  assert.equal(memory.has(REPORTS_JOURNAL_KEY), false, 'a landed save left its journal behind');
  // Too large to keep synchronously: skipped, not thrown.
  assert.equal(writeReportJournal({ ...state, document: doc('x'.repeat(2_000_001)) }), false);
});

test('the reports journal applies over its own base or this tab\'s write, never another tab\'s', () => {
  const journal = { id: 'r-j', at: 2_000, base: 1_000, writer: ME, document: doc('journal') };
  const record = (updated, writer, text = 'stored') => ({ meta: { updated, writer }, document: doc(text) });
  assert.equal(journalApplies(journal, null), true, 'a report whose first save did not land was dropped');
  assert.equal(journalApplies(journal, record(1_000, OTHER)), true);
  assert.equal(journalApplies(journal, record(1_500, ME)), true);
  assert.equal(journalApplies(journal, record(1_500, OTHER)), false, 'another tab\'s save was written over');
  assert.equal(journalApplies(journal, record(2_500, ME)), false, 'a save newer than the journal was written over');
  assert.equal(journalApplies(journal, record(1_000, OTHER, 'journal')), false, 'an identical record was written again');
});
