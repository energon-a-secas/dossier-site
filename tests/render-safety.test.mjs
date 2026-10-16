/**
 * Hostile documents, rendered by every renderer.
 *
 * A report arrives from a file someone was handed, a fragment in a link, or an
 * agent, and the one-file export carries no CSP. So every value a renderer
 * interpolates is attacker-controlled, and the judgment renderer shipped with
 * five of them written raw (severity, likelihood, intent, state, checkedBy),
 * one of them inside a class attribute.
 *
 * The sweep takes every registry sample, replaces every leaf (strings and
 * numbers, enums included) with a hostile value, and renders it in each
 * context the app uses. The markup is then tokenised the way a browser would
 * read its tags: no handler attribute may appear, no script or img element
 * may be created from data, and every class attribute holds only class-safe
 * characters, which is what proves the enum suffixes are whitelisted rather
 * than merely escaped.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { blockHtml } from '../js/render/index.js';
import { compareHtml } from '../js/render/compare.js';
import { BLOCKS, blockTypes, blockDef } from '../js/registry/index.js';

const HOSTILE = 'x" onmouseover="alert(1)\' onfocus=\'alert(2)<img src=x onerror=alert(3)><script>alert(4)</script>';
const CONTEXTS = [{}, { interactive: false }, { standalone: true }, { print: true }];

/** Every leaf replaced, keeping `type` so the block still routes. */
function poison(value, key = '') {
  if (key === 'type') return value;
  if (Array.isArray(value)) return value.map((v) => poison(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, poison(v, k)]));
  }
  return HOSTILE;
}

/** Tags with their attributes, read the way an HTML tokenizer reads them. */
function tags(html) {
  const out = [];
  const tagRe = /<([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
  const attrRe = /\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  for (const [, name, rest] of html.matchAll(tagRe)) {
    const attrs = {};
    for (const [, attr, raw] of rest.matchAll(attrRe)) {
      attrs[attr.toLowerCase()] = raw ? raw.replace(/^["']|["']$/g, '') : '';
    }
    out.push({ name: name.toLowerCase(), attrs });
  }
  return out;
}

function problems(html, where) {
  const found = [];
  for (const tag of tags(html)) {
    for (const [name, value] of Object.entries(tag.attrs)) {
      if (/^on/i.test(name)) found.push(`${where}: <${tag.name}> carries a handler attribute "${name}"`);
      if (name === 'class' && !/^[\w\s-]*$/.test(value)) found.push(`${where}: <${tag.name}> class="${value.slice(0, 60)}" is built from data`);
      if (name.startsWith('data-') && name !== 'data-embed-html' && /[<>"]/.test(value)) {
        found.push(`${where}: <${tag.name}> ${name} carries markup`);
      }
    }
    if (tag.name === 'script') found.push(`${where}: a script element was created from data`);
    if (tag.name === 'img' && tag.attrs.src === 'x') found.push(`${where}: an img element was created from data`);
  }
  // A quote that closed an attribute leaves the hostile handler as a bare word.
  if (/onmouseover="alert/.test(html)) found.push(`${where}: a value broke out of its attribute`);
  return found;
}

test('every renderer refuses hostile values in every field, enums included', () => {
  const found = [];
  for (const block of BLOCKS) {
    const hostile = poison(block.sample);
    for (const ctx of CONTEXTS) {
      found.push(...problems(blockHtml(hostile, ctx), `${block.id} ${JSON.stringify(ctx)}`));
    }
  }
  assert.deepEqual(found, []);
});

test('hostile envelope fields cannot reach the block wrapper', () => {
  const found = [];
  for (const type of blockTypes()) {
    const block = {
      ...blockDef(type).sample,
      tone: HOSTILE,
      width: HOSTILE,
      title: HOSTILE,
      note: HOSTILE,
      id: HOSTILE,
      collapsed: false,
      evidence: [{ label: HOSTILE, href: HOSTILE, checkedBy: HOSTILE, kind: HOSTILE, confidence: HOSTILE, excerpt: HOSTILE, hash: HOSTILE }],
    };
    found.push(...problems(blockHtml(block, {}), type));
  }
  assert.deepEqual(found, []);
});

test('the judgment enums that used to be raw are whitelisted, with a fallback', () => {
  const risks = blockHtml({ type: 'risks', items: [{ title: 't', severity: 'high" onmouseover="alert(1)', likelihood: '<img src=x onerror=alert(1)>' }] });
  assert.ok(risks.includes('risk-severity--medium'), 'an unknown severity did not fall back to medium');
  assert.ok(!risks.includes('Likelihood:'), 'an unknown likelihood was printed');

  const actions = blockHtml({ type: 'actions', items: [{ label: 'a', state: 'x" onclick="y', intent: '<b>bold</b>' }] });
  assert.ok(actions.includes('action-state--todo'));
  assert.ok(!actions.includes('Intent:'));

  const evidence = blockHtml({ type: 'evidence', items: [{ label: 'l', checkedBy: '<script>alert(1)</script>' }] });
  assert.ok(!evidence.includes('<script'), 'checkedBy reached the page as markup');

  const ok = blockHtml({ type: 'risks', items: [{ title: 't', severity: 'high', likelihood: 'likely' }] });
  assert.ok(ok.includes('risk-severity--high'));
  assert.ok(ok.includes('Likelihood: likely'));
});

test('class suffixes from every enum fall back to a known value', () => {
  const cases = [
    [{ type: 'callout', text: 't', tone: 'evil"' }, 'block-callout--neutral'],
    [{ type: 'checklist', items: [{ label: 'l', state: 'evil"' }] }, 'check-todo'],
    [{ type: 'timeline', items: [{ at: '1', label: 'a', tone: 'evil"' }, { at: '2', label: 'b' }] }, 'timeline-neutral'],
    [{ type: 'findings', items: [{ message: 'm', level: 'evil"' }] }, 'finding-level--note'],
    // Unknown, never passed: a fallback to "passed" painted an unclassified test green.
    [{ type: 'tests', items: [{ name: 'n', state: 'evil"' }] }, 'test-state--unknown'],
    [{ type: 'scorecard', criteria: [{ label: 'l', verdict: 'evil"' }] }, 'verdict--unknown'],
    [{ type: 'files', items: [{ path: 'p', state: 'evil"' }] }, '<td>modified</td>'],
  ];
  for (const [block, expected] of cases) {
    const html = blockHtml(block, {});
    assert.ok(html.includes(expected), `${block.type}: expected ${expected} in ${html.slice(0, 200)}`);
  }
});

test('numbers interpolated into the page are numbers', () => {
  const files = blockHtml({ type: 'files', items: [{ path: 'a', added: '<b>9</b>', removed: '" x="' }] });
  assert.ok(!files.includes('<b>9</b>'));
  assert.ok(files.includes('<td>0</td>'));

  const findings = blockHtml({ type: 'findings', items: [{ message: 'm', level: 'error', path: 'a.ts', line: '<i>4</i>' }] });
  assert.ok(!findings.includes('<i>4</i>'));

  const tests = blockHtml({ type: 'tests', items: [{ name: 'n', state: 'passed', duration: '<u>1</u>' }], counts: { passed: '<u>2</u>' } });
  assert.ok(!tests.includes('<u>'));
});

test('an absent line number is absent, not line 0', () => {
  // The validator reads null and '' as a missing field, so these documents
  // validate clean, and `Number(null)` used to print them as `a.js:0`.
  for (const line of [null, '', '  ', undefined]) {
    const html = blockHtml({ type: 'findings', items: [{ message: 'm', level: 'error', path: 'a.js', line, endLine: null }] });
    assert.ok(html.includes('<code>a.js</code>'), `${JSON.stringify(line)}: ${html}`);
    assert.ok(!html.includes('a.js:'), `${JSON.stringify(line)} printed a line number`);
  }
  const real = blockHtml({ type: 'findings', items: [{ message: 'm', level: 'error', path: 'a.js', line: 0 }] });
  assert.ok(real.includes('a.js:0'), 'an explicit 0 is still a line');
  assert.ok(blockHtml({ type: 'findings', items: [{ message: 'm', level: 'error', path: 'a.js', line: 4, endLine: 6 }] }).includes('a.js:4-6'));
});

test('the evidence summary reads only known checkedBy values', () => {
  for (const checkedBy of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const html = blockHtml({ type: 'prose', text: 'x', evidence: [{ label: 'run', checkedBy }] });
    assert.ok(!/function|native code/.test(html), `${checkedBy}: ${html}`);
    assert.ok(html.includes('1 source, nothing checked it'), `${checkedBy}: the summary disagrees with the row`);
  }
  const human = blockHtml({ type: 'prose', text: 'x', evidence: [{ label: 'run', checkedBy: 'human' }] });
  assert.ok(human.includes('1 source, a person checked it'));
  assert.ok(!human.includes('evidence-marker--weak'), 'a person checking it was styled as weak');
});

// The summary said "nothing checked it" for an unknown value while the weak
// style read the raw value and left the marker looking checked.
test('an unknown checkedBy is weak in the style as well as in the words', () => {
  for (const checkedBy of ['bogus', 'Code', 'constructor', 7]) {
    const html = blockHtml({ type: 'prose', text: 'x', evidence: [{ label: 'run', checkedBy }] });
    assert.ok(html.includes('1 source, nothing checked it'), `${checkedBy}: ${html}`);
    assert.ok(html.includes('evidence-marker--weak'), `${checkedBy}: said unchecked, styled as checked`);
  }
  const code = blockHtml({ type: 'prose', text: 'x', evidence: [{ label: 'run', checkedBy: 'code' }] });
  assert.ok(!code.includes('evidence-marker--weak'));
});

test('a table whose columns hold null or a string draws a table, not an error card', () => {
  const html = blockHtml({
    type: 'table',
    columns: [null, 'Plain <b>name</b>', { label: 'Size', align: 'right', format: 'bytes' }, 7],
    rows: [['a', 'b', 2048, 'd']],
  }, {});
  assert.ok(html.includes('<table class="block-table">'), html);
  assert.ok(!html.includes('block-error'), html);
  assert.ok(html.includes('Plain &lt;b&gt;name&lt;/b&gt;'), 'a string column lost its label or was not escaped');
  assert.ok(html.includes('<th scope="col" align="right">Size</th>'));
  assert.ok(html.includes('<th scope="col" align="left">7</th>'));
  assert.equal((html.match(/<td /g) || []).length, 4);
});

test('a heading level that is not 2 or 3 never reaches the tag name', () => {
  const html = blockHtml({ type: 'heading', text: 'x', level: 'script' });
  assert.ok(html.includes('<h2'), html);
  assert.ok(blockHtml({ type: 'heading', text: 'x', level: 3 }).includes('<h3'));
});

test('a chart or gauge id cannot close the SVG id attribute it is written into', () => {
  const chart = blockHtml({ type: 'chart', id: 'a" onload="alert(1)', form: 'area', series: [{ label: 's', values: [1, 2, 3] }] });
  assert.deepEqual(problems(chart, 'chart'), []);
  assert.ok(chart.includes('id="c-aonloadalert1-area-0"'), 'the gradient id was not reduced to safe characters');
  const gauge = blockHtml({ type: 'gauge', id: 'a" onload="alert(1)', value: 5 });
  assert.deepEqual(problems(gauge, 'gauge'), []);
});

test('a renderer that throws on a strange shape leaves a card, not a broken page', () => {
  const html = blockHtml({ type: 'code', source: { not: 'a string' } }, {});
  assert.ok(typeof html === 'string' && html.length > 0);
});

test('the comparison change marker is visually hidden text, not aria-label on a span', () => {
  const html = compareHtml({ type: 'compare', kind: 'code', left: { value: 'a\nb' }, right: { value: 'a\nc' } }, {});
  assert.ok(!/<span[^>]*aria-label=/.test(html), 'a generic span is named with aria-label');
  assert.ok(html.includes('<span class="visually-hidden">Added: </span>'));
  assert.ok(html.includes('<span class="visually-hidden">Removed: </span>'));
});

test('code and log comparisons count lines, prose counts words', () => {
  const code = compareHtml({ type: 'compare', kind: 'code', left: { value: 'a\nb\nc' }, right: { value: 'a' } }, {});
  assert.ok(code.includes('3 lines') && code.includes('1 line<'), code);
  assert.ok(!code.includes('words'));
  const log = compareHtml({ type: 'compare', kind: 'log', left: { value: 'x y z' }, right: { value: 'x' } }, {});
  assert.ok(log.includes('1 line'));
  const text = compareHtml({ type: 'compare', kind: 'text', left: { value: 'one two' }, right: { value: 'three' } }, {});
  assert.ok(text.includes('2 words') && text.includes('1 word<'));
});

test('a CRLF side and an LF side with the same text are identical', async () => {
  const { lineDiff } = await import('../js/render/line-diff.js');
  const result = lineDiff('one\r\ntwo\r\nthree', 'one\ntwo\nthree');
  assert.equal(result.added, 0);
  assert.equal(result.removed, 0);
  const html = compareHtml({ type: 'compare', kind: 'text', left: { value: 'a\r\nb' }, right: { value: 'a\nb' } }, {});
  assert.ok(html.includes('identical'), 'line endings alone were reported as a change');
});

test('unlabelled sides use one pair of default names everywhere', async () => {
  const { DEFAULT_SIDE_LABELS } = await import('../js/render/compare.js');
  const [left, right] = DEFAULT_SIDE_LABELS;
  const side = compareHtml({ type: 'compare', kind: 'text', left: { value: 'a' }, right: { value: 'b' } }, {});
  const wipe = compareHtml({ type: 'compare', kind: 'image', mode: 'slider', left: { src: 'https://example.invalid/a.png' }, right: { src: 'https://example.invalid/b.png' } }, {});
  for (const html of [side, wipe]) {
    assert.ok(html.includes(left) && html.includes(right), html.slice(0, 300));
  }
  const notes = [blockDef('compare').fields.left.fields.label.note, blockDef('compare').fields.right.fields.label.note];
  assert.ok(notes[0].includes(left) && notes[1].includes(right), 'the registry notes name different defaults');
});

test('the wipe and fade sliders carry a descriptive value text, kept on input', async () => {
  const wipe = compareHtml({ type: 'compare', kind: 'image', mode: 'slider', left: { src: 'https://example.invalid/a.png', label: 'Old' }, right: { src: 'https://example.invalid/b.png', label: 'New' } }, {});
  assert.ok(/aria-valuetext="50% Old on the left, 50% New on the right"/.test(wipe), wipe);
  assert.ok(wipe.includes('data-left="Old"') && wipe.includes('data-right="New"'));
  const fade = compareHtml({ type: 'compare', kind: 'image', mode: 'overlay', left: { src: 'https://example.invalid/a.png', label: 'Old' }, right: { src: 'https://example.invalid/b.png', label: 'New' } }, {});
  assert.ok(/aria-valuetext="New at 50% over Old"/.test(fade), fade);

  // The handler runs in the page and in the offline export; drive it with a
  // stand-in element so the text it writes on input is checked too.
  const { bindComparisons } = await import('../js/comparison-controls.js');
  const handlers = {};
  bindComparisons({ addEventListener: (name, fn) => { handlers[name] = fn; } });
  const attrs = {};
  const comparison = { style: { setProperty() {} } };
  const control = {
    value: '70',
    dataset: { action: 'compare-wipe', left: 'Old', right: 'New' },
    closest: (sel) => (sel.includes('compare-wipe') ? control : comparison),
    setAttribute: (name, value) => { attrs[name] = value; },
  };
  handlers.input({ target: control });
  assert.equal(attrs['aria-valuetext'], '70% Old on the left, 30% New on the right');
});

test('the catalog image sample is inline, so opening the catalog makes no request', () => {
  const sample = blockDef('image').sample;
  assert.ok(sample.src.startsWith('data:image/svg+xml'), 'the image sample points at the network');
  const html = blockHtml(sample, { interactive: false });
  assert.ok(html.includes('<img src="data:image/svg+xml'), 'the inline sample was refused by the image check');
});
