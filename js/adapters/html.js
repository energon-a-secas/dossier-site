/**
 * Preserve a complete HTML artifact, including its head, styles and SVGs.
 *
 * Two decisions are made here and both used to be made badly.
 *
 * Whether the report needs its scripts: a regex for `<script` or ` on...=`
 * fired on a `<script type="application/ld+json">`, on the words "onboarding
 * = done" in a paragraph and on a code sample showing a script tag, and every
 * false positive opened the report in the interactive host instead of the
 * static one. DOMParser builds an inert tree (nothing runs, nothing loads), so
 * the question becomes the real one: is there an executable script element,
 * or an element carrying an on* handler attribute. Node has no DOMParser, so
 * the tests and the CLI fall back to a tag-aware pattern.
 *
 * Whether it is too large: over HTML_MAX_CHARS the import is refused by
 * throwing the size sentence, instead of producing a document every reader of
 * which would refuse it later, one of them by showing a blank frame. It throws
 * rather than returning `{document: null}` because the Open dialog treats a
 * null document as "not this format" and falls through to the JSON and YAML
 * parser, which replaced the sentence with "Document must be a JSON object".
 * readText catches adapter errors and shows the message as written.
 */

import { HTML_MAX_CHARS, htmlTooLargeMessage } from '../embed-policy.js';

/** Script types a browser executes. Anything else (ld+json, a template) is data. */
const EXECUTABLE = new Set(['', 'module', 'text/javascript', 'application/javascript',
  'text/ecmascript', 'application/ecmascript', 'text/jscript', 'text/livescript']);

export function toDossier(source) {
  if (typeof source !== 'string' || !source.trim()) return { document: null, findings: [] };

  if (source.length > HTML_MAX_CHARS) {
    // readText appends its own full stop after the reason.
    throw new Error(htmlTooLargeMessage(source.length).replace(/\.$/, ''));
  }

  const parsed = parseInert(source);
  const title = ((parsed && (parsed.querySelector('title')?.textContent || parsed.querySelector('h1')?.textContent))
    || 'Imported HTML report').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Imported HTML report';
  const scripts = parsed ? hasScripts(parsed) : hasScriptsByPattern(source);

  return {
    document: {
      dossier: {
        version: 1,
        title,
        subtitle: 'Imported HTML · original layout',
        pages: [{
          title: 'HTML report',
          blocks: [{ type: 'embed', html: source, scripts }],
        }],
      },
    },
    findings: [],
  };
}

/** An inert document, or null where there is no DOMParser (Node). */
function parseInert(source) {
  if (typeof DOMParser === 'undefined') return null;
  try {
    return new DOMParser().parseFromString(source, 'text/html');
  } catch {
    return null;
  }
}

/** True when the parsed report has an executable script or an inline handler. */
export function hasScripts(doc) {
  for (const el of doc.querySelectorAll('script')) {
    const type = (el.getAttribute('type') || '').trim().toLowerCase().split(';')[0];
    if (EXECUTABLE.has(type)) return true;
  }
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of el.attributes) {
      if (/^on[a-z]/i.test(attr.name)) return true;
    }
  }
  return false;
}

/**
 * The Node fallback. Still tag-aware: a handler has to sit inside a tag, and a
 * script element whose type is a data type does not count.
 */
export function hasScriptsByPattern(source) {
  const text = String(source);
  for (const match of text.matchAll(/<script\b([^>]*)>/gi)) {
    const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(match[1]);
    if (!type || EXECUTABLE.has(type[1].toLowerCase().split(';')[0])) return true;
  }
  return /<[a-z][^<>]*\son[a-z]+\s*=/i.test(text);
}
