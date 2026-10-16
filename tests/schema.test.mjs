/**
 * Test the generated schema.
 * No framework, plain node --test.
 *
 * The validator below is small but it is not lenient. The previous one treated
 * `oneOf` as "any match", ignored `const`, and never resolved `$ref`, so it
 * passed a schema in which every block definition matched every block, which
 * a real draft-07 validator rejected on the one-prose document. This one
 * implements the keywords the generator emits with their real meaning, so the
 * discriminator bug cannot come back without a red test.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BLOCKS } from '../js/registry/index.js';
import { detect } from '../js/adapters/index.js';
import { toDossier as markdownToDossier } from '../js/adapters/markdown.js';
import { validate } from '../js/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const schemaPath = () => path.join(root, 'schema.json');

function loadSchema() {
  return JSON.parse(fs.readFileSync(schemaPath(), 'utf-8'));
}

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));
}

function loadFixture(name) {
  return loadJson(`fixtures/${name}.json`);
}

/**
 * Draft-07, for the keywords the generator uses: $ref (local), type, enum,
 * const, properties, required, additionalProperties, items, min/maxItems,
 * min/maxLength, minimum/maximum, allOf, anyOf, oneOf (exactly one).
 * Returns a list of errors, empty when the instance is valid.
 */
function check(instance, schema, rootSchema, at = '') {
  const errors = [];
  const fail = (message) => errors.push(`${at || '/'} ${message}`);

  if (schema === true || schema === undefined) return errors;
  if (schema === false) return [`${at || '/'} is not allowed`];

  if (schema.$ref) {
    const match = /^#\/definitions\/(.+)$/.exec(schema.$ref);
    if (!match || !rootSchema.definitions?.[match[1]]) return [`${at} unresolvable $ref ${schema.$ref}`];
    return check(instance, rootSchema.definitions[match[1]], rootSchema, at);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => isType(instance, t))) {
      fail(`must be ${types.join(' or ')}`);
      return errors;
    }
  }
  if (schema.const !== undefined && instance !== schema.const) fail(`must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(instance)) fail(`must be one of ${schema.enum.join(', ')}`);

  if (typeof instance === 'string') {
    if (schema.maxLength !== undefined && [...instance].length > schema.maxLength) fail(`longer than ${schema.maxLength}`);
    if (schema.minLength !== undefined && [...instance].length < schema.minLength) fail(`shorter than ${schema.minLength}`);
  }
  if (typeof instance === 'number') {
    if (schema.minimum !== undefined && instance < schema.minimum) fail(`below ${schema.minimum}`);
    if (schema.maximum !== undefined && instance > schema.maximum) fail(`above ${schema.maximum}`);
  }

  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
    if (schema.items) instance.forEach((item, i) => errors.push(...check(item, schema.items, rootSchema, `${at}/${i}`)));
  }

  if (isType(instance, 'object')) {
    for (const req of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(instance, req)) fail(`must have required property "${req}"`);
    }
    const props = schema.properties || {};
    for (const [key, value] of Object.entries(instance)) {
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        errors.push(...check(value, props[key], rootSchema, `${at}/${key}`));
      } else if (schema.additionalProperties === false) {
        fail(`must not have additional property "${key}"`);
      } else if (typeof schema.additionalProperties === 'object') {
        errors.push(...check(value, schema.additionalProperties, rootSchema, `${at}/${key}`));
      }
    }
  }

  for (const sub of schema.allOf || []) errors.push(...check(instance, sub, rootSchema, at));
  if (schema.anyOf && !schema.anyOf.some((sub) => check(instance, sub, rootSchema, at).length === 0)) {
    fail('must match at least one schema in anyOf');
  }
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((sub) => check(instance, sub, rootSchema, at).length === 0).length;
    if (passing !== 1) fail(`must match exactly one schema in oneOf, matched ${passing}`);
  }

  return errors;
}

function isType(value, type) {
  switch (type) {
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}

const validDoc = (blocks) => ({ dossier: { version: 1, title: 'x', pages: [{ title: 'p', blocks }] } });

test('schema exists and is valid JSON', () => {
  const schema = loadSchema();
  assert.ok(schema, 'Schema file loaded');
  assert.strictEqual(typeof schema, 'object', 'Schema is an object');
});

test('schema is draft-07', () => {
  const schema = loadSchema();
  assert.strictEqual(schema.$schema, 'http://json-schema.org/draft-07/schema#');
});

test('schema is under 60000 bytes, as the file on disk', () => {
  // Measure the artifact, not a re-serialisation of it. The first version of
  // this test measured JSON.stringify(schema) at 56 KB while the committed
  // file was 111 KB pretty-printed, so it passed and the shipped file would
  // still have been refused by a vendor capping the schema at 64 KB.
  const onDisk = fs.statSync(schemaPath()).size;
  assert.ok(onDisk < 60000, `schema.json is ${onDisk} bytes on disk, must be under 60000`);

  const serialized = Buffer.byteLength(JSON.stringify(loadSchema()), 'utf-8');
  assert.ok(serialized < 60000, `Schema serialises to ${serialized} bytes, must be under 60000`);
});

test('schema has no external $ref, and every local $ref resolves', () => {
  const schema = loadSchema();
  const serialized = JSON.stringify(schema);
  assert.ok(!serialized.includes('"$ref":"http'), 'Schema should have no external $ref');
  for (const [, name] of serialized.matchAll(/"\$ref":"#\/definitions\/([^"]+)"/g)) {
    assert.ok(schema.definitions[name], `$ref to a missing definition: ${name}`);
  }
});

test('schema defines required top-level structures', () => {
  const schema = loadSchema();
  assert.ok(schema.properties.dossier, 'Schema has dossier property');
  assert.ok(schema.definitions, 'Schema has definitions');
  assert.ok(schema.definitions.Block, 'Schema has Block definition');
  assert.ok(schema.definitions.Envelope, 'Schema has one shared Envelope definition');
  assert.ok(schema.definitions.Evidence, 'Schema has one Evidence definition');
});

test('every block definition pins its type to a constant', () => {
  // The envelope's plain string `type` used to overwrite the const, so every
  // block definition matched every block and oneOf could never pass.
  const schema = loadSchema();
  for (const block of BLOCKS) {
    const def = schema.definitions[`Block_${block.id}`];
    assert.ok(def, `no definition for ${block.id}`);
    assert.deepStrictEqual(def.properties.type, { const: block.id }, `Block_${block.id} lost its discriminator`);
    assert.ok(def.required.includes('type'), `Block_${block.id} does not require type`);
  }
});

test('the envelope and the evidence schema are written once and referenced', () => {
  const schema = loadSchema();
  const serialized = JSON.stringify(schema);
  const envelopeRefs = serialized.split('"$ref":"#/definitions/Envelope"').length - 1;
  assert.strictEqual(envelopeRefs, BLOCKS.length, 'each block should reference the envelope exactly once');
  assert.ok(serialized.includes('"$ref":"#/definitions/Evidence"'), 'nothing references the Evidence definition');
  assert.strictEqual(serialized.split('"checkedBy"').length - 1, 1, 'the evidence schema is inlined more than once');
});

test('the validator here is strict: it rejects what draft-07 rejects', () => {
  const schema = loadSchema();
  assert.deepStrictEqual(check(validDoc([{ type: 'prose', text: 'hi' }]), schema, schema), []);
  assert.ok(check(validDoc([{ type: 'nonsense' }]), schema, schema).length, 'an unknown block type passed');
  assert.ok(check(validDoc([{ type: 'prose' }]), schema, schema).length, 'a prose block with no text passed');
  assert.ok(
    check(validDoc([{ type: 'steps', items: [{ detail: 'no title' }, { title: 'b' }] }]), schema, schema).length,
    'a steps item with no title passed',
  );
  assert.ok(
    check(validDoc([{ type: 'checklist', items: [{ label: 'x', done: true }] }]), schema, schema).length,
    'a checklist item with no state passed',
  );
  assert.ok(
    check(validDoc([{ type: 'grid', blocks: [{ type: 'prose', text: 'a' }, { type: 'nonsense' }] }]), schema, schema).length,
    'a grid holding an unknown type passed',
  );
});

test('complete.json satisfies schema', () => {
  const schema = loadSchema();
  assert.deepStrictEqual(check(loadFixture('complete'), schema, schema), []);
});

test('minimal.json satisfies schema', () => {
  const schema = loadSchema();
  assert.deepStrictEqual(check(loadFixture('minimal'), schema, schema), []);
});

test('every bundled example and clean fixture satisfies the schema', () => {
  // Agents are told to emit against schema.json, so a shipped example that
  // the schema refuses teaches the wrong shape.
  const schema = loadSchema();
  const reports = loadJson('reports/index.json').map((e) => `reports/${e.file}`);
  const fixtures = loadJson('fixtures/index.json')
    .filter((e) => !(e.findings === 'multiple' || Number(e.findings) > 0))
    .map((e) => `fixtures/${e.file}`);
  const failures = [];
  for (const rel of [...reports, ...fixtures]) {
    const errors = check(loadJson(rel), schema, schema);
    if (errors.length) failures.push(`${rel}: ${errors.slice(0, 3).join('; ')}`);
  }
  assert.deepStrictEqual(failures, []);
});

// An imported file is a document like any other, and the schema closes the
// document object. Markdown front matter (author, date) was copied onto it
// whole, so an import passed the validator and failed the published schema.
test('every converted foreign fixture satisfies the schema', () => {
  const schema = loadSchema();
  const dir = path.join(root, 'fixtures/foreign');
  const failures = [];
  for (const name of fs.readdirSync(dir)) {
    const source = fs.readFileSync(path.join(dir, name), 'utf-8');
    const adapter = detect(source);
    if (!adapter) {
      failures.push(`${name}: no adapter detected it`);
      continue;
    }
    const { document } = adapter.toDossier(source);
    const errors = check(document, schema, schema);
    if (errors.length) failures.push(`${name} (${adapter.id}): ${errors.slice(0, 3).join('; ')}`);
  }
  assert.deepStrictEqual(failures, []);
});

test('Markdown front matter keeps only what the document declares, and says what it left out', () => {
  const schema = loadSchema();
  const source = '---\ntitle: "Quarterly: review"\nauthor: Jane\ndate: 2026-10-10\nkind: incident\nstatus: unheard-of\ntags: [api, "db"]\nversion: 7\n---\n# Page\n\nText.\n';
  const { document, findings } = markdownToDossier(source);
  const d = document.dossier;
  assert.strictEqual(d.version, 1, 'a front-matter version replaced the format version');
  assert.strictEqual(d.title, 'Quarterly: review');
  assert.strictEqual(d.owner, 'Jane');
  assert.strictEqual(d.kind, 'incident');
  assert.deepStrictEqual(d.tags, ['api', 'db']);
  for (const key of ['author', 'date', 'status']) assert.ok(!(key in d), `${key} was copied onto the document`);
  assert.deepStrictEqual(check(document, schema, schema), []);
  assert.deepStrictEqual(validate(document).filter((f) => f.level !== 'hint'), []);
  const note = findings.find((f) => f.rule === 'import.markdown.frontmatter');
  assert.ok(note && note.level === 'info', 'the reader was not told what was left out');
  assert.match(note.message, /date, status/);
});

test('the validator names an unknown document or page key the schema would refuse', () => {
  const schema = loadSchema();
  const doc = { dossier: { version: 1, title: 't', author: 'x', pages: [{ title: 'p', layout: 'wide', blocks: [{ type: 'prose', text: 'a' }] }] } };
  assert.ok(check(doc, schema, schema).length > 0, 'the schema accepted unknown keys');
  const unknown = validate(doc).filter((f) => /\.unknown$/.test(f.rule || ''));
  assert.deepStrictEqual(unknown.map((f) => [f.level, f.path]), [
    ['info', 'dossier.author'],
    ['info', 'dossier.pages[0].layout'],
  ]);
});

test('every registry sample satisfies its block definition', () => {
  const schema = loadSchema();
  const failures = [];
  for (const block of BLOCKS) {
    const errors = check(validDoc([block.sample]), schema, schema);
    if (errors.length) failures.push(`${block.id}: ${errors.slice(0, 2).join('; ')}`);
  }
  assert.deepStrictEqual(failures, []);
});

test('messy.json does not satisfy the schema', () => {
  const schema = loadSchema();
  assert.ok(check(loadFixture('messy'), schema, schema).length > 0);
});
