/**
 * What goes into a column: a file, a drop or pasted text, read into
 * `{kind, name, text, note?}` without touching anything else.
 *
 * HTML stays HTML and Markdown stays Markdown, because a column reads the
 * report as it was written. A Dossier document (JSON or YAML) stays Dossier.
 * Machine formats the Open dialog converts (JUnit, SARIF, CTRF, Lighthouse,
 * git numstat, commit logs) are converted the same way here, through the
 * pure `readText` of js/open.js, and stored as the Dossier document they
 * became, with a note naming what they were. Anything else is plain text.
 *
 * One cap for every source, 2,000,000 characters, with a sentence that says
 * so instead of a blank column.
 */

import { detect } from '../adapters/index.js';
import { readText } from '../open.js';
import { initYaml } from '../parse.js';
import { MAX_SOURCE_CHARS } from './model.js';
import { isBundle } from './records.js';

const PASSED_THROUGH = new Set(['html', 'markdown']);

/** The sentence for a source over the cap. */
export function tooLargeMessage(length, name = 'This report') {
  return `${name} is ${Number(length || 0).toLocaleString('en-US')} characters long, over the `
    + `${MAX_SOURCE_CHARS.toLocaleString('en-US')} character limit for a column. Open the file in its own browser tab, or split it into smaller reports.`;
}

function kindFromName(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  return null;
}

/**
 * Read text into a column source.
 *
 * @param {string} text
 * @param {string} [name] the file name, or "Pasted text"
 * @returns {Promise<{ok: true, source: object, bundle?: undefined}
 *   | {ok: true, bundle: object}
 *   | {ok: false, message: string}>}
 *   A comparison bundle is reported as `bundle` (the parsed value), so the
 *   caller can open it as a whole comparison rather than as one column.
 */
export async function readSource(text, name = 'Pasted text') {
  const label = String(name || 'Pasted text').slice(0, 200);
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, message: 'There was nothing to read in that.' };
  }
  if (text.length > MAX_SOURCE_CHARS) {
    return { ok: false, message: tooLargeMessage(text.length, label === 'Pasted text' ? 'That text' : label) };
  }

  if (/^\s*\{/.test(text)) {
    try {
      const value = JSON.parse(text);
      if (isBundle(value)) return { ok: true, bundle: value };
    } catch { /* not JSON: carry on */ }
  }

  const byName = kindFromName(label);
  const adapter = detect(text);
  if (byName === 'html' || adapter?.id === 'html') return source('html', label, text);
  if (byName === 'markdown') return source('markdown', label, text);

  if (adapter && !PASSED_THROUGH.has(adapter.id) && adapter.toDossier) {
    const read = readText(text);
    if (!read.ok) return { ok: false, message: read.fatal?.message || `That looks like ${adapter.label}, but it could not be read.` };
    return source('dossier', label, JSON.stringify(read.document, null, 2), `Converted from ${adapter.label}`);
  }

  // A Dossier document: JSON always parses; YAML needs its parser loaded.
  if (!adapter) {
    if (!/^\s*[{[]/.test(text)) await initYaml().catch(() => {});
    const read = readText(text);
    if (read.ok) return source('dossier', label, JSON.stringify(read.document, null, 2));
    if (/^\s*\{/.test(text) && /"dossier"\s*:/.test(text)) {
      return { ok: false, message: `That looks like a Dossier document, but it could not be read: ${read.fatal?.message || 'no reason given'}` };
    }
  }

  if (adapter?.id === 'markdown') return source('markdown', label, text);
  return source('text', label, text);
}

function source(kind, name, text, note) {
  const out = { kind, name, text };
  if (note) out.note = note;
  return { ok: true, source: out };
}

/** Read a File (from a picker or a drop). */
export async function readFile(file) {
  if (!file) return { ok: false, message: 'No file was given.' };
  if (file.size > MAX_SOURCE_CHARS * 4) {
    return { ok: false, message: tooLargeMessage(file.size, file.name) };
  }
  let text = '';
  try {
    text = await file.text();
  } catch {
    return { ok: false, message: `${file.name} could not be read.` };
  }
  return readSource(text, file.name);
}
