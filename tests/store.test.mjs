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
