/**
 * The Compare toolbar and its Options panel.
 *
 * One row that never wraps. As the window narrows, controls fold into
 * Options in three tiers (the class on each control is the contract with
 * css/compare.css): `.tb-x` (Blind, Add column) below 1440 px, `.tb-w`
 * (render mode, Sync, the panel buttons) below 1100 px, `.tb-m` (the set
 * title and switcher, Differences) below 700 px, where the phone layout
 * takes over. The against picker and previous, counter and next stay at
 * every width. Options lists only what is folded, through `data-tier`.
 *
 * Controls for the analysis features (differences, the side panels, Blind)
 * carry `data-feature` and stay hidden until that feature switches itself on
 * (`#compareView.has-<feature>`), so nothing here is a dead button.
 *
 * Every control is a `data-action` button or a `data-change` select; the
 * handlers are in js/compare/actions.js. The same action may sit in the row
 * and in Options; `syncToolbar` keeps both in step.
 */

import { escHtml } from '../neorgon-dom.js';
import { icon } from './icons.js';
import { MAX_COLUMNS, ROLE_WORDS, MODE_WORDS } from './model.js';
import { nameOf, displayColumns, roleAttr } from './blind.js';

const SYNC_WORDS = { sections: 'Sections', scroll: 'Scroll', off: 'Off' };

function toggle(action, label, tier, feature, extra = '') {
  return `<button type="button" class="btn toggle${tier ? ` ${tier}` : ''}"${feature ? ` data-feature="${feature}"` : ''}`
    + ` data-action="${action}" aria-pressed="false"${extra}><span class="box">${icon('check')}</span>${label}</button>`;
}

function modeGroup(tier = '') {
  return `<div class="seg${tier ? ` ${tier}` : ''}" role="radiogroup" aria-label="Render mode">`
    + ['format', 'original'].map((value) => `<button type="button" role="radio" aria-checked="false" data-action="cmp-set-mode" data-value="${value}">${MODE_WORDS[value]}</button>`).join('')
    + '</div>';
}

/** The toolbar's markup. Built once; `syncToolbar` updates it. */
export function toolbarHtml() {
  return `
  <div class="tb-title tb-m">
    <button type="button" class="set-title" data-action="cmp-rename-set"><span class="set-title__text">Comparison</span>${icon('pencil')}</button>
    <button type="button" class="btn btn--quiet btn--sm btn--icon" id="cmpSwitcherBtn" data-action="cmp-switcher"
      aria-haspopup="dialog" aria-expanded="false" aria-controls="cmpSwitcher"
      aria-label="Comparisons: switch, rename, delete or start a new one" title="Comparisons">${icon('down')}</button>
  </div>
  <div class="seg focus-switch" role="tablist" aria-label="Column to read"></div>
  <button type="button" class="btn btn--sm tb-all" data-action="cmp-layout" data-value="columns">${icon('columns')}All columns</button>
  <span class="tb-sep tb-w" aria-hidden="true"></span>
  ${modeGroup('tb-w')}
  <label class="picker tb-w"><span class="lbl">Sync</span>
    <select data-change="cmp-sync" aria-label="Sync scrolling">
      ${Object.entries(SYNC_WORDS).map(([value, word]) => `<option value="${value}">${word}</option>`).join('')}
    </select>${icon('down', 'caret')}</label>
  <span class="tb-sep tb-w" aria-hidden="true" data-feature="diff"></span>
  ${toggle('cmp-toggle-diff', 'Differences', 'tb-m', 'diff')}
  <div class="tb-row2">
    <div class="tb-against" data-feature="diff"></div>
    <div class="tb-nav" role="group" aria-label="Move through the report">
      <button type="button" class="btn btn--icon btn--sm" data-action="cmp-step" data-dir="-1" aria-label="Previous heading" aria-keyshortcuts="[">${icon('left')}</button>
      <span class="counter"><span class="counter__main">0 of 0</span><small class="counter__sub">headings</small></span>
      <button type="button" class="btn btn--icon btn--sm" data-action="cmp-step" data-dir="1" aria-label="Next heading" aria-keyshortcuts="]">${icon('right')}</button>
    </div>
  </div>
  <span class="tb-spacer"></span>
  <div class="seg tb-w" role="group" aria-label="Side panel" data-feature="panels">
    <button type="button" data-action="cmp-panel" data-panel="sections" aria-pressed="false">Sections</button>
    <button type="button" data-action="cmp-panel" data-panel="review" aria-pressed="false">Review</button>
  </div>
  ${toggle('cmp-toggle-blind', 'Blind', 'tb-x', 'blind')}
  <button type="button" class="btn tb-x" data-action="cmp-add-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="cmpAddMenu">${icon('plus')}Add column</button>
  <button type="button" class="btn btn--icon tb-options" id="cmpOptionsBtn" data-action="cmp-options"
    aria-haspopup="dialog" aria-expanded="false" aria-controls="cmpOptions" aria-label="Options" title="Options">${icon('sliders')}</button>`;
}

/** The Options panel: the folded controls, grouped, each under a label. */
export function optionsHtml() {
  return `
  <h2 id="cmpOptionsHeading">Options</h2>
  <div class="opt" data-tier="m"><span>Comparison</span>
    <button type="button" class="btn opt__title" data-action="cmp-rename-set">${icon('pencil')}<span class="set-title__text">Comparison</span></button>
    <button type="button" class="btn btn--quiet" data-action="cmp-switcher" aria-controls="cmpSwitcher">Switch, rename or start a new one</button></div>
  <div class="opt" data-tier="w"><span>Render mode</span>${modeGroup()}</div>
  <div class="opt" data-tier="w"><span id="cmpOptSync">Sync</span>
    <div class="seg" role="radiogroup" aria-labelledby="cmpOptSync">
      ${Object.entries(SYNC_WORDS).map(([value, word]) => `<button type="button" role="radio" aria-checked="false" data-action="cmp-set-sync" data-value="${value}">${word}</button>`).join('')}
    </div></div>
  <div class="opt" data-tier="m" data-feature="diff"><span>Differences</span>${toggle('cmp-toggle-diff', 'Show differences', '', '')}</div>
  <div class="opt" data-tier="w" data-feature="panels"><span>Side panel</span>
    <div class="seg" role="group" aria-label="Side panel">
      <button type="button" data-action="cmp-panel" data-panel="sections" aria-pressed="false">Sections</button>
      <button type="button" data-action="cmp-panel" data-panel="review" aria-pressed="false">Review</button>
    </div></div>
  <div class="opt" data-tier="x" data-feature="blind"><span>Review</span>${toggle('cmp-toggle-blind', 'Blind: hide who wrote each report', '', '')}</div>
  <div class="opt" data-tier="x"><span>Columns</span>
    <button type="button" class="btn" data-action="cmp-add-menu" aria-haspopup="menu" aria-controls="cmpAddMenu">${icon('plus')}Add column</button></div>`;
}

/** The Add column menu: one item per role. */
export function addMenuHtml() {
  const words = {
    human: 'Human report',
    agent: 'Agent output',
    fix: 'Fixes to another column',
    other: 'Other report',
  };
  return Object.entries(words).map(([role, word]) => `<button type="button" role="menuitem" data-action="cmp-add-column" data-role="${role}">`
    + `<span class="rb rb--sm" data-role="${role}" aria-hidden="true">${escHtml(ROLE_WORDS[role][0])}</span>${word}</button>`).join('');
}

/**
 * Put every control in step with the set.
 *
 * @param {HTMLElement} root `#compareView`
 * @param {object} set
 * @param {{counter: {main: string, sub: string, label?: string}}} info
 */
export function syncToolbar(root, set, info = {}) {
  const view = set.view;
  for (const el of root.querySelectorAll('.set-title__text')) el.textContent = set.title;
  for (const el of root.querySelectorAll('.set-title')) el.setAttribute('aria-label', `Rename the comparison, now "${set.title}"`);

  checkGroup(root, '[data-action="cmp-set-mode"]', view.mode);
  checkGroup(root, '[data-action="cmp-set-sync"]', view.sync);
  for (const select of root.querySelectorAll('select[data-change="cmp-sync"]')) select.value = view.sync;

  for (const el of root.querySelectorAll('[data-action="cmp-toggle-diff"]')) el.setAttribute('aria-pressed', String(Boolean(view.diff.on)));
  for (const el of root.querySelectorAll('[data-action="cmp-toggle-blind"]')) el.setAttribute('aria-pressed', String(Boolean(view.blind)));
  for (const el of root.querySelectorAll('[data-action="cmp-panel"]')) el.setAttribute('aria-pressed', String(view.panel === el.dataset.panel));

  const full = set.columns.length >= MAX_COLUMNS;
  for (const el of root.querySelectorAll('[data-action="cmp-add-menu"]')) {
    el.disabled = full;
    el.title = full ? `A comparison holds up to ${MAX_COLUMNS} columns` : '';
  }

  const focus = root.querySelector('.focus-switch');
  const sig = JSON.stringify([view.focus, view.blind, ...set.columns.map((col) => [col.id, col.role, col.label])]);
  if (focus && focus.dataset.sig !== sig) {
    // Rebuilt only when it changed, and focus stays on the same column's tab,
    // so arrowing through the tabs is not interrupted by the re-render.
    const had = focus.contains(document.activeElement) ? document.activeElement.dataset.col : null;
    focus.dataset.sig = sig;
    focus.innerHTML = focusTabs(set);
    if (had) focus.querySelector(`[data-col="${had}"]`)?.focus({ preventScroll: true });
  }
  updateCounter(root, info.counter);
}

/** One tab per column, in the order the columns are laid out (report order while blind). */
function focusTabs(set) {
  const view = set.view;
  return displayColumns(set).map((col) => {
    const selected = col.id === view.focus;
    const name = nameOf(set, col);
    const word = name.blind ? name.label : ROLE_WORDS[col.role];
    const extra = name.blind ? '' : `<span class="visually-hidden">, column ${escHtml(name.ref)}, ${escHtml(col.label)}</span>`;
    return `<button type="button" role="tab" id="cmp-tab-${col.id}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}"`
      + ` aria-controls="cmp-col-${col.id}" data-action="cmp-focus" data-col="${col.id}" data-role="${roleAttr(set, col)}">`
      + `<span class="rb" aria-hidden="true">${escHtml(name.mark)}</span><span class="focus-switch__word">${escHtml(word)}</span>`
      + `${extra}</button>`;
  }).join('');
}

/**
 * The counter between previous and next: "3 of 8" over "headings in A".
 *
 * It is not a live region: it follows every scroll frame, and a screen
 * reader would read it out the whole time the columns move. A step with the
 * buttons, `[` or `]` announces where it landed instead
 * (js/compare/reading.js `step`).
 *
 * @param {HTMLElement} root
 * @param {{main: string, sub: string, unit?: string}} [counter]
 */
export function updateCounter(root, counter = { main: '0 of 0', sub: 'headings' }) {
  const main = root.querySelector('.counter__main');
  const sub = root.querySelector('.counter__sub');
  if (main && main.textContent !== counter.main) main.textContent = counter.main;
  if (sub && sub.textContent !== counter.sub) sub.textContent = counter.sub;
  for (const el of root.querySelectorAll('[data-action="cmp-step"]')) {
    const prev = el.dataset.dir === '-1';
    el.setAttribute('aria-label', `${prev ? 'Previous' : 'Next'} ${counter.unit || 'heading'}`);
  }
}

/** Mark the one radio in each group whose value is `value`; roving tabindex. */
function checkGroup(root, selector, value) {
  for (const el of root.querySelectorAll(selector)) {
    const on = el.dataset.value === value;
    el.setAttribute('aria-checked', String(on));
    el.tabIndex = on ? 0 : -1;
  }
}

/**
 * Arrow keys inside a radio group or a tab list move to the next choice and
 * choose it, as the ARIA patterns expect.
 */
export function bindGroupKeys(root) {
  root.addEventListener('keydown', (event) => {
    const group = event.target.closest?.('[role="radiogroup"], [role="tablist"]');
    if (!group || !root.contains(group)) return;
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
    if (!(event.key in keys)) return;
    const items = [...group.querySelectorAll('[role="radio"], [role="tab"]')].filter((el) => !el.disabled && el.getClientRects().length);
    if (!items.length) return;
    event.preventDefault();
    const at = Math.max(0, items.indexOf(event.target.closest('[role="radio"], [role="tab"]')));
    const step = keys[event.key];
    const next = step === 'first' ? 0 : step === 'last' ? items.length - 1 : (at + step + items.length) % items.length;
    items[next].focus();
    items[next].click();
  });
}
