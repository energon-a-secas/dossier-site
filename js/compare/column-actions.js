/**
 * What a column's own controls do: its menu, the forms inside it (paste,
 * Edit source, label and role), choosing or dropping a file into it, and the
 * in-page links of its text. Registered through js/actions.js with the
 * `cmp-` prefix, like the rest of the Compare view (js/compare/actions.js).
 */

import { registerActions } from '../actions.js';
import { readText, onComparisonBundle } from '../open.js';
import { view as currentView } from '../chrome.js';
import { routeFor } from '../router.js';
import { say, sentence } from '../share.js';
import {
  addColumn, updateColumn, removeColumn, moveColumn, duplicateColumn, setView,
  letterOf, columnById, MAX_COLUMNS, LIMITS, MODE_WORDS,
} from './model.js';
import { fromBundle } from './records.js';
import { readSource, readFile } from './sources.js';
import { openPopover, closePopover, undoToast } from './popover.js';
import { effectiveMode } from './column.js';
import { columnEl } from './view.js';
import { nameOf } from './blind.js';

/**
 * How a toast or a menu names a column: "Column B", or "Report 3" while
 * Blind is on, so a message never says what Blind hides.
 *
 * @param {boolean} [lower] "column B" mid-sentence
 */
function columnName(set, colId, lower = false) {
  const name = nameOf(set, colId);
  if (name.blind) return name.label;
  return `${lower ? 'column' : 'Column'} ${letterOf(set, colId)}`;
}

/**
 * @param {object} api from js/compare/index.js
 * @returns {{openBundle: (value: object) => Promise<boolean>, focusColumn: Function}}
 */
export function registerColumnActions(api) {
  const { compare } = api;
  const refs = compare.refs;
  const root = refs.root;
  let fileTarget = null;

  const set = () => compare.set;
  const toast = (message, undo) => undoToast(refs.toast, message, undo);

  const COLUMN_CONTROL = '.col__menu, [data-action="cmp-choose-file"], textarea, input';

  function focusColumn(colId, selector) {
    requestAnimationFrame(() => {
      const el = columnEl(refs, colId);
      el?.querySelector(selector || COLUMN_CONTROL)?.focus({ preventScroll: true });
    });
  }

  /**
   * For an undo: where focus goes once the column is back on screen (the
   * toast's Undo button takes itself away). See js/compare/popover.js.
   */
  const controlOf = (colId) => () => columnEl(refs, colId)?.querySelector(COLUMN_CONTROL) || null;

  function openForm(colId, kind) {
    api.rememberScroll();
    compare.ui.forms.set(colId, { kind });
    api.render();
  }

  function closeForm(colId) {
    compare.ui.forms.delete(colId);
    api.render();
    focusColumn(colId);
  }

  /** Put a source into a column, closing any form it had open. */
  function setSource(colId, source) {
    const col = columnById(set(), colId);
    if (!col) return;
    const before = set();
    compare.ui.forms.delete(colId);
    compare.ui.scroll.delete(colId);
    api.commit(updateColumn(before, colId, { source }));
    if (col.source) {
      // While blind, not the file's name: it can say who wrote the report.
      const what = nameOf(before, colId).blind ? 'the new report' : source.name;
      toast(sentence(`${columnName(before, colId)} now shows ${what}`), () => {
        api.commit(before);
        return controlOf(colId);
      });
    }
    focusColumn(colId);
  }

  async function takeText(colId, text, name) {
    const read = await readSource(text, name);
    if (!read.ok) return read.message;
    if (read.bundle) {
      await openBundle(read.bundle);
      return null;
    }
    setSource(colId, read.source);
    return null;
  }

  async function openBundle(value) {
    const next = fromBundle(value);
    if (!next) {
      say('That comparison file is from a version of Dossier this one does not read.');
      return false;
    }
    await api.openBundleSet(next);
    // A comparison saved under Blind opens under Blind: its title stays hidden.
    say(next.view.blind ? 'Opened the comparison, under Blind review.' : sentence(`Opened the comparison "${next.title}"`));
    return true;
  }

  // ── Column menu ────────────────────────────────────────────────────────────

  function columnMenu(colId) {
    const s = set();
    const col = columnById(s, colId);
    const at = s.columns.indexOf(col);
    const html = col.source?.kind === 'html';
    const mode = effectiveMode(s, col);
    const item = (action, label, extra = '', disabled = false) => `<button type="button" role="menuitem" data-action="${action}" data-col="${colId}"${extra}${disabled ? ' disabled' : ''}>${label}</button>`;
    const radio = (value, label) => `<button type="button" role="menuitemradio" aria-checked="${mode === value}" data-action="cmp-col-mode" data-col="${colId}" data-value="${value}"${!html && value !== 'format' ? ' disabled' : ''}>${label}</button>`;
    const focused = s.view.layout === 'focus' && s.view.focus === colId;
    // The three ways to show the column are one group, named for a screen
    // reader as the visible label reads, so "Original layout" is heard as a
    // choice of "Show as" and not as a loose radio item.
    const showAs = `Show as${html ? '' : ' (Original needs an HTML report)'}`;
    return [
      item('cmp-edit-source', 'Edit source'),
      item('cmp-replace', 'Replace the report'),
      // The form shows what Blind hides, so it waits until Blind is off.
      s.view.blind ? item('cmp-details', 'Label, role and author (turn off Blind first)', '', true) : item('cmp-details', 'Label, role and author'),
      item('cmp-duplicate', 'Duplicate', '', s.columns.length >= MAX_COLUMNS),
      '<div role="separator" class="cmp-menu__sep"></div>',
      `<div role="group" class="cmp-menu__group" aria-label="${showAs}">`,
      `<p class="cmp-menu__label" aria-hidden="true">${showAs}</p>`,
      radio('format', MODE_WORDS.format),
      radio('original', 'Original layout'),
      radio('interactive', 'Run the report’s scripts'),
      '</div>',
      '<div role="separator" class="cmp-menu__sep"></div>',
      // While blind the columns are laid out in report order, not their
      // own: a move would change an order nobody can see. It waits for Reveal.
      ...(s.view.blind
        ? [item('cmp-move', 'Move left (turn off Blind first)', ' data-dir="-1"', true),
          item('cmp-move', 'Move right (turn off Blind first)', ' data-dir="1"', true)]
        : [item('cmp-move', 'Move left', ' data-dir="-1"', at === 0),
          item('cmp-move', 'Move right', ' data-dir="1"', at === s.columns.length - 1)]),
      // A phone shows one column at a time already.
      focused ? item('cmp-layout', 'Show all columns', ' data-value="columns" data-wide-only') : item('cmp-focus-col', 'Focus on this column', ' data-wide-only'),
      '<div role="separator" class="cmp-menu__sep"></div>',
      item('cmp-remove', 'Remove column', ' data-danger'),
    ].join('');
  }

  registerActions({
    'cmp-column-menu': (el) => {
      refs.columnMenu.innerHTML = columnMenu(el.dataset.col);
      refs.columnMenu.setAttribute('aria-label', `${columnName(set(), el.dataset.col)} options`);
      openPopover(refs.columnMenu, el, { focus: 'first' });
    },
    'cmp-edit-source': (el) => { closePopover({ restore: false }); openForm(el.dataset.col, 'edit'); },
    'cmp-replace': (el) => { closePopover({ restore: false }); openForm(el.dataset.col, 'replace'); },
    'cmp-details': (el) => {
      closePopover({ restore: false });
      if (set().view.blind) { say('Turn off Blind to see or change a column\'s label, role and author.'); return; }
      openForm(el.dataset.col, 'details');
    },
    'cmp-paste': (el) => openForm(el.dataset.col, 'paste'),
    'cmp-cancel-form': (el) => closeForm(el.dataset.col),
    'cmp-choose-file': (el) => {
      fileTarget = el.dataset.col;
      refs.file.value = '';
      refs.file.click();
    },
    'cmp-copy-from': (el) => {
      const from = columnById(set(), el.dataset.from);
      if (!from?.source) return;
      const name = `Copy of ${from.source.name}`.slice(0, LIMITS.name);
      const colId = el.dataset.col;
      api.commit(updateColumn(set(), colId, { source: { ...from.source, name } }));
      // A copy is made to be corrected: the source opens for editing at once.
      openForm(colId, 'edit');
      say(sentence(`${columnName(set(), colId)} starts as a copy of ${nameOf(set(), from.id).ref}. Edit it, then Save`));
    },
    'cmp-duplicate': (el) => {
      closePopover({ restore: false });
      const { set: next, id } = duplicateColumn(set(), el.dataset.col);
      if (!id) { say(`A comparison holds up to ${MAX_COLUMNS} columns.`); return; }
      api.commit(next);
      focusColumn(id);
    },
    'cmp-col-mode': (el) => {
      closePopover({ restore: false });
      const value = el.dataset.value;
      const s = set();
      api.commit(updateColumn(s, el.dataset.col, { mode: value === s.view.mode ? null : value }));
      focusColumn(el.dataset.col);
    },
    'cmp-move': (el) => {
      closePopover({ restore: false });
      if (set().view.blind) { say('Turn off Blind to move a column: while it is on, the columns are in report order.'); return; }
      api.commit(moveColumn(set(), el.dataset.col, Number(el.dataset.dir) || 0));
      focusColumn(el.dataset.col);
    },
    'cmp-focus-col': (el) => {
      closePopover({ restore: false });
      api.commit(setView(set(), { layout: 'focus', focus: el.dataset.col }));
      focusColumn(el.dataset.col);
    },
    'cmp-remove': (el) => {
      closePopover({ restore: false });
      const before = set();
      const colId = el.dataset.col;
      const col = columnById(before, colId);
      if (!col) return;
      const letter = columnName(before, colId);
      api.commit(removeColumn(before, colId));
      // Nothing was in an empty slot, so there is nothing to undo. An undo
      // puts focus back on the column it brought back.
      if (col.source) {
        toast(`${letter} removed.`, () => {
          api.commit(before);
          return controlOf(colId);
        });
      }
      requestAnimationFrame(() => root.querySelector('.col__menu, [data-action="cmp-choose-file"]')?.focus({ preventScroll: true }));
    },
  });

  // ── Forms, files, drops and in-column links ────────────────────────────────

  root.addEventListener('change', (event) => {
    const role = event.target.closest?.('[data-form="details"] select[name="role"]');
    if (role) role.form.querySelector('.col-form__fixes').hidden = role.value !== 'fix';
  });

  refs.file.addEventListener('change', async () => {
    const file = refs.file.files && refs.file.files[0];
    const colId = fileTarget;
    fileTarget = null;
    if (!file || !colId) return;
    const read = await readFile(file);
    if (!read.ok) { say(read.message); return; }
    if (read.bundle) { await openBundle(read.bundle); return; }
    setSource(colId, read.source);
  });

  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    const colId = form.dataset.col;
    const col = columnById(set(), colId);
    if (!col) return;
    const error = form.querySelector('.col-form__error');
    const showError = (message) => {
      if (!error) { say(message); return; }
      error.textContent = message;
      error.hidden = false;
    };
    if (form.dataset.form === 'details') {
      const data = new FormData(form);
      api.commit(updateColumn(set(), colId, {
        label: String(data.get('label') || ''),
        role: String(data.get('role') || col.role),
        author: String(data.get('author') || ''),
        fixes: String(data.get('fixes') || '') || null,
      }));
      closeForm(colId);
      return;
    }
    const text = form.querySelector('textarea')?.value || '';
    if (form.dataset.form === 'paste') {
      const message = await takeText(colId, text, 'Pasted text');
      if (message) showError(message);
      return;
    }
    // Edit source: the kind stays what it was; a Dossier document must still read.
    if (!text.trim()) { showError('The source is empty. Cancel keeps the report as it was.'); return; }
    if (col.source.kind === 'dossier') {
      const read = readText(text);
      if (!read.ok) { showError(`This does not read as a Dossier document: ${read.fatal?.message || 'no reason given'}`); return; }
    }
    const before = set();
    compare.ui.forms.delete(colId);
    api.commit(updateColumn(before, colId, { source: { ...col.source, text } }));
    focusColumn(colId);
    toast(`Saved the source of ${columnName(before, colId, true)}.`, () => {
      api.commit(before);
      return controlOf(colId);
    });
  });

  bindDrops(api, root, { setSource, openBundle });

  // A comparison file given to the Open dialog, or dropped on the Reports
  // view, opens here as a whole comparison.
  onComparisonBundle(async (text, name) => {
    const read = await readSource(text, name);
    if (!read.ok || !read.bundle) {
      say(read.message || 'That comparison file could not be read.');
      return;
    }
    if (await openBundle(read.bundle) && currentView() !== 'compare') location.hash = routeFor({ view: 'compare' });
  });

  root.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[data-local]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const colEl = link.closest('.col');
    const target = colEl?.querySelector(link.getAttribute('href'));
    const index = target ? [...colEl.querySelectorAll('.r-h')].indexOf(target) : -1;
    if (index >= 0) compare.sync.jump(colEl.dataset.col, index);
  });

  return { openBundle, focusColumn };
}

/**
 * Files dropped on the view go into a column: onto an empty slot, or onto a
 * filled column to replace its report (with an undo). Dropped anywhere else,
 * a file fills the first empty slot or a new column. The page's own drop
 * handler (open as a report) never sees a drop made here.
 */
function bindDrops(api, root, { setSource, openBundle }) {
  const { compare } = api;
  const hasFiles = (event) => Boolean(event.dataTransfer && [...event.dataTransfer.types].includes('Files'));
  const zoneOf = (event) => event.target.closest?.('.col') || null;
  let lit = null;
  const light = (el) => {
    if (lit === el) return;
    lit?.classList.remove('is-over');
    lit?.querySelector('.drop')?.classList.remove('is-over');
    lit = el;
    lit?.classList.add('is-over');
    lit?.querySelector('.drop')?.classList.add('is-over');
  };
  root.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    light(zoneOf(event));
  });
  root.addEventListener('dragleave', (event) => {
    if (!root.contains(event.relatedTarget)) light(null);
  });
  root.addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const colEl = zoneOf(event);
    light(null);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const read = await readFile(file);
    if (!read.ok) { say(read.message); return; }
    if (read.bundle) { await openBundle(read.bundle); return; }
    let colId = colEl?.dataset.col || null;
    const set = compare.set;
    if (!colId) {
      colId = set.columns.find((col) => !col.source)?.id || null;
      if (!colId) {
        const added = addColumn(set, { role: 'other' });
        if (!added.id) { say(`A comparison holds up to ${MAX_COLUMNS} columns. Drop the file on a column to replace its report.`); return; }
        api.commit(added.set, { save: false });
        colId = added.id;
      }
    }
    setSource(colId, read.source);
  });
}
