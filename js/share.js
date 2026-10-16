/**
 * Inbound and outbound forms for sharing reports.
 *
 * Inbound:
 *   #d1=<base64url(json)>              uncompressed, forward compatible
 *   #dz=<base64url(deflate-raw(json))> the one we emit
 *   #dc=<base64url(deflate-raw(json))> a comparison bundle, for the Compare
 *                                      view (js/compare/export.js)
 *   ?src=<https url>                   fetch a hosted document, any format the
 *                                      Open dialog reads (js/open.js readText)
 *
 * Outbound links carry the authored document (`state.document`), never the
 * derived model, so the recipient's parse raises no derived-field warnings.
 * js/router.js owns telling a payload from a page route.
 *
 * CompressionStream is native, no dependency. Falls back to uncompressed
 * #d1= if deflate is not available.
 */

import { showToast, copyText } from './neorgon-dom.js';
import { parseRoute } from './router.js';
import { HTML_MAX_CHARS } from './embed-policy.js';

/**
 * The most a `#dz=` or `#dc=` link may inflate to, in bytes: four columns
 * of the largest report Dossier opens, at up to three UTF-8 bytes a
 * character, and a megabyte for the rest of the bundle. Deflate packs about
 * a thousand to one, so a crafted link of a few hundred kilobytes could
 * otherwise unpack to gigabytes in the visitor's tab before any cap on the
 * reports themselves is checked.
 */
export const INFLATE_MAX_BYTES = 4 * HTML_MAX_CHARS * 3 + 1000000;
/** Input is fed to the inflater this many bytes at a time (see below). */
const INFLATE_SLICE = 1024;


function toBase64url(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = str.padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  const binaryStr = atob(padded);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

async function compressDeflateRaw(text) {
  try {
    if (typeof CompressionStream === 'undefined') {
      return null;
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const stream = new CompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    writer.write(data).catch(() => {});
    writer.close().catch(() => {});
    const reader = stream.readable.getReader();
    const chunks = [];
    let result;
    while (!(result = await reader.read()).done) {
      chunks.push(result.value);
    }
    let totalLength = 0;
    for (const chunk of chunks) {
      totalLength += chunk.length;
    }
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined;
  } catch {
    return null;
  }
}

/**
 * Inflate a link's bytes, or null when they are damaged or would inflate
 * past `maxBytes`.
 *
 * The input goes in a slice at a time, each written only once the last has
 * been read out: an inflater handed everything at once unpacks all of it
 * into its queue before the first read, so a budget checked while reading
 * would come too late. A slice unpacks to about a megabyte at most.
 */
async function decompressDeflateRaw(bytes, maxBytes = INFLATE_MAX_BYTES) {
  try {
    if (typeof DecompressionStream === 'undefined') {
      return null;
    }
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    // A damaged link errors the stream, which rejects these writes as well
    // as the read below. Only the read is awaited (and caught), so the
    // writer's rejections are handled here, or a broken link raised an
    // unhandled "Compressed input was truncated." on top of its own message.
    (async () => {
      for (let at = 0; at < bytes.length; at += INFLATE_SLICE) {
        await writer.write(bytes.subarray(at, at + INFLATE_SLICE));
      }
      await writer.close();
    })().catch(() => {});
    const chunks = [];
    let totalLength = 0;
    let result;
    while (!(result = await reader.read()).done) {
      totalLength += result.value.length;
      if (totalLength > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(result.value);
    }
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    const decoder = new TextDecoder();
    return decoder.decode(combined);
  } catch {
    return null;
  }
}

/**
 * Tier a document by its size.
 *
 * Under 2k chars: travels, fine under 8k, large under 32k with warning,
 * refuses above that.
 */
function getTier(payload) {
  const len = payload.length;
  if (len < 2000) return 'travels';
  if (len < 8000) return 'fine';
  if (len < 32000) return 'large';
  return 'refused';
}

/**
 * Encode a document for sharing.
 *
 * @param {object} document
 * @returns {Promise<{payload: string, bytes: number, tier: string}|null>}
 */
export async function encodeDocument(document) {
  try {
    const json = JSON.stringify(document);
    const jsonBytes = new Blob([json]).size;

    // The fragment key carries the codec, as the frozen contract specifies:
    // `#dz=` is deflated, `#d1=` is not. An earlier version put the codec
    // inside the payload as `v1:dz:` while the caller added `#dz=` on top, so
    // the decoder was handed `dz=v1:dz:...` and refused its own output.
    const compressed = await compressDeflateRaw(json);
    const key = compressed ? 'dz' : 'd1';
    const payload = compressed
      ? toBase64url(compressed)
      : toBase64url(new TextEncoder().encode(json));

    return {
      key,
      payload,
      fragment: `#${key}=${payload}`,
      bytes: jsonBytes,
      tier: getTier(payload),
    };
  } catch {
    return null;
  }
}

/** The longest comparison link Dossier offers, in characters of payload. */
export const COMPARISON_LINK_MAX = 32000;

/**
 * Encode a comparison bundle (`{dossierCompare: {...}}`) for a `#dc=` link.
 * Deflated like `#dz=`; a browser without CompressionStream gets no link
 * rather than an uncompressed one that would rarely fit.
 *
 * @param {object} bundle
 * @returns {Promise<{payload: string, fragment: string, fits: boolean}|null>}
 */
export async function encodeComparison(bundle) {
  try {
    const compressed = await compressDeflateRaw(JSON.stringify(bundle));
    if (!compressed) return null;
    const payload = toBase64url(compressed);
    return { payload, fragment: `#dc=${payload}`, fits: payload.length < COMPARISON_LINK_MAX };
  } catch {
    return null;
  }
}

/**
 * Decode a `#dc=` fragment into the bundle it carries, or null.
 *
 * @param {string} hash
 * @returns {Promise<object|null>}
 */
export async function decodeComparison(hash) {
  try {
    const keyed = /^#?dc=(.+)$/s.exec(String(hash || ''));
    if (!keyed) return null;
    const json = await decompressDeflateRaw(fromBase64url(keyed[1]));
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

/**
 * Decode a fragment into a document.
 *
 * @param {string} hash - the hash portion of the URL
 * @returns {Promise<{document: object, findings: Array}|null>}
 */
export async function decodeFragment(hash) {
  try {
    if (!hash) return null;
    const raw = String(hash).replace(/^#/, '');

    let codec = null;
    let encoded = null;

    const keyed = /^(dz|d1)=(.*)$/s.exec(raw);
    if (keyed) {
      codec = keyed[1];
      encoded = keyed[2];
    } else {
      // Tolerated: the `v1:dz:` shape an early build emitted. Reading an old
      // link costs four lines, and a link that stops working is the worst
      // thing a sharing feature can do.
      const legacy = /^v1:(dz|d1):(.*)$/s.exec(raw);
      if (legacy) {
        codec = legacy[1];
        encoded = legacy[2];
      }
    }

    if (!codec || !encoded) return null;

    const bytes = fromBase64url(encoded);
    const json = codec === 'dz'
      ? await decompressDeflateRaw(bytes)
      : new TextDecoder().decode(bytes);

    if (!json) return null;
    return { document: JSON.parse(json), findings: [] };
  } catch {
    return null;
  }
}

/**
 * Does this fragment carry a report, rather than naming a page?
 *
 * `#/results` is a page route and `#dz=...` is a payload. Treating every hash
 * as a payload made a page link look like a failed share link, complete with
 * a message saying the link carried no readable report.
 */
export function fragmentCarriesReport(hash = window.location.hash) {
  const route = parseRoute(hash);
  // `#dc=` is a payload too, but it carries a comparison, not a report.
  return Boolean(route.payload) && route.key !== 'dc';
}

/**
 * Does the URL carry a report? `?src=` or a report payload in the hash.
 *
 * Synchronous, so boot can decide before any network or decoding work.
 * Call readUrlPayload for the content.
 *
 * @returns {boolean}
 */
export function loadFromUrl() {
  const url = new URL(window.location.href);
  const src = url.searchParams.get('src');
  if (src) return true;
  return fragmentCarriesReport(url.hash);
}

/**
 * Read what the URL carries, without touching the page state.
 *
 * Every failure comes back with its own reason, for the caller to show once.
 * The earlier version toasted inside the fetch and then the caller toasted a
 * generic message on top, so the specific reason was never readable.
 *
 * @returns {Promise<{found: false}
 *   | {found: true, ok: true, text: string, findings: Array, source: 'link'|'src', host?: string}
 *   | {found: true, ok: false, reason: string}>}
 */
export async function readUrlPayload() {
  const url = new URL(window.location.href);
  const src = url.searchParams.get('src');
  if (src) return readSrc(src);
  // A page route is not a payload. Decoding `#/results` and failing made a
  // page link report that the link carried no readable report.
  if (!fragmentCarriesReport(url.hash)) return { found: false };
  const result = await decodeFragment(url.hash);
  if (!result) {
    return {
      found: true,
      ok: false,
      reason: 'That link is incomplete or damaged, so the report inside it could not be decoded. Ask for the link again, or for the HTML file.',
    };
  }
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return { found: true, ok: true, text: JSON.stringify(result.document, null, 2), findings: result.findings || [], source: 'link' };
}

const SRC_TIMEOUT_MS = 10000;

async function readSrc(src) {
  const fail = (reason) => ({ found: true, ok: false, reason });
  let url;
  try {
    url = new URL(src);
  } catch {
    return fail('The src address in this link is not a valid URL. Nothing was loaded.');
  }
  const local = url.protocol === 'http:' && url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !local) {
    return fail(`The src address has to start with https://, and this one uses ${url.protocol}. Nothing was loaded.`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SRC_TIMEOUT_MS);
  try {
    const res = await fetch(url.href, { signal: controller.signal });
    if (!res.ok) {
      return fail(`${url.host} answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''} for that document. Nothing was loaded.`);
    }
    const text = await res.text();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return { found: true, ok: true, text, findings: [], source: 'src', host: url.host };
  } catch (err) {
    return fail(err && err.name === 'AbortError'
      ? `${url.host} took more than ${SRC_TIMEOUT_MS / 1000} seconds to answer. Nothing was loaded.`
      : `Could not fetch the document from ${url.host}. The server may be down, or it does not let other sites read the file.`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A toast that stays up long enough to read a long message. The one copy:
 * js/open.js and js/boot.js import it from here, since this module imports
 * neither of them.
 */
export function say(message) {
  showToast(message, { duration: Math.min(9000, 2000 + message.length * 40) });
}

/**
 * End a sentence with a full stop, unless it already ends one. Toasts end on
 * a quoted title (`Opened "X".`), and a title that ends in its own full stop
 * printed `Opened "Two responses. A clearer decision.".` Here the title's own
 * stop, inside the closing quote, ends the sentence.
 *
 * @param {string} text
 * @returns {string}
 */
export function sentence(text) {
  return /[.!?…]["'”’)]?$/.test(text) ? text : `${text}.`;
}

let lastPayload = null;

/**
 * Copy the current report to clipboard as a share link.
 *
 * @param {object} document
 * @returns {Promise<boolean>}
 */
export async function copyShareLink(document) {
  const encoded = await encodeDocument(document);
  if (!encoded) {
    showToast('Could not encode report');
    return false;
  }
  const { payload, fragment, tier } = encoded;
  if (tier === 'refused') {
    say(`Too long for a link at ${payload.length.toLocaleString()} characters. Export the one HTML file instead: it needs no account and no network.`);
    return false;
  }
  lastPayload = payload;
  const url = new URL(window.location.href);
  url.hash = fragment.replace(/^#/, '');
  url.search = '';
  const link = url.toString();
  const ok = await copyText(link);
  if (ok) {
    // The size tier is the useful half of this message: the binding limit is
    // the chat client, not the browser. The warning is the other half, and it
    // is not a formality: there is no access control on a shared report.
    const tierMsg = tier === 'travels'
      ? 'travels anywhere'
      : tier === 'fine'
        ? 'fine for a message or a ticket'
        : `${payload.length.toLocaleString()} characters, which some chat clients will cut`;
    say(`Link copied, ${tierMsg}. Anyone with the link has the report: there is no sign-in on it.`);
  } else {
    showToast('Could not copy to clipboard');
  }
  return ok;
}
