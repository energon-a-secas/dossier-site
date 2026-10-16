/**
 * A table's scrolling wrapper is a named, focusable region only while it
 * scrolls sideways. A wrapper is a region with a Tab stop so a keyboard can
 * scroll a wide table, but a compare column with four tables that all fit
 * gave the landmark list four regions named "Table" and the Tab order four
 * stops with nothing to scroll. DOM-side: the Compare columns and the
 * Reports view's Dossier format use it.
 *
 * The static markup keeps the region pattern (role, tabindex and a name), so
 * a page without this script, and every exported file, still lets a
 * keyboard reach a wide table. Here, a ResizeObserver watches each wrapper
 * and its table and takes the pattern off while the table fits, putting it
 * back when it stops fitting (a narrower window, a larger reading size).
 */

const SEL = '.r-table, .table-wrapper';
const observers = new WeakMap();

function fit(el) {
  const overflows = el.scrollWidth > el.clientWidth + 1;
  if (overflows) {
    el.setAttribute('role', 'region');
    el.tabIndex = 0;
    el.setAttribute('aria-label', el.dataset.regionLabel);
    return;
  }
  // Focus never falls to the page: a wrapper that has it keeps the pattern
  // until focus leaves.
  if (document.activeElement === el) {
    el.addEventListener('blur', () => fit(el), { once: true });
    return;
  }
  el.removeAttribute('role');
  el.removeAttribute('tabindex');
  el.removeAttribute('aria-label');
}

/**
 * Watch every table wrapper inside `container`. Call again after the
 * container's content is replaced: the previous watch is dropped.
 *
 * @param {HTMLElement} container
 */
export function fitScrollRegions(container) {
  if (!container) return;
  observers.get(container)?.disconnect();
  observers.delete(container);
  if (typeof ResizeObserver !== 'function') return;
  const wrappers = [...container.querySelectorAll(SEL)];
  if (!wrappers.length) return;
  const observer = new ResizeObserver((entries) => {
    if (!container.isConnected) {
      observer.disconnect();
      observers.delete(container);
      return;
    }
    const seen = new Set();
    for (const entry of entries) {
      const el = entry.target.closest(SEL);
      if (el && !seen.has(el)) {
        seen.add(el);
        fit(el);
      }
    }
  });
  for (const el of wrappers) {
    if (!('regionLabel' in el.dataset)) el.dataset.regionLabel = el.getAttribute('aria-label') || 'Table';
    fit(el);
    observer.observe(el);
    const table = el.querySelector(':scope > table');
    if (table) observer.observe(table);
  }
  observers.set(container, observer);
}
