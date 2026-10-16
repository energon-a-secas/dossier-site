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
  describeDetected, htmlSentence, beginOpen, openGeneration, releaseOpen,
} from '../js/open.js';
import { HTML_MAX_CHARS, htmlTooLargeMessage } from '../js/embed-policy.js';

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
