/**
 * The way from the Reports view into Compare (js/compare/bridge.js) rests on
 * two pure functions in js/compare/sources.js: a saved report as a column
 * source, and a new comparison that starts from it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { toDossier } from '../js/adapters/html.js';
import { sourceFromReport, comparisonFromReport } from '../js/compare/sources.js';
import { filledColumns, MAX_SOURCE_CHARS, sourceFits } from '../js/compare/model.js';

const HTML = '<!doctype html><html><head><title>Alioth roadmap</title></head><body><h1>Alioth</h1><h2>Plan</h2><p>Ship it.</p></body></html>';

/** The HTML adapter's own output, titled as a browser (with DOMParser) titles it. */
function imported(html, title) {
  const { document } = toDossier(html);
  document.dossier.title = title;
  return document;
}

test('an imported HTML report goes into a column as the HTML it was', () => {
  const document = imported(HTML, 'Alioth roadmap');
  const read = sourceFromReport(document);
  assert.equal(read.ok, true);
  assert.equal(read.source.kind, 'html');
  assert.equal(read.source.text, HTML, 'the exact original markup');
  assert.equal(read.source.name, 'Alioth roadmap');
  assert.equal(read.title, 'Alioth roadmap');
  assert.ok(sourceFits(read.source));
});

test('any other report goes in as its Dossier document', () => {
  const document = {
    dossier: {
      version: 1,
      title: 'Weekly',
      pages: [{ title: 'One', blocks: [{ type: 'prose', text: 'a' }, { type: 'prose', text: 'b' }] }],
    },
  };
  const read = sourceFromReport(document);
  assert.equal(read.source.kind, 'dossier');
  assert.deepEqual(JSON.parse(read.source.text), document);
  // An embed that points somewhere instead of holding its markup is not HTML to show.
  const linked = sourceFromReport({ dossier: { version: 1, title: 'Linked', pages: [{ title: 'P', blocks: [{ type: 'embed', src: 'report.html' }] }] } });
  assert.equal(linked.source.kind, 'dossier');
});

test('a report too large for a column, or one that cannot be read, says why', () => {
  const big = sourceFromReport({ dossier: { version: 1, title: 'Huge', pages: [{ title: 'P', blocks: [{ type: 'embed', html: `<p>${'x'.repeat(MAX_SOURCE_CHARS)}</p>` }] }] } });
  assert.equal(big.ok, false);
  assert.match(big.message, /2,000,000/);
  assert.match(big.message, /^"Huge" is [\d,]+ characters long/);
  for (const bad of [null, {}, { dossier: {} }, { dossier: { pages: 'x' } }]) {
    const read = sourceFromReport(bad);
    assert.equal(read.ok, false);
    assert.equal(read.message, 'That report could not be read.');
  }
});

test('a comparison started from a report holds it in A and leaves B empty', () => {
  const document = imported(HTML, 'A title long enough to be cut where a column label stops');
  const result = comparisonFromReport(document);
  assert.equal(result.ok, true);
  const { set } = result;
  assert.equal(set.title, 'A title long enough to be cut where a column label stops');
  assert.equal(set.columns.length, 2);
  const [a, b] = set.columns;
  assert.equal(a.role, 'other', 'nothing here knows who wrote it');
  assert.equal(a.label, 'A title long enough to be cut where a co'.slice(0, 40));
  assert.equal(a.label.length, 40);
  assert.equal(a.source.kind, 'html');
  assert.equal(b.role, 'other');
  assert.equal(b.source, null);
  assert.equal(result.emptyId, b.id);
  assert.equal(filledColumns(set).length, 1);
  assert.equal(comparisonFromReport(null).ok, false);
});
