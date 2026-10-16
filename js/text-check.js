/**
 * Whether a file is text at all, before anything tries to read it as a
 * report, and how a file's bytes become text.
 *
 * A PDF, an image or an archive decodes into a string like any other file,
 * and the Markdown detector needs only one line starting with `>` or `#` in
 * it: 300,000 random bytes opened as a Markdown report called "Document",
 * were saved, and froze the tab for over a second, and a PDF reached the
 * YAML parser, whose error quoted raw binary back at the reader. So binary
 * input is refused here, in both views, with one plain sentence.
 *
 * Pure and DOM-free; Node imports it. Control characters are written as
 * escapes, never as raw bytes (make check byte-scans this tree).
 */

/** What the reader is told, in both views. */
export const NOT_TEXT_MESSAGE = 'This file is not text (a PDF, an image or an archive, for example), so Dossier cannot read it. Open a JSON, YAML, HTML, Markdown or plain-text report.';

/** How much of the text the replacement and control count reads. */
const SAMPLE = 65536;

/**
 * True when `text` is the decoded bytes of a binary file: it has a NUL
 * anywhere, or its first 64K characters hold more than 1% (and more than 8)
 * C0 control characters, or more than 20% replacement characters (U+FFFD,
 * what bytes that are not UTF-8 decode to). Tab, line feed, vertical tab,
 * form feed, carriage return and escape are text: ESC starts the ANSI
 * colours of a CI log.
 *
 * Replacement characters count for less because a Latin-1 file's accented
 * letters decode to them too: Spanish prose saved as Latin-1 has one every
 * fifty characters or so and is still text, and so is a report with a stray
 * one or two. Binary has a control character in about every ten.
 *
 * Counted with a loop over character codes, so a large binary allocates no
 * array of matches.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function notText(text) {
  if (typeof text !== 'string' || !text) return false;
  if (text.includes('\u0000')) return true;
  const end = Math.min(text.length, SAMPLE);
  let controls = 0;
  let replaced = 0;
  for (let i = 0; i < end; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0xfffd) replaced += 1;
    else if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0b
      && code !== 0x0c && code !== 0x0d && code !== 0x1b) controls += 1;
  }
  return controls > Math.max(8, end * 0.01) || replaced > Math.max(8, end * 0.2);
}

/**
 * A file's bytes as text, by its byte order mark: UTF-16 (little or big
 * endian, which Windows PowerShell 5.1 writes) or UTF-8. `file.text()`
 * always reads UTF-8, so a UTF-16 report arrived full of NULs and would be
 * refused as binary.
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {string}
 */
export function decodeBytes(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  // TextDecoder drops a byte order mark that matches its encoding.
  return new TextDecoder(encoding).decode(bytes);
}

/**
 * A chosen or dropped file as text (`decodeBytes`).
 *
 * @param {Blob} file
 * @returns {Promise<string>}
 */
export async function fileText(file) {
  if (typeof file.arrayBuffer !== 'function') return file.text();
  return decodeBytes(await file.arrayBuffer());
}
