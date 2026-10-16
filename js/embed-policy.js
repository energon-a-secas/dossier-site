/**
 * The policy and the size cap for imported HTML, in one DOM-free place.
 *
 * Three readers used to carry three different limits: the registry allowed
 * 400,000 characters in an embed, embed.html silently dropped anything over
 * 410,000, and the import path had no limit at all. So a 648 KB report opened
 * with a success toast and rendered as a blank frame. One number now, read by
 * the registry (the embed "html" maxLen), the import adapter and the compare
 * view. embed.html cannot import a module under its own policy, so it repeats
 * the number, and tests/embed-cap.test.mjs fails if the two ever disagree.
 */

/** The largest HTML source, in characters, that Dossier opens or previews. */
export const HTML_MAX_CHARS = 2000000;

/** The sentence a reader sees when a source is over the cap, never a blank frame. */
export function htmlTooLargeMessage(length) {
  const size = Number(length) || 0;
  return `This HTML report is ${size.toLocaleString('en-US')} characters long, over the ${HTML_MAX_CHARS.toLocaleString('en-US')} character limit Dossier opens. Open the file in its own browser tab, or split it into smaller reports.`;
}

/**
 * The sentence for any report over the cap, in the Reports view: Markdown,
 * JSON, YAML and text had no limit of their own, so an 8 MB Markdown file
 * froze the tab for four seconds, was saved, and slowed every later visit,
 * while the Compare view refused the same file.
 *
 * @param {number} length in characters
 * @param {string} [name] the file name, or "That text" for a paste
 * @returns {string}
 */
export function reportTooLargeMessage(length, name = 'This report') {
  const size = Number(length) || 0;
  return `${name} is ${size.toLocaleString('en-US')} characters long, over the ${HTML_MAX_CHARS.toLocaleString('en-US')} character limit Dossier opens. Open the file in its own browser tab, or split it into smaller reports.`;
}

/**
 * The same sentence when only a file's size in bytes is known, so a file far
 * over the cap is refused before it is read at all.
 *
 * @param {number} bytes
 * @param {string} [name]
 * @returns {string}
 */
export function reportTooLargeBytesMessage(bytes, name = 'This report') {
  const mb = (Number(bytes) || 0) / 1e6;
  return `${name} is ${mb.toLocaleString('en-US', { maximumFractionDigits: 1 })} MB, over the ${HTML_MAX_CHARS.toLocaleString('en-US')} character limit Dossier opens. Open the file in its own browser tab, or split it into smaller reports.`;
}

/** Restrict imported markup independently of the workspace's script policy. */
export function embedDocument(html, scripts = false) {
  const policy = `default-src 'none'; script-src ${scripts ? "'unsafe-inline'" : "'none'"}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  // Parsed before supplied content. Later policies can only tighten it.
  // The iframe sandbox separately isolates the document's origin.
  return `<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`
    + String(html).replace(/^\s*<!doctype[^>]*>/i, '');
}
