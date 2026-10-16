/**
 * Sharing and exporting the open report: one "Share and export" dialog,
 * opened by the header's Share button and the `e` key. The `s` key and the
 * dialog's first choice copy the share link directly.
 *
 * Every file and link carries the authored document (`state.document`), never
 * the derived model, so a recipient who opens it sees no warnings about fields
 * they did not write. The HTML file and the print view are renders, so they
 * take the model.
 */

import { showToast } from './neorgon-dom.js';
import { openDialog } from './dialogs.js';
import { copyShareLink, encodeDocument } from './share.js';
import {
  exportJson, exportYaml, exportStandaloneHtml, exportPrint, exportSageDeck,
} from './export.js';
import { registerActions } from './actions.js';
import { STAGE_TITLE_LEVEL } from './pipeline.js';

const CHOICES = [
  ['copy-link', 'Copy link', ''],
  ['export-html', 'One HTML file', 'Opens with no account, no install and no network. The one to send.'],
  ['export-json', 'JSON document', 'The source, for editing or for another tool.'],
  ['export-yaml', 'YAML document', 'The same document, for hand editing.'],
  ['export-print', 'Print or PDF', 'Every page in sequence, with the links printed.'],
  ['export-deck', 'Presentation Sage deck', 'Hand it to the deck tool when a report has to be presented.'],
];

/** The actions this module owns, registered once from js/events.js. */
export function registerExportActions(state, els) {
  // Every choice closes the dialog first: a toast or a print preview opened
  // behind a modal dialog is not seen.
  const close = () => els.exportDialog?.close();
  registerActions({
    // The `e` key calls showExportChoices directly (js/boot.js), so Share is
    // the dialog's one action name.
    share: (el) => showExportChoices(state, els, el),
    'copy-link': () => { close(); return shareCurrent(state); },
    'export-json': () => { close(); withDocument(state, (doc) => exportJson(doc)); },
    'export-yaml': () => { close(); withDocument(state, (doc) => exportYaml(doc)); },
    'export-html': () => { close(); return exportStandalone(state); },
    'export-print': () => {
      if (!state.model) return;
      close();
      exportPrint(state.model, els.stage, { page: state.page, titleLevel: STAGE_TITLE_LEVEL });
    },
    'export-deck': () => { close(); withDocument(state, (doc) => exportSageDeck(doc)); },
  });
}

function withDocument(state, run) {
  if (!state.document) {
    showToast('There is no report open to export.');
    return;
  }
  run(state.document);
}

export async function shareCurrent(state) {
  if (!state.document) {
    showToast('There is no report open to share.');
    return false;
  }
  return copyShareLink(state.document);
}

export async function showExportChoices(state, els, opener) {
  if (!state.model || !state.document) {
    showToast('There is no report open to export.');
    return;
  }
  const body = els.exportBody;
  if (body) {
    const encoded = await encodeDocument(state.document).catch(() => null);
    const budget = encoded
      ? `The link is about ${encoded.payload.length.toLocaleString()} characters, which ${tierSentence(encoded.tier)}`
      : 'The link size could not be measured.';
    body.replaceChildren();
    const list = document.createElement('div');
    list.className = 'ds-export__choices';
    for (const [action, name, fixedNote] of CHOICES) {
      // The link's note is its size, measured for this report.
      const note = action === 'copy-link'
        ? `${budget} Anyone with the link can read the report.`
        : fixedNote;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ds-export__choice';
      btn.dataset.action = action;
      // A link the share codec would refuse is not offered as a choice.
      if (action === 'copy-link' && encoded?.tier === 'refused') btn.disabled = true;
      const h = document.createElement('strong');
      h.textContent = name;
      const p = document.createElement('span');
      p.textContent = note;
      btn.append(h, p);
      list.appendChild(btn);
    }
    body.append(list);
  }
  openDialog(els.exportDialog, opener);
}

export function tierSentence(tier) {
  switch (tier) {
    case 'travels': return 'travels anywhere.';
    case 'fine': return 'is fine for a message or a ticket.';
    case 'large': return 'works in a browser, though some chat clients will cut it. Send the file instead.';
    default: return 'is too long for a link. Send the file instead.';
  }
}

async function exportStandalone(state) {
  if (!state.model) {
    showToast('There is no report open to export.');
    return;
  }
  const ok = await exportStandaloneHtml(state.model);
  if (ok === false) {
    showToast('The one-file export could not be built. Nothing was downloaded.');
  }
}
