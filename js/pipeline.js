/**
 * The one path from text to a rendered report.
 *
 * Every entry point goes through here: the editor on a keystroke, a dropped
 * file, a template, a share link, an adapter. One path means the findings
 * panel, the outline and the claim count cannot be computed from a different
 * document than the one on screen.
 *
 * The rule that shapes this file: a parse failure is never destructive. The
 * last model that parsed stays on screen, dimmed, with the error beside it.
 * In a live editing tool that is the most travelled error path there is, and
 * replacing the reader's report with a red message on every mistyped bracket
 * is the behaviour this avoids.
 */

import { parse } from './parse.js';
import { validate, claimAudit } from './validate.js';
import { renderReport, outline, reportOf } from './render/index.js';

/**
 * Parse text into the state, without rendering.
 * @returns {{ok: boolean, fatal: object|null}}
 */
export function applyText(state, text) {
  const result = parse(text, { format: 'auto' });
  state.sourceText = text;

  if (result.fatal || !result.model) {
    // Keep whatever last worked. state.model is untouched on purpose.
    state.fatal = result.fatal || {
      message: 'The document could not be read, and the reader gave no reason.',
      line: null,
      column: null,
      snippet: '',
    };
    state.findings = result.findings || [];
    return { ok: false, fatal: state.fatal };
  }

  state.fatal = null;
  state.model = result.model;
  state.lastGood = result.model;
  state.document = result.model;
  state.findings = [...(result.findings || []), ...validate(result.model)];

  const pages = reportOf(result.model)?.pages || [];
  if (!state.page || !pages.some((p) => p.id === state.page)) {
    state.page = pages[0]?.id || null;
  }
  return { ok: true, fatal: null };
}

/**
 * Take a result js/editor.js already produced.
 *
 * The editor parses on a debounce and hands the result over. Parsing it again
 * here would double the work on every keystroke, and the earlier version did
 * worse than that: it re-parsed `state.sourceText`, which is undefined before
 * the first open, so the first keystroke threw inside parse.
 */
export function applyParsed(state, result, text) {
  if (typeof text === 'string') state.sourceText = text;

  if (!result || (result.fatal && !result.model)) {
    state.fatal = (result && result.fatal) || null;
    state.findings = (result && result.findings) || [];
    return { ok: false, fatal: state.fatal };
  }

  state.fatal = result.fatal || null;
  if (result.model) {
    state.model = result.model;
    state.lastGood = result.model;
    state.document = result.model;
  }
  state.findings = [...(result.findings || []), ...validate(state.model)];

  const pages = reportOf(state.model)?.pages || [];
  if (!state.page || !pages.some((p) => p.id === state.page)) {
    state.page = pages[0]?.id || null;
  }
  return { ok: !state.fatal, fatal: state.fatal };
}

/** The same, for a document that is already an object. */
export function applyDocument(state, document) {
  return applyText(state, JSON.stringify(document, null, 2));
}

/**
 * Draw the current state. Separate from parsing so the two can be debounced
 * independently: parsing is cheap and rendering a sixty row table is not.
 */
export function rerender(state, els) {
  const model = state.model || state.lastGood;
  const stage = els.stage;
  if (!stage) return;

  stage.setAttribute('aria-busy', 'true');

  if (!model) {
    stage.replaceChildren();
    document.body.classList.add('is-empty');
    stage.setAttribute('aria-busy', 'false');
    return;
  }

  document.body.classList.remove('is-empty');
  renderReport(model, stage, { page: state.page, interactive: true });

  // Dimmed while the source does not parse, so it is obvious that what is on
  // screen is the last good version rather than the current text.
  stage.classList.toggle('is-stale', Boolean(state.fatal));
  stage.setAttribute('aria-busy', 'false');

  if (els.outline) renderOutline(state, els.outline);
  if (els.findingsCount) updateFindingCount(state, els.findingsCount);
}

function renderOutline(state, host) {
  const model = state.model || state.lastGood;
  host.replaceChildren();
  const pages = outline(model);
  if (!pages.length) return;

  const list = document.createElement('ul');
  list.className = 'ds-outline';
  for (const page of pages) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#/${page.id}`;
    link.textContent = page.title || 'Untitled page';
    link.className = 'ds-outline__page';
    if (page.id === state.page) link.setAttribute('aria-current', 'page');
    li.appendChild(link);

    if (page.headings && page.headings.length) {
      const sub = document.createElement('ul');
      for (const heading of page.headings) {
        const subLi = document.createElement('li');
        const subLink = document.createElement('a');
        subLink.href = `#${heading.id || ''}`;
        subLink.textContent = heading.text || '';
        subLink.className = 'ds-outline__heading';
        subLi.appendChild(subLink);
        sub.appendChild(subLi);
      }
      li.appendChild(sub);
    }
    list.appendChild(li);
  }
  host.appendChild(list);
}

/**
 * The count a reader actually needs: how many findings, and how many claims
 * have nothing behind them. The second number is the product's spine.
 */
function updateFindingCount(state, el) {
  const serious = state.findings.filter((f) => f.level === 'error' || f.level === 'warn');
  el.textContent = String(serious.length);
  el.hidden = serious.length === 0;
  el.classList.toggle('is-error', state.findings.some((f) => f.level === 'error'));
}

/** The claim summary, for the header and for anything else that asks. */
export function claims(state) {
  const model = state.model || state.lastGood;
  if (!model) return null;
  try {
    return claimAudit(model);
  } catch {
    return null;
  }
}
