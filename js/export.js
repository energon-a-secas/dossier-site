/**
 * Export functions for reports.
 */

import { downloadText, downloadBlob, showToast } from './neorgon-dom.js';
import { renderReport } from './render/index.js';
import { reportOf } from './render/model.js';
import { bindComparisons } from './comparison-controls.js';

/**
 * Export the model as JSON.
 *
 * @param {object} model
 */
export function exportJson(model) {
  const json = JSON.stringify(model, null, 2);
  downloadText(json, 'report.json', 'application/json');
}

/**
 * Export the model as YAML.
 *
 * @param {object} model
 */
export async function exportYaml(model) {
  const { dump } = await import('./vendor/js-yaml.mjs');
  downloadText(dump(model, { noRefs: true, lineWidth: 100 }), 'report.yaml', 'text/yaml');
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
    renderReport(model, container, { allPages: true, interactive: true, standalone: true });
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

/** Native disclosures and the shared comparison controls work offline. */
function generateInlineScript() {
  return `<script>(${bindComparisons.toString()})(document);</script>`;
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
 * @param {{page?: string}} [restore] what to put back afterwards
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
    renderReport(model, container, { page: restore.page, interactive: true });
  };

  renderReport(model, container, { print: true });

  window.addEventListener('afterprint', putItBack, { once: true });
  setTimeout(putItBack, 60000);

  // Let the layout settle before the dialog measures it.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

/**
 * Export as Presentation Sage YAML.
 *
 * Maps a page to a slide, metrics to stats, tables to tables, prose to bullets.
 *
 * @param {object} model
 * @returns {Promise<void>}
 */
export async function exportSageDeck(model) {
  try {
    const pages = model.dossier?.pages || [];
    const slides = pages.map((page) => {
      const slide = {
        title: page.title || 'Untitled',
        layout: 'default',
        blocks: [],
      };
      const blocks = page.blocks || [];
      for (const block of blocks) {
        const type = block.type || 'unknown';
        if (type === 'metric' || type === 'scorecard') {
          slide.blocks.push({
            type: 'stats',
            stats: [
              {
                label: block.title || block.metric || '',
                value: block.value || 0,
              },
            ],
          });
        } else if (type === 'table') {
          slide.blocks.push({
            type: 'table',
            table: block.rows || [],
          });
        } else if (type === 'compare') {
          slide.blocks.push({
            type: 'split',
            left: { type: 'text', text: 'Before' },
            right: { type: 'text', text: 'After' },
          });
        } else if (type === 'prose' || type === 'text') {
          const text = block.text || '';
          const bullets = text.split('\n').filter((l) => l.trim());
          slide.blocks.push({
            type: 'bullets',
            bullets: bullets,
          });
        } else if (type === 'chart') {
          slide.blocks.push({
            type: 'image',
            src: 'chart.svg',
          });
        }
      }
      return slide;
    });
    const deck = { version: '1.0.0', title: model.dossier?.title || 'Report', slides };
    const yaml = modelToYaml(deck);
    downloadText(yaml, 'presentation.yaml', 'text/yaml');
  } catch {
    showToast('Could not export as deck');
  }
}
