/** The platform owns trapping and Escape; this module owns launch/return focus. */
const openers = new WeakMap();

export function openDialog(dialog, opener = document.activeElement) {
  if (!dialog || dialog.open) return;
  openers.set(dialog, opener);
  dialog.showModal();
}

/**
 * Put focus back where the reader was, or on the nearest visible control.
 *
 * The opener can be gone or hidden by the time a dialog closes: on a phone it
 * sat in the Header Kit's menu, which closed when it was pressed. Then focus
 * goes to the given fallback if it can take focus, else to the kit's menu
 * button (the way back to that opener), else to `<main>` (tabindex -1). A
 * candidate counts only once it really holds focus, so an element that is not
 * focusable never leaves the reader on `<body>`.
 */
function restoreFocus(opener, fallback) {
  const candidates = [
    opener,
    fallback,
    document.querySelector('.header-overflow-toggle'),
    document.getElementById('main'),
  ];
  for (const el of candidates) {
    if (!el?.isConnected || el === document.body || !el.getClientRects().length) continue;
    el.focus({ preventScroll: true });
    if (document.activeElement === el) return;
  }
}

/** Bind once. Keep a visible close button for touch users. */
export function bindDialog(dialog, fallback) {
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-dialog-close]')) dialog.close();
  });
  // Contain Escape so a site's page shortcut does not also dismiss a sheet.
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') event.stopPropagation();
  });
  dialog.addEventListener('close', () => {
    restoreFocus(openers.get(dialog), fallback);
    openers.delete(dialog);
  });
}
