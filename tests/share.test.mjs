/**
 * Test the share codec round-trip.
 * No framework, plain node --test.
 */

import test from 'node:test';
import assert from 'node:assert';

// Mock implementations that work in Node
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64url(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return Buffer.from(str, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = str.padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  const buffer = Buffer.from(padded, 'base64');
  return new Uint8Array(buffer);
}

test('base64url round-trip basic', () => {
  const text = 'Hello, World!';
  const bytes = textEncoder.encode(text);
  const encoded = toBase64url(bytes);
  const decoded = fromBase64url(encoded);
  const result = textDecoder.decode(decoded);
  assert.strictEqual(result, text);
});

test('base64url round-trip with percent sign', () => {
  const text = 'Progress: 50% complete';
  const bytes = textEncoder.encode(text);
  const encoded = toBase64url(bytes);
  const decoded = fromBase64url(encoded);
  const result = textDecoder.decode(decoded);
  assert.strictEqual(result, text);
});

test('base64url round-trip with non-ASCII', () => {
  const text = 'Café, naïve, résumé';
  const bytes = textEncoder.encode(text);
  const encoded = toBase64url(bytes);
  const decoded = fromBase64url(encoded);
  const result = textDecoder.decode(decoded);
  assert.strictEqual(result, text);
});

test('base64url round-trip with emoji', () => {
  const text = 'Done: 1 2 3';
  const bytes = textEncoder.encode(text);
  const encoded = toBase64url(bytes);
  const decoded = fromBase64url(encoded);
  const result = textDecoder.decode(decoded);
  assert.strictEqual(result, text);
});

test('base64url round-trip with JSON', () => {
  const doc = {
    dossier: {
      version: '1.0.0',
      title: 'Test Report',
      pages: [{ title: 'Page 1', blocks: [] }],
    },
  };
  const json = JSON.stringify(doc);
  const bytes = textEncoder.encode(json);
  const encoded = toBase64url(bytes);
  const decoded = fromBase64url(encoded);
  const result = textDecoder.decode(decoded);
  const parsed = JSON.parse(result);
  assert.deepStrictEqual(parsed, doc);
});

test('tier classification under 2000', () => {
  const small = 'x'.repeat(1000);
  assert.strictEqual(getTier(small), 'travels');
});

test('tier classification 2000-8000', () => {
  const medium = 'x'.repeat(5000);
  assert.strictEqual(getTier(medium), 'fine');
});

test('tier classification 8000-32000', () => {
  const large = 'x'.repeat(20000);
  assert.strictEqual(getTier(large), 'large');
});

test('tier classification over 32000', () => {
  const huge = 'x'.repeat(50000);
  assert.strictEqual(getTier(huge), 'refused');
});

function getTier(payload) {
  const len = payload.length;
  if (len < 2000) return 'travels';
  if (len < 8000) return 'fine';
  if (len < 32000) return 'large';
  return 'refused';
}

// ── The round trip ───────────────────────────────────────────────────────────
// The test that was missing. Nine tests passed while `decodeFragment` refused
// its own encoder's output, because none of them put the two together: the
// encoder labelled the codec inside the payload as `v1:dz:` while the caller
// added `#dz=` on top, and the decoder saw `dz=v1:dz:...` and returned null.
// A sharing feature whose link does not open is the whole feature gone.

test('a document survives encode then decode, through the fragment', async () => {
  const { encodeDocument, decodeFragment } = await import('../js/share.js');

  const doc = {
    dossier: {
      version: 1,
      title: 'Round trip, 100% of the way',
      subtitle: 'Percent signs, non-ASCII text and an emoji walk into a URL',
      pages: [{
        title: 'Page',
        blocks: [
          { type: 'prose', text: 'Latency fell 46.5% and the café stayed open. Shipped it.' },
          { type: 'metrics', items: [{ label: 'p95', value: 182, unit: 'ms', baseline: 340 }] },
        ],
      }],
    },
  };

  const encoded = await encodeDocument(doc);
  assert.ok(encoded, 'encodeDocument returned nothing');
  assert.match(encoded.fragment, /^#(dz|d1)=/, `fragment is not keyed: ${encoded.fragment.slice(0, 20)}`);
  assert.ok(!encoded.payload.includes(':'), 'the payload carries a codec label it should not');

  const back = await decodeFragment(encoded.fragment);
  assert.ok(back && back.document, 'decodeFragment refused its own encoder output');
  assert.deepStrictEqual(back.document, doc, 'the document changed on the way through');
});

test('a decoder accepts the fragment with or without its leading hash', async () => {
  const { encodeDocument, decodeFragment } = await import('../js/share.js');
  const doc = { dossier: { version: 1, title: 'x', pages: [{ title: 'p', blocks: [] }] } };
  const encoded = await encodeDocument(doc);

  const withHash = await decodeFragment(encoded.fragment);
  const without = await decodeFragment(encoded.fragment.replace(/^#/, ''));
  assert.ok(withHash && withHash.document, 'failed with a leading hash');
  assert.ok(without && without.document, 'failed without a leading hash');
});

test('a page route is not mistaken for a report payload', async () => {
  const { fragmentCarriesReport } = await import('../js/share.js');
  assert.strictEqual(fragmentCarriesReport('#/results'), false);
  assert.strictEqual(fragmentCarriesReport('#/the-change-itself'), false);
  assert.strictEqual(fragmentCarriesReport(''), false);
  assert.strictEqual(fragmentCarriesReport('#dz=abc'), true);
  assert.strictEqual(fragmentCarriesReport('#d1=abc'), true);
});

test('deflate beats plain base64 on report shaped json', async () => {
  const { encodeDocument } = await import('../js/share.js');
  const page = {
    title: 'Findings',
    blocks: Array.from({ length: 30 }, (_, i) => ({
      type: 'prose',
      text: `The limiter counted requests per process, so four workers allowed four times the configured rate. Occurrence ${i}.`,
    })),
  };
  const encoded = await encodeDocument({ dossier: { version: 1, title: 'big', pages: [page] } });
  const plain = JSON.stringify({ dossier: { version: 1, title: 'big', pages: [page] } }).length;
  assert.ok(encoded.key === 'dz', 'deflate-raw was not used, so CompressionStream is missing here');
  assert.ok(
    encoded.payload.length < plain,
    `compressed payload ${encoded.payload.length} is not smaller than the ${plain} byte document`,
  );
});
