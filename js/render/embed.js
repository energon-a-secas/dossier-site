/**
 * The `embed` block: an imported HTML report, shown three ways.
 *
 *   original     the report's own look, in a static frame: srcdoc,
 *                `sandbox="allow-same-origin"` and no scripts, so this page
 *                can size it to its document, catch its links and find its
 *                headings, while nothing in it runs (js/compare/frame.js)
 *   format       Dossier format: the report's text, normalized to the compare
 *                IR and drawn as escaped light-DOM markup in `.reader`
 *                typography, which follows the Display reading options
 *   interactive  "Run the report's scripts": the opaque `embed.html` host
 *                with `sandbox="allow-scripts"` only. Offered only when the
 *                source has scripts (`block.scripts`, set by the adapter).
 *
 * Which view is reader state, never document state: the app keeps it per
 * report (js/embeds.js) and the document is not touched.
 *
 * What this renders depends on where the render goes:
 *   live app (`interactive: true`)  a shell with the view controls and the
 *       source in `data-embed-html`; js/embeds.js builds the view, because
 *       the choice and the frame's listeners belong to the page, not to a
 *       pure render
 *   one-file export (`standalone`)  the view `ctx.embedView(block)` names:
 *       a static frame fitted by js/embed-fit.js, which travels in the file,
 *       a scripted srcdoc frame, or the Dossier format markup
 *   print                           Dossier format: a frame prints as one
 *       clipped box, and a report is longer than a page
 *   `interactive: false` (Compare columns, catalog previews)  Dossier format
 *   anything else                   a static frame at the block's height
 *
 * Never `allow-scripts` with `allow-same-origin` on one frame (a srcdoc frame
 * inherits this page's origin), and no source markup reaches this page except
 * inside a sandboxed frame's srcdoc.
 */

import { escHtml } from '../neorgon-dom.js';
import { emptyFrame, safeLink } from './markdown.js';
import { embedDocument } from '../embed-policy.js';
import { staticCopy, scriptedCopy, remoteResources, blockedSentence } from '../compare/frame.js';
import { htmlToIr } from '../compare/normalize.js';
import { renderIr } from '../compare/ir-render.js';
import { icon } from '../compare/icons.js';
import { embedHeadingPrefix } from './outline.js';

export const EMBED_VIEWS = Object.freeze(['original', 'format', 'interactive']);

/** The height a fixed frame takes: the block's own, or 780. */
const DEFAULT_HEIGHT = 780;

/**
 * The viewport height a static copy fixes `vh` units to when the frame is
 * sized to its document. The export has no reader's screen to ask, so it
 * takes a laptop's.
 */
export const EXPORT_VIEWPORT = 800;

/**
 * A view a block can show: 'interactive' only when the source has scripts,
 * and 'original' for anything unknown.
 *
 * @param {object} block
 * @param {unknown} wanted
 * @returns {'original'|'format'|'interactive'}
 */
export function embedViewOf(block, wanted) {
  if (wanted === 'format') return 'format';
  if (wanted === 'interactive' && block?.scripts === true) return 'interactive';
  return 'original';
}

/** The accessible name of a frame: the report, then how it is shown. */
export function embedFrameTitle(name, view) {
  const report = String(name || 'HTML report').slice(0, 120);
  return `${report}, ${view === 'interactive' ? 'running its scripts' : 'original layout'}`;
}

/** One notice line, in the sunken box the Compare view uses for the same job. */
export function embedNote(text, strong = '') {
  return `<p class="embed-note">${icon('info')}<span>${strong ? `<b>${escHtml(strong)}</b> ` : ''}${escHtml(text)}</span></p>`;
}

/** The sentence under a frame running the report's scripts. */
export const SCRIPTS_NOTE = 'They run in a sealed frame with no network, no storage and no access to this page. Values they compute can differ from the Original view.';

/**
 * Dossier format: the report's text as escaped markup, with the notes that
 * say what the normalizing left out. Heading ids are `<prefix>-h<n>`.
 *
 * The notes go at the top of the text column itself, so they take its width
 * and its left edge; outside it, the measure (a width in the face's own
 * advances) came out narrower at the notes' smaller size.
 *
 * The remote image count covers only the part of the page this view reads.
 * The Original view counts the whole page, the images its styles ask for and
 * its stylesheets included (`originalNotes`), which is often more, so each
 * sentence says which of the two it counted.
 *
 * @param {string} html
 * @param {string} prefix
 * @returns {string}
 */
export function formatMarkup(html, prefix) {
  const parsed = htmlToIr(html);
  const notes = [];
  if (parsed.info.looksLikeApp) notes.push(embedNote('This looks like a saved web app: only its static text is shown.'));
  if (parsed.info.remoteImages) {
    const n = parsed.info.remoteImages;
    notes.push(embedNote(`${n} remote image${n === 1 ? '' : 's'} in the text below ${n === 1 ? 'was' : 'were'} not loaded. Dossier never fetches from other sites.`));
  }
  if (!parsed.blocks.length) notes.push(embedNote('No readable text was found in this report.'));
  return `<div class="reader block-embed-reader"><div class="reader__doc">${notes.join('')}${renderIr(parsed.blocks, { colId: prefix })}</div></div>`;
}

/**
 * The notice for an Original view: what the frame did not load, if anything.
 * It counts the whole page, so it says so: the Dossier format counts only
 * the images in the text it shows, which is fewer.
 */
export function originalNotes(html) {
  const blocked = blockedSentence(remoteResources(html));
  return blocked ? [embedNote(`Across the whole page and its styles, ${blocked}`)] : [];
}

/**
 * The view controls. Every button starts unpressed; js/embeds.js presses the
 * one in effect. "Run the report's scripts" is a toggle on the Original view,
 * and is only there when the source has scripts.
 */
function viewBar(scripts) {
  const run = scripts
    ? `<button type="button" class="btn btn--sm btn--quiet toggle embed-bar__scripts" data-action="embed-view" data-view="interactive" aria-pressed="false"><span class="box">${icon('check')}</span>Run the report’s scripts</button>`
    : '';
  return `<div class="embed-bar">
      <div class="seg embed-bar__views" role="group" aria-label="Show this HTML report">
        <button type="button" data-action="embed-view" data-view="original" aria-pressed="false">Original</button>
        <button type="button" data-action="embed-view" data-view="format" aria-pressed="false">Dossier format</button>
      </div>${run}
    </div>`;
}

function blockHeight(block) {
  const n = Number(block.height);
  return Number.isFinite(n) && block.height !== null && block.height !== '' ? Math.max(160, Math.min(10000, n)) : DEFAULT_HEIGHT;
}

/** A static frame as markup. `fit` marks it for js/embed-fit.js. */
function staticFrameHtml(html, { title, height, fit, viewportHeight = 0 }) {
  const content = embedDocument(staticCopy(html, { viewportHeight }), false);
  return `<iframe class="block-embed block-embed--static"${fit ? ' data-embed-fit=""' : ''} sandbox="allow-same-origin"
            referrerpolicy="no-referrer" title="${escHtml(title)}"
            srcdoc="${escHtml(content)}" style="--embed-height: ${height}px;"></iframe>`;
}

/**
 * @param {object} block
 * @param {object} [ctx] the render context (js/render/index.js)
 */
export function renderEmbed(block, ctx = {}) {
  if (!block.src && !block.html) {
    return emptyFrame('Embed: add "html" with the markup to show.');
  }

  if (!block.html && block.src) {
    return `<div class="block-embed block-embed--external">
      <p>This embed points at another site. This page does not frame third party
      content, so it is a link rather than a panel.</p>
      ${safeLink(block.src, block.src, 'block-embed__link')}
    </div>`;
  }

  const html = String(block.html);
  const height = blockHeight(block);
  const prefix = embedHeadingPrefix(block, ctx.idPrefix);
  const name = block.title || ctx.model?.title || 'HTML report';
  const scripts = block.scripts === true;

  if (ctx.print) {
    return `<div class="block-embed-html block-embed-html--format">
      <p class="block-embed__caption">Printed in Dossier format: a frame cannot run across pages.</p>
      ${formatMarkup(html, prefix)}
    </div>`;
  }

  if (ctx.standalone) {
    const view = embedViewOf(block, typeof ctx.embedView === 'function' ? ctx.embedView(block) : null);
    if (view === 'format') {
      return `<div class="block-embed-html block-embed-html--format">${formatMarkup(html, prefix)}</div>`;
    }
    if (view === 'interactive') {
      const content = embedDocument(scriptedCopy(html), true);
      return `<div class="block-embed-html">
      ${embedNote(SCRIPTS_NOTE, 'This view runs the report’s own scripts.')}
      <iframe class="block-embed block-embed--interactive" sandbox="allow-scripts" referrerpolicy="no-referrer"
              title="${escHtml(embedFrameTitle(name, view))}" srcdoc="${escHtml(content)}"></iframe>
    </div>`;
    }
    return `<div class="block-embed-html">
      ${originalNotes(html).join('')}
      ${staticFrameHtml(html, { title: embedFrameTitle(name, view), height, fit: true, viewportHeight: EXPORT_VIEWPORT })}
    </div>`;
  }

  if (ctx.interactive === true) {
    // The source travels in an attribute, escaped, and is read back as text
    // by js/embeds.js; it is never parsed into this page.
    return `<div class="block-embed-html block-embed-html--live" data-embed-prefix="${escHtml(prefix)}"
         data-embed-scripts="${scripts}" data-embed-name="${escHtml(String(name).slice(0, 120))}"
         data-embed-html="${escHtml(html)}" style="--embed-height: ${height}px;">
      ${viewBar(scripts)}
      <div class="block-embed__body"></div>
    </div>`;
  }

  if (ctx.interactive === false) {
    return `<div class="block-embed-html block-embed-html--format">${formatMarkup(html, prefix)}</div>`;
  }

  return `<div class="block-embed-html">
    ${staticFrameHtml(html, { title: embedFrameTitle(name, 'original'), height, fit: false })}
  </div>`;
}
