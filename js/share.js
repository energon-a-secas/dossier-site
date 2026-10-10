/**
 * Inbound and outbound forms for sharing reports.
 *
 * Inbound:
 *   #d1=<base64url(json)>              uncompressed, forward compatible
 *   #dz=<base64url(deflate-raw(json))> the one we emit
 *   ?src=<https url>                   fetch a hosted document
 *
 * CompressionStream is native, no dependency. Falls back to uncompressed
 * #d1= if deflate is not available.
 */

import { showToast, copyText } from './neorgon-dom.js';


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
    writer.write(data);
    writer.close();
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

async function decompressDeflateRaw(bytes) {
  try {
    if (typeof DecompressionStream === 'undefined') {
      return null;
    }
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
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
  const raw = String(hash || '').replace(/^#/, '');
  return /^(dz|d1)=/.test(raw) || /^v1:(dz|d1):/.test(raw);
}

/**
 * Load from URL if present.
 *
 * Handles #dz= and #d1= fragments, and ?src= query parameters.
 * Returns true if a URL source claimed the load. Does not block on network;
 * call loadFromUrlAsync for the full async loading with callbacks.
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
 * Async loading from URL source. Called after loadFromUrl returns true.
 * @param {function} onDocument - callback with {document, findings}
 * @returns {Promise<boolean>} true if successful
 */
export async function loadFromUrlAsync(onDocument) {
  const url = new URL(window.location.href);
  const src = url.searchParams.get('src');
  if (src) {
    return loadFromSrc(src, onDocument);
  }
  // A page route is not a payload. Decoding `#/results` and failing made a
  // page link report that the link carried no readable report.
  if (fragmentCarriesReport(window.location.hash)) {
    const result = await decodeFragment(window.location.hash);
    if (result) {
      onDocument(result);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return true;
    }
  }
  return false;
}

async function loadFromSrc(src, onDocument) {
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(null), 10000);
  });
  try {
    const url = new URL(src);
    if (!url.protocol.startsWith('http')) return false;
    if (url.hostname !== 'localhost' && url.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await Promise.race([
      fetch(src, { signal: controller.signal }),
      timeout,
    ]);
    clearTimeout(timer);
    if (!res || !res.ok) {
      showToast('Could not fetch document from URL');
      return true;
    }
    const text = await res.text();
    const document = JSON.parse(text);
    onDocument({ document, findings: [] });
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return true;
  } catch {
    showToast('Could not fetch or parse document from URL');
    return true;
  }
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
    showToast(`Too long for a link at ${payload.length.toLocaleString()} characters. Export the one HTML file instead: it needs no account and no network.`);
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
    showToast(`Link copied, ${tierMsg}. Anyone with the link has the report: there is no sign-in on it.`);
  } else {
    showToast('Could not copy to clipboard');
  }
  return ok;
}
