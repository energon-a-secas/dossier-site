/**
 * js/compare/naming.js: a comparison is named after its first report until
 * the reader names it, and each report's own title is read from what it is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { reportTitle, autoTitle, followTitle } from '../js/compare/naming.js';
import {
  blankSet, updateColumn, setTitle, DEFAULT_TITLE,
} from '../js/compare/model.js';

const html = (text, name = 'r.html') => ({ kind: 'html', name, text });
const md = (text, name = 'r.md') => ({ kind: 'markdown', name, text });
const file = (rel) => fs.readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

test('an HTML report is named by the <title> in its head, else its first h1', () => {
  assert.equal(reportTitle(html('<html><head><title> Q3  report </title></head><body><h1>Other</h1></body></html>')), 'Q3 report');
  // An SVG's <title> in the body is a drawing's name, not the report's.
  assert.equal(reportTitle(html('<html><head></head><body><svg><title>Bar chart</title></svg><h1>The <em>real</em> one &amp; more</h1></body></html>')), 'The real one & more');
  assert.equal(reportTitle(html('<h1>Caf&#233; &#x2192;&nbsp;notes &bogus;</h1>')), 'Caf\u00e9 \u2192 notes &bogus;');
  assert.equal(reportTitle(html('<h1>&#xD800;bad</h1>')), '&#xD800;bad', 'a lone surrogate stays as written');
  assert.equal(reportTitle(html('<p>No heading at all</p>', 'notes-2026.html')), 'notes-2026', 'else the file name');
});

test('a Markdown report is named by its front matter, else its first level 1 heading', () => {
  assert.equal(reportTitle(md('---\ntitle: "From the front"\nauthor: x\n---\n# Heading\n')), 'From the front');
  assert.equal(reportTitle(md('Intro\n\n## Not this\n\n# The **real** [title](https://x.test) `v2`\n')), 'The real title v2');
  assert.equal(reportTitle(md('# Closed heading ##\n')), 'Closed heading');
});

test('a Dossier document by its title, text by its file name, pasted text by nothing', () => {
  assert.equal(reportTitle({ kind: 'dossier', name: 'x.json', text: JSON.stringify({ dossier: { title: 'Weekly' } }) }), 'Weekly');
  assert.equal(reportTitle({ kind: 'dossier', name: 'broken.json', text: '{' }), 'broken');
  assert.equal(reportTitle({ kind: 'text', name: 'run-log.txt', text: 'hello' }), 'run-log');
  assert.equal(reportTitle({ kind: 'text', name: 'Pasted text', text: 'hello' }), '');
  assert.equal(reportTitle(null), '');
  assert.equal(reportTitle(html(`<title>${'x'.repeat(300)}</title>`)).length, 120, 'cut to the title limit');
});

test('the bundled example and fixtures are named as their authors named them', async () => {
  assert.equal(reportTitle(html(await file('reports/compare/human-draft.html'), 'human-draft.html')), 'Checkout slowdown, 8 October (illustrative example)');
  assert.equal(reportTitle(md(await file('reports/compare/agent-output.md'), 'agent-output.md')), 'Incident report: checkout latency degradation');
  const complete = await file('fixtures/complete.json');
  assert.equal(reportTitle({ kind: 'dossier', name: 'complete.json', text: complete }), JSON.parse(complete).dossier.title);
});

test('the set follows its first filled column until the reader names it', () => {
  let set = blankSet({ id: 'c-name' });
  assert.equal(set.title, DEFAULT_TITLE);
  const put = (s, colId, source) => followTitle(s, updateColumn(s, colId, { source }));
  set = put(set, 'k2', md('# From B'));
  assert.equal(set.title, 'From B', 'the only report names it');
  set = put(set, 'k1', md('# From A'));
  assert.equal(set.title, 'From A', 'A is now the first filled column');
  set = put(set, 'k1', md('# A again'));
  assert.equal(set.title, 'A again', 'replacing A renames it');
  assert.equal(autoTitle(set), 'A again');
  set = setTitle(set, 'My review');
  set = put(set, 'k1', md('# Something else'));
  assert.equal(set.title, 'My review', 'a title the reader typed stays');
  let pasted = blankSet({ id: 'c-paste' });
  pasted = put(pasted, 'k1', { kind: 'text', name: 'Pasted text', text: 'no title here' });
  assert.equal(pasted.title, DEFAULT_TITLE, 'nothing to name it after');
});
