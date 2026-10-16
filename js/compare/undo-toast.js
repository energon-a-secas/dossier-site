/**
 * The Compare view's undo toast: a message with an Undo button, in the
 * bottom right corner (bottom of the window on a phone). Unlike the page's
 * status toast it has a button, so it takes the pointer.
 *
 * WCAG 2.2.1: the time limit stops while the reader is on the toast (focus
 * in it, the pointer over it, or the tab in the background) and starts
 * again, with at least four seconds, once they leave it. Ten seconds is
 * enough to Tab to Undo at a screen reader's pace. Escape on it hides it,
 * and a toast that goes away under the keyboard puts focus back on the last
 * control the reader was on.
 *
 * It shares its corner with the page's status toast, which it lifts above
 * itself while it shows (WCAG 2.4.11). Imported through js/compare/popover.js
 * by the actions that offer an undo.
 */

/** How long an undo toast shows when nobody is on it. */
export const TOAST_MS = 10000;
/** The least it shows for again once the reader leaves it. */
const TOAST_AGAIN_MS = 4000;

let toastTimer = 0;
let toastDeadline = 0;
let toastRemaining = 0;
let toastHeld = false;
let toastUndo = null;
/** Where focus goes back to when the toast goes away under it. */
let toastReturn = null;
/** The last focus the page saw was in the toast. */
let toastHadFocus = false;
const bound = new WeakSet();

function shown(el) {
  return el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;
}

/** Focus is nowhere a keyboard user can carry on from: the page, or the toast. */
function focusLost(host) {
  const active = document.activeElement;
  return !active || active === document.body || host.contains(active);
}

const visible = (host) => host.classList.contains('is-visible');
const readerOn = (host) => host.contains(document.activeElement) || host.matches(':hover');

function armToast(host, ms) {
  clearTimeout(toastTimer);
  toastHeld = false;
  toastDeadline = Date.now() + ms;
  toastTimer = setTimeout(() => hideToast(host), ms);
}

function holdToast(host) {
  if (toastHeld || !visible(host)) return;
  clearTimeout(toastTimer);
  toastTimer = 0;
  toastHeld = true;
  toastRemaining = Math.max(0, toastDeadline - Date.now());
}

function releaseToast(host) {
  if (!toastHeld || !visible(host) || readerOn(host) || document.hidden) return;
  armToast(host, Math.max(toastRemaining, TOAST_AGAIN_MS));
}

/**
 * The page's status toast (js/neorgon-dom.js `showToast`, the same corner)
 * moves up above this one while it shows: a status message used to cover
 * Undo and the focus ring on it (WCAG 2.4.11). css/style.css reads the lift.
 */
function liftPageToast(host) {
  const lift = parseFloat(getComputedStyle(host).bottom) + host.offsetHeight + 8 - 24;
  document.documentElement.style.setProperty('--toast-lift', `${Math.max(0, Math.ceil(lift))}px`);
}

/** Bind a toast host once: the hold, Escape, and where focus goes back to. */
function bindToast(host) {
  if (bound.has(host)) return;
  bound.add(host);
  const later = () => setTimeout(() => releaseToast(host), 0);
  host.addEventListener('focusin', () => holdToast(host));
  host.addEventListener('pointerenter', () => holdToast(host));
  host.addEventListener('focusout', (event) => {
    if (host.contains(event.relatedTarget)) return;
    // Left on purpose (Tab, a click elsewhere): when the toast runs out,
    // focus is not pulled back from wherever the reader went.
    toastHadFocus = false;
    later();
  });
  host.addEventListener('pointerleave', later);
  host.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !visible(host)) return;
    event.preventDefault();
    event.stopPropagation();
    hideToast(host);
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? holdToast(host) : releaseToast(host)));
  // Kept current while the toast shows: the last control on screen the
  // reader was on. The one focused when the toast appeared can be gone by
  // the time it goes away (a closed menu's item, a removed column).
  document.addEventListener('focusin', (event) => {
    if (!visible(host)) return;
    const target = event.target;
    toastHadFocus = target instanceof Node && host.contains(target);
    if (target instanceof HTMLElement && !toastHadFocus && shown(target)) toastReturn = target;
  });
  // Leaving the view hides the toast with it; the lift goes too.
  document.addEventListener('dossier-view', (event) => {
    if (event.detail?.view !== 'compare' && visible(host)) hideToast(host, { refocus: false });
  });
  // The phone toast is full width and placed lower: measured again.
  window.addEventListener('resize', () => {
    if (visible(host)) liftPageToast(host);
  });
}

/**
 * A message with an Undo button, for ten seconds or until the reader leaves
 * it. A newer one replaces it and the older change stays done.
 *
 * The Undo button takes itself away, so the undo says where focus goes next:
 * `undo` may return (or resolve to) an element, or a function that finds one
 * once the change is on screen. When nothing is named, focus goes back to
 * where it was when the toast appeared, if that is still on screen.
 *
 * @param {HTMLElement} host the toast element (a polite live region)
 * @param {string} message
 * @param {(() => (HTMLElement|(() => HTMLElement|null)|null|void|Promise<unknown>))|null} undo
 * @param {number} [ms]
 */
export function undoToast(host, message, undo = null, ms = TOAST_MS) {
  if (!host) return;
  bindToast(host);
  // A newer toast over one the reader is on: they stay on it.
  const holding = visible(host) && readerOn(host);
  const hadFocus = host.contains(document.activeElement);
  clearTimeout(toastTimer);
  toastTimer = 0;
  toastHeld = false;
  toastUndo = typeof undo === 'function' ? undo : null;
  if (!hadFocus) {
    const active = document.activeElement;
    toastReturn = active && active !== document.body && shown(active) ? active : null;
    // Focused but hidden (the item of a menu that just closed): whatever the
    // action focuses next, once it is on screen.
    if (!toastReturn) {
      requestAnimationFrame(() => {
        const now = document.activeElement;
        if (!toastReturn && now && now !== document.body && !host.contains(now) && shown(now)) toastReturn = now;
      });
    }
  }
  host.replaceChildren();
  const text = document.createElement('span');
  text.textContent = message;
  host.append(text);
  let button = null;
  if (toastUndo) {
    button = document.createElement('button');
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
      } catch (err) {
        // Said, not swallowed: the reader sees it, and so does the browser
        // suite's console watch.
        console.error('The undo did not finish', err);
        undoToast(host, 'That could not be undone.');
        next = null;
      }
      requestAnimationFrame(() => {
        if (!focusLost(host)) return;
        const target = typeof next === 'function' ? next() : next;
        const el = shown(target) ? target : shown(back) ? back : null;
        if (!el) return;
        el.focus({ preventScroll: true });
        // Never under the Review panel's sticky foot or off screen.
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    });
    host.append(button);
  }
  host.classList.add('is-visible');
  liftPageToast(host);
  if (hadFocus) (button || (shown(toastReturn) ? toastReturn : null))?.focus({ preventScroll: true });
  if (holding && readerOn(host)) {
    toastHeld = true;
    toastRemaining = ms;
  } else {
    armToast(host, ms);
  }
}

/**
 * @param {HTMLElement} host
 * @param {{refocus?: boolean}} [opts] refocus: a toast that goes away under
 *   the keyboard puts focus back on the last control the reader was on
 */
export function hideToast(host, { refocus = true } = {}) {
  clearTimeout(toastTimer);
  toastTimer = 0;
  toastHeld = false;
  toastUndo = null;
  if (!host) return;
  const active = document.activeElement;
  const lost = host.contains(active) || ((!active || active === document.body) && toastHadFocus);
  if (refocus && lost) {
    const target = shown(toastReturn) ? toastReturn
      : document.querySelector('#compareView .col__menu, #compareView [data-action="cmp-choose-file"]');
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  toastReturn = null;
  toastHadFocus = false;
  document.documentElement.style.removeProperty('--toast-lift');
  host.classList.remove('is-visible');
  setTimeout(() => {
    if (!host.classList.contains('is-visible')) host.replaceChildren();
  }, 250);
}
