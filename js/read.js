/**
 * Reading a report, with no side effects: the pure half of js/open.js.
 *
 * `readText` detects the format, converts it, parses it and validates it,
 * and touches no state, so a failed import can never replace what is on
 * screen and another view (a Compare column) can read a file without opening
 * it. `readRecord` reads a record from the library the same way. js/open.js
 * commits what these return, and re-exports both, so callers that import them
 * from there keep working.
 *
 * DOM-free apart from what an adapter asks for (the HTML adapter uses
 * DOMParser when there is one). Node imports this.
 */

import { parse } from './parse.js';
import { validate } from './validate.js';
import { detect } from './adapters/index.js';
import { authored } from './pipeline.js';
import { derivedFields } from './registry/index.js';

/**
 * Read any text the Open dialog accepts, with no side effects.
 *
 * @param {string} text
 * @returns {{ok: boolean, document: object|null, model: object|null,
 *   findings: Array, label: string|null, adapter: string|null,
 *   fatal: object|null, text: string}}
 *   `document` is the authored document, `model` the derived one, `text` the
 *   source to show in the editor, `label` the format name when an adapter
 *   converted it (null for a Dossier document).
 */
export function readText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return failed(String(text || ''), 'There was nothing to read in that.', null);
  }

  const adapter = detect(text);
  if (adapter && adapter.toDossier) {
    let converted = null;
    try {
      converted = adapter.toDossier(text);
    } catch (err) {
      return failed(text, `This looks like ${adapter.label}, but it could not be converted: ${err && err.message ? err.message : 'no reason given'}.`, adapter);
    }
    if (converted && converted.document) {
      const read = parsed(JSON.stringify(converted.document, null, 2), adapter);
      if (read.ok) read.findings = [...read.findings, ...(converted.findings || [])];
      return read;
    }
  }
  return parsed(text, null);
}

function parsed(text, adapter) {
  const result = parse(text, { format: 'auto' });
  if (result.fatal || !result.model) {
    const fatal = result.fatal || {
      message: 'The document could not be read, and the reader gave no reason.',
      line: null,
      column: null,
      snippet: '',
    };
    return { ...failed(text, fatal.message, adapter), fatal, findings: result.findings || [] };
  }
  return {
    ok: true,
    document: authored(result.model),
    model: result.model,
    findings: [...(result.findings || []), ...validate(result.model)],
    label: adapter ? adapter.label : null,
    adapter: adapter ? adapter.id : null,
    fatal: null,
    text,
  };
}

function failed(text, message, adapter) {
  return {
    ok: false,
    document: null,
    model: null,
    findings: [],
    label: adapter ? adapter.label : null,
    adapter: adapter ? adapter.id : null,
    fatal: { message, line: null, column: null, snippet: '' },
    text,
  };
}

/**
 * Whether a stored document still carries a field that is derived, in the
 * places parse.js strips one from: a page id, a block id, or a field the
 * block's registry entry marks derived. Decided from the document's shape
 * rather than from a warning's wording, so rewording a message cannot quietly
 * stop old records from being rewritten.
 *
 * @param {object} document a stored, wrapped `{dossier: {...}}` document
 * @returns {boolean}
 */
export function carriesDerived(document) {
  const pages = document?.dossier?.pages;
  if (!Array.isArray(pages)) return false;
  return pages.some((page) => {
    if (!page || typeof page !== 'object') return false;
    if (supplies(page, 'id')) return true;
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    return blocks.some((block) => {
      if (!block || typeof block !== 'object') return false;
      if (supplies(block, 'id')) return true;
      return typeof block.type === 'string'
        && derivedFields(block.type).some((field) => supplies(block, field));
    });
  });
}

function supplies(obj, field) {
  return Object.prototype.hasOwnProperty.call(obj, field) && obj[field] !== undefined;
}

/**
 * Read a stored record. A record saved before stored documents were
 * authored-only still carries derived ids, and parse.js warns about each one.
 * Such a record is read a second time from its authored document, so the
 * editor and the findings show the clean version, and `stale` tells the
 * caller to save it once so the record itself is rewritten.
 *
 * @param {{document: object}} record
 * @returns {{read: object, stale: boolean}}
 */
export function readRecord(record) {
  const read = readText(JSON.stringify(record.document, null, 2));
  if (!read.ok || !carriesDerived(record.document)) return { read, stale: false };
  const clean = readText(JSON.stringify(read.document, null, 2));
  return clean.ok ? { read: clean, stale: true } : { read, stale: false };
}
