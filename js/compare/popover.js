/**
 * One small popover helper for the Compare view: the column menu, the Add
 * column menu, the Comparisons switcher and the Options panel.
 *
 * One popover is open at a time. It opens under its button, keeps on screen,
 * and closes on Escape, on a click outside it and when another opens; focus
 * goes back to the button that opened it. A `menu` popover moves between its
 * items with the arrow keys, Home and End, and Tab closes it. A dialog
 * popover on a wide screen (Options, the switcher) closes when Tab leaves
 * it, and focus carries on from its button, so it is never left open behind
 * the control being used. Below 700 px a popover marked `sheet` opens as a
 * sheet under the header with a scrim, and Tab stays inside it until it
 * closes.
 *
 * Also here: the undo toast, which unlike the page's status toast has a
 * button and so takes the pointer.
 */

/** The phone layout: one column at a time, popovers as sheets. */
export const PHONE = '(max-width: 699px)';

let current = null;

export function isPhone() {
  return typeof matchMedia === 'function' && matchMedia(PHONE).matches;
}

/**
 * What Tab stops on inside `root`, in order. A radio group's unchecked radios
 * carry tabindex -1 (roving focus), so they are not stops: counting the
 * hidden "Off" sync radio as the last one let Tab out of the Options sheet.
 */
function focusables(root) {
  return [...root.querySelectorAll('button, [href], input, textarea, select, [tabindex]')]
    .filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
}

/** The undo toast's button, while the toast shows. */
function visibleUndo() {
  const button = document.querySelector('.cmp-toast.is-visible button');
  return button && button.getClientRects().length ? button : null;
}

function place(pop, opener) {
  if (pop.classList.contains('is-sheet')) {
    pop.style.left = '';
    pop.style.top = '';
    return;
  }
  const box = opener.getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  let left = pop.dataset.align === 'start' ? box.left : box.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = box.bottom + 6;
  if (top + height > window.innerHeight - 8 && box.top - height - 6 > 8) top = box.top - height - 6;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(Math.max(8, top))}px`;
}

/**
 * Open `pop` under `opener`.
 *
 * @param {HTMLElement} pop
 * @param {HTMLElement} opener
 * @param {{sheet?: boolean, focus?: 'first'|'checked'|HTMLElement|null, onClose?: () => void, scrim?: HTMLElement}} [opts]
 */
export function openPopover(pop, opener, opts = {}) {
  if (current && current.pop === pop) {
    closePopover();
    return;
  }
  closePopover({ restore: false });
  const sheet = Boolean(opts.sheet) && isPhone();
  pop.classList.toggle('is-sheet', sheet);
  pop.hidden = false;
  opener?.setAttribute('aria-expanded', 'true');
  if (opts.scrim) opts.scrim.hidden = !sheet;
  place(pop, opener);
  current = { pop, opener, sheet, onClose: opts.onClose, scrim: opts.scrim };
  const target = opts.focus instanceof HTMLElement ? opts.focus
    : opts.focus === null ? null
      : (opts.focus === 'checked' && pop.querySelector('[aria-checked="true"], [aria-selected="true"]')) || focusables(pop)[0];
  target?.focus({ preventScroll: true });
}

/**
 * @param {{restore?: boolean}} [opts] restore: focus back to the opener
 */
export function closePopover({ restore = true } = {}) {
  if (!current) return;
  const { pop, opener, onClose, scrim } = current;
  current = null;
  pop.hidden = true;
  pop.classList.remove('is-sheet');
  if (scrim) scrim.hidden = true;
  opener?.setAttribute('aria-expanded', 'false');
  if (typeof onClose === 'function') onClose();
  if (restore && opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
}

/** Bind once: Escape, outside clicks, menu arrow keys and the sheet trap. */
export function bindPopovers() {
  document.addEventListener('keydown', (event) => {
    if (!current) return;
    const { pop, sheet } = current;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePopover();
      return;
    }
    if (event.key === 'Tab') {
      if (!sheet && pop.getAttribute('role') === 'menu') {
        // Tab out of a menu closes it, like a native one: focus goes back to
        // its button and the Tab carries on from there.
        closePopover();
        return;
      }
      // The toast's Undo, while it shows, is the stop after the popover's
      // last control: deleting a comparison in the switcher offers an undo
      // that a keyboard has to be able to reach without closing it.
      const undo = visibleUndo();
      const items = [...focusables(pop), ...(undo ? [undo] : [])];
      const active = document.activeElement;
      const at = items.indexOf(active);
      if (sheet) {
        // Tab stays inside the sheet, round and round.
        event.preventDefault();
        if (!items.length) return;
        const next = at < 0 ? (event.shiftKey ? items.length - 1 : 0)
          : (at + (event.shiftKey ? -1 : 1) + items.length) % items.length;
        items[next].focus();
        return;
      }
      // A dialog popover on a wide screen. Shift+Tab before its first control
      // lands on its button; Tab past its last one closes it, focus goes back
      // to the button and the Tab moves on to whatever follows it.
      if (event.shiftKey ? at <= 0 : (at < 0 || at === items.length - 1)) {
        if (event.shiftKey) event.preventDefault();
        closePopover();
        return;
      }
      if (undo && (active === undo || items[at + 1] === undo)) {
        event.preventDefault();
        items[at + (event.shiftKey ? -1 : 1)].focus();
      }
      return;
    }
    if (pop.getAttribute('role') === 'menu' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const items = [...pop.querySelectorAll('[role^="menuitem"]:not([disabled])')];
      if (!items.length) return;
      event.preventDefault();
      const at = items.indexOf(document.activeElement);
      let next = 0;
      if (event.key === 'ArrowDown') next = (at + 1) % items.length;
      else if (event.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
      else if (event.key === 'End') next = items.length - 1;
      items[next].focus();
    }
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (!current) return;
    const { pop, opener } = current;
    if (pop.contains(event.target) || opener?.contains(event.target)) return;
    // Undo in the toast acts on what the popover shows: it stays open.
    if (event.target.closest?.('.cmp-toast')) return;
    // A tap on a sheet's scrim is a way of saying "close", like Escape, so
    // focus goes back to the button that opened it.
    const scrim = Boolean(event.target.closest?.('.cmp-scrim'));
    if (scrim) event.preventDefault();
    closePopover({ restore: scrim });
  }, true);
  // Focus that moves somewhere else by any other road (a screen reader's
  // cursor, a shortcut) closes a popover that is not a sheet, so it never
  // stays open over a control it no longer belongs to. Undo in the toast acts
  // on what the popover shows, so it is left open for that.
  document.addEventListener('focusin', (event) => {
    if (!current || current.sheet) return;
    const { pop, opener } = current;
    const target = event.target;
    if (!(target instanceof Element) || pop.contains(target) || opener?.contains(target)) return;
    if (target.closest('.cmp-toast')) return;
    closePopover({ restore: false });
  });
  window.addEventListener('resize', () => {
    if (current && !current.sheet) place(current.pop, current.opener);
  });
}

// ── Undo toast ───────────────────────────────────────────────────────────────

let toastTimer = 0;
let toastUndo = null;
/** Where focus was when the toast appeared, for when it goes away under it. */
let toastReturn = null;

function shown(el) {
  return el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;
}

/** Focus is nowhere a keyboard user can carry on from: the page, or the toast. */
function focusLost(host) {
  const active = document.activeElement;
  return !active || active === document.body || host.contains(active);
}

/**
 * A message with an Undo button, for six seconds. A newer one replaces it and
 * the older change stays done.
 *
 * The Undo button takes itself away, so the undo says where focus goes next:
 * `undo` may return (or resolve to) an element, or a function that finds one
 * once the change is on screen. When nothing is named, focus goes back to
 * where it was when the toast appeared, if that is still on screen.
 *
 * @param {HTMLElement} host the toast element (a polite live region)
 * @param {string} message
 * @param {(() => (HTMLElement|(() => HTMLElement|null)|null|void|Promise<unknown>))|null} undo
 */
export function undoToast(host, message, undo = null, ms = 6000) {
  if (!host) return;
  clearTimeout(toastTimer);
  toastUndo = typeof undo === 'function' ? undo : null;
  const active = document.activeElement;
  toastReturn = active && active !== document.body && !host.contains(active) ? active : null;
  host.replaceChildren();
  const text = document.createElement('span');
  text.textContent = message;
  host.append(text);
  if (toastUndo) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--sm';
    button.textContent = 'Undo';
    button.addEventListener('click', async () => {
      const fn = toastUndo;
      const back = toastReturn;
      hideToast(host, { refocus: false });
      if (!fn) return;
      let next = null;
      try {
        next = await fn();
      } catch {
        next = null;
      }
      requestAnimationFrame(() => {
        if (!focusLost(host)) return;
        const target = typeof next === 'function' ? next() : next;
        const el = shown(target) ? target : shown(back) ? back : null;
        el?.focus({ preventScroll: true });
      });
    });
    host.append(button);
  }
  host.classList.add('is-visible');
  toastTimer = setTimeout(() => hideToast(host), ms);
}

/**
 * @param {HTMLElement} host
 * @param {{refocus?: boolean}} [opts] refocus: a toast that times out under
 *   the keyboard puts focus back where it was when it appeared
 */
export function hideToast(host, { refocus = true } = {}) {
  clearTimeout(toastTimer);
  toastUndo = null;
  if (!host) return;
  if (refocus && host.contains(document.activeElement) && shown(toastReturn)) toastReturn.focus({ preventScroll: true });
  toastReturn = null;
  host.classList.remove('is-visible');
  setTimeout(() => {
    if (!host.classList.contains('is-visible')) host.replaceChildren();
  }, 250);
}
