import test from 'node:test';
import assert from 'node:assert/strict';
import { compareHtml } from '../js/render/compare.js';
import { blockHtml } from '../js/render/index.js';
import { parse } from '../js/parse.js';
import { validate } from '../js/validate.js';

test('comparison context is escaped and a print view exposes both responses', () => {
  const block = { type: 'compare', kind: 'text', mode: 'toggle', prompt: '<script>bad()</script>', left: { label: 'A', caption: '<img src=x>', value: 'One two' }, right: { label: 'B', value: 'Three' } };
  const html = compareHtml(block, { print: true });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('2 words'));
  assert.ok(!html.includes(' hidden'));
  assert.ok(!html.includes('<button'));
});

test('paired bars compare series independently and preserve zero and missing values', () => {
  const html = blockHtml({ type: 'chart', form: 'bar', categories: ['Time', 'Failures'], unit: 'count', series: [{ label: 'A', values: [10, 0] }, { label: 'B', values: [5] }] });
  assert.ok(html.includes('width:100%'));
  assert.ok(html.includes('width:50%'));
  assert.ok(html.includes('width:0%'));
  assert.ok(html.includes('>0</span>'));
  assert.ok(html.includes('Not recorded'));
  assert.ok(!html.includes('NaN'));
});

test('paired bars scale negative measurements around a common zero', () => {
  const html = blockHtml({ type: 'chart', form: 'bar', categories: ['Change'], unit: 'count', series: [{ label: 'A', values: [-10] }, { label: 'B', values: [10] }] });
  assert.ok(html.includes('--zero:50%'));
  assert.ok(html.includes('left:0%;width:50%'));
  assert.ok(html.includes('left:50%;width:50%'));
});

test('chart colors cannot inject attributes or additional CSS', () => {
  const html = blockHtml({ type: 'chart', form: 'bar', categories: ['One'], unit: 'count', series: [{ label: 'A', color: 'red;position:fixed" onmouseover="bad()', values: [1] }] });
  assert.ok(!html.includes('onmouseover'));
  assert.ok(!html.includes('position:fixed'));
});

test('tables retain zero, false, column alignment and number formatting', () => {
  const html = blockHtml({ type: 'table', columns: [{ label: 'Count', format: 'number', align: 'right' }, { label: 'Flag' }, { label: 'Ratio', format: 'percent' }], rows: [[0, false, 0], [1420, true, 12]] });
  assert.ok(html.includes('<td align="right">0</td>'));
  assert.ok(html.includes('>false</td>'));
  assert.ok(html.includes('>1,420</td>'));
  assert.ok(html.includes('>0%</td>'));
});

test('headings have one anchor and collapsed blocks keep their content available', () => {
  const { model } = parse(JSON.stringify({ dossier: { version: 1, title: 'Example', pages: [{ title: 'Page', blocks: [{ type: 'heading', text: 'Section' }] }] } }));
  const html = blockHtml(model.dossier.pages[0].blocks[0]);
  assert.equal((html.match(/ id=/g) || []).length, 1);
  const folded = blockHtml({ type: 'prose', title: 'Details', text: 'Still available', collapsed: true });
  assert.ok(folded.startsWith('<details'));
  assert.ok(folded.includes('<summary>Details</summary>'));
  assert.ok(folded.includes('Still available'));
});

test('timeline details survive rendering', () => {
  const html = blockHtml({ type: 'timeline', items: [{ at: 'Week 1', label: 'Measure', detail: 'Capture the baseline.' }] });
  assert.ok(html.includes('Capture the baseline.'));
});
