/**
 * Work block renderers: files, diff, code, log, checklist, timeline.
 */

import { escHtml } from '../neorgon-dom.js';
import { inlineMarkdown, safeLink } from './markdown.js';
import { pick, int, TONES } from './enums.js';
import { FILE_STATES, CHECK_STATES } from '../registry/work.js';

const CHECK_WORDS = { done: 'Done', partial: 'Partly done', skipped: 'Skipped', blocked: 'Blocked', todo: 'Not done' };

/** The types this module renders. js/render/dispatch.js builds its
 *  table from these declarations, so a type cannot be routed to a module
 *  that does not handle it. */
export const WORK_TYPES = Object.freeze(['files', 'diff', 'code', 'log', 'checklist', 'timeline']);

export function renderWorkBlock(block, ctx) {
  const type = block.type;
  switch (type) {
    case 'files':
      return renderFiles(block);
    case 'diff':
      return renderDiff(block);
    case 'code':
      return renderCode(block);
    case 'log':
      return renderLog(block);
    case 'checklist':
      return renderChecklist(block);
    case 'timeline':
      return renderTimeline(block);
    default:
      return null;
  }
}

function renderFiles(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 0) return '';
  let html = '<table class="block-files"><thead><tr><th>Path</th><th>State</th><th>Added</th><th>Removed</th></tr></thead><tbody>';
  for (const file of items) {
    if (!file || typeof file !== 'object') continue;
    // Counts are numbers in the schema and were interpolated raw, so a string
    // in either one reached the page as markup.
    const state = pick(file.state, FILE_STATES, 'modified');
    const from = file.from && ['renamed', 'moved'].includes(state)
      ? ` <span class="file-from">from <code>${escHtml(String(file.from))}</code></span>` : '';
    html += `<tr><td><code>${escHtml(String(file.path || ''))}</code>${from}</td>`;
    html += `<td>${state}</td>`;
    html += `<td>${int(file.added)}</td><td>${int(file.removed)}</td></tr>`;
  }
  html += '</tbody></table>';
  return html;
}

function renderDiff(block) {
  const hasContent = block.patch || block.before || block.after;
  if (!hasContent) return '';
  let html = '<div class="block-diff">';
  if (block.path) {
    html += `<p class="diff-path"><code>${escHtml(block.path)}</code></p>`;
  }
  if (block.patch) {
    html += `<pre class="diff-patch"><code>${escHtml(block.patch)}</code></pre>`;
  } else if (block.before || block.after) {
    html += `<div class="diff-split"><div class="diff-before"><pre><code>${escHtml(block.before || '')}</code></pre></div>`;
    html += `<div class="diff-after"><pre><code>${escHtml(block.after || '')}</code></pre></div></div>`;
  }
  html += '</div>';
  return html;
}

function renderCode(block) {
  if (!block.source) return '';
  const source = String(block.source);
  const lines = source.split('\n');
  let html = block.path ? `<p class="code-path"><code>${escHtml(String(block.path))}</code></p>` : '';
  html += '<pre class="block-code"><code>';
  // Number() first: a string "5" used to concatenate into line "501".
  const start = int(block.startLine);
  for (let i = 0; i < lines.length; i++) {
    const lineNum = start + i + 1;
    const isHighlighted = Array.isArray(block.highlight) && block.highlight.includes(lineNum);
    html += `<span class="line ${isHighlighted ? 'hl' : ''}">${escHtml(lines[i])}</span>\n`;
  }
  html += '</code></pre>';
  return html;
}

function renderLog(block) {
  if (!block.source) return '';
  const source = block.source || '';
  let html = '<pre class="block-log"><code>';
  html += escHtml(source);
  html += '</code></pre>';
  return html;
}

function renderChecklist(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 0) return '';
  let html = '<ul class="block-checklist">';
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    // The state was written raw into a class and an attribute. The note is
    // what the linter asks for on anything not done, and it was never shown.
    const state = pick(item.state, CHECK_STATES, 'todo');
    const label = item.label ?? item.text ?? '';
    html += `<li class="check-${state}" data-state="${state}"><span class="visually-hidden">${CHECK_WORDS[state]}: </span>${escHtml(String(label))}`;
    if (item.note) html += `<p class="check-note">${inlineMarkdown(String(item.note))}</p>`;
    html += '</li>';
  }
  html += '</ul>';
  return html;
}

function renderTimeline(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 0) return '';
  let html = '<ol class="block-timeline">';
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    html += `<li class="timeline-item timeline-${pick(item.tone, TONES, 'neutral')}">`;
    html += `<time class="timeline-time">${escHtml(String(item.at || ''))}</time>`;
    const label = item.href ? safeLink(item.href, String(item.label || item.href)) : escHtml(String(item.label || ''));
    html += `<p class="timeline-label">${label}</p>`;
    if (item.detail) html += `<p class="timeline-detail">${escHtml(String(item.detail))}</p>`;
    html += '</li>';
  }
  html += '</ol>';
  return html;
}
