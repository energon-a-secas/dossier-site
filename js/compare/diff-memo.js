/**
 * The memo of js/compare/diff.js: a result is kept by the two IR arrays it
 * was worked out from (the column renderer keeps one per source) and by a
 * hash of their content, so a redraw that changed nothing in either report
 * does not diff again. The options are part of the key, Word marks turned on
 * by hand (`force`) included. Results depend on nothing but the inputs and
 * the options (the diff's work is counted in steps, never in time), so a
 * remembered result is always the one a new diff would give. DOM-free:
 * node imports it.
 */

import { fnv1a } from '../hash.js';

const MEMO_MAX = 24;

const byBlocks = new WeakMap();
const byHash = new Map();

function optsKey(opts) {
  return `${opts.ignoreCase ? 1 : 0}${opts.ignorePunctuation ? 1 : 0}${opts.force ? 1 : 0}`;
}

/** A cheap fingerprint of a block list's content. */
function hashBlocks(blocks) {
  const text = JSON.stringify(blocks || []);
  return `${text.length}:${fnv1a(text).toString(36)}`;
}

const hashes = new WeakMap();
function hashOf(blocks) {
  if (!blocks || typeof blocks !== 'object') return 'none';
  if (!hashes.has(blocks)) hashes.set(blocks, hashBlocks(blocks));
  return hashes.get(blocks);
}

export function recall(baseBlocks, blocks, opts) {
  const key = optsKey(opts);
  const inner = baseBlocks && typeof baseBlocks === 'object' ? byBlocks.get(baseBlocks)?.get(blocks) : null;
  if (inner?.has(key)) return inner.get(key);
  const hashed = byHash.get(`${hashOf(baseBlocks)}|${hashOf(blocks)}|${key}`);
  if (hashed) {
    byHash.delete(hashed.key);
    byHash.set(hashed.key, hashed);
    return hashed.result;
  }
  return null;
}

export function remember(baseBlocks, blocks, opts, result) {
  const key = optsKey(opts);
  if (baseBlocks && typeof baseBlocks === 'object' && blocks && typeof blocks === 'object') {
    if (!byBlocks.has(baseBlocks)) byBlocks.set(baseBlocks, new WeakMap());
    const outer = byBlocks.get(baseBlocks);
    if (!outer.has(blocks)) outer.set(blocks, new Map());
    outer.get(blocks).set(key, result);
  }
  const hk = `${hashOf(baseBlocks)}|${hashOf(blocks)}|${key}`;
  byHash.set(hk, { key: hk, result });
  while (byHash.size > MEMO_MAX) byHash.delete(byHash.keys().next().value);
}
