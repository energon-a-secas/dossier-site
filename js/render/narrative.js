/**
 * Narrative block renderers: prose, headings, callouts, etc.
 */

import { escHtml } from '../neorgon-dom.js';
// Imported for grid children. narrative.js and dispatch.js form a cycle, which
// is safe here because the binding is read at call time, not at module init.
import { renderBlock } from './dispatch.js';
import { inlineMarkdown as markdownToHtml, emptyFrame } from './markdown.js';

/** The types this module renders. js/render/dispatch.js builds its
 *  table from these declarations, so a type cannot be routed to a module
 *  that does not handle it. */
export const NARRATIVE_TYPES = Object.freeze(['heading', 'prose', 'callout', 'quote', 'steps', 'kv', 'grid']);


function toneLabel(tone) {
  const labels = {
    neutral: 'Note',
    good: 'Good',
    bad: 'Warning',
    warn: 'Caution',
    info: 'Info',
  };
  return labels[tone] || 'Note';
}

export function renderNarrativeBlock(block, ctx) {
  switch (block.type) {
    case 'heading':
      return renderHeading(block);
    case 'prose':
      return renderProse(block);
    case 'callout':
      return renderCallout(block);
    case 'quote':
      return renderQuote(block);
    case 'steps':
      return renderSteps(block);
    case 'kv':
      return renderKV(block);
    case 'grid':
      return renderGrid(block, ctx);
    default:
      return null;
  }
}

function renderHeading(block) {
  if (!block.text) return emptyFrame('Heading: add "text" to name this section.');
  const level = block.level || 2;
  const tag = `h${Math.max(2, Math.min(3, level))}`;
  return `<${tag} class="block-heading">${escHtml(block.text || '')}</${tag}>`;
}

function renderProse(block) {
  if (!block.text) return emptyFrame('Prose: add "text" with the paragraph to show.');
  const html = markdownToHtml(block.text || '');
  return `<div class="block-prose">${html}</div>`;
}

function renderCallout(block) {
  const tone = block.tone || 'neutral';
  const label = block.label || toneLabel(tone);
  const html = markdownToHtml(block.text || '');
  return `<aside class="block-callout block-callout--${tone}"><strong>${escHtml(label)}</strong> ${html}</aside>`;
}

function renderQuote(block) {
  if (!block.text) return emptyFrame('Quote: add "text" with the words being quoted.');
  const text = markdownToHtml(block.text || '');
  let attr = '';
  if (block.who) {
    attr += `<span class="quote-who">${escHtml(block.who)}</span>`;
  }
  if (block.role) {
    attr += ` <span class="quote-role">${escHtml(block.role)}</span>`;
  }
  if (attr) attr = `<footer class="quote-attr">${attr}</footer>`;
  return `<blockquote class="block-quote"><p>${text}</p>${attr}</blockquote>`;
}

function renderSteps(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 0) return '';
  let html = '<ol class="block-steps">';
  for (const item of items) {
    const text = markdownToHtml(item.label || '');
    const detail = item.detail ? `<p>${markdownToHtml(item.detail)}</p>` : '';
    html += `<li class="step">${text}${detail}</li>`;
  }
  html += '</ol>';
  return html;
}

function renderKV(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 0) return '';
  let html = '<dl class="block-kv">';
  for (const item of items) {
    html += `<dt>${escHtml(item.key || '')}</dt><dd>${markdownToHtml(item.value || '')}</dd>`;
  }
  html += '</dl>';
  return html;
}

/**
 * The only container. It holds child blocks, which is what the registry says
 * and what the lint rules check.
 *
 * The first version read `block.items` and `item.content`, a shape the format
 * does not have, so a grid written to the published schema rendered nothing at
 * all. Children go through the dispatcher, which is also what makes `width`
 * mean something: the registry says `width` is ignored outside a grid, and
 * this is the only place that honours it.
 *
 * One level of nesting. A grid inside a grid is an error the validator already
 * reports, and here it renders as a note rather than recursing.
 */
function renderGrid(block, ctx = {}) {
  const children = Array.isArray(block.blocks) ? block.blocks.filter(Boolean) : [];
  if (!children.length) {
    return emptyFrame('Grid: add "blocks" with the two or three blocks to show side by side.');
  }

  const columns = Number.isFinite(Number(block.columns))
    ? Math.max(2, Math.min(4, Number(block.columns)))
    : Math.min(4, Math.max(2, children.length));

  const cells = children.map((child) => {
    const width = ['full', 'half', 'third', 'two-thirds'].includes(child.width)
      ? child.width
      : 'full';
    const inner = child.type === 'grid'
      ? emptyFrame('A grid cannot hold a grid. One level of nesting is the whole layout model.')
      : (renderBlock(child, { ...ctx, inGrid: true }) || emptyFrame(`No renderer for "${child.type}".`));
    return `<div class="grid-item grid-item--${escHtml(width)}">${inner}</div>`;
  }).join('');

  return `<div class="block-grid" style="--grid-columns: ${columns}">${cells}</div>`;
}

