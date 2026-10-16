/**
 * Outline generation: page and heading navigation structure.
 *
 * The single implementation. index.js re-exports it so that callers have one
 * import site; an earlier version of index.js carried a second, slightly
 * different copy that nothing imported.
 */

import { reportOf } from './model.js';
import { htmlOutline } from '../compare/normalize.js';

/**
 * An imported HTML report's headings in the outline stop at this level and
 * this count: a long report has dozens of h4 to h6 that turn the rail into a
 * second copy of the report.
 */
const EMBED_LEVEL = 3;
const EMBED_HEADINGS = 80;

/**
 * Extract outline from a model.
 * Returns array of pages with their heading hierarchy.
 */
export function outline(input) {
  const model = reportOf(input);
  if (!model || !Array.isArray(model.pages)) {
    return [];
  }

  return model.pages.map((page) => ({
    id: page.id,
    title: page.title,
    summary: page.summary,
    headings: extractHeadings(page.blocks),
  }));
}

/**
 * Extract heading hierarchy from blocks: heading blocks, and the headings
 * inside an imported HTML report (an `embed` with `html`).
 */
function extractHeadings(blocks) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  const out = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'heading') {
      out.push({ id: b.id, text: b.text, level: b.level || 2 });
    } else if (b.type === 'embed' && typeof b.html === 'string' && b.html) {
      out.push(...embedHeadings(b));
    }
  }
  return out;
}

/**
 * The id prefix of an embed's headings: `<prefix>-h<n>` names the n-th one
 * in every view of it. The Dossier format writes those ids on its headings
 * (js/compare/ir-render.js), and the Original view places an anchor with the
 * same id over each heading in its frame (js/embeds.js), so one outline link
 * reaches the heading whichever view is on screen. Same character rule as
 * the IR renderer's ids.
 *
 * @param {object} block
 * @param {string} [idPrefix] the render's own prefix (Compare columns)
 */
export function embedHeadingPrefix(block, idPrefix = '') {
  const own = String(block?.id || 'embed');
  const full = idPrefix ? `${idPrefix}-${own}` : own;
  return full.replace(/[^A-Za-z0-9_-]/g, '') || 'embed';
}

/** An imported HTML report's headings, as outline entries. */
function embedHeadings(block) {
  const prefix = embedHeadingPrefix(block);
  return htmlOutline(block.html)
    .filter((h) => h.level <= EMBED_LEVEL && h.text)
    .slice(0, EMBED_HEADINGS)
    .map((h) => ({ id: `${prefix}-h${h.n}`, text: h.text.slice(0, 120), level: h.level }));
}

/**
 * Flatten outline to a list of links.
 */
export function outlineFlat(model) {
  const items = [];
  const o = outline(model);

  for (const page of o) {
    items.push({
      id: `page-${page.id}`,
      text: page.title,
      level: 1,
    });

    for (const heading of page.headings) {
      items.push({
        id: heading.id,
        text: heading.text,
        level: heading.level,
      });
    }
  }

  return items;
}
