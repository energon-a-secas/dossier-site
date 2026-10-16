/**
 * One size cap for every way into the Reports view: 2,000,000 characters,
 * the cap HTML and the Compare view already had. Markdown, JSON, YAML and
 * text had none, so an 8 MB Markdown froze the tab for four seconds, was
 * saved and slowed every later visit, and a 63 KB `#dz=` link unpacked to a
 * 20 MB report. The browser half (the Open dialog refusing a chosen file,
 * a link over the cap) is in scripts/check-open-dialog.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import {
  HTML_MAX_CHARS, reportTooLargeMessage, reportTooLargeBytesMessage,
} from '../js/embed-policy.js';
import { decodeFragment, readUrlPayload } from '../js/share.js';

/** A `#dz=` link whose JSON is exactly `length` characters. */
function linkOf(length) {
  const shell = JSON.stringify({ dossier: { version: 1, title: 'Big', pages: [{ title: 'P', blocks: [{ type: 'prose', text: '' }] }] } });
  const json = shell.replace('"text":""', `"text":"${'a'.repeat(length - shell.length)}"`);
  assert.equal(json.length, length);
  return `#dz=${deflateRawSync(Buffer.from(json)).toString('base64url')}`;
}

/** Run `readUrlPayload` for an address, with the browser globals it reads. */
async function readAt(hash) {
  const saved = { window: globalThis.window, history: globalThis.history };
  globalThis.window = { location: { href: `https://dossier.test/${hash}`, pathname: '/', search: hash.startsWith('?') ? hash : '' } };
  globalThis.history = { replaceState() {} };
  try {
    return await readUrlPayload();
  } finally {
    globalThis.window = saved.window;
    globalThis.history = saved.history;
  }
}

test('the sentences name the limit and the file', () => {
  assert.equal(reportTooLargeMessage(2000001, 'notes.md'),
    'notes.md is 2,000,001 characters long, over the 2,000,000 character limit Dossier opens. Open the file in its own browser tab, or split it into smaller reports.');
  assert.match(reportTooLargeBytesMessage(8400000, 'big.md'), /^big\.md is 8\.4 MB, over the 2,000,000 character limit Dossier opens\./);
  assert.match(reportTooLargeMessage(5), /^This report is 5 characters long/);
});

test('a #dz= link at the cap opens, and one character over is refused as too large', async () => {
  const at = await decodeFragment(linkOf(HTML_MAX_CHARS - 1));
  assert.ok(at && at.document, 'a link just under the cap was refused');
  const over = await decodeFragment(linkOf(HTML_MAX_CHARS + 1));
  assert.deepEqual(over, { tooLarge: HTML_MAX_CHARS + 1 });
});

test('a #dz= link that unpacks past one report is refused before it is all unpacked', async () => {
  const bomb = `#dz=${deflateRawSync(Buffer.from(`"${'a'.repeat(HTML_MAX_CHARS * 4)}"`)).toString('base64url')}`;
  assert.deepEqual(await decodeFragment(bomb), { tooLarge: null });
});

test('the link reader says the report is too large, not that the link is damaged', async () => {
  const over = await readAt(linkOf(HTML_MAX_CHARS + 1));
  assert.equal(over.found, true);
  assert.equal(over.ok, false);
  assert.equal(over.reason, 'That link carries a report of 2,000,001 characters, over the 2,000,000 character limit Dossier opens. Ask for the HTML file instead.');
  const unpacked = await readAt(`#dz=${deflateRawSync(Buffer.from(`"${'a'.repeat(HTML_MAX_CHARS * 4)}"`)).toString('base64url')}`);
  assert.match(unpacked.reason, /^That link carries a report of more than 2,000,000 characters/);
  const fine = await readAt(linkOf(1000));
  assert.equal(fine.ok, true);
  assert.match(fine.text, /"title": "Big"/);
  const damaged = await readAt('#dz=not-a-payload');
  assert.match(damaged.reason, /incomplete or damaged/);
});

test('a ?src= document over the cap is refused, by its declared size or once read', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('x', { headers: { 'content-length': String(HTML_MAX_CHARS * 4 + 1) } });
    const declared = await readAt('?src=https://reports.test/big.json');
    assert.equal(declared.ok, false);
    assert.equal(declared.reason, 'The document at reports.test is 8 MB, over the 2,000,000 character limit Dossier opens. Nothing was loaded.');
    globalThis.fetch = async () => new Response('a'.repeat(HTML_MAX_CHARS + 1));
    const read = await readAt('?src=https://reports.test/big.md');
    assert.equal(read.reason, 'The document at reports.test is 2,000,001 characters long, over the 2,000,000 character limit Dossier opens. Nothing was loaded.');
    globalThis.fetch = async () => new Response('# Fine');
    const fine = await readAt('?src=https://reports.test/fine.md');
    assert.equal(fine.ok, true);
    assert.equal(fine.text, '# Fine');
  } finally {
    globalThis.fetch = realFetch;
  }
});
