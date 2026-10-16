/**
 * Saved comparisons, in their own IndexedDB database.
 *
 * Database `dossier-compare`, version 1, one object store `sets` keyed by the
 * set's `id`. A separate database rather than a store inside `dossier`, so
 * the reports database needs no version bump and none of the blocked-upgrade
 * hazards that come with one (js/store.js).
 *
 * Like js/store.js, nothing here throws: private browsing, a denied database,
 * a full disk and a blocked open all resolve to null, false or an empty list.
 * Every write and delete is announced on the `dossier-compare`
 * BroadcastChannel, so a second tab refreshes its list instead of saving over
 * what this one changed.
 */

import { sanitizeSet, describeSet } from './records.js';

const DB_NAME = 'dossier-compare';
const DB_VERSION = 1;
const STORE = 'sets';
const CHANNEL_NAME = 'dossier-compare';

let db = null;
let opening = null;

function open() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      resolve(null);
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onerror = () => resolve(null);
    req.onblocked = () => {
      // eslint-disable-next-line no-console
      console.warn('Saved comparisons are waiting for another tab to release their database.');
    };
    req.onupgradeneeded = () => {
      try {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' });
      } catch {
        resolve(null);
      }
    };
    req.onsuccess = () => {
      const database = req.result;
      // A newer version opening in another tab asks us to let go; holding on
      // would block it. The next call opens again.
      database.onversionchange = () => {
        database.close();
        if (db === database) {
          db = null;
          opening = null;
        }
      };
      resolve(database);
    };
  });
}

async function database() {
  if (db) return db;
  if (!opening) opening = open();
  db = await opening;
  if (!db) opening = null;
  return db;
}

/** Run one request in a transaction, resolving `fallback` on any failure. */
async function run(mode, makeRequest, fallback) {
  try {
    const conn = await database();
    if (!conn) return fallback;
    return await new Promise((resolve) => {
      try {
        const tx = conn.transaction(STORE, mode);
        const req = makeRequest(tx.objectStore(STORE));
        let value = fallback;
        if (req) req.onsuccess = () => { value = req.result; };
        tx.oncomplete = () => resolve(req ? value : true);
        tx.onerror = () => resolve(fallback);
        tx.onabort = () => resolve(fallback);
      } catch {
        resolve(fallback);
      }
    });
  } catch {
    return fallback;
  }
}

// ── Change notices for other tabs ────────────────────────────────────────────

let channel;

function getChannel() {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

function announce(ids, kind) {
  try {
    getChannel()?.postMessage({ ids, kind });
  } catch {
    /* another tab missing one refresh is not worth failing a save over */
  }
}

/**
 * Watch writes and deletes made in other tabs. A tab never hears its own.
 *
 * @param {(ids: string[], kind: 'write'|'delete') => void} fn
 * @returns {() => void} unsubscribe
 */
export function onExternalChange(fn) {
  const ch = getChannel();
  if (!ch) return () => {};
  const onMessage = (event) => {
    if (event.data && Array.isArray(event.data.ids)) fn(event.data.ids, event.data.kind);
  };
  ch.addEventListener('message', onMessage);
  return () => ch.removeEventListener('message', onMessage);
}

// ── Reading and writing ──────────────────────────────────────────────────────

/**
 * Every saved set as a summary, newest first. The sources are read too
 * (one store), which is fine for the handful of sets a browser holds.
 *
 * @returns {Promise<Array<{id, title, updated, created, columns, summary}>>}
 */
export async function listSets() {
  const records = await run('readonly', (store) => store.getAll(), []);
  return (Array.isArray(records) ? records : [])
    .map((record) => sanitizeSet(record))
    .filter(Boolean)
    .map((set) => ({
      id: set.id,
      title: set.title,
      created: set.created,
      updated: set.updated,
      columns: set.columns.length,
      summary: describeSet(set),
    }))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

/** One set, cleaned, or null. */
export async function readSet(id) {
  if (typeof id !== 'string' || !id) return null;
  const record = await run('readonly', (store) => store.get(id), null);
  return record ? sanitizeSet(record) : null;
}

/**
 * Save a set. `updated` is stamped here.
 *
 * @returns {Promise<object|null>} the record written, or null
 */
export async function writeSet(set) {
  const clean = sanitizeSet({ ...set, updated: Date.now() });
  if (!clean) return null;
  const ok = await run('readwrite', (store) => { store.put(clean); return null; }, false);
  if (!ok) return null;
  announce([clean.id], 'write');
  return clean;
}

/** @returns {Promise<boolean>} */
export async function deleteSet(id) {
  if (typeof id !== 'string' || !id) return false;
  const ok = await run('readwrite', (store) => { store.delete(id); return null; }, false);
  if (ok) announce([id], 'delete');
  return Boolean(ok);
}
