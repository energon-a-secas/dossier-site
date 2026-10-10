/**
 * Test the generated schema.
 * No framework, plain node --test.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const schemaPath = () => path.join(__dirname, '../schema.json');

function loadSchema() {
  return JSON.parse(fs.readFileSync(schemaPath(), 'utf-8'));
}

function loadFixture(name) {
  const filePath = path.join(__dirname, '../fixtures', `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function validateSchema(instance, schema) {
  // Simple draft-07 validator for the subset we generate
  if (schema.type === 'object') {
    if (typeof instance !== 'object' || Array.isArray(instance) || instance === null) {
      return false;
    }
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in instance)) {
          return false;
        }
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in instance) {
          if (!validateSchema(instance[key], propSchema)) {
            return false;
          }
        }
      }
    }
    return true;
  } else if (schema.type === 'string') {
    return typeof instance === 'string';
  } else if (schema.type === 'number') {
    return typeof instance === 'number';
  } else if (schema.type === 'integer') {
    return Number.isInteger(instance);
  } else if (schema.type === 'boolean') {
    return typeof instance === 'boolean';
  } else if (schema.type === 'array') {
    if (!Array.isArray(instance)) return false;
    if (schema.items) {
      if (schema.items.oneOf) {
        for (const item of instance) {
          let matched = false;
          for (const subSchema of schema.items.oneOf) {
            if (validateSchema(item, subSchema)) {
              matched = true;
              break;
            }
          }
          if (!matched) return false;
        }
      } else {
        for (const item of instance) {
          if (!validateSchema(item, schema.items)) {
            return false;
          }
        }
      }
    }
    return true;
  } else if (schema.oneOf) {
    for (const subSchema of schema.oneOf) {
      if (validateSchema(instance, subSchema)) {
        return true;
      }
    }
    return false;
  } else if (schema.const !== undefined) {
    return instance === schema.const;
  } else if (schema.enum !== undefined) {
    return schema.enum.includes(instance);
  }
  return true;
}

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

test('schema has no external $ref', () => {
  const schema = loadSchema();
  const serialized = JSON.stringify(schema);
  assert.ok(!serialized.includes('"$ref":"http'), 'Schema should have no external $ref');
});

test('schema defines required top-level structures', () => {
  const schema = loadSchema();
  assert.ok(schema.properties.dossier, 'Schema has dossier property');
  assert.ok(schema.definitions, 'Schema has definitions');
  assert.ok(schema.definitions.Block, 'Schema has Block definition');
});

test('complete.json satisfies schema', () => {
  const schema = loadSchema();
  const fixture = loadFixture('complete');

  const valid = validateSchema(fixture, schema);
  assert.ok(valid, 'complete.json should satisfy the schema');
});

test('minimal.json satisfies schema', () => {
  const schema = loadSchema();
  const fixture = loadFixture('minimal');

  const valid = validateSchema(fixture, schema);
  assert.ok(valid, 'minimal.json should satisfy the schema');
});
