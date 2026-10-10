/**
 * The renderer is the heart of the product and `blockHtml` is a pure string
 * function, so almost all of it is testable in Node with no browser.
 *
 * The one test that matters most is the sweep over every registry type: it is
 * the test that notices a block type whose renderer was never written, which
 * is the failure a dispatch table makes quiet.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { blockHtml, outline, outlineFlat, reportOf } from '../js/render/index.js';
import { slopeSvg } from '../js/render/compare.js';
import { BLOCKS, blockDef, blockTypes } from '../js/registry/index.js';
import { parse } from '../js/parse.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = (name) => fs.readFileSync(path.join(root, 'fixtures', name), 'utf-8');

// Values that mean the renderer reached for something that was not there and
// printed the absence instead of handling it.
const LEAKS = ['undefined', 'NaN', '[object Object]', 'null,', 'Infinity'];

test('every registry block type renders a non-empty string from its sample', () => {
  const missing = [];
  for (const type of blockTypes()) {
    const def = blockDef(type);
    const html = blockHtml(def.sample, {});
    if (typeof html !== 'string' || html.trim().length === 0) missing.push(type);
  }
  assert.deepStrictEqual(missing, [], `types that rendered nothing: ${missing.join(', ')}`);
});

test('no sample render leaks a placeholder value into the output', () => {
  const dirty = [];
  for (const type of blockTypes()) {
    const html = blockHtml(blockDef(type).sample, {});
    for (const leak of LEAKS) {
      if (html.includes(leak)) dirty.push(`${type} leaked ${leak}`);
    }
  }
  assert.deepStrictEqual(dirty, [], dirty.join('; '));
});

test('an unknown block type renders an error card naming the type', () => {
  const html = blockHtml({ type: 'sparkline-of-vibes' }, {});
  assert.ok(html.length > 0, 'rendered nothing');
  assert.ok(
    html.includes('sparkline-of-vibes'),
    'the error card does not name the type the author wrote',
  );
});

test('a block the parser marked broken renders its reason, not nothing', () => {
  const html = blockHtml(
    { type: 'metrics', __error: 'items must be a list of tiles' },
    {},
  );
  assert.ok(html.length > 0, 'rendered nothing');
  assert.ok(
    html.includes('items must be a list of tiles'),
    'the reason the parser gave is not on the page',
  );
});

test('an empty block renders a frame with a sentence in it, not an empty element', () => {
  const thin = [];
  for (const type of blockTypes()) {
    const html = blockHtml({ type }, {});
    // Strip tags: what is left has to say something to the reader.
    const words = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (words.length < 3) thin.push(type);
  }
  assert.deepStrictEqual(thin, [], `types that render an empty frame: ${thin.join(', ')}`);
});

test('markup in a title cannot escape into the page', () => {
  const html = blockHtml(
    { type: 'prose', title: '<img src=x onerror=alert(1)>', text: 'plain' },
    {},
  );
  assert.ok(!html.includes('<img src=x'), 'an img tag survived into the output');
  assert.ok(!html.includes('onerror=alert'), 'an event handler survived into the output');
});

test('a quote character in a value cannot break out of an attribute', () => {
  const html = blockHtml(
    { type: 'kv', items: [{ label: 'Branch', value: '" onmouseover="steal()' }] },
    {},
  );
  assert.ok(
    !/onmouseover\s*=\s*"steal/.test(html),
    'a value broke out of its attribute and became a handler',
  );
});

test('a javascript URL in evidence never becomes a live href', () => {
  const html = blockHtml(
    {
      type: 'prose',
      text: 'checked',
      evidence: [{ label: 'see', href: 'javascript:alert(1)' }],
    },
    {},
  );
  assert.ok(
    !/href\s*=\s*["']javascript:/i.test(html),
    'a javascript: URL was rendered as a usable link',
  );
});

test('blockHtml is pure: the same block renders identically twice', () => {
  for (const type of blockTypes()) {
    const sample = blockDef(type).sample;
    const a = blockHtml(sample, {});
    const b = blockHtml(sample, {});
    assert.strictEqual(a, b, `${type} rendered differently on a second call`);
  }
});

test('blockHtml does not mutate the block it was given', () => {
  for (const type of blockTypes()) {
    const sample = blockDef(type).sample;
    const before = JSON.stringify(sample);
    blockHtml(sample, {});
    assert.strictEqual(
      JSON.stringify(sample),
      before,
      `${type} modified the block it was asked to render`,
    );
  }
});

test('slopeSvg with a stable uid is byte identical across calls', () => {
  const pairs = [
    { label: 'p95 latency', before: 340, after: 182 },
    { label: 'error rate', before: 2.1, after: 0.3 },
  ];
  const a = slopeSvg(pairs, { uid: 'fixed' });
  const b = slopeSvg(pairs, { uid: 'fixed' });
  assert.strictEqual(typeof a, 'string');
  assert.ok(a.length > 0, 'slopeSvg rendered nothing');
  assert.strictEqual(a, b, 'two calls with one uid produced different svg');
});

test('the outline names every page of the complete fixture', () => {
  const { model } = parse(fixture('complete.json'));
  const pages = reportOf(model).pages;
  const o = outline(model);
  assert.strictEqual(o.length, pages.length);
  assert.deepStrictEqual(o.map((p) => p.title), pages.map((p) => p.title));
  assert.ok(outlineFlat(model).length >= pages.length);
});

test('the outline accepts the wrapped document and the report inside it', () => {
  const { model } = parse(fixture('complete.json'));
  assert.deepStrictEqual(outline(model), outline(reportOf(model)));
});

test('every block of the complete fixture renders', () => {
  const { model } = parse(fixture('complete.json'));
  let count = 0;
  for (const page of reportOf(model).pages) {
    for (const block of page.blocks) {
      const html = blockHtml(block, { page });
      assert.ok(
        typeof html === 'string' && html.trim(),
        `block ${block.type} on page "${page.title}" rendered nothing`,
      );
      count += 1;
    }
  }
  assert.ok(count >= BLOCKS.length, `only ${count} blocks rendered`);
});

test('a malformed block does not stop the blocks around it rendering', () => {
  const page = {
    title: 'mixed',
    blocks: [
      { type: 'prose', text: 'before' },
      { type: 'metrics', items: 'not a list' },
      { type: 'prose', text: 'after' },
    ],
  };
  const rendered = page.blocks.map((b) => blockHtml(b, { page }));
  assert.ok(rendered[0].includes('before'), 'the block before the bad one is missing');
  assert.ok(rendered[2].includes('after'), 'the block after the bad one is missing');
  assert.ok(rendered[1].trim().length > 0, 'the bad block rendered nothing at all');
});

// ── Security regressions ─────────────────────────────────────────────────────
// Every one of these failed when it was written. The input to this product is
// a document from a file someone was handed, a fragment in a link, or an
// agent, rendered into a page holding the reader's other reports. So a field
// in a document is attacker-controlled, and these are the four places that
// treated it as configuration.

test('a markdown link cannot carry a script scheme, however it is spelled', () => {
  const spellings = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    ' javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
  ];
  for (const target of spellings) {
    const html = blockHtml({ type: 'prose', text: `[click](${target})` }, {});
    assert.ok(
      !/href\s*=\s*["'](?!#|\/|\.{1,2}\/|https?:|mailto:)/i.test(html),
      `a link survived for ${JSON.stringify(target)}: ${html}`,
    );
  }
});

test('an ordinary https link in markdown still works', () => {
  const html = blockHtml(
    { type: 'prose', text: '[run 8812](https://example.invalid/runs/8812?a=1&b=2)' },
    {},
  );
  assert.ok(
    /href="https:\/\/example\.invalid\/runs\/8812/.test(html),
    `a safe link was dropped: ${html}`,
  );
});

test('an embed that asks for scripts is not also same origin', () => {
  // These two sandbox tokens together are not a sandbox. A srcdoc frame
  // inherits the parent origin, so allow-same-origin leaves it able to reach
  // parent.document and remove its own sandbox attribute.
  const html = blockHtml(
    { type: 'embed', html: '<p>hi</p>', scripts: true },
    {},
  );
  const sandbox = /sandbox="([^"]*)"/.exec(html);
  assert.ok(sandbox, `the embed frame has no sandbox attribute: ${html}`);
  const tokens = sandbox[1].split(/\s+/).filter(Boolean);
  assert.ok(tokens.includes('allow-scripts'), 'scripts were requested and not allowed');
  assert.ok(
    !tokens.includes('allow-same-origin'),
    'allow-scripts and allow-same-origin together defeat the sandbox',
  );
});

test('an embed with scripts off needs no sandbox allowances at all', () => {
  const html = blockHtml({ type: 'embed', html: '<p>hi</p>' }, {});
  const sandbox = /sandbox="([^"]*)"/.exec(html);
  assert.ok(sandbox, 'no sandbox attribute');
  assert.strictEqual(sandbox[1].trim(), '', `expected an empty sandbox, got "${sandbox[1]}"`);
});

test('an embed pointing at another site is a link, not a frame', () => {
  const html = blockHtml({ type: 'embed', src: 'https://example.invalid/report.html' }, {});
  assert.ok(!/<iframe/i.test(html), 'a third party URL was framed');
  assert.ok(html.includes('example.invalid'), 'the link to the content is missing');
});

test('an image source is checked, and an inlined data image is kept', () => {
  const bad = blockHtml(
    { type: 'image', src: 'javascript:alert(1)', alt: 'x' },
    {},
  );
  assert.ok(!/src\s*=\s*["']javascript:/i.test(bad), 'a script scheme reached an img src');

  const inline = 'data:image/png;base64,iVBORw0KGgo=';
  const ok = blockHtml({ type: 'image', src: inline, alt: 'a pixel' }, {});
  assert.ok(ok.includes(inline), 'an inlined data image was rejected, which breaks self-contained reports');
});

test('an action ticket link is checked like every other link', () => {
  const html = blockHtml(
    {
      type: 'actions',
      items: [{ label: 'do it', state: 'todo', href: 'javascript:alert(1)' }],
    },
    {},
  );
  assert.ok(!/href\s*=\s*["']javascript:/i.test(html), 'a script scheme reached an action link');
});

test('the comparison block renders its own module, not a placeholder', () => {
  const html = blockHtml(blockDef('compare').sample, {});
  assert.ok(
    !/mode\s+(side|slider|overlay|toggle)\s*<\/div>/.test(html),
    'the comparison block is still rendering the placeholder string',
  );
  assert.ok(html.includes('Before'), 'the before side is not labelled');
  assert.ok(html.includes('After'), 'the after side is not labelled');
});

// ── Dispatch coverage ────────────────────────────────────────────────────────
// The check that catches a block type added to the registry and never wired to
// a renderer. Both earlier dispatch designs failed silently here: one answered
// a new type with whichever module responded first, the other routed on the
// registry's group and sent every findings block to the work renderer.

test('every registry type has exactly one renderer', async () => {
  const { missingRenderers, rendererClashes } = await import('../js/render/dispatch.js');
  assert.deepStrictEqual(missingRenderers(), [], 'registry types with no renderer');
  assert.deepStrictEqual(rendererClashes(), [], 'types claimed by two modules');
});

test('no sample renders as the "no content" placeholder', () => {
  const placeholder = [];
  for (const type of blockTypes()) {
    const html = blockHtml(blockDef(type).sample, {});
    if (html.includes('no content provided')) placeholder.push(type);
  }
  assert.deepStrictEqual(placeholder, [], `types that rendered the placeholder: ${placeholder.join(', ')}`);
});

test('a grid renders its child blocks and refuses to nest', () => {
  const html = blockHtml(blockDef('grid').sample, {});
  assert.ok(html.includes('grid-item'), 'the grid rendered no cells');
  assert.ok(html.includes('metric-tile'), 'the grid did not render its child blocks');

  const nested = blockHtml(
    { type: 'grid', blocks: [{ type: 'grid', blocks: [] }, { type: 'prose', text: 'x' }] },
    {},
  );
  assert.ok(nested.includes('cannot hold a grid'), 'a nested grid was not refused');
  assert.ok(nested.includes('x'), 'the sibling of a nested grid was lost');
});

test('a page route is the page id, with one scheme', async () => {
  // The tabs linked to #/page-<id> while the outline linked to #/<id> and the
  // router matched the id, so no tab opened the page it named.
  const { parse } = await import('../js/parse.js');
  const { model } = parse(fixture('complete.json'));
  const ids = reportOf(model).pages.map((p) => p.id);
  assert.ok(ids.length > 1);
  for (const id of ids) {
    assert.ok(id && !id.startsWith('page-'), `page id "${id}" carries a route prefix`);
  }
});

// ── The comparison block ─────────────────────────────────────────────────────
// The block that justifies this site, so it gets its own coverage. It shipped
// once as a one line placeholder reading "Compare (code): mode side" while the
// module written for it sat unimported.

test('a side by side comparison marks the lines that differ', async () => {
  const { compareHtml } = await import('../js/render/compare.js');
  const html = compareHtml({
    type: 'compare',
    kind: 'code',
    left: { value: 'const a = 1;\nconst b = 2;\nreturn a + b;' },
    right: { value: 'const a = 1;\nconst b = 3;\nreturn a + b;' },
  }, {});

  assert.ok(html.includes('compare--side'), 'not laid out side by side');
  assert.ok(html.includes('compare__line--removed'), 'the changed line is not marked as gone');
  assert.ok(html.includes('compare__line--added'), 'the changed line is not marked as new');
  assert.ok(html.includes('1 line gone'), `no change summary: ${html.slice(-200)}`);
});

test('identical sides say so rather than implying a change', async () => {
  const { compareHtml } = await import('../js/render/compare.js');
  const same = 'const a = 1;';
  const html = compareHtml(
    { type: 'compare', kind: 'code', left: { value: same }, right: { value: same } },
    {},
  );
  assert.ok(html.includes('identical'), 'two identical sides did not say so');
});

test('the line diff gives up loudly rather than stalling', async () => {
  const { lineDiff } = await import('../js/render/compare.js');
  const big = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  const result = lineDiff(big, `${big}\nextra`);
  assert.strictEqual(result.gaveUp, true, 'it tried to diff 500 lines');
  assert.strictEqual(result.left, null);
});

test('a wipe uses a range input, so a keyboard can drive it', async () => {
  const { compareHtml } = await import('../js/render/compare.js');
  const html = compareHtml({
    type: 'compare',
    kind: 'image',
    mode: 'slider',
    left: { src: 'https://example.invalid/a.png', label: 'Before' },
    right: { src: 'https://example.invalid/b.png', label: 'After' },
  }, {});
  assert.ok(/<input[^>]*type="range"/.test(html), 'the wipe is not a range input');
  assert.ok(html.includes('data-action="compare-wipe"'), 'the wipe control has no action');
  assert.ok(html.includes('--wipe'), 'the wipe has no custom property to drive');
});

test('a wipe over something that is not an image refuses with a reason', async () => {
  const { compareHtml } = await import('../js/render/compare.js');
  const html = compareHtml({
    type: 'compare', kind: 'code', mode: 'slider',
    left: { value: 'a' }, right: { value: 'b' },
  }, {});
  assert.ok(html.includes('nothing to wipe'), `expected a reason, got: ${html.slice(0, 160)}`);
});

test('a toggle keeps both faces in the document and one pressed', async () => {
  const { compareHtml } = await import('../js/render/compare.js');
  const html = compareHtml({
    type: 'compare', kind: 'text', mode: 'toggle',
    left: { value: 'before' }, right: { value: 'after' },
  }, {});
  assert.ok(html.includes('aria-pressed="true"'), 'no side is pressed');
  assert.ok(html.includes('aria-pressed="false"'), 'both sides are pressed');
  assert.ok(html.includes('before') && html.includes('after'), 'a face is missing from the document');
});

test('slopeSvg scales to its own values, not to a hundred', async () => {
  const { slopeSvg } = await import('../js/render/compare.js');
  // These are milliseconds. The first version divided every value by 100, so
  // anything that was not a percentage drew off the end of the plot.
  const html = slopeSvg([{ label: 'p95', before: 340, after: 182, unit: 'ms' }], { uid: 'u' });
  const xs = [...html.matchAll(/<circle[^>]*cx="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.strictEqual(xs.length, 2, 'expected a before and an after point');
  const width = 520;
  for (const x of xs) {
    assert.ok(x >= 0 && x <= width, `point at ${x} is outside the 0..${width} plot`);
  }
  assert.ok(html.includes('before 340'), 'the before value is not in its tooltip');
});
