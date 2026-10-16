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

const FALLBACK_TITLE = 'Imported HTML report';

const BASE = /<base\b[^>]*>/gi;

export function toDossier(source) {
  if (typeof source !== 'string' || !source.trim()) return { document: null, findings: [] };

  if (source.length > HTML_MAX_CHARS) {
    // readText appends its own full stop after the reason.
    throw new Error(htmlTooLargeMessage(source.length).replace(/\.$/, ''));
  }

  const parsed = parseInert(source);
  const named = ((parsed && (parsed.querySelector('title')?.textContent || parsed.querySelector('h1')?.textContent)) || '')
    .replace(/\s+/g, ' ').trim().slice(0, 120);
  const title = named || FALLBACK_TITLE;
  const scripts = parsed ? hasScripts(parsed) : hasScriptsByPattern(source);

  return {
    document: {
      dossier: {
        version: 1,
        title,
        // Neutral on purpose: the reader switches between the original layout
        // and Dossier format, and a subtitle that named one view was wrong
        // in the other. Left out when the title already says it.
        ...(named ? { subtitle: FALLBACK_TITLE } : {}),
        pages: [{
          title: 'HTML report',
          blocks: [{ type: 'embed', html: source, scripts }],
        }],
      },
    },
    findings: [],
  };
}

/**
 * An inert document, or null where there is no DOMParser (Node).
 *
 * A `<base>` is taken out first. Even in a DOMParser document this page's
 * policy (`base-uri`) refuses it and logs a CSP violation on every import,
 * and nothing read here needs it. The stored source keeps it: the static
 * copy drops it again (js/compare/frame.js), and the source is the author's.
 */
function parseInert(source) {
  if (typeof DOMParser === 'undefined') return null;
  try {
    return new DOMParser().parseFromString(String(source).replace(BASE, ''), 'text/html');
  } catch {
    return null;
  }
}

/**
 * Whether an HTML source has scripts a reader could run, decided the same way
 * the import decides it, so what the Open dialog promises is what opens.
 *
 * @param {string} source
 * @returns {boolean}
 */
export function htmlHasScripts(source) {
  const parsed = parseInert(source);
  return parsed ? hasScripts(parsed) : hasScriptsByPattern(source);
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
