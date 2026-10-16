/**
 * The reviewer's record (js/compare/review-model.js), Blind's numbering
 * (js/compare/blind.js), the Sections matrix (js/compare/sections-panel.js)
 * and the `#dc=` comparison link (js/share.js).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newSet, addColumn, setView, setPrompt, removeColumn, SET_ID,
} from '../js/compare/model.js';
import { sanitizeSet, toBundle, fromBundle } from '../js/compare/records.js';
import {
  setMark, setPreferred, setNote, setSummary, addCriterion, renameCriterion, moveCriterion, removeCriterion,
  tally, tallySentence, criterionSummary, recordSentence, reviewMarkdown, hasVerdict, blindOrderSentence,
} from '../js/compare/review-model.js';
import { reportNumbers, nameOf, displayColumns } from '../js/compare/blind.js';
import { buildSections, sectionsOf, renderSections } from '../js/compare/sections-panel.js';
import { withSectionText, sectionTexts } from '../js/compare/section-text.js';
import { markdownToIr } from '../js/compare/markdown-ir.js';
import { headingsOf } from '../js/compare/ir.js';
import { deflateRawSync } from 'node:zlib';
import {
  encodeComparison, decodeComparison, decodeFragment, comparisonLinkId, COMPARISON_LINK_MAX, INFLATE_MAX_BYTES,
  decompressDeflateRaw,
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
  // The panel names the control that exists, the Blind toggle; there is no "Reveal".
  assert.match(recordSentence(set), /^Marks were entered with Blind on/);
  assert.ok(!recordSentence(set).includes('Reveal'));
  set = setView(set, { blind: false });
  assert.match(recordSentence(set), /^Marks were entered with Blind on/, 'Turning Blind off keeps the note');
  // A copy or a file has no controls: it says what happened, nothing else.
  const copy = recordSentence(set, { copy: true });
  assert.match(copy, /names were hidden \(blind review\)/);
  assert.ok(!copy.includes('Reveal') && !copy.includes('Blind on'), copy);
  set = setMark(set, 'accuracy', 'k2', 'weak');
  assert.equal(recordSentence(set), 'Recorded with labels visible.');
  assert.equal(recordSentence(set, { copy: true }), 'Marks were entered with the names showing.');
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
  assert.deepEqual(data.coverage, [{
    colId: 'k1', covered: 3, renamed: 1, content: 0, adds: 1, total: 5,
  }]);
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

/** A column's headings as the Sections panel reads them: with label lines and body words. */
const sectionHeadings = (text) => {
  const blocks = markdownToIr(text).blocks;
  return withSectionText(headingsOf(blocks).map(({ text: t, level }) => ({ text: t, level })), blocks);
};

/** Draw the Sections panel into a stand-in host, the way the test above does. */
function drawSections(set, baseId, headingsFor) {
  const host = { dataset: {}, innerHTML: '', contains: () => false, querySelector: () => null };
  const hadDocument = 'document' in globalThis;
  if (!hadDocument) globalThis.document = { activeElement: null };
  try {
    renderSections(host, set, baseId, headingsFor);
  } finally {
    if (!hadDocument) delete globalThis.document;
  }
  return host;
}

test('a reworded section is matched by a label line above it, or by its wording, never called missing', () => {
  const S = 'The follow-up work covers rotating the credentials, moving the alerts to the shared pager, writing the runbook for the cache tier, and checking every dashboard against the new service names before the end of the quarter.';
  const base = [
    '# Roadmap',
    '',
    'The cost of EOL today',
    '',
    '## 201 EOL tickets in 52 Jira projects',
    '',
    'Teams filed two hundred tickets about end of life software in the last year, most of them late, many of them duplicated across projects, and few of them closed on time.',
    '',
    '## Follow-up actions',
    '',
    S,
    '',
    '## Five teams keep their own data',
    '',
    'Inventory lives in five separate spreadsheets owned by five teams, each with its own columns, its own refresh habits and its own idea of what counts as a service.',
  ].join('\n');
  const other = [
    '## Executive summary',
    '',
    '## The cost of EOL today',
    '',
    'Upgrade work arrives as a steady stream of urgent requests that interrupt planned projects and push delivery dates out by weeks.',
    '',
    '## Action items',
    '',
    S,
  ].join('\n');
  const lists = { k1: sectionHeadings(base), k2: sectionHeadings(other) };
  const data = buildSections('k1', [{ id: 'k1' }, { id: 'k2' }], (id) => lists[id]);
  const cell = (text) => data.rows.find((r) => r.text === text).cells.k2;
  assert.deepEqual([cell('201 EOL tickets in 52 Jira projects').state, cell('201 EOL tickets in 52 Jira projects').text], ['renamed', 'The cost of EOL today']);
  assert.deepEqual([cell('Follow-up actions').state, cell('Follow-up actions').text], ['content', 'Action items']);
  assert.ok(Number.isInteger(cell('Follow-up actions').heading), 'a row matched by wording can be jumped to');
  assert.equal(cell('Five teams keep their own data').state, 'missing');
  assert.deepEqual(data.extras.map((r) => r.text), ['Executive summary']);
  assert.deepEqual(data.coverage[0], {
    colId: 'k2', covered: 2, renamed: 1, content: 1, adds: 1, total: 3,
  });
  let set = newSet({ id: 'c-sections', now: 1 });
  set = addColumn(set, { role: 'human', label: 'Human', source: source(base) }).set;
  set = addColumn(set, { role: 'agent', label: 'Agent', source: source(other) }).set;
  const host = drawSections(set, 'k1', (id) => lists[id]);
  assert.match(host.innerHTML, />By wording</);
  assert.match(host.innerHTML, /B has it as "Action items", matched by wording/);
  assert.match(host.innerHTML, /\(1 under another name, 1 matched by wording\)/);
  assert.match(host.innerHTML, /Matched by heading text, or by shared wording when the headings differ, never by meaning\./);
});

test('short bodies, a sibling heading\'s only line and a shared label do not match sections', () => {
  const short = { k1: sectionHeadings('## Alpha plan\n\nShip it soon.'), k2: sectionHeadings('## Gamma notes\n\nShip it soon.') };
  assert.equal(buildSections('k1', [{ id: 'k1' }, { id: 'k2' }], (id) => short[id]).rows[0].cells.k2.state, 'missing', 'fewer than 15 words say too little');
  const texts = sectionTexts(markdownToIr('## Status\n\nGreen\n\n## Next steps\n\nMore words.').blocks);
  assert.equal(texts[1].alt, '', 'the whole body of a sibling heading is not a label');
  const appendix = sectionTexts(markdownToIr('Appendix\n\n## Data\n\nRows.\n\nAppendix\n\n## Method\n\nSteps.').blocks);
  assert.deepEqual(appendix.map((e) => e.alt), ['', ''], 'a label two headings share is a category');
  const blocks = markdownToIr('## One\n\nFirst body.\n\n## Two\n\nSecond body.').blocks;
  const mapped = withSectionText([{ text: 'Not in the IR', level: 2 }, { text: 'One', level: 2 }, { text: 'Two', level: 2 }], blocks);
  assert.equal(mapped[0].words, undefined, 'a heading the IR does not have is left as it was');
  assert.equal(mapped[2].words.size, 2, 'and the later ones are still matched');
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

// About 25 KB of link that unpacks to more than the budget: a quote, a run
// of one letter, a quote, so the text would even parse as JSON. Built once:
// deflating 25 MB costs a few hundred milliseconds.
const bomb = new Uint8Array(deflateRawSync(Buffer.from(`"${'a'.repeat(INFLATE_MAX_BYTES)}"`)));
const bombLink = Buffer.from(bomb).toString('base64url');

test('a link that would inflate past the budget is refused', async () => {
  assert.ok(bombLink.length < 64000, `the crafted link is ${bombLink.length} characters`);
  assert.equal(await decodeComparison(`#dc=${bombLink}`), null);
  // A report link has a budget of one report, and says it is too large
  // rather than damaged; it never carries a document.
  assert.deepEqual(await decodeFragment(`#dz=${bombLink}`), { tooLarge: null });
  // A small link still reads.
  const fits = `"${'a'.repeat(1000)}"`;
  assert.equal(await decodeComparison(`#dc=${deflateRawSync(Buffer.from(fits)).toString('base64url')}`), 'a'.repeat(1000));
});

// What was inflated, not how long it took: a timed version of this check
// failed whenever the host was busy, and passed a decoder that unpacked
// everything before checking. The output the inflater pulls is counted
// through a DecompressionStream whose readable is a pull-through stream.
test('the inflater stops reading near its budget, not after unpacking everything', async () => {
  const Real = globalThis.DecompressionStream;
  let pulled = 0;
  globalThis.DecompressionStream = class extends Real {
    constructor(format) {
      super(format);
      const inner = super.readable.getReader();
      this.pulling = new ReadableStream({
        async pull(controller) {
          const r = await inner.read();
          if (r.done) controller.close();
          else {
            pulled += r.value.length;
            controller.enqueue(r.value);
          }
        },
        cancel: (why) => inner.cancel(why),
      }, { highWaterMark: 0 });
    }

    get readable() { return this.pulling; }
  };
  try {
    const budget = 1 << 20;
    assert.equal(await decompressDeflateRaw(bomb, budget), null);
    // One Chromium chunk of slack (64 KB); Node's are 16 KB.
    assert.ok(pulled <= budget + 65536, `read ${pulled} bytes past a ${budget} byte budget`);
    assert.ok(pulled < bomb.length * 100, 'stopped long before the bomb was unpacked');
  } finally {
    globalThis.DecompressionStream = Real;
  }
});

// ── Blind order kept with the review (R13) ───────────────────────────────────

test('anything entered while blind stores the deal it was entered under', () => {
  for (const enter of [
    (s) => setMark(s, 'accuracy', 'k1', 'strong'),
    (s) => setPreferred(s, 'k2'),
    (s) => setNote(s, 'k3', 'Report 1 caught the trigger.'),
    (s) => setSummary(s, 'Report 1 is the one to send.'),
  ]) {
    const blind = setView(threeColumns('c-order1'), { blind: true });
    const next = enter(blind);
    assert.deepEqual(next.review.blindOrder, Object.fromEntries(reportNumbers(blind)));
  }
  // With names showing, nothing is stored.
  assert.equal(setSummary(threeColumns('c-order1'), 'Plain.').review.blindOrder, null);
});

test('after Blind is off, the review says which column each report was', () => {
  let set = setView(threeColumns('c-order2'), { blind: true });
  const numbers = reportNumbers(set);
  set = setSummary(setMark(set, 'accuracy', 'k3', 'strong'), 'Report 1 is the one to send.');
  // While blind nothing gives the order away.
  assert.equal(blindOrderSentence(set), '');
  const blindCopy = reviewMarkdown(set, displayColumns(set), (col) => nameOf(set, col));
  assert.ok(!blindCopy.includes('While blind:'), 'the blind copy decodes the numbers');
  set = setView(set, { blind: false });
  const sentence = blindOrderSentence(set);
  const first = [...numbers].find(([, n]) => n === 1)[0];
  const letter = { k1: 'A', k2: 'B', k3: 'C' }[first];
  const label = set.columns.find((c) => c.id === first).label;
  assert.ok(sentence.startsWith(`While blind: Report 1 was ${letter} (${label}), Report 2 was `), sentence);
  assert.match(sentence, /Report 3 was [A-C] \([^)]+\)\.$/);
  const md = reviewMarkdown(set, displayColumns(set), (col) => nameOf(set, col));
  assert.match(md, /While blind: Report 1 was [A-D] \(/);
  assert.ok(md.indexOf('While blind:') > md.indexOf('Marks were entered while the names were hidden'), 'the order follows the record line');
});

test('the deal survives a bundle, a link and a new id once a review exists', async () => {
  let set = setView(threeColumns('c-order3'), { blind: true });
  set = setNote(set, 'k2', 'Report 2 misses the trigger.');
  const dealt = reportNumbers(set);
  // A new id would shuffle again; the stored deal wins.
  for (const id of ['c-other1', 'c-other2', 'c-other3', 'c-other4']) {
    const back = fromBundle(JSON.parse(JSON.stringify(toBundle(set))), { id });
    assert.deepEqual(reportNumbers(back), dealt, `${id} dealt again`);
  }
  const encoded = await encodeComparison(toBundle(set));
  const linked = fromBundle(await decodeComparison(encoded.fragment), { id: 'c-linked' });
  assert.deepEqual(reportNumbers(linked), dealt);
});

test('a stored deal is checked: unknown ids or repeated numbers are dropped', () => {
  const set = threeColumns('c-order4');
  const read = (blindOrder) => sanitizeSet({ ...set, review: { ...set.review, blindOrder } }).review.blindOrder;
  assert.deepEqual(read({ k1: 2, k2: 1, k3: 3 }), { k1: 2, k2: 1, k3: 3 });
  assert.equal(read({ k1: 1, k2: 1, k3: 3 }), null, 'a repeated number');
  assert.equal(read({ k1: 1, k9: 2 }), null, 'a column this set never had');
  assert.equal(read({ k1: 0, k2: 2 }), null, 'a number outside 1 to 4');
  assert.equal(read({ k1: '1' }), null, 'a number that is text');
  assert.equal(read({ 'not-an-id': 1 }), null);
  assert.equal(read('k1'), null);
});

test('adding a column deals again, and the sentence keeps the numbers the review used', () => {
  let set = setView(threeColumns('c-order5'), { blind: true });
  set = setSummary(set, 'Report 2 reads best.');
  const used = { ...set.review.blindOrder };
  set = addColumn(set, { role: 'other', source: source('# D') }).set;
  const now = reportNumbers(set);
  assert.equal(now.size, 4, 'four columns are dealt');
  assert.deepEqual([...now.values()].sort(), [1, 2, 3, 4]);
  set = setView(set, { blind: false });
  const sentence = blindOrderSentence(set);
  for (const [colId, n] of Object.entries(used)) {
    const letter = { k1: 'A', k2: 'B', k3: 'C' }[colId];
    assert.ok(sentence.includes(`Report ${n} was ${letter} (`), `${sentence} names Report ${n} as ${letter}`);
  }
  // A column removed since is named as such, not dropped.
  const removed = removeColumn(set, 'k1');
  assert.match(blindOrderSentence(removed), new RegExp(`Report ${used.k1} was a removed column`));
});

// ── The copied review: wording, file names, an empty set, the brief ──────────

test('the copied review names each report once, with its file, and never says Reveal', () => {
  let set = newSet({ id: 'c-copy1', title: 'Copy' });
  set = addColumn(set, { role: 'human', source: { kind: 'html', name: 'human-draft.html', text: '<h1>A</h1>' } }).set;
  set = addColumn(set, { role: 'agent', author: 'Someone', source: { kind: 'markdown', name: 'Pasted text', text: '# B' } }).set;
  set = setView(setMark(setView(set, { blind: true }), 'accuracy', 'k1', 'weak'), { blind: false });
  const md = reviewMarkdown(set, displayColumns(set), (col) => nameOf(set, col));
  assert.ok(md.includes('- A: Human, from human-draft.html\n'), md);
  assert.ok(md.includes('- B: Agent (Someone)\n'), 'pasted text names no file');
  // The role is not repeated after a label that already says it. (The
  // decoding line, "Report 2 was A (Human)", names the label on purpose.)
  const reports = md.slice(md.indexOf('## Reports'), md.indexOf('## Marks'));
  assert.ok(!reports.includes('(Human)') && !md.includes('Reveal'), md);
  assert.match(md, /Marks were entered while the names were hidden \(blind review\)\./);
  const blind = setView(set, { blind: true });
  const hidden = reviewMarkdown(blind, displayColumns(blind), (col) => nameOf(blind, col));
  assert.ok(!hidden.includes('human-draft'), 'a blind copy names the file');
});

test('a review with no report in any column says so instead of an empty table', () => {
  const set = newSet({ id: 'c-empty1' });
  const md = reviewMarkdown(set, [], (col) => nameOf(set, col));
  assert.match(md, /No column holds a report yet\./);
  assert.ok(!/\| Criterion|## Marks|## Counts/.test(md), md);
});

test('the brief opens the copied review, blind or not, and is left out when empty', () => {
  let set = setPrompt(threeColumns('c-brief1'), 'Write the incident report.\n\nKeep it to one page.');
  const md = reviewMarkdown(set, displayColumns(set), (col) => nameOf(set, col));
  assert.ok(md.indexOf('## Brief') >= 0 && md.indexOf('## Brief') < md.indexOf('## Reports'), md);
  assert.match(md, /## Brief\n\n> Write the incident report\.\n>\n> Keep it to one page\./);
  set = setView(set, { blind: true });
  assert.match(reviewMarkdown(set, displayColumns(set), (col) => nameOf(set, col)), /## Brief/);
  const plain = threeColumns('c-brief2');
  assert.ok(!reviewMarkdown(plain, displayColumns(plain), (col) => nameOf(plain, col)).includes('## Brief'));
  assert.ok(!/score|total|average|rank/i.test(md.replace(/does not score/, '')), 'nothing is scored');
});

// ── A #dc= link is saved once (R45) ──────────────────────────────────────────

test('a comparison link names the same saved copy every time it is opened', async () => {
  const encoded = await encodeComparison(toBundle(threeColumns('c-linkid')));
  const id = await comparisonLinkId(encoded.fragment);
  assert.match(id, SET_ID);
  assert.match(id, /^c-l[0-9a-f]{20}$/);
  assert.equal(await comparisonLinkId(encoded.fragment), id, 'the same link, the same id');
  assert.equal(await comparisonLinkId(encoded.fragment.slice(1)), id, 'with or without the #');
  const other = await encodeComparison(toBundle(setPrompt(threeColumns('c-linkid'), 'Changed.')));
  assert.notEqual(await comparisonLinkId(other.fragment), id, 'a changed comparison is a new link');
  assert.equal(await comparisonLinkId('#dz=abc'), null);
  assert.equal(await comparisonLinkId(''), null);
});
