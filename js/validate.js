/**
 * Validator: walk the model and collect findings.
 *
 * DOM-free. Node imports this. The validator, the CLI and tests all run the
 * same rules and cannot disagree about what a valid document is.
 *
 * Three blind spots this walk used to have, each of which let a shipped
 * example render blank rows while "Check report" said it was fine:
 *
 * - A required field inside a list item or an object was never checked
 *   (`if (value === undefined) continue`), so `steps` items with no `title`
 *   and checklist items with no `label` or `state` passed.
 * - A key the item does not have was never reported, so `text` where the
 *   format says `label` was silent.
 * - A grid's children were skipped ("for now"), so a grid holding an unknown
 *   type validated with no finding at all.
 */

import {
  BLOCKS, blockDef, isKnownType, derivedFields, requiredFields,
  ENVELOPE, META, PAGE, CHECKED_BY,
} from './registry/index.js';
import { wasDerived } from './derive.js';

const ENVELOPE_KEYS = new Set(Object.keys(ENVELOPE));
// A page's blocks are walked by the page loop, with page context, so the
// field walk leaves them out rather than validating every block twice.
const PAGE_FIELDS = Object.fromEntries(Object.entries(PAGE).filter(([name]) => name !== 'blocks'));

/**
 * @param {object} model
 * @returns {Array<Finding>}
 */
export function validate(model) {
  const findings = [];
  const add = (path, page, level, message, rule) => {
    findings.push({ level, message, path, page: page || null, rule: rule || null });
  };

  if (!model || typeof model !== 'object') {
    add('', null, 'error', 'Document is not an object');
    return findings;
  }

  const dossier = model.dossier;
  if (!dossier || typeof dossier !== 'object') {
    add('dossier', null, 'error', 'Missing or invalid dossier object');
    return findings;
  }

  // Block counts for the lint rules that judge a whole report, grid children
  // included: a callout inside a grid is still a callout.
  const typeCounts = {};
  const count = (blocks) => {
    for (const block of Array.isArray(blocks) ? blocks : []) {
      const t = block?.type;
      if (!t) continue;
      typeCounts[t] = (typeCounts[t] || 0) + 1;
      if (t === 'grid') count(block.blocks);
    }
  };
  for (const page of Array.isArray(dossier.pages) ? dossier.pages : []) count(page?.blocks);
  const countOfType = (type) => typeCounts[type] || 0;

  const walk = { add, countOfType };

  // Unknown document and page keys are reported at info level. schema.json
  // closes both objects (additionalProperties false), so a key the registry
  // does not declare passed here and failed the published schema, with no
  // word to the author about which one.
  validateFields(dossier, META, 'dossier', null, walk, { rule: 'meta', checkUnknown: true });

  if (!Array.isArray(dossier.pages)) {
    add('dossier.pages', null, 'error', 'Pages must be an array');
    return findings;
  }
  if (dossier.pages.length === 0) add('dossier.pages', null, 'error', 'Must have at least one page');
  if (dossier.pages.length > 40) add('dossier.pages', null, 'error', 'Maximum 40 pages allowed');

  for (let pi = 0; pi < dossier.pages.length; pi++) {
    const page = dossier.pages[pi];
    const pagePath = `dossier.pages[${pi}]`;
    const pageTitle = page?.title || `Page ${pi + 1}`;

    if (!page || typeof page !== 'object') {
      add(pagePath, pageTitle, 'error', 'Page must be an object');
      continue;
    }

    validateFields(page, PAGE_FIELDS, pagePath, pageTitle, walk, { rule: 'page', checkUnknown: true, alsoKnown: ['blocks'] });

    if (!Array.isArray(page.blocks)) {
      add(`${pagePath}.blocks`, pageTitle, 'error', 'Blocks must be an array');
      continue;
    }
    if (page.blocks.length === 0) {
      add(`${pagePath}.blocks`, pageTitle, 'error', 'Page must have at least one block');
    }

    page.blocks.forEach((block, bi) => {
      validateBlockAt(block, `${pagePath}.blocks[${bi}]`, pageTitle, walk, 0);
    });
  }

  return findings;
}

function validateBlockAt(block, path, page, walk, depth) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    walk.add(path, page, 'error', 'Block must be an object');
    return;
  }
  validateBlock(block, path, page, walk, depth);
}

function validateBlock(block, path, page, walk, depth) {
  const { add } = walk;
  const blockType = block.type;

  if (!blockType) {
    add(`${path}.type`, page, 'error', 'Block must have a type', 'block.type.required');
    return;
  }

  if (!isKnownType(blockType)) {
    const suggestion = findClosestType(String(blockType));
    const message = suggestion
      ? `Unknown block type: ${blockType}. Did you mean: ${suggestion}?`
      : `Unknown block type: ${blockType}`;
    add(path, page, 'error', message, 'block.type.unknown');
    return;
  }

  const def = blockDef(blockType);
  if (!def) return;

  validateFields(block, ENVELOPE, path, page, walk, { rule: 'envelope', checkUnknown: false });

  // A derived model carries these legitimately: derive() put them there and
  // marked them. Only an author-supplied one is a finding, which is why the
  // marker exists rather than this check being dropped.
  for (const field of derivedFields(blockType)) {
    if (block[field] !== undefined && !wasDerived(block, field)) {
      add(`${path}.${field}`, page, 'warn',
        `Field "${field}" is derived and should not be supplied. It will be ignored.`,
        `block.${blockType}.${field}.derived`);
    }
  }

  for (const field of requiredFields(blockType)) {
    if (isMissing(block[field]) && !aliasPresent(block, def.fields?.[field])) {
      add(`${path}.${field}`, page, 'error',
        `Block "${blockType}" is missing required field: ${field}`,
        `block.${blockType}.${field}.required`);
    }
  }

  // Required top-level fields were reported just above, in the block's own
  // words, so the walk below checks types, nested fields and unknown keys.
  validateFields(block, def.fields || {}, path, page, walk, {
    rule: `block.${blockType}`, blockType, depth, skipRequired: true, checkUnknown: false,
  });

  // Unknown top-level keys, at info: carried through, never rendered.
  const known = new Set([...ENVELOPE_KEYS, ...Object.keys(def.fields || {})]);
  for (const key of Object.keys(block)) {
    if (known.has(key) || key === '__error' || wasDerived(block, key)) continue;
    const alias = aliasTarget(def.fields, key);
    if (alias && block[alias] === undefined) {
      add(`${path}.${key}`, page, 'info', `Spelled "${key}", read as "${alias}".`, `block.${blockType}.${key}.alias`);
    } else {
      add(`${path}.${key}`, page, 'info', `Unknown field: ${key}`, `block.${blockType}.${key}.unknown`);
    }
  }

  if (Array.isArray(def.lint)) {
    const lintCtx = { model: null, page, countOfType: walk.countOfType, path };
    def.lint.forEach((rule, i) => {
      try {
        rule(block, (level, message) => add(path, page, level, message, `block.${blockType}.lint[${i}]`), lintCtx);
      } catch (e) {
        add(path, page, 'error', `Lint rule ${i} threw: ${String(e?.message || e)}`, `block.${blockType}.lint[${i}].error`);
      }
    });
  }
}

/**
 * Check every declared field of `obj` against its descriptor.
 *
 * opts.rule          the rule id prefix, for example "block.steps.items"
 * opts.skipRequired  the caller already reported missing required fields
 * opts.checkUnknown  report keys the descriptor does not declare, at info
 * opts.alsoKnown     declared keys the caller walks itself (a page's blocks)
 */
function validateFields(obj, fields, path, page, walk, opts = {}) {
  const { add } = walk;

  for (const [name, fieldDef] of Object.entries(fields)) {
    if (!fieldDef) continue;
    const value = obj[name];

    if (isMissing(value)) {
      if (fieldDef.required && !opts.skipRequired && !aliasPresent(obj, fieldDef)) {
        add(`${path}.${name}`, page, 'error', `Missing required field: ${name}`, `${opts.rule}.${name}.required`);
      }
      if (value === undefined || value === null) continue;
    }

    validateField(value, fieldDef, `${path}.${name}`, page, walk, { ...opts, rule: `${opts.rule}.${name}` });
  }

  if (opts.checkUnknown && Object.keys(fields).length) {
    for (const key of Object.keys(obj)) {
      if (Object.prototype.hasOwnProperty.call(fields, key) || wasDerived(obj, key)) continue;
      if (opts.alsoKnown && opts.alsoKnown.includes(key)) continue;
      const alias = aliasTarget(fields, key);
      if (alias && obj[alias] === undefined) {
        add(`${path}.${key}`, page, 'info', `Spelled "${key}", read as "${alias}".`, `${opts.rule}.${key}.alias`);
      } else {
        add(`${path}.${key}`, page, 'info', `Unknown field: ${key}`, `${opts.rule}.${key}.unknown`);
      }
    }
  }
}

function validateField(value, fieldDef, path, page, walk, opts) {
  const { add } = walk;
  if (!fieldDef || !fieldDef.type) return;
  const ft = fieldDef.type;

  if (ft === 'string' && typeof value === 'string' && value.includes('\n')) {
    add(path, page, 'error', 'String field cannot contain newlines. Use a text field instead.');
    return;
  }

  // One length check for every string-typed field. The text branch used to
  // repeat it, so the findings panel listed one over-long field twice.
  if (fieldDef.maxLen !== undefined && typeof value === 'string' && value.length > fieldDef.maxLen) {
    add(path, page, 'error',
      `Too long: ${value.length.toLocaleString('en-US')} characters, over the limit of ${fieldDef.maxLen.toLocaleString('en-US')}.`,
      `${opts.rule}.maxLen`);
  }

  switch (ft) {
    case 'string':
    case 'text':
      if (typeof value !== 'string') add(path, page, 'error', `Expected ${ft}, got ${typeName(value)}`);
      break;
    case 'integer':
      if (!Number.isInteger(value)) add(path, page, 'error', `Expected integer, got ${typeName(value)}`);
      else checkRange(value, fieldDef, path, page, add, 'Integer');
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) add(path, page, 'error', `Expected number, got ${typeName(value)}`);
      else checkRange(value, fieldDef, path, page, add, 'Number');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') add(path, page, 'error', `Expected boolean, got ${typeName(value)}`);
      break;
    case 'enum':
      if (!fieldDef.values || !fieldDef.values.includes(value)) {
        add(path, page, 'error', `Invalid enum value: ${String(value)}. Allowed: ${fieldDef.values?.join(', ') || '?'}`);
      }
      break;
    case 'url':
      if (typeof value !== 'string') add(path, page, 'error', `Expected URL string, got ${typeName(value)}`);
      else if (/^\s*javascript:/i.test(value)) add(path, page, 'error', 'JavaScript URLs are not allowed');
      else if (!isValidUrl(value)) add(path, page, 'error', `Invalid URL: ${value}`);
      break;
    case 'date':
      if (typeof value !== 'string') add(path, page, 'error', `Expected date string, got ${typeName(value)}`);
      else if (!isValidDate(value)) add(path, page, 'error', `Invalid date format: ${value}. Use YYYY-MM-DD or ISO instant`);
      break;
    case 'array':
      validateArray(value, fieldDef, path, page, walk, opts);
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        add(path, page, 'error', `Expected object, got ${typeName(value)}`);
      } else if (fieldDef.fields) {
        validateFields(value, fieldDef.fields, path, page, walk, { ...opts, skipRequired: false, checkUnknown: true, alsoKnown: null });
      }
      break;
    default:
      break; // 'any': deliberately unconstrained
  }
}

function validateArray(value, fieldDef, path, page, walk, opts) {
  const { add } = walk;
  if (!Array.isArray(value)) {
    add(path, page, 'error', `Expected array, got ${typeName(value)}`);
    return;
  }
  if (fieldDef.min !== undefined && value.length < fieldDef.min) {
    add(path, page, 'error', `Array has fewer than ${fieldDef.min} items`);
  }
  if (fieldDef.max !== undefined && value.length > fieldDef.max) {
    add(path, page, 'error', `Array has more than ${fieldDef.max} items`);
  }

  const of = fieldDef.of;
  if (of === 'block') {
    value.forEach((child, i) => {
      const at = `${path}[${i}]`;
      // One level of nesting is the layout model. The grid's own lint reports
      // a grid inside a grid; its children are not walked a second level down.
      if (opts.depth >= 1 || (child && child.type === 'grid' && opts.blockType === 'grid')) {
        if (!child || typeof child !== 'object') walk.add(at, page, 'error', 'Block must be an object');
        return;
      }
      validateBlockAt(child, at, page, walk, (opts.depth || 0) + 1);
    });
    return;
  }

  // 'page' items are walked by validate() itself; 'any' is unconstrained.
  const itemDef = of === 'evidence-item' ? ENVELOPE.evidence.of
    : (of && typeof of === 'object' && of.type ? of : null);
  if (!itemDef) return;

  value.forEach((item, i) => {
    const at = `${path}[${i}]`;
    if (itemDef.type === 'object' && (isMissing(item) || typeof item !== 'object')) {
      add(at, page, 'error', `Expected object, got ${typeName(item)}`);
      return;
    }
    validateField(item, itemDef, at, page, walk, opts);
  });
}

function checkRange(value, fieldDef, path, page, add, what) {
  if (fieldDef.min !== undefined && value < fieldDef.min) add(path, page, 'error', `${what} below minimum ${fieldDef.min}`);
  if (fieldDef.max !== undefined && value > fieldDef.max) add(path, page, 'error', `${what} above maximum ${fieldDef.max}`);
}

function isMissing(value) {
  return value === undefined || value === null || value === '';
}

/** The field an alternative spelling belongs to, or null. */
function aliasTarget(fields, key) {
  for (const [name, def] of Object.entries(fields || {})) {
    if (def?.accepts?.includes(key)) return name;
  }
  return null;
}

/** True when the object carries the field under one of its accepted spellings. */
function aliasPresent(obj, fieldDef) {
  return Boolean(obj && fieldDef?.accepts?.some((alt) => !isMissing(obj[alt])));
}

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isValidUrl(str) {
  if (/^\s*javascript:/i.test(str)) return false;
  if (str.startsWith('data:')) return true;
  if (str.startsWith('http://') || str.startsWith('https://')) {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  }
  if (str.startsWith('mailto:') || str.startsWith('#')) return true;
  // Relative paths are valid
  return str.startsWith('/') || str.startsWith('./') || str.startsWith('../') || /^[^/:?#]+\./.test(str);
}

function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) || /^\d{4}-\d{2}-\d{2}T/.test(str);
}

function findClosestType(type) {
  let closest = null;
  let minDist = Infinity;
  for (const b of BLOCKS) {
    const dist = levenshtein(type, b.id);
    if (dist < minDist && dist <= 3) {
      minDist = dist;
      closest = b.id;
    }
  }
  return closest;
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Count blocks that make claims and categorize evidence.
 *
 * @param {object} model
 * @returns {{blocks: number, withEvidence: number, unsourced: number, byChecker: object}}
 */
export function claimAudit(model) {
  const CLAIM_TYPES = new Set([
    'metrics', 'chart', 'gauge', 'scorecard', 'table', 'findings',
    'tests', 'compare', 'decision', 'risks', 'prose', 'callout',
  ]);

  let blocks = 0;
  let withEvidence = 0;
  const byChecker = { code: 0, human: 0, llm: 0, none: 0 };

  if (model?.dossier?.pages && Array.isArray(model.dossier.pages)) {
    for (const page of model.dossier.pages) {
      if (page?.blocks && Array.isArray(page.blocks)) {
        for (const block of page.blocks) {
          if (CLAIM_TYPES.has(block?.type)) {
            blocks++;

            if (Array.isArray(block.evidence) && block.evidence.length > 0) {
              withEvidence++;
              for (const ev of block.evidence) {
                const checker = ev?.checkedBy || 'none';
                if (CHECKED_BY.includes(checker)) {
                  byChecker[checker]++;
                }
              }
            } else {
              byChecker.none++;
            }
          }
        }
      }
    }
  }

  const unsourced = blocks - withEvidence;

  return { blocks, withEvidence, unsourced, byChecker };
}
