/**
 * js/compare/diff.js and js/compare/marks.js: what changed between two
 * reports, unit by unit and word by word, and the marks drawn for it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffBlocks, wordDiff, myers, tokenize, inlineTokens, tokensToInline, describeRemoved,
} from '../js/compare/diff.js';
import { columnMarks } from '../js/compare/marks.js';
import { markdownToIr } from '../js/compare/markdown-ir.js';
import { inlineText, textToIr } from '../js/compare/ir.js';
import { renderIr } from '../js/compare/ir-render.js';

const md = (text) => markdownToIr(text).blocks;
const inl = (text) => md(text)[0].inl;
/** Word segments as text: {+inserted+} and [-removed-]. */
const show = (segments) => segments.map((s) => {
  const t = inlineText(s.inl);
  return s.type === 'ins' ? `{+${t}+}` : s.type === 'del' ? `[-${t}-]` : t;
}).join('');

const REPORT = [
  '# Incident report',
  '',
  '## Summary',
  '',
  'Latency rose from 420 ms to 3.4 s and 4.1% of attempts timed out.',
  '',
  '## Root cause',
  '',
  'The release exhausted the connection pool.',
  '',
  '## Contributing factors',
  '',
  'The cache hit ratio dropped during the same window.',
  '',
  '## Impact',
  '',
  '- 1,940 attempts timed out.',
  '- No data was lost.',
].join('\n');

test('myers turns one sequence into the other', () => {
  const rand = (seed) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const next = rand(7);
  for (let round = 0; round < 200; round += 1) {
    const a = Array.from({ length: Math.floor(next() * 30) }, () => Math.floor(next() * 5));
    const b = Array.from({ length: Math.floor(next() * 30) }, () => Math.floor(next() * 5));
    const runs = myers(a, b);
    const rebuilt = [];
    let ai = 0;
    for (const run of runs) {
      if (run.t === 'eq') {
        assert.deepEqual(a.slice(ai, ai + run.n), b.slice(rebuilt.length, rebuilt.length + run.n));
        rebuilt.push(...a.slice(ai, ai + run.n));
        ai += run.n;
      } else if (run.t === 'del') ai += run.n;
      else rebuilt.push(...b.slice(run.b, run.b + run.n));
    }
    assert.equal(ai, a.length);
    assert.deepEqual(rebuilt, b);
  }
  assert.equal(myers(Array.from({ length: 50 }, (_, i) => i), Array.from({ length: 50 }, (_, i) => i + 100), { maxD: 10 }), null,
    'past the edit cap it gives up rather than run on');
});

test('tokens keep figures whole and collapse whitespace', () => {
  assert.deepEqual(tokenize('rose to 2.9 s, 6.2% and $1,940\n\t!').map((t) => t.text),
    ['rose', ' ', 'to', ' ', '2.9', ' ', 's', ',', ' ', '6.2%', ' ', 'and', ' ', '$1,940', ' ', '!']);
  const tokens = inlineTokens(inl('a **bold `code-x` move** [link](https://example.com/a) end'));
  assert.deepEqual(tokensToInline(tokens), inl('a **bold `code-x` move** [link](https://example.com/a) end'),
    'tokens rebuild the runs they came from');
});

test('identical reports have no differences', () => {
  const r = diffBlocks(md(REPORT), md(REPORT));
  assert.equal(r.counts.total, 0);
  assert.ok(r.units.every((u) => u.state === 'same'));
  assert.equal(r.tooDifferent, false);
});

test('one word changed marks that word and nothing else', () => {
  const r = diffBlocks(md(REPORT), md(REPORT.replace('exhausted', 'drained')));
  assert.deepEqual(r.counts, { changed: 1, added: 0, removed: 0, total: 1 });
  const unit = r.units.find((u) => u.state === 'changed');
  assert.equal(show(unit.words), 'The release [-exhausted-] {+drained+} the connection pool.');
});

test('a replaced phrase reads as one replacement, and a shared figure stays visible', () => {
  const words = wordDiff(
    inl('The trigger was a `cart-api` deploy that changed the cache TTL.'),
    inl('The trigger was a `cart-api` deploy that lowered the database connection pool from 50 to 12.'),
  );
  assert.equal(show(words.segments), 'The trigger was a cart-api deploy that [-changed the cache TTL-] {+lowered the database connection pool from 50 to 12+}.');
  const figures = wordDiff(inl('Approximately 1,940 checkout attempts timed out.'), inl('1,940 of 31,300 checkout attempts timed out (6.2%).'));
  assert.equal(show(figures.segments), '[-Approximately-] 1,940 {+of 31,300+} checkout attempts timed out {+(6.2%)+}.');
  // Inline code survives inside the marked unit.
  assert.ok(words.segments[0].inl.some((run) => run.code === 'cart-api'));
});

test('a section added is marked as added units', () => {
  const added = REPORT.replace('## Impact', '## Detection\n\nThe alert fired nine minutes late.\n\n## Impact');
  const r = diffBlocks(md(REPORT), md(added));
  assert.equal(r.counts.added, 2);
  assert.equal(r.counts.changed + r.counts.removed, 0);
  assert.deepEqual(r.changes.map((c) => c.kind), ['add', 'add']);
});

test('a section removed is one ghost run, named by its heading', () => {
  const removed = REPORT.replace('## Contributing factors\n\nThe cache hit ratio dropped during the same window.\n\n', '');
  const r = diffBlocks(md(REPORT), md(removed));
  assert.deepEqual(r.counts, { changed: 0, added: 0, removed: 1, total: 1 });
  const info = describeRemoved(r.baseUnits, r.removed[0].units);
  assert.equal(info.what, 'Contributing factors');
  assert.equal(info.words, 11);
  assert.match(info.preview, /^The cache hit ratio/);
});

test('a paragraph moved shows where it left and where it arrived', () => {
  const moved = REPORT.replace('The release exhausted the connection pool.\n\n', '')
    .replace('- No data was lost.', '- No data was lost.\n\nThe release exhausted the connection pool.');
  const r = diffBlocks(md(REPORT), md(moved));
  assert.equal(r.counts.removed, 1);
  assert.equal(r.counts.added, 1);
  assert.equal(r.counts.changed, 0);
});

test('CRLF and LF line endings are the same report', () => {
  const r = diffBlocks(md(REPORT), md(REPORT.replace(/\n/g, '\r\n')));
  assert.equal(r.counts.total, 0);
  const text = diffBlocks(textToIr('one line\nsecond line\n\nnext'), textToIr('one line\r\nsecond line\r\n\r\nnext'));
  assert.equal(text.counts.total, 0);
});

test('curly and straight quotes differ unless punctuation and quote style are ignored', () => {
  const a = md('The agent said "done" and it wasn\'t.');
  const b = md('The agent said “done” and it wasn’t.');
  assert.equal(diffBlocks(a, b).counts.changed, 1);
  assert.equal(diffBlocks(a, b, { ignorePunctuation: true }).counts.total, 0);
  const c = md('the Agent said done.');
  assert.equal(diffBlocks(md('The agent said done.'), c).counts.changed, 1);
  assert.equal(diffBlocks(md('The agent said done.'), c, { ignoreCase: true }).counts.total, 0);
});

test('a column that differs in most of its units is too different for word marks', () => {
  const other = md('# Something else\n\nNothing alike here at all.\n\n## Notes\n\nDifferent words entirely.\n\n## More\n\nStill nothing shared.');
  const r = diffBlocks(md(REPORT), other);
  assert.equal(r.tooDifferent, true);
});

test('a 6,000 word pair is compared in well under 300 ms', () => {
  const words = 'the release lowered the pool size and checkout retried timed out calls which tripled the requests waiting'.split(' ');
  const para = (seed) => Array.from({ length: 60 }, (_, i) => words[(i * 7 + seed) % words.length]).join(' ');
  const sections = [];
  for (let s = 0; s < 20; s += 1) {
    sections.push(`## Section ${s}`);
    for (let p = 0; p < 5; p += 1) sections.push(para(s * 5 + p));
  }
  const a = sections.join('\n\n');
  const b = sections.map((block, i) => (i % 7 === 3 ? `${block} with an added clause` : i % 11 === 5 ? para(i + 99) : block)).join('\n\n');
  const blocksA = md(a);
  const blocksB = md(b);
  const start = performance.now();
  const r = diffBlocks(blocksA, blocksB);
  const ms = performance.now() - start;
  assert.ok(ms < 300, `took ${ms.toFixed(0)} ms`);
  assert.ok(r.counts.changed > 5);
  assert.equal(diffBlocks(blocksA, blocksB), r, 'a second call with the same reports is remembered');
  assert.equal(diffBlocks(md(a), md(b)), r, 'and so is the same content in new arrays');
});

test('marks number every change and put ghost rows in the container they stand in', () => {
  const base = md('## Steps\n\n- one\n- two\n- three\n\nClosing words here.');
  const col = md('## Steps\n\n- one\n- three and more\n\nClosing words here, a < b & c.');
  const r = diffBlocks(base, col);
  const html = renderIr(col, { colId: 'k2', marks: columnMarks(r, { colId: 'k2', baseRef: 'B' }) });
  assert.match(html, /<li class="ghost" data-chg="1" data-d="del"><span class="ghost__what"><b>Removed from B:<\/b> 1 list item, 1 word<\/span>/);
  assert.match(html, /data-chg="2" data-d="chg"/);
  assert.ok(!/a < b/.test(html), 'report text is escaped inside word marks');
  assert.match(html, /a &lt; b &amp; c/);
  assert.match(html, /<ins><span class="visually-hidden">inserted: <\/span>/);
  assert.match(html, /<span class="visually-hidden u-sr">Changed list item: <\/span>/);
  const bars = renderIr(col, { colId: 'k2', marks: columnMarks(r, { colId: 'k2', baseRef: 'Report 3', bars: true }) });
  assert.ok(!/<ins>/.test(bars), 'margin bars only: no word marks');
  assert.match(bars, /u-bar-chg/);
  assert.match(bars, /Removed from Report 3:/);
});

test('a changed table row is marked cell by cell, with its label inside the first cell', () => {
  const base = md('| When | What |\n|---|---|\n| 14:02 | Deploy starts |\n| 14:13 | Alert fires |');
  const col = md('| When | What |\n|---|---|\n| 14:02 | Deploy starts |\n| 14:13 | Alert pages on-call |');
  const r = diffBlocks(base, col);
  const html = renderIr(col, { colId: 'k3', marks: columnMarks(r, { colId: 'k3', baseRef: 'B' }) });
  assert.match(html, /<tr class="unit u-changed" data-u="\d+" data-chg="1" data-d="chg"><td><span class="visually-hidden u-sr">Changed table row: <\/span>14:13<\/td>/);
  assert.match(html, /<td>Alert <del>.*fires<\/del>.*<ins>.*pages on-call<\/ins><\/td>/);
});
