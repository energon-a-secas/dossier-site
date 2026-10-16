/** js/router.js: one reader for every kind of hash. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeFor, isPayload, isAnchor } from '../js/router.js';

test('page routes', () => {
  assert.deepEqual(parseRoute('#/results'), { view: 'reports', page: 'results' });
  assert.deepEqual(parseRoute('#/scores-runs'), { view: 'reports', page: 'scores-runs' });
  assert.deepEqual(parseRoute(''), { view: 'reports' });
  assert.deepEqual(parseRoute('#'), { view: 'reports' });
  assert.deepEqual(parseRoute('#/'), { view: 'reports' });
});

test('a bare anchor names a place, not a page or a view', () => {
  // The skip link pressed in the Compare view must not switch to Reports, so
  // an anchor carries no view at all and the current one stays.
  assert.deepEqual(parseRoute('#main'), { anchor: 'main' });
  assert.equal(isAnchor('#main'), true);
  assert.equal(isAnchor('#/~compare'), false);
  assert.equal(isAnchor('#/results'), false);
  assert.equal(isAnchor('#dc=abc'), false);
});

test('compare routes', () => {
  assert.deepEqual(parseRoute('#/~compare'), { view: 'compare' });
  assert.deepEqual(parseRoute('#/~compare/c-12ab'), { view: 'compare', id: 'c-12ab' });
  assert.deepEqual(parseRoute('#/%7Ecompare/c-1'), { view: 'compare', id: 'c-1' });
});

test('payloads are not routes', () => {
  assert.deepEqual(parseRoute('#dz=abc'), { payload: true, key: 'dz' });
  assert.deepEqual(parseRoute('#d1=abc'), { payload: true, key: 'd1' });
  assert.deepEqual(parseRoute('#dc=abc'), { payload: true, key: 'dc' });
  assert.deepEqual(parseRoute('#v1:dz:abc'), { payload: true, key: 'dz' });
  assert.equal(isPayload('#/results'), false);
  assert.equal(isPayload('#dz=x'), true);
});

test('a malformed escape does not throw', () => {
  assert.deepEqual(parseRoute('#/%E0%A4%A'), { view: 'reports' });
});

test('routeFor inverts parseRoute', () => {
  for (const route of [
    { view: 'reports', page: 'results' },
    { view: 'reports', page: 'a b/c' },
    { view: 'compare' },
    { view: 'compare', id: 'c-9x' },
  ]) {
    assert.deepEqual(parseRoute(routeFor(route)), route);
  }
  assert.equal(routeFor({ page: 'notes' }), '#/notes');
  assert.equal(routeFor({}), '#/');
});
