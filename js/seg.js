/**
 * Segmented single-choice rows, one way everywhere.
 *
 * A row where exactly one choice is in effect is an ARIA radio group, with
 * the keyboard model of the native radios in Display options: one Tab stop
 * (the chosen radio, by roving tabindex), and the arrow keys, Home and End
 * move to a choice and choose it. A row that can have nothing chosen, such
 * as Sections | Review, stays a row of aria-pressed buttons. The render mode
 * rows (the Reports view's HTML bar, the Compare toolbar and Options) take
 * their order from MODE_ROW in js/compare/model.js, so the same choice reads
 * the same way in both views.
 *
 * css/style.css `.seg` styles `aria-checked`, forced colours included.
 */

import { escHtml } from './neorgon-dom.js';

/**
 * A radio group's markup. No tabindex is written: a group nobody has
 * checked yet is still reachable, and `checkRadios` sets the roving one.
 *
 * @param {{label?: string, labelledBy?: string, action: string, attr?: string,
 *   items: Array<[string, string]>, className?: string}} opts
 *   `items` are [value, word] pairs; `attr` names the data attribute that
 *   carries the value (data-value by default)
 * @returns {string}
 */
export function radioSeg({
  label = '', labelledBy = '', action, attr = 'value', items, className = '',
}) {
  const name = labelledBy ? ` aria-labelledby="${escHtml(labelledBy)}"` : ` aria-label="${escHtml(label)}"`;
  const buttons = items.map(([value, word]) => `<button type="button" role="radio" aria-checked="false"`
    + ` data-action="${escHtml(action)}" data-${escHtml(attr)}="${escHtml(value)}">${escHtml(word)}</button>`).join('');
  return `<div class="seg${className ? ` ${escHtml(className)}` : ''}" role="radiogroup"${name}>${buttons}</div>`;
}

/**
 * Check the one radio whose value is `value` in every match of `selector`
 * under `root`, and make it the group's Tab stop.
 *
 * @param {ParentNode} root
 * @param {string} selector the radios
 * @param {string} value
 * @param {string} [attr] the dataset key that carries the value
 */
export function checkRadios(root, selector, value, attr = 'value') {
  for (const el of root.querySelectorAll(selector)) {
    const on = el.dataset[attr] === value;
    el.setAttribute('aria-checked', String(on));
    el.tabIndex = on ? 0 : -1;
  }
}

/**
 * Arrow keys inside a radio group or a tab list move to the next choice and
 * choose it, as the ARIA patterns expect: Left and Up go back, Right and
 * Down go on, both wrap; Home and End go to the ends. Hidden and disabled
 * choices are passed over.
 *
 * @param {HTMLElement} root where to listen
 * @param {string} [groups] which groups under it follow the keys
 */
export function bindGroupKeys(root, groups = '[role="radiogroup"], [role="tablist"]') {
  root.addEventListener('keydown', (event) => {
    const group = event.target.closest?.(groups);
    if (!group || !root.contains(group)) return;
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
    if (!(event.key in keys) || event.altKey || event.ctrlKey || event.metaKey) return;
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
