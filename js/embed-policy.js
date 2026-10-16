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

/** Restrict imported markup independently of the workspace's script policy. */
export function embedDocument(html, scripts = false) {
  const policy = `default-src 'none'; script-src ${scripts ? "'unsafe-inline'" : "'none'"}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  // Parsed before supplied content. Later policies can only tighten it.
  // The iframe sandbox separately isolates the document's origin.
  return `<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`
    + String(html).replace(/^\s*<!doctype[^>]*>/i, '');
}
