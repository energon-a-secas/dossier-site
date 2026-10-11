/**
 * The renderer: turn a model into DOM. Exactly one renderer, every export derives from it.
 *
 * renderReport: idempotent, replaces container content, no listeners
 * blockHtml: one block to a string, pure, DOM-free outside the one call
 * outline: navigation structure
 */

import { escHtml } from '../neorgon-dom.js';
import { blockDef, blockTypes } from '../registry/index.js';
import { renderBlock } from './dispatch.js';
import { reportOf } from './model.js';
import { inlineMarkdown as markdownToHtml, safeLink } from './markdown.js';
import { safeHref } from './url.js';

// One implementation of each thing. outline lives in outline.js and is
// re-exported here so callers have one import site, not two answers.
export { outline, outlineFlat } from './outline.js';
export { reportOf } from './model.js';

/**
 * @param {object} input the wrapped document, or the report inside it
 * @param {HTMLElement} container
 * @param {object} [opts] { page, print, interactive }
 */
export function renderReport(input, container, opts = {}) {
  const model = reportOf(input);
  if (!model || !container) return;

  const { page, print = false, allPages = print } = opts;

  container.replaceChildren();

  if (!model.pages || !Array.isArray(model.pages) || model.pages.length === 0) {
    container.textContent = 'No pages in model';
    return;
  }

  const shell = document.createElement('div');
  shell.className = 'report-shell';
  if (model.pages.length === 1 && model.pages[0].blocks?.length === 1
      && model.pages[0].blocks[0].type === 'embed') shell.classList.add('report-shell--artifact');

  const header = renderHeader(model);
  shell.appendChild(header);

  if (!allPages) {
    const tabs = renderTabs(model, page);
    if (tabs) shell.appendChild(tabs);
  }

  const content = document.createElement('div');
  content.className = 'report-content';

  if (allPages) {
    for (const p of model.pages) {
      const pageEl = renderPage(p, model, opts);
      content.appendChild(pageEl);
    }
  } else {
    const pageId = page || model.pages[0].id;
    const pageObj = model.pages.find((p) => p.id === pageId) || model.pages[0];
    const pageEl = renderPage(pageObj, model, opts);
    content.appendChild(pageEl);
  }

  shell.appendChild(content);
  container.appendChild(shell);
}

function renderHeader(model) {
  const header = document.createElement('header');
  header.className = 'report-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'report-title-row';

  const titles = document.createElement('div');
  const title = document.createElement('h1');
  title.className = 'report-title';
  title.textContent = model.title || 'Untitled Report';
  titles.appendChild(title);

  if (model.subtitle) {
    const subtitle = document.createElement('p');
    subtitle.className = 'report-subtitle';
    subtitle.textContent = model.subtitle;
    titles.appendChild(subtitle);
  }
  titleRow.appendChild(titles);

  const meta = document.createElement('div');
  meta.className = 'report-meta';
  if (model.kind) {
    const kindEl = document.createElement('span');
    kindEl.className = 'meta-kind';
    kindEl.textContent = model.kind;
    meta.appendChild(kindEl);
  }
  if (model.status) {
    const statusEl = document.createElement('span');
    statusEl.className = `meta-status meta-status--${model.status}`;
    statusEl.textContent = model.status.replaceAll('-', ' ');
    meta.appendChild(statusEl);
  }
  if (model.owner) {
    const ownerEl = document.createElement('span');
    ownerEl.className = 'meta-owner';
    ownerEl.textContent = model.owner;
    meta.appendChild(ownerEl);
  }
  if (model.period && (model.period.from || model.period.to)) {
    const periodEl = document.createElement('span');
    periodEl.className = 'meta-period';
    periodEl.textContent = `${model.period.from || '?'} to ${model.period.to || '?'}`;
    meta.appendChild(periodEl);
  }
  const sourceHref = safeHref(model.source?.href);
  if (sourceHref) {
    const sourceEl = document.createElement('a');
    sourceEl.className = 'meta-source';
    sourceEl.href = sourceHref;
    sourceEl.textContent = 'View source';
    sourceEl.target = '_blank';
    sourceEl.rel = 'noopener noreferrer';
    meta.appendChild(sourceEl);
  }
  titleRow.appendChild(meta);

  header.appendChild(titleRow);
  return header;
}

function renderTabs(model, activePage) {
  if (!model.pages || model.pages.length <= 1) return null;

  const tabs = document.createElement('nav');
  tabs.className = 'report-tabs';
  tabs.setAttribute('aria-label', 'Report sections');

  for (const page of model.pages) {
    const tab = document.createElement('a');
    tab.className = 'report-tab';
    if (page.id === (activePage || model.pages[0].id)) {
      tab.className += ' active';
      tab.setAttribute('aria-current', 'page');
    }
    // The route is the page id, with no prefix. The tabs used to link to
    // `#/page-<id>` while the outline linked to `#/<id>` and the router
    // matched the id, so neither a tab nor a shared page link opened the page
    // it named. One scheme: `#/<page id>`.
    tab.href = `#/${encodeURIComponent(page.id)}`;
    const number = document.createElement('span');
    number.className = 'report-tab__number';
    number.setAttribute('aria-hidden', 'true');
    number.textContent = String(model.pages.indexOf(page) + 1).padStart(2, '0');
    tab.append(number, document.createTextNode(page.title));
    if (page.summary) {
      tab.title = page.summary;
    }
    tabs.appendChild(tab);
  }

  return tabs;
}

function renderPage(page, model, opts = {}) {
  const pageEl = document.createElement('div');
  pageEl.className = 'report-page';

  if (page.title) {
    const head = document.createElement('header');
    head.className = 'report-page__head';
    const title = document.createElement('h2');
    title.textContent = page.title;
    head.appendChild(title);
    if (page.summary) {
      const summary = document.createElement('p');
      summary.textContent = page.summary;
      head.appendChild(summary);
    }
    pageEl.appendChild(head);
  }

  const blocks = document.createElement('div');
  blocks.className = 'report-blocks';

  if (page.blocks && Array.isArray(page.blocks)) {
    for (const block of page.blocks) {
      const blockEl = document.createElement('div');
      blockEl.innerHTML = blockHtml(block, { page, model, ...opts });
      blocks.appendChild(blockEl);
    }
  }

  pageEl.appendChild(blocks);
  return pageEl;
}

/**
 * One block to HTML string. Pure, no global state.
 */
export function blockHtml(block, ctx = {}) {
  if (!block || typeof block !== 'object') {
    return errorHtml('Invalid block');
  }

  const { type } = block;
  const def = blockDef(type);

  if (!def) {
    return errorHtml(`Unknown type: ${escHtml(String(type))}`, suggestType(type));
  }

  if (block.__error) {
    return errorHtml(`Malformed: ${escHtml(block.__error)}`);
  }

  let html = renderBlock(block, ctx);
  if (html === undefined || html === null || html === '') {
    html = renderEmpty(def);
  }

  return wrapBlock(html, block, ctx);
}

function renderEmpty(def) {
  return `<div class="block-empty">${escHtml(def.name || 'Block')}: no content provided</div>`;
}

function wrapBlock(html, block, ctx) {
  const id = block.id ? ` id="${escHtml(block.id)}"` : '';
  const tone = block.tone ? ` block--${block.tone}` : '';
  const width = block.width ? ` block--${block.width}` : '';
  const collapsed = block.collapsed ? ' block--collapsed' : '';
  const tag = block.collapsed ? 'details' : 'section';
  let wrapper = `<${tag} class="block${tone}${width}${collapsed}"${id} data-block-type="${escHtml(block.type)}">`;
  if (block.collapsed) {
    wrapper += `<summary>${escHtml(block.title || blockDef(block.type)?.name || 'Details')}</summary>`;
  } else if (block.title && !['heading', 'chart', 'gauge'].includes(block.type)) {
    wrapper += `<h3 class="block-title">${escHtml(block.title)}</h3>`;
  }
  wrapper += html;

  if (block.note) {
    wrapper += `<p class="block-note">${markdownToHtml(block.note)}</p>`;
  }

  if (Array.isArray(block.evidence) && block.evidence.length > 0) {
    wrapper += renderEvidenceMarker(block.evidence);
  }

  wrapper += `</${tag}>`;
  return wrapper;
}

/**
 * How the reader checks a block without trusting the author.
 *
 * This is the product's whole argument, so it is a disclosure the reader can
 * open rather than a badge they have to hover. The earlier version rendered a
 * single word, "Code", with the real label hidden in a title attribute: a
 * title is invisible on touch, invisible to a keyboard, and read
 * inconsistently by screen readers, so the evidence was effectively not there.
 *
 * `checkedBy` is rendered as a word and carries its own class, because the
 * three values are not decoration. A machine check that passed, a person who
 * looked and a model's own assertion are different kinds of thing, and the
 * third one is the reason a reader opened this panel.
 */
function renderEvidenceMarker(evidence) {
  const items = Array.isArray(evidence) ? evidence.filter(Boolean) : [];
  if (!items.length) return '';

  const weakest = items.some((e) => !e.checkedBy || e.checkedBy === 'llm' || e.checkedBy === 'none');
  const summary = items.length === 1
    ? `1 source, ${checkedByLabel(items[0].checkedBy)}`
    : `${items.length} sources`;

  const rows = items.map((e) => {
    const who = e.checkedBy || 'none';
    const label = escHtml(e.label || 'Unnamed source');
    const name = e.href ? safeLink(e.href, e.label || 'Unnamed source') : label;
    const bits = [`<span class="evidence-who evidence-who--${escHtml(who)}">${escHtml(checkedByLabel(who))}</span>`];
    if (e.kind) bits.push(`<span class="evidence-kind">${escHtml(e.kind)}</span>`);
    if (e.confidence) bits.push(`<span class="evidence-confidence">${escHtml(e.confidence)} confidence</span>`);
    if (e.hash) bits.push(`<code class="evidence-hash">${escHtml(String(e.hash).slice(0, 16))}</code>`);
    const excerpt = e.excerpt
      ? `<blockquote class="evidence-excerpt">${escHtml(e.excerpt)}</blockquote>`
      : '';
    return `<li class="evidence-item"><span class="evidence-name">${name}</span>`
      + `<span class="evidence-facts">${bits.join('')}</span>${excerpt}</li>`;
  }).join('');

  return `<details class="evidence-marker${weakest ? ' evidence-marker--weak' : ''}">
    <summary>How this was checked: ${escHtml(summary)}</summary>
    <ul class="evidence-list">${rows}</ul>
  </details>`;
}

function errorHtml(message, hint = '') {
  let html = `<div class="block-error"><p>${escHtml(message)}</p>`;
  if (hint) {
    html += `<p class="error-hint">${hint}</p>`;
  }
  html += '</div>';
  return html;
}

function suggestType(type) {
  const known = blockTypes();
  const similar = known.filter((t) => levenshtein(t, String(type || '')) <= 2);
  if (similar.length > 0) {
    return `Did you mean: ${similar.join(', ')}?`;
  }
  return '';
}


/**
 * The three values say different things to a reviewer, so they are rendered
 * as what they mean rather than as the enum. "Code" told the reader nothing;
 * "a machine checked it" tells them whether to go and look.
 */
function checkedByLabel(checkedBy) {
  const labels = {
    code: 'a machine checked it',
    human: 'a person checked it',
    llm: 'a model asserted it',
    none: 'nothing checked it',
  };
  return labels[checkedBy] || 'unstated';
}

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

