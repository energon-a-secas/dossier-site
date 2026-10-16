/**
 * js/compare/markdown-ir.js and js/compare/ir-render.js: Markdown becomes
 * the IR, and the IR becomes escaped markup and nothing else. Also the
 * report renderer's `idPrefix`, which keeps two Dossier columns' ids apart.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToIr, inlineRuns } from '../js/compare/markdown-ir.js';
import { renderIr } from '../js/compare/ir-render.js';
import { flattenUnits } from '../js/compare/ir.js';
import { blockHtml } from '../js/render/index.js';
import { blockDef } from '../js/registry/index.js';

test('Markdown blocks: headings, lists, code, tables, quotes and rules', () => {
  const { blocks, title } = markdownToIr([
    '---',
    'title: front matter is skipped',
    '---',
    'Report title',
    '============',
    '',
    'Intro with **bold**, *italic*, `code` and a [link](https://example.com/a).',
    '',
    '## Section',
    '',
    '1. first',
    '2. second',
    '   - nested',
    '',
    '```js',
    'const x = "<b>";',
    '```',
    '',
    '| Name | Value |',
    '|:-----|------:|',
    '| a \\| b | 1 |',
    '',
    '> A quote',
    '> on two lines',
    '',
    '***',
  ].join('\n'));
  assert.equal(title, 'Report title');
  assert.deepEqual(blocks.map((b) => b.t), ['h', 'p', 'h', 'list', 'pre', 'table', 'quote', 'hr']);
  assert.equal(blocks[0].level, 1);
  assert.deepEqual(blocks[1].inl.map((r) => Object.keys(r)[0]), ['text', 'b', 'text', 'i', 'text', 'code', 'text', 'a', 'text']);
  assert.equal(blocks[1].inl[7].href, 'https://example.com/a');
  assert.equal(blocks[3].ordered, true);
  assert.equal(blocks[3].items[1].sub.items[0].inl[0].text, 'nested');
  assert.equal(blocks[4].lang, 'js');
  assert.equal(blocks[4].text, 'const x = "<b>";');
  assert.equal(blocks[5].rows[0][0].inl[0].text, 'a | b');
  assert.equal(blocks[6].blocks[0].t, 'p');
});

test('Markdown links: unsafe schemes lose the link, in-page links find their heading', () => {
  const { blocks } = markdownToIr('# Root cause\n\n[bad](javascript:alert(1)) [data](data:text/html,x) [here](#root-cause) <https://ok.example> www and https://bare.example/x.');
  const runs = blocks[1].inl.filter((r) => r.a);
  assert.equal(runs[0].href, undefined);
  assert.equal(runs[1].href, undefined);
  assert.equal(runs[2].local, 1);
  assert.equal(runs[3].href, 'https://ok.example');
  assert.equal(runs[4].href, 'https://bare.example/x');
});

test('Markdown images: data images draw, remote ones are described', () => {
  const { blocks } = markdownToIr('![chart](data:image/png;base64,AAAA)\n\n![remote](https://cdn.example.com/x.png)\n\n![file](shots/a.png)');
  assert.deepEqual(blocks.map((b) => b.t), ['fig', 'fig', 'fig']);
  assert.match(blocks[0].src, /^data:image\/png/);
  assert.equal(blocks[1].src, undefined);
  assert.match(blocks[1].note, /cdn\.example\.com not loaded/);
  assert.match(blocks[2].note, /a\.png is not part of the file/);
});

test('raw HTML inside Markdown is text, never markup', () => {
  const runs = inlineRuns('<img src=x onerror=alert(1)>Hello<script>bad()</script>');
  const html = renderIr([{ t: 'p', inl: runs }]);
  assert.ok(!/<img|<script|onerror=/i.test(html));
  assert.match(html, /Hello/);
});

test('script and style in Markdown go with their contents, in blocks and in running text', () => {
  const md = [
    '# Title',
    '',
    'Before <script>alert("inline")</script> after, <style>p { color: red }</style>done.',
    '',
    '<script>',
    'const secret = "block script";',
    '',
    'more()',
    '</script>',
    '',
    '<STYLE type="text/css">',
    'body { display: none }',
    '</style> Tail text.',
    '',
    '> <script>quoted()</script> Quoted words.',
    '',
    '- item <style>.x{}</style>kept',
    '',
    '```html',
    '<script>kept in code</script>',
    '```',
    '',
    'Inline `<style>shown</style>` stays.',
    '',
    '<script>unclosed()',
    'to the end',
  ].join('\n');
  const { blocks } = markdownToIr(md);
  const text = renderIr(blocks).replace(/<[^>]+>/g, ' ');
  for (const gone of ['alert', 'inline', 'color: red', 'secret', 'block script', 'more()', 'display: none', 'quoted()', '.x{}', 'unclosed()', 'to the end']) {
    assert.ok(!text.includes(gone), `"${gone}" is still read as text`);
  }
  assert.match(text, /Before\s+after, done\./);
  assert.match(text, /Tail text\./);
  assert.match(text, /Quoted words\./);
  assert.match(text, /item\s+kept/);
  assert.ok(blocks.some((b) => b.t === 'pre' && b.text.includes('<script>kept in code</script>')), 'a fenced script is code, and stays');
  const inline = blocks.find((b) => b.t === 'p' && b.inl.some((run) => run.code !== undefined));
  assert.ok(inline && inline.inl.some((run) => /shown/.test(run.code)), 'a code span is not taken for a style element');
});

test('every string is escaped and only safe links and data images survive', () => {
  const hostile = '"><img src=x onerror=alert(1)>';
  const blocks = [
    { t: 'h', level: 1, inl: [{ text: hostile }] },
    { t: 'p', inl: [{ a: [{ text: 'js' }], href: 'javascript:alert(1)' }, { a: [{ text: 'ok' }], href: 'https://example.com/?a="b"' }, { code: '<b>' }] },
    { t: 'list', ordered: false, items: [{ inl: [{ b: [{ text: '<i>' }] }] }] },
    { t: 'table', caption: [{ text: hostile }], head: [[{ inl: [{ text: '<th>' }], colspan: 2 }]], rows: [[{ inl: [{ text: '&' }] }, { inl: [] }]] },
    { t: 'pre', text: '</pre><script>alert(1)</script>', lang: '"x' },
    { t: 'fig', src: 'https://evil.example/x.png', alt: hostile },
    { t: 'fig', src: 'data:text/html,<script>alert(1)</script>', alt: 'x' },
    { t: 'fig', src: 'data:image/png;base64,AAAA', alt: 'ok', caption: '<b>c</b>' },
    { t: 'details', summary: [{ text: '<summary>' }], blocks: [{ t: 'p', inl: [{ text: 'inside' }] }] },
  ];
  const html = renderIr(blocks, { colId: 'k1"><x' });
  // Every `<` from the report is escaped, so each tag left is one the
  // renderer wrote. None of them may be a script, a handler or a stray image.
  // Attribute values are dropped first: escaped words inside one are text.
  const tags = (html.match(/<[^>]+>/g) || []).map((tag) => tag.replace(/"[^"]*"/g, '""'));
  assert.ok(!tags.some((tag) => /^<script\b|\son[a-z]+=/i.test(tag)), tags.join(' '));
  for (const escaped of ['&lt;th&gt;', '&lt;i&gt;', '&lt;b&gt;c', '&lt;/pre&gt;&lt;script&gt;', '&amp;']) {
    assert.ok(html.includes(escaped), `${escaped} is shown as text`);
  }
  assert.equal(tags.filter((tag) => /^<img\b/.test(tag)).length, 1);
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('evil.example'), 'a remote image is never put in an img');
  assert.ok(!html.includes('data:text/html'));
  assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="ok"/);
  assert.match(html, /href="https:\/\/example\.com\/\?a=&quot;b&quot;" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /<h3 id="k1x-h1" class="r-h r-h1"/, 'ids are cleaned and headings move down two levels');
  assert.match(html, /colspan="2"/);
});

test('in-page links point at the column own heading ids', () => {
  const html = renderIr([
    { t: 'h', level: 2, inl: [{ text: 'A' }] },
    { t: 'h', level: 2, inl: [{ text: 'B' }] },
    { t: 'p', inl: [{ a: [{ text: 'to B' }], local: 2 }] },
  ], { colId: 'k3' });
  assert.match(html, /id="k3-h2"/);
  assert.match(html, /<a href="#k3-h2" data-local="2">to B<\/a>/);
});

test('units are numbered in flatten order, and marks can decorate them', () => {
  const blocks = markdownToIr('# T\n\nPara\n\n- a\n  - b\n\n| x |\n|---|\n| 1 |\n\n> q').blocks;
  const units = flattenUnits(blocks);
  const seen = [];
  const html = renderIr(blocks, {
    colId: 'k1',
    marks: (unit, index) => {
      seen.push([unit.kind, index]);
      return index === 1 ? { cls: 'u-changed', prefix: '<span class="sr">Changed: </span>', before: '<div class="ghost"></div>' } : null;
    },
  });
  assert.deepEqual(seen.map(([kind]) => kind), units.map((u) => u.kind));
  assert.deepEqual(seen.map(([, i]) => i), units.map((_, i) => i));
  assert.match(html, /<div class="ghost"><\/div><p class="u-changed" data-u="1"><span class="sr">Changed: <\/span>Para<\/p>/);
  assert.equal((html.match(/data-u="/g) || []).length, units.length);
});

test('idPrefix keeps block, chart and gauge ids apart, and changes nothing without it', () => {
  for (const type of ['chart', 'gauge', 'prose']) {
    const sample = { ...structuredClone(blockDef(type).sample), id: 'latency' };
    const plain = blockHtml(sample, {});
    assert.equal(blockHtml(sample, {}), plain, `${type}: rendering is stable`);
    assert.equal(blockHtml(sample, { idPrefix: undefined }), plain, `${type}: no prefix, no change`);
    const prefixed = blockHtml(sample, { idPrefix: 'cmp-k2' });
    assert.match(prefixed, /id="cmp-k2-latency"/, `${type}: the block wrapper id is prefixed`);
    assert.ok(!/id="latency"/.test(prefixed), `${type}: no unprefixed wrapper id is left`);
    if (type !== 'prose') {
      const ids = [...plain.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((id) => id !== 'latency');
      for (const id of ids) assert.ok(!prefixed.includes(` id="${id}"`), `${type}: def id ${id} is prefixed under a prefix`);
    }
  }
});

test('a table region is named by its caption, its header cells, the heading above it, or its place', () => {
  const label = (blocks, opts = {}) => [...renderIr(blocks, { colId: 'k1', ...opts }).matchAll(/<div class="r-table"[^>]*aria-label="([^"]*)"/g)].map((m) => m[1]);
  const cell = (text) => ({ inl: [{ text }] });
  const table = (head, extra = {}) => ({ t: 'table', head: head ? [head.map(cell)] : [], rows: [[cell('1')]], ...extra });
  assert.deepEqual(label([table(['x'], { caption: [{ text: 'Q3' }] })]), ['Table: Q3']);
  assert.deepEqual(label([table(['UTC', 'Event'])]), ['Table: UTC, Event']);
  assert.deepEqual(label([table(['A', 'B', 'C', 'D', 'E'])]), ['Table: A, B, C and 2 more columns']);
  assert.deepEqual(label([table(['A', 'B', 'C', 'D'])]), ['Table: A, B, C and 1 more column']);
  assert.deepEqual(label([{ t: 'h', level: 2, inl: [{ text: 'Timeline' }] }, table(null)]), ['Table under Timeline']);
  assert.deepEqual(label([table(null), table(null)]), ['Table 1', 'Table 2']);
  const hostile = label([table(['<b>"x', 'y'])]);
  assert.deepEqual(hostile, ['Table: &lt;b&gt;&quot;x, y']);
  // A mark's hidden words never get into the name.
  const marked = label(markdownToIr('| UTC | Event |\n|---|---|\n| 1 | 2 |').blocks, {
    marks: (unit) => (unit.kind === 'tr' ? { prefix: '<span class="sr">Added table row: </span>' } : null),
  });
  assert.deepEqual(marked, ['Table: UTC, Event']);
  const html = renderIr([table(['UTC', 'Event'])], { colId: 'k1' });
  assert.match(html, /<div class="r-table" tabindex="0" role="region" aria-label="Table: UTC, Event">/, 'without a script the wrapper keeps the region pattern');
});
