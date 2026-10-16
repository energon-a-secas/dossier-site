/**
 * The change ruler: a 10 px strip on the right edge of a marked column, one
 * tick per change at the change's place in the column, the current change
 * as a longer tick, and a box for the part of the column on screen.
 *
 * It sits beside the scroller, not inside it, so the native scrollbar stays
 * usable between the text and the ruler. It is for the pointer only and
 * hidden from screen readers: the keyboard path is `[`, `]` and the counter.
 * Ticks are measured from the marked elements and drawn again whenever the
 * text changes size (a redraw, a font, the reading size, Show removed words,
 * a ghost row opened), through a ResizeObserver on the text.
 */

const rulers = new Map();

/** Where an element sits in its scroller's content, in pixels from the top. */
export function offsetIn(scrollEl, el) {
  return el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
}

const TICK = { chg: 't-chg', add: 't-ins', del: 't-del' };

function draw(entry) {
  const { ruler, scrollEl } = entry;
  const height = scrollEl.scrollHeight;
  ruler.replaceChildren();
  if (!height || !scrollEl.isConnected) return;
  const frag = document.createDocumentFragment();
  for (const el of scrollEl.querySelectorAll('[data-chg]')) {
    if (!el.getClientRects().length) continue;
    const top = offsetIn(scrollEl, el);
    const tick = document.createElement('span');
    tick.className = `t ${TICK[el.dataset.d] || 't-chg'}`;
    if (el.dataset.chg === String(entry.current)) tick.classList.add('is-current');
    tick.style.top = `${((top / height) * 100).toFixed(3)}%`;
    tick.dataset.chg = el.dataset.chg;
    frag.append(tick);
  }
  const vp = document.createElement('span');
  vp.className = 'vp';
  frag.append(vp);
  ruler.append(frag);
  entry.vp = vp;
  place(entry);
}

function place(entry) {
  const { scrollEl, vp } = entry;
  if (!vp) return;
  const height = scrollEl.scrollHeight || 1;
  vp.style.top = `${((scrollEl.scrollTop / height) * 100).toFixed(3)}%`;
  vp.style.height = `${Math.min(100, (scrollEl.clientHeight / height) * 100).toFixed(3)}%`;
}

/**
 * Give a column's text a ruler, or keep the one it has.
 *
 * @param {string} colId
 * @param {HTMLElement} body `.col__body`
 * @param {HTMLElement} scrollEl `.col__scroll`
 * @param {{onTick: (n: number) => void, onTrack: (y: number) => void}} hooks
 */
export function attachRuler(colId, body, scrollEl, hooks) {
  let entry = rulers.get(colId);
  if (entry && entry.scrollEl === scrollEl && entry.ruler.isConnected) return entry;
  detachRuler(colId);
  const ruler = document.createElement('div');
  ruler.className = 'ruler';
  ruler.setAttribute('aria-hidden', 'true');
  body.append(ruler);
  body.closest('.col')?.classList.add('has-ruler');
  entry = { colId, ruler, scrollEl, vp: null, current: 0, frame: 0 };
  const redraw = () => {
    if (entry.frame) return;
    entry.frame = requestAnimationFrame(() => {
      entry.frame = 0;
      draw(entry);
    });
  };
  entry.redraw = redraw;
  const onScroll = () => place(entry);
  scrollEl.addEventListener('scroll', onScroll, { passive: true });
  ruler.addEventListener('click', (event) => {
    const tick = event.target.closest?.('.t');
    if (tick) {
      hooks.onTick(Number(tick.dataset.chg));
      return;
    }
    const box = ruler.getBoundingClientRect();
    const share = box.height ? (event.clientY - box.top) / box.height : 0;
    hooks.onTrack(share * scrollEl.scrollHeight - scrollEl.clientHeight / 2);
  });
  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(redraw);
    observer.observe(scrollEl);
    const doc = scrollEl.querySelector('.reader__doc');
    if (doc) observer.observe(doc);
  }
  entry.off = () => {
    scrollEl.removeEventListener('scroll', onScroll);
    observer?.disconnect();
    if (entry.frame) cancelAnimationFrame(entry.frame);
  };
  rulers.set(colId, entry);
  redraw();
  return entry;
}

export function detachRuler(colId) {
  const entry = rulers.get(colId);
  if (!entry) return;
  entry.off?.();
  entry.ruler.closest('.col')?.classList.remove('has-ruler');
  entry.ruler.remove();
  rulers.delete(colId);
}

/** Every ruler but these. */
export function keepRulers(colIds) {
  for (const colId of [...rulers.keys()]) if (!colIds.has(colId)) detachRuler(colId);
}

/** Mark the current change's tick, and no other ruler's. */
export function markCurrentTick(colId, n) {
  for (const entry of rulers.values()) {
    entry.current = entry.colId === colId ? n : 0;
    for (const tick of entry.ruler.querySelectorAll('.t')) tick.classList.toggle('is-current', tick.dataset.chg === String(entry.current));
  }
}

export function redrawRulers() {
  for (const entry of rulers.values()) entry.redraw();
}
