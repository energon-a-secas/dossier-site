/**
 * Judgment block renderers: risks, actions, decision, compare, image, embed, evidence.
 */

import { escHtml } from '../neorgon-dom.js';
import { inlineMarkdown as markdownToHtml, emptyFrame, safeLink } from './markdown.js';
import { safeImageSrc } from './url.js';
import { compareHtml } from './compare.js';
import { embedDocument } from '../embed-policy.js';
import { pick, enumValues, CHECKED_BY } from './enums.js';

// Every enum below reaches a class name or the page. Each one was interpolated
// raw, which made `severity: 'high" onmouseover="..."'` a live attribute.
const SEVERITY = enumValues('risks', 'items', 'severity');
const LIKELIHOOD = enumValues('risks', 'items', 'likelihood');
const ACTION_STATES = enumValues('actions', 'items', 'state');
const INTENTS = enumValues('actions', 'items', 'intent');
const DECISION_STATUS = enumValues('decision', 'status');

/** The types this module renders. js/render/dispatch.js builds its
 *  table from these declarations, so a type cannot be routed to a module
 *  that does not handle it. */
export const JUDGMENT_TYPES = Object.freeze(['risks', 'actions', 'decision', 'compare', 'image', 'embed', 'evidence']);

export function renderJudgmentBlock(block, ctx) {
  const type = block.type;
  switch (type) {
    case 'risks':
      return renderRisks(block);
    case 'actions':
      return renderActions(block);
    case 'decision':
      return renderDecision(block);
    case 'compare':
      return renderCompare(block, ctx);
    case 'image':
      return renderImage(block);
    case 'embed':
      return renderEmbed(block, ctx);
    case 'evidence':
      return renderEvidence(block);
    default:
      return null;
  }
}

function renderRisks(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 0) return '';
  let html = '<div class="block-risks">';
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const severity = pick(item.severity, SEVERITY, 'medium');
    const likelihood = pick(item.likelihood, LIKELIHOOD, '');
    html += `<div class="risk-item risk-severity--${severity}">`;
    html += `<h4>${escHtml(String(item.title || ''))}<span class="visually-hidden">, ${severity} severity</span></h4>`;
    if (likelihood) {
      html += `<p class="risk-likelihood">Likelihood: ${likelihood}</p>`;
    }
    if (item.mitigation) {
      html += `<p class="risk-mitigation">${markdownToHtml(String(item.mitigation))}</p>`;
    }
    if (item.owner) {
      html += `<p class="risk-owner">Owner: ${escHtml(item.owner)}</p>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderActions(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 0) return '';
  let html = '<div class="block-actions">';
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const state = pick(item.state, ACTION_STATES, 'todo');
    const intent = pick(item.intent, INTENTS, '');
    html += `<div class="action-item action-state--${state}">`;
    html += `<h4>${escHtml(String(item.label || ''))}<span class="visually-hidden">, ${state.replace('-', ' ')}</span></h4>`;
    if (intent) {
      html += `<p class="action-intent">Intent: ${intent}</p>`;
    }
    if (item.owner) {
      html += `<p class="action-owner">Owner: ${escHtml(item.owner)}</p>`;
    }
    if (item.due) {
      html += `<p class="action-due">Due: ${escHtml(item.due)}</p>`;
    }
    if (item.href) {
      html += `<p class="action-link">${safeLink(item.href, 'Ticket')}</p>`;
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderDecision(block) {
  if (!block.context && !block.decision && !block.consequences) {
    return emptyFrame('Decision: add "context", "decision" and "consequences". The third is the one a later reader asks for.');
  }
  let html = '<div class="block-decision">';
  const status = pick(block.status, DECISION_STATUS, 'accepted');
  if (status !== 'accepted') {
    html += `<p class="decision-status">Status: ${status}</p>`;
  }
  if (block.context) {
    html += `<section class="decision-section"><h4>Context</h4><p>${markdownToHtml(block.context)}</p></section>`;
  }
  if (block.decision) {
    html += `<section class="decision-section"><h4>Decision</h4><p>${markdownToHtml(block.decision)}</p></section>`;
  }
  if (block.consequences) {
    html += `<section class="decision-section"><h4>Consequences</h4><p>${markdownToHtml(block.consequences)}</p></section>`;
  }
  if (Array.isArray(block.alternatives) && block.alternatives.length > 0) {
    html += '<section class="decision-section"><h4>Alternatives</h4><ul>';
    for (const alt of block.alternatives) {
      if (!alt || typeof alt !== 'object') continue;
      html += `<li><strong>${escHtml(String(alt.label || ''))}</strong>`;
      if (alt.why_not) {
        html += `: ${markdownToHtml(String(alt.why_not))}`;
      }
      html += '</li>';
    }
    html += '</ul></section>';
  }
  html += '</div>';
  return html;
}

function renderCompare(block, ctx) {
  return compareHtml(block, ctx);
}

function renderImage(block) {
  if (!block.src) return emptyFrame('Image: add "src" and "alt".');
  const checked = safeImageSrc(block.src);
  if (!checked) {
    return emptyFrame('Image: that source is not a kind this page will load. Use an https URL or an inlined data image.');
  }
  const src = escHtml(checked);
  const alt = escHtml(block.alt || 'image');
  let html = `<figure class="block-image"><img src="${src}" alt="${alt}" />`;
  if (block.caption) {
    html += `<figcaption>${escHtml(block.caption)}</figcaption>`;
  }
  html += '</figure>';
  return html;
}

/**
 * Foreign HTML, in a frame that is actually sandboxed.
 *
 * The version this replaces wrote `sandbox="allow-scripts allow-same-origin"`
 * for an embed that asked for scripts. Those two tokens together defeat the
 * sandbox: a srcdoc frame inherits the parent's origin, so allow-same-origin
 * leaves it same-origin with this page, and a script inside it can reach
 * `parent.document`, read every stored report and rewrite the page. Omitting
 * allow-same-origin puts the frame in a unique opaque origin, which is what
 * makes allow-scripts survivable.
 *
 * With scripts off, the frame needs no allowances at all, so `sandbox=""` is
 * the right value rather than a list.
 *
 * A remote src is not framed. This page's policy refuses third party frames,
 * so framing one shows an empty box with no explanation. A link says more.
 */
function renderEmbed(block, ctx = {}) {
  if (!block.src && !block.html) {
    return emptyFrame('Embed: add "html" with the markup to show.');
  }

  const height = Number.isFinite(Number(block.height)) ? Math.max(160, Math.min(10000, Number(block.height))) : 780;

  if (!block.html && block.src) {
    return `<div class="block-embed block-embed--external">
      <p>This embed points at another site. This page does not frame third party
      content, so it is a link rather than a panel.</p>
      ${safeLink(block.src, block.src, 'block-embed__link')}
    </div>`;
  }

  const sandbox = block.scripts === true ? 'allow-scripts' : '';
  const content = embedDocument(block.html, block.scripts === true);
  const source = block.scripts === true && !ctx.standalone
    ? `src="embed.html" data-embed-html="${escHtml(content)}"`
    : `srcdoc="${escHtml(content)}"`;

  return `<div class="block-embed-html">
    <p class="block-embed__caption">Original HTML${block.scripts === true ? ' · interactive' : ''}</p>
    <iframe class="block-embed" sandbox="${sandbox}" referrerpolicy="no-referrer"
            loading="lazy" title="HTML report preview"
            ${source} style="--embed-height: ${height}px;"></iframe>
  </div>`;
}

function renderEvidence(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  if (items.length === 0) return '';
  let html = '<ul class="block-evidence">';
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    html += '<li class="evidence-item">';
    if (item.href) {
      html += safeLink(item.href, String(item.label || 'Link'));
    } else {
      html += escHtml(String(item.label || ''));
    }
    const checkedBy = pick(item.checkedBy, CHECKED_BY, 'none');
    if (checkedBy !== 'none') {
      html += ` <span class="evidence-checked-by">(${checkedBy})</span>`;
    }
    if (item.excerpt) {
      html += `<blockquote class="evidence-excerpt">${escHtml(String(item.excerpt))}</blockquote>`;
    }
    html += '</li>';
  }
  html += '</ul>';
  return html;
}
