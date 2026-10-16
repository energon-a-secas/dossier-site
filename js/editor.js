/**
 * Raw JSON/YAML editor with non-destructive error reporting.
 *
 * A parse error never destroys the last good render: the error appears as a
 * banner while the last valid model stays on screen, dimmed. Tab indents,
 * Shift+Tab dedents, Escape then Tab arms the keyboard trap escape, and a
 * format action reserialises with stable key order.
 */

import { parse } from './parse.js';

/**
 * Create an editor container with textarea and controls.
 *
 * @param {string} sourceText initial JSON/YAML source
 * @param {object} opts configuration
 *   - onChange(result) called when parsing completes, with { model, fatal, findings }
 *   - onFormat() called by the toolbar's Format button. The caller formats
 *     the authored document through js/source-pane.js formatCurrent, the
 *     one Format in the app.
 *   - autoSave(text) called after a valid edit is parsed
 * @returns {HTMLElement} the editor container
 */
export function createEditor(sourceText = '', opts = {}) {
  const {
    onChange = () => {},
    onFormat = () => {},
    autoSave = () => {},
  } = opts;

  const container = document.createElement('div');
  container.className = 'editor-container';

  const toolbar = document.createElement('div');
  toolbar.className = 'editor-toolbar';
  container.appendChild(toolbar);

  const formatBtn = document.createElement('button');
  formatBtn.type = 'button';
  formatBtn.className = 'editor-format-btn';
  formatBtn.textContent = 'Format';
  formatBtn.addEventListener('click', () => {
    onFormat();
  });
  toolbar.appendChild(formatBtn);

  const errorBanner = document.createElement('div');
  errorBanner.className = 'editor-error-banner hidden';
  container.appendChild(errorBanner);

  const textarea = document.createElement('textarea');
  textarea.className = 'editor-textarea';
  textarea.setAttribute('aria-label', 'Report source, JSON or YAML');
  // The attribute, not the property: `spellcheck = 'false'` assigns a
  // non-empty string to a boolean property, which turns spellcheck on.
  textarea.setAttribute('spellcheck', 'false');
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('autocomplete', 'off');
  textarea.value = sourceText;
  container.appendChild(textarea);

  let lastGoodModel = null;
  let escapeArmed = false;
  let parseTimer = null;

  function parseAndSave() {
    clearTimeout(parseTimer);
    parseTimer = null;
    const text = textarea.value;
    const result = parse(text);

    if (result.model) {
      lastGoodModel = result.model;
    }

    errorBanner.classList.toggle('hidden', !result.fatal);
    if (result.fatal) {
      const line = result.fatal.line ? `Line ${result.fatal.line}` : 'Parse error';
      const col = result.fatal.column ? `, column ${result.fatal.column}` : '';
      errorBanner.textContent = `${line}${col}. ${result.fatal.message}`;
      errorBanner.classList.add('error');
    }

    onChange({
      model: result.model || lastGoodModel,
      fatal: result.fatal,
      findings: result.findings,
    });
    if (!result.fatal) autoSave(text);
  }

  function scheduleParse() {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(parseAndSave, 200);
  }

  textarea.addEventListener('input', scheduleParse);
  // Commit the pending edit before a click opens another report or form.
  textarea.addEventListener('blur', () => {
    if (parseTimer !== null) parseAndSave();
  });

  textarea.addEventListener('keydown', (e) => {
    const { key, shiftKey, ctrlKey, metaKey } = e;

    if (key === 'Escape') {
      if (!escapeArmed) {
        escapeArmed = true;
        e.preventDefault();
        const announce = document.createElement('div');
        announce.setAttribute('role', 'status');
        announce.setAttribute('aria-live', 'polite');
        announce.className = 'sr-only';
        announce.textContent = 'Press Tab to exit editor';
        document.body.appendChild(announce);
        setTimeout(() => announce.remove(), 1000);
        return;
      } else {
        escapeArmed = false;
      }
    }

    if (escapeArmed && key === 'Tab') {
      escapeArmed = false;
      // Let the browser move focus out of the editor in the requested direction.
      return;
    }

    if (key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = textarea.value.substring(0, start);
      const after = textarea.value.substring(end);
      const indent = shiftKey ? '' : '  ';

      if (start === end) {
        const lineStart = before.lastIndexOf('\n') + 1;
        const lineText = before.substring(lineStart);

        if (shiftKey) {
          const dedentMatch = lineText.match(/^( {2}|\t)/);
          if (dedentMatch) {
            const dedented = before.substring(0, lineStart) + lineText.substring(dedentMatch[0].length);
            textarea.value = dedented + after;
            textarea.selectionStart = textarea.selectionEnd = dedented.length;
          }
        } else {
          const indented = before + indent + after;
          textarea.value = indented;
          textarea.selectionStart = textarea.selectionEnd = before.length + indent.length;
        }
      } else {
        const startLine = textarea.value.lastIndexOf('\n', start - 1) + 1;
        const beforeLines = textarea.value.substring(0, startLine);
        const selectedLines = textarea.value.substring(startLine, end);
        const afterLines = textarea.value.substring(end);

        const lines = selectedLines.split('\n');
        const processedLines = shiftKey
          ? lines.map((line) => line.replace(/^( {2}|\t)/, ''))
          : lines.map((line) => indent + line);

        textarea.value = beforeLines + processedLines.join('\n') + afterLines;
        textarea.selectionStart = startLine;
        textarea.selectionEnd = startLine + processedLines.join('\n').length;
      }

      scheduleParse();
    }
  });

  // The caller needs to push text in as well as read it: a report opened from
  // a share link, the library or a template has to appear in the editor, and
  // setting the value must not re-enter the parse that produced it.
  container.getValue = () => textarea.value;
  container.setValue = (next) => {
    if (typeof next !== 'string') return;
    clearTimeout(parseTimer);
    parseTimer = null;
    if (next === textarea.value) return;
    textarea.value = next;
    lastGoodModel = null;
    errorBanner.classList.add('hidden');
  };
  container.focusEditor = () => textarea.focus();
  return container;
}

/**
 * Format and serialize a model to JSON with stable key order.
 *
 * @param {object} model the document model
 * @returns {string} formatted JSON
 */
export function formatJson(model) {
  const sortKeys = (obj) => {
    if (Array.isArray(obj)) return obj.map(sortKeys);
    if (obj !== null && typeof obj === 'object') {
      const sorted = {};
      for (const key of Object.keys(obj).sort()) {
        sorted[key] = sortKeys(obj[key]);
      }
      return sorted;
    }
    return obj;
  };

  return JSON.stringify(sortKeys(model), null, 2);
}
