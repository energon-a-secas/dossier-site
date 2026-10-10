/**
 * Validator: walk the model and collect findings.
 *
 * DOM-free. Node imports this. The validator, the CLI and tests all run the
 * same rules and cannot disagree about what a valid document is.
 */

import {
  BLOCKS, blockDef, isKnownType, derivedFields, requiredFields,
  ENVELOPE, META, PAGE, CHECKED_BY
} from './registry/index.js';
import { wasDerived } from './derive.js';

/**
 * @param {object} model
 * @returns {Array<Finding>}
 */
export function validate(model) {
  const findings = [];
  const ctx = { model, countOfType, path: '' };

  // Helper to add findings
  function add(path, page, level, message, rule) {
    findings.push({ level, message, path, page: page || null, rule: rule || null });
  }

  // Track all block types for countOfType
  const typeCounts = {};
  if (model?.dossier?.pages && Array.isArray(model.dossier.pages)) {
    for (const page of model.dossier.pages) {
      if (page?.blocks && Array.isArray(page.blocks)) {
        for (const block of page.blocks) {
          const t = block?.type;
          if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;
        }
      }
    }
  }

  function countOfType(type) {
    return typeCounts[type] || 0;
  }

  if (!model || typeof model !== 'object') {
    add('', null, 'error', 'Document is not an object');
    return findings;
  }

  const dossier = model.dossier;
  if (!dossier || typeof dossier !== 'object') {
    add('dossier', null, 'error', 'Missing or invalid dossier object');
    return findings;
  }

  // Validate meta fields
  validateEnvelope(dossier, 'dossier', null, findings, add, META, 'meta');

  // Validate pages
  if (!Array.isArray(dossier.pages)) {
    add('dossier.pages', null, 'error', 'Pages must be an array');
    return findings;
  }

  if (dossier.pages.length === 0) {
    add('dossier.pages', null, 'error', 'Must have at least one page');
  }

  if (dossier.pages.length > 40) {
    add('dossier.pages', null, 'error', 'Maximum 40 pages allowed');
  }

  // Validate each page
  for (let pi = 0; pi < dossier.pages.length; pi++) {
    const page = dossier.pages[pi];
    const pagePath = `dossier.pages[${pi}]`;
    const pageTitle = page?.title || `Page ${pi + 1}`;

    if (!page || typeof page !== 'object') {
      add(pagePath, pageTitle, 'error', 'Page must be an object');
      continue;
    }

    // Validate page envelope fields
    validateEnvelope(page, pagePath, pageTitle, findings, add, PAGE, 'page');

    // Validate page blocks
    if (!Array.isArray(page.blocks)) {
      add(`${pagePath}.blocks`, pageTitle, 'error', 'Blocks must be an array');
      continue;
    }

    if (page.blocks.length === 0) {
      add(`${pagePath}.blocks`, pageTitle, 'error', 'Page must have at least one block');
    }

    // Validate each block
    for (let bi = 0; bi < page.blocks.length; bi++) {
      const block = page.blocks[bi];
      const blockPath = `${pagePath}.blocks[${bi}]`;

      if (!block || typeof block !== 'object') {
        add(blockPath, pageTitle, 'error', 'Block must be an object');
        continue;
      }

      validateBlock(block, blockPath, pageTitle, findings, add, countOfType);
    }
  }

  return findings;
}

function validateEnvelope(obj, path, page, findings, add, schema, category) {
  if (!obj) return;

  // Check required envelope fields
  const reqFields = Object.entries(schema)
    .filter(([, f]) => f?.required)
    .map(([name]) => name);

  for (const field of reqFields) {
    if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
      const rule = category ? `${category}.${field}.required` : `${field}.required`;
      add(`${path}.${field}`, page, 'error', `Missing required field: ${field}`, rule);
    }
  }

  // Type check all envelope fields
  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    if (fieldDef === undefined) continue;
    const fieldValue = obj[fieldName];
    if (fieldValue === undefined || fieldValue === null) continue;

    validateField(obj[fieldName], fieldDef, `${path}.${fieldName}`, page, findings, add, fieldName);
  }
}

function validateBlock(block, path, page, findings, add, countOfType) {
  const blockType = block.type;

  if (!blockType) {
    add(`${path}.type`, page, 'error', 'Block must have a type', 'block.type.required');
    return;
  }

  // Check if type is known
  if (!isKnownType(blockType)) {
    const suggestion = findClosestType(blockType);
    const message = suggestion
      ? `Unknown block type: ${blockType}. Did you mean: ${suggestion}?`
      : `Unknown block type: ${blockType}`;
    add(path, page, 'error', message, 'block.type.unknown');
    return;
  }

  const def = blockDef(blockType);
  if (!def) return;

  // Validate envelope fields
  validateEnvelope(block, path, page, findings, add, ENVELOPE, 'envelope');

  // Check for derived fields supplied by author
  const derived = derivedFields(blockType);
  for (const field of derived) {
    // A derived model carries these legitimately: derive() put them there and
    // marked them. Only an author-supplied one is a finding, which is why the
    // marker exists rather than this check being dropped.
    if (block[field] !== undefined && !wasDerived(block, field)) {
      add(`${path}.${field}`, page, 'warn',
        `Field "${field}" is derived and should not be supplied. It will be ignored.`,
        `block.${blockType}.${field}.derived`);
    }
  }

  // Validate required fields
  const required = requiredFields(blockType);
  for (const field of required) {
    const val = block[field];
    if (val === undefined || val === null || val === '') {
      add(`${path}.${field}`, page, 'error',
        `Block "${blockType}" is missing required field: ${field}`,
        `block.${blockType}.${field}.required`);
    }
  }

  // Validate block-specific fields
  if (def.fields) {
    for (const [fieldName, fieldDef] of Object.entries(def.fields)) {
      if (fieldDef === undefined) continue;
      const fieldValue = block[fieldName];
      if (fieldValue === undefined || fieldValue === null) continue;

      validateField(fieldValue, fieldDef, `${path}.${fieldName}`, page, findings, add, fieldName);
    }
  }

  // Check for unknown fields (info level)
  const knownFields = new Set(['type', 'id', 'title', 'note', 'width', 'tone', 'collapsed', 'extra', 'evidence']);
  if (def.fields) {
    for (const f of Object.keys(def.fields)) {
      knownFields.add(f);
    }
  }

  for (const [key] of Object.entries(block)) {
    if (!knownFields.has(key) && key !== '__error') {
      add(`${path}.${key}`, page, 'info',
        `Unknown field: ${key}`,
        `block.${blockType}.${key}.unknown`);
    }
  }

  // Run lint rules
  if (Array.isArray(def.lint)) {
    const lintCtx = {
      model: findings.$model || null,
      page,
      countOfType,
      path,
    };

    for (let i = 0; i < def.lint.length; i++) {
      const rule = def.lint[i];
      try {
        const addFinding = (level, message) => {
          add(path, page, level, message, `block.${blockType}.lint[${i}]`);
        };
        rule(block, addFinding, lintCtx);
      } catch (e) {
        add(path, page, 'error',
          `Lint rule ${i} threw: ${String(e?.message || e)}`,
          `block.${blockType}.lint[${i}].error`);
      }
    }
  }
}

function validateField(value, fieldDef, path, page, findings, add, fieldName) {
  if (!fieldDef || !fieldDef.type) return;

  const ft = fieldDef.type;

  // Check for newlines in string fields
  if (ft === 'string' && typeof value === 'string') {
    if (value.includes('\n')) {
      add(path, page, 'error', 'String field cannot contain newlines. Use a text field instead.');
      return;
    }
  }

  // Check maxLen
  if (fieldDef.maxLen !== undefined && typeof value === 'string') {
    if (value.length > fieldDef.maxLen) {
      add(path, page, 'error',
        `String exceeds max length of ${fieldDef.maxLen} characters (${value.length} given)`);
    }
  }

  // Type validation
  if (ft === 'string') {
    if (typeof value !== 'string') {
      add(path, page, 'error', `Expected string, got ${typeof value}`);
    }
  } else if (ft === 'text') {
    if (typeof value !== 'string') {
      add(path, page, 'error', `Expected text, got ${typeof value}`);
    } else if (fieldDef.maxLen && value.length > fieldDef.maxLen) {
      add(path, page, 'error',
        `Text exceeds max length of ${fieldDef.maxLen} characters`);
    }
  } else if (ft === 'integer') {
    if (!Number.isInteger(value)) {
      add(path, page, 'error', `Expected integer, got ${typeof value}`);
    } else {
      if (fieldDef.min !== undefined && value < fieldDef.min) {
        add(path, page, 'error', `Integer below minimum ${fieldDef.min}`);
      }
      if (fieldDef.max !== undefined && value > fieldDef.max) {
        add(path, page, 'error', `Integer above maximum ${fieldDef.max}`);
      }
    }
  } else if (ft === 'number') {
    if (typeof value !== 'number') {
      add(path, page, 'error', `Expected number, got ${typeof value}`);
    } else {
      if (fieldDef.min !== undefined && value < fieldDef.min) {
        add(path, page, 'error', `Number below minimum ${fieldDef.min}`);
      }
      if (fieldDef.max !== undefined && value > fieldDef.max) {
        add(path, page, 'error', `Number above maximum ${fieldDef.max}`);
      }
    }
  } else if (ft === 'boolean') {
    if (typeof value !== 'boolean') {
      add(path, page, 'error', `Expected boolean, got ${typeof value}`);
    }
  } else if (ft === 'enum') {
    if (!fieldDef.values || !fieldDef.values.includes(value)) {
      add(path, page, 'error',
        `Invalid enum value: ${value}. Allowed: ${fieldDef.values?.join(', ') || '?'}`);
    }
  } else if (ft === 'url') {
    if (typeof value !== 'string') {
      add(path, page, 'error', `Expected URL string, got ${typeof value}`);
    } else {
      if (value.startsWith('javascript:')) {
        add(path, page, 'error', `JavaScript URLs are not allowed`);
      } else if (!isValidUrl(value)) {
        add(path, page, 'error', `Invalid URL: ${value}`);
      }
    }
  } else if (ft === 'date') {
    if (typeof value !== 'string') {
      add(path, page, 'error', `Expected date string, got ${typeof value}`);
    } else if (!isValidDate(value)) {
      add(path, page, 'error', `Invalid date format: ${value}. Use YYYY-MM-DD or ISO instant`);
    }
  } else if (ft === 'array') {
    if (!Array.isArray(value)) {
      add(path, page, 'error', `Expected array, got ${typeof value}`);
    } else {
      if (fieldDef.min !== undefined && value.length < fieldDef.min) {
        add(path, page, 'error', `Array has fewer than ${fieldDef.min} items`);
      }
      if (fieldDef.max !== undefined && value.length > fieldDef.max) {
        add(path, page, 'error', `Array has more than ${fieldDef.max} items`);
      }

      // Validate array items
      if (fieldDef.of) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          const itemPath = `${path}[${i}]`;

          if (typeof fieldDef.of === 'string') {
            // Block reference like 'block' or 'page'
            // For now, skip deep validation of nested blocks
          } else if (typeof fieldDef.of === 'object' && fieldDef.of.type) {
            validateField(item, fieldDef.of, itemPath, page, findings, add, `item[${i}]`);
          }
        }
      }
    }
  } else if (ft === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      add(path, page, 'error', `Expected object, got ${typeof value}`);
    } else if (fieldDef.fields) {
      // Validate object fields
      for (const [objFieldName, objFieldDef] of Object.entries(fieldDef.fields)) {
        if (objFieldDef === undefined) continue;
        const objValue = value[objFieldName];
        if (objValue === undefined || objValue === null) continue;

        validateField(objValue, objFieldDef, `${path}.${objFieldName}`, page, findings, add, objFieldName);
      }
    }
  } else if (ft === 'any') {
    // No constraint
  }
}

function isValidUrl(str) {
  if (str.startsWith('javascript:')) return false;
  if (str.startsWith('data:')) return true;
  if (str.startsWith('http://') || str.startsWith('https://')) {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  }
  // Relative paths are valid
  if (str.startsWith('/') || str.startsWith('./') || /^[^/:?#]+\./.test(str)) {
    return true;
  }
  return false;
}

function isValidDate(str) {
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return true;
  }
  // ISO instant
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    return true;
  }
  return false;
}

function findClosestType(type) {
  const known = [];
  for (const b of BLOCKS) {
    known.push(b.id);
  }

  let closest = null;
  let minDist = Infinity;

  for (const kt of known) {
    const dist = levenshtein(type, kt);
    if (dist < minDist && dist <= 3) {
      minDist = dist;
      closest = kt;
    }
  }

  return closest;
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
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
