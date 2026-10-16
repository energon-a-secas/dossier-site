/**
 * Test the store without IndexedDB (which requires a browser).
 *
 * Test key shapes, metadata derivation, and byte accounting.
 * Full integration testing requires a browser.
 *
 * No framework, plain node --test.
 */

import test from 'node:test';
import assert from 'node:assert';

test('metadata structure has all required fields', () => {
  const meta = {
    id: 'doc-123',
    title: 'Test Report',
    kind: 'report',
    status: 'draft',
    pages: 2,
    blocks: 5,
    bytes: 2048,
    created: Date.now(),
    updated: Date.now(),
  };
  assert.ok(meta.id);
  assert.ok(meta.title);
  assert.ok(typeof meta.kind === 'string');
  assert.ok(typeof meta.status === 'string');
  assert.ok(typeof meta.pages === 'number');
  assert.ok(typeof meta.blocks === 'number');
  assert.ok(typeof meta.bytes === 'number');
  assert.ok(typeof meta.created === 'number');
  assert.ok(typeof meta.updated === 'number');
});

test('document shape matches contract', () => {
  const doc = {
    dossier: {
      version: '1.0.0',
      title: 'Test',
      pages: [
        {
          title: 'Page 1',
          blocks: [
            { type: 'prose', text: 'Hello' },
            { type: 'metric', title: 'Count', value: 42 },
          ],
        },
      ],
    },
  };
  assert.ok(doc.dossier);
  assert.ok(Array.isArray(doc.dossier.pages));
  assert.ok(doc.dossier.pages[0].blocks);
  assert.ok(doc.dossier.pages[0].blocks.length > 0);
});

test('byte calculation for JSON', () => {
  const doc = { dossier: { title: 'Test', pages: [] } };
  const json = JSON.stringify(doc);
  const bytes = new Blob([json]).size;
  assert.ok(bytes > 0);
  assert.ok(bytes >= json.length);
});

test('report id prefix convention', () => {
  const id = 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  assert.ok(id.startsWith('doc-'));
  assert.ok(id.length > 10);
});

test('page and block counting', () => {
  const doc = {
    dossier: {
      version: '1.0.0',
      title: 'Multi-page',
      pages: [
        {
          title: 'Page 1',
          blocks: [{ type: 'prose', text: 'A' }, { type: 'metric', value: 1 }],
        },
        {
          title: 'Page 2',
          blocks: [{ type: 'prose', text: 'B' }],
        },
      ],
    },
  };
  const pages = doc.dossier.pages.length;
  let blocks = 0;
  for (const page of doc.dossier.pages) {
    blocks += page.blocks?.length || 0;
  }
  assert.strictEqual(pages, 2);
  assert.strictEqual(blocks, 3);
});

test('metadata timestamps are milliseconds', () => {
  const created = Date.now();
  const updated = Date.now();
  assert.ok(created > 1000000000000);
  assert.ok(updated > 1000000000000);
  assert.ok(typeof created === 'number');
  assert.ok(typeof updated === 'number');
});

// ── The store itself, over an in-memory IndexedDB ──────────────────────────
//
// The tests above only check shapes. These run js/store.js against
// tests/fake-idb.mjs: the revision check a second tab relies on, and saving
// that recovers after the site's data is cleared under an open tab.

import { createFakeIndexedDB } from './fake-idb.mjs';

const fake = createFakeIndexedDB();
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: fake.indexedDB });
// No BroadcastChannel: a write's notice to other tabs is not what is tested,
// and an open channel would keep the test process alive.
Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
const store = await import('../js/store.js');

const doc = (text) => ({ dossier: { version: 1, title: 'Revisions', pages: [{ title: 'One', blocks: [{ type: 'prose', text }] }] } });
const meta = { title: 'Revisions', kind: null, status: null, pages: 1 };

test('a save made on the stored revision lands, and one made on an older revision is refused', async () => {
  const first = await store.writeReport('r-rev', doc('first'), meta);
  assert.ok(first && Number.isFinite(first.updated), 'the first save returned no revision');
  const second = await store.writeReport('r-rev', doc('second'), meta, { expect: first.updated });
  assert.ok(second && !second.conflict, 'a save on the current revision was refused');
  assert.ok(second.updated > first.updated, 'the revision did not move forward');
  // A tab still holding the first revision tries to save its stale copy.
  const stale = await store.writeReport('r-rev', doc('stale'), meta, { expect: first.updated });
  assert.equal(stale.conflict, true, 'a save made on an older revision was written');
  assert.equal(stale.current.updated, second.updated, 'the conflict does not carry the stored revision');
  const back = await store.readReport('r-rev');
  assert.equal(back.document.dossier.pages[0].blocks[0].text, 'second', 'the refused save changed the record');
  // Without an expectation (a new report, a replayed journal) it is written.
  const forced = await store.writeReport('r-rev', doc('forced'), meta);
  assert.ok(forced && !forced.conflict && forced.updated > second.updated);
});

test('two saves in the same millisecond still get later revisions', async (t) => {
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
  const a = await store.writeReport('r-ms', doc('a'), meta);
  const b = await store.writeReport('r-ms', doc('b'), meta, { expect: a.updated });
  const c = await store.writeReport('r-ms', doc('c'), meta, { expect: b.updated });
  assert.ok(a.updated < b.updated && b.updated < c.updated, `revisions ${a.updated}, ${b.updated}, ${c.updated}`);
});

test('saving recovers after the site data is cleared under an open tab', async () => {
  await store.writeReport('r-old', doc('before the clear'), meta);
  // The close event has not arrived yet: the next transaction throws.
  fake.killConnections({ fireClose: false });
  const written = await store.writeReport('r-new', doc('after the clear'), meta);
  assert.ok(written && !written.conflict, 'the first save after the clear failed');
  assert.deepEqual((await store.listReports()).map((r) => r.id), ['r-new'], 'the list does not show what is really stored');
  // And when the browser does say the connection closed.
  fake.killConnections({ fireClose: true });
  await new Promise((resolve) => setImmediate(resolve));
  const again = await store.writeReport('r-again', doc('after the second clear'), meta);
  assert.ok(again && !again.conflict, 'a save after the close event failed');
  assert.equal((await store.readReport('r-again')).document.dossier.pages[0].blocks[0].text, 'after the second clear');
});

test('a write that aborts resolves null and changes nothing', async () => {
  const before = await store.writeReport('r-abort', doc('kept'), meta);
  fake.abortNextWrite();
  assert.equal(await store.writeReport('r-abort', doc('lost'), meta, { expect: before.updated }), null);
  assert.equal((await store.readReport('r-abort')).document.dossier.pages[0].blocks[0].text, 'kept');
});
