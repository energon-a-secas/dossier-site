/**
 * Results block renderers: findings, tests.
 */

import { escHtml } from '../neorgon-dom.js';
import { emptyFrame, inlineMarkdown, safeLink } from './markdown.js';
import { formatNumber } from './format.js';
import { pick, enumValues, int } from './enums.js';
import { FINDING_LEVELS, TEST_STATES } from '../registry/results.js';

const FINDING_STATES = enumValues('findings', 'items', 'state');
const COUNT_KEYS = ['passed', 'failed', 'skipped', 'flaky', 'errored'];

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
    if (!item || typeof item !== 'object') continue;
    // The level went into a class and the line number into the page raw.
    const level = pick(item.level, FINDING_LEVELS, 'note');
    const state = pick(item.state, FINDING_STATES, '');
    html += `<div class="finding-item finding-level--${level}"${state ? ` data-state="${state}"` : ''}>`;
    html += `<p class="finding-message">${escHtml(String(item.message || ''))}</p>`;
    if (item.path) {
      const line = int(item.line, null);
      const end = int(item.endLine, null);
      const span = line !== null ? `:${line}${end !== null && end > line ? `-${end}` : ''}` : '';
      const where = `<code>${escHtml(String(item.path))}${span}</code>`;
      html += `<p class="finding-path">${item.href ? safeLink(item.href, `${item.path}${span}`) : where}</p>`;
    }
    if (state) {
      html += `<p class="finding-state">State: ${state}</p>`;
    }
    if (item.rule) {
      html += `<p class="finding-rule">Rule: <code>${escHtml(String(item.rule))}</code></p>`;
    }
    if (item.detail) {
      html += `<p class="finding-detail">${inlineMarkdown(String(item.detail))}</p>`;
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
  // What was run and how long it took: both are in the schema and neither was
  // shown, so a tests block could not say which suite it was reporting on.
  const runBits = [];
  if (block.suite) runBits.push(`<code>${escHtml(String(block.suite))}</code>`);
  const total = formatNumber(block.duration);
  if (total) runBits.push(`${total}s`);
  if (runBits.length) html += `<p class="tests-run">${runBits.join(' · ')}</p>`;
  if (items.length > 0) {
    for (const test of items) {
      if (!test || typeof test !== 'object') continue;
      // A state outside the enum used to land in a class name, and the
      // duration in the page, both raw.
      const state = pick(test.state, TEST_STATES, 'passed');
      html += `<div class="test-item test-state--${state}">`;
      html += `<p class="test-name">${escHtml(String(test.name || ''))}<span class="visually-hidden">, ${state}</span></p>`;
      const seconds = formatNumber(test.duration);
      if (seconds) {
        html += `<p class="test-duration">${seconds}s</p>`;
      }
      if (test.message && state !== 'passed') {
        html += `<pre class="test-message"><code>${escHtml(String(test.message))}</code></pre>`;
      }
      html += '</div>';
    }
  } else if (block.counts) {
    const parts = COUNT_KEYS
      .filter((key) => Number.isFinite(Number(block.counts[key])) && Number(block.counts[key]) > 0)
      .map((key) => `${key[0].toUpperCase()}${key.slice(1)}: ${int(block.counts[key])}`);
    html += `<p>Summary: ${parts.join(', ') || 'no tests counted'}</p>`;
  }
  html += '</div>';
  return html;
}
