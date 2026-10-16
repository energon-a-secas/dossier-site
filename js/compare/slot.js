/**
 * The forms that live inside a column: the empty slot (drop a file, choose
 * one, paste text, use a report saved in the Reports view, or start a Fixes
 * column from a copy of the column it fixes), the paste box, Edit source
 * (both wrap long lines, with a Wrap lines toggle for code), and the label,
 * role and author form.
 *
 * Markup only, with every value escaped or set as a property. Submits and
 * clicks are handled by js/compare/actions.js through `data-form` and
 * `data-action`.
 *
 * Columns are named through `nameOf` (js/compare/blind.js): "column B", or
 * "Report 3" while Blind is on, when the file name is left out too, since
 * it can say who wrote the report.
 */

import { escHtml } from '../neorgon-dom.js';
import { icon } from './icons.js';
import {
  ROLES, ROLE_WORDS, LIMITS, MAX_SOURCE_CHARS, letterOf, columnById,
} from './model.js';
import { nameOf } from './blind.js';

/** "column B", or "Report 3" while blind. */
function columnWords(set, col) {
  const name = nameOf(set, col);
  return name.blind ? name.label : `column ${name.ref}`;
}

/** The column a Fixes slot offers to copy: the one it fixes, if it has a report. */
export function copySource(set, col) {
  if (col.role !== 'fix') return null;
  const target = col.fixes ? columnById(set, col.fixes) : null;
  if (target?.source) return target;
  const others = set.columns.filter((c) => c.id !== col.id && c.role !== 'fix' && c.source);
  return others.length ? others[others.length - 1] : null;
}

/**
 * The drop zone of an empty column, or of a column being replaced.
 *
 * @param {{replacing?: boolean}} [opts]
 */
export function slotHtml(set, col, { replacing = false } = {}) {
  const from = copySource(set, col);
  const copy = from
    ? `<button type="button" class="btn btn--quiet" data-action="cmp-copy-from" data-col="${col.id}" data-from="${from.id}">Start from a copy of ${escHtml(nameOf(set, from).ref)}</button>`
    : '';
  const cancel = replacing
    ? `<button type="button" class="btn btn--quiet" data-action="cmp-cancel-form" data-col="${col.id}">Keep the current report</button>`
    : '';
  return `<div class="drop" data-drop="${col.id}">
    ${icon('upload', 'big')}
    <h3>${replacing ? 'Drop the new report here' : 'Drop a report here'}</h3>
    <p>HTML, Markdown, plain text or Dossier JSON, up to ${MAX_SOURCE_CHARS.toLocaleString('en-US')} characters. It stays in this browser.</p>
    <div class="actions">
      <button type="button" class="btn" data-action="cmp-choose-file" data-col="${col.id}">Choose a file</button>
      <button type="button" class="btn" data-action="cmp-paste" data-col="${col.id}">Paste text</button>
      <button type="button" class="btn" data-action="cmp-use-saved" data-col="${col.id}" aria-haspopup="menu">Use a saved report</button>
      ${copy}${cancel}
    </div>
  </div>`;
}

/**
 * The label of a text form: what it pastes into or edits, by the column's
 * name as it shows now.
 *
 * @param {'paste'|'edit'} kind
 */
export function textFormLabel(set, col, kind) {
  const who = columnWords(set, col);
  const file = !nameOf(set, col).blind && col.source?.name ? `, ${col.source.name}` : '';
  return kind === 'paste'
    ? `Paste a report into ${who}: HTML, Markdown, plain text or Dossier JSON`
    : `Source of ${who}${file}`;
}

/**
 * A text form in a column: pasting a report, or editing the source. Long
 * lines wrap unless `wrap` is false (the reader's Wrap lines choice).
 *
 * @param {'paste'|'edit'} kind
 * @param {{wrap?: boolean}} [opts]
 */
export function textFormHtml(set, col, kind, { wrap = true } = {}) {
  const id = `cmp-${kind}-${col.id}`;
  const label = textFormLabel(set, col, kind);
  const submit = kind === 'paste' ? 'Use this text' : 'Save';
  return `<form class="col-form" data-form="${kind}" data-col="${col.id}">
    <label class="col-form__label" for="${id}">${escHtml(label)}</label>
    <textarea class="col-form__text${wrap ? '' : ' is-nowrap'}" id="${id}" spellcheck="false" data-text-surface
      aria-describedby="${id}-error"${kind === 'paste' ? ' placeholder="Paste here"' : ''}></textarea>
    <p class="col-form__error" id="${id}-error" role="alert" hidden></p>
    <div class="col-form__actions">
      <button type="submit" class="btn btn--primary">${submit}</button>
      <button type="button" class="btn" data-action="cmp-cancel-form" data-col="${col.id}">Cancel</button>
      <button type="button" class="btn toggle col-form__wrap" data-action="cmp-wrap-source" data-col="${col.id}" aria-controls="${id}" aria-pressed="${wrap}"><span class="box">${icon('check')}</span>Wrap lines</button>
    </div>
  </form>`;
}

/** Fill a text form's textarea, as a property: a source can be 2 MB. */
export function fillTextForm(form, text) {
  const area = form?.querySelector('textarea');
  if (area) area.value = text || '';
  return area;
}

/** Label, role, author and, for a Fixes column, which column it fixes. */
export function detailsFormHtml(set, col) {
  const letter = letterOf(set, col.id);
  const others = set.columns.filter((c) => c.id !== col.id);
  const roleOptions = ROLES.map((role) => `<option value="${role}"${role === col.role ? ' selected' : ''}>${ROLE_WORDS[role]}</option>`).join('');
  const fixOptions = [`<option value=""${col.fixes ? '' : ' selected'}>No column</option>`,
    ...others.map((c) => `<option value="${c.id}"${c.id === col.fixes ? ' selected' : ''}>${letterOf(set, c.id)}, ${escHtml(c.label)}</option>`)].join('');
  return `<form class="col-form col-form--details" data-form="details" data-col="${col.id}" aria-label="Column ${letter} details">
    <label class="col-form__field">Label
      <input name="label" maxlength="${LIMITS.label}" value="${escHtml(col.label)}" required></label>
    <label class="col-form__field">Role
      <select name="role">${roleOptions}</select></label>
    <label class="col-form__field">Author <span class="col-form__hint">a person or a model, optional</span>
      <input name="author" maxlength="${LIMITS.author}" value="${escHtml(col.author)}"></label>
    <label class="col-form__field col-form__fixes"${col.role === 'fix' ? '' : ' hidden'}>Fixes to
      <select name="fixes">${fixOptions}</select></label>
    <div class="col-form__actions">
      <button type="submit" class="btn btn--primary btn--sm">Save</button>
      <button type="button" class="btn btn--sm" data-action="cmp-cancel-form" data-col="${col.id}">Cancel</button>
    </div>
  </form>`;
}
