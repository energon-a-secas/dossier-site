/**
 * js-yaml (a quarter of the site's scripts) loads only when YAML reaches the
 * parser. Boot used to fetch it on every visit, and the paths that read YAML
 * worked only because that warm-up usually won a race: on a slow connection
 * a pasted or dropped YAML report failed with "YAML parsing requires
 * js-yaml". Now `initYaml` is one memoized load that every YAML path awaits,
 * gated on `needsYaml`. The browser half is scripts/check-yaml-lazy.mjs.
 *
 * The tests run in order: the first one needs the parser not yet loaded.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parse, initYaml, yamlReady, needsYaml,
} from '../js/parse.js';
import { dump } from '../js/vendor/js-yaml.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const minimalYaml = dump(JSON.parse(fs.readFileSync(path.join(root, 'fixtures/minimal.json'), 'utf8')));

test('before anything loads it, YAML says it needs its parser', () => {
  assert.equal(yamlReady(), false);
  assert.match(parse(minimalYaml).fatal.message, /requires js-yaml/);
});

test('needsYaml is the parser\'s own JSON-or-YAML test', () => {
  assert.equal(needsYaml('{"a":1}'), false);
  assert.equal(needsYaml('  [1]'), false);
  assert.equal(needsYaml('dossier:\n  version: 1'), true);
  assert.equal(needsYaml(''), false);
  assert.equal(needsYaml('   \n'), false);
  assert.equal(needsYaml(null), false);
});

test('the parser loads once, however many callers wait for it', async () => {
  const a = initYaml();
  const b = initYaml();
  assert.equal(a, b, 'two callers started two loads');
  await a;
  assert.equal(yamlReady(), true);
  const read = parse(minimalYaml);
  assert.equal(read.fatal, null);
  assert.equal(read.model.dossier.title, 'Minimal report');
  // Loaded, it answers at once.
  await initYaml();
});
