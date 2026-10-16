/**
 * Parser: turn text into a model.
 *
 * Tolerant parsing and loud findings: a malformed block keeps its __error
 * and renders, and every coercion is recorded.
 *
 * DOM-free. Node imports this. Parse is synchronous; YAML relies on a
 * dynamic import (`initYaml`) that the callers await when `needsYaml` says
 * the text is YAML.
 */

import { derivedFields, blockDef } from './registry/index.js';
import { derive } from './derive.js';

let yamlLoaded = false;
let yamlModule = null;

/**
 * @param {string} text        JSON or YAML source
 * @param {{ format?: 'json'|'yaml'|'auto' }} [opts]
 * @returns {ParseResult}
 *
 * @typedef {object} ParseResult
 * @property {object|null} model     null only when nothing could be read
 * @property {Fatal|null} fatal     a syntax error, with a position
 * @property {Array} findings    coercions and structural complaints
 *
 * @typedef {object} Fatal
 * @property {string} message
 * @property {number|null} line     1-indexed
 * @property {number|null} column
 * @property {string} snippet       three source lines around the position
 *
 * Parse never throws. Errors become a fatal or findings. A malformed block
 * is kept in the model with __error set, so the renderer can draw an error
 * card and the page still renders.
 */
export function parse(text, opts = {}) {
  const findings = [];
  const format = opts?.format || 'auto';

  if (typeof text !== 'string') {
    return { model: null, fatal: makeFatal('There is no text to read: the document must be JSON or YAML text.', null, null, ''), findings };
  }

  let raw;
  let fatal = null;

  if (format === 'auto') {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      raw = parseJson(text, (msg, line, col) => {
        fatal = makeFatal(msg, line, col, text);
      });
    } else {
      raw = parseYamlSync(text, (msg, line, col) => {
        fatal = makeFatal(msg, line, col, text);
      });
    }
  } else if (format === 'json') {
    raw = parseJson(text, (msg, line, col) => {
      fatal = makeFatal(msg, line, col, text);
    });
  } else if (format === 'yaml') {
    raw = parseYamlSync(text, (msg, line, col) => {
      fatal = makeFatal(msg, line, col, text);
    });
  }

  if (fatal) {
    return { model: null, fatal, findings };
  }

  if (!raw || typeof raw !== 'object') {
    fatal = makeFatal('Document must be a JSON object or YAML mapping', null, null, text);
    return { model: null, fatal, findings };
  }

  let doc = raw;
  if (doc.dossier === undefined) {
    if (doc.pages && Array.isArray(doc.pages) && doc.version !== undefined) {
      findings.push({
        level: 'info',
        message: 'Bare document normalised to {dossier: {...}}',
        path: '',
        page: null,
        rule: null,
      });
      doc = { dossier: doc };
    } else {
      fatal = makeFatal('Document must have a "dossier" key or be a bare document with "pages"', null, null, text);
      return { model: null, fatal, findings };
    }
  }

  const model = { dossier: doc.dossier };

  applyAliases(model, findings);
  coerceNumericStrings(model, findings);
  coerceSingleToArray(model, findings);
  deleteSuppliedDerived(model, findings);

  // Anything derive() had to skip (a null block, a log source that is not
  // text) comes back as a finding, never as an exception.
  derive(model, findings);

  return { model, fatal: null, findings };
}

function parseJson(text, onError) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = e.message.match(/position (\d+)/);
    if (match) {
      const pos = parseInt(match[1], 10);
      const lines = text.substring(0, pos).split('\n');
      const line = lines.length;
      const col = lines[lines.length - 1].length + 1;
      onError(e.message, line, col);
    } else {
      onError(e.message, null, null);
    }
    return null;
  }
}

function parseYamlSync(text, onError) {
  if (!yamlLoaded) {
    onError('YAML parsing requires js-yaml. JSON works without network.', null, null);
    return null;
  }

  if (!yamlModule) {
    onError('YAML module not yet loaded', null, null);
    return null;
  }

  try {
    return yamlModule.load(text);
  } catch (e) {
    if (e.mark) {
      onError(e.message, e.mark.line + 1, e.mark.column + 1);
    } else {
      onError(e.message, null, null);
    }
    return null;
  }
}

let yamlPromise = null;

/**
 * Load the YAML parser, once. Nothing loads it at boot: it is fetched only
 * when non-JSON text actually reaches `parse` (js-yaml is a quarter of the
 * site's scripts, and most visits never read YAML). Every path that can hand
 * `parse` YAML awaits this first, gated on `needsYaml`. Concurrent callers
 * share one promise; a failed import clears it, so a later call retries.
 *
 * @returns {Promise<void>}
 */
export function initYaml() {
  if (yamlLoaded) return Promise.resolve();
  if (!yamlPromise) {
    yamlPromise = import('./vendor/js-yaml.mjs')
      .then((mod) => {
        yamlModule = mod;
        yamlLoaded = true;
      })
      .catch((e) => {
        yamlPromise = null;
        console.error('Failed to load YAML module:', e);
      });
  }
  return yamlPromise;
}

/** True once the YAML parser is in, so `parse` reads YAML synchronously. */
export function yamlReady() {
  return yamlLoaded;
}

/**
 * True when `parse` would read this text as YAML: it is not empty and does
 * not open as JSON. Mirrors the auto branch in `parse`.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function needsYaml(text) {
  return typeof text === 'string' && Boolean(text.trim()) && !/^\s*[{[]/.test(text);
}

function makeFatal(message, line, col, text) {
  let snippet = '';
  if (line !== null && text) {
    const lines = text.split('\n');
    const start = Math.max(0, line - 2);
    const end = Math.min(lines.length, line + 1);
    snippet = lines.slice(start, end).join('\n');
  }

  return {
    message,
    line,
    column: col,
    snippet,
  };
}

/**
 * Rename accepted spellings to the field that declares them, and only there.
 *
 * The first version renamed a key at any depth of the block using one flat
 * map per block type. That was harmless while every alias was unique to its
 * block, and wrong the moment one was not: `steps` accepts `label` for an
 * item's `title`, and the evidence items every block carries have a `label`
 * of their own, so a steps block's evidence would have lost its labels. The
 * walk now follows the registry: a field's spellings apply inside the object
 * that field belongs to, and nowhere else.
 */
function applyAliases(model, findings) {
  function renameIn(value, fields, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !fields) return;

    for (const [name, def] of Object.entries(fields)) {
      for (const alt of def?.accepts || []) {
        if (alt === name || value[alt] === undefined || value[name] !== undefined) continue;
        value[name] = value[alt];
        delete value[alt];
        findings.push({
          level: 'info',
          message: `Renamed "${alt}" to "${name}"`,
          path,
          page: null,
          rule: null,
        });
      }
    }

    for (const [name, def] of Object.entries(fields)) {
      const child = value[name];
      if (!def || child === undefined || child === null) continue;
      if (def.type === 'object') renameIn(child, def.fields, `${path}.${name}`);
      if (def.type !== 'array' || !Array.isArray(child)) continue;
      if (def.of && typeof def.of === 'object' && def.of.type === 'object') {
        child.forEach((item, i) => renameIn(item, def.of.fields, `${path}.${name}[${i}]`));
      } else if (def.of === 'block') {
        // A grid's children are blocks with their own spellings.
        child.forEach((item, i) => renameIn(item, blockDef(item?.type)?.fields, `${path}.${name}[${i}]`));
      }
    }
  }

  if (model.dossier?.pages && Array.isArray(model.dossier.pages)) {
    for (let pi = 0; pi < model.dossier.pages.length; pi++) {
      const page = model.dossier.pages[pi];
      if (page?.blocks && Array.isArray(page.blocks)) {
        for (let bi = 0; bi < page.blocks.length; bi++) {
          const block = page.blocks[bi];
          const def = blockDef(block?.type);
          if (def) renameIn(block, def.fields, `dossier.pages[${pi}].blocks[${bi}]`);
        }
      }
    }
  }
}

function coerceNumericStrings(model, findings) {
  function walk(value, path, blockType, fieldName) {
    if (!value || typeof value !== 'object') return;

    const def = blockDef(blockType);
    const fields = def?.fields || {};
    const fieldDef = fields[fieldName];

    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        walk(item, `${path}[${i}]`, blockType, fieldName);
      });
    } else {
      for (const [k, v] of Object.entries(value)) {
        const nextFieldDef = fieldDef?.fields?.[k] || fieldDef?.of?.fields?.[k];

        if (typeof v === 'string' && (nextFieldDef?.type === 'number' || nextFieldDef?.type === 'integer')) {
          const num = parseFloat(v);
          if (!isNaN(num)) {
            if (nextFieldDef?.type === 'integer') {
              value[k] = Math.trunc(num);
            } else {
              value[k] = num;
            }
            findings.push({
              level: 'info',
              message: `Coerced string "${v}" to number`,
              path: `${path}.${k}`,
              page: null,
              rule: null,
            });
          }
        }

        walk(v, `${path}.${k}`, blockType, k);
      }
    }
  }

  if (model.dossier?.pages && Array.isArray(model.dossier.pages)) {
    for (let pi = 0; pi < model.dossier.pages.length; pi++) {
      const page = model.dossier.pages[pi];
      if (page?.blocks && Array.isArray(page.blocks)) {
        for (let bi = 0; bi < page.blocks.length; bi++) {
          const block = page.blocks[bi];
          const blockType = block?.type;
          const blockPath = `dossier.pages[${pi}].blocks[${bi}]`;
          if (blockType) {
            walk(block, blockPath, blockType, null);
          }
        }
      }
    }
  }
}

function coerceSingleToArray(model, findings) {
  function walkBlock(block, blockType, blockPath, fields) {
    if (!block || typeof block !== 'object') return;

    const def = blockDef(blockType);
    const blockFields = def?.fields || {};

    for (const [k, v] of Object.entries(block)) {
      const fieldDef = blockFields[k];
      if (fieldDef?.type === 'array' && !Array.isArray(v) && v !== undefined && v !== null) {
        block[k] = [v];
        findings.push({
          level: 'info',
          message: `Coerced single value to array for field "${k}"`,
          path: `${blockPath}.${k}`,
          page: null,
          rule: null,
        });
      }
    }
  }

  if (model.dossier?.pages && Array.isArray(model.dossier.pages)) {
    for (let pi = 0; pi < model.dossier.pages.length; pi++) {
      const page = model.dossier.pages[pi];
      if (page?.blocks && Array.isArray(page.blocks)) {
        for (let bi = 0; bi < page.blocks.length; bi++) {
          const block = page.blocks[bi];
          const blockType = block?.type;
          const blockPath = `dossier.pages[${pi}].blocks[${bi}]`;
          if (blockType) {
            walkBlock(block, blockType, blockPath);
          }
        }
      }
    }
  }
}

function deleteSuppliedDerived(model, findings) {
  if (model.dossier?.pages && Array.isArray(model.dossier.pages)) {
    for (let pi = 0; pi < model.dossier.pages.length; pi++) {
      const page = model.dossier.pages[pi];
      const pagePath = `dossier.pages[${pi}]`;

      if (page?.id !== undefined) {
        delete page.id;
        findings.push({
          level: 'warn',
          message: 'Page "id" is derived and supplied. It is ignored.',
          path: `${pagePath}.id`,
          page: null,
          rule: null,
        });
      }

      if (page?.blocks && Array.isArray(page.blocks)) {
        for (let bi = 0; bi < page.blocks.length; bi++) {
          const block = page.blocks[bi];
          const blockType = block?.type;
          const blockPath = `${pagePath}.blocks[${bi}]`;

          if (blockType) {
            const derived = derivedFields(blockType);
            for (const field of derived) {
              if (block[field] !== undefined) {
                delete block[field];
                findings.push({
                  level: 'warn',
                  message: `Block "${blockType}" field "${field}" is derived and supplied. It is ignored.`,
                  path: `${blockPath}.${field}`,
                  page: page?.title || null,
                  rule: null,
                });
              }
            }

            if (block.id !== undefined) {
              delete block.id;
              findings.push({
                level: 'warn',
                message: 'Block "id" is derived and supplied. It is ignored.',
                path: `${blockPath}.id`,
                page: page?.title || null,
                rule: null,
              });
            }
          }
        }
      }
    }
  }
}

export { derive };
