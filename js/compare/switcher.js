/**
 * The Comparisons switcher: every saved set, with a filter, open, rename and
 * delete (with an undo), and a way to start a new one or open the example.
 *
 * While Blind is on, the open set's row says "Blind review", as the toolbar
 * does, and leaves out its roles ("3 columns: Human, Agent, Fixes") and its
 * Rename: its title is the reviewer's own text and can name the authors.
 */

const BLIND_TITLE = 'Blind review';
const BLIND_META = 'Open now. Its title and roles are hidden while Blind is on';

import { escHtml } from '../neorgon-dom.js';
import { icon } from './icons.js';
import { listSets } from './store.js';

function when(time) {
  if (!Number.isFinite(time)) return '';
  try {
    return new Date(time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Fill the switcher.
 *
 * @param {HTMLElement} host `#cmpSwitcher`
 * @param {{currentId: string|null, currentTitle: string, unsaved: boolean, filter?: string, blind?: boolean}} opts
 *   `blind`: Blind is on for the open set
 */
export async function fillSwitcher(host, {
  currentId, currentTitle, unsaved, filter = '', blind = false,
}) {
  const sets = await listSets();
  const rows = sets.map((item) => {
    const current = item.id === currentId;
    const hide = blind && current;
    const title = hide ? BLIND_TITLE : item.title;
    const meta = hide ? BLIND_META : item.summary;
    const rename = hide ? '' : `<button type="button" class="btn btn--quiet btn--sm btn--icon" data-action="cmp-rename-row" data-set-id="${escHtml(item.id)}"
        aria-label="Rename ${escHtml(title)}" title="Rename">${icon('pencil')}</button>`;
    return `<li class="sw__row${current ? ' is-current' : ''}" data-set-id="${escHtml(item.id)}" data-title="${escHtml(title.toLowerCase())}">
      <button type="button" class="sw__open" data-action="cmp-open-set" data-set-id="${escHtml(item.id)}"${current ? ' aria-current="true"' : ''}>
        <span class="sw__title">${escHtml(title)}</span>
        <span class="sw__meta">${escHtml(meta)}${item.updated ? `, edited ${escHtml(when(item.updated))}` : ''}</span>
      </button>
      ${rename}
      <button type="button" class="btn btn--quiet btn--sm btn--icon sw__delete" data-action="cmp-delete-set" data-set-id="${escHtml(item.id)}"
        aria-label="Delete ${escHtml(title)}" title="Delete">${icon('trash')}</button>
    </li>`;
  }).join('');
  const unsavedRow = unsaved
    ? `<li class="sw__row is-current"><span class="sw__open sw__open--static"><span class="sw__title">${escHtml(blind ? BLIND_TITLE : currentTitle)}</span>
        <span class="sw__meta">${blind ? 'Open now, not saved until you change it. Its title and roles are hidden while Blind is on' : 'Open now, not saved until you change it'}</span></span></li>`
    : '';
  host.innerHTML = `
    <h2 class="sw__heading" id="cmpSwitcherHeading">Comparisons</h2>
    <label class="visually-hidden" for="cmpSwitcherFilter">Filter comparisons</label>
    <input type="search" id="cmpSwitcherFilter" class="sw__filter" placeholder="Filter comparisons" autocomplete="off"
      maxlength="120" value="${escHtml(filter)}">
    <ul class="sw__list" aria-labelledby="cmpSwitcherHeading">${unsavedRow}${rows}</ul>
    <p class="sw__empty"${sets.length || unsaved ? ' hidden' : ''}>No saved comparisons yet. A comparison is saved once a report is in it.</p>
    <div class="sw__actions">
      <button type="button" class="btn btn--sm" data-action="cmp-new-set">${icon('plus')}New comparison</button>
      <button type="button" class="btn btn--quiet btn--sm" data-action="cmp-open-example">Open the example</button>
    </div>`;
  host.setAttribute('aria-labelledby', 'cmpSwitcherHeading');
  host.removeAttribute('aria-label');
  const input = host.querySelector('#cmpSwitcherFilter');
  input.addEventListener('input', () => filterSwitcher(host, input.value));
  filterSwitcher(host, filter);
  return input;
}

export function filterSwitcher(host, query) {
  const q = String(query || '').trim().toLowerCase();
  let shown = 0;
  for (const row of host.querySelectorAll('.sw__row[data-set-id]')) {
    const match = !q || row.dataset.title.includes(q);
    row.hidden = !match;
    if (match) shown += 1;
  }
  const empty = host.querySelector('.sw__empty');
  if (empty && q) {
    empty.hidden = shown > 0;
    empty.textContent = 'No comparison has that in its title.';
  }
}
