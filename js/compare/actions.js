/**
 * What the Compare toolbar, the Options panel and the Comparisons switcher
 * do. Registered through js/actions.js with a `cmp-` prefix (never
 * `compare-`, which the authored compare block's own controls use). A
 * column's own controls are in js/compare/column-actions.js.
 */

import { registerActions } from '../actions.js';
import { view as currentView } from '../chrome.js';
import { routeFor } from '../router.js';
import { say, sentence } from '../share.js';
import {
  addColumn, setTitle, setView, blankSet, MAX_COLUMNS, LIMITS,
} from './model.js';
import { readSet, writeSet, deleteSet, listSets } from './store.js';
import { openPopover, closePopover, undoToast } from './popover.js';
import { fillSwitcher } from './switcher.js';
import { loadExample } from './example.js';
import { columnEl } from './view.js';
import { registerColumnActions } from './column-actions.js';

/** @param {object} api from js/compare/index.js */
export function registerCompareActions(api) {
  const { compare } = api;
  const refs = compare.refs;
  const root = refs.root;
  const { focusColumn } = registerColumnActions(api);

  const set = () => compare.set;
  const toast = (message, undo) => undoToast(refs.toast, message, undo);
  const optionsOpener = () => root.querySelector('#cmpOptionsBtn');
  /** A control inside the Options panel opens its popover from the Options button. */
  const anchorFor = (el) => (el.closest('#cmpOptions') ? optionsOpener() : el);
  /** The switcher's own button where the toolbar shows it, else Options. */
  const switcherOpener = () => {
    const button = root.querySelector('#cmpSwitcherBtn');
    return button && button.getClientRects().length ? button : optionsOpener();
  };
  /** A row of the open switcher, by set id. */
  const switcherRow = (id) => refs.switcher.querySelector(`.sw__row[data-set-id="${CSS.escape(id)}"] .sw__open`);

  // ── Switcher ───────────────────────────────────────────────────────────────

  async function openSwitcher(opener) {
    const s = set();
    const input = await fillSwitcher(refs.switcher, {
      currentId: compare.saved ? s?.id : null,
      currentTitle: s?.title || '',
      unsaved: Boolean(s) && !compare.saved,
      blind: Boolean(s?.view.blind),
    });
    openPopover(refs.switcher, opener || optionsOpener(), { sheet: true, scrim: refs.scrim, focus: input });
  }
  api.openSwitcher = openSwitcher;

  async function refreshSwitcher() {
    if (refs.switcher.hidden) return;
    const filter = refs.switcher.querySelector('#cmpSwitcherFilter')?.value || '';
    const s = set();
    await fillSwitcher(refs.switcher, {
      currentId: compare.saved ? s?.id : null, currentTitle: s?.title || '', unsaved: Boolean(s) && !compare.saved, filter,
      blind: Boolean(s?.view.blind),
    });
  }

  /** Replace an element with a text input for a moment; Enter keeps, Escape drops. */
  function inlineEdit(el, value, { label, max, onCommit }) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cmp-inline-input';
    input.value = value;
    input.maxLength = max;
    input.setAttribute('aria-label', label);
    input.dataset.textSurface = '';
    el.hidden = true;
    el.after(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      input.remove();
      el.hidden = false;
      if (keep && next && next !== value) onCommit(next);
      if (el.isConnected) el.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  async function openExample({ push }) {
    const result = await loadExample();
    if (!result.ok) {
      say(result.message);
      return false;
    }
    api.openSet(result.set, { saved: false, example: true, push });
    say('Opened the illustrative example. It is not saved until you change it.');
    return true;
  }

  // ── Registrations ──────────────────────────────────────────────────────────

  registerActions({
    'cmp-options': (el) => openPopover(refs.options, el, { sheet: true, scrim: refs.scrim, focus: 'first' }),
    'cmp-switcher': (el) => openSwitcher(anchorFor(el)),
    'cmp-add-menu': (el) => {
      if (set().columns.length >= MAX_COLUMNS) return;
      openPopover(refs.addMenu, anchorFor(el), { focus: 'first' });
    },
    'cmp-add-column': (el) => {
      closePopover({ restore: false });
      const { set: next, id } = addColumn(set(), { role: el.dataset.role });
      if (!id) {
        say(`A comparison holds up to ${MAX_COLUMNS} columns.`);
        return;
      }
      api.commit(setView(next, { focus: id }), { save: Boolean(compare.saved) });
      focusColumn(id, '[data-action="cmp-choose-file"]');
      columnEl(refs, id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    'cmp-focus': (el) => {
      const before = compare.sync.leader;
      api.commit(setView(set(), { focus: el.dataset.col }));
      // The column that just appeared catches up with the one being read.
      requestAnimationFrame(() => {
        compare.sync.remeasure();
        if (before && before !== el.dataset.col) compare.sync.follow(before);
        api.scheduleCounter();
      });
    },
    'cmp-layout': (el) => {
      closePopover({ restore: false });
      api.commit(setView(set(), { layout: el.dataset.value === 'focus' ? 'focus' : 'columns' }));
      requestAnimationFrame(() => { compare.sync.remeasure(); compare.sync.follow(set().view.focus); });
      // "All columns" hides itself (and the column menu that also offers it
      // has closed), so focus goes to the column that was being read rather
      // than to the page.
      const colId = set().view.focus;
      focusColumn(colId);
      requestAnimationFrame(() => columnEl(refs, colId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    },
    'cmp-set-mode': (el) => api.commit(setView(set(), { mode: el.dataset.value })),
    'cmp-set-sync': (el) => api.commit(setView(set(), { sync: el.dataset.value })),
    'cmp-step': (el) => api.step(Number(el.dataset.dir) < 0 ? -1 : 1),
    'cmp-rename-set': (el) => {
      closePopover({ restore: false });
      // Renaming shows the title, which Blind hides: it can name the authors.
      if (set().view.blind) {
        say('The title is hidden while Blind is on. Turn off Blind to rename the comparison.');
        return;
      }
      const target = el.isConnected && el.getClientRects().length ? el : root.querySelector('.set-title');
      inlineEdit(target, set().title, {
        label: 'Comparison title', max: LIMITS.title, onCommit: (title) => api.commit(setTitle(set(), title)),
      });
    },
    'cmp-open-set': async (el) => {
      closePopover({ restore: false });
      const found = await readSet(el.dataset.setId);
      if (!found) { say('That comparison is no longer saved in this browser.'); return; }
      api.openSet(found, { saved: true, push: true });
    },
    'cmp-new-set': () => {
      closePopover({ restore: false });
      api.openSet(blankSet(), { saved: false, push: true });
      focusColumn(set().columns[0].id, '[data-action="cmp-choose-file"]');
    },
    'cmp-open-example': async () => {
      closePopover({ restore: false });
      await openExample({ push: true });
    },
    // The example card on the welcome screen and in the Open dialog.
    'cmp-example': async () => {
      const dialog = document.getElementById('importDialog');
      if (dialog?.open) dialog.close();
      await openExample({ push: false });
      if (currentView() !== 'compare') location.hash = routeFor({ view: 'compare' });
    },
    'cmp-rename-row': (el) => {
      const row = el.closest('.sw__row');
      const open = row?.querySelector('.sw__open');
      const title = row?.querySelector('.sw__title')?.textContent || '';
      if (!open) return;
      const id = el.dataset.setId;
      inlineEdit(open, title, {
        label: 'New title', max: LIMITS.title,
        onCommit: async (next) => {
          if (set()?.id === id) {
            api.commit(setTitle(set(), next));
            await api.persistNow();
          } else {
            const found = await readSet(id);
            if (found) await writeSet(setTitle(found, next));
          }
          await refreshSwitcher();
          switcherRow(id)?.focus();
        },
      });
    },
    'cmp-delete-set': async (el) => {
      const id = el.dataset.setId;
      const record = await readSet(id);
      if (!record || !(await deleteSet(id))) { say('That comparison could not be deleted.'); return; }
      const wasOpen = set()?.id === id;
      // The open set's title stays hidden while Blind is on, even in a toast.
      const shownTitle = wasOpen && set()?.view.blind ? null : record.title;
      // Opening another set closes every popover. The switcher is where the
      // reader is working, so it opens again at its filter rather than
      // leaving focus on nothing.
      const reopen = async () => {
        if (refs.switcher.hidden) await openSwitcher(switcherOpener());
        else await refreshSwitcher();
      };
      if (wasOpen) {
        const next = (await listSets())[0];
        const found = next ? await readSet(next.id) : null;
        api.openSet(found || blankSet(), { saved: Boolean(found) });
      }
      await reopen();
      refs.switcher.querySelector('#cmpSwitcherFilter')?.focus();
      toast(shownTitle === null ? 'Deleted the comparison that was under Blind review.' : sentence(`Deleted "${shownTitle}"`), async () => {
        await writeSet(record);
        if (wasOpen) api.openSet(record, { saved: true });
        await reopen();
        // Focus lands on the comparison that came back (opening the switcher
        // again put it on the filter).
        const row = switcherRow(id);
        row?.focus();
        return () => switcherRow(id) || refs.switcher.querySelector('#cmpSwitcherFilter') || switcherOpener();
      });
    },
  });

  root.addEventListener('change', (event) => {
    const select = event.target.closest?.('select[data-change="cmp-sync"]');
    if (select) api.commit(setView(set(), { sync: select.value }));
  });
}
