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
 * The undo toast is js/compare/undo-toast.js, exported from here too, since
 * every action that offers an undo already imports this module.
 */

export { undoToast, hideToast, TOAST_MS } from './undo-toast.js';

/** The phone layout: one column at a time, popovers as sheets. */
export const PHONE = '(max-width: 699px)';
/**
 * A short window (150 to 200% zoom, a landscape phone): the column heads
 * shrink to their badge row and difference line. Mirrors css/compare.css.
 */
export const SHORT = '(max-height: 560px)';

let current = null;

export function isPhone() {
  return typeof matchMedia === 'function' && matchMedia(PHONE).matches;
}

export function isShort() {
  return typeof matchMedia === 'function' && matchMedia(SHORT).matches;
}

/**
 * Inside a closed <details>, other than in its own summary. Chromium keeps
 * such content laid out (it has a client rect) but refuses it focus.
 */
function inClosedDetails(el) {
  for (let d = el.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) {
    if (d.open) continue;
    const own = [...d.children].find((c) => c.localName === 'summary');
    if (!own || !own.contains(el)) return true;
  }
  return false;
}

function rendered(el) {
  return typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ visibilityProperty: true })
    : el.getClientRects().length > 0;
}

const isRadio = (el) => el.localName === 'input' && el.type === 'radio' && Boolean(el.name);

/**
 * What Tab stops on inside `root`, in order. A radio group's unchecked radios
 * carry tabindex -1 (roving focus), so they are not stops: counting the
 * hidden "Off" sync radio as the last one let Tab out of the Options sheet.
 * A native radio group is one stop too, its checked radio or its first, as
 * it is outside a sheet. A summary is a stop, so a closed criterion can be
 * opened from the keyboard; what its closed details hold is not.
 */
function focusables(root) {
  const all = [...root.querySelectorAll('button, [href], input, textarea, select, summary, [tabindex]')]
    .filter((el) => !el.disabled && el.tabIndex >= 0 && !inClosedDetails(el) && rendered(el));
  return all.filter((el) => {
    if (!isRadio(el)) return true;
    const group = all.filter((o) => isRadio(o) && o.name === el.name && o.form === el.form);
    return el === (group.find((o) => o.checked) || group[0]);
  });
}

/** The undo toast's button, while the toast shows. */
function visibleUndo() {
  const button = document.querySelector('.cmp-toast.is-visible button');
  return button && button.getClientRects().length ? button : null;
}

/**
 * Under its button, or above it when it fits only there. In a short window
 * (a zoomed page, a landscape phone) it fits on neither side: it takes the
 * roomier one and scrolls inside, so its last items stay reachable. It used
 * to run past the window's bottom edge, where no scroll could bring them.
 */
function place(pop, opener) {
  pop.style.maxHeight = '';
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
  const below = window.innerHeight - 8 - (box.bottom + 6);
  const above = box.top - 6 - 8;
  let top = box.bottom + 6;
  if (height > below && height <= above) {
    top = box.top - height - 6;
  } else if (height > below && above > below) {
    top = 8;
    pop.style.maxHeight = `${Math.floor(above)}px`;
  } else if (height > below) {
    pop.style.maxHeight = `${Math.max(96, Math.floor(below))}px`;
  }
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
        const step = event.shiftKey ? -1 : 1;
        const next = at < 0 ? (event.shiftKey ? items.length - 1 : 0) : (at + step + items.length) % items.length;
        // An element that refuses focus is passed over, so Tab can never
        // stall on one: it used to stay put on the stop before it, for good.
        for (let n = 0, i = next; n < items.length; n += 1, i = (i + step + items.length) % items.length) {
          items[i].focus();
          if (document.activeElement === items[i]) break;
        }
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
      // Only the items on screen: a phone hides "Focus on this column", and
      // focusing it failed, so ArrowDown stopped above it.
      const items = [...pop.querySelectorAll('[role^="menuitem"]:not([disabled])')].filter((el) => el.getClientRects().length);
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
