/**
 * One string hash for the whole app. The Reports reader's embed fingerprint,
 * the Compare column and diff caches and the Blind shuffle's seed each wrote
 * their own copy of this loop. Each caller still formats the number its own
 * way, so every stored value stays byte-identical.
 */

/** 32-bit FNV-1a over a string's UTF-16 code units, as an unsigned integer. DOM-free: node imports it. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
