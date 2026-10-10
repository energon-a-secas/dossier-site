/**
 * The inline markdown subset, in one place.
 *
 * Three modules each carried their own copy of this function and each copy
 * had the same defect: the link rule put its target into an href after
 * HTML-escaping it, which escapes the quotes and leaves the scheme, so
 * `[x](javascript:alert(1))` rendered a working link. Fixing one copy left
 * the other two, which is the argument for this file existing.
 *
 * Inline only, by design. A document says what it means with block types, so
 * prose does not need headings, lists or tables, and not supporting them means
 * there is no HTML sanitiser here to get wrong.
 */

import { escHtml } from '../neorgon-dom.js';
import { safeHref } from './url.js';

/**
 * escHtml runs over the whole string first, so a link target arrives with its
 * ampersands already entities. Reverse just enough to judge the scheme. The
 * result is re-escaped before it reaches the attribute.
 */
function unescapeEntities(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function inlineMarkdown(text) {
  if (!text) return '';
  let html = escHtml(text);
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, (match, label, target) => {
    const href = safeHref(unescapeEntities(target));
    if (!href) return `${label} (link removed: ${escHtml(target)})`;
    return `<a href="${escHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return html;
}

/**
 * A block with nothing in it gets a labelled frame, not an empty element. The
 * author is often an agent that will never look at the page, so an invisible
 * gap is a defect that reaches the reader rather than the writer.
 */
export function emptyFrame(what) {
  return `<div class="block-empty" role="note">${escHtml(what)}</div>`;
}

/** A link, or its label as plain text when the target is not safe to link. */
export function safeLink(href, label, className = '') {
  const safe = safeHref(href);
  const text = escHtml(label || 'Link');
  if (!safe) return `<span class="${escHtml(className)} is-unlinked" title="Link removed: unsupported URL scheme">${text}</span>`;
  const cls = className ? ` class="${escHtml(className)}"` : '';
  return `<a${cls} href="${escHtml(safe)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
}
