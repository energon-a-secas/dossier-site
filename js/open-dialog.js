/**
 * The Open dialog's file and paste handling, and a file dropped on the page.
 *
 * - "Choose a file" is a product button driving a hidden file input, with the
 *   chosen file's name on the line beside it, as the Compare view's column
 *   does. The platform control wrote "Choose File" and "No file chosen" in
 *   its own case and language beside the dialog's own buttons.
 * - A chosen file is remembered by name while the paste box still holds its
 *   text, so a file that fails to read is named ("bad.json could not be
 *   read"), not called "Pasted text". Editing the text forgets the name.
 * - Every way the dialog closes empties it: the paste box, the chosen file,
 *   its name and the line. It kept the last file and text, so reopening it
 *   and pressing Open saved a second copy of the same report. A failed open
 *   leaves the dialog open, with the text there to correct.
 * - A file is refused before it is read when it is far over the size cap,
 *   and before it reaches the paste box when it is over the cap or not text,
 *   so a 25 MB file no longer froze the tab filling the box.
 */

import { registerActions } from './actions.js';
import { openText, describeDetected, markDetected } from './open.js';
import { HTML_MAX_CHARS, reportTooLargeMessage, reportTooLargeBytesMessage } from './embed-policy.js';
import { notText, NOT_TEXT_MESSAGE, fileText } from './text-check.js';
import { say } from './share.js';

/** A file over this many bytes is over the cap at any UTF-8 width; it is not read. */
const MAX_FILE_BYTES = HTML_MAX_CHARS * 4;

/** The file the dialog read, `{name, text}`, while the paste box still holds it. */
let chosen = null;
/** True while an open from the dialog is in flight, so a double press opens once. */
let confirming = false;

/**
 * @param {object} state
 * @param {ReturnType<import('./events.js').elements>} els
 */
export function bindOpenDialog(state, els) {
  els.importFile?.addEventListener('change', () => chooseFile(els));
  els.importText?.addEventListener('input', () => {
    if (chosen && els.importText.value !== chosen.text) forgetFile(els);
    describeDetected(els, els.importText.value);
  });
  // Every way it closes: Open it, Cancel, Escape, an example, a comparison
  // handed to the Compare view.
  els.importDialog?.addEventListener('close', () => resetImport(els));
  registerActions({
    'import-choose-file': () => {
      if (!els.importFile) return;
      // Cleared first, so choosing the same file again still fires change.
      els.importFile.value = '';
      els.importFile.click();
    },
    'import-confirm': async () => {
      if (confirming) return;
      confirming = true;
      try {
        const text = els.importText?.value || '';
        const label = chosen && text === chosen.text ? chosen.name : 'Pasted text';
        if (await openText(state, els, text, label)) els.importDialog?.close();
      } finally {
        confirming = false;
      }
    },
  });
}

/** Read the chosen file into the paste box, unless it is refused first. */
async function chooseFile(els) {
  const file = els.importFile?.files?.[0];
  if (!file) return;
  forgetFile(els);
  if (els.importText) els.importText.value = '';
  if (file.size > MAX_FILE_BYTES) {
    refuseFile(els, reportTooLargeBytesMessage(file.size, file.name));
    return;
  }
  let text = '';
  try {
    text = await fileText(file);
  } catch {
    refuseFile(els, `${file.name} could not be read.`);
    return;
  }
  if (text.length > HTML_MAX_CHARS) {
    refuseFile(els, reportTooLargeMessage(text.length, file.name));
    return;
  }
  if (notText(text)) {
    refuseFile(els, NOT_TEXT_MESSAGE);
    return;
  }
  chosen = { name: file.name, text };
  if (els.importFileName) els.importFileName.textContent = file.name;
  if (els.importText) els.importText.value = text;
  describeDetected(els, text);
}

/**
 * Say why a file was not taken, in the dialog's line (a status region inside
 * the modal; a toast would sit under its backdrop), and clear the picker so
 * the same file can be chosen again.
 */
function refuseFile(els, message) {
  markDetected(els, message, true);
  if (!els.importDialog?.open) say(message);
  if (els.importFile) els.importFile.value = '';
}

function forgetFile(els) {
  chosen = null;
  if (els.importFileName) els.importFileName.textContent = '';
}

/** Empty the dialog: the paste box, the chosen file, its name and the line. */
export function resetImport(els) {
  forgetFile(els);
  if (els.importText) els.importText.value = '';
  if (els.importFile) els.importFile.value = '';
  markDetected(els, '');
}

/**
 * A file dropped anywhere on the page. Refused unread when it is far over
 * the cap; otherwise read as the dialog reads a file (UTF-16 by its byte
 * order mark), and opened, which checks the cap and that it is text.
 *
 * @returns {Promise<boolean>}
 */
export async function openDroppedFile(state, els, file) {
  if (file.size > MAX_FILE_BYTES) {
    say(reportTooLargeBytesMessage(file.size, file.name));
    return false;
  }
  let text = '';
  try {
    text = await fileText(file);
  } catch {
    say(`${file.name} could not be read.`);
    return false;
  }
  return openText(state, els, text, file.name);
}
