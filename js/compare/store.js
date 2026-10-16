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
 *
 * A set's `updated` is its revision and only goes up. `writeSet` can be told
 * which revision a save was made on (`expect`): when another tab has saved
 * since, nothing is written and the stored set comes back, for the caller to
 * merge (js/compare/merge.js). Each record also notes which tab wrote it
 * (`writer`, outside the set itself), so a journal replayed after a reload
 * (js/compare/journal.js) can tell its own tab's last write from another's.
 *
 * A connection the browser closes on its own (site data cleared while the
 * tab is open) is forgotten, and the next call opens a new one: before, every
 * later save failed silently until the page was reloaded.
 */

import { sanitizeSet, describeSet } from './records.js';

const DB_NAME = 'dossier-compare';
const DB_VERSION = 1;
const STORE = 'sets';
const CHANNEL_NAME = 'dossier-compare';

let db = null;
let opening = null;

/** This tab, as the writer of the records it saves. */
export const TAB_ID = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Let go of a closed connection, so the next call opens a new one. */
function forget(conn) {
  if (db !== conn) return;
  // Both: left resolved, `opening` would hand the dead connection back.
  db = null;
  opening = null;
}

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
        forget(database);
      };
      // The browser closed it (site data cleared): the next call reopens.
      database.onclose = () => forget(database);
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

/** What a transaction on a connection the browser has closed throws. */
const DEAD_CONNECTION = ['InvalidStateError', 'UnknownError'];

/**
 * A transaction on the store, or null. A connection that died before its
 * close event arrived is closed, forgotten and opened again, once.
 */
async function transaction(mode) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const conn = await database();
    if (!conn) return null;
    try {
      return conn.transaction(STORE, mode);
    } catch (err) {
      if (attempt || !DEAD_CONNECTION.includes(err && err.name)) return null;
      try { conn.close(); } catch { /* already closed */ }
      forget(conn);
    }
  }
  return null;
}

/** Run one request in a transaction, resolving `fallback` on any failure. */
async function run(mode, makeRequest, fallback) {
  try {
    const tx = await transaction(mode);
    if (!tx) return fallback;
    return await new Promise((resolve) => {
      try {
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
 * One set as stored, with the tab that wrote it, or null. For the journal:
 * everything else reads `readSet`.
 *
 * @returns {Promise<{set: object, writer: string|null}|null>}
 */
export async function readSetRecord(id) {
  if (typeof id !== 'string' || !id) return null;
  const record = await run('readonly', (store) => store.get(id), null);
  const set = record ? sanitizeSet(record) : null;
  return set ? { set, writer: typeof record.writer === 'string' ? record.writer : null } : null;
}

/**
 * Save a set. `updated` is stamped here, strictly later than the stored
 * revision it replaces. The read and the write share one transaction, so
 * another tab's save cannot land between the check and the put.
 *
 * @param {object} set
 * @param {{expect?: number}} [opts] expect: the revision (`updated`) this
 *   save was made on; undefined saves whatever is stored
 * @returns {Promise<object|{conflict: true, current: object}|null>} the set
 *   written, a conflict carrying the stored set, or null
 */
export async function writeSet(set, { expect } = {}) {
  if (!sanitizeSet(set)) return null;
  try {
    const tx = await transaction('readwrite');
    if (!tx) return null;
    const result = await new Promise((resolve) => {
      try {
        const store = tx.objectStore(STORE);
        let out = null;
        const prior = store.get(set.id);
        prior.onsuccess = () => {
          const existing = prior.result;
          const before = Number.isFinite(existing?.updated) ? existing.updated : 0;
          if (expect !== undefined && existing && existing.updated !== expect) {
            const current = sanitizeSet(existing);
            out = current ? { conflict: true, current } : null;
            if (!current) tx.abort();
            return;
          }
          const clean = sanitizeSet({ ...set, updated: Math.max(Date.now(), before + 1) });
          if (!clean) { tx.abort(); return; }
          store.put({ ...clean, writer: TAB_ID });
          out = clean;
        };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (result && !result.conflict) announce([result.id], 'write');
    return result;
  } catch {
    return null;
  }
}

/** @returns {Promise<boolean>} */
export async function deleteSet(id) {
  if (typeof id !== 'string' || !id) return false;
  const ok = await run('readwrite', (store) => { store.delete(id); return null; }, false);
  if (ok) announce([id], 'delete');
  return Boolean(ok);
}
