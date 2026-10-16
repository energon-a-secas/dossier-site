/**
 * The renderer: turn a model into DOM. Exactly one renderer, every export derives from it.
 *
 * renderReport: idempotent, replaces container content, no listeners; keeps
 *   the current page tab in view in its row
 * blockHtml: one block to a string, pure, DOM-free outside the one call
 * outline: navigation structure
 */

import { escHtml } from '../neorgon-dom.js';
import { blockDef, blockTypes, STATUSES } from '../registry/index.js';
import { renderBlock } from './dispatch.js';
import { reportOf } from './model.js';
import { inlineMarkdown as markdownToHtml, safeLink } from './markdown.js';
import { safeHref } from './url.js';
import { safeDomId } from './ids.js';
import { pick, TONES, WIDTHS, CHECKED_BY } from './enums.js';
import { reducedMotion } from '../motion.js';
import { enumWord, formatDate, formatDateRange, isoDay } from './format.js';

// One implementation of each thing. outline lives in outline.js and is
// re-exported here so callers have one import site, not two answers.
export { outline, outlineFlat } from './outline.js';
export { reportOf } from './model.js';

/**
 * @param {object} input the wrapped document, or the report inside it
 * @param {HTMLElement} container
 * @param {object} [opts] { page, print, interactive, titleLevel, allPages, idPrefix }
 *   `titleLevel` is the report title's heading level, 1 by default. A page
 *   that already has an h1 of its own (the app, whose Header Kit bar carries
 *   the site name as its h1) passes 2, so the page keeps one h1. An exported
 *   file has no other heading, so its title stays the h1.
 *   `idPrefix` goes in front of every id this render writes (block wrappers,
 *   chart and gauge `<defs>`), so two reports on one page, as Compare columns
 *   are, never share an id or cross-wire a gradient. Without it the output is
 *   exactly what it always was.
 */
export function renderReport(input, container, opts = {}) {
  const model = reportOf(input);
  if (!model || !container) return;

  const { page, print = false, allPages = print } = opts;

  // Where the reader left the page tabs, so the rebuilt row starts there.
  const lastTabScroll = container.querySelector(':scope > .report-shell > .report-tabs')?.scrollLeft;
  container.replaceChildren();

  if (!model.pages || !Array.isArray(model.pages) || model.pages.length === 0) {
    container.textContent = 'No pages in model';
    return;
  }

  const shell = document.createElement('div');
  shell.className = 'report-shell';
  if (model.pages.length === 1 && model.pages[0].blocks?.length === 1
      && model.pages[0].blocks[0].type === 'embed') shell.classList.add('report-shell--artifact');

  const header = renderHeader(model, opts.titleLevel);
  shell.appendChild(header);

  const tabs = allPages ? null : renderTabs(model, page);
  if (tabs) shell.appendChild(tabs);

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
  if (tabs) revealActiveTab(tabs, lastTabScroll);
}

/**
 * Keep the current page's tab in sight. The row is rebuilt on every page
 * change and a new row starts scrolled to its beginning, so on a sheet too
 * narrow for every tab the current one sat under the faded edge, or past it.
 * The row starts where the reader left it; if the current tab is not wholly
 * inside the unfaded part (the row's inline padding is the fade), the row
 * scrolls it to the middle. Only the row scrolls, never the page, and the
 * motion is smooth only when the row was already on screen and the reader
 * has not asked for reduced motion.
 *
 * @param {HTMLElement} row
 * @param {number|undefined} from the previous row's scrollLeft
 */
function revealActiveTab(row, from) {
  const tab = row.querySelector('.report-tab[aria-current="page"]');
  if (!tab || !row.isConnected || row.scrollWidth <= row.clientWidth) return;
  if (typeof from === 'number') row.scrollLeft = from;
  const style = getComputedStyle(row);
  const box = row.getBoundingClientRect();
  const rect = tab.getBoundingClientRect();
  const start = box.left + (parseFloat(style.paddingLeft) || 0);
  const end = box.left + row.clientWidth - (parseFloat(style.paddingRight) || 0);
  if (rect.left >= start - 1 && rect.right <= end + 1) return;
  const room = row.scrollWidth - row.clientWidth;
  const centre = row.scrollLeft + (rect.left - box.left) - (row.clientWidth - rect.width) / 2;
  const still = typeof from !== 'number' || reducedMotion();
  row.scrollTo({ left: Math.max(0, Math.min(room, centre)), behavior: still ? 'instant' : 'smooth' });
}

function renderHeader(model, titleLevel = 1) {
  const header = document.createElement('header');
  header.className = 'report-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'report-title-row';

  const titles = document.createElement('div');
  const title = document.createElement(titleLevel === 2 ? 'h2' : 'h1');
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

  const label = renderFileLabel(model);
  if (label) {
    titleRow.appendChild(label);
    titleRow.classList.add('report-title-row--label');
  }

  header.appendChild(titleRow);
  return header;
}

/**
 * One date in the file label, kept whole on a line (`.file-label__date`): a
 * window wrapped as "2026-10-01 to 2026-10-" over "09" in the 146 px column.
 * A calendar day is a time element carrying the raw value, so the label reads
 * "8 Oct 2026" and the machine-readable date travels with it (and with the
 * one-file export, which serialises the rendered label).
 */
function labelDate({ text, iso }) {
  const el = document.createElement(iso ? 'time' : 'span');
  el.className = 'file-label__date';
  if (iso) el.dateTime = iso;
  el.textContent = String(text);
  return el;
}

/**
 * The report's metadata as a case-file label beside the title: a band with
 * the kind and the short commit, then a definition list (Status, Owner, Date
 * or Window, Source). Every value is text from the document, set with
 * textContent; the only link goes through safeHref. No label when the
 * document carries none of these fields.
 */
function renderFileLabel(model) {
  const rows = [];
  // The status becomes a class modifier, so only a value the format knows is
  // used: "x shipped" would add two class tokens. An unknown status is left
  // out of the label, as the validator already reports it.
  const statusValue = pick(model.status, STATUSES, '');
  if (statusValue) {
    const status = document.createElement('span');
    status.className = `meta-status meta-status--${statusValue}`;
    status.textContent = enumWord(statusValue);
    rows.push(['Status', status]);
  }
  if (model.owner) rows.push(['Owner', String(model.owner)]);
  const from = model.period?.from;
  const to = model.period?.to;
  if (from || to) {
    const one = !from || !to || from === to;
    if (one) {
      const raw = from || to;
      rows.push(['Date', labelDate({ text: formatDate(raw) || String(raw), iso: isoDay(raw) ? String(raw).trim() : null })]);
    } else {
      const period = document.createDocumentFragment();
      period.append(...formatDateRange(from, to).map((part) => (typeof part === 'string' ? part : labelDate(part))));
      rows.push(['Window', period]);
    }
  }
  const source = model.source && typeof model.source === 'object' ? model.source : {};
  const sourceHref = safeHref(source.href);
  if (source.repo || sourceHref) {
    const words = source.repo ? `${source.repo}${source.branch ? ` (${source.branch})` : ''}` : 'View source';
    let value = String(words);
    if (sourceHref) {
      value = document.createElement('a');
      value.className = 'meta-source';
      value.href = sourceHref;
      value.textContent = words;
      value.target = '_blank';
      value.rel = 'noopener noreferrer';
    }
    rows.push(['Source', value]);
  }
  if (!rows.length && !model.kind) return null;

  const label = document.createElement('div');
  label.className = 'file-label';
  const band = document.createElement('div');
  band.className = 'file-label__band';
  const kind = document.createElement('span');
  kind.className = 'file-label__kind';
  kind.textContent = model.kind ? enumWord(model.kind) : 'Report';
  band.appendChild(kind);
  if (source.commit) {
    const ref = document.createElement('span');
    ref.className = 'file-label__ref';
    ref.title = `Commit ${source.commit}`;
    ref.textContent = String(source.commit).slice(0, 7);
    band.appendChild(ref);
  }
  label.appendChild(band);

  if (rows.length) {
    const list = document.createElement('dl');
    for (const [term, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.append(value);
      list.append(dt, dd);
    }
    label.appendChild(list);
  }
  return label;
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
    number.textContent = String(model.pages.indexOf(page) + 1);
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
    return errorHtml(`Unknown type: ${String(type)}`, suggestType(type));
  }

  if (block.__error) {
    return errorHtml(`Malformed: ${String(block.__error)}`);
  }

  let html;
  try {
    html = renderBlock(block, ctx);
  } catch (err) {
    // One block with a shape no renderer expected must not take the page with
    // it. The reader gets a card naming the block, and the rest still renders.
    return wrapBlock(errorHtml(`${def.name || 'Block'} could not be drawn: ${String(err?.message || err)}`), block, ctx);
  }
  if (html === undefined || html === null || html === '') {
    html = renderEmpty(def);
  }

  return wrapBlock(html, block, ctx);
}

function renderEmpty(def) {
  return `<div class="block-empty">${escHtml(def.name || 'Block')}: no content provided</div>`;
}

/** A block id, behind the render's `idPrefix` when it has one. */
function prefixedId(id, ctx = {}) {
  return ctx.idPrefix ? `${safeDomId(ctx.idPrefix)}-${id}` : id;
}

function wrapBlock(html, block, ctx) {
  const id = block.id ? ` id="${escHtml(prefixedId(block.id, ctx))}"` : '';
  // Both come from the document and both used to reach the class raw.
  const toneValue = pick(block.tone, TONES, '');
  const widthValue = pick(block.width, WIDTHS, '');
  const tone = toneValue ? ` block--${toneValue}` : '';
  const width = widthValue ? ` block--${widthValue}` : '';
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

  // The weak style, the summary and the rows all read the same whitelisted
  // value, so an unknown checkedBy is treated as "nothing checked it" in every
  // one of them instead of reading as unchecked and being styled as checked.
  const weakest = items.some((e) => {
    const who = pick(e.checkedBy, CHECKED_BY, 'none');
    return who === 'llm' || who === 'none';
  });
  const summary = items.length === 1
    ? `1 source, ${checkedByLabel(pick(items[0].checkedBy, CHECKED_BY, 'none'))}`
    : `${items.length} sources`;

  const rows = items.map((e) => {
    const who = pick(e.checkedBy, CHECKED_BY, 'none');
    const label = escHtml(e.label || 'Unnamed source');
    const name = e.href ? safeLink(e.href, e.label || 'Unnamed source') : label;
    const bits = [`<span class="evidence-who evidence-who--${who}">${escHtml(checkedByLabel(who))}</span>`];
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

/**
 * The card a block that cannot be drawn leaves in its place. Both arguments
 * are plain text, escaped here and only here: the callers used to escape the
 * type name first, so an unknown type `<b>` read `&lt;b&gt;` on the card.
 */
function errorHtml(message, hint = '') {
  let html = `<div class="block-error"><p>${escHtml(message)}</p>`;
  if (hint) {
    html += `<p class="error-hint">${escHtml(hint)}</p>`;
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
  // Own keys only: `constructor` or `toString` would otherwise find a function
  // on the prototype and print its source.
  return Object.hasOwn(labels, checkedBy) ? labels[checkedBy] : 'unstated';
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

