/** js/compare/extract.js and js/compare/align.js: counts and heading alignment. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract, statsItems, statsSentence, sectionCount, countNumbers } from '../js/compare/extract.js';
import {
  normHeading, similarity, alignHeadings, mapPosition, sectionMatrix, MATCH,
} from '../js/compare/align.js';
import { markdownToIr } from '../js/compare/markdown-ir.js';
import { headingsOf, flattenUnits, textToIr } from '../js/compare/ir.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const h = (text, level = 2) => ({ text, level });

test('extract counts what a report contains, and says nothing about quality', () => {
  const blocks = markdownToIr([
    '# Title',
    '',
    'Latency rose from 420 ms to 2.9 s, and 6.2% timed out. See [the runbook](https://runbooks.example.com/x).',
    '',
    '## Impact',
    '',
    '- one',
    '- two',
    '  - nested',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '```',
    'code here',
    '```',
    '',
    '## Timeline',
    '',
    '![chart](data:image/png;base64,AAAA)',
  ].join('\n')).blocks;
  const stats = extract(blocks);
  assert.equal(stats.headings[1], 1);
  assert.equal(stats.headings[2], 2);
  assert.equal(stats.sections, 2, 'one title, two sections under it');
  assert.equal(stats.lists, 2);
  assert.equal(stats.listItems, 3);
  assert.equal(stats.tables, 1);
  assert.equal(stats.code, 1);
  assert.equal(stats.figures, 1);
  assert.equal(stats.links, 1);
  assert.deepEqual(stats.hosts, ['runbooks.example.com']);
  assert.ok(stats.words > 20);
  assert.equal(stats.minutes, 1);
  assert.ok(stats.numbers >= 3);
});

test('numbers are counted as a report states them', () => {
  assert.equal(countNumbers('420 ms, 2.9 s, 6.2%, $1,940 and 14:04'), 5);
  assert.equal(countNumbers('no digits here'), 0);
});

test('sections are one level under a single title, else the top level', () => {
  assert.equal(sectionCount([h('T', 1), h('A'), h('B'), h('b1', 3)]), 2);
  assert.equal(sectionCount([h('A'), h('B'), h('C')]), 3);
  assert.equal(sectionCount([h('T', 1)]), 1);
  assert.equal(sectionCount([]), 0);
});

test('the stats line shows deltas with a real minus sign, and skips zeros', () => {
  const a = { words: 486, minutes: 2, sections: 6, tables: 1, figures: 0, listItems: 0, links: 0, code: 0, numbers: 21 };
  const b = { words: 518, minutes: 2, sections: 7, tables: 0, figures: 0, listItems: 0, links: 0, code: 0, numbers: 16 };
  const items = statsItems(a, b);
  assert.deepEqual(items.map((i) => i.key), ['words', 'minutes', 'sections', 'tables', 'numbers']);
  assert.equal(items[0].delta, '−32');
  assert.equal(items.find((i) => i.key === 'tables').delta, '+1');
  assert.equal(statsItems(a)[0].delta, '');
  assert.match(statsSentence(a, b), /486 words \(−32\)/);
});

test('headings are normalised before they are compared', () => {
  assert.equal(normHeading('2.1. Root Causes!'), 'root causes');
  assert.equal(normHeading('IV) Timeline'), 'timeline');
  assert.equal(normHeading('Section 3: Impact'), 'impact');
  assert.equal(similarity('Root cause', 'Root cause'), 1);
  assert.ok(similarity('Root cause', '2. Root causes') >= 0.85);
  assert.ok(similarity('Impact', 'Customer impact') >= MATCH);
  assert.ok(similarity('Timeline', 'Timeline of events') >= MATCH);
  assert.ok(similarity('Remediation', 'What we did') < MATCH, 'meaning is not matched, only words');
  assert.equal(similarity('', 'x'), 0);
});

test('alignment keeps order and maximises the summed similarity', () => {
  const human = [h('Checkout slowdown', 1), h('Summary'), h('Customer impact'), h('Timeline of events'), h('Root causes'), h('What we did')];
  const agent = [h('Incident report', 1), h('Summary'), h('Root cause'), h('Contributing factors'), h('Impact'), h('Timeline'), h('Remediation')];
  const pairs = alignHeadings(human, agent);
  const named = pairs.map((p) => [human[p.a].text, agent[p.b].text]);
  assert.deepEqual(named, [['Summary', 'Summary'], ['Customer impact', 'Impact'], ['Timeline of events', 'Timeline']]);
  for (let i = 1; i < pairs.length; i += 1) {
    assert.ok(pairs[i].a > pairs[i - 1].a && pairs[i].b > pairs[i - 1].b, 'pairs climb in both columns');
  }
  assert.deepEqual(alignHeadings([], agent), []);
});

test('aligning a few hundred headings costs no more than their pairs', () => {
  const list = (n, shift) => Array.from({ length: n }, (_, i) => h(`Section ${i + shift} about topic ${(i + shift) % 37}`));
  const run = (n) => {
    const a = list(n, 0);
    const b = list(n, 1);
    const start = performance.now();
    const pairs = alignHeadings(a, b);
    return { ms: performance.now() - start, pairs, a, b };
  };
  // A fixed budget in milliseconds failed on a busy machine, so the time is
  // measured against the same work at a quarter of the size, run just before
  // it so the machine is as busy for both. The pairs to score grow 16 times;
  // past 40 the work is growing faster than the pairs. A busy moment during
  // the large run can only make one round look slow, so the best of up to
  // five rounds counts.
  run(25);
  let best = Infinity;
  for (let round = 0; round < 5 && best >= 40; round += 1) {
    const small = run(100);
    const large = run(400);
    if (round === 0) {
      // Each heading meets its namesake one place along, and nothing else.
      assert.equal(large.pairs.length, 399);
      assert.ok(large.pairs.every((p) => p.b === p.a - 1 && p.sim === 1 && large.a[p.a].text === large.b[p.b].text));
    }
    best = Math.min(best, large.ms / Math.max(small.ms, 0.1));
  }
  assert.ok(best < 40, `400 headings took ${best.toFixed(1)} times as long as 100, for 16 times the pairs`);
});

test('aligning headings scores each pair a fixed number of times', () => {
  // The count the timing above cannot give on a busy machine: every score
  // reads both headings' text, so the reads count the work. The alignment
  // scores each pair once and each matched pair once more on its way back;
  // the bound leaves room for twice that, while an alignment that scored
  // each pair against a whole row or column would read 120 times as much.
  let reads = 0;
  const counted = (n, shift) => Array.from({ length: n }, (_, i) => {
    const text = `Section ${i + shift} about topic ${(i + shift) % 37}`;
    return {
      level: 2,
      get text() {
        reads += 1;
        return text;
      },
    };
  });
  const n = 120;
  const pairs = alignHeadings(counted(n, 0), counted(n, 1));
  assert.equal(pairs.length, n - 1);
  assert.ok(pairs.every((p) => p.b === p.a - 1 && p.sim === 1));
  assert.ok(reads >= n * n, `${reads} reads of heading text for ${n * n} pairs: the count no longer sees the scoring`);
  assert.ok(reads <= 4 * n * n, `${reads} reads of heading text for ${n * n} pairs`);
});

test('positions map piecewise-linearly between anchors', () => {
  const anchors = [[100, 300], [200, 400]];
  assert.equal(mapPosition(0, anchors, 1000, 2000), 0);
  assert.equal(mapPosition(50, anchors, 1000, 2000), 150);
  assert.equal(mapPosition(150, anchors, 1000, 2000), 350);
  assert.equal(mapPosition(600, anchors, 1000, 2000), 400 + (400 / 800) * 1600);
  // An anchor that goes backwards in the follower is dropped, not followed.
  const y = mapPosition(150, [[100, 300], [200, 100]], 1000, 2000);
  assert.ok(Math.abs(y - (300 + (50 / 900) * 1700)) < 1e-6);
});

test('the section matrix says present, renamed or missing, and what is only elsewhere', () => {
  const base = [h('Summary'), h('Root cause'), h('Contributing factors'), h('Impact')];
  const matrix = sectionMatrix(base, {
    k1: [h('Summary'), h('Root causes'), h('Customer impact'), h('What went well')],
    k3: [h('Summary'), h('Root cause'), h('Impact')],
  });
  const states = matrix.rows.map((r) => [r.text, r.cells.k1.state, r.cells.k3.state]);
  assert.deepEqual(states, [
    ['Summary', 'present', 'present'],
    ['Root cause', 'present', 'present'],
    ['Contributing factors', 'missing', 'missing'],
    ['Impact', 'renamed', 'present'],
  ]);
  assert.deepEqual(matrix.extra.k1.map((x) => x.text), ['What went well']);
  assert.deepEqual(matrix.extra.k3, []);
});

test('the bundled example aligns the way its sections were written', () => {
  const md = fs.readFileSync(path.join(root, 'reports/compare/agent-output.md'), 'utf8');
  const agent = headingsOf(markdownToIr(md).blocks);
  assert.deepEqual(agent.map((x) => x.text), [
    'Incident report: checkout latency degradation', 'Summary', 'Root cause', 'Contributing factors',
    'Impact', 'Timeline', 'Remediation', 'Action items',
  ]);
});

test('units flatten in render order, and plain text keeps its paragraphs', () => {
  const blocks = markdownToIr('# T\n\nPara\n\n- a\n  - b\n- c\n\n| x |\n|---|\n| 1 |\n\n> quoted').blocks;
  assert.deepEqual(flattenUnits(blocks).map((u) => u.kind), ['h', 'p', 'li', 'li', 'li', 'tr', 'tr', 'p']);
  assert.deepEqual(textToIr('one\ntwo\n\n\nthree').map((b) => b.inl.length), [3, 1]);
  assert.deepEqual(textToIr('   \n  '), []);
});
