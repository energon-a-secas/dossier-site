/**
 * The block registry: one list, five readers.
 *
 * Nothing in here renders, validates or prints. It is the description of the
 * document format, and the validator, the renderer, the catalog, schema.json
 * and the llms.txt table are all derived from it. A block type is added by
 * appending one object to one group file.
 *
 * DOM-free. Node imports this.
 */

import { ENVELOPE, META, PAGE, TYPES, TONES, WIDTHS, KINDS, STATUSES, CHECKED_BY } from './types.js';
import { NARRATIVE } from './narrative.js';
import { MEASUREMENT } from './measurement.js';
import { WORK } from './work.js';
import { RESULTS } from './results.js';
import { JUDGMENT } from './judgment.js';

export { ENVELOPE, META, PAGE, TYPES, TONES, WIDTHS, KINDS, STATUSES, CHECKED_BY };

/** Every block type, in the order the catalog shows them. */
export const BLOCKS = Object.freeze([
  ...NARRATIVE,
  ...MEASUREMENT,
  ...WORK,
  ...RESULTS,
  ...JUDGMENT,
]);

const BY_ID = new Map(BLOCKS.map((b) => [b.id, b]));

/** The registry entry for a type, or undefined. Never throws. */
export function blockDef(type) {
  return BY_ID.get(String(type || ''));
}

export function isKnownType(type) {
  return BY_ID.has(String(type || ''));
}

export function blockTypes() {
  return BLOCKS.map((b) => b.id);
}

/** Catalog grouping, in registry order, with no empty groups. */
export function groups() {
  const out = new Map();
  for (const b of BLOCKS) {
    if (!out.has(b.group)) out.set(b.group, []);
    out.get(b.group).push(b);
  }
  return out;
}

/**
 * The alias map: every alternative spelling a field accepts, so the parser can
 * coerce `oldText` to `before` once rather than in each reader.
 * Returns { [blockType]: { [alias]: canonicalField } }.
 *
 * Recurses into array and object fields, because the spellings that matter
 * most are on nested items: SARIF writes `annotation_level` and JUnit writes
 * `classname` inside a findings or tests item, not at the block's top level.
 * Names are flat within a block, which is enough for the parser: it renames
 * any key it recognises at whatever depth it finds it.
 */
export function aliases() {
  const out = {};

  function walk(id, fields) {
    for (const [name, def] of Object.entries(fields || {})) {
      if (!def) continue;
      for (const alt of def.accepts || []) {
        out[id] = out[id] || {};
        if (out[id][alt] && out[id][alt] !== name) {
          // Two fields claiming one spelling would make the rename ambiguous.
          // auditRegistry reports it; here the first declaration wins.
          continue;
        }
        out[id][alt] = name;
      }
      if (def.type === 'object') walk(id, def.fields);
      if (def.type === 'array' && def.of && typeof def.of === 'object') {
        if (def.of.type === 'object') walk(id, def.of.fields);
        else walk(id, { [name]: def.of });
      }
    }
  }

  for (const b of BLOCKS) walk(b.id, b.fields);
  return out;
}

/** Fields a reader must never supply, because they are computed. */
export function derivedFields(type) {
  const def = blockDef(type);
  if (!def) return [];
  return Object.entries(def.fields || {})
    .filter(([, f]) => f?.derived)
    .map(([name]) => name);
}

/** Required fields of a block type, envelope included. */
export function requiredFields(type) {
  const def = blockDef(type);
  const own = Object.entries(def?.fields || {})
    .filter(([, f]) => f?.required)
    .map(([name]) => name);
  return ['type', ...own];
}

/**
 * A one-line integrity check over the registry itself, run by the tests and by
 * `make check`. A registry that contradicts itself is worse than no registry,
 * because four readers trust it silently.
 */
export function auditRegistry() {
  const problems = [];
  const seen = new Set();

  // An alias claimed by two fields of one block makes the parser's rename
  // ambiguous, and "first declaration wins" is a coin toss rather than a rule.
  for (const b of BLOCKS) {
    const claimed = new Map();
    const walk = (fields) => {
      for (const [name, def] of Object.entries(fields || {})) {
        if (!def) continue;
        for (const alt of def.accepts || []) {
          if (claimed.has(alt) && claimed.get(alt) !== name) {
            problems.push(`block "${b.id}" lets both "${claimed.get(alt)}" and "${name}" accept the spelling "${alt}"`);
          } else {
            claimed.set(alt, name);
          }
        }
        if (def.type === 'object') walk(def.fields);
        if (def.type === 'array' && def.of && typeof def.of === 'object') {
          if (def.of.type === 'object') walk(def.of.fields);
        }
      }
    };
    walk(b.fields);
  }

  for (const b of BLOCKS) {
    const at = `block "${b.id}"`;
    if (!b.id) problems.push('a block has no id');
    if (seen.has(b.id)) problems.push(`${at} is declared twice`);
    seen.add(b.id);

    for (const key of ['name', 'group', 'summary', 'when']) {
      if (!b[key]) problems.push(`${at} has no ${key}`);
    }
    if (!b.sample) problems.push(`${at} has no sample, so the catalog cannot preview it`);
    if (b.sample && b.sample.type !== b.id) {
      problems.push(`${at} has a sample typed "${b.sample.type}"`);
    }
    if (!Array.isArray(b.lint)) problems.push(`${at} has no lint array`);

    for (const [name, f] of Object.entries(b.fields || {})) {
      const where = `${at} field "${name}"`;
      if (!f || !f.type) { problems.push(`${where} has no type`); continue; }
      if (!TYPES.includes(f.type)) problems.push(`${where} has unknown type "${f.type}"`);
      if (f.type === 'enum' && !Array.isArray(f.values)) {
        problems.push(`${where} is an enum with no values`);
      }
      if (f.required && f.derived) {
        problems.push(`${where} is both required and derived, which asks for a number it then ignores`);
      }
      if (Object.prototype.hasOwnProperty.call(ENVELOPE, name)) {
        problems.push(`${where} shadows an envelope field`);
      }
    }

    // Every sample must satisfy its own required fields, or the catalog ships
    // an example the validator rejects.
    for (const req of requiredFields(b.id)) {
      if (b.sample && b.sample[req] === undefined) {
        problems.push(`${at} sample is missing its required field "${req}"`);
      }
    }
    for (const d of derivedFields(b.id)) {
      if (b.sample && b.sample[d] !== undefined) {
        problems.push(`${at} sample supplies the derived field "${d}"`);
      }
    }
  }
  return problems;
}
