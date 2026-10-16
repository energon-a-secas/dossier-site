/**
 * The card a block that cannot be drawn leaves in its place. Its text comes
 * from the document (an unknown type, a parse message), so it is escaped, and
 * escaped exactly once: the type name used to be escaped by the caller and
 * again by the card, so an unknown type `<b>` read `&lt;b&gt;` on screen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { blockHtml } from '../js/render/index.js';

/** What the browser would show for a fragment of escaped HTML. */
const shown = (html) => html
  .replace(/<[^>]*>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

test('an unknown type is named as written, escaped once', () => {
  const html = blockHtml({ type: '<b>' });
  assert.match(html, /class="block-error"/);
  assert.ok(html.includes('Unknown type: &lt;b&gt;'), html);
  assert.ok(!html.includes('&amp;lt;'), `escaped twice: ${html}`);
  assert.ok(!html.includes('<b>'), `not escaped: ${html}`);
  assert.equal(shown(html), 'Unknown type: <b>');
});

test('an ampersand in an unknown type shows as one ampersand', () => {
  const html = blockHtml({ type: 'a & b' });
  assert.equal(shown(html), 'Unknown type: a & b');
});

test('a parse message on a malformed block is escaped once', () => {
  const html = blockHtml({ type: 'prose', __error: 'Expected "text" & got <null>' });
  assert.ok(html.includes('Malformed: Expected &quot;text&quot; &amp; got &lt;null&gt;'), html);
  assert.equal(shown(html), 'Malformed: Expected "text" & got <null>');
});

test('the hint for a near miss still reads as text', () => {
  const html = blockHtml({ type: 'prosee' });
  assert.match(html, /<p class="error-hint">Did you mean: [^<]*prose[^<]*\?<\/p>/);
});
