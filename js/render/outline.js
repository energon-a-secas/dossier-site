/**
 * Outline generation: page and heading navigation structure.
 *
 * The single implementation. index.js re-exports it so that callers have one
 * import site; an earlier version of index.js carried a second, slightly
 * different copy that nothing imported.
 */

import { reportOf } from './model.js';

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
 * Extract heading hierarchy from blocks.
 */
function extractHeadings(blocks) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks
    .filter((b) => b && b.type === 'heading')
    .map((h) => ({
      id: h.id,
      text: h.text,
      level: h.level || 2,
    }));
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
