/**
 * The validator inside list items, objects and grids.
 *
 * Each of these let a shipped example render blank rows while "Check report"
 * called it fine: the Release checklist wrote `text` and `done` where the
 * format says `label` and `state`, the Steps sample wrote `label` where it
 * says `title`, and a grid holding an unknown type validated with no finding.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../js/validate.js';
import { parse } from '../js/parse.js';
import { auditSample } from '../js/registry/index.js';

const doc = (...blocks) => ({ dossier: { version: 1, title: 'T', pages: [{ title: 'P', blocks }] } });
const serious = (findings) => findings.filter((f) => f.level === 'error' || f.level === 'warn');
const at = (findings, path) => findings.filter((f) => f.path === path);

test('a required field inside a list item is enforced', () => {
  const findings = validate(doc({ type: 'checklist', items: [{ label: 'Ship it' }] }));
  const missing = at(findings, 'dossier.pages[0].blocks[0].items[0].state');
  assert.equal(missing.length, 1, JSON.stringify(findings));
  assert.equal(missing[0].level, 'error');
  assert.equal(missing[0].rule, 'block.checklist.items.state.required');
});

test('the old Release checklist shape is reported, not passed', () => {
  const findings = validate(doc({ type: 'checklist', items: [{ text: 'Unit tests', done: true, checkedBy: 'code' }] }));
  assert.ok(at(findings, 'dossier.pages[0].blocks[0].items[0].state').some((f) => f.level === 'error'));
  const unknown = findings.filter((f) => f.level === 'info' && /Unknown field: (done|checkedBy)/.test(f.message));
  assert.equal(unknown.length, 2, 'unknown item keys are not reported at info');
});

test('a required field inside an object field is enforced', () => {
  const findings = validate(doc({
    type: 'compare', kind: 'text', left: { value: 'a' }, right: { value: 'b' },
    evidence: [{ kind: 'run' }],
  }));
  const missing = at(findings, 'dossier.pages[0].blocks[0].evidence[0].label');
  assert.equal(missing.length, 1, 'an evidence item with no label passed');
});

test('an unknown key inside an item is reported once, at info', () => {
  const findings = validate(doc({ type: 'kv', items: [{ label: 'Env', value: 'staging', colour: 'red' }] }));
  const unknown = at(findings, 'dossier.pages[0].blocks[0].items[0].colour');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].level, 'info');
});

test('extra stays quiet: it is where your own fields go', () => {
  const findings = validate(doc({ type: 'prose', text: 'x', extra: { team: 'core', anything: { nested: true } } }));
  assert.deepEqual(findings, []);
});

test('an accepted spelling satisfies a required field, and says so at info', () => {
  const raw = doc({ type: 'steps', items: [{ label: 'One' }, { text: 'Two' }] });
  const findings = validate(raw);
  assert.deepEqual(serious(findings), [], JSON.stringify(findings));
  assert.ok(findings.some((f) => f.message === 'Spelled "label", read as "title".'));

  const { model, findings: parsed } = parse(JSON.stringify(raw));
  assert.deepEqual(model.dossier.pages[0].blocks[0].items.map((i) => i.title), ['One', 'Two']);
  assert.ok(parsed.some((f) => f.message === 'Renamed "label" to "title"'));
  assert.deepEqual(validate(model), []);
});

test('a spelling is renamed only inside the field that accepts it', () => {
  // steps accepts `label` for an item title. Evidence items have a `label` of
  // their own, and the old flat rename would have turned it into `title`.
  const { model } = parse(JSON.stringify(doc({
    type: 'steps',
    items: [{ title: 'a' }, { title: 'b' }],
    evidence: [{ label: 'Run 8812', checkedBy: 'code' }],
  })));
  const block = model.dossier.pages[0].blocks[0];
  assert.equal(block.evidence[0].label, 'Run 8812');
  assert.equal(block.evidence[0].title, undefined);
});

test('a grid validates its children like any other block', () => {
  const findings = validate(doc({
    type: 'grid',
    blocks: [{ type: 'compare' }, { type: 'nonsense' }],
  }));
  const paths = findings.filter((f) => f.level === 'error').map((f) => f.path);
  assert.ok(paths.includes('dossier.pages[0].blocks[0].blocks[0].kind'), JSON.stringify(paths));
  assert.ok(paths.includes('dossier.pages[0].blocks[0].blocks[1]'), 'an unknown child type passed');
  assert.ok(findings.some((f) => f.rule === 'block.type.unknown'));
});

test('a grid inside a grid is refused once, and its children are not walked', () => {
  const findings = validate(doc({
    type: 'grid',
    blocks: [
      { type: 'grid', blocks: [{ type: 'nonsense' }, { type: 'prose' }] },
      { type: 'prose', text: 'fine' },
    ],
  }));
  const refusals = findings.filter((f) => /cannot hold a grid/.test(f.message));
  assert.equal(refusals.length, 1, JSON.stringify(findings));
  assert.ok(!findings.some((f) => f.path.includes('.blocks[0].blocks[0].blocks')), 'the nested grid was walked');
});

test('an over-long text field is reported once, in words a person reads', () => {
  const findings = validate(doc({ type: 'prose', text: 'x'.repeat(2500) }));
  const long = at(findings, 'dossier.pages[0].blocks[0].text').filter((f) => f.level === 'error');
  assert.equal(long.length, 1, JSON.stringify(long));
  assert.match(long[0].message, /^Too long: 2,500 characters, over the limit of 2,400\.$/);
});

test('derived item fields on a parsed model are not reported as unknown', () => {
  const { model } = parse(JSON.stringify(doc({
    type: 'metrics', items: [{ label: 'p95', value: 1, unit: 'ms', baseline: 2, better: 'lower' }],
  })));
  const findings = validate(model);
  assert.ok(!findings.some((f) => /Unknown field: (deltaPct|direction|delta)/.test(f.message)), JSON.stringify(findings));
});

test('the registry audit checks samples inside their items', () => {
  const problems = auditSample('steps', { type: 'steps', items: [{ label: 'a' }, { label: 'b' }] });
  assert.ok(problems.some((p) => p.includes('missing its required field "title"')), problems.join('; '));
  assert.ok(problems.some((p) => p.includes('"label"')));
  assert.deepEqual(auditSample('steps', { type: 'steps', items: [{ title: 'a' }, { title: 'b' }] }), []);
});
