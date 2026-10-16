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
 * so instead of a blank column. The cap is checked against what is stored:
 * a Dossier document in JSON is kept as its author wrote it, and a converted
 * one is pretty-printed only while that fits, so a file under the limit the
 * drop zone states is never refused for the whitespace Dossier would add.
 *
 * Text that tries to be a Dossier document (JSON with a "dossier" key, YAML
 * that starts with `dossier:`) or a comparison file (`"dossierCompare":`) and
 * does not read is refused with the reader's reason, rather than kept as a
 * Text column that hides why.
 *
 * Also the way a report from the Reports view's library goes into a column
 * (`sourceFromReport`, `comparisonFromReport`, used by js/compare/bridge.js).
 */

import { detect } from '../adapters/index.js';
import { readText } from '../read.js';
import { initYaml } from '../parse.js';
import { notText, NOT_TEXT_MESSAGE, fileText } from '../text-check.js';
import {
  MAX_SOURCE_CHARS, LIMITS, PASSED_THROUGH_IDS, convertedNote, clampLine, isObj, newSet, addColumn,
} from './model.js';
import { isBundle } from './records.js';

const PASSED_THROUGH = new Set(PASSED_THROUGH_IDS);

/** The first line of a reader's message: js-yaml adds a code frame below it. */
const firstLine = (message) => String(message || '').split('\n')[0].trim();

/** Blank and comment lines, and one `---` document marker, before a YAML document. */
const YAML_LEAD = /^(?:[ \t]*(?:#[^\n]*)?\r?\n)*(?:---[^\n]*\r?\n)?(?:[ \t]*(?:#[^\n]*)?\r?\n)*/;

/**
 * True when the text's first meaningful line is `dossier:`, past blank and
 * comment lines and one `---` document marker: a YAML Dossier document.
 */
export function looksLikeDossierYaml(text) {
  const body = String(text || '').replace(/^\uFEFF/, '');
  return /^dossier[ \t]*:/.test(body.slice(YAML_LEAD.exec(body)[0].length));
}

/**
 * The document with its leading comments and marker blanked, line for line,
 * so the reader's line numbers still match the file. A leading `# comment`
 * would otherwise make the Markdown adapter read it as Markdown.
 */
function yamlBody(text) {
  const body = String(text).replace(/^\uFEFF/, '');
  const lead = YAML_LEAD.exec(body)[0];
  return '\n'.repeat((lead.match(/\n/g) || []).length) + body.slice(lead.length);
}

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
  // A PDF, an image or an archive is refused before anything detects it, so
  // it never becomes a Markdown or text column (js/text-check.js).
  if (notText(text)) {
    return { ok: false, message: label === 'Pasted text' ? NOT_TEXT_MESSAGE : `${label}: ${NOT_TEXT_MESSAGE}` };
  }

  if (/^\s*\{/.test(text)) {
    let jsonError = null;
    try {
      const value = JSON.parse(text);
      if (isBundle(value)) return { ok: true, bundle: value };
      if (isObj(value) && Object.prototype.hasOwnProperty.call(value, 'dossierCompare')) {
        return { ok: false, message: 'That looks like a Dossier comparison file, but it is not a comparison this version reads.' };
      }
    } catch (err) {
      jsonError = err;
    }
    // A comparison file cut short: say so, rather than keep it as text.
    if (jsonError && /"dossierCompare"\s*:/.test(text)) {
      return { ok: false, message: `That looks like a Dossier comparison file, but it could not be read: ${firstLine(jsonError.message) || 'no reason given'}` };
    }
  }

  const byName = kindFromName(label);
  const adapter = detect(text);
  if (byName === 'html' || adapter?.id === 'html') return source('html', label, text);
  if (byName === 'markdown') return source('markdown', label, text);

  // A YAML Dossier document. Checked before the adapters: a leading comment
  // line makes the Markdown adapter claim it.
  if ((!adapter || adapter.id === 'markdown') && looksLikeDossierYaml(text)) {
    await initYaml().catch(() => {});
    const read = readText(yamlBody(text));
    if (read.ok) return dossierSource(label, read.document);
    return { ok: false, message: `That looks like a Dossier document, but it could not be read: ${firstLine(read.fatal?.message) || 'no reason given'}` };
  }

  if (adapter && !PASSED_THROUGH.has(adapter.id) && adapter.toDossier) {
    const read = readText(text);
    if (!read.ok) return { ok: false, message: firstLine(read.fatal?.message) || `That looks like ${adapter.label}, but it could not be read.` };
    return dossierSource(label, read.document, convertedNote(adapter));
  }

  // A Dossier document: JSON always parses; YAML needs its parser loaded.
  if (!adapter) {
    const json = /^\s*[{[]/.test(text);
    if (!json) await initYaml().catch(() => {});
    const read = readText(text);
    // JSON is kept as the author wrote it: already under the cap, and read.
    if (read.ok) return json ? source('dossier', label, text) : dossierSource(label, read.document);
    if (/^\s*\{/.test(text) && /"dossier"\s*:/.test(text)) {
      return { ok: false, message: `That looks like a Dossier document, but it could not be read: ${firstLine(read.fatal?.message) || 'no reason given'}` };
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

/**
 * A converted document as a column source: pretty-printed while that fits
 * the cap, else on one line, else refused with a sentence that says the
 * converted form is what is too large. Never a source the model would drop.
 */
function dossierSource(label, document, note) {
  let json = JSON.stringify(document, null, 2);
  if (json.length > MAX_SOURCE_CHARS) json = JSON.stringify(document);
  if (json.length > MAX_SOURCE_CHARS) {
    return { ok: false, message: tooLargeMessage(json.length, `${label}, converted to a Dossier document,`) };
  }
  return source('dossier', label, json, note);
}

// ── A saved report into a column ─────────────────────────────────────────────

/**
 * A report from the Reports view (a stored, wrapped `{dossier: {...}}`
 * document) as a column source. An imported HTML report, one page holding
 * one embed with its markup, goes in as the HTML it was, so the column can
 * show its own layout; anything else goes in as the Dossier document.
 *
 * @returns {{ok: true, source: object, title: string}|{ok: false, message: string}}
 */
export function sourceFromReport(document) {
  const report = document?.dossier;
  if (!isObj(report) || !Array.isArray(report.pages)) return { ok: false, message: 'That report could not be read.' };
  const title = clampLine(report.title, LIMITS.name) || 'Untitled report';
  const page = report.pages.length === 1 ? report.pages[0] : null;
  const block = page && Array.isArray(page.blocks) && page.blocks.length === 1 ? page.blocks[0] : null;
  let out;
  if (block?.type === 'embed' && typeof block.html === 'string' && block.html.trim()) {
    out = { kind: 'html', name: title, text: block.html };
  } else {
    let text = JSON.stringify(document, null, 2);
    if (text.length > MAX_SOURCE_CHARS) text = JSON.stringify(document);
    out = { kind: 'dossier', name: title, text };
  }
  if (out.text.length > MAX_SOURCE_CHARS) {
    return {
      ok: false,
      message: `"${title}" is ${out.text.length.toLocaleString('en-US')} characters long, over the `
        + `${MAX_SOURCE_CHARS.toLocaleString('en-US')} character limit for a column. Read it in the Reports view instead.`,
    };
  }
  return { ok: true, source: out, title };
}

/**
 * A new comparison starting from a report: column A holds it, labelled with
 * its title, and B is an empty slot. Both are "Other": nothing here knows who
 * wrote the report.
 *
 * @returns {{ok: true, set: object, title: string, emptyId: string}|{ok: false, message: string}}
 */
export function comparisonFromReport(document) {
  const read = sourceFromReport(document);
  if (!read.ok) return read;
  let set = newSet({ title: read.title });
  set = addColumn(set, { role: 'other', label: read.title, source: read.source }).set;
  const added = addColumn(set, { role: 'other' });
  return { ok: true, set: added.set, title: read.title, emptyId: added.id };
}

/** Read a File (from a picker or a drop). */
export async function readFile(file) {
  if (!file) return { ok: false, message: 'No file was given.' };
  if (file.size > MAX_SOURCE_CHARS * 4) {
    return { ok: false, message: tooLargeMessage(file.size, file.name) };
  }
  let text = '';
  try {
    // UTF-16 by its byte order mark, UTF-8 otherwise: `file.text()` read a
    // UTF-16 report as UTF-8 full of NULs, which is refused as binary.
    text = await fileText(file);
  } catch {
    return { ok: false, message: `${file.name} could not be read.` };
  }
  return readSource(text, file.name);
}
