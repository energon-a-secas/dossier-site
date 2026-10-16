/**
 * The toolbar controls of the analysis features and what they do:
 * Differences on and off, the "against" picker with its menu (the base
 * column, Show removed words, Ignore case, Ignore punctuation and quote
 * style), the panel toggles, Blind, Word marks, and the ghost rows' Show.
 *
 * Registered through js/actions.js with the `cmp-` prefix, like the rest of
 * the Compare view. The toggles themselves are drawn by js/compare/toolbar.js
 * (hidden until a feature switches itself on); the against picker and its
 * menu are drawn here, since only this feature knows what goes in them.
 */

import { escHtml } from '../neorgon-dom.js';
import { registerActions } from '../actions.js';
import { say } from '../share.js';
import { icon } from './icons.js';
import { setView, ROLE_WORDS } from './model.js';
import { nameOf, displayColumns, roleAttr } from './blind.js';
import { openPopover } from './popover.js';

const OPTIONS = [
  ['showRemoved', 'Show removed words'],
  ['ignoreCase', 'Ignore case'],
  ['ignorePunctuation', 'Ignore punctuation and quote style'],
];

/**
 * @param {object} api from js/compare/index.js
 * @param {{baseId: () => string|null, panel: object, goToSection: (el: HTMLElement) => void,
 *   wordMarks: Set<string>, onWordMarks: () => void}} parts
 */
export function bindDiffControls(api, parts) {
  const { compare } = api;
  const refs = compare.refs;
  const root = refs.root;
  const set = () => compare.set;

  const menu = document.createElement('div');
  menu.className = 'cmp-pop cmp-diffmenu';
  menu.id = 'cmpDiffMenu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-labelledby', 'cmpDiffMenuHeading');
  menu.hidden = true;
  root.append(menu);

  function menuHtml(s) {
    const base = parts.baseId();
    const bases = displayColumns(s).filter((col) => col.source).map((col) => {
      const name = nameOf(s, col);
      const words = name.blind ? name.label : `${col.label}`;
      return `<button type="button" role="radio" aria-checked="${col.id === base}" tabindex="${col.id === base ? 0 : -1}" data-action="cmp-set-base" data-col="${col.id}" data-role="${roleAttr(s, col)}">`
        + `<span class="rb rb--sm" aria-hidden="true">${escHtml(name.mark)}</span><span class="dm__name">${escHtml(words)}</span>`
        + `${name.blind ? '' : `<span class="visually-hidden">, column ${escHtml(name.ref)}</span>`}</button>`;
    }).join('');
    const toggles = OPTIONS.map(([key, label]) => `<button type="button" class="btn btn--quiet toggle dm__opt" data-action="cmp-diff-opt" data-opt="${key}"`
      + ` aria-pressed="${Boolean(s.view.diff[key])}"><span class="box">${icon('check')}</span>${label}</button>`).join('');
    return `<h2 id="cmpDiffMenuHeading">Differences against</h2>
      <div class="dm__bases" role="radiogroup" aria-labelledby="cmpDiffMenuHeading">${bases || '<p class="dm__empty">Put a report in a column first.</p>'}</div>
      <div class="dm__opts">${toggles}</div>`;
  }

  /** The picker in the toolbar: "against [B] Agent". */
  function pickerHtml(s) {
    const base = parts.baseId();
    if (!base) {
      return `<button type="button" class="picker against" id="cmpAgainst" disabled aria-label="Differences: no report to compare against yet">`
        + `<span class="lbl">against</span><span class="picker__name">no report yet</span>${icon('down', 'caret')}</button>`;
    }
    const col = s.columns.find((c) => c.id === base);
    const name = nameOf(s, col);
    const word = name.blind ? name.label : ROLE_WORDS[col.role];
    const spoken = name.blind ? name.label : `${name.ref}, ${col.label}`;
    return `<button type="button" class="picker against" id="cmpAgainst" data-action="cmp-against" data-role="${roleAttr(s, col)}"`
      + ` aria-haspopup="dialog" aria-expanded="${!menu.hidden}" aria-controls="cmpDiffMenu" aria-label="Differences against ${escHtml(spoken)}. Options for differences.">`
      + `<span class="lbl">against</span><span class="rb" aria-hidden="true">${escHtml(name.mark)}</span><span class="picker__name">${escHtml(word)}</span>${icon('down', 'caret')}</button>`;
  }

  /**
   * Bring the picker, the menu and the Blind help in step. The menu is
   * rebuilt while closed too: kept from before Blind, its hidden markup
   * still named each column and carried its role.
   */
  function sync() {
    const s = set();
    if (!s) return;
    const host = root.querySelector('.tb-against');
    if (host) {
      const html = pickerHtml(s);
      if (host.dataset.html !== html) {
        // The button is kept and changed in place: it is the menu's opener,
        // and focus goes back to it when the menu closes.
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        const next = tpl.content.firstElementChild;
        const button = host.querySelector('button');
        if (button && next) {
          for (const { name } of [...button.attributes]) if (!next.hasAttribute(name)) button.removeAttribute(name);
          for (const { name, value } of [...next.attributes]) button.setAttribute(name, value);
          button.disabled = next.disabled;
          button.innerHTML = next.innerHTML;
        } else {
          host.innerHTML = html;
        }
        host.dataset.html = html;
      }
    }
    const html = menuHtml(s);
    if (menu.dataset.html !== html) {
      const active = !menu.hidden && menu.contains(document.activeElement) ? document.activeElement.dataset : null;
      const focus = active
        ? `[data-action="${active.action}"]${active.col ? `[data-col="${active.col}"]` : ''}${active.opt ? `[data-opt="${active.opt}"]` : ''}`
        : null;
      menu.innerHTML = html;
      menu.dataset.html = html;
      if (focus) menu.querySelector(focus)?.focus({ preventScroll: true });
    }
    for (const el of root.querySelectorAll('[data-action="cmp-toggle-blind"]')) {
      el.title = 'Hides names, roles and authors and orders the columns by report number. A report that corrects another still reads as an edit of it.';
    }
  }

  registerActions({
    'cmp-toggle-diff': () => {
      const s = set();
      api.commit(setView(s, { diff: { on: !s.view.diff.on } }));
    },
    'cmp-toggle-blind': () => {
      const s = set();
      const on = !s.view.blind;
      // An open label, role and author form shows what Blind hides.
      if (on) {
        for (const [colId, form] of api.compare.ui.forms) {
          if (form.kind === 'details') api.compare.ui.forms.delete(colId);
        }
      }
      api.commit(setView(s, { blind: on }));
      say(on
        ? 'Blind is on: names, roles and authors are hidden, and the columns are in report order.'
        : 'Blind is off: names, roles and authors are back, in the columns\' own order.');
    },
    'cmp-panel': (el) => parts.panel.toggle(el.dataset.panel, el),
    'cmp-close-panel': () => parts.panel.close(),
    'cmp-pin': () => parts.panel.pin(),
    'cmp-section': (el) => parts.goToSection(el),
    'cmp-against': (el) => {
      const s = set();
      const html = menuHtml(s);
      menu.innerHTML = html;
      menu.dataset.html = html;
      openPopover(menu, el, { focus: 'checked' });
    },
    'cmp-set-base': (el) => {
      const s = set();
      if (parts.baseId() === el.dataset.col) return;
      api.commit(setView(s, { diff: { base: el.dataset.col, on: true } }));
      say(`Differences are now marked against ${nameOf(set(), el.dataset.col).ref}.`);
    },
    'cmp-diff-opt': (el) => {
      const s = set();
      const key = el.dataset.opt;
      api.commit(setView(s, { diff: { [key]: !s.view.diff[key] } }));
    },
    'cmp-word-marks': (el) => {
      const key = `${set().id}:${el.dataset.col}`;
      if (parts.wordMarks.has(key)) parts.wordMarks.delete(key);
      else parts.wordMarks.add(key);
      parts.onWordMarks();
    },
    'cmp-ghost': (el) => {
      const ghost = el.closest('.ghost');
      const full = ghost?.querySelector('.ghost__full');
      if (!full) return;
      const open = full.hidden;
      full.hidden = !open;
      ghost.classList.toggle('is-open', open);
      el.setAttribute('aria-expanded', String(open));
      el.textContent = open ? 'Hide' : 'Show';
    },
  });

  return { sync };
}
