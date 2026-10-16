/**
 * The Compare view's DOM: the frame of the view, built once, and the columns,
 * reconciled against the set on every change.
 *
 * Reconciling, not rebuilding: a column keeps its element across renders, its
 * head is rewritten only when its markup changed, and its body is redrawn
 * only when what it shows changed (js/compare/column.js `bodyKey`), so a
 * click on the toolbar never reloads a report or loses a scroll position.
 *
 * Layout state lives on `#compareView` as classes (`is-focus-layout`,
 * `has-<feature>`) and on each column (`is-focus`, `col--empty`); the CSS in
 * css/compare.css does the rest, including the phone layout, where one
 * column shows at a time whatever the layout says.
 */

import { toolbarHtml, optionsHtml, addMenuHtml, bindGroupKeys } from './toolbar.js';
import { headHtml, renderBody, bodyKey, labelBody } from './column.js';
import {
  slotHtml, textFormHtml, textFormLabel, fillTextForm, detailsFormHtml,
} from './slot.js';
import { roleAttr, displayColumns } from './blind.js';

/**
 * Build the view's frame inside `#compareView`.
 *
 * @param {HTMLElement} root
 */
export function mountView(root) {
  root.innerHTML = `
    <h2 class="visually-hidden" id="cmpHeading">Compare reports</h2>
    <div class="cmp-toolbar" id="cmpToolbar" role="group" aria-label="Comparison controls">${toolbarHtml()}</div>
    <div class="cmp-body" id="cmpBody">
      <div class="cmp-columns" id="cmpColumns"></div>
      <aside class="cmp-panel" id="cmpPanel" aria-label="Side panel" hidden></aside>
    </div>
    <div class="cmp-pop cmp-options" id="cmpOptions" role="dialog" aria-labelledby="cmpOptionsHeading" hidden>${optionsHtml()}</div>
    <div class="cmp-pop cmp-menu" id="cmpAddMenu" role="menu" aria-label="Add a column" hidden>${addMenuHtml()}</div>
    <div class="cmp-pop cmp-menu" id="cmpColumnMenu" role="menu" aria-label="Column options" hidden></div>
    <div class="cmp-pop cmp-switcher" id="cmpSwitcher" role="dialog" aria-label="Comparisons" hidden></div>
    <div class="cmp-scrim" id="cmpScrim" hidden></div>
    <div class="cmp-toast" id="cmpToast" role="status" aria-live="polite" aria-atomic="true"></div>
    <p class="visually-hidden" id="cmpLive" role="status" aria-live="polite" aria-atomic="true"></p>
    <input type="file" id="cmpFile" hidden tabindex="-1" aria-hidden="true"
      accept=".html,.htm,.md,.markdown,.txt,.json,.yaml,.yml,.xml,.sarif">`;
  bindGroupKeys(root);
  const $ = (id) => root.querySelector(`#${id}`);
  return {
    root,
    toolbar: $('cmpToolbar'),
    body: $('cmpBody'),
    columns: $('cmpColumns'),
    panel: $('cmpPanel'),
    options: $('cmpOptions'),
    addMenu: $('cmpAddMenu'),
    columnMenu: $('cmpColumnMenu'),
    switcher: $('cmpSwitcher'),
    scrim: $('cmpScrim'),
    toast: $('cmpToast'),
    live: $('cmpLive'),
    file: $('cmpFile'),
  };
}

function columnElement(refs, col) {
  let el = refs.columns.querySelector(`:scope > [data-col="${col.id}"]`);
  if (el) return el;
  el = document.createElement('section');
  el.className = 'col';
  el.id = `cmp-col-${col.id}`;
  el.dataset.col = col.id;
  el.setAttribute('aria-labelledby', `cmp-col-${col.id}-label`);
  el.innerHTML = '<header class="col__head"></header><div class="col__body"></div>';
  return el;
}

/**
 * Which of the columns already on the page can stay where they are: the
 * heaviest run whose page positions already climb in the wanted order. A
 * column holding a frame weighs more, because a plain `insertBefore` move
 * reloads its report. Four columns at most, so a quadratic search is enough.
 *
 * @param {number[]} at each wanted column's position now, -1 when new
 * @param {number[]} weight
 * @returns {Set<number>} indexes into the wanted order
 */
function steadyRun(at, weight) {
  const best = at.map(() => 0);
  const prev = at.map(() => -1);
  let top = -1;
  for (let i = 0; i < at.length; i += 1) {
    if (at[i] < 0) continue;
    best[i] = weight[i];
    for (let j = 0; j < i; j += 1) {
      if (at[j] >= 0 && at[j] < at[i] && best[j] + weight[i] > best[i]) {
        best[i] = best[j] + weight[i];
        prev[i] = j;
      }
    }
    if (top < 0 || best[i] > best[top]) top = i;
  }
  const keep = new Set();
  for (let i = top; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

/**
 * Move `el` before `next` in `host`, its frame kept where the browser can.
 *
 * @returns {boolean} true when a frame inside it kept its page
 */
function moveColumn(host, el, next) {
  if (el.parentNode === host && typeof host.moveBefore === 'function') {
    try {
      host.moveBefore(el, next);
      return true;
    } catch {
      // Not movable in place here; the plain move below.
    }
  }
  host.insertBefore(el, next);
  return false;
}

/** A static frame's own scroll position, or 0 (an opaque frame says nothing). */
function frameTop(frame) {
  try {
    return frame?.contentDocument?.scrollingElement?.scrollTop || 0;
  } catch {
    return 0;
  }
}

/**
 * Put the column elements in `els` order, moving only the ones out of place.
 * `moveBefore` keeps a moved column's frame and focus; where the browser
 * lacks it, `insertBefore` reloads a frame, so the fewest frames move and a
 * reloaded one is put back where it was read. Either way a reader's scroll
 * position starts again at the top, so it is put back, and so is focus.
 *
 * @param {HTMLElement} host
 * @param {HTMLElement[]} els
 */
function placeInOrder(host, els) {
  const now = new Map([...host.children].map((el, i) => [el, i]));
  const at = els.map((el) => (now.has(el) ? now.get(el) : -1));
  const keep = steadyRun(at, els.map((el) => (el.querySelector('iframe') ? els.length + 1 : 1)));
  for (let i = els.length - 1; i >= 0; i -= 1) {
    if (keep.has(i)) continue;
    const el = els[i];
    const scroll = el.querySelector('.col__scroll');
    const top = scroll ? scroll.scrollTop : 0;
    const left = scroll ? scroll.scrollLeft : 0;
    const frame = el.querySelector('iframe');
    const read = frameTop(frame);
    const focused = el.contains(document.activeElement) ? document.activeElement : null;
    const kept = moveColumn(host, el, els[i + 1] || null);
    if (scroll && (top || left)) scroll.scrollTo({ left, top, behavior: 'instant' });
    if (frame && read && !kept) {
      frame.addEventListener('load', () => {
        try {
          frame.contentDocument?.scrollingElement?.scrollTo({ top: read, behavior: 'instant' });
        } catch {
          // Not the report's own page any more; js/compare/frame.js puts it back.
        }
      }, { once: true });
    }
    if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }
}

/**
 * Bring the columns in line with the set.
 *
 * @param {object} refs from mountView
 * @param {object} set
 * @param {{records: Map, forms: Map}} ui per-column records and open forms
 * @param {{headInfo?: (col: object, rec: object|null) => object, bodyHooks?: object,
 *   onBody?: (col: object, rec: object) => void, onRemoved?: (colId: string) => void,
 *   tabbed?: boolean}} hooks `tabbed`: the columns are tab panels, one shown at
 *   a time under the tabs (the focus layout, and every layout on a phone)
 */
export function renderColumns(refs, set, ui, hooks = {}) {
  const host = refs.columns;
  const ids = new Set(set.columns.map((col) => col.id));
  for (const el of [...host.children]) {
    if (!ids.has(el.dataset.col)) {
      el.remove();
      ui.records.delete(el.dataset.col);
      if (typeof hooks.onRemoved === 'function') hooks.onRemoved(el.dataset.col);
    }
  }
  host.style.setProperty('--cols', String(Math.max(1, set.columns.length)));
  refs.root.classList.toggle('is-focus-layout', set.view.layout === 'focus');

  const tabbed = set.view.layout === 'focus' || Boolean(hooks.tabbed);
  // Bodies first, then heads: a head shows its stats against the base
  // column's, which exist only once the base's body is drawn. Drawn in one
  // pass, a column left of the base was headed without them after a reload.
  const drawn = [];
  // In the order they are shown, report order while blind, so print, Tab
  // and a screen reader meet the columns in the order the screen has them.
  const order = displayColumns(set);
  const els = order.map((col) => columnElement(refs, col));
  placeInOrder(host, els);
  order.forEach((col, index) => {
    const el = els[index];
    // While blind, not the column's real role (js/compare/blind.js `roleAttr`).
    el.dataset.role = roleAttr(set, col);
    el.classList.toggle('col--empty', !col.source);
    el.classList.toggle('is-focus', col.id === set.view.focus);
    // Under the tabs a column is the panel its tab names; otherwise a region
    // named by its own label.
    el.setAttribute('role', tabbed ? 'tabpanel' : 'region');
    el.setAttribute('aria-labelledby', tabbed ? `cmp-tab-${col.id}` : `cmp-col-${col.id}-label`);

    const body = el.querySelector('.col__body');
    const form = ui.forms.get(col.id) || null;
    let record = ui.records.get(col.id) || null;

    if (form) {
      if (body.dataset.form !== form.kind) {
        body.dataset.form = form.kind;
        body.dataset.key = '';
        record = null;
        ui.records.delete(col.id);
        body.className = 'col__body col__body--form';
        body.innerHTML = form.kind === 'replace' ? slotHtml(set, col, { replacing: true })
          : form.kind === 'details' ? detailsFormHtml(set, col)
            : textFormHtml(set, col, form.kind);
        const formEl = body.querySelector('form');
        if (form.kind === 'edit') fillTextForm(formEl, col.source?.text || '');
        if (form.focus !== false) (body.querySelector('textarea, input, button'))?.focus({ preventScroll: true });
        if (form.kind === 'replace') body.dataset.slotHtml = slotHtml(set, col, { replacing: true });
      } else if (form.kind === 'edit' || form.kind === 'paste') {
        // An open form names its column as the column is named now: Blind
        // turned on while it is open takes the letter and file name away.
        const label = body.querySelector('.col-form__label');
        const text = textFormLabel(set, col, form.kind);
        if (label && label.textContent !== text) label.textContent = text;
      } else if (form.kind === 'replace') {
        const fresh = slotHtml(set, col, { replacing: true });
        if (body.dataset.slotHtml !== fresh) {
          const had = body.contains(document.activeElement) ? document.activeElement.dataset.action : null;
          body.innerHTML = fresh;
          if (had) body.querySelector(`[data-action="${had}"]`)?.focus({ preventScroll: true });
        }
        body.dataset.slotHtml = fresh;
      }
    } else if (!col.source) {
      if (body.dataset.key !== 'slot') {
        body.dataset.key = 'slot';
        delete body.dataset.form;
        body.className = 'col__body';
        body.innerHTML = slotHtml(set, col);
        ui.records.delete(col.id);
        record = null;
      } else {
        // The copy button names a letter that moves with the columns.
        const fresh = slotHtml(set, col);
        if (body.dataset.slot !== fresh) body.innerHTML = fresh;
        body.dataset.slot = fresh;
      }
    } else {
      const key = bodyKey(set, col) + (hooks.bodyKeyExtra ? hooks.bodyKeyExtra(col) : '');
      if (body.dataset.key !== key || !record) {
        body.dataset.key = key;
        delete body.dataset.form;
        record = renderBody(body, set, col, hooks.bodyHooks ? hooks.bodyHooks(col) : {});
        ui.records.set(col.id, record);
        if (typeof hooks.onBody === 'function') hooks.onBody(col, record);
      } else {
        labelBody(body, set, col);
      }
    }
    drawn.push([el, col, record]);
  });

  for (const [el, col, record] of drawn) {
    const head = el.querySelector('.col__head');
    const html = headHtml(set, col, hooks.headInfo ? hooks.headInfo(col, record) : { stats: record?.stats });
    if (head.dataset.html !== html) {
      const hadFocus = head.contains(document.activeElement) ? document.activeElement.dataset.action : null;
      head.innerHTML = html;
      head.dataset.html = html;
      if (hadFocus) head.querySelector(`[data-action="${hadFocus}"]`)?.focus({ preventScroll: true });
    }
  }
}

/** The column element of a column id. */
export function columnEl(refs, colId) {
  return refs.columns.querySelector(`:scope > [data-col="${colId}"]`);
}
