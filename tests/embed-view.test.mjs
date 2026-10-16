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
import { guardFrameLinks, LINK_SELECTOR, linkAddress, scrollInsideFrame } from '../js/frame-links.js';
import { comparisonRuntime } from '../js/compare/export-runtime.js';

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

// The link guard travels in both one-file exports (js/export.js beside the
// fitter, js/compare/export.js inside the comparison's one hashed script), so
// it may reach for nothing outside its own body either. The comparison export
// shipped no link handling at all, and a link in an Original column loaded
// the whole comparison into the column.
test('the link guard travels as its own source', () => {
  const source = guardFrameLinks.toString();
  assert.ok(!/<\/script/i.test(source), 'the source would close its script element');
  assert.ok(!/<!--/.test(source));
  assert.ok(!/\bimport\b/.test(source), 'the guard imports something');
  // Names this module and the app define outside the function; the app's
  // `safeHref` only arrives as an option (`o.safeHref`).
  for (const outside of [/\bshared\b/, /\bLINK_SELECTOR\b/, /\bscrollInsideFrame\b/, /(?<![.\w])safeHref\(/, /\bembedDocument\b/]) {
    assert.ok(!outside.test(source), `the guard reaches for ${outside} outside its body`);
  }
  // eslint-disable-next-line no-new-func
  const rebuilt = new Function(`return (${source});`)();
  assert.equal(typeof rebuilt, 'function');
  // Its shared pieces come from the one copy inside it.
  const pieces = rebuilt(null);
  assert.equal(pieces.selector, LINK_SELECTOR);
  assert.equal(typeof pieces.address, 'function');
  assert.equal(typeof pieces.inside, 'function');
  assert.equal(typeof linkAddress, 'function');
  assert.equal(typeof scrollInsideFrame, 'function');
  // A frame that has not loaded yet: the guard waits for its load, once.
  const listeners = [];
  const frame = {
    getAttribute: () => '<p>report</p>',
    addEventListener: (type) => listeners.push(type),
    get contentWindow() { return null; },
  };
  const handle = rebuilt(frame, { contain: true });
  assert.equal(typeof handle.follow, 'function');
  assert.deepEqual(listeners, ['load']);
  assert.equal(rebuilt(frame), handle, 'a frame was guarded twice');
  assert.deepEqual(listeners, ['load']);
  // The address a link follows: an SVG link's animated one when it has one.
  const link = (attrs, href) => ({ href, getAttribute: (n) => attrs[n] ?? null, getAttributeNS: (ns, n) => attrs[`xlink:${n}`] ?? null });
  assert.equal(linkAddress(link({ href: ' #a ' })), '#a');
  assert.equal(linkAddress(link({ 'xlink:href': 'https://x.test/' })), 'https://x.test/');
  assert.equal(linkAddress(link({ href: '#a' }, { animVal: 'https://y.test/' })), 'https://y.test/');
});

test('the comparison export\'s one script compiles with the guard beside the runtime', () => {
  const script = `(${comparisonRuntime.toString()})(document, ${guardFrameLinks.toString()});`;
  assert.ok(!/<\/script/i.test(script));
  // eslint-disable-next-line no-new-func
  assert.doesNotThrow(() => new Function('document', script));
  // An empty page: nothing to guard, and nothing thrown.
  // eslint-disable-next-line no-new-func
  const run = new Function('document', script);
  assert.doesNotThrow(() => run({ getElementById: () => null }));
});
