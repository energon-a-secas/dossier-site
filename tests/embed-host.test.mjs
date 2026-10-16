/**
 * embed.html, the sealed host for "Run the report's scripts", writes whatever
 * its parent posts into its own document. That is only safe in the frame
 * Dossier builds (sandbox="allow-scripts", so an opaque origin). GitHub Pages
 * cannot send frame-ancestors, so any site could frame the file without a
 * sandbox, become its parent, and run script as the Dossier origin, with
 * every saved report in reach. The host therefore checks that it is sealed
 * before it listens or announces itself. A browser check that frames it from
 * another origin is in scripts/check-html-import.mjs (embedRefusesStrangers).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const page = fs.readFileSync(path.join(root, 'embed.html'), 'utf-8');

test('embed.html listens and announces itself only once it knows it is sealed', () => {
  const sealed = /self\.origin\s*===\s*'null'/.exec(page);
  assert.ok(sealed, 'embed.html no longer requires an opaque origin');
  const listens = page.indexOf("addEventListener('message'");
  const ready = page.indexOf('dossier-embed-ready');
  assert.ok(listens > 0, 'embed.html no longer listens for its content');
  assert.ok(ready > 0, 'embed.html no longer announces itself');
  assert.ok(sealed.index < listens, 'the message listener is bound before the sealed check');
  assert.ok(sealed.index < ready, 'the ready message is posted before the sealed check');
});

test('the listener and the ready message sit inside the sealed block', () => {
  const guard = page.indexOf('if (sealed) {');
  assert.ok(guard > 0, 'the sealed condition no longer guards a block');
  assert.ok(guard < page.indexOf("addEventListener('message'"));
  assert.ok(guard < page.indexOf('dossier-embed-ready'));
  // The parent must still be Dossier where the browser can say so.
  assert.match(page, /location\.ancestorOrigins\[0\]\s*!==\s*location\.origin/);
  // The old guard, `window.parent !== window` alone, let a stranger in.
  assert.doesNotMatch(page, /if \(window\.parent !== window\) \{/);
});
