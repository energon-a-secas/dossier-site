/**
 * Export functions for reports.
 *
 * The JSON, YAML and deck files carry the authored document: `authored()`
 * drops every field js/derive.js computed, so a file opened again raises no
 * warnings about derived fields its author never wrote. Passing a plain
 * document is fine too; it comes back unchanged. The HTML file and the print
 * view are renders, so they take the derived model.
 */

import { downloadText, showToast } from './neorgon-dom.js';
import { renderReport } from './render/index.js';
import { reportOf } from './render/model.js';
import { bindComparisons } from './comparison-controls.js';
import { authored } from './pipeline.js';
import { embedViewFor } from './embeds.js';
import { fitEmbedFrames } from './embed-fit.js';

/**
 * Export the document as JSON.
 *
 * @param {object} doc the authored document, or a model to strip
 */
export function exportJson(doc) {
  const json = JSON.stringify(authored(doc), null, 2);
  downloadText(json, 'report.json', 'application/json');
}

/**
 * Export the document as YAML.
 *
 * @param {object} doc the authored document, or a model to strip
 */
export async function exportYaml(doc) {
  const { dump } = await import('./vendor/js-yaml.mjs');
  downloadText(dump(authored(doc), { noRefs: true, lineWidth: 100 }), 'report.yaml', 'text/yaml');
}

/**
 * Export a standalone HTML file that opens offline.
 *
 * Reuses the live renderer and inlines all readable stylesheets.
 *
 * @param {object} model
 * @returns {Promise<void>}
 */
export async function exportStandaloneHtml(model) {
  try {
    const container = document.createElement('div');
    container.id = 'export-container';
    // An imported HTML report goes out in the view the reader has on screen:
    // a static frame (fitted to its document by the inline script below), the
    // report running its scripts in a sealed srcdoc frame, or Dossier format.
    renderReport(model, container, {
      allPages: true, interactive: true, standalone: true, embedView: embedViewFor,
    });
    const html = container.innerHTML;
    const css = collectStylesheets();
    if (!css) {
      showToast('Could not collect stylesheets. Export aborted.');
      return;
    }
    const tokensCss = extractTokens();
    const inlineScript = generateInlineScript();
    const doc = `<!DOCTYPE html>
<html lang="en" data-appearance="${document.documentElement.dataset.appearance === 'dark' ? 'dark' : 'light'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtmlAttr(reportOf(model)?.title || 'Report')}</title>
  <style>
${tokensCss}
${css}
  </style>
  <noscript><style>.compare__tools,.compare__switch,.compare__control{display:none}.compare__face[hidden]{display:block!important}.compare--slider .compare__img--before{position:relative;clip-path:none}.compare--overlay .compare__img--fade{position:relative;opacity:1}</style></noscript>
</head>
<body class="ds-export">
${html}
${inlineScript}
</body>
</html>`;
    downloadText(doc, 'report.html', 'text/html');
    return true;
  } catch {
    showToast('Could not export as HTML');
    return false;
  }
}

function collectStylesheets() {
  const allCss = [];
  try {
    for (const sheet of document.styleSheets) {
      try {
        const rules = sheet.cssRules || [];
        for (const rule of rules) {
          allCss.push(rule.cssText);
        }
      } catch {
        /* swallow cross-origin sheets */
      }
    }
  } catch {
    return null;
  }
  if (allCss.length === 0) {
    return null;
  }
  return allCss.join('\n');
}

/**
 * Capture the design tokens as literal values.
 *
 * This is the part of a self-contained export that is easy to get wrong and
 * invisible until someone opens the file. The fleet's tokens live in a
 * cross-origin stylesheet on the CDN, so `cssRules` cannot be read and the
 * inlined CSS carries hundreds of `var(--space-4)` references with nothing
 * defining them. The page still renders, which is the trap: it renders with no
 * spacing, no type scale and no surfaces, and nothing reports an error.
 *
 * The earlier version carried a hand written list of six names, none of which
 * the fleet actually defines, so it captured nothing at all. The list is now
 * derived: every `var(--token)` our own readable stylesheets mention gets
 * looked up on the live root and written out as a literal. A token the CSS
 * does not use is not needed, and a token it does use cannot be forgotten.
 */
function extractTokens() {
  const names = new Set();

  // Harvest from the sheets we can read. The cross-origin ones are the reason
  // this function exists, so failing to read them is expected.
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      continue;
    }
    for (const rule of rules) {
      const text = rule.cssText || '';
      for (const match of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        names.add(match[1]);
      }
      // A token defined in terms of another token still needs the other one.
      for (const match of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
        names.add(match[1]);
      }
    }
  }

  const style = getComputedStyle(document.documentElement);
  const lines = [];
  for (const name of Array.from(names).sort()) {
    const value = style.getPropertyValue(name).trim();
    if (value) lines.push(`  ${name}: ${value};`);
  }

  if (!lines.length) return '';

  return `/* Design tokens, resolved to literals at export time. The fleet's\n`
    + `   base.css is cross-origin and cannot be inlined, so its values are\n`
    + `   captured here instead. ${lines.length} tokens. */\n`
    + `:root {\n${lines.join('\n')}\n}\n`;
}

/**
 * Native disclosures and the shared comparison controls work offline, and an
 * imported HTML report's static frame is sized to its document and keeps
 * working links. Both functions travel as their own source; neither reaches
 * outside its body.
 */
function generateInlineScript() {
  return `<script>(${bindComparisons.toString()})(document);\n(${fitEmbedFrames.toString()})(document, { links: true });</script>`;
}


function escHtmlAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Trigger the browser print dialog.
 */
/**
 * Print, or save as PDF, which is how a report gets attached to a ticket.
 *
 * Calling window.print() on its own printed one page: the live view renders
 * the page the reader is on, so the other six were not in the document at all.
 * Nothing said so, and a one page PDF of a seven page report looks like a
 * complete document.
 *
 * So the whole report is rendered in sequence first, printed, and the view put
 * back afterwards. `afterprint` is the restore hook; a timer backs it up
 * because it does not fire in every browser when a print dialog is dismissed.
 *
 * @param {object} model the report to print
 * @param {HTMLElement} container the element the live view renders into
 * @param {{page?: string, titleLevel?: number}} [restore] what to put back afterwards
 */
export function exportPrint(model, container, restore = {}) {
  if (!model || !container) {
    window.print();
    return;
  }

  let restored = false;
  const putItBack = () => {
    if (restored) return;
    restored = true;
    renderReport(model, container, { page: restore.page, interactive: true, titleLevel: restore.titleLevel });
  };

  renderReport(model, container, { print: true });

  window.addEventListener('afterprint', putItBack, { once: true });
  setTimeout(putItBack, 60000);

  // Let the layout settle before the dialog measures it.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

/**
 * Export as a Presentation Sage deck (slides.neorgon.com): the
 * `presentation:` YAML that tool reads. `deckFromDocument`, below in this
 * file, does the mapping.
 *
 * @param {object} doc the authored document, or a model to strip
 * @returns {Promise<boolean>}
 */
export async function exportSageDeck(doc) {
  try {
    const deck = deckFromDocument(authored(doc));
    const { dump } = await import('./vendor/js-yaml.mjs');
    downloadText(dump(deck, { noRefs: true, lineWidth: 100 }), 'presentation.yaml', 'text/yaml');
    return true;
  } catch {
    showToast('Could not export as deck');
    return false;
  }
}

// ── Presentation Sage mapping ────────────────────────────────────────────────

const text = (v) => (v === undefined || v === null ? '' : String(v));

/** Prose to bullets: one per paragraph or line, without Markdown list marks. */
function bulletsOf(value) {
  return text(value).split(/\n+/).map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()).filter(Boolean);
}

function cell(v) {
  if (v && typeof v === 'object') return text(v.label ?? v.value ?? v.text ?? JSON.stringify(v));
  return text(v);
}

function withUnit(value, unit) {
  const v = text(value);
  if (!unit) return v;
  return unit === '%' ? `${v}%` : `${v} ${unit}`;
}

const CHECK = { done: 'done', pass: 'done', partial: 'doing', 'in-progress': 'doing', blocked: 'blocked', fail: 'blocked' };

function tableSlide(heading, columns, rows) {
  return { type: 'table', heading, columns, rows: rows.map((r) => r.map(cell)) };
}

/** One compare side, labelled, as split-slide content. */
function compareSide(side, fallback, kind) {
  const s = side || {};
  const heading = text(s.label) || fallback;
  if (kind === 'image') return { heading, bullets: [text(s.caption) || text(s.src) || 'Image'] };
  if (kind === 'metrics' || kind === 'table') {
    const items = Array.isArray(s.items) ? s.items : [];
    return { heading, bullets: items.map((i) => (Array.isArray(i) ? i.map(cell).join(' | ') : i && typeof i === 'object' ? `${text(i.label)}: ${withUnit(i.value, i.unit)}` : cell(i))) };
  }
  const bullets = kind === 'code' || kind === 'log' ? text(s.value).split('\n').filter((l) => l.trim()) : bulletsOf(s.value);
  return { heading, bullets: s.caption ? [text(s.caption), ...bullets] : bullets };
}

/** One block to zero or more slides. Unknown or unslidable blocks are skipped. */
function slidesForBlock(block, heading) {
  const b = block || {};
  const h = text(b.title) || heading;
  const items = Array.isArray(b.items) ? b.items : [];
  switch (b.type) {
    case 'prose': return [{ type: 'bullets', heading: h, bullets: bulletsOf(b.text) }];
    case 'callout': return [{ type: 'bullets', heading: text(b.label) || h, bullets: bulletsOf(b.text) }];
    case 'quote': return [{ type: 'quote', text: text(b.text), source: [b.who, b.role].filter(Boolean).join(', ') }];
    case 'steps': return [{ type: 'process', heading: h, steps: items.map((i) => ({ label: text(i.title ?? i.label), text: text(i.detail) })) }];
    case 'kv': return [tableSlide(h, ['Item', 'Value'], items.map((i) => [i.label, i.value]))];
    case 'grid': return (Array.isArray(b.blocks) ? b.blocks : []).flatMap((inner) => slidesForBlock(inner, h));
    case 'metrics': return [{
      type: 'stats',
      heading: h,
      stats: items.map((i) => ({
        value: withUnit(i.value, i.unit),
        label: i.baseline !== undefined ? `${text(i.label)}, was ${withUnit(i.baseline, i.unit)}` : text(i.label),
      })),
    }];
    case 'gauge': return [{ type: 'stats', heading: h, stats: [{ value: withUnit(b.value, b.unit), label: text(b.label) || `of ${withUnit(b.max ?? 100, b.unit)}` }] }];
    case 'chart': return [{
      type: 'chart',
      heading: h,
      chart: b.form === 'line' || b.form === 'area' ? 'line' : b.form === 'donut' ? 'pie' : 'bar',
      unit: text(b.unit),
      labels: (b.categories || []).map(text),
      series: (b.series || []).map((sr) => ({ name: text(sr.label ?? sr.name), values: (sr.values || []).map((v) => (Array.isArray(v) ? v.reduce((a, n) => a + (Number(n) || 0), 0) : Number(v) || 0)) })),
    }];
    case 'scorecard': return [{ type: 'checklist', heading: h, items: (b.criteria || []).map((c) => ({ label: text(c.label), state: CHECK[c.verdict] || 'todo', ...(c.detail ? { note: text(c.detail) } : {}) })) }];
    case 'checklist': return [{ type: 'checklist', heading: h, items: items.map((i) => ({ label: text(i.label), state: CHECK[i.state] || 'todo', ...(i.note ? { note: text(i.note) } : {}) })) }];
    case 'actions': return [{ type: 'checklist', heading: h, items: items.map((i) => ({ label: text(i.label), state: CHECK[i.state] || 'todo', ...(i.owner || i.due ? { note: [i.owner, i.due].filter(Boolean).join(', ') } : {}) })) }];
    case 'table': return [tableSlide(h, (b.columns || []).map((c) => cell(c)), (b.rows || []).map((r) => (Array.isArray(r) ? r : Object.values(r || {}))))];
    case 'files': return [tableSlide(h, ['File', 'Change', 'Added', 'Removed'], items.map((i) => [i.path, i.state, i.added, i.removed]))];
    case 'findings': return [tableSlide(h, ['Finding', 'Level', 'Where'], items.map((i) => [i.message, i.level, [i.path, i.line].filter((x) => x !== undefined && x !== '').join(':')]))];
    case 'tests': return [tableSlide(h, ['Test', 'Result'], items.map((i) => [i.name, i.state]))];
    case 'risks': return [tableSlide(h, ['Risk', 'Severity', 'Mitigation'], items.map((i) => [i.title, i.severity, i.mitigation]))];
    case 'evidence': return [tableSlide(h, ['Evidence', 'Kind', 'Checked by'], items.map((i) => [i.label, i.kind, i.checkedBy]))];
    case 'timeline': return [{ type: 'timeline', heading: h, steps: items.map((i) => ({ label: text(i.label), ...(i.at ? { date: text(i.at) } : {}) })) }];
    case 'decision': return [{
      type: 'bullets',
      heading: h,
      bullets: [['Decision', b.decision], ['Context', b.context], ['Consequences', b.consequences], ['Status', b.status]]
        .filter(([, v]) => v).map(([k, v]) => `${k}: ${text(v)}`),
    }];
    case 'code': return [{ type: 'code', heading: text(b.title || b.path) || heading, language: text(b.language) || 'text', code: text(b.source) }];
    case 'diff': return [{ type: 'code', heading: text(b.title || b.path) || heading, language: 'diff', code: text(b.patch || b.after) }];
    case 'log': return [{ type: 'code', heading: h, language: 'text', code: text(b.source) }];
    case 'image': return b.src ? [{ type: 'image', heading: h, src: text(b.src), alt: text(b.alt), ...(b.caption ? { caption: text(b.caption) } : {}) }] : [];
    case 'compare': {
      if (b.kind === 'image' && b.left?.src && b.right?.src) {
        return [{
          type: 'compare',
          heading: h,
          before: { src: text(b.left.src), alt: text(b.left.label) || 'Left', label: text(b.left.label) || 'Left' },
          after: { src: text(b.right.src), alt: text(b.right.label) || 'Right', label: text(b.right.label) || 'Right' },
        }];
      }
      return [{ type: 'split', heading: h, left: compareSide(b.left, 'Left', b.kind), right: compareSide(b.right, 'Right', b.kind) }];
    }
    default: return [];
  }
}

/**
 * A Dossier document to a Presentation Sage deck. A page opens with a
 * divider when there is more than one; each block becomes its own slide,
 * headed by its title, the heading block above it, or the page title.
 *
 * @param {object} doc the authored document
 * @returns {{presentation: object}}
 */
export function deckFromDocument(doc) {
  const report = reportOf(doc) || {};
  const pages = Array.isArray(report.pages) ? report.pages : [];
  const slides = [{ type: 'title', heading: text(report.title) || 'Report', ...(report.subtitle ? { subtitle: text(report.subtitle) } : {}) }];
  for (const page of pages) {
    if (pages.length > 1) slides.push({ type: 'divider', heading: text(page.title) || 'Untitled page', ...(page.summary ? { subtitle: text(page.summary) } : {}) });
    let heading = text(page.title) || 'Untitled page';
    for (const block of page.blocks || []) {
      if (block && block.type === 'heading') {
        heading = text(block.text) || heading;
        continue;
      }
      slides.push(...slidesForBlock(block, heading));
    }
  }
  return {
    presentation: {
      title: text(report.title) || 'Report',
      ...(report.subtitle ? { subtitle: text(report.subtitle) } : {}),
      slides,
    },
  };
}
