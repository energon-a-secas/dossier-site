/**
 * The brief: what every report in the comparison was asked to write
 * (`set.prompt`), as one line above the columns that opens to the whole text
 * and edits in place. To judge a human report against an agent's, the
 * reviewer needs the question both of them answered.
 *
 * The strip is hidden while there is no brief, so a comparison without one
 * loses no column height; the Review panel offers "Add the brief"
 * (js/compare/review.js). It stays shown under Blind: the brief is shared
 * by every column, so it tells none of them apart. Whether it is open is
 * kept per set for this tab only, closed by default.
 *
 * The edit form is drawn here and submitted here (not through `data-form`,
 * which js/compare/column-actions.js reads as a column's form). While it is
 * open, renders leave it alone. Saving is a content change, so an example
 * or a new set becomes a saved comparison, with an undo.
 */

import { registerActions } from '../actions.js';
import { escHtml, debounce } from '../neorgon-dom.js';
import { setPrompt, LIMITS } from './model.js';
import { closePopover, isPhone, undoToast } from './popover.js';

/** @param {object} api from js/compare/index.js */
export function initBrief(api) {
  const { compare } = api;
  const host = compare.refs.brief;
  if (!host) return;
  /** The set whose brief is being edited, or null. */
  let editing = null;
  /** The control that opened the editor, for focus when it closes on nothing. */
  let opener = null;
  /** Set ids whose brief is open, in this tab only. */
  const openFor = new Set();
  /** What the strip shows now, so a render that changes nothing draws nothing. */
  let drawn = '';

  const shown = (el) => el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;
  const editButton = () => host.querySelector('[data-action="cmp-brief-edit"]');
  /** Somewhere sensible for focus when the strip has gone. */
  const fallback = () => [opener, compare.refs.root.querySelector('#cmpOptionsBtn'), compare.refs.root.querySelector('.set-title')]
    .find(shown) || null;

  /** Show the toggle only when there is more than the one line shows. */
  function measure() {
    const text = host.querySelector('.cmp-brief__text');
    const toggle = host.querySelector('[data-action="cmp-brief-toggle"]');
    if (!text || !toggle) return;
    if (host.classList.contains('is-open')) {
      toggle.hidden = false;
      return;
    }
    // Measured with the toggle out of the way, at the widest the text gets.
    toggle.hidden = true;
    toggle.hidden = !(text.textContent.includes('\n') || text.scrollWidth > text.clientWidth + 1);
  }

  function sync() {
    const set = compare.set;
    if (!set) return;
    if (editing && editing !== set.id) {
      editing = null;
      drawn = '';
    }
    // Never redraw an open form under the reader's hands.
    if (editing) return;
    const prompt = String(set.prompt || '').trim();
    if (!prompt) {
      host.hidden = true;
      if (drawn) host.replaceChildren();
      host.classList.remove('is-open');
      drawn = '';
      return;
    }
    const open = openFor.has(set.id);
    const sig = JSON.stringify([set.id, prompt, open]);
    host.hidden = false;
    if (sig !== drawn) {
      drawn = sig;
      host.setAttribute('aria-labelledby', 'cmpBriefLbl');
      host.classList.toggle('is-open', open);
      host.innerHTML = `<span class="cmp-brief__lbl" id="cmpBriefLbl">Brief</span>
        <p class="cmp-brief__text" id="cmpBriefText">${escHtml(prompt)}</p>
        <button type="button" class="btn btn--quiet btn--sm" data-action="cmp-brief-toggle" aria-controls="cmpBriefText" aria-expanded="${open}">${open ? 'Show less' : 'Show all'}</button>
        <button type="button" class="btn btn--quiet btn--sm" data-action="cmp-brief-edit" aria-label="Edit the brief">Edit</button>`;
    }
    measure();
  }

  function openEditor(el) {
    const set = compare.set;
    if (!set) return;
    opener = el || null;
    // On a phone the Review sheet covers the strip: it closes first.
    if (isPhone()) closePopover({ restore: false });
    editing = set.id;
    drawn = '';
    host.hidden = false;
    host.classList.remove('is-open');
    host.setAttribute('aria-labelledby', 'cmpBriefFormLbl');
    host.innerHTML = `<form class="cmp-brief__form" aria-labelledby="cmpBriefFormLbl">
        <label id="cmpBriefFormLbl" for="cmpBriefInput">Brief <span class="cmp-brief__hint">what every report was asked to write</span></label>
        <textarea id="cmpBriefInput" rows="3" maxlength="${LIMITS.prompt}" data-text-surface></textarea>
        <div class="cmp-brief__actions">
          <button type="submit" class="btn btn--primary btn--sm">Save</button>
          <button type="button" class="btn btn--sm" data-action="cmp-brief-cancel">Cancel</button>
        </div>
      </form>`;
    const area = host.querySelector('textarea');
    // A property, not markup: the brief is the reader's own text.
    area.value = set.prompt || '';
    area.focus({ preventScroll: true });
    host.scrollIntoView?.({ block: 'nearest' });
  }

  /** Close the editor; focus goes to Edit, or somewhere sensible when the strip went. */
  function closeEditor() {
    editing = null;
    drawn = '';
    sync();
    requestAnimationFrame(() => (editButton() && shown(editButton()) ? editButton() : fallback())?.focus({ preventScroll: true }));
  }

  registerActions({
    'cmp-brief-toggle': () => {
      const set = compare.set;
      if (!set) return;
      if (openFor.has(set.id)) openFor.delete(set.id);
      else openFor.add(set.id);
      sync();
      host.querySelector('[data-action="cmp-brief-toggle"]')?.focus({ preventScroll: true });
    },
    'cmp-brief-edit': (el) => openEditor(el),
    'cmp-brief-cancel': () => closeEditor(),
  });

  host.addEventListener('keydown', (event) => {
    if (!event.target.matches?.('#cmpBriefInput')) return;
    if (event.key === 'Escape') {
      // Before the panel's own Escape, which skips a handled event.
      event.preventDefault();
      event.stopPropagation();
      closeEditor();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.target.form?.requestSubmit();
    }
  });

  host.addEventListener('submit', (event) => {
    const form = event.target.closest?.('.cmp-brief__form');
    if (!form) return;
    event.preventDefault();
    const before = compare.set;
    if (!before) return;
    const next = setPrompt(before, form.querySelector('textarea')?.value || '');
    if (next.prompt === String(before.prompt || '').trim()) {
      closeEditor();
      return;
    }
    editing = null;
    drawn = '';
    api.commit(next);
    requestAnimationFrame(() => (next.prompt && editButton() ? editButton() : fallback())?.focus({ preventScroll: true }));
    undoToast(compare.refs.toast, next.prompt ? 'Saved the brief.' : 'Removed the brief.', () => {
      api.commit(before);
      return () => editButton() || fallback();
    });
  });

  compare.hooks.afterRender.push(sync);
  window.addEventListener('resize', debounce(() => {
    if (!editing && !host.hidden) measure();
  }, 150));
}
