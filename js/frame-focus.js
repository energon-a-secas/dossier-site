/**
 * A focus ring for report frames: a Compare column's Original layout and an
 * imported HTML report in the Reports view.
 *
 * A frame is a Tab stop, and the focus it takes goes into the frame's own
 * document, where nothing of ours can be drawn. Chromium then matches
 * neither `:focus` on the iframe nor `:focus-within` on any element around
 * it, so CSS alone shows no ring at all (WCAG 2.4.7). This page can only
 * read which frame has focus from its own `document.activeElement`, which it
 * marks with `data-focus-ring`; css/style.css draws the ring just inside the
 * frame's edge, so no scroller around it clips it.
 *
 * Focus going from one frame straight to another (a click, or Tab between
 * two frames side by side) fires nothing in this page, so while a frame has
 * focus the mark is checked four times a second. Nothing here touches a
 * frame's document: a sealed `allow-scripts` frame is marked the same way
 * as a static one. A ring for a frame clicked into is on purpose: in Compare
 * it marks the column the arrow keys scroll.
 */

let bound = false;
let ringed = null;
let timer = 0;

function sync() {
  const active = document.activeElement;
  const target = active && active.localName === 'iframe' && document.hasFocus() ? active : null;
  if (ringed && ringed !== target) ringed.removeAttribute('data-focus-ring');
  ringed = target;
  if (target) {
    target.setAttribute('data-focus-ring', '');
    if (!timer) timer = setInterval(sync, 250);
  } else if (timer) {
    clearInterval(timer);
    timer = 0;
  }
}

/** Bind once, at boot (js/embeds.js `bindEmbeds`). */
export function bindFrameFocus() {
  if (bound) return;
  bound = true;
  // The frame is the active element only once the blur has run its course.
  window.addEventListener('blur', () => setTimeout(sync, 0));
  window.addEventListener('focus', sync);
  document.addEventListener('focusin', sync);
}
