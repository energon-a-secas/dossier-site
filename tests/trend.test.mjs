/**
 * Trend charts (chart forms `line` and `area`, js/render/trend.js): a fixed
 * height with 13 px text, values on the points while they fit, gaps for
 * missing values, a reference line, and x labels thinned on a narrow sheet.
 * The browser half (sizes, overlaps, alignment) is scripts/check-reports.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockHtml } from '../js/render/index.js';

const responses = JSON.parse(readFileSync(new URL('../reports/responses.json', import.meta.url), 'utf8'));
const example = (responses.dossier || responses).pages[1].blocks.filter((b) => b.type === 'chart')[1];
const count = (html, re) => (html.match(re) || []).length;
const valueLabels = (html) => [...html.matchAll(/<span class="trend-value ([^"]*)" style="left:([\d.]+)%;top:([\d.]+)%">([^<]*)<\/span>/g)]
  .map(([, cls, left, top, text]) => ({ cls, left: Number(left), top: Number(top), text }));
const tops = (html, cls) => [...html.matchAll(new RegExp(`class="${cls}" style="top:(-?[\\d.]+)%`, 'g'))].map((m) => Number(m[1]));

test('the example trend labels every point, the higher value above and the lower below', () => {
  assert.equal(example.form, 'line', 'the second chart of the example is no longer the trend');
  const html = blockHtml(example, {});
  const labels = valueLabels(html);
  assert.equal(labels.length, 10, 'expected a label on each of 5 points in 2 series');
  const first = labels.filter((l) => l.left === 3);
  assert.deepEqual(first.map((l) => [l.text, l.cls.includes('above') ? 'above' : 'below']), [['2.6', 'above'], ['1.8', 'below']]);
  assert.equal(labels.filter((l) => l.cls.includes('trend-value--last')).length, 2, 'the last point lost its always-shown labels');
  assert.ok(!html.includes('viz-tick'), 'the kit\'s scaled ticks are still drawn');
  assert.ok(html.includes('preserveAspectRatio="none"'), 'the lines are not stretched to a fixed-height box');
  assert.match(html, /class="chart-x-labels trend-x"/);
  assert.ok(!/class="trend-x"[^>]*aria-hidden/.test(html), 'the x labels were hidden from the Compare reader');
});

test('three series, or many points, label each line\'s end instead, pulled apart', () => {
  const three = blockHtml({ type: 'chart', form: 'line', series: [
    { label: 'a', values: [10, 20, 30] }, { label: 'b', values: [10, 20, 31] }, { label: 'c', values: [10, 20, 32] },
  ] }, {});
  assert.equal(count(three, /class="trend-value /g), 0);
  const ends = tops(three, 'trend-end');
  assert.equal(ends.length, 3, 'expected one end label per series');
  for (let i = 1; i < ends.length; i += 1) assert.ok(ends[i] - ends[i - 1] >= 9 - 1e-6, `end labels ${ends.join(', ')} overlap`);
  const nine = blockHtml({ type: 'chart', form: 'line', series: [{ values: [1, 2, 3, 4, 5, 6, 7, 8, 9] }] }, {});
  assert.equal(count(nine, /class="trend-value /g), 0, 'nine points were each labelled');
  assert.equal(count(nine, /class="trend-end"/g), 1);
});

test('a missing value is a gap in the line, not a false zero', () => {
  const html = blockHtml({ type: 'chart', form: 'line', series: [{ label: 's', values: [4, 5, null, 6, 7] }] }, {});
  const d = /<path class="viz-line" d="([^"]+)"/.exec(html)[1];
  assert.equal(count(d, /M/g), 2, `the line did not lift its pen at the gap: ${d}`);
  assert.equal(count(html, /class="trend-dot"/g), 4, 'a missing value drew a dot');
  assert.ok(html.includes('Not recorded'), 'the data table no longer says the value is missing');
});

test('a reference draws a dashed line with its label, inside the domain', () => {
  const html = blockHtml({ type: 'chart', form: 'line', reference: { value: 400, label: 'SLO' }, series: [{ values: [120, 180, 150] }] }, {});
  assert.match(html, /class="trend-ref" style="top:([\d.]+)%"><span>SLO 400<\/span>/);
  const top = Number(/class="trend-ref" style="top:([\d.]+)%"/.exec(html)[1]);
  assert.ok(top >= 0 && top <= 100, `the reference sits outside the plot at ${top}%`);
});

test('a max below the data still keeps every point inside the plot', () => {
  const html = blockHtml({ type: 'chart', form: 'line', max: 10, series: [{ values: [5, 25, 40] }] }, {});
  const dots = [...html.matchAll(/class="trend-dot" style="left:[\d.]+%;top:(-?[\d.]+)%/g)].map((m) => Number(m[1]));
  assert.equal(dots.length, 3);
  for (const top of dots) assert.ok(top >= 0 && top <= 100, `a point sits at ${top}%`);
});

test('an area chart keeps its gradient id scheme', () => {
  const html = blockHtml({ type: 'chart', id: 'load', form: 'area', series: [{ values: [1, 2, 3] }, { values: [2, 1, 2] }] }, {});
  assert.ok(html.includes('id="c-load-area-0"') && html.includes('id="c-load-area-1"'), 'the area gradients lost their ids');
  assert.ok(html.includes('fill="url(#c-load-area-0)"'), 'the area does not use its gradient');
});

test('twelve x labels mark the ones a narrow sheet drops, never the last', () => {
  const categories = Array.from({ length: 12 }, (_, i) => `W${i + 1}`);
  const html = blockHtml({ type: 'chart', form: 'line', categories, series: [{ values: categories.map((_, i) => i) }] }, {});
  const xs = [...html.matchAll(/<span class="(trend-x__label[^"]*)" style="left:[\d.]+%">(W\d+)<\/span>/g)].map((m) => [m[2], m[1].includes('trend-x__minor')]);
  assert.equal(xs.length, 12);
  assert.deepEqual(xs.at(-1), ['W12', false], 'the last label was thinned out');
  assert.deepEqual(xs.at(-2), ['W11', true], 'the label before the last is kept, and would collide with it');
  assert.deepEqual(xs[0], ['W1', false]);
});
