/**
 * Results block renderers: findings, tests.
 */

import { escHtml } from '../neorgon-dom.js';
import { emptyFrame } from './markdown.js';

/** The types this module renders. js/render/dispatch.js builds its
 *  table from these declarations, so a type cannot be routed to a module
 *  that does not handle it. */
export const RESULTS_TYPES = Object.freeze(['findings', 'tests']);

export function renderResultsBlock(block, ctx) {
  const type = block.type;
  switch (type) {
    case 'findings':
      return renderFindings(block);
    case 'tests':
      return renderTests(block);
    default:
      return null;
  }
}

function renderFindings(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 0) return '';
  let html = '<div class="block-findings">';
  for (const item of items) {
    html += `<div class="finding-item finding-level--${item.level || 'note'}">`;
    html += `<p class="finding-message">${escHtml(item.message || '')}</p>`;
    if (item.path) {
      html += `<p class="finding-path"><code>${escHtml(item.path)}`;
      if (item.line) html += `:${item.line}`;
      html += '</code></p>';
    }
    if (item.rule) {
      html += `<p class="finding-rule">Rule: <code>${escHtml(item.rule)}</code></p>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderTests(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  const hasCounts = block.counts && typeof block.counts === 'object'
    && Object.values(block.counts).some((v) => Number.isFinite(Number(v)));
  if (!items.length && !hasCounts) {
    return emptyFrame('Tests: add "items" with each test, or "counts" when the list is too long to carry.');
  }
  let html = '<div class="block-tests">';
  if (items.length > 0) {
    for (const test of items) {
      html += `<div class="test-item test-state--${test.state || 'passed'}">`;
      html += `<p class="test-name">${escHtml(test.name || '')}</p>`;
      if (test.duration) {
        html += `<p class="test-duration">${test.duration}s</p>`;
      }
      html += '</div>';
    }
  } else if (block.counts) {
    html += '<p>Summary: ';
    if (block.counts.passed) html += `Passed: ${block.counts.passed} `;
    if (block.counts.failed) html += `Failed: ${block.counts.failed} `;
    html += '</p>';
  }
  html += '</div>';
  return html;
}
