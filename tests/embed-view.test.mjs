/**
 * The imported HTML report's views (js/render/embed.js), the ids its outline
 * links to (js/render/outline.js), and the fitting script the one-file export
 * carries (js/embed-fit.js). The frames themselves need a browser:
 * scripts/check-html-import.mjs drives them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { embedViewOf, embedFrameTitle, renderEmbed } from '../js/render/embed.js';
import { embedHeadingPrefix } from '../js/render/outline.js';
import { fitEmbedFrames } from '../js/embed-fit.js';

test('a view is Original unless the reader chose another the source can have', () => {
  assert.equal(embedViewOf({ scripts: true }, 'format'), 'format');
  assert.equal(embedViewOf({ scripts: true }, 'interactive'), 'interactive');
  assert.equal(embedViewOf({ scripts: false }, 'interactive'), 'original', 'a report without scripts was run');
  assert.equal(embedViewOf({}, 'interactive'), 'original');
  for (const odd of [undefined, null, '', 'ORIGINAL', 'scripts', {}, 1]) assert.equal(embedViewOf({ scripts: true }, odd), 'original');
});

test('heading ids are the block id behind the render prefix, in id-safe characters', () => {
  assert.equal(embedHeadingPrefix({ id: 'block-p0b0' }), 'block-p0b0');
  assert.equal(embedHeadingPrefix({ id: 'block-p0b0' }, 'cmp-k1'), 'cmp-k1-block-p0b0');
  assert.equal(embedHeadingPrefix({ id: 'a"><img src=x>' }), 'aimgsrcx');
  assert.equal(embedHeadingPrefix({}), 'embed');
  assert.equal(embedHeadingPrefix({ id: '"<>' }), 'embed');
});

test('the live shell names its headings with the same prefix the outline uses', () => {
  const block = { type: 'embed', id: 'imp', html: '<h1>A</h1>' };
  const html = renderEmbed(block, { interactive: true, idPrefix: 'cmp-k2' });
  assert.match(html, new RegExp(`data-embed-prefix="${embedHeadingPrefix(block, 'cmp-k2')}"`));
});

test('a frame is named for its report and how it is shown', () => {
  assert.equal(embedFrameTitle('Roadmap', 'original'), 'Roadmap, original layout');
  assert.equal(embedFrameTitle('Roadmap', 'interactive'), 'Roadmap, running its scripts');
  assert.equal(embedFrameTitle('', 'original'), 'HTML report, original layout');
});

test('the fitting script travels as its own source', () => {
  const source = fitEmbedFrames.toString();
  // It runs inside a <script> element of the exported file.
  assert.ok(!/<\/script/i.test(source), 'the source would close its script element');
  assert.ok(!/<!--/.test(source));
  // Rebuilt from text alone, it still compiles and runs on an empty page.
  // eslint-disable-next-line no-new-func
  const rebuilt = new Function(`return (${source});`)();
  assert.equal(typeof rebuilt, 'function');
  assert.doesNotThrow(() => rebuilt({ querySelectorAll: () => [] }, { links: true }));
});
