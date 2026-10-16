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

  // An alias claimed by two fields of one block. The parser renames a spelling
  // only inside the object whose field declares it (js/parse.js applyAliases),
  // so only a clash within one object would make the rename ambiguous. The
  // audit keeps the stricter block-wide rule because one spelling meaning two
  // things in the same block confuses the author as well.
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
      if (Object.prototype.hasOwnProperty.call(ENVELOPE, name)) {
        problems.push(`${at} field "${name}" shadows an envelope field`);
      }
    }
    auditFields(b.fields, `${at} field`, problems);

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

    // The same, one level in. Checking only the top level is how the Steps
    // and Facts samples shipped with item fields their renderers never read:
    // the validator skipped item fields, so nothing compared the two.
    if (b.sample) sampleProblems(b.sample, b.fields, `${at} sample`, problems);
  }
  return problems;
}

/**
 * What is wrong with one sample of a block type, inside its items as well as
 * at the top. auditRegistry runs it over every registry sample; a test runs it
 * over a known bad one, so the audit is shown to catch what it claims to.
 */
export function auditSample(type, sample) {
  const def = blockDef(type);
  if (!def) return [`unknown block type "${type}"`];
  const problems = [];
  sampleProblems(sample, def.fields, `block "${type}" sample`, problems);
  return problems;
}

/** Field descriptors, recursively: known types, enum values, no required-and-derived. */
function auditFields(fields, where, problems) {
  for (const [name, f] of Object.entries(fields || {})) {
    const at = `${where} "${name}"`;
    if (!f || !f.type) { problems.push(`${at} has no type`); continue; }
    if (!TYPES.includes(f.type)) problems.push(`${at} has unknown type "${f.type}"`);
    if (f.type === 'enum' && !Array.isArray(f.values)) problems.push(`${at} is an enum with no values`);
    if (f.required && f.derived) {
      problems.push(`${at} is both required and derived, which asks for a number it then ignores`);
    }
    if (f.type === 'object') auditFields(f.fields, `${at} field`, problems);
    if (f.type === 'array' && f.of && typeof f.of === 'object' && f.of.type === 'object') {
      auditFields(f.of.fields, `${at} item field`, problems);
    }
  }
}

/** Nested required fields a sample omits, and nested derived ones it supplies. */
function sampleProblems(value, fields, where, problems) {
  for (const [name, f] of Object.entries(fields || {})) {
    const v = value?.[name];
    if (v === undefined || v === null) continue;
    if (f?.type === 'object' && f.fields) checkItem(v, f.fields, `${where} "${name}"`, problems);
    if (f?.type === 'array' && Array.isArray(v)) {
      if (f.of === 'block') {
        v.forEach((child, i) => {
          const def = blockDef(child?.type);
          if (!def) { problems.push(`${where} "${name}"[${i}] has unknown type "${child?.type}"`); return; }
          for (const req of requiredFields(def.id)) {
            if (child[req] === undefined) problems.push(`${where} "${name}"[${i}] is missing its required field "${req}"`);
          }
          sampleProblems(child, def.fields, `${where} "${name}"[${i}]`, problems);
        });
      } else if (f.of && typeof f.of === 'object' && f.of.type === 'object') {
        v.forEach((item, i) => checkItem(item, f.of.fields, `${where} "${name}"[${i}]`, problems));
      }
    }
  }
}

function checkItem(item, fields, where, problems) {
  if (!item || typeof item !== 'object') { problems.push(`${where} is not an object`); return; }
  for (const [name, f] of Object.entries(fields || {})) {
    if (f?.required && (item[name] === undefined || item[name] === null || item[name] === '')) {
      problems.push(`${where} is missing its required field "${name}"`);
    }
    if (f?.derived && item[name] !== undefined) problems.push(`${where} supplies the derived field "${name}"`);
  }
  for (const key of Object.keys(item)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) problems.push(`${where} has a field the format does not have: "${key}"`);
  }
  sampleProblems(item, fields, where, problems);
}
