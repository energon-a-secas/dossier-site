/**
 * js/compare/diff.js and js/compare/marks.js: what changed between two
 * reports, unit by unit and word by word, and the marks drawn for it: moved
 * parts, code and many-line text line by line, a light edit against a
 * rewrite, marks that do not depend on the clock, and a table header row
 * that never holds hidden words.
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
  assert.deepEqual(r.counts, {
    changed: 1, added: 0, removed: 0, moved: 0, total: 1,
  });
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
  assert.deepEqual(r.counts, {
    changed: 0, added: 0, removed: 1, moved: 0, total: 1,
  });
  const info = describeRemoved(r.baseUnits, r.removed[0].units);
  assert.equal(info.what, 'Contributing factors');
  assert.equal(info.words, 11);
  assert.match(info.preview, /^The cache hit ratio/);
});

test('a paragraph moved is one move, named by where it came from', () => {
  const moved = REPORT.replace('The release exhausted the connection pool.\n\n', '')
    .replace('- No data was lost.', '- No data was lost.\n\nThe release exhausted the connection pool.');
  const r = diffBlocks(md(REPORT), md(moved));
  assert.deepEqual(r.counts, {
    changed: 0, added: 0, removed: 0, moved: 1, total: 1,
  });
  assert.deepEqual(r.changes.map((c) => c.kind), ['mov']);
  assert.equal(r.moves[0].after, 'Root cause');
  assert.equal(r.moves[0].section, false);
});

const SECTION = '## Contributing factors\n\nThe cache hit ratio dropped during the same window.\n\n';

test('a section moved and reworded is a move, word-marked against where it came from', () => {
  const moved = `${REPORT.replace(SECTION, '')}\n\n## Contributing factors\n\nThe CDN cache hit ratio dropped during the same window.`;
  const r = diffBlocks(md(REPORT), md(moved));
  assert.deepEqual(r.counts, {
    changed: 1, added: 0, removed: 0, moved: 1, total: 2,
  });
  assert.deepEqual(r.changes.map((c) => c.kind), ['mov', 'chg']);
  assert.equal(r.moves[0].section, true);
  assert.equal(r.moves[0].after, 'Root cause');
  assert.equal(r.tooDifferent, false);
  assert.equal(show(r.units.find((u) => u.state === 'changed').words), 'The {+CDN+} cache hit ratio dropped during the same window.');
});

test('two sections swapped are one move; a short paragraph or a paragraph turned table row is not', () => {
  const swapped = REPORT.replace(`## Root cause\n\nThe release exhausted the connection pool.\n\n${SECTION}`, `${SECTION}## Root cause\n\nThe release exhausted the connection pool.\n\n`);
  const r = diffBlocks(md(REPORT), md(swapped));
  assert.equal(r.counts.moved, 1);
  assert.equal(r.counts.added, 0);
  assert.equal(r.counts.removed, 0);
  assert.equal(r.tooDifferent, false);
  const done = diffBlocks(md('Intro words here today.\n\nDone.\n\nMiddle words in this paragraph.\n\nEnd words.'),
    md('Intro words here today.\n\nMiddle words in this paragraph.\n\nEnd words.\n\nDone.'));
  assert.deepEqual([done.counts.added, done.counts.removed, done.counts.moved], [1, 1, 0], 'one word is too little to call a move');
  const rows = diffBlocks(md('Alpha one two three four five six seven eight nine.\n\nBeta one two three four five six seven eight nine.\n\nFiller text.'),
    md('Filler text.\n\n| Alpha one two three four five six seven eight nine |\n|---|\n| Beta one two three four five six seven eight nine |'));
  assert.equal(rows.counts.moved, 0, 'paragraphs that became table rows do not line up');
});

test('a move is marked with where it came from, escaped, and with bars only its hidden words', () => {
  const base = [{ t: 'h', level: 1, inl: [{ text: 'Report' }] }, { t: 'h', level: 2, inl: [{ text: '<i>Root cause' }] },
    { t: 'p', inl: [{ text: 'The release exhausted the connection pool.' }] },
    ...md(`${SECTION}## Impact\n\nNo data was lost at any point.`)];
  const col = [base[0], base[1], base[2], ...md('## Impact\n\nNo data was lost at any point.\n\n## Contributing factors\n\nThe cache hit ratio dropped during the same window.')];
  const r = diffBlocks(base, col);
  assert.equal(r.counts.moved, 1);
  const html = renderIr(col, { colId: 'k2', marks: columnMarks(r, { colId: 'k2', baseRef: 'B' }) });
  assert.match(html, /class="r-h r-h2 unit u-moved u-move-start" data-u="\d+" data-chg="1" data-d="mov">/);
  assert.match(html, /<span class="u-label u-label--moved">Moved from after \u201c&lt;i&gt;Root cause\u201d in <span data-base-ref>B<\/span><\/span>/);
  assert.ok(!html.includes('<i>Root'), 'the heading is escaped');
  assert.match(html, /<p class="unit u-moved" data-u="\d+">The cache/, 'the rest of the move is marked as moved, unnumbered');
  const bars = renderIr(col, { colId: 'k2', marks: columnMarks(r, { colId: 'k2', baseRef: 'B', bars: true }) });
  assert.match(bars, /unit u-bar-mov u-move-start/);
  assert.ok(!/u-label/.test(bars), 'margin bars only: no visible label');
  assert.match(bars, /<span class="visually-hidden u-sr">Moved heading: <\/span><span class="visually-hidden">moved from after/);
});

// ── A light edit, not a rewrite ──────────────────────────────────────────────

const NOTE = [
  'The deploy went out on Tuesday and the checkout error rate settled within an hour.',
  'Cache hit ratio held at 71% through the window, so the cache was not the cause.',
  'The slow queries all came from shard 7, which had the oldest index build.',
  'We will rebuild that index this week and watch the dashboard after.',
];

test('three words fixed in a four-paragraph note are marked word by word, not called too different', () => {
  const fixed = NOTE.map((p) => p.replace('Tuesday', 'Monday').replace('71%', '61%').replace('shard 7', 'shard 9'));
  const r = diffBlocks(md(NOTE.join('\n\n')), md(fixed.join('\n\n')));
  assert.equal(r.tooDifferent, false);
  assert.equal(r.counts.changed, 3);
  for (const unit of r.units.filter((u) => u.state === 'changed')) {
    assert.deepEqual(unit.words.filter((s) => s.type !== 'eq').map((s) => s.type), ['del', 'ins']);
  }
});

test('one word fixed in most paragraphs of a long report is a light edit; new words throughout are not', () => {
  const vocab = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega cache'.split(' ');
  const para = (seed) => `${Array.from({ length: 65 }, (_, i) => vocab[(i * 7 + seed) % vocab.length]).join(' ')}.`;
  const paras = Array.from({ length: 30 }, (_, i) => para(i));
  const light = diffBlocks(md(paras.join('\n\n')), md(paras.map((p, i) => (i < 24 ? p.replace('cache', 'cash') : p)).join('\n\n')));
  assert.equal(light.counts.changed, 24);
  assert.equal(light.tooDifferent, false, `${(light.wordShare * 100).toFixed(1)}% of the words changed`);
  const rewritten = diffBlocks(md(paras.join('\n\n')), md(paras.map((p, i) => `Entirely new sentence number ${i} about other matters.`).join('\n\n')));
  assert.equal(rewritten.tooDifferent, true);
});

// ── Marks that do not depend on the clock ────────────────────────────────────

const LONG = Array.from({ length: 1200 }, (_, i) => `w${i % 300}x${i}`);
const withLong = (words) => ['# Notes', 'One short paragraph.', 'Two short paragraphs here.', words.join(' '), 'Three.', 'Four more words.', 'Five and six.', 'Seven.'].join('\n\n');
const LONG_EDITED = LONG.map((w, i) => (i % 5 === 0 ? `z${i}` : w));

test('the marks are the same however fast the clock runs: no step reads it', () => {
  const real = Object.getOwnPropertyDescriptor(performance, 'now');
  let reads = 0;
  const start = performance.now();
  performance.now = () => {
    reads += 1;
    return start + (Date.now() - start) * 20;
  };
  let fast;
  try {
    fast = diffBlocks(md(withLong(LONG)), md(withLong(LONG_EDITED)), { ignoreCase: true, force: true });
  } finally {
    if (real) Object.defineProperty(performance, 'now', real);
    else delete performance.now;
  }
  assert.equal(reads, 0, 'the diff read the clock');
  // The same reports again, once the memo has forgotten them.
  for (let i = 0; i < 30; i += 1) diffBlocks(md(`Filler ${i} one.`), md(`Filler ${i} two.`), { ignoreCase: true, force: true });
  const again = diffBlocks(md(withLong(LONG)), md(withLong(LONG_EDITED)), { ignoreCase: true, force: true });
  assert.notEqual(again, fast, 'computed again');
  assert.equal(JSON.stringify(again.units), JSON.stringify(fast.units));
  assert.deepEqual(again.counts, fast.counts);
});

test('a paragraph with too many edits says so, and Word marks by hand mark it', () => {
  const r = diffBlocks(md(withLong(LONG)), md(withLong(LONG_EDITED)));
  const slot = r.units.find((u) => u.state === 'changed');
  assert.equal(slot.unmarked, 'cap');
  assert.equal(slot.words, null);
  assert.equal(r.unmarked, 1);
  assert.equal(r.tooDifferent, false);
  const html = renderIr(md(withLong(LONG_EDITED)), { colId: 'k2', marks: columnMarks(r, { colId: 'k2', baseRef: 'A' }) });
  assert.match(html, /<span class="u-label u-label--changed">Changed: too many edits to mark word by word<\/span><span class="visually-hidden u-sr">, paragraph: <\/span>/);
  const forced = diffBlocks(md(withLong(LONG)), md(withLong(LONG_EDITED)), { force: true });
  const marked = forced.units.find((u) => u.state === 'changed');
  assert.equal(forced.unmarked, 0);
  assert.ok(marked.words.some((s) => s.type === 'ins') && marked.words.some((s) => s.type === 'del'));
});

test('a code block is marked line by line, keeping its indentation', () => {
  const code = Array.from({ length: 20 }, (_, i) => `  line ${i} = value(${i})`).join('\n');
  const edited = code.replace('line 7 = value(7)', 'line 7 = value(70)');
  const r = diffBlocks(md(`# C\n\n\`\`\`\n${code}\n\`\`\``), md(`# C\n\n\`\`\`\n${edited}\n\`\`\``));
  const slot = r.units.find((u) => u.state === 'changed');
  assert.equal(slot.unmarked, null);
  assert.deepEqual(slot.words.map((s) => [s.type, inlineText(s.inl)]).filter(([type]) => type !== 'eq'),
    [['del', '  line 7 = value(7)\n'], ['ins', '  line 7 = value(70)\n']]);
  assert.equal(slot.words.map((s) => (s.type === 'del' ? '' : inlineText(s.inl))).join(''), edited, 'the column reads as written');
  const html = renderIr(md(`# C\n\n\`\`\`\n${edited}\n\`\`\``), { colId: 'k2', marks: columnMarks(r, { colId: 'k2', baseRef: 'A' }) });
  assert.match(html, /<pre class="unit u-changed"[^>]*><span class="visually-hidden u-sr">Changed code block: <\/span><code>/);
});

test('a log of 600 lines with every third edited is marked line by line, then word by word', () => {
  const lines = Array.from({ length: 600 }, (_, i) => `log entry ${i} status ok code ${i % 13}`);
  const edited = lines.map((l, i) => (i % 3 === 0 ? l.replace('ok', 'fail') : l));
  const r = diffBlocks(textToIr(lines.join('\n')), textToIr(edited.join('\n')));
  const slot = r.units[0];
  assert.equal(slot.state, 'changed');
  assert.ok(slot.words, 'the paragraph has marks');
  assert.equal(slot.words.filter((s) => s.type === 'ins').length, 200);
  assert.ok(slot.words.filter((s) => s.type === 'ins').every((s) => inlineText(s.inl) === 'fail'));
  assert.equal(r.unmarked, 0);
});

// ── A table header row never holds hidden words ──────────────────────────────

test('a header row that is new: its label and the ghost before it stand before the table', () => {
  const base = md('# T\n\nIntro words.\n\n## Old section\n\nSome old words here.\n\n## End\n\nBye now.');
  const col = md('# T\n\nIntro words.\n\n| UTC | Event |\n|---|---|\n| 14:02 | Deploy starts |\n\n## End\n\nBye now.');
  const r = diffBlocks(base, col);
  const html = renderIr(col, { colId: 'k1', marks: columnMarks(r, { colId: 'k1', baseRef: 'B' }) });
  assert.ok(!/<th[^>]*>[^]*?visually-hidden[^]*?<\/th>/.test(html.match(/<thead>[^]*?<\/thead>/)[0]), 'no hidden words in a header cell');
  assert.ok(!/<thead><tr class="ghost-row"/.test(html));
  const table = html.indexOf('<div class="r-table"');
  assert.ok(html.indexOf('<div class="ghost"') >= 0 && html.indexOf('<div class="ghost"') < table, 'the ghost stands before the table');
  assert.ok(html.indexOf('Added table header row: ') >= 0 && html.indexOf('Added table header row: ') < table, 'and so does the label');
  assert.match(html, /<thead><tr class="unit u-added" data-u="\d+" data-chg="\d+" data-d="add"><th scope="col">UTC<\/th>/);
});

test('a removed section before an unchanged table is a ghost before the table', () => {
  const r = diffBlocks(md('# T\n\n## Gone\n\nGone words here.\n\n| A | B |\n|---|---|\n| 1 | 2 |'), md('# T\n\n| A | B |\n|---|---|\n| 1 | 2 |'));
  const html = renderIr(md('# T\n\n| A | B |\n|---|---|\n| 1 | 2 |'), { colId: 'k1', marks: columnMarks(r, { colId: 'k1', baseRef: 'B' }) });
  assert.match(html, /<div class="ghost" data-chg="1" data-d="del">[^]*<\/div><div class="r-table"/);
  assert.match(html, /<thead><tr data-u="\d+"><th scope="col">A<\/th>/);
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

test('a column that shares nothing with the base is too different for word marks', () => {
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
  // The base's name is a span of its own, renamed in place when Blind or a
  // move renames the base (js/compare/analysis.js `relabel`).
  assert.match(html, /<li class="ghost" data-chg="1" data-d="del"><span class="ghost__what"><b>Removed from <span data-base-ref>B<\/span>:<\/b> 1 list item, 1 word<\/span>/);
  assert.match(html, /data-chg="2" data-d="chg"/);
  assert.ok(!/a < b/.test(html), 'report text is escaped inside word marks');
  assert.match(html, /a &lt; b &amp; c/);
  assert.match(html, /<ins><span class="visually-hidden">inserted: <\/span>/);
  assert.match(html, /<span class="visually-hidden u-sr">Changed list item: <\/span>/);
  const bars = renderIr(col, { colId: 'k2', marks: columnMarks(r, { colId: 'k2', baseRef: 'Report 3', bars: true }) });
  assert.ok(!/<ins>/.test(bars), 'margin bars only: no word marks');
  assert.match(bars, /u-bar-chg/);
  assert.match(bars, /Removed from <span data-base-ref>Report 3<\/span>:/);
  const hostile = renderIr(col, { colId: 'k2', marks: columnMarks(r, { colId: 'k2', baseRef: '<b>x</b>' }) });
  assert.match(hostile, /<span data-base-ref>&lt;b&gt;x&lt;\/b&gt;<\/span>/, 'the base name is escaped');
});

test('a changed table row is marked cell by cell, with its label inside the first cell', () => {
  const base = md('| When | What |\n|---|---|\n| 14:02 | Deploy starts |\n| 14:13 | Alert fires |');
  const col = md('| When | What |\n|---|---|\n| 14:02 | Deploy starts |\n| 14:13 | Alert pages on-call |');
  const r = diffBlocks(base, col);
  const html = renderIr(col, { colId: 'k3', marks: columnMarks(r, { colId: 'k3', baseRef: 'B' }) });
  assert.match(html, /<tr class="unit u-changed" data-u="\d+" data-chg="1" data-d="chg"><td><span class="visually-hidden u-sr">Changed table row: <\/span>14:13<\/td>/);
  assert.match(html, /<td>Alert <del>.*fires<\/del>.*<ins>.*pages on-call<\/ins><\/td>/);
});
