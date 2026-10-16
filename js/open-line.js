/**
 * The Open dialog's line: what the text in the dialog will open as, or why
 * it will not, as the reader types or chooses a file, and the error state
 * that line and the paste box share. Split from js/open.js, which re-exports
 * these names.
 *
 * DOM-free apart from the elements it is handed; Node imports it.
 */

import { detect } from './adapters/index.js';
import { htmlHasScripts } from './adapters/html.js';
import { HTML_MAX_CHARS, htmlTooLargeMessage, reportTooLargeMessage } from './embed-policy.js';
import { notText, NOT_TEXT_MESSAGE } from './text-check.js';
import { plainFatal } from './read.js';

/** The size sentence for text with no file name. */
export function tooLargeSentence(text) {
  return /^\s*</.test(text) ? htmlTooLargeMessage(text.length) : reportTooLargeMessage(text.length, 'That text');
}

/**
 * Say what the Open dialog holds, as the reader types or chooses a file:
 * what it will open as, or why it will not open, marked as an error then
 * (`markDetected`). Broken or truncated JSON used to be described as "Looks
 * like a Dossier document.", and the parser's own message then showed in the
 * same colour as a success.
 */
export function describeDetected(els, text) {
  if (!els.importDetected) return;
  if (!text || !text.trim()) {
    markDetected(els, '');
    return;
  }
  // Over the cap or binary: refused before it is detected or parsed.
  if (text.length > HTML_MAX_CHARS) {
    markDetected(els, tooLargeSentence(text), true);
    return;
  }
  if (notText(text)) {
    markDetected(els, NOT_TEXT_MESSAGE, true);
    return;
  }
  const adapter = detect(text);
  if (adapter?.bundle) {
    markDetected(els, 'A Dossier comparison. It opens in the Compare view.');
    return;
  }
  if (adapter) {
    markDetected(els, adapter.id === 'html' ? htmlSentence(text) : `Looks like ${adapter.label}. It will be turned into a report.`);
    return;
  }
  if (/^\s*[[{]/.test(text)) {
    let value = null;
    try {
      value = JSON.parse(text);
    } catch {
      markDetected(els, 'This JSON is not complete yet, or has a syntax error.', true);
      return;
    }
    const dossier = value && typeof value === 'object'
      && ((value.dossier && typeof value.dossier === 'object') || Array.isArray(value.pages));
    if (!dossier) {
      markDetected(els, plainFatal({ message: 'Document must have a "dossier" key' }, text), true);
      return;
    }
  }
  markDetected(els, 'Looks like a Dossier document.');
}

/**
 * Write the Open dialog's line, and mark it and the paste box as an error or
 * not. Every call clears the last state first, so typing a valid document
 * after a broken one clears both. The error state is `data-state="error"` on
 * the line (css/shell.css) and `aria-invalid` on the paste box.
 *
 * @param {{importDetected?: object, importText?: object}} els
 * @param {string} text
 * @param {boolean} [isError]
 */
export function markDetected(els, text, isError = false) {
  const line = els.importDetected;
  if (!line) return;
  line.textContent = text;
  if (line.dataset) {
    if (isError) line.dataset.state = 'error';
    else delete line.dataset.state;
  }
  const area = els.importText;
  if (area?.setAttribute) {
    if (isError) area.setAttribute('aria-invalid', 'true');
    else area.removeAttribute?.('aria-invalid');
  }
}

let lastHtml = { text: null, sentence: '' };

/**
 * What opening this HTML does now: a static copy in its own layout, with
 * nothing in it running. The old sentence promised "inline controls enabled"
 * for every HTML file, which stopped being true when imports became static by
 * default. Over the size cap it is the refusal itself, before Open is
 * pressed. One entry of memory, because this runs on every keystroke in the
 * paste box and a large report is parsed to find its scripts.
 *
 * @param {string} text
 * @returns {string}
 */
export function htmlSentence(text) {
  if (text.length > HTML_MAX_CHARS) return htmlTooLargeMessage(text.length);
  if (lastHtml.text === text) return lastHtml.sentence;
  const sentence = htmlHasScripts(text)
    ? 'HTML report. It opens as a static copy in its own layout, with its scripts off. You can run them from the report.'
    : 'HTML report. It opens as a static copy in its own layout. You can also read it in Dossier format.';
  lastHtml = { text, sentence };
  return sentence;
}
