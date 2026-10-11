/**
 * Block catalog: browse, preview, and insert blocks.
 *
 * One modal dialog listing every block type by group. Each card shows the
 * block's sample rendered by the real renderer, so the preview never drifts
 * from what the reader will see. Clicking a card inserts that block's sample
 * into the current page.
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
  title.textContent = 'Insert block';
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
  inner.appendChild(tabs);

  const blockTabBtn = document.createElement('button');
  blockTabBtn.type = 'button';
  blockTabBtn.className = 'catalog-tab-btn active';
  blockTabBtn.textContent = 'Blocks';
  blockTabBtn.dataset.tab = 'blocks';
  tabs.appendChild(blockTabBtn);

  const templatesTabBtn = document.createElement('button');
  templatesTabBtn.type = 'button';
  templatesTabBtn.className = 'catalog-tab-btn';
  templatesTabBtn.textContent = 'Templates';
  templatesTabBtn.dataset.tab = 'templates';
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

  const blockContent = document.createElement('div');
  blockContent.className = 'catalog-tab active';
  blockContent.dataset.tab = 'blocks';
  content.appendChild(blockContent);

  const templatesContent = document.createElement('div');
  templatesContent.className = 'catalog-tab';
  templatesContent.dataset.tab = 'templates';
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
          const ctx = { interactive: false };
          preview.innerHTML = blockHtml(blockDef.sample, ctx);
          for (const img of preview.querySelectorAll('img')) {
            const caption = document.createElement('span');
            caption.textContent = img.alt || 'Image preview';
            img.replaceWith(caption);
          }
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

    fetch('reports/index.json')
      .then((r) => r.json())
      .then((index) => {
        if (!Array.isArray(index)) {
          templatesGrid.textContent = 'Could not load templates';
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
          tplKind.textContent = `${tpl.kind || 'report'} (${tpl.pages || 1} page${(tpl.pages || 1) !== 1 ? 's' : ''})`;
          card.appendChild(tplKind);

          card.addEventListener('click', () => {
            onInsert(null, null, tpl.file);
            dialog.close();
          });

          templatesGrid.appendChild(card);
        }

        if (templatesGrid.children.length === 0) {
          templatesGrid.textContent = 'No templates available';
        }
      })
      .catch(() => {
        templatesGrid.textContent = 'Could not load templates';
      });
  }

  searchInput.addEventListener(
    'input',
    debounce((e) => {
      renderBlocks(e.target.value);
    }, 150)
  );

  blockTabBtn.addEventListener('click', () => {
    renderBlocks(searchInput.value);
    blockTabBtn.classList.add('active');
    templatesTabBtn.classList.remove('active');
    blockContent.classList.add('active');
    templatesContent.classList.remove('active');
    searchInput.style.display = 'block';
    searchInput.focus();
  });

  templatesTabBtn.addEventListener('click', () => {
    templatesTabBtn.classList.add('active');
    blockTabBtn.classList.remove('active');
    templatesContent.classList.add('active');
    blockContent.classList.remove('active');
    searchInput.style.display = 'none';
    renderTemplates();
  });

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
 */
export function openCatalog(opener, tab = 'blocks') {
  if (!catalogDialog) {
    throw new Error('Catalog not initialized');
  }
  openDialog(catalogDialog, opener);
  catalogDialog.querySelector(`.catalog-tab-btn[data-tab="${tab === 'templates' ? 'templates' : 'blocks'}"]`)?.click();
}
