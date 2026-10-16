/**
 * The Display options dialog, opened from the "Aa" button in the header.
 *
 * Each option is one `<fieldset>` of radio buttons inside `#displayBody`, so
 * an option added later (text size, line width, typeface) is one more
 * fieldset and one more entry in OPTIONS, with no change to the dialog code.
 *
 * Theme is applied by js/appearance.js, the classic script that runs before
 * the first paint, because that is the only place a stored choice can take
 * effect without a flash. This module only asks for a change
 * (`dossier-appearance`) and reads the current choice back from
 * `html[data-appearance-pref]`, which is right even when storage is blocked.
 */

import { openDialog, bindDialog } from './dialogs.js';

/**
 * name: the radio group's `name`. read(): the current value.
 * write(value): apply a new value.
 */
const OPTIONS = [
  {
    name: 'theme',
    values: ['system', 'light', 'dark'],
    read: () => document.documentElement.dataset.appearancePref || 'system',
    write: (value) => document.dispatchEvent(new CustomEvent('dossier-appearance', {
      detail: { preference: value },
    })),
  },
];

/**
 * Bind once: every change applies at once, there is no Save step.
 *
 * @param {HTMLDialogElement|null} dialog
 * @param {HTMLElement|null} fallback the "Aa" button, where focus returns
 *   when it is visible; js/dialogs.js picks the next visible control when not
 */
export function bindDisplay(dialog, fallback) {
  labelInMenu(fallback);
  if (!dialog) return;
  bindDialog(dialog, fallback);
  dialog.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'radio') return;
    const option = OPTIONS.find((o) => o.name === input.name);
    if (option && option.values.includes(input.value)) option.write(input.value);
  });
}

/**
 * Show the dialog with every group set to what is in effect now, and focus
 * starting on the checked choice. showModal() focuses the first radio, which
 * is System, so Space there would quietly replace a Light or Dark choice.
 */
export function openDisplay(dialog, opener) {
  if (!dialog) return;
  syncDisplay(dialog);
  openDialog(dialog, opener);
  dialog.querySelector('input[type="radio"]:checked')?.focus();
}

/**
 * Give the "Aa" button a visible name while it sits in the kit's phone menu.
 *
 * In the bar it is an icon-only control: the kit draws a button whose only
 * element child is an SVG as a square glyph, and its name is its aria-label.
 * Below 700 px the kit moves it (moves, never clones) into the `...` menu,
 * where the other rows read "Open" and "Share" and this one read only "Aa".
 * So while it is in the menu it carries a `<span>` with the same words as its
 * aria-label, and the span leaves when the kit moves it back to the bar. The
 * kit's own menu row styles lay the glyph and the words out; no header CSS
 * is added here.
 *
 * @param {HTMLElement|null} button
 */
export function labelInMenu(button) {
  const actions = button?.closest('.header-actions');
  if (!button || !actions) return;
  const sync = () => {
    const label = button.querySelector(':scope > .ds-menu-label');
    const inMenu = Boolean(button.closest('.header-menu'));
    if (inMenu && !label) {
      const span = document.createElement('span');
      span.className = 'ds-menu-label';
      span.textContent = button.getAttribute('aria-label') || 'Display options';
      button.append(span);
    } else if (!inMenu && label) {
      label.remove();
    }
  };
  // The kit moves the button on its own media query; follow the move itself.
  new MutationObserver(sync).observe(actions, { childList: true, subtree: true });
  sync();
}

export function syncDisplay(dialog) {
  for (const option of OPTIONS) {
    const current = option.read();
    for (const input of dialog.querySelectorAll(`input[type="radio"][name="${option.name}"]`)) {
      input.checked = input.value === current;
    }
  }
}
