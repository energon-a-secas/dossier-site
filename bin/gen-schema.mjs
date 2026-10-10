#!/usr/bin/env node

/**
 * Generate a JSON Schema draft-07 from the registry.
 *
 * Hard constraints:
 * - JSON Schema draft-07
 * - Self-contained, no external $ref
 * - Under 60,000 bytes
 * - No derived fields in schema
 */

import { BLOCKS, blockDef, derivedFields, requiredFields, ENVELOPE, META, PAGE } from '../js/registry/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Dossier Work Report',
  type: 'object',
  additionalProperties: false,
  properties: {
    dossier: {
      type: 'object',
      additionalProperties: false,
      required: ['version', 'title', 'pages'],
      properties: generateMetaProperties(),
    },
  },
  required: ['dossier'],
  definitions: generateDefinitions(),
};

// Serialize and check size
const serialized = JSON.stringify(schema);
const bytes = Buffer.byteLength(serialized, 'utf-8');

if (bytes > 60000) {
  console.error(`Schema too large: ${bytes} bytes (max 60,000). Dropping nested descriptions.`);
  process.exit(2);
}

// Write schema.json
const outputPath = path.join(__dirname, '../schema.json');
// Written minified, on purpose. The size limit that matters belongs to the
// agent vendors that accept a caller-supplied schema, and at least one caps it
// at 64 KB. Pretty printing this doubled it to 111 KB, which measured clean
// against the serialised form while shipping a file that would be refused.
// The artifact itself is now the thing under the limit. Readability lives in
// llms.txt and in js/registry, which are written for people.
fs.writeFileSync(outputPath, JSON.stringify(schema) + '\n', 'utf-8');

console.log(`Generated ${outputPath}: ${bytes} bytes`);
process.exit(0);

// ============================================================================

function generateMetaProperties() {
  const props = {};

  for (const [name, field] of Object.entries(META)) {
    if (!field) continue;
    props[name] = fieldToSchema(field, name);
  }

  props.pages = {
    type: 'array',
    minItems: 1,
    maxItems: 40,
    items: { $ref: '#/definitions/Page' },
  };

  return props;
}

function generateDefinitions() {
  const defs = {};

  // Page definition
  defs.Page = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'blocks'],
    properties: {
      id: { type: 'string', description: 'Anchor for deep links. Derived from the title when absent.' },
      title: { type: 'string', maxLength: 60 },
      summary: { type: 'string', maxLength: 200 },
      blocks: {
        type: 'array',
        minItems: 1,
        items: { $ref: '#/definitions/Block' },
      },
    },
  };

  // Block definition with oneOf for each type
  const blockOneOf = [];
  for (const block of BLOCKS) {
    const defName = `Block_${block.id}`;
    defs[defName] = generateBlockDefinition(block);
    blockOneOf.push({ $ref: `#/definitions/${defName}` });
  }

  defs.Block = { oneOf: blockOneOf };

  // Evidence definition
  defs.Evidence = {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: { type: 'string' },
      href: { type: 'string' },
      hash: { type: 'string' },
      excerpt: { type: 'string' },
      kind: { enum: ['commit', 'file', 'log', 'test', 'run', 'ticket', 'doc', 'metric', 'other'] },
      checkedBy: { enum: ['code', 'human', 'llm', 'none'] },
      confidence: { enum: ['high', 'medium', 'low'] },
    },
    required: ['label'],
  };

  return defs;
}

function generateBlockDefinition(block) {
  const derived = new Set(derivedFields(block.id));
  const required = requiredFields(block.id);

  const props = {
    type: { const: block.id },
  };

  // Add envelope fields except derived ones
  for (const [name, field] of Object.entries(ENVELOPE)) {
    if (derived.has(name)) continue;
    if (!field) continue;
    props[name] = fieldToSchema(field, name);
  }

  // Add block-specific fields except derived ones
  if (block.fields) {
    for (const [name, field] of Object.entries(block.fields)) {
      if (derived.has(name)) continue;
      if (!field) continue;
      props[name] = fieldToSchema(field, name);
    }
  }

  return {
    type: 'object',
    additionalProperties: true,
    properties: props,
    required: required.filter(f => !derived.has(f)),
  };
}

function fieldToSchema(field, name) {
  if (!field || !field.type) return {};

  const schema = {};

  switch (field.type) {
    case 'string':
      schema.type = 'string';
      if (field.maxLen) schema.maxLength = field.maxLen;
      if (field.note) schema.description = field.note;
      break;

    case 'text':
      schema.type = 'string';
      if (field.maxLen) schema.maxLength = field.maxLen;
      if (field.note) schema.description = field.note;
      break;

    case 'number':
      schema.type = 'number';
      if (field.min !== undefined) schema.minimum = field.min;
      if (field.max !== undefined) schema.maximum = field.max;
      if (field.note) schema.description = field.note;
      break;

    case 'integer':
      schema.type = 'integer';
      if (field.min !== undefined) schema.minimum = field.min;
      if (field.max !== undefined) schema.maximum = field.max;
      if (field.note) schema.description = field.note;
      break;

    case 'boolean':
      schema.type = 'boolean';
      if (field.note) schema.description = field.note;
      break;

    case 'enum':
      schema.enum = field.values || [];
      if (field.note) schema.description = field.note;
      break;

    case 'url':
      schema.type = 'string';
      if (field.note) schema.description = field.note;
      break;

    case 'date':
      schema.type = 'string';
      if (field.note) schema.description = field.note;
      break;

    case 'array':
      schema.type = 'array';
      if (field.min !== undefined) schema.minItems = field.min;
      if (field.max !== undefined) schema.maxItems = field.max;

      if (field.of) {
        if (typeof field.of === 'string') {
          if (field.of === 'block') {
            schema.items = { $ref: '#/definitions/Block' };
          } else if (field.of === 'page') {
            schema.items = { $ref: '#/definitions/Page' };
          }
        } else if (typeof field.of === 'object' && field.of.type) {
          schema.items = fieldToSchema(field.of, 'item');
        }
      }
      if (field.note) schema.description = field.note;
      break;

    case 'object':
      schema.type = 'object';
      schema.additionalProperties = true;

      if (field.fields) {
        const props = {};
        for (const [fname, ffield] of Object.entries(field.fields)) {
          if (ffield) {
            props[fname] = fieldToSchema(ffield, fname);
          }
        }
        schema.properties = props;
      }
      if (field.note) schema.description = field.note;
      break;

    case 'any':
      // No constraint
      break;
  }

  return schema;
}
