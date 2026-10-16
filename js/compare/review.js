/**
 * The Review panel: criteria by columns, each a Strong, Adequate, Weak or
 * N/A radio group; the preferred report; notes per report; a summary; and
 * "Copy review as Markdown". Design spec 7.3.9; the record itself is
 * js/compare/review-model.js.
 *
 * The panel is built once per shape (columns, criteria, Blind) and then only
 * brought in step, so a mark clicked or a note typed never redraws the
 * control in use. Notes save a moment after the last keystroke, like the
 * rest of the set. Everything is keyboard operable: arrows move within a
 * mark group (js/compare/toolbar.js `bindGroupKeys`), and the preferred
 * report is a native radio group.
 *
 * A mark group behaves as radios do: choosing the chosen mark again keeps
 * it. It used to clear it, so a keyboard user who arrowed to "Adequate" and
 * pressed Space to confirm was left with no mark. Marks are cleared with
 * "Clear marks" in the criterion's menu (js/compare/crit-menu.js), which has
 * an undo.
 */

import { escHtml, copyText } from '../neorgon-dom.js';
import { registerActions } from '../actions.js';
import { say, sentence } from '../share.js';
import { icon } from './icons.js';
import { nameOf, displayColumns, roleAttr } from './blind.js';
import { undoToast } from './popover.js';
import { bindCritMenus, toggleCritMenu, closeCritMenus } from './crit-menu.js';
import { MARKS, LIMITS, repair } from './model.js';
import {
  MARK_WORDS, setMark, setPreferred, setNote, setSummary, addCriterion, renameCriterion,
  moveCriterion, removeCriterion, tally, tallySentence, criterionSummary, recordSentence,
  reviewMarkdown,
} from './review-model.js';

const NOTE_DELAY_MS = 300;

/** @param {object} api from js/compare/index.js */
export function createReview(api) {
  const { compare } = api;
  const refs = compare.refs;
  /** Which criteria are open, per set: `${setId}:${critId}` -> boolean. */
  const open = new Map();
  let host = null;

  const set = () => compare.set;
  const filled = (s) => displayColumns(s).filter((col) => col.source);
  const refOf = (s) => (col) => nameOf(s, col).ref;
  const isOpen = (s, crit, i) => (open.has(`${s.id}:${crit.id}`) ? open.get(`${s.id}:${crit.id}`) : i < 2);
  /** A criterion has a mark for at least one of these columns. */
  const markedIn = (s, critId, cols) => cols.some((col) => s.review.marks[critId]?.[col.id]);

  function markGroup(s, crit, col) {
    const name = nameOf(s, col);
    const label = name.blind ? name.label : `${name.ref}, ${col.label}`;
    const buttons = MARKS.map((mark) => `<button type="button" role="radio" aria-checked="false" tabindex="-1" data-action="cmp-mark"`
      + ` data-crit="${escHtml(crit.id)}" data-col="${col.id}" data-value="${mark}">${icon('check', 'ck')}<span class="seg__word">${MARK_WORDS[mark]}</span></button>`).join('');
    return `<div class="crit__row" data-col="${col.id}" data-role="${roleAttr(s, col)}"><span class="rb rb--sm" aria-hidden="true">${escHtml(name.mark)}</span>`
      + `<div class="seg seg--sm marks" role="radiogroup" aria-label="${escHtml(crit.label)} for ${escHtml(label)}">${buttons}</div></div>`;
  }

  function criterionHtml(s, crit, i, cols) {
    const id = escHtml(crit.id);
    return `<div class="crit-wrap" data-crit="${id}">
      <details class="crit" data-crit="${id}"${isOpen(s, crit, i) ? ' open' : ''}>
        <summary>${icon('right', 'chev')}<span class="crit__name">${escHtml(crit.label)}</span><span class="crit__sum"></span></summary>
        <div class="crit__rows">${cols.map((col) => markGroup(s, crit, col)).join('')}</div>
      </details>
      <button type="button" class="btn btn--quiet btn--sm btn--icon crit__more" data-action="cmp-crit-menu" data-crit="${id}"
        aria-haspopup="menu" aria-expanded="false" aria-controls="cmpCritMenu${i}" aria-label="Options for ${escHtml(crit.label)}" title="Criterion options">${icon('more')}</button>
      <div class="cmp-menu crit__menu" id="cmpCritMenu${i}" role="menu" aria-label="${escHtml(crit.label)} options" hidden></div>
    </div>`;
  }

  /** The items of a criterion's menu, as things stand when it opens. */
  function critMenuHtml(s, critId) {
    const i = s.review.criteria.findIndex((c) => c.id === critId);
    const id = escHtml(critId);
    // Items are not Tab stops: the arrow keys move between them, and Tab
    // leaves the menu (js/compare/crit-menu.js).
    const item = (action, label, extra = '', disabled = false) => `<button type="button" role="menuitem" tabindex="-1" data-action="${action}" data-crit="${id}"${extra}${disabled ? ' disabled' : ''}>${label}</button>`;
    return [
      item('cmp-crit-rename', 'Rename'),
      item('cmp-crit-clear', 'Clear marks', '', !markedIn(s, critId, filled(s))),
      '<div role="separator" class="cmp-menu__sep"></div>',
      item('cmp-crit-move', 'Move up', ' data-dir="-1"', i <= 0),
      item('cmp-crit-move', 'Move down', ' data-dir="1"', i < 0 || i === s.review.criteria.length - 1),
      '<div role="separator" class="cmp-menu__sep"></div>',
      item('cmp-crit-remove', 'Remove criterion', ' data-danger'),
    ].join('');
  }

  /** A criterion's menu button, to put focus back on. */
  const moreOf = (critId) => host?.querySelector(`.crit__more[data-crit="${CSS.escape(critId)}"]`) || null;

  function build(s) {
    const cols = filled(s);
    const tallyRows = cols.map((col) => `<div class="tally__row" data-col="${col.id}" data-role="${roleAttr(s, col)}">`
      + `<span class="rb rb--sm" aria-hidden="true">${escHtml(nameOf(s, col).mark)}</span>`
      + `<span class="visually-hidden">${escHtml(nameOf(s, col).ref)}: </span><span class="tally__text"></span></div>`).join('');
    const prefer = cols.map((col) => {
      const name = nameOf(s, col);
      return `<label data-col="${col.id}" data-role="${roleAttr(s, col)}"><input type="radio" name="cmp-pref" value="${col.id}">`
        + `<span class="rb rb--sm" aria-hidden="true">${escHtml(name.mark)}</span><span>${escHtml(name.blind ? name.label : `${col.label}`)}</span>`
        + `${name.blind ? '' : `<span class="visually-hidden">, column ${escHtml(name.ref)}</span>`}</label>`;
    }).join('');
    const notes = cols.map((col) => {
      const name = nameOf(s, col);
      return `<label class="note" data-col="${col.id}" data-role="${roleAttr(s, col)}"><span class="rb rb--sm" aria-hidden="true">${escHtml(name.mark)}</span>`
        + `<textarea data-note="${col.id}" rows="2" maxlength="${LIMITS.note}" data-text-surface aria-label="Notes on ${escHtml(name.blind ? name.label : `${name.ref}, ${col.label}`)}"></textarea></label>`;
    }).join('');
    const full = s.review.criteria.length >= LIMITS.criteria;
    host.innerHTML = `
      <p class="panel__intro">Your marks only. Dossier counts what you enter and never scores a report.</p>
      <p class="blind-hint"></p>
      ${cols.length ? `<div class="tally" role="group" aria-label="What you entered">${tallyRows}</div>` : '<p class="panel__intro">Put a report in a column to review it.</p>'}
      <h3>Criteria</h3>
      <div class="crits">${s.review.criteria.map((crit, i) => criterionHtml(s, crit, i, cols)).join('')}</div>
      <button type="button" class="btn btn--quiet btn--sm add-crit" data-action="cmp-crit-add"${full ? ` disabled title="Up to ${LIMITS.criteria} criteria"` : ''}>${icon('plus')}Add criterion</button>
      <fieldset class="prefer"><legend>Preferred</legend>${prefer}
        <label><input type="radio" name="cmp-pref" value="none"><span>None is adequate</span></label></fieldset>
      <h3>Notes</h3>
      <div class="notes">${notes}</div>
      <h3><label for="cmpReviewSummary">Summary</label></h3>
      <div class="summary"><textarea id="cmpReviewSummary" data-summary rows="3" maxlength="${LIMITS.summary}" data-text-surface></textarea></div>
      <div class="panel__foot">
        <button type="button" class="btn" data-action="cmp-copy-review">${icon('copy')}Copy review as Markdown</button>
        <p class="rec" role="status"></p>
        <div class="copy-fallback" hidden>
          <p>Copying did not work in this browser. The review is selected below: copy it with Ctrl+C, or Command+C on a Mac.</p>
          <textarea readonly rows="6" aria-label="The review as Markdown"></textarea>
        </div>
      </div>`;
  }

  /** Bring every control in step with the set, without rebuilding any. */
  function sync(s) {
    const cols = filled(s);
    host.querySelector('.blind-hint').textContent = s.view.blind
      ? 'Blind is on: names, roles and authors are hidden. Marks you enter now are recorded as blind. A report that corrects another still reads as an edit of it.'
      : 'Blind is off, so you can see who wrote each report. Turn on Blind before you mark to hide names, roles and authors.';
    host.querySelector('.blind-hint').classList.toggle('is-on', Boolean(s.view.blind));
    for (const row of host.querySelectorAll('.tally__row')) {
      row.querySelector('.tally__text').textContent = tallySentence(tally(s, row.dataset.col));
    }
    for (const crit of s.review.criteria) {
      const el = host.querySelector(`.crit[data-crit="${CSS.escape(crit.id)}"]`);
      if (!el) continue;
      el.querySelector('.crit__sum').textContent = criterionSummary(s, crit, cols, refOf(s));
      for (const group of el.querySelectorAll('.marks')) {
        const buttons = [...group.querySelectorAll('[data-action="cmp-mark"]')];
        const chosen = s.review.marks[crit.id]?.[buttons[0]?.dataset.col] || null;
        for (const b of buttons) {
          const on = b.dataset.value === chosen;
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on || (!chosen && b === buttons[0]) ? 0 : -1;
        }
      }
    }
    for (const input of host.querySelectorAll('input[name="cmp-pref"]')) input.checked = input.value === s.review.preferred;
    for (const area of host.querySelectorAll('textarea[data-note]')) {
      if (area !== document.activeElement) area.value = s.review.notes[area.dataset.note] || '';
    }
    const summary = host.querySelector('textarea[data-summary]');
    if (summary && summary !== document.activeElement) summary.value = s.review.summary || '';
    host.querySelector('.rec').textContent = recordSentence(s);
  }

  /** Draw into the panel body: build when the shape changed, then sync. */
  function render(target) {
    const s = set();
    if (!s) return;
    host = target;
    const shape = JSON.stringify([s.id, s.view.blind, filled(s).map((c) => [c.id, c.label, c.role]),
      s.review.criteria.map((c) => [c.id, c.label]), s.review.criteria.length >= LIMITS.criteria]);
    if (host.dataset.shape !== shape) {
      const focus = document.activeElement && host.contains(document.activeElement) ? focusKey(document.activeElement) : null;
      host.dataset.shape = shape;
      build(s);
      if (focus) restoreFocus(focus);
    }
    sync(s);
  }

  function focusKey(el) {
    const d = el.dataset;
    if (d.action) return `[data-action="${d.action}"]${d.crit ? `[data-crit="${CSS.escape(d.crit)}"]` : ''}${d.col ? `[data-col="${d.col}"]` : ''}${d.value ? `[data-value="${d.value}"]` : ''}${d.dir ? `[data-dir="${d.dir}"]` : ''}`;
    if (d.note) return `textarea[data-note="${d.note}"]`;
    if (el.name === 'cmp-pref') return `input[name="cmp-pref"][value="${CSS.escape(el.value)}"]`;
    if (el.localName === 'summary') return `.crit[data-crit="${CSS.escape(el.parentElement.dataset.crit)}"] > summary`;
    return null;
  }

  function restoreFocus(selector) {
    host?.querySelector(selector)?.focus({ preventScroll: true });
  }

  // ── Editing ────────────────────────────────────────────────────────────────

  const timers = new Map();
  function noteLater(key, apply) {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      api.commit(apply(set()));
    }, NOTE_DELAY_MS));
  }
  function noteNow(key, apply) {
    if (!timers.has(key)) return;
    clearTimeout(timers.get(key));
    timers.delete(key);
    api.commit(apply(set()));
  }

  refs.panel.addEventListener('input', (event) => {
    const area = event.target;
    if (area.matches?.('textarea[data-note]')) noteLater(`n:${area.dataset.note}`, (s) => setNote(s, area.dataset.note, area.value));
    else if (area.matches?.('textarea[data-summary]')) noteLater('summary', (s) => setSummary(s, area.value));
  });
  refs.panel.addEventListener('focusout', (event) => {
    const area = event.target;
    if (area.matches?.('textarea[data-note]')) noteNow(`n:${area.dataset.note}`, (s) => setNote(s, area.dataset.note, area.value));
    else if (area.matches?.('textarea[data-summary]')) noteNow('summary', (s) => setSummary(s, area.value));
  });
  refs.panel.addEventListener('change', (event) => {
    const input = event.target;
    if (input.matches?.('input[name="cmp-pref"]') && input.checked) api.commit(setPreferred(set(), input.value));
  });
  refs.panel.addEventListener('toggle', (event) => {
    const el = event.target;
    if (el.matches?.('.crit') && set()) open.set(`${set().id}:${el.dataset.crit}`, el.open);
  }, true);
  bindCritMenus(refs.panel);

  /** Rename a criterion in place, at the top of its rows: Enter keeps, Escape drops. */
  function renameInPlace(critId) {
    const el = host?.querySelector(`.crit[data-crit="${CSS.escape(critId)}"]`);
    const crit = set().review.criteria.find((c) => c.id === critId);
    if (!el || !crit) return;
    el.open = true;
    const rows = el.querySelector('.crit__rows');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'crit__input';
    input.value = crit.label;
    input.maxLength = LIMITS.criterion;
    input.dataset.textSurface = '';
    input.setAttribute('aria-label', `New name for ${crit.label}`);
    rows.prepend(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      input.remove();
      if (keep && value && value !== crit.label) api.commit(renameCriterion(set(), critId, value));
      moreOf(critId)?.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  async function copyReview() {
    const s = set();
    const text = reviewMarkdown(s, filled(s), (col) => nameOf(s, col));
    const fallback = host?.querySelector('.copy-fallback');
    if (await copyText(text)) {
      if (fallback) fallback.hidden = true;
      say('Copied the review as Markdown.');
      return true;
    }
    if (fallback) {
      fallback.hidden = false;
      const area = fallback.querySelector('textarea');
      area.value = text;
      area.focus();
      area.select();
    }
    return false;
  }

  registerActions({
    'cmp-crit-menu': (el) => toggleCritMenu(el, critMenuHtml(set(), el.dataset.crit)),
    'cmp-mark': (el) => {
      const s = set();
      // Radios: choosing the chosen mark again (Space or Enter to confirm
      // it) keeps it. "Clear marks" takes marks away.
      if (s.review.marks[el.dataset.crit]?.[el.dataset.col] === el.dataset.value) return;
      api.commit(setMark(s, el.dataset.crit, el.dataset.col, el.dataset.value));
    },
    'cmp-crit-clear': (el) => {
      closeCritMenus(refs.panel);
      const before = set();
      const crit = before.review.criteria.find((c) => c.id === el.dataset.crit);
      if (!crit || !markedIn(before, crit.id, filled(before))) return;
      let next = before;
      for (const col of before.columns) next = setMark(next, crit.id, col.id, null);
      // Clearing is not a verdict: the record keeps how the rest was entered.
      api.commit({ ...next, review: { ...next.review, blindAtVerdict: before.review.blindAtVerdict } });
      // The button is disabled now; the criterion's first mark keeps focus.
      host?.querySelector(`.crit[data-crit="${CSS.escape(crit.id)}"] [data-action="cmp-mark"][tabindex="0"]`)?.focus({ preventScroll: true });
      undoToast(refs.toast, sentence(`Cleared the marks for "${crit.label}"`), () => {
        const now = set();
        // Removed in the meantime: there is nothing to put the marks back on.
        if (!now.review.criteria.some((c) => c.id === crit.id)) return null;
        // `repair` drops marks for a column removed in the meantime.
        api.commit(repair({ ...now, review: { ...now.review, marks: { ...now.review.marks, [crit.id]: before.review.marks[crit.id] || {} } } }));
        return () => moreOf(crit.id);
      });
    },
    'cmp-crit-add': () => {
      const { set: next, id } = addCriterion(set());
      if (!id) { say(`A review holds up to ${LIMITS.criteria} criteria.`); return; }
      open.set(`${next.id}:${id}`, true);
      api.commit(next);
      renameInPlace(id);
    },
    'cmp-crit-rename': (el) => {
      closeCritMenus(refs.panel);
      renameInPlace(el.dataset.crit);
    },
    'cmp-crit-move': (el) => {
      const critId = el.dataset.crit;
      closeCritMenus(refs.panel);
      api.commit(moveCriterion(set(), critId, Number(el.dataset.dir) || 0));
      // The criterion's menu button, at its new place.
      moreOf(critId)?.focus({ preventScroll: true });
    },
    'cmp-crit-remove': (el) => {
      closeCritMenus(refs.panel);
      const before = set();
      const crit = before.review.criteria.find((c) => c.id === el.dataset.crit);
      if (!crit) return;
      const at = before.review.criteria.indexOf(crit);
      const marks = before.review.marks[crit.id] || {};
      api.commit(removeCriterion(before, crit.id));
      host?.querySelector('[data-action="cmp-crit-add"]')?.focus({ preventScroll: true });
      undoToast(refs.toast, sentence(`Removed the criterion "${crit.label}" and its marks`), () => {
        // Only the criterion and its marks come back, at its old place: a
        // note, a mark or a summary entered since stays. Putting the whole
        // review back took those away.
        const now = set();
        if (now.review.criteria.some((c) => c.id === crit.id)) return null;
        if (now.review.criteria.length >= LIMITS.criteria) {
          say(`A review holds up to ${LIMITS.criteria} criteria, so "${crit.label}" could not come back.`);
          return null;
        }
        const criteria = [...now.review.criteria];
        criteria.splice(Math.min(at, criteria.length), 0, crit);
        // `repair` drops marks for a column removed in the meantime.
        api.commit(repair({ ...now, review: { ...now.review, criteria, marks: { ...now.review.marks, [crit.id]: marks } } }));
        return () => host?.querySelector(`.crit[data-crit="${CSS.escape(crit.id)}"] > summary`) || null;
      });
    },
    'cmp-copy-review': () => copyReview(),
  });

  return { render };
}
