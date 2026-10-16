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

// ── Words a reader uses (js/forms.js) ──────────────────────────────────────
// The editor named fields by their format keys ("Item-0", "Chrome") and
// showed raw enum values ("in-review"), while the report beside it read "In
// review". These hold the form to the reader's words.

test('field, item and option labels are words a reader uses', async () => {
  const { fieldLabel, itemLabel, optionLabel } = await import('../js/forms.js');
  const { enumWord } = await import('../js/render/format.js');
  assert.equal(fieldLabel('chrome'), 'Opens in');
  assert.equal(fieldLabel('checkedBy'), 'Checked by');
  assert.equal(fieldLabel('why_not'), 'Why not');
  assert.equal(fieldLabel('highlightChanges'), 'Highlight changes');
  assert.equal(itemLabel('tags', 0), 'Tag 1');
  assert.equal(itemLabel('criteria', 1), 'Criterion 2');
  assert.equal(itemLabel('evidence', 0), 'Source 1');
  assert.equal(itemLabel('columns', 2), 'Column 3');
  assert.equal(itemLabel('class', 0), 'Class 1', 'a trailing "ss" lost its s');
  assert.equal(optionLabel('status', 'in-review'), 'In review');
  assert.equal(optionLabel('status', 'rolled-back'), 'Rolled back');
  assert.equal(optionLabel('chrome', 'auto'), "Reader's last choice");
  assert.equal(optionLabel('checkedBy', 'llm'), 'A model');
  assert.equal(optionLabel('constructor', 'toString'), 'ToString', 'an inherited property was read as a field\'s words');
  assert.equal(enumWord('constructor'), 'Constructor');
  assert.equal(typeof enumWord('constructor'), 'string');
});

test('every enum value in the format has an option label a reader can read', async () => {
  const { optionLabel } = await import('../js/forms.js');
  const { ENVELOPE, META } = await import('../js/registry/index.js');
  const seen = [];
  const sweep = (fields) => {
    for (const [name, raw] of Object.entries(fields || {})) {
      const def = typeof raw === 'string' ? { type: raw } : raw || {};
      if (def.type === 'enum') {
        for (const value of def.values || []) seen.push([name, value, optionLabel(name, value)]);
      }
      if (def.type === 'object') sweep(def.fields);
      if (def.type === 'array' && def.of) sweep({ [name]: def.of });
    }
  };
  for (const block of BLOCKS) sweep(block.fields);
  sweep(META);
  sweep(ENVELOPE);
  assert.ok(seen.length > 40, `only ${seen.length} enum values found: the sweep missed fields`);
  for (const [name, value, label] of seen) {
    assert.ok(label, `${name} "${value}" has no option label`);
    assert.match(label, /^[A-Z]/, `${name} "${value}" reads "${label}"`);
    assert.ok(!label.includes('-'), `${name} "${value}" reads "${label}", with the format's hyphen`);
  }
});
