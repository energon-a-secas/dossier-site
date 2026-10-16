/**
 * The side panel (Sections or Review): where it sits and how it opens.
 *
 * It docks beside the columns only when every column keeps at least
 * `--panel-dock-min` (400 px) next to it, which is 1600 px for three
 * columns. Narrower, it lies over the right of the columns with a shadow and
 * no scrim, and the columns do not reflow, so their measure never collapses
 * to 33 characters. The pin ("Keep the panel beside the columns") docks it
 * anyway. On load the stored panel opens only if it docks; below 700 px it
 * never opens on load, and opens as a sheet under the header, with a scrim,
 * Tab kept inside and Escape or the scrim closing it (js/compare/popover.js).
 *
 * Escape closes a panel that lies over the columns and puts focus back on
 * the toggle that opened it. Design spec 7.3.13 and 7.3.14. An overlay panel
 * takes focus when opened, and closes without moving focus when keyboard
 * focus reaches a column control under it, so a control that has focus is
 * never hidden under the panel (WCAG 2.4.11).
 *
 * The panel's sticky head and foot are measured into `--panel-head-h` and
 * `--panel-foot-h`, which css/compare.css turns into scroll padding: a
 * control that takes focus scrolls clear of both instead of under them.
 *
 * An open panel follows the window across 700 px in both directions: beside
 * or over the columns it becomes the phone sheet, and the sheet becomes the
 * panel again, with what was focused in it still focused. Left to the wide
 * layout's rules, a panel open when the window narrowed stayed in the page
 * as a plain block that neither its close button nor Escape could close.
 */

import {
  openPopover, closePopover, isPhone, PHONE,
} from './popover.js';
import { setView } from './model.js';
import { icon } from './icons.js';
import { redrawRulers } from './ruler.js';

const PANEL_TITLES = { sections: 'Sections', review: 'Review' };

function cssPx(name, fallback) {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * @param {object} api from js/compare/index.js
 * @param {{render: (name: string, host: HTMLElement) => void}} content draws a panel's body
 */
export function createPanel(api, content) {
  const { compare } = api;
  const refs = compare.refs;
  const root = refs.root;
  const panel = refs.panel;
  const state = {
    pinned: false, opener: null, decidedFor: null, shown: null,
    /** The layout last drawn was the phone's; null before the first. */
    phone: null,
    /** The sheet is closing to become the wide panel: it stays open. */
    keep: false,
  };

  /** Every column keeps the docking width beside the panel. */
  function fits() {
    const set = compare.set;
    if (!set) return false;
    const n = set.view.layout === 'focus' ? 1 : Math.max(1, set.columns.length);
    const width = refs.body.clientWidth;
    if (!width) return false;
    const panelWidth = cssPx('--panel-width', 360);
    const min = cssPx('--panel-dock-min', 400);
    const gap = cssPx('--col-gap', 10);
    // The Add column tile after the last column takes its own track.
    const add = refs.columns.querySelector(':scope > .cmp-addcol');
    const extra = add && add.getClientRects().length ? add.offsetWidth + gap : 0;
    return (width - panelWidth - 20 - extra - (n - 1) * gap) / n >= min;
  }

  const docked = () => !isPhone() && (state.pinned || fits());
  const asSheet = () => panel.classList.contains('is-sheet') && !panel.hidden;

  function head(name) {
    const title = PANEL_TITLES[name];
    return `<div class="panel__head">
      <h2 id="cmpPanelTitle">${title}</h2>
      <button type="button" class="btn btn--quiet btn--sm btn--icon pin panel__wide" data-action="cmp-pin" aria-pressed="${state.pinned}"
        aria-label="Keep the panel beside the columns" title="Keep beside the columns">${icon('pin')}</button>
      <button type="button" class="btn btn--quiet btn--sm btn--icon" data-action="cmp-close-panel" aria-label="Close ${title.toLowerCase()}" title="Close">${icon('x')}</button>
    </div>`;
  }

  /** Draw the open panel's frame and body. The body keeps its own DOM between draws. */
  function draw(name) {
    let frame = panel.querySelector(':scope > .panel');
    if (!frame || frame.dataset.panel !== name) {
      panel.innerHTML = `<section class="panel panel--${name}" data-panel="${name}" aria-labelledby="cmpPanelTitle">${head(name)}<div class="panel__body"></div></section>`;
      frame = panel.firstElementChild;
      // Another panel starts at its top, not where the last one was scrolled.
      panel.scrollTop = 0;
    }
    for (const pin of panel.querySelectorAll('[data-action="cmp-pin"]')) pin.setAttribute('aria-pressed', String(state.pinned));
    content.render(name, frame.querySelector('.panel__body'));
    measureBars();
  }

  // The sticky head and foot, measured: the Review foot grows with a wrapped
  // record sentence or the copy fallback, so a fixed scroll padding was short.
  const bars = typeof ResizeObserver === 'function' ? new ResizeObserver(writeBars) : null;
  function writeBars() {
    const px = (el) => `${el && el.getClientRects().length ? Math.round(el.getBoundingClientRect().height) : 0}px`;
    panel.style.setProperty('--panel-head-h', px(panel.querySelector('.panel__head')));
    panel.style.setProperty('--panel-foot-h', px(panel.querySelector('.panel__foot')));
  }
  function measureBars() {
    if (!bars) return;
    bars.disconnect();
    for (const el of panel.querySelectorAll('.panel__head, .panel__foot')) bars.observe(el);
    writeBars();
  }
  function forgetBars() {
    bars?.disconnect();
    panel.style.removeProperty('--panel-head-h');
    panel.style.removeProperty('--panel-foot-h');
  }

  /** The view is on screen (not the Reports view, not booting). */
  const onScreen = () => root.isConnected && root.getClientRects().length > 0;

  /** Take the panel out of the page. */
  function hide() {
    panel.hidden = true;
    panel.replaceChildren();
    forgetBars();
    state.shown = null;
  }

  /** The sheet closed by Escape, the scrim or its close button: the panel is closed. */
  function sheetClosed() {
    if (state.keep) return;
    if (compare.set?.view.panel) api.commit(setView(compare.set, { panel: null }));
  }

  /**
   * Open panel `name` as the phone sheet. Focus stays where it was inside
   * the panel, or goes to its first control; closing the sheet puts it on
   * the Options button, where the panel toggles live on a phone.
   */
  function openSheet(name, { focus = 'first', opener = null } = {}) {
    draw(name);
    openPopover(panel, root.querySelector('#cmpOptionsBtn') || opener, {
      sheet: true,
      scrim: refs.scrim,
      focus,
      onClose: sheetClosed,
    });
  }

  /** Put the panel where the set and the width say. Called after every render. */
  function layout() {
    const set = compare.set;
    if (!set) return;
    const name = set.view.panel;
    const phone = isPhone();
    const crossed = state.phone !== null && state.phone !== phone;
    state.phone = phone;
    // A set just opened: its stored panel opens only where it would dock.
    if (state.decidedFor !== set.id && refs.body.clientWidth) {
      state.decidedFor = set.id;
      if (name && (phone || !fits())) {
        hide();
        api.commit(setView(set, { panel: null }), { save: false });
        return;
      }
    }
    if (phone) {
      root.classList.remove('panel-open', 'panel-docked', 'panel-overlay');
      root.classList.toggle('is-review', name === 'review');
      if (name && !asSheet()) {
        // The window narrowed under an open panel: it becomes the sheet.
        if (crossed && onScreen()) {
          const active = panel.contains(document.activeElement) ? document.activeElement : 'first';
          openSheet(name, { focus: active });
          return;
        }
        // Only a sheet the reader opened; anything else closes.
        hide();
        api.commit(setView(set, { panel: null }), { save: false });
        return;
      }
      if (!name && asSheet()) closePopover({ restore: false });
      if (name) draw(name);
      else if (!panel.hidden) hide();
      return;
    }
    let refocus = null;
    if (asSheet()) {
      // The window widened under the sheet: it stays open, as the panel.
      if (name && panel.contains(document.activeElement)) refocus = document.activeElement;
      state.keep = Boolean(name);
      closePopover({ restore: false });
      state.keep = false;
      if (name) state.opener = root.querySelector(`.cmp-toolbar [data-action="cmp-panel"][data-panel="${name}"]`);
    }
    const open = Boolean(name);
    const dock = open && docked();
    const was = `${root.classList.contains('panel-open')}|${root.classList.contains('panel-docked')}`;
    root.classList.toggle('panel-open', open);
    root.classList.toggle('panel-docked', dock);
    root.classList.toggle('panel-overlay', open && !dock);
    root.classList.toggle('is-review', name === 'review');
    panel.hidden = !open;
    if (open) draw(name);
    else {
      panel.replaceChildren();
      forgetBars();
    }
    state.shown = name;
    if (refocus?.isConnected) refocus.focus({ preventScroll: true });
    if (was !== `${open}|${dock}` || crossed) {
      // The columns changed width: headings and change ticks moved.
      requestAnimationFrame(() => {
        compare.sync.remeasure();
        redrawRulers();
      });
    }
  }

  /**
   * Open or close a panel from its toggle.
   *
   * @param {string} name sections or review
   * @param {HTMLElement} opener
   */
  function toggle(name, opener) {
    const set = compare.set;
    const next = set.view.panel === name ? null : name;
    if (isPhone()) {
      closePopover({ restore: false });
      if (!next) {
        api.commit(setView(set, { panel: null }));
        return;
      }
      // The toggle sat in the Options sheet, which has closed: focus comes
      // back to the Options button.
      openSheet(next, { opener });
      api.commit(setView(set, { panel: next }));
      return;
    }
    state.opener = opener && !opener.closest('#cmpOptions') ? opener : root.querySelector(`.cmp-toolbar [data-action="cmp-panel"][data-panel="${name}"]`);
    api.commit(setView(set, { panel: next }));
    if (next) {
      // Focus goes into a panel opened from Options (its toggle has closed
      // with Options) and into one lying over the columns: left on the
      // toggle, the next 17 Tabs went through columns hidden under it.
      // The first control that shows: a hidden one (a closed criterion's
      // marks, a part of the panel with nothing to say) refuses focus.
      const first = [...panel.querySelectorAll('.panel__body :is(button, summary, textarea, input)')]
        .find((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && !el.closest('details:not([open]) > :not(summary)'));
      if (opener?.closest('#cmpOptions') || overlay()) (first || panel.querySelector('.panel__head button'))?.focus({ preventScroll: true });
    }
  }

  /** Close the panel; focus goes back to the toggle that opened it. */
  function close({ restore = true } = {}) {
    if (asSheet()) {
      closePopover({ restore });
      return;
    }
    const set = compare.set;
    if (!set?.view.panel) return;
    const name = set.view.panel;
    api.commit(setView(set, { panel: null }));
    if (restore) {
      const target = state.opener?.isConnected && state.opener.getClientRects().length ? state.opener
        : root.querySelector(`.cmp-toolbar [data-action="cmp-panel"][data-panel="${name}"]`);
      (target && target.getClientRects().length ? target : root.querySelector('#cmpOptionsBtn'))?.focus({ preventScroll: true });
    }
  }

  function pin() {
    state.pinned = !state.pinned;
    layout();
  }

  /** The panel lies over the columns (not docked, not a sheet). */
  const overlay = () => root.classList.contains('panel-overlay');

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !overlay()) return;
    if (!onScreen()) return;
    event.preventDefault();
    close();
  });

  // Keyboard focus that reaches a column control under the overlay (Shift+Tab
  // out of the panel, or Tab through the columns) closes the panel and stays
  // where it landed, now in view. Only across: the overlay spans the columns'
  // full height, and the toolbar above it never sits under it. A click on the
  // part of a column that shows leaves the panel open.
  document.addEventListener('focusin', (event) => {
    if (!overlay() || !onScreen()) return;
    const target = event.target;
    if (!(target instanceof Element) || !refs.columns.contains(target)) return;
    if (!target.matches(':focus-visible')) return;
    const p = panel.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    if (r.right > p.left && r.left < p.right) close({ restore: false });
  });

  // Crossing 700 px either way, whatever caused it (a resize, a zoom, a
  // rotated phone). js/compare/index.js also redraws on it, which lays the
  // panel out again; `layout` sees the crossing once, whichever comes first.
  if (typeof matchMedia === 'function') {
    matchMedia(PHONE).addEventListener?.('change', () => {
      if (compare.set) layout();
    });
  }

  return {
    layout, toggle, close, pin, overlay, asSheet,
  };
}
