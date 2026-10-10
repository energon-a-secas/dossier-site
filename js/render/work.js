/**
 * Work block renderers: files, diff, code, log, checklist, timeline.
 */

import { escHtml } from '../neorgon-dom.js';

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
    html += `<tr><td><code>${escHtml(file.path || '')}</code></td>`;
    html += `<td>${escHtml(file.state || 'modified')}</td>`;
    html += `<td>${file.added || 0}</td><td>${file.removed || 0}</td></tr>`;
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
  const source = block.source || '';
  const lines = source.split('\n');
  let html = '<pre class="block-code"><code>';
  for (let i = 0; i < lines.length; i++) {
    const lineNum = (block.startLine || 0) + i + 1;
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
    html += `<li class="check-${item.state || 'todo'}" data-state="${item.state || 'todo'}">${escHtml(item.label || '')}`;
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
    html += `<li class="timeline-item timeline-${item.tone || 'neutral'}">`;
    html += `<time class="timeline-time">${escHtml(item.at || '')}</time>`;
    html += `<p class="timeline-label">${escHtml(item.label || '')}</p>`;
    html += '</li>';
  }
  html += '</ol>';
  return html;
}
