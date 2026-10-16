/**
 * Each review criterion's menu: Rename, Clear marks, Move up, Move down and
 * Remove (design spec 7.3.9), behind one button at the right of the
 * criterion's summary row. They used to be an always-visible row of five
 * buttons under every open criterion.
 *
 * The menu opens inside the panel, under its button, not as one of the
 * view's popovers (js/compare/popover.js): on a phone the panel is itself
 * such a popover, a sheet, and only one may be open at a time, so a popover
 * menu would have closed the sheet it was opened from.
 *
 * It behaves as a menu: focus moves to its first item, the arrow keys, Home
 * and End move between items, Escape closes it and puts focus back on its
 * button, and a click elsewhere or focus moving away closes it. Its items
 * are not Tab stops (tabindex -1, set by the caller), so Tab leaves it, and
 * the focus leaving closes it. Closing it on the Tab key itself hid the
 * item the phone sheet's Tab trap had just moved focus to, and focus was
 * lost. Escape is caught on the window before the view's own handlers,
 * which would otherwise close the whole panel or sheet.
 */

const OPEN = '.crit__menu:not([hidden])';

/** @param {HTMLElement} menu */
function buttonOf(menu) {
  return menu.parentElement?.querySelector(':scope > .crit__more') || null;
}

function items(menu) {
  return [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')];
}

/**
 * Close every open criterion menu in `scope`.
 *
 * @param {ParentNode} scope
 * @param {{restore?: boolean}} [opts] restore: focus back on the menu's button
 */
export function closeCritMenus(scope, { restore = false } = {}) {
  for (const menu of scope.querySelectorAll(OPEN)) {
    menu.hidden = true;
    menu.replaceChildren();
    const button = buttonOf(menu);
    button?.setAttribute('aria-expanded', 'false');
    if (restore) button?.focus({ preventScroll: true });
  }
}

/**
 * Open the menu next to `button` with `html` as its items, or close it when
 * it is open already.
 *
 * @param {HTMLElement} button `.crit__more`
 * @param {string} html the menu items, built by the caller
 */
export function toggleCritMenu(button, html) {
  const menu = button.parentElement?.querySelector(':scope > .crit__menu');
  if (!menu) return;
  const scope = button.closest('.cmp-panel') || document;
  if (!menu.hidden) {
    closeCritMenus(scope, { restore: true });
    return;
  }
  closeCritMenus(scope);
  menu.innerHTML = html;
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  items(menu)[0]?.focus({ preventScroll: true });
  menu.scrollIntoView?.({ block: 'nearest' });
}

/**
 * Bind once, on the panel element: keys, outside clicks and focus leaving.
 *
 * @param {HTMLElement} panel `#cmpPanel`
 */
export function bindCritMenus(panel) {
  // On the window, in the capture phase: before the popover helper (which
  // would close a sheet) and the panel (which would close itself) see it.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const menu = panel.querySelector(OPEN);
    if (!menu) return;
    const active = document.activeElement;
    if (!menu.contains(active) && active !== buttonOf(menu)) return;
    event.preventDefault();
    event.stopPropagation();
    closeCritMenus(panel, { restore: true });
  }, true);

  panel.addEventListener('keydown', (event) => {
    const menu = event.target.closest?.('.crit__menu');
    if (!menu || menu.hidden) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const list = items(menu);
    if (!list.length) return;
    event.preventDefault();
    const at = list.indexOf(document.activeElement);
    let next = 0;
    if (event.key === 'ArrowDown') next = (at + 1) % list.length;
    else if (event.key === 'ArrowUp') next = (at - 1 + list.length) % list.length;
    else if (event.key === 'End') next = list.length - 1;
    list[next].focus();
  });

  // Focus moving anywhere outside the menu and its button closes it. Focus
  // that leaves for nowhere (a click on plain text) is handled by the
  // pointer listener below.
  document.addEventListener('focusin', (event) => {
    const menu = panel.querySelector(OPEN);
    if (!menu) return;
    const to = event.target;
    if (!(to instanceof Element) || menu.contains(to) || to === buttonOf(menu)) return;
    closeCritMenus(panel);
  });

  document.addEventListener('pointerdown', (event) => {
    const menu = panel.querySelector(OPEN);
    if (!menu) return;
    const target = event.target;
    if (menu.contains(target) || buttonOf(menu)?.contains(target)) return;
    closeCritMenus(panel);
  }, true);
}
