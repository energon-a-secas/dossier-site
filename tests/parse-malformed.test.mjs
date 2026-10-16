/**
 * parse() promises a fatal or findings and never an exception. It threw on
 * a null or primitive block (deriveBlockIds set an id on it), a log source or
 * a diff patch that was not text (`source.match`, `patch.split`) and a null
 * metric (`metric.value`), so the editor and the Open dialog had nothing to
 * show. Each malformed shape now parses, names the problem in a finding, and
 * leaves the model renderable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parse } from '../js/parse.js';
import { derive, wasDerived } from '../js/derive.js';
import { validate } from '../js/validate.js';
import { blockHtml } from '../js/render/index.js';

const wrap = (blocks) => JSON.stringify({ dossier: { version: 1, title: 'T', pages: [{ title: 'P', blocks }] } });

/** Parse without throwing, validate, render every block; return the pieces. */
function read(blocks) {
  let result;
  assert.doesNotThrow(() => { result = parse(wrap(blocks)); }, 'parse threw');
  assert.equal(result.fatal, null);
  assert.ok(result.model, 'no model');
  assert.doesNotThrow(() => validate(result.model), 'validate threw');
  const rendered = result.model.dossier.pages[0].blocks;
  assert.doesNotThrow(() => rendered.forEach((b) => blockHtml(b, {})), 'a block failed to render');
  return result;
}

const at = (result, path) => result.findings.filter((f) => f.path === path);

test('a block that is null, a number, a string or a list is skipped with a finding', () => {
  for (const block of [null, 5, 'hello', true, [1, 2]]) {
    const result = read([block, { type: 'prose', text: 'still here' }]);
    const found = at(result, 'dossier.pages[0].blocks[0]');
    assert.equal(found.length, 1, `no finding for ${JSON.stringify(block)}`);
    assert.match(found[0].message, /not a block object/);
    // The good block after it still gets its derived id.
    const good = result.model.dossier.pages[0].blocks[1];
    assert.equal(good.id, 'block-p0b1');
    assert.ok(wasDerived(good, 'id'));
  }
});

test('a log source that is not text is not counted, and says so', () => {
  for (const source of [42, { a: 1 }, ['a', 'b'], true]) {
    const result = read([{ type: 'log', source }]);
    const block = result.model.dossier.pages[0].blocks[0];
    assert.equal(block.lines, undefined, `lines derived from ${JSON.stringify(source)}`);
    assert.equal(at(result, 'dossier.pages[0].blocks[0].source').filter((f) => /not text/.test(f.message)).length, 1);
  }
  const fine = read([{ type: 'log', source: 'a\nb\nc' }]);
  assert.equal(fine.model.dossier.pages[0].blocks[0].lines, 3);
});

test('a diff patch that is not text is not counted, and says so', () => {
  for (const patch of [7, ['+a', '-b'], { hunk: 1 }]) {
    const result = read([{ type: 'diff', patch }]);
    assert.equal(result.model.dossier.pages[0].blocks[0].stats, undefined);
    assert.equal(at(result, 'dossier.pages[0].blocks[0].patch').filter((f) => /not text/.test(f.message)).length, 1);
  }
  const fine = read([{ type: 'diff', patch: '+a\n-b\n+c' }]);
  assert.deepEqual(fine.model.dossier.pages[0].blocks[0].stats, { added: 2, removed: 1 });
});

test('a metric that is null or a primitive is skipped; the others still derive', () => {
  for (const bad of [null, 3, 'x', [1]]) {
    const result = read([{ type: 'metrics', items: [bad, { label: 'p95', value: 50, baseline: 100, unit: 'ms', better: 'lower' }] }]);
    const [, good] = result.model.dossier.pages[0].blocks[0].items;
    assert.equal(good.delta, -50);
    assert.equal(good.direction, 'good');
    assert.equal(at(result, 'dossier.pages[0].blocks[0].items[0]').filter((f) => /not a metric object/.test(f.message)).length, 1, `no finding for ${JSON.stringify(bad)}`);
  }
});

test('a metric value or baseline that is not a number derives no delta, never NaN', () => {
  for (const [value, baseline, field] of [['n/a', 1, 'value'], [3, 'before', 'baseline'], [{ v: 1 }, 1, 'value'], [3, [1], 'baseline']]) {
    const result = read([{ type: 'metrics', items: [{ label: 'x', value, baseline, unit: 'ms' }] }]);
    const item = result.model.dossier.pages[0].blocks[0].items[0];
    assert.equal(item.delta, undefined, `delta from ${JSON.stringify([value, baseline])}`);
    assert.equal(item.deltaPct, undefined);
    assert.equal(item.direction, undefined);
    assert.equal(at(result, `dossier.pages[0].blocks[0].items[0].${field}`).filter((f) => /not a number/.test(f.message)).length, 1);
  }
});

test('file line counts that are not numbers stay out of the totals', () => {
  const result = read([{ type: 'files', items: [
    { path: 'a.js', added: 'abc', removed: 2 },
    { path: 'b.js', added: 5, removed: { n: 1 } },
    null,
    7,
  ] }]);
  const { totals } = result.model.dossier.pages[0].blocks[0];
  // "abc" used to be concatenated: the total read "0abc5".
  assert.deepEqual(totals, { count: 2, added: 5, removed: 2 });
  assert.equal(at(result, 'dossier.pages[0].blocks[0].items[0].added').filter((f) => /not a number/.test(f.message)).length, 1);
  assert.equal(at(result, 'dossier.pages[0].blocks[0].items[1].removed').filter((f) => /not a number/.test(f.message)).length, 1);
  assert.equal(at(result, 'dossier.pages[0].blocks[0].items[3]').length, 1, 'a primitive file item went unnamed');
});

test('what derive could not compute is a note, so one mistake is not counted twice', () => {
  // The validator reports the wrong type as an error. The derivation note
  // only explains what was left out because of it.
  const result = read([null, { type: 'log', source: 1 }]);
  const notes = result.findings.filter((f) => /skipped|not counted/.test(f.message));
  assert.equal(notes.length, 2);
  assert.ok(notes.every((f) => f.level === 'info'));
  assert.ok(validate(result.model).some((f) => f.level === 'error' && f.path === 'dossier.pages[0].blocks[0]'));
});

test('parse refuses input that is not text with a fatal, not an exception', () => {
  for (const input of [null, undefined, 5, {}, ['a']]) {
    let result;
    assert.doesNotThrow(() => { result = parse(input); }, `parse(${JSON.stringify(input)}) threw`);
    assert.equal(result.model, null);
    assert.ok(result.fatal && /text/.test(result.fatal.message));
  }
  assert.doesNotThrow(() => parse('{"dossier":{"version":1,"pages":[]}}', null));
});

test('a dossier, page or page list of the wrong shape does not throw', () => {
  for (const dossier of [null, 5, 'x', [], { pages: 'x' }, { pages: [null, 3, 'p', [], { blocks: 'x' }, { blocks: null }] }]) {
    assert.doesNotThrow(() => parse(JSON.stringify({ dossier })), JSON.stringify(dossier));
  }
});

test('derive alone tolerates the same shapes without a findings list', () => {
  const model = { dossier: { pages: [{ blocks: [null, 5, { type: 'log', source: 1 }, { type: 'diff', patch: [] }, { type: 'metrics', items: [null] }] }] } };
  assert.doesNotThrow(() => derive(model));
});
