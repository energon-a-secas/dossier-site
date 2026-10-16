/**
 * The Display options are listed twice: js/display.js (the dialog, a module)
 * and js/appearance.js (a classic script that applies them before the first
 * paint, before any module has loaded). A value added to one list only is
 * reset by appearance.js on every load, so the reader's choice is lost on
 * reload and nothing else would notice. This runs the real appearance.js in a
 * sandbox and holds the two lists equal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { READING } from '../js/display.js';

const source = fs.readFileSync(new URL('../js/appearance.js', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

/** Run appearance.js against a stubbed page with `stored` in localStorage; returns <html>'s dataset. */
function runAppearance(stored) {
  const dataset = {};
  const store = new Map(Object.entries(stored));
  const media = { matches: false, addEventListener() {} };
  vm.runInNewContext(source, {
    document: {
      documentElement: { dataset },
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    window: { matchMedia: () => media, addEventListener() {} },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    location: { hash: '', search: '', origin: 'http://x' },
    setTimeout: () => 0,
    HTMLScriptElement: class {},
    ErrorEvent: class {},
  });
  return dataset;
}

test('every Display option a reader can choose survives the pre-paint script', () => {
  for (const [key, values] of Object.entries(READING)) {
    for (const value of values) {
      const dataset = runAppearance({ 'dossier-site:reading': JSON.stringify({ __v: 1, data: { [key]: value } }) });
      assert.equal(dataset[key], value, `js/appearance.js reset ${key} "${value}" before paint`);
    }
  }
});

test('with nothing stored, each option starts at its first value', () => {
  const dataset = runAppearance({});
  for (const [key, values] of Object.entries(READING)) assert.equal(dataset[key], values[0], `default for ${key}`);
});

test('the two READING lists are equal, so appearance.js accepts nothing the dialog does not offer', () => {
  const match = source.match(/const READING = (\{[\s\S]*?\n {2}\});/);
  assert.ok(match, 'READING in js/appearance.js is no longer a literal this test can read: update the test with it');
  assert.deepEqual(plain(vm.runInNewContext(`(${match[1]})`)), plain(READING));
});
