/**
 * The Open dialog's sentence about pasted HTML, and open tickets.
 *
 * The sentence said "Opens in its original layout, with inline controls
 * enabled." for every HTML file, after imports became static by default. It
 * now says what opening does: a static copy in its own layout with its
 * scripts off, and, over the size cap, the refusal before Open is pressed.
 *
 * A failed open used to keep its ticket, so the open it had superseded (the
 * stored report boot was loading) gave up and nothing drew the stage.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeDetected, htmlSentence, beginOpen, openGeneration, releaseOpen, plainFatal, readText,
} from '../js/open.js';
import { HTML_MAX_CHARS, htmlTooLargeMessage, reportTooLargeMessage } from '../js/embed-policy.js';
import { NOT_TEXT_MESSAGE } from '../js/text-check.js';

const say = (text) => {
  const els = { importDetected: { textContent: 'unset' } };
  describeDetected(els, text);
  return els.importDetected.textContent;
};

test('HTML without scripts opens as a static copy in its own layout', () => {
  const text = say('<!doctype html><title>R</title><h1>Report</h1><p>onboarding = done</p>');
  assert.match(text, /^HTML report\. /);
  assert.match(text, /static copy in its own layout/);
  assert.doesNotMatch(text, /inline controls|enabled|scripts off/);
});

test('HTML with scripts says they are off and can be run from the report', () => {
  for (const html of [
    '<!doctype html><h1>R</h1><script>document.title = 1</script>',
    '<div><button onclick="go()">Go</button></div>',
    '<html><body><script type="module">x()</script></body></html>',
  ]) {
    const text = say(html);
    assert.match(text, /^HTML report\. /, html);
    assert.match(text, /scripts off/, html);
    assert.match(text, /run them from the report/, html);
  }
  // A data script is not a script a reader runs.
  assert.doesNotMatch(say('<html><script type="application/ld+json">{}</script><p>x</p></html>'), /scripts off/);
});

test('HTML over the size cap is refused in the sentence itself', () => {
  const big = `<!doctype html><p>${'x'.repeat(HTML_MAX_CHARS)}</p>`;
  assert.equal(say(big), htmlTooLargeMessage(big.length));
  assert.equal(htmlSentence(big), htmlTooLargeMessage(big.length));
});

test('the other sentences are unchanged', () => {
  assert.equal(say(''), '');
  assert.equal(say('   '), '');
  assert.equal(say('{"dossier":{"version":1,"pages":[]}}'), 'Looks like a Dossier document.');
  assert.match(say('{"dossierCompare":{"version":1,"columns":[]}}'), /comparison/i);
  assert.match(say('3\t1\tsrc/a.js\n'), /^Looks like Git diff stats\./);
});

test('a failed open gives its ticket back, so the open it superseded still wins', () => {
  const boot = beginOpen();
  const failed = beginOpen();
  assert.notEqual(openGeneration(), boot, 'precondition: the second open superseded the first');
  releaseOpen(failed);
  assert.equal(openGeneration(), boot, 'the failed open kept its ticket');
});

test('a ticket is only given back while it is still the newest', () => {
  const a = beginOpen();
  const b = beginOpen();
  releaseOpen(a); // a lost to b long ago: nothing changes
  assert.equal(openGeneration(), b);
  const c = beginOpen();
  releaseOpen(b); // b is no longer the newest either
  assert.equal(openGeneration(), c);
  releaseOpen(c);
  assert.equal(openGeneration(), b, 'giving back the newest returns to the one before it');
});

/**
 * The dialog's line with the error state a browser element carries: a
 * `dataset` on the line and `aria-invalid` on the paste box.
 */
function line(text) {
  const attrs = new Map();
  const els = {
    importDetected: { textContent: 'unset', dataset: {} },
    importText: {
      setAttribute: (name, value) => attrs.set(name, value),
      removeAttribute: (name) => attrs.delete(name),
    },
  };
  describeDetected(els, text);
  return { text: els.importDetected.textContent, state: els.importDetected.dataset.state, invalid: attrs.get('aria-invalid') };
}

// Broken JSON was described as "Looks like a Dossier document.", and the
// parser's message after Open showed in the same colour as a success.
test('broken or truncated JSON is never called a Dossier document, and is marked as an error', () => {
  const truncated = line('{"dossier": {"version": 1, "title": ');
  assert.notEqual(truncated.text, 'Looks like a Dossier document.');
  assert.equal(truncated.text, 'This JSON is not complete yet, or has a syntax error.');
  assert.equal(truncated.state, 'error');
  assert.equal(truncated.invalid, 'true');
  const other = line('{"foo":1}');
  assert.match(other.text, /^This is JSON, but not a Dossier document: it needs a "dossier" key/);
  assert.equal(other.state, 'error');
});

test('a valid document clears the error state', () => {
  const els = {
    importDetected: { textContent: '', dataset: { state: 'error' } },
    importText: { attrs: { 'aria-invalid': 'true' }, setAttribute(n, v) { this.attrs[n] = v; }, removeAttribute(n) { delete this.attrs[n]; } },
  };
  describeDetected(els, '{"dossier":{"version":1,"title":"T","pages":[]}}');
  assert.equal(els.importDetected.textContent, 'Looks like a Dossier document.');
  assert.equal(els.importDetected.dataset.state, undefined);
  assert.equal(els.importText.attrs['aria-invalid'], undefined);
  assert.equal(line('{"version":1,"pages":[]}').state, undefined, 'a bare document is a Dossier document');
});

test('over the cap, or binary, the dialog refuses before detecting anything', () => {
  const big = `# Notes\n\n${'x'.repeat(HTML_MAX_CHARS)}`;
  const refused = line(big);
  assert.equal(refused.text, reportTooLargeMessage(big.length, 'That text'));
  assert.equal(refused.state, 'error');
  const binary = line(`%PDF-1.7\n\u0000\u0001\u0002 stream`);
  assert.equal(binary.text, NOT_TEXT_MESSAGE);
  assert.equal(binary.state, 'error');
});

test('a parse failure is one plain sentence, whichever engine wrote it', () => {
  assert.equal(plainFatal({ message: 'Unexpected end of JSON input' }, '{"a":'), 'The JSON ends early: check for a missing }, ] or ".');
  assert.equal(plainFatal({ message: 'JSON.parse: unexpected end of data at line 1 column 6 of the JSON data' }, '{"a":'), 'The JSON ends early: check for a missing }, ] or ".');
  assert.equal(plainFatal({ message: 'JSON Parse error: Unexpected EOF' }, '{"a":'), 'The JSON ends early: check for a missing }, ] or ".');
  // A trailing comma inside the text: a mistake at a place, not an early end.
  const comma = '{"dossier": {"version": 1, "title": "x",}}';
  const misread = readText(comma);
  assert.equal(plainFatal(misread.fatal, comma), `The JSON has a mistake at line 1, column ${misread.fatal.column}.`);
  assert.ok(misread.fatal.column > 1 && misread.fatal.column < comma.length);
  assert.match(plainFatal({ message: 'Document must have a "dossier" key or be a bare document with "pages"' }, '{"foo":1}'), /^This is JSON, but not a Dossier document/);
  // A sentence this tool wrote is kept.
  assert.equal(plainFatal({ message: 'There was nothing to read in that.' }, ''), 'There was nothing to read in that.');
  // Through the reader: a truncated paste fails with the plain sentence available.
  const read = readText('{"dossier": {"version": 1, "title": ');
  assert.equal(read.ok, false);
  assert.equal(plainFatal(read.fatal, read.text), 'The JSON ends early: check for a missing }, ] or ".');
});
