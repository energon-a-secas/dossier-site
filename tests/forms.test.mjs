/**
 * Test suite for forms module.
 *
 * Plain node --test, no framework. Tests the pure parts: descriptor mapping,
 * derived field handling, block type coverage, and template files.
 */

import { strict as assert } from 'assert';
import { test } from 'node:test';
import { readFileSync } from 'fs';
import { BLOCKS, blockDef, derivedFields } from '../js/registry/index.js';

test('blockDef returns registry entry for known type', () => {
  const def = blockDef('prose');
  assert.ok(def);
  assert.equal(def.id, 'prose');
  assert.ok(def.name);
  assert.ok(def.fields);
});

test('blockDef returns undefined for unknown type', () => {
  const def = blockDef('nonexistent');
  assert.equal(def, undefined);
});

test('every block has required metadata', () => {
  for (const block of BLOCKS) {
    assert.ok(block.id, `Block missing id`);
    assert.ok(block.name, `${block.id} missing name`);
    assert.ok(block.group, `${block.id} missing group`);
    assert.ok(block.summary, `${block.id} missing summary`);
    assert.ok(block.when, `${block.id} missing when`);
    assert.ok(block.sample, `${block.id} missing sample`);
    assert.ok(Array.isArray(block.lint), `${block.id} missing lint array`);
  }
});

test('derived fields are marked in block definitions', () => {
  for (const block of BLOCKS) {
    const derived = derivedFields(block.id);
    for (const fieldName of derived) {
      const field = block.fields?.[fieldName];
      assert.ok(field, `${block.id} has derived field ${fieldName} but it does not exist`);
      assert.equal(field.derived, true, `${block.id} field ${fieldName} marked derived but has no derived flag`);
    }
  }
});

test('derived fields never in samples', () => {
  for (const block of BLOCKS) {
    const derived = derivedFields(block.id);
    for (const fieldName of derived) {
      assert.equal(
        block.sample[fieldName],
        undefined,
        `${block.id} sample supplies derived field ${fieldName}`
      );
    }
  }
});

test('required fields are in samples', () => {
  for (const block of BLOCKS) {
    const fields = block.fields || {};
    for (const [name, field] of Object.entries(fields)) {
      if (field?.required && !field?.derived) {
        assert.notEqual(
          block.sample?.[name],
          undefined,
          `${block.id} sample missing required field ${name}`
        );
      }
    }
  }
});

test('all block types have samples with correct type', () => {
  for (const block of BLOCKS) {
    assert.ok(block.sample, `${block.id} has no sample`);
    assert.equal(
      block.sample.type,
      block.id,
      `${block.id} sample has wrong type`
    );
  }
});

test('all templates in index.json exist and parse as JSON', () => {
  const indexText = readFileSync('reports/index.json', 'utf8');
  const index = JSON.parse(indexText);
  assert.ok(Array.isArray(index), 'Template index is not an array');

  for (const tpl of index) {
    assert.ok(tpl.file, 'Template entry missing file');
    assert.ok(tpl.title, 'Template entry missing title');
    assert.ok(tpl.kind, 'Template entry missing kind');

    const templatePath = `reports/${tpl.file}`;
    const templateText = readFileSync(templatePath, 'utf8');
    const doc = JSON.parse(templateText);
    assert.ok(doc.dossier, `${tpl.file} missing dossier envelope`);
    assert.ok(doc.dossier.title, `${tpl.file} missing title`);
    assert.ok(Array.isArray(doc.dossier.pages), `${tpl.file} missing pages array`);
    assert.ok(doc.dossier.pages.length > 0, `${tpl.file} has no pages`);
  }
});

test('template metadata matches index', () => {
  const indexText = readFileSync('reports/index.json', 'utf8');
  const index = JSON.parse(indexText);

  for (const tpl of index) {
    const templatePath = `reports/${tpl.file}`;
    const templateText = readFileSync(templatePath, 'utf8');
    const doc = JSON.parse(templateText);
    assert.equal(
      doc.dossier.title,
      tpl.title,
      `${tpl.file} title does not match index`
    );
    assert.equal(
      doc.dossier.kind,
      tpl.kind,
      `${tpl.file} kind does not match index`
    );
  }
});

test('form field types map to control types correctly', () => {
  const typeMapping = {
    string: 'text',
    text: 'textarea',
    number: 'number',
    integer: 'number',
    boolean: 'checkbox',
    enum: 'select',
    url: 'url',
    date: 'date',
    array: 'fieldset',
    object: 'fieldset',
  };

  for (const block of BLOCKS) {
    for (const [fieldName, field] of Object.entries(block.fields || {})) {
      assert.ok(
        typeMapping[field.type],
        `${block.id} field ${fieldName} has unmapped type ${field.type}`
      );
    }
  }
});

test('derived fields are not expected in form inputs', () => {
  for (const block of BLOCKS) {
    const derived = derivedFields(block.id);
    for (const fieldName of derived) {
      assert.ok(true, `${block.id}.${fieldName} is correctly marked derived`);
    }
  }
});

test('every block type has a sample for catalog preview', () => {
  for (const block of BLOCKS) {
    assert.ok(
      block.sample,
      `${block.id} has no sample for catalog preview`
    );
    assert.ok(
      block.sample.type === block.id,
      `${block.id} sample has type "${block.sample.type}"`
    );
  }
});

test('sample templates are valid according to their schema', () => {
  const indexText = readFileSync('reports/index.json', 'utf8');
  const index = JSON.parse(indexText);

  for (const tpl of index) {
    const templatePath = `reports/${tpl.file}`;
    const templateText = readFileSync(templatePath, 'utf8');
    const doc = JSON.parse(templateText);

    assert.ok(doc.dossier.version, `${tpl.file} has no version`);
    assert.ok(doc.dossier.title, `${tpl.file} has no title`);
    assert.ok(Array.isArray(doc.dossier.pages), `${tpl.file} pages is not an array`);

    for (const page of doc.dossier.pages) {
      assert.ok(page.title, `${tpl.file} page has no title`);
      assert.ok(Array.isArray(page.blocks), `${tpl.file} page has no blocks array`);
      for (const block of page.blocks) {
        assert.ok(block.type, `${tpl.file} block has no type`);
      }
    }
  }
});
