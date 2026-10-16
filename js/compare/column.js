/**
 * One compare column: its head (badge, label, kind, menu, who wrote it, the
 * stats line) and its body in the column's render mode.
 *
 *   format       Dossier format. HTML, Markdown and text become IR and render
 *                through js/compare/ir-render.js into `.reader`; a Dossier
 *                document renders with the real report renderer, every page,
 *                not interactive, with ids prefixed per column.
 *   original     an HTML report in its own look, in a static frame
 *                (js/compare/frame.js)
 *   interactive  an HTML report running its own scripts in the sealed
 *                embed.html host; sync and differences leave it alone
 *
 * The body is drawn only when what it shows changed (`bodyKey`), so a toolbar
 * click does not reload three reports and lose their scroll positions. What
 * names the body (its letter and label) is not part of that key, so
 * `labelBody` renames it on every render instead: after Move right, the
 * column headed B had a body still called "Column A text".
 */

import { escHtml } from '../neorgon-dom.js';
import { renderReport } from '../render/index.js';
import { readText } from '../open.js';
import { icon } from './icons.js';
import { htmlToIr, elementToIr } from './normalize.js';
import { markdownToIr } from './markdown-ir.js';
import { textToIr, headingsOf } from './ir.js';
import { renderIr } from './ir-render.js';
import { extract, statsItems, statsSentence } from './extract.js';
import { staticFrame, interactiveFrame, frameHeadings, remoteResources, blockedSentence } from './frame.js';
import {
  ROLE_WORDS, KIND_WORDS, MODE_WORDS, columnById,
} from './model.js';
import { nameOf } from './blind.js';

/** The mode a column renders in: its own, else the set's; Original is HTML only. */
export function effectiveMode(set, col) {
  const wanted = col.mode || set.view.mode;
  if (col.source?.kind !== 'html') return 'format';
  return wanted;
}

const hashes = new WeakMap();

/** A cheap fingerprint of a source's text, cached per source object. */
function fingerprint(source) {
  if (!source) return 'empty';
  if (hashes.has(source)) return hashes.get(source);
  let h = 0x811c9dc5;
  const text = source.text;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const value = `${source.kind}:${text.length}:${(h >>> 0).toString(36)}`;
  hashes.set(source, value);
  return value;
}

/** What the body shows. When this is unchanged, the body is left alone. */
export function bodyKey(set, col) {
  return `${col.id}|${effectiveMode(set, col)}|${fingerprint(col.source)}`;
}

// ── Head ─────────────────────────────────────────────────────────────────────

/**
 * "Fixes to B, edited by D. Whitfield". While blind, "Author hidden": the
 * role, the relation and the author all say who wrote it.
 */
function whoLine(set, col) {
  if (set.view.blind) return col.source ? 'Author hidden' : 'No report yet';
  const role = `<span class="role-name">${escHtml(ROLE_WORDS[col.role])}</span>`;
  const author = col.author ? escHtml(col.author) : '';
  if (!col.source) return `${role}, no report yet`;
  switch (col.role) {
    case 'human':
      return author ? `${role}, written by ${author}` : role;
    case 'fix': {
      const target = col.fixes && columnById(set, col.fixes) ? ` to ${escHtml(nameOf(set, col.fixes).ref)}` : '';
      return `${role}${target}${author ? `, edited by ${author}` : ''}`;
    }
    default:
      return author ? `${role}, ${author}` : role;
  }
}

/**
 * @param {object} set
 * @param {object} col
 * @param {{stats?: object, baseStats?: object|null, baseLetter?: string, diffLine?: string, isBase?: boolean}} [info]
 */
export function headHtml(set, col, info = {}) {
  const name = nameOf(set, col);
  const letter = escHtml(name.ref);
  const labelId = `cmp-col-${col.id}-label`;
  const badge = `<span class="rb" aria-hidden="true">${escHtml(name.mark)}</span>`;
  // While blind the label is "Report 3" already; otherwise "Column B, " is
  // read before it.
  const label = `<h2 class="col__label" id="${labelId}">${name.blind ? '' : `<span class="visually-hidden">Column ${letter}, </span>`}${escHtml(name.label)}</h2>`;
  const what = name.blind ? letter : `column ${letter}`;

  if (!col.source) {
    return `<div class="col__row">${badge}${label}
      <button type="button" class="btn btn--quiet btn--sm btn--icon col__close" data-action="cmp-remove" data-col="${col.id}"
        aria-label="Remove ${what}" title="Remove column">${icon('x')}</button></div>
      <p class="col__who">${whoLine(set, col)}</p>
      <p class="col__stats" aria-hidden="true">&#160;</p>
      <div class="col__diff"><span>Differences appear once a report is in this column.</span></div>`;
  }

  const mode = effectiveMode(set, col);
  const setMode = set.view.mode;
  // Only Original and Interactive earn a tag, and only when the set reads in
  // another mode: a Markdown column is always in Dossier format.
  // While blind the kind and mode stay out of the markup, not only out of
  // sight: "Markdown" next to "Report 2" would say which one the agent wrote.
  const modeTag = !name.blind && mode !== 'format' && mode !== setMode ? `<span class="tag col__mode">${MODE_WORDS[mode]}</span>` : '';
  const baseTag = info.isBase ? '<span class="tag tag--base">Base</span>' : '';
  const kind = name.blind ? '<span class="col__kind"></span>' : `<span class="col__kind">${KIND_WORDS[col.source.kind]}</span>`;
  const stats = info.stats ? statsHtml(info.stats, info.baseStats, info.baseLetter) : '<p class="col__stats">&#160;</p>';
  return `<div class="col__row">${badge}${label}${baseTag}
      ${kind}${modeTag}
      <button type="button" class="btn btn--quiet btn--sm btn--icon col__menu" data-action="cmp-column-menu" data-col="${col.id}"
        aria-haspopup="menu" aria-expanded="false" aria-controls="cmpColumnMenu" aria-label="${name.blind ? letter : `Column ${letter}`} options">${icon('more')}</button></div>
    <p class="col__who">${whoLine(set, col)}</p>
    ${stats}
    ${info.diffLine ? `<div class="col__diff">${info.diffLine}</div>` : ''}`;
}

function statsHtml(stats, baseStats, baseLetter) {
  const items = statsItems(stats, baseStats || null);
  const label = baseStats
    ? `Descriptive counts, with differences from ${baseLetter || 'the base'} in brackets: ${statsSentence(stats, baseStats)}`
    : `Descriptive counts: ${statsSentence(stats)}`;
  const spans = items.map((item) => `<span><b>${item.value}</b> ${escHtml(item.label)}`
    + `${item.delta ? ` <span class="col__delta">(${escHtml(item.delta)})</span>` : ''}</span>`).join('');
  return `<p class="col__stats" role="note" aria-label="${escHtml(label)}"><span aria-hidden="true" class="col__stats-items">${spans}</span></p>`;
}

// ── Body ─────────────────────────────────────────────────────────────────────

/** The accessible name of a static or interactive frame. */
function frameTitle(set, col, mode) {
  const name = nameOf(set, col);
  const who = name.blind ? name.label : `Column ${name.ref}, ${col.label}`;
  return `${who}, ${mode === 'interactive' ? 'running its scripts' : 'original layout'}`;
}

/** The accessible name of a column's scrolling text. */
function scrollLabel(set, col) {
  const name = nameOf(set, col);
  return name.blind ? `${name.label} text` : `Column ${name.ref} text`;
}

/**
 * Keep a drawn body's names in step with its column's letter and label,
 * without drawing it again.
 *
 * @param {HTMLElement} body `.col__body`
 */
export function labelBody(body, set, col) {
  if (!col.source) return;
  const scroll = body.querySelector(':scope > .col__scroll');
  const label = scrollLabel(set, col);
  if (scroll && scroll.getAttribute('aria-label') !== label) scroll.setAttribute('aria-label', label);
  const frame = body.querySelector(':scope > .col__frame');
  const title = frame ? frameTitle(set, col, effectiveMode(set, col)) : '';
  if (frame && frame.title !== title) frame.title = title;
}

export function note(text, strong = '') {
  return `<p class="col-note">${icon('info')}<span>${strong ? `<b>${escHtml(strong)}</b> ` : ''}${escHtml(text)}</span></p>`;
}

/**
 * Draw a filled column's body.
 *
 * @param {HTMLElement} body `.col__body`
 * @param {object} set
 * @param {object} col
 * @param {{onFrameReady?: (rec: object) => void, onBlockedLink?: (href: string) => void,
 *   marks?: Function, notes?: string}} [hooks] `marks` goes to the IR renderer
 *   (js/compare/ir-render.js); `notes` is markup put at the top of the body
 * @returns {{kind: 'reader'|'frame'|'interactive'|'error', blocks: Array|null,
 *   stats: object|null, scrollEl: HTMLElement|null, headingEls: HTMLElement[],
 *   headings: Array<{text: string, level: number}>, frame?: HTMLIFrameElement}}
 */
export function renderBody(body, set, col, hooks = {}) {
  const mode = effectiveMode(set, col);
  const source = col.source;
  const notes = [];
  if (source.note) notes.push(note(`${source.note}.`));
  // A notice from the analysis features ("Too different from B to mark word
  // by word"), already escaped by them.
  if (hooks.notes) notes.push(hooks.notes);
  body.replaceChildren();
  body.className = 'col__body';

  if (mode === 'original' || mode === 'interactive') {
    body.classList.add('col__body--frame');
    const parsed = htmlToIr(source.text, { svg: false });
    const stats = extract(parsed.blocks);
    const title = frameTitle(set, col, mode);
    if (mode === 'interactive') {
      notes.push(note('Sync and differences are off for it, and values the scripts compute may differ from the static view.', 'This column runs the report’s own scripts.'));
      body.insertAdjacentHTML('beforeend', `<div class="col__notes">${notes.join('')}</div>`);
      const frame = interactiveFrame(source.text, { title });
      body.append(frame);
      return { kind: 'interactive', blocks: parsed.blocks, stats, scrollEl: null, headingEls: [], headings: [], frame };
    }
    const blocked = blockedSentence(remoteResources(source.text));
    if (blocked) notes.push(note(blocked));
    if (notes.length) body.insertAdjacentHTML('beforeend', `<div class="col__notes">${notes.join('')}</div>`);
    const frame = staticFrame(source.text, { title, onBlockedLink: hooks.onBlockedLink });
    const record = { kind: 'frame', blocks: parsed.blocks, stats, scrollEl: null, headingEls: [], headings: [], frame };
    frame.addEventListener('load', () => {
      record.loaded = true;
      record.headingEls = frameHeadings(frame).map((h) => h.el);
      record.headings = frameHeadings(frame).map(({ text, level }) => ({ text, level }));
      if (typeof hooks.onFrameReady === 'function') hooks.onFrameReady(record);
    });
    body.append(frame);
    return record;
  }

  const scroll = document.createElement('div');
  scroll.className = 'col__scroll reader';
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', scrollLabel(set, col));
  body.append(scroll);

  if (source.kind === 'dossier') return renderDossier(scroll, col, notes);

  let blocks = [];
  if (source.kind === 'html') {
    const parsed = htmlToIr(source.text);
    blocks = parsed.blocks;
    if (parsed.info.looksLikeApp) notes.push(note('This looks like a saved web app: only its static text is shown.'));
    if (parsed.info.remoteImages) {
      const n = parsed.info.remoteImages;
      notes.push(note(`${n} remote image${n === 1 ? ' was' : 's were'} not loaded. Dossier never fetches from other sites.`));
    }
  } else if (source.kind === 'markdown') {
    blocks = markdownToIr(source.text).blocks;
  } else {
    blocks = textToIr(source.text);
  }
  if (!blocks.length) notes.push(note('No readable text was found in this report.'));
  scroll.innerHTML = `${notes.join('')}<div class="reader__doc">${renderIr(blocks, { colId: col.id, marks: hooks.marks || null })}</div>`;
  const headingEls = [...scroll.querySelectorAll('.r-h')];
  return {
    kind: 'reader',
    blocks,
    stats: extract(blocks),
    scrollEl: scroll,
    headingEls,
    // From the IR, in the order the headings were drawn, not from their
    // text on screen: a marked heading also holds its removed words and the
    // hidden "Changed heading:", which alignment must not read.
    headings: headingsOf(blocks).map(({ text, level }) => ({ text, level })),
  };
}

/**
 * A Dossier document's headings, one level under the column's label (an h2),
 * as an HTML or Markdown column's are: the title is a level 3 heading, a page
 * title 4, a block title 5 and anything deeper 6. Set as `aria-level`, so the
 * renderer's markup and the styles that select its headings by tag are left
 * as they are; only what a screen reader's heading list says changes.
 *
 * @param {HTMLElement} doc
 */
function nestHeadings(doc) {
  for (const el of doc.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const level = el.classList.contains('report-title') ? 3 : Math.min(6, (Number(el.localName[1]) || 2) + 2);
    el.setAttribute('aria-level', String(level));
  }
}

/** A Dossier document, through the report renderer itself. */
function renderDossier(scroll, col, notes) {
  scroll.classList.add('reader--dossier');
  const read = readText(col.source.text);
  if (!read.ok) {
    scroll.innerHTML = notes.join('') + note(`Use Edit source in the column menu to fix it. The reader said: ${read.fatal?.message || 'no reason given'}`, 'This Dossier document could not be read.');
    return { kind: 'error', blocks: [], stats: null, scrollEl: scroll, headingEls: [], headings: [] };
  }
  if (notes.length) scroll.insertAdjacentHTML('beforeend', notes.join(''));
  const doc = document.createElement('div');
  doc.className = 'reader__doc';
  scroll.append(doc);
  renderReport(read.model, doc, { allPages: true, interactive: false, titleLevel: 2, idPrefix: `cmp-${col.id}` });
  nestHeadings(doc);
  const parsed = elementToIr(doc, { svg: false });
  const headingEls = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter((el) => el.textContent.trim() && !el.closest('[aria-hidden="true"], svg, .viz-panel'));
  return {
    kind: 'reader',
    blocks: parsed.blocks,
    stats: extract(parsed.blocks),
    scrollEl: scroll,
    headingEls,
    headings: headingEls.map((el) => ({ text: el.textContent.replace(/\s+/g, ' ').trim(), level: Number(el.localName[1]) || 2 })),
  };
}
