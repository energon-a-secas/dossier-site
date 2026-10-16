/**
 * The one path from text to a rendered report.
 *
 * Every entry point goes through here: the editor on a keystroke, a dropped
 * file, a template, a share link, an adapter. One path means the findings
 * panel and the outline cannot be computed from a different document than the
 * one on screen.
 *
 * The rule that shapes this file: a parse failure is never destructive. The
 * last model that parsed stays on screen, dimmed, with the error beside it.
 * In a live editing tool that is the most travelled error path there is, and
 * replacing the reader's report with a red message on every mistyped bracket
 * is the behaviour this avoids.
 *
 * Two shapes leave this module. `state.model` is the derived model the
 * renderer reads: page ids, block ids, deltas, totals. `state.document` is the
 * authored document, which is what gets saved, shared, exported and shown in
 * the editor. Saving the derived model made every reopen strip the derived
 * fields again, with one warning each.
 */

import { parse } from './parse.js';
import { validate } from './validate.js';
import { wasDerived, markDerived } from './derive.js';
import { renderReport, outline, reportOf } from './render/index.js';
import { routeFor } from './router.js';

// ── Authored versus derived ──────────────────────────────────────────────────

/**
 * The document as an author wrote it: a plain deep copy with every field that
 * js/derive.js computed left out. Accepts a derived model or a plain document;
 * a plain document comes back as an equal copy.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function authored(value) {
  if (Array.isArray(value)) return value.map(authored);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value)) {
    if (wasDerived(value, key)) continue;
    const child = value[key];
    // JSON drops undefined anyway. Dropping it here keeps a cleared form
    // field from surviving as a key in IndexedDB.
    if (child === undefined) continue;
    out[key] = authored(child);
  }
  return out;
}

/**
 * Copy the derived markers from the model onto an edited copy of it.
 *
 * The form editors build the next document with object spreads, and a spread
 * copies enumerable fields only. The derived page id survives the copy and
 * its marker does not, so `authored()` would keep the id and the next parse
 * would warn that the author supplied it. This walks both trees in step and
 * marks a field derived when the reference marked it and the value is
 * unchanged. A value the author edited stays authored.
 *
 * @param {object} next the edited document
 * @param {object} reference the model it was edited from
 * @returns {object} next, marked in place
 */
export function carryDerivedMarks(next, reference) {
  if (!next || !reference || typeof next !== 'object' || typeof reference !== 'object') return next;
  if (next === reference) return next;
  if (Array.isArray(next)) {
    if (Array.isArray(reference)) next.forEach((item, i) => carryDerivedMarks(item, reference[i]));
    return next;
  }
  for (const field of Array.isArray(reference.__derived) ? reference.__derived : []) {
    if (!(field in next) || wasDerived(next, field)) continue;
    if (JSON.stringify(next[field]) === JSON.stringify(reference[field])) markDerived(next, field);
  }
  for (const key of Object.keys(next)) carryDerivedMarks(next[key], reference[key]);
  return next;
}

// ── Into the state ───────────────────────────────────────────────────────────

/**
 * Put a model that parsed into the state. Every successful path ends here.
 *
 * @param {object} state
 * @param {{model: object, findings: Array, text?: string, document?: object}} parsed
 */
export function commitModel(state, { model, findings, text, document }) {
  if (typeof text === 'string') state.sourceText = text;
  state.fatal = null;
  state.model = model;
  state.lastGood = model;
  state.document = document || authored(model);
  state.findings = findings || [];

  const pages = reportOf(model)?.pages || [];
  if (!state.page || !pages.some((p) => p.id === state.page)) {
    state.page = pages[0]?.id || null;
  }
}

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

  commitModel(state, {
    model: result.model,
    findings: [...(result.findings || []), ...validate(result.model)],
  });
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

  // With a fatal error the editor hands over its last good model, which stays
  // on screen dimmed while the error is shown.
  if (result.model) {
    commitModel(state, {
      model: result.model,
      findings: [...(result.findings || []), ...validate(result.model)],
    });
  } else if (state.model) {
    state.findings = [...(result.findings || []), ...validate(state.model)];
  }
  state.fatal = result.fatal || null;
  return { ok: !state.fatal, fatal: state.fatal };
}

/**
 * The same, for a document that is already an object. The object may be a
 * derived model (a form edit, an inserted block): only its authored fields go
 * into the source text, so the editor never shows a derived id.
 */
export function applyDocument(state, document) {
  return applyText(state, JSON.stringify(authored(document), null, 2));
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/**
 * The report title's heading level on the page. The Header Kit bar carries
 * the site name as the page's h1 (its markup contract and its styles are keyed
 * on that h1), so the report title on screen is an h2. Exported files keep the
 * title as their h1.
 */
export const STAGE_TITLE_LEVEL = 2;

/**
 * Draw the current state. Separate from parsing so the two can be debounced
 * independently: parsing is cheap and rendering a sixty row table is not.
 */
export function rerender(state, els) {
  const model = state.model || state.lastGood;
  const stage = els.stage;
  if (!stage) return;

  stage.setAttribute('aria-busy', 'true');
  for (const control of document.querySelectorAll('[data-needs-report]')) control.disabled = !model;
  updateReportBar(state, model);

  if (!model) {
    stage.replaceChildren();
    document.body.classList.add('is-empty');
    stage.setAttribute('aria-busy', 'false');
    if (els.outline) els.outline.replaceChildren();
    if (els.findingsCount) updateFindingCount(state, els.findingsCount);
    reportDocumentTitle(state);
    return;
  }

  document.body.classList.remove('is-empty');
  renderReport(model, stage, { page: state.page, interactive: true, titleLevel: STAGE_TITLE_LEVEL });

  // Dimmed while the source does not parse, so it is obvious that what is on
  // screen is the last good version rather than the current text.
  stage.classList.toggle('is-stale', Boolean(state.fatal));
  stage.setAttribute('aria-busy', 'false');

  if (els.outline) renderOutline(state, els.outline);
  if (els.findingsCount) updateFindingCount(state, els.findingsCount);
  reportDocumentTitle(state);
}

/**
 * Pages link to their route. Headings scroll within the page through the
 * `outline-heading` action: a bare `#<block id>` href replaced the page route,
 * so a reload after clicking a heading reopened page one. The href still names
 * the page, so copying the link or opening it in a new tab lands somewhere real.
 */
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
    link.href = routeFor({ page: page.id });
    link.textContent = page.title || 'Untitled page';
    link.className = 'ds-outline__page';
    if (page.id === state.page) link.setAttribute('aria-current', 'page');
    li.appendChild(link);

    if (page.id === state.page && page.headings && page.headings.length) {
      const sub = document.createElement('ul');
      for (const heading of page.headings) {
        if (!heading.id) continue;
        const subLi = document.createElement('li');
        const subLink = document.createElement('a');
        subLink.href = routeFor({ page: page.id });
        subLink.dataset.action = 'outline-heading';
        subLink.dataset.blockId = heading.id;
        subLink.textContent = heading.text || '';
        subLink.className = 'ds-outline__heading';
        // h1 and h2 of an imported report share the base indent; h3 (or a
        // level-3 heading block) is the nested step, so it reads as a child.
        subLink.dataset.level = String(Number(heading.level) >= 3 ? 3 : 2);
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
 * Where the open report came from, and how many pages it has. The report bar
 * replaced the old context bar above the report.
 */
export function updateReportBar(state, model = state.model || state.lastGood) {
  // A notice that another tab changed the report (js/report-sync.js) belongs
  // to the report it was shown for; another report opening takes it away.
  const notice = document.getElementById('reportConflict');
  if (notice && notice.dataset.reportId !== String(state.reportId)) {
    notice.remove();
    state.reportConflict = null;
  }
  const origin = document.getElementById('reportOrigin');
  if (origin) origin.textContent = originText(state, model);
  const pages = document.getElementById('reportPages');
  if (pages) {
    const count = (reportOf(model)?.pages || []).length;
    pages.textContent = count ? `${count} page${count === 1 ? '' : 's'}` : '';
  }
}

// ── Page changes ─────────────────────────────────────────────────────────────

/** The title in index.html, for a Reports view with nothing open. */
const APP_TITLE = typeof document === 'undefined' ? 'Dossier' : document.title || 'Dossier';

/**
 * Where focus was when a page change began, for `restorePageFocus`: a
 * report tab, an outline page link, or something inside the report. Focus
 * anywhere else (the body, the header, the editor, the rail's filter) is not
 * the page's and is never moved.
 *
 * @returns {'tab'|'outline'|'content'|null}
 */
export function pageFocusOrigin(active, els) {
  if (!active || !(active instanceof Element)) return null;
  if (active.closest('.report-tabs')) return 'tab';
  if (active.closest('#outline a.ds-outline__page')) return 'outline';
  if (els.stage?.contains(active)) return 'content';
  return null;
}

/**
 * A page change rebuilds the report and the outline, which took the focused
 * tab or link with them and left focus on the body: the next Tab went back to
 * the first tab (WCAG 2.4.3). Focus goes to the same control for the new
 * page, or to the new page's heading when it was inside the old page.
 */
export function restorePageFocus(origin, els) {
  if (!origin) return;
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  const heading = () => {
    const el = els.stage?.querySelector('.report-page__head h2') || els.stage?.querySelector('.report-title');
    // On the live heading, not in the renderer, which the export shares.
    if (el && !el.hasAttribute('tabindex')) el.tabIndex = -1;
    return el;
  };
  let target = null;
  if (origin === 'tab') target = els.stage?.querySelector('.report-tab[aria-current="page"]');
  else if (origin === 'outline') target = els.outline?.querySelector('a.ds-outline__page[aria-current="page"]');
  else target = heading();
  target?.focus({ preventScroll: true });
  // An outline link in a drawer that closed behind it cannot take focus:
  // the new page's heading does.
  if (document.activeElement !== target) heading()?.focus({ preventScroll: true });
}

/**
 * Say which page is shown, once per page change ("Page 2 of 3: Scores &
 * runs"). A polite live region rather than the toast: a toast on every page
 * flip is noise on screen. Cleared first and filled on the next frame, so
 * stepping back to the same page is said again. Never called on an edit.
 */
export function announcePage(state) {
  const live = document.getElementById('pageLive');
  const pages = reportOf(state.model || state.lastGood)?.pages || [];
  if (!live || pages.length < 2) return;
  const at = pages.findIndex((p) => p.id === state.page);
  if (at < 0) return;
  live.textContent = '';
  requestAnimationFrame(() => {
    live.textContent = `Page ${at + 1} of ${pages.length}: ${pages[at].title || 'Untitled page'}`;
  });
}

/**
 * The tab's title names the report and, past one page, the page: what a
 * reader sees in the tab strip and history, and what a screen reader says
 * on a page change. The Compare view keeps its own.
 */
export function reportDocumentTitle(state) {
  if (typeof document === 'undefined' || document.documentElement.dataset.dossierView === 'compare') return;
  const report = reportOf(state.model || state.lastGood);
  if (!report) {
    document.title = APP_TITLE;
    return;
  }
  const name = report.title || 'Untitled report';
  const pages = report.pages || [];
  const page = pages.length > 1 ? pages.find((p) => p.id === state.page) : null;
  document.title = page ? `${page.title || 'Untitled page'} | ${name} | Dossier` : `${name} | Dossier`;
}

export function originText(state, model = state.model || state.lastGood) {
  if (!model) return 'Nothing open';
  if (state.isExample) return 'Example report · illustrative data';
  if (state.reportId) return 'Saved in this browser';
  if (state.fromUrl) return 'Opened from a link';
  return 'Not saved yet';
}

/**
 * How many findings need a look: errors and warnings, not notes. Said in
 * words ("1 error, 2 warnings"), so the badge does not depend on its colour.
 */
function updateFindingCount(state, el) {
  const errors = state.findings.filter((f) => f.level === 'error').length;
  const warnings = state.findings.filter((f) => f.level === 'warn').length;
  const words = [
    errors ? `${errors} error${errors === 1 ? '' : 's'}` : null,
    warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  el.textContent = words.join(', ');
  el.hidden = words.length === 0;
  el.classList.toggle('is-error', errors > 0);
}
