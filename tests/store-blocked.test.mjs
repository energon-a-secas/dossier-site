/**
 * A blocked IndexedDB open. After two blocked attempts the store gives up
 * (calls get an empty list, saving is off for now), but the second request
 * stays open: when the other tab lets go it succeeds, and this tab uses it.
 * The first version closed that late success, so saving stayed off until the
 * page was reloaded.
 *
 * IndexedDB and the clock are faked: the test fires each request's events.
 * Runs in its own process (node --test), so the store's module state is ours.
 */

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const requests = [];
Object.defineProperty(globalThis, 'indexedDB', {
  configurable: true,
  value: { open: () => { const req = {}; requests.push(req); return req; } },
});
mock.timers.enable({ apis: ['setTimeout'] });
const quiet = mock.method(console, 'warn', () => {});
mock.method(console, 'info', () => {});

const { listReports } = await import('../js/store.js');

/** A database whose meta store holds `items`, and that records closes. */
function fakeDatabase(items) {
  const database = {
    closed: false,
    close() { database.closed = true; },
    transaction: () => ({
      objectStore: () => ({
        getAll() {
          const req = {};
          queueMicrotask(() => { req.result = items; req.onsuccess?.(); });
          return req;
        },
      }),
    }),
  };
  return database;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a database released after the store gave up is used, not closed', async () => {
  const first = listReports();
  await flush();
  assert.equal(requests.length, 1);
  requests[0].onblocked();
  mock.timers.tick(3000);
  await flush();
  assert.equal(requests.length, 2, 'no second attempt after the first was blocked');
  requests[1].onblocked();
  mock.timers.tick(3000);
  assert.deepEqual(await first, [], 'a blocked store did not resolve empty');
  assert.ok(quiet.mock.calls.some((c) => /still blocked/.test(String(c.arguments[0]))));

  // The first request succeeding late is closed: the second one is the keeper.
  const stale = fakeDatabase([]);
  requests[0].result = stale;
  requests[0].onsuccess();
  assert.equal(stale.closed, true, 'the superseded first request was kept open');

  // The other tab lets go: the second request succeeds after the give-up.
  const released = fakeDatabase([{ id: 'a', updated: 1 }, { id: 'b', updated: 2 }]);
  requests[1].result = released;
  requests[1].onsuccess();
  assert.equal(released.closed, false, 'the late success was closed, so storage stayed off');

  const listed = await listReports();
  assert.deepEqual(listed.map((r) => r.id), ['b', 'a'], 'the store did not use the released database');
  assert.equal(requests.length, 2, 'it opened yet another request instead of using the released one');
});
