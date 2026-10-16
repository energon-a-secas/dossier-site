/**
 * The HTML import adapter.
 *
 * `<base>` is removed before the source is parsed: even in a DOMParser
 * document this page's policy (`base-uri`) refuses it and logged a CSP
 * violation on every import. The stored source keeps it.
 *
 * The subtitle was "Imported HTML · original layout", which was wrong as soon
 * as the reader switched the report to Dossier format. It is neutral now.
 *
 * Node has no DOMParser, so a recording stand-in shows what was parsed.
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { toDossier, htmlHasScripts } from '../js/adapters/html.js';

const parsedTexts = [];
function installParser({ title = null } = {}) {
  globalThis.DOMParser = class {
    parseFromString(text) {
      parsedTexts.push(text);
      return {
        querySelector: (sel) => (sel === 'title' && title ? { textContent: title } : null),
        querySelectorAll: () => [],
      };
    }
  };
}
afterEach(() => { delete globalThis.DOMParser; parsedTexts.length = 0; });

const SOURCE = '<!doctype html><html><head><base href="https://evil.example/"><BASE target=_top><title>Q3</title></head><body><h1>Q3</h1></body></html>';

test('a <base> never reaches the parser, in any case or with any attributes', () => {
  installParser({ title: 'Q3' });
  const { document } = toDossier(SOURCE);
  assert.equal(parsedTexts.length, 1);
  assert.doesNotMatch(parsedTexts[0], /<base\b/i, 'the parser was given a <base>');
  // The source itself is the author's and is stored as written.
  assert.equal(document.dossier.pages[0].blocks[0].html, SOURCE);
});

test('the script check parses without <base> too', () => {
  installParser();
  htmlHasScripts(SOURCE);
  assert.doesNotMatch(parsedTexts[0], /<base\b/i);
});

test('the subtitle names neither view', () => {
  installParser({ title: 'Quarterly review' });
  const { dossier } = toDossier('<!doctype html><title>Quarterly review</title><p>x</p>').document;
  assert.equal(dossier.title, 'Quarterly review');
  assert.equal(dossier.subtitle, 'Imported HTML report');
  assert.doesNotMatch(JSON.stringify(dossier), /original layout/);
});

test('an untitled report is not called "Imported HTML report" twice', () => {
  installParser();
  const { dossier } = toDossier('<div><p>no title here</p></div>').document;
  assert.equal(dossier.title, 'Imported HTML report');
  assert.equal(dossier.subtitle, undefined);
  // Node, with no parser at all, takes the same path.
  delete globalThis.DOMParser;
  const bare = toDossier('<div><p>no title</p></div>').document.dossier;
  assert.equal(bare.title, 'Imported HTML report');
  assert.equal(bare.subtitle, undefined);
});
