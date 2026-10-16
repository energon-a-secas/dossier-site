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

test('alignment of a few hundred headings is quick', () => {
  const a = Array.from({ length: 400 }, (_, i) => h(`Section ${i} about topic ${i % 37}`));
  const b = Array.from({ length: 400 }, (_, i) => h(`Section ${i + 1} about topic ${(i + 1) % 37}`));
  const start = performance.now();
  alignHeadings(a, b);
  assert.ok(performance.now() - start < 2000);
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
