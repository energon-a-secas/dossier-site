/**
 * Binary input is refused before anything reads it as a report
 * (js/text-check.js). 300,000 random bytes opened as a Markdown report called
 * "Document" and were saved, a PDF reached the YAML parser and its error
 * quoted raw binary at the reader, and in the Compare view both became a
 * column. Every bundled report and fixture must still read as text.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { notText, NOT_TEXT_MESSAGE, decodeBytes } from '../js/text-check.js';
import { readText } from '../js/read.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const random = new TextDecoder().decode(crypto.randomBytes(300000));

/** Every file under a directory, recursively. */
function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(full) : [full];
  });
}

test('a NUL anywhere, or random bytes, is not text', () => {
  assert.equal(notText(`# Report\n\n${'words '.repeat(20000)}\u0000`), true, 'a NUL past the sample was missed');
  assert.equal(notText(random), true);
  // Binary with its NULs taken out still has a control character in about
  // every ten.
  const noNul = new TextDecoder().decode(crypto.randomBytes(300000).map((b) => b || 1));
  assert.equal(notText(noNul), true);
});

test('every bundled report and fixture is text', () => {
  const files = [...filesIn(path.join(root, 'reports')), ...filesIn(path.join(root, 'fixtures'))]
    .filter((f) => /\.(json|ya?ml|md|html?|xml|sarif|txt|log)$/i.test(f));
  assert.ok(files.length > 10, `only ${files.length} files found`);
  for (const file of files) assert.equal(notText(fs.readFileSync(file, 'utf8')), false, path.relative(root, file));
});

test('a CI log with ANSI colours and tabs, and a stray replacement character, are text', () => {
  assert.equal(notText('\u001b[32mPASS\u001b[0m\tsrc/a.test.js (1.2 s)\r\n'.repeat(2000)), false);
  assert.equal(notText('# Report\n\nA stray \ufffd or two \ufffd in a Markdown report.\n'), false);
  assert.equal(notText('<!doctype html><p>caf\ufffd</p>'), false);
  assert.equal(notText(''), false);
  // Spanish saved as Latin-1 decodes its accents to replacement characters;
  // it is still a report.
  const latin = new TextDecoder().decode(Buffer.from('La aplicación está en producción, dijo el señor Núñez. '.repeat(500), 'latin1'));
  assert.equal(notText(latin), false);
});

test('readText refuses binary with one sentence, and no adapter sees it', () => {
  const read = readText(random);
  assert.equal(read.ok, false);
  assert.equal(read.adapter, null);
  assert.equal(read.fatal.message, NOT_TEXT_MESSAGE);
});

test('a Compare column refuses binary too', async () => {
  // js/compare/sources.js reads through js/compare/model.js, which is DOM-free.
  const { readSource } = await import('../js/compare/sources.js');
  const out = await readSource(random, 'x.bin');
  assert.equal(out.ok, false);
  assert.equal(out.message, `x.bin: ${NOT_TEXT_MESSAGE}`);
  assert.equal((await readSource(random)).message, NOT_TEXT_MESSAGE);
});

test('UTF-16 files are read by their byte order mark', () => {
  const le = Buffer.from('\ufeff# Report\n\nWritten by PowerShell.', 'utf16le');
  assert.equal(decodeBytes(le), '# Report\n\nWritten by PowerShell.');
  const be = Buffer.from('\ufeffhi', 'utf16le');
  be.swap16();
  assert.equal(decodeBytes(be), 'hi');
  assert.equal(decodeBytes(Buffer.from('plain utf-8 caf\u00e9')), 'plain utf-8 caf\u00e9');
  // Read as UTF-8, the same file was NULs between its letters.
  assert.equal(notText(new TextDecoder().decode(le)), true);
  assert.equal(notText(decodeBytes(le)), false);
});
