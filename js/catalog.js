/**
 * Block catalog and examples.
 *
 * One modal dialog with two tabs. Blocks lists every block type by group,
 * each card showing the block's sample rendered by the real renderer, so the
 * preview never drifts from what the reader will see; clicking a card inserts
 * that sample into the current page. Examples lists the bundled reports.
 *
 * The examples list (reports/index.json) is also read by the welcome screen
 * and the Open dialog, through `loadExamples` and `renderExamples`, so the
 * three places cannot disagree about what ships.
 */

import { uid, debounce } from './neorgon-dom.js';
import { groups } from './registry/index.js';
import { blockHtml } from './render/index.js';
import { openDialog, bindDialog } from './dialogs.js';

let catalogDialog = null;

/**
 * Create and return the block catalog dialog.
 *
 * @param {function} onInsert called with (blockSample, type) when a block is inserted
 * @returns {HTMLElement} the dialog element
 */
export function createCatalogDialog(onInsert = () => {}) {
  if (catalogDialog) return catalogDialog;

  const dialog = document.createElement('dialog');
  dialog.id = uid('catalog-');
  dialog.className = 'catalog-dialog';

  const inner = document.createElement('div');
  inner.className = 'catalog-inner';

  const header = document.createElement('div');
  header.className = 'catalog-header';
  inner.appendChild(header);

  const title = document.createElement('h2');
  title.id = 'catalogHeading';
  title.textContent = TITLES.blocks;
  dialog.setAttribute('aria-labelledby', title.id);
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'catalog-close';
  closeBtn.textContent = 'Close';
  closeBtn.setAttribute('data-dialog-close', '');
  header.appendChild(closeBtn);

  const tabs = document.createElement('div');
  tabs.className = 'catalog-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Catalog');
  inner.appendChild(tabs);

  const blockTabBtn = tabButton('blocks', 'Blocks', true);
  tabs.appendChild(blockTabBtn);
  const templatesTabBtn = tabButton('templates', 'Examples', false);
  tabs.appendChild(templatesTabBtn);

  const searchContainer = document.createElement('div');
  searchContainer.className = 'catalog-search';
  inner.appendChild(searchContainer);

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search blocks...';
  searchInput.setAttribute('aria-label', 'Search blocks');
  searchInput.className = 'catalog-search-input';
  searchContainer.appendChild(searchInput);

  const content = document.createElement('div');
  content.className = 'catalog-content';
  inner.appendChild(content);

  const blockContent = tabPanel('blocks', true);
  content.appendChild(blockContent);
  const templatesContent = tabPanel('templates', false);
  content.appendChild(templatesContent);

  const blocksGrid = document.createElement('div');
  blocksGrid.className = 'catalog-grid';
  blockContent.appendChild(blocksGrid);

  const templatesGrid = document.createElement('div');
  templatesGrid.className = 'catalog-grid';
  templatesContent.appendChild(templatesGrid);

  function renderBlocks(filterText = '') {
    blocksGrid.replaceChildren();
    const allGroups = groups();

    for (const [groupName, blocks] of allGroups) {
      const groupSection = document.createElement('div');
      groupSection.className = 'catalog-group';

      const groupTitle = document.createElement('h3');
      groupTitle.className = 'catalog-group-title';
      groupTitle.textContent = groupName;
      groupSection.appendChild(groupTitle);

      const groupCards = document.createElement('div');
      groupCards.className = 'catalog-group-cards';
      groupSection.appendChild(groupCards);

      for (const blockDef of blocks) {
        const lowerFilter = filterText.toLowerCase();
        const matchesName = blockDef.name.toLowerCase().includes(lowerFilter);
        const matchesSummary = (blockDef.summary || '').toLowerCase().includes(lowerFilter);
        const matchesWhen = (blockDef.when || '').toLowerCase().includes(lowerFilter);

        if (filterText && !matchesName && !matchesSummary && !matchesWhen) {
          continue;
        }

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'catalog-card';
        card.setAttribute('data-block-type', blockDef.id);

        const cardTitle = document.createElement('div');
        cardTitle.className = 'catalog-card-title';
        cardTitle.textContent = blockDef.name;
        card.appendChild(cardTitle);

        const cardSummary = document.createElement('div');
        cardSummary.className = 'catalog-card-summary';
        cardSummary.textContent = blockDef.summary;
        card.appendChild(cardSummary);

        const cardWhen = document.createElement('div');
        cardWhen.className = 'catalog-card-when';
        cardWhen.textContent = blockDef.when;
        card.appendChild(cardWhen);

        if (blockDef.sample) {
          const preview = document.createElement('div');
          preview.className = 'catalog-card-preview';
          preview.inert = true;
          preview.setAttribute('aria-hidden', 'true');
          preview.append(inertPreview(blockHtml(blockDef.sample, { interactive: false })));
          card.appendChild(preview);
        }

        card.addEventListener('click', () => {
          onInsert(blockDef.sample, blockDef.id);
          dialog.close();
        });

        groupCards.appendChild(card);
      }

      if (groupCards.children.length > 0) {
        blocksGrid.appendChild(groupSection);
      }
    }

    if (blocksGrid.children.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'catalog-no-results';
      noResults.textContent = 'No blocks match your search';
      blocksGrid.appendChild(noResults);
    }
  }

  function renderTemplates() {
    templatesGrid.replaceChildren();
    loadExamples().then((index) => {
      templatesGrid.replaceChildren();
      if (!index) {
        templatesGrid.textContent = 'The examples could not be loaded.';
        return;
      }
      for (const tpl of index) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'catalog-card template-card';
        card.setAttribute('data-template', tpl.file);

        const tplTitle = document.createElement('div');
        tplTitle.className = 'catalog-card-title';
        tplTitle.textContent = tpl.title;
        card.appendChild(tplTitle);

        const tplSummary = document.createElement('div');
        tplSummary.className = 'catalog-card-summary';
        tplSummary.textContent = tpl.summary;
        card.appendChild(tplSummary);

        const tplKind = document.createElement('div');
        tplKind.className = 'catalog-template-kind';
        tplKind.textContent = exampleMeta(tpl);
        card.appendChild(tplKind);

        card.addEventListener('click', () => {
          onInsert(null, null, tpl.file);
          dialog.close();
        });

        templatesGrid.appendChild(card);
      }
      if (templatesGrid.children.length === 0) {
        templatesGrid.textContent = 'No examples are bundled with this copy.';
      }
    });
  }

  searchInput.addEventListener(
    'input',
    debounce((e) => {
      renderBlocks(e.target.value);
    }, 150)
  );

  function selectTab(which) {
    const blocks = which !== 'templates';
    for (const [btn, panel, on] of [[blockTabBtn, blockContent, blocks], [templatesTabBtn, templatesContent, !blocks]]) {
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      panel.classList.toggle('active', on);
      panel.hidden = !on;
    }
    // The search filters blocks only. Hiding its container, not just the
    // input, leaves no empty band above the examples.
    searchContainer.hidden = !blocks;
    title.textContent = blocks ? TITLES.blocks : TITLES.templates;
    if (blocks) {
      renderBlocks(searchInput.value);
    } else {
      renderTemplates();
    }
  }

  blockTabBtn.addEventListener('click', () => {
    selectTab('blocks');
    searchInput.focus();
  });
  templatesTabBtn.addEventListener('click', () => selectTab('templates'));
  // Arrow keys move between the two tabs, as a tablist does.
  tabs.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = blockTabBtn.getAttribute('aria-selected') === 'true' ? templatesTabBtn : blockTabBtn;
    next.click();
    next.focus();
  });
  dialog.selectTab = selectTab;

  // Previews are built when requested, keeping the report's first load small.

  dialog.appendChild(inner);
  bindDialog(dialog);

  catalogDialog = dialog;
  return dialog;
}

/**
 * Open the catalog dialog.
 *
 * @param {HTMLElement} [opener] the element that opened the dialog
 * @param {'blocks'|'templates'} [tab]
 */
export function openCatalog(opener, tab = 'blocks') {
  if (!catalogDialog) {
    throw new Error('Catalog not initialized');
  }
  openDialog(catalogDialog, opener);
  catalogDialog.selectTab(tab === 'templates' ? 'templates' : 'blocks');
}

const TITLES = Object.freeze({ blocks: 'Insert block', templates: 'Examples' });

function tabButton(name, label, selected) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `catalog-tab-btn${selected ? ' active' : ''}`;
  btn.textContent = label;
  btn.dataset.tab = name;
  btn.id = `catalog-tab-${name}`;
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', String(selected));
  btn.setAttribute('aria-controls', `catalog-panel-${name}`);
  btn.tabIndex = selected ? 0 : -1;
  return btn;
}

function tabPanel(name, selected) {
  const panel = document.createElement('div');
  panel.className = `catalog-tab${selected ? ' active' : ''}`;
  panel.dataset.tab = name;
  panel.id = `catalog-panel-${name}`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `catalog-tab-${name}`);
  panel.hidden = !selected;
  return panel;
}

/**
 * Parse a preview inside a <template>, whose content is inert: an image in it
 * is never fetched, so a sample that names a remote image cannot make the
 * catalog send a request just by opening. Images become their alt text.
 *
 * @param {string} html markup from our own renderer
 * @returns {DocumentFragment}
 */
function inertPreview(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const img of tpl.content.querySelectorAll('img')) {
    const caption = document.createElement('span');
    caption.textContent = img.alt || 'Image preview';
    img.replaceWith(caption);
  }
  return document.importNode(tpl.content, true);
}

// ── Examples ─────────────────────────────────────────────────────────────────

/** A bundled example's file name: one plain segment, so nothing walks out of reports/. */
const EXAMPLE_FILE = /^[a-z0-9][a-z0-9-]*\.json$/;

let examples = null;

/**
 * The bundled examples, read once. Resolves to null when the list could not
 * be loaded, so a caller can say so instead of showing an empty list.
 *
 * @returns {Promise<Array<{file: string, title: string, summary?: string, kind?: string, pages?: number}>|null>}
 */
export function loadExamples() {
  if (!examples) {
    examples = fetch('reports/index.json')
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((index) => (Array.isArray(index)
        ? index.filter((item) => item && EXAMPLE_FILE.test(String(item.file || '')) && item.title)
        : null))
      .catch(() => {
        examples = null;
        return null;
      });
  }
  return examples;
}

/** "Comparison, 3 pages" */
export function exampleMeta(item) {
  const pages = Number(item.pages) || 1;
  const kind = String(item.kind || 'report');
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}, ${pages} page${pages === 1 ? '' : 's'}`;
}

/**
 * Fill a list with example buttons (`data-action="example"`).
 *
 * @param {HTMLElement} host a <ul> or <ol>
 * @param {{limit?: number}} [opts]
 * @returns {Promise<boolean>} false when the list could not be loaded
 */
export async function renderExamples(host, { limit = Infinity } = {}) {
  if (!host) return false;
  const index = await loadExamples();
  host.replaceChildren();
  if (!index) {
    const li = document.createElement('li');
    li.className = 'ds-examples__empty';
    li.textContent = 'The examples could not be loaded.';
    host.appendChild(li);
    return false;
  }
  index.slice(0, limit).forEach((item, i) => {
    // The card's name is its title; the summary and meta are its description,
    // read after a pause, instead of one 150 to 200 character name read on
    // every Tab. The ids are unique: each host has its own id, and
    // replaceChildren() took the old ones away.
    const key = `${host.id || 'examples'}-${i}`;
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ds-example';
    btn.dataset.action = 'example';
    btn.dataset.file = item.file;
    const name = document.createElement('span');
    name.className = 'ds-example__title';
    name.id = `${key}-title`;
    name.textContent = item.title;
    const meta = document.createElement('span');
    meta.className = 'ds-example__meta';
    meta.id = `${key}-meta`;
    meta.textContent = exampleMeta(item);
    btn.append(name);
    if (item.summary) {
      const summary = document.createElement('span');
      summary.className = 'ds-example__summary';
      summary.id = `${key}-summary`;
      summary.textContent = item.summary;
      btn.append(summary);
    }
    btn.append(meta);
    btn.setAttribute('aria-labelledby', name.id);
    btn.setAttribute('aria-describedby', item.summary ? `${key}-summary ${key}-meta` : `${key}-meta`);
    li.appendChild(btn);
    host.appendChild(li);
  });
  return true;
}

/** True for a file name `renderExamples` would have emitted. */
export function isExampleFile(file) {
  return EXAMPLE_FILE.test(String(file || ''));
}
