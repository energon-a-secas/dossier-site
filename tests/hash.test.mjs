/**
 * The one string hash (js/hash.js). Four modules each wrote their own copy of
 * FNV-1a, and two of their outputs are kept: the Reports reader's embed
 * fingerprint is stored as `h:<fp>`, and the Blind shuffle's seed decides
 * which report a saved review called "Report 1". So the standard vectors are
 * pinned, and so is the deal Blind gave before the copies were merged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fnv1a } from '../js/hash.js';
import { reportNumbers } from '../js/compare/blind.js';

test('fnv1a gives the standard 32-bit FNV-1a vectors, unsigned', () => {
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.equal(fnv1a('foobar'), 0xbf9cf968);
  assert.ok(fnv1a('Dossier é中') >= 0, 'a hash came back negative');
});

test('Blind deals the same report numbers it dealt before the hash was shared', () => {
  // Captured from the committed blind.js (its own seedOf, before it was
  // replaced by fnv1a), so a saved Blind review keeps its numbering.
  const cases = [
    { id: 'c-blindpin', cols: ['k1', 'k2', 'k3', 'k4'], deal: [['k1', 1], ['k4', 2], ['k2', 3], ['k3', 4]] },
    { id: 'c-other', cols: ['k1', 'k2', 'k3'], deal: [['k1', 1], ['k3', 2], ['k2', 3]] },
    { id: 'c-x9', cols: ['k2', 'k5'], deal: [['k2', 1], ['k5', 2]] },
  ];
  for (const { id, cols, deal } of cases) {
    const set = { id, columns: cols.map((col) => ({ id: col })), review: {} };
    assert.deepEqual([...reportNumbers(set)], deal, `the Blind deal for ${id} changed`);
  }
});
