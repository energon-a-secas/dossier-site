#!/usr/bin/env node

/**
 * Generate a JSON Schema draft-07 from the registry.
 *
 * Hard constraints:
 * - JSON Schema draft-07
 * - Self-contained, no external $ref
 * - Under 60,000 bytes
 * - No derived fields in schema
 *
 * Three things the first version got wrong, all invisible to the hand-rolled
 * test validator and all caught by a real one (ajv):
 *
 * - Each `Block_<type>` set `type: { const: <type> }` and then copied the
 *   envelope over it, whose `type` is a plain string. Every block definition
 *   matched every block, so `Block.oneOf` ("exactly one") rejected even the
 *   one-prose document. The discriminator is now written last.
 * - The envelope, evidence schema included, was pasted into all 27 block
 *   definitions. It is now one `Envelope` definition each block references.
 * - An `Evidence` definition was generated and never referenced. It is now
 *   the one evidence schema, built from the registry like everything else.
 *
 * Required fields inside list items and objects are emitted too, matching
 * what the validator now enforces.
 */

import { BLOCKS, derivedFields, requiredFields, ENVELOPE, META } from '../js/registry/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIMIT = 60000;

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

if (bytes >= LIMIT) {
  console.error(`Schema too large: ${bytes} bytes (must be under ${LIMIT}). Shorten registry notes or share more definitions.`);
  process.exit(2);
}

// Written minified, on purpose. The size limit that matters belongs to the
// agent vendors that accept a caller-supplied schema, and at least one caps it
// at 64 KB. Pretty printing this doubled it to 111 KB, which measured clean
// against the serialised form while shipping a file that would be refused.
// The artifact itself is now the thing under the limit. Readability lives in
// llms.txt and in js/registry, which are written for people.
const outputPath = path.join(__dirname, '../schema.json');
fs.writeFileSync(outputPath, `${serialized}\n`, 'utf-8');

console.log(`Generated ${outputPath}: ${bytes} bytes`);
process.exit(0);

// ============================================================================

function generateMetaProperties() {
  const props = {};

  for (const [name, field] of Object.entries(META)) {
    if (!field) continue;
    props[name] = fieldToSchema(field);
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

  // The fields every block carries, once. `type` is left to each block, which
  // pins it to a constant; the envelope only says what the shared fields are.
  const envelope = {};
  for (const [name, field] of Object.entries(ENVELOPE)) {
    if (!field || name === 'type' || field.derived) continue;
    envelope[name] = name === 'evidence'
      ? withNote({ type: 'array', items: { $ref: '#/definitions/Evidence' } }, field)
      : fieldToSchema(field);
  }
  defs.Envelope = { type: 'object', properties: envelope };

  defs.Evidence = fieldToSchema(ENVELOPE.evidence.of);

  const blockOneOf = [];
  for (const block of BLOCKS) {
    const defName = `Block_${block.id}`;
    defs[defName] = generateBlockDefinition(block);
    blockOneOf.push({ $ref: `#/definitions/${defName}` });
  }
  defs.Block = { oneOf: blockOneOf };

  return defs;
}

function generateBlockDefinition(block) {
  const derived = new Set(derivedFields(block.id));
  const props = {};

  for (const [name, field] of Object.entries(block.fields || {})) {
    if (!field || derived.has(name)) continue;
    props[name] = fieldToSchema(field);
  }

  // Written last, so nothing can overwrite the discriminator.
  props.type = { const: block.id };

  return {
    type: 'object',
    allOf: [{ $ref: '#/definitions/Envelope' }],
    properties: props,
    required: requiredFields(block.id).filter((f) => !derived.has(f)),
  };
}

function withNote(schema, field) {
  if (field.note) schema.description = field.note;
  return schema;
}

function fieldToSchema(field) {
  if (!field || !field.type) return {};

  const schema = {};

  switch (field.type) {
    case 'string':
    case 'text':
    case 'url':
    case 'date':
      schema.type = 'string';
      if (field.maxLen) schema.maxLength = field.maxLen;
      break;

    case 'number':
    case 'integer':
      schema.type = field.type;
      if (Array.isArray(field.values)) schema.enum = field.values;
      if (field.min !== undefined) schema.minimum = field.min;
      if (field.max !== undefined) schema.maximum = field.max;
      break;

    case 'boolean':
      schema.type = 'boolean';
      break;

    case 'enum':
      schema.enum = field.values || [];
      break;

    case 'array':
      schema.type = 'array';
      if (field.min !== undefined) schema.minItems = field.min;
      if (field.max !== undefined) schema.maxItems = field.max;
      if (field.of === 'block') schema.items = { $ref: '#/definitions/Block' };
      else if (field.of === 'page') schema.items = { $ref: '#/definitions/Page' };
      else if (field.of === 'evidence-item') schema.items = { $ref: '#/definitions/Evidence' };
      else if (field.of && typeof field.of === 'object' && field.of.type) schema.items = fieldToSchema(field.of);
      break;

    case 'object': {
      schema.type = 'object';
      const props = {};
      const required = [];
      for (const [name, sub] of Object.entries(field.fields || {})) {
        if (!sub || sub.derived) continue;
        props[name] = fieldToSchema(sub);
        if (sub.required) required.push(name);
      }
      if (Object.keys(props).length) schema.properties = props;
      if (required.length) schema.required = required;
      break;
    }

    default:
      break; // 'any': no constraint
  }

  return withNote(schema, field);
}
