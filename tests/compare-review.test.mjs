/**
 * The reviewer's record (js/compare/review-model.js), Blind's numbering
 * (js/compare/blind.js), the Sections matrix (js/compare/sections-panel.js)
 * and the `#dc=` comparison link (js/share.js).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { newSet, addColumn, setView } from '../js/compare/model.js';
import { sanitizeSet, toBundle, fromBundle } from '../js/compare/records.js';
import {
  setMark, setPreferred, setNote, addCriterion, renameCriterion, moveCriterion, removeCriterion,
  tally, tallySentence, criterionSummary, recordSentence, reviewMarkdown, hasVerdict,
} from '../js/compare/review-model.js';
import { reportNumbers, nameOf, displayColumns } from '../js/compare/blind.js';
import { buildSections, sectionsOf, renderSections } from '../js/compare/sections-panel.js';
import { deflateRawSync } from 'node:zlib';
import {
  encodeComparison, decodeComparison, decodeFragment, COMPARISON_LINK_MAX, INFLATE_MAX_BYTES,
} from '../js/share.js';

const source = (text, kind = 'markdown') => ({ kind, name: 'r.md', text });

function threeColumns(id = 'c-review1') {
  let set = newSet({ id, now: 1, title: 'Incident review' });
  set = addColumn(set, { role: 'human', label: 'Human draft', author: 'D. Whitfield', source: source('# A') }).set;
  set = addColumn(set, { role: 'agent', label: 'Agent output', author: 'agent run 7', source: source('# B') }).set;
  set = addColumn(set, { role: 'fix', label: 'Fixes', source: source('# C') }).set;
  return set;
}

test('marks are counted, never scored, and a second choice replaces the first', () => {
  let set = threeColumns();
  set = setMark(set, 'accuracy', 'k1', 'strong');
  set = setMark(set, 'clarity', 'k1', 'weak');
  set = setMark(set, 'evidence', 'k1', 'strong');
  set = setMark(set, 'evidence', 'k1', 'adequate');
  assert.deepEqual(tally(set, 'k1'), { strong: 1, adequate: 1, weak: 1, na: 0 });
  assert.equal(tallySentence(tally(set, 'k1')), '1 strong, 1 adequate, 1 weak');
  assert.equal(tallySentence(tally(set, 'k2')), 'No marks yet');
  set = setMark(set, 'evidence', 'k1', null);
  assert.equal(tally(set, 'k1').adequate, 0, 'null clears a mark');
  assert.equal(setMark(set, 'nonsense', 'k1', 'strong'), set, 'an unknown criterion changes nothing');
  assert.equal(setMark(set, 'accuracy', 'k9', 'strong'), set, 'an unknown column changes nothing');
  const crit = set.review.criteria.find((c) => c.id === 'accuracy');
  assert.equal(criterionSummary(set, crit, set.columns, (col) => nameOf(set, col).ref), 'A strong');
});

test('a verdict entered while blind says so, and one entered with names showing says that', () => {
  let set = threeColumns();
  assert.equal(recordSentence(set), 'Nothing recorded yet.');
  assert.equal(hasVerdict(set), false);
  set = setView(set, { blind: true });
  set = setPreferred(set, 'k3');
  assert.equal(set.review.blindAtVerdict, true);
  assert.match(recordSentence(set), /^Recorded while blind/);
  set = setView(set, { blind: false });
  assert.match(recordSentence(set), /^Recorded while blind/, 'Reveal keeps the note');
  set = setMark(set, 'accuracy', 'k2', 'weak');
  assert.equal(recordSentence(set), 'Recorded with labels visible.');
  set = setPreferred(set, 'none');
  assert.equal(set.review.preferred, 'none');
  assert.equal(setPreferred(set, 'k9'), set);
});

test('criteria can be added, renamed, moved and removed, with their marks', () => {
  let set = threeColumns();
  const added = addCriterion(set, 'Tone');
  set = added.set;
  assert.equal(added.id, 'tone');
  assert.equal(addCriterion(set, 'Tone').id, 'tone-2', 'ids stay unique');
  set = renameCriterion(set, 'tone', 'Tone and register');
  assert.equal(set.review.criteria.at(-1).label, 'Tone and register');
  set = moveCriterion(set, 'tone', -1);
  assert.equal(set.review.criteria.at(-2).id, 'tone');
  set = setMark(set, 'tone', 'k1', 'na');
  set = removeCriterion(set, 'tone');
  assert.ok(!set.review.criteria.some((c) => c.id === 'tone'));
  assert.equal(set.review.marks.tone, undefined);
  for (let i = 0; i < 20; i += 1) set = addCriterion(set, `C ${i}`).set;
  assert.equal(set.review.criteria.length, 12, 'a review holds up to 12 criteria');
  assert.equal(addCriterion(set, 'One more').id, null);
});

test('the review survives a bundle round trip and the record sanitiser', () => {
  let set = threeColumns();
  set = setMark(set, 'accuracy', 'k3', 'strong');
  set = setNote(set, 'k2', 'Wrong trigger.\nGood structure.');
  set = setPreferred(set, 'k3');
  const back = fromBundle(JSON.parse(JSON.stringify(toBundle(set))), { id: 'c-back' });
  assert.deepEqual(back.review, set.review);
  const stored = sanitizeSet({ ...set, review: { ...set.review, marks: { accuracy: { k3: 'excellent', k1: 'weak' } } } });
  assert.deepEqual(stored.review.marks.accuracy, { k1: 'weak' }, 'a mark outside the list is dropped');
});

test('the Markdown copy uses the names on screen: report numbers while blind', () => {
  let set = threeColumns('c-mdcopy');
  set = setMark(set, 'accuracy', 'k1', 'strong');
  set = setNote(set, 'k1', 'Clear timeline | no actions.');
  const open = reviewMarkdown(set, displayColumns(set), (col) => nameOf(set, col));
  assert.match(open, /^# Review: Incident review/);
  assert.match(open, /- A: Human draft \(Human, D\. Whitfield\)/);
  assert.match(open, /\| Accuracy \| Strong \|  \|  \|/);
  assert.ok(!/score|total|average|rank/i.test(open.replace(/does not score/, '')), 'nothing is scored');
  const blind = setView(set, { blind: true });
  const hidden = reviewMarkdown(blind, displayColumns(blind), (col) => nameOf(blind, col));
  assert.match(hidden, /^# Review: Blind review/);
  for (const word of ['Human', 'Agent', 'Whitfield', 'Incident review', 'Fixes']) assert.ok(!hidden.includes(word), `blind copy names ${word}`);
  assert.match(hidden, /### Report \d/);
});

test('Blind numbers are a deterministic shuffle of the set, in report order', () => {
  const set = setView(threeColumns('c-blindseed'), { blind: true });
  const numbers = reportNumbers(set);
  assert.deepEqual([...numbers.values()].sort(), [1, 2, 3]);
  assert.deepEqual(reportNumbers(sanitizeSet(JSON.parse(JSON.stringify(set)))), numbers, 'the same set always deals the same numbers');
  const order = displayColumns(set).map((col) => numbers.get(col.id));
  assert.deepEqual(order, [1, 2, 3]);
  const name = nameOf(set, 'k1');
  assert.equal(name.label, `Report ${numbers.get('k1')}`);
  assert.equal(name.role, '');
  assert.equal(nameOf(setView(set, { blind: false }), 'k1').label, 'Human draft');
  // Different sets deal differently, so position in the setup is no tell.
  const deals = new Set();
  for (let i = 0; i < 12; i += 1) {
    const other = threeColumns(`c-seed${i}`);
    const dealt = reportNumbers(other);
    deals.add(other.columns.map((col) => dealt.get(col.id)).join(''));
  }
  assert.ok(deals.size > 1);
});

test('the Sections matrix finds present, renamed, moved and missing sections', () => {
  const h = (list) => list.map(([text, level]) => ({ text, level }));
  const base = h([['Report', 1], ['Summary', 2], ['Root cause', 2], ['Contributing factors', 2], ['Impact', 2], ['Action items', 2]]);
  const human = h([['Notes', 1], ['Summary', 2], ['Customer impact', 2], ['Root causes', 2], ['What went well', 2]]);
  assert.deepEqual(sectionsOf(base).map((s) => s.text), ['Summary', 'Root cause', 'Contributing factors', 'Impact', 'Action items']);
  const headings = { k1: human, k2: base, k3: null };
  const data = buildSections('k2', [{ id: 'k1' }, { id: 'k2' }, { id: 'k3' }], (id) => headings[id]);
  const state = (text) => data.rows.find((r) => r.text === text).cells.k1.state;
  assert.equal(state('Summary'), 'present');
  assert.equal(state('Root cause'), 'present', 'a section moved elsewhere is still there');
  assert.equal(state('Impact'), 'renamed');
  assert.equal(state('Contributing factors'), 'missing');
  assert.deepEqual(data.extras.map((r) => [r.text, r.owner]), [['What went well', 'k1']]);
  assert.deepEqual(data.coverage, [{ colId: 'k1', covered: 3, renamed: 1, adds: 1, total: 5 }]);
  assert.deepEqual(data.unreadable, ['k3'], 'a column running its scripts is named, not counted as missing');
});

test('a base with no sections still lists the sections only other columns have', () => {
  const h = (list) => list.map((text) => ({ text, level: 2 }));
  const set = threeColumns();
  const headings = { k1: h(['Summary', 'Impact']), k2: [], k3: h(['Impact', 'Timeline']) };
  const data = buildSections('k2', set.columns, (id) => headings[id]);
  assert.equal(data.rows.length, 0);
  assert.deepEqual(data.extras.map((r) => [r.text, r.owner]), [['Summary', 'k1'], ['Impact', 'k1'], ['Timeline', 'k3']]);
  assert.equal(data.extras[1].cells.k3.state, 'present', 'one row for a section two columns share');
  // Drawn: the rows used to be dropped with the table when the base had none.
  const host = { dataset: {}, innerHTML: '', contains: () => false, querySelector: () => null };
  const hadDocument = 'document' in globalThis;
  if (!hadDocument) globalThis.document = { activeElement: null };
  try {
    renderSections(host, set, 'k2', (id) => headings[id]);
  } finally {
    if (!hadDocument) delete globalThis.document;
  }
  assert.match(host.innerHTML, /B has no section headings to line up, so every section below is in another column only\./);
  assert.match(host.innerHTML, /Only in other columns/);
  assert.equal((host.innerHTML.match(/data-extra="\d"/g) || []).length, 6, 'three rows, each with its button');
  assert.match(host.innerHTML, /<b>A<\/b> has 2 sections the base does not\./);
  assert.ok(!/covers all 0/.test(host.innerHTML));
});

test('a comparison link round trips, and a long one says it does not fit', async () => {
  const set = threeColumns('c-link');
  const encoded = await encodeComparison(toBundle(set));
  assert.ok(encoded.fragment.startsWith('#dc='));
  assert.equal(encoded.fits, true);
  const back = fromBundle(await decodeComparison(encoded.fragment), { id: 'c-back' });
  assert.deepEqual(back.columns, set.columns);
  assert.equal(await decodeComparison('#dc=not-a-payload'), null);
  assert.equal(await decodeComparison('#dz=abc'), null);
  // Random text does not compress: well past the link limit.
  const bytes = crypto.getRandomValues(new Uint8Array(40000));
  const noise = Array.from(bytes, (b) => String.fromCharCode(33 + (b % 90))).join('');
  const big = await encodeComparison(toBundle(addColumn(set, { role: 'other', source: source(noise, 'text') }).set));
  assert.ok(big.payload.length > COMPARISON_LINK_MAX);
  assert.equal(big.fits, false);
});

test('a link that would inflate past the budget is refused as damaged', async () => {
  // About 25 KB of link that unpacks to more than the budget: a quote, a
  // run of one letter, a quote, so the text would even parse as JSON.
  const text = `"${'a'.repeat(INFLATE_MAX_BYTES)}"`;
  const payload = deflateRawSync(Buffer.from(text)).toString('base64url');
  assert.ok(payload.length < 64000, `the crafted link is ${payload.length} characters`);
  const started = performance.now();
  assert.equal(await decodeComparison(`#dc=${payload}`), null);
  assert.equal(await decodeFragment(`#dz=${payload}`), null);
  assert.ok(performance.now() - started < 5000, 'refused without unpacking everything first');
  // A small link still reads.
  const fits = `"${'a'.repeat(1000)}"`;
  assert.equal(await decodeComparison(`#dc=${deflateRawSync(Buffer.from(fits)).toString('base64url')}`), 'a'.repeat(1000));
});
