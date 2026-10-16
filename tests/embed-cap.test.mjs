/**
 * One size cap for imported HTML, and a script decision that reads the markup.
 *
 * The registry allowed 400,000 characters, embed.html dropped anything over
 * 410,000 without a word, and the import path had no limit, so a 648 KB report
 * opened with a success toast into a blank frame. These tests keep the three
 * readers on one number and keep the refusal a sentence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HTML_MAX_CHARS, htmlTooLargeMessage, embedDocument } from '../js/embed-policy.js';
import { blockDef } from '../js/registry/index.js';
import { toDossier, hasScriptsByPattern } from '../js/adapters/html.js';
import { validate } from '../js/validate.js';
import { readText } from '../js/open.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('the cap is 2,000,000 characters and the registry reads it', () => {
  assert.equal(HTML_MAX_CHARS, 2000000);
  assert.equal(blockDef('embed').fields.html.maxLen, HTML_MAX_CHARS);
});

test('embed.html repeats the same number, with room for the policy head', () => {
  const page = fs.readFileSync(path.join(root, 'embed.html'), 'utf-8');
  const match = /var MAX_CHARS = (\d+);/.exec(page);
  assert.ok(match, 'embed.html no longer declares MAX_CHARS');
  assert.equal(Number(match[1]), HTML_MAX_CHARS, 'embed.html and js/embed-policy.js disagree on the cap');
  assert.ok(embedDocument('', true).length < 1024, 'the policy head outgrew the 1024 characters embed.html allows for it');
  assert.ok(/note\.textContent\s*=/.test(page), 'an oversized payload no longer gets a sentence');
});

test('an import over the cap is refused with a sentence, not a document', () => {
  const big = `<html><body>${'x'.repeat(HTML_MAX_CHARS)}</body></html>`;
  assert.throws(() => toDossier(big), (err) => {
    assert.equal(`${err.message}.`, htmlTooLargeMessage(big.length));
    assert.match(err.message, /over the 2,000,000 character limit/);
    return true;
  });
});

// The adapter's return value is not what the reader sees. readText is: a null
// document there used to fall through to the JSON and YAML parser, so the
// reader got "Document must be a JSON object or YAML mapping" instead.
test('the Open dialog reader shows the size sentence for an oversized HTML file', () => {
  const big = `<!doctype html><html><body>${'x'.repeat(HTML_MAX_CHARS)}</body></html>`;
  const read = readText(big);
  assert.equal(read.ok, false);
  assert.equal(read.document, null);
  assert.match(read.fatal.message, /over the 2,000,000 character limit Dossier opens/);
  assert.ok(read.fatal.message.includes(htmlTooLargeMessage(big.length)), read.fatal.message);
  assert.doesNotMatch(read.fatal.message, /JSON object|YAML mapping|\.\.$/);
});

test('an import at the cap is accepted and validates', () => {
  const html = `<p>${'x'.repeat(HTML_MAX_CHARS - 7)}</p>`;
  assert.equal(html.length, HTML_MAX_CHARS);
  const result = toDossier(html);
  assert.ok(result.document);
  const errors = validate(result.document).filter((f) => f.level === 'error');
  assert.deepEqual(errors, []);
});

test('an embed over the cap gets one finding, not two', () => {
  const doc = { dossier: { version: 1, title: 't', pages: [{ title: 'p', blocks: [{ type: 'embed', html: 'x'.repeat(HTML_MAX_CHARS + 1) }] }] } };
  const long = validate(doc).filter((f) => f.path.endsWith('.html') && f.level === 'error');
  assert.equal(long.length, 1, JSON.stringify(long.map((f) => f.message)));
});

test('script detection reads tags, not words', () => {
  assert.equal(hasScriptsByPattern('<p>The onboarding = done step</p>'), false, 'prose that contains "on...=" counted as a handler');
  assert.equal(hasScriptsByPattern('<script type="application/ld+json">{}</script><p>x</p>'), false, 'structured data counted as a script');
  assert.equal(hasScriptsByPattern('<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>'), false, 'an escaped code sample counted as a script');
  assert.equal(hasScriptsByPattern('<script>go()</script>'), true);
  assert.equal(hasScriptsByPattern('<script type="module">go()</script>'), true);
  assert.equal(hasScriptsByPattern('<button onclick="go()">Go</button>'), true);
  assert.equal(toDossier('<p>The onboarding = done step</p>').document.dossier.pages[0].blocks[0].scripts, false);
});
