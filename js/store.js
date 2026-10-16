/**
 * IndexedDB report library.
 *
 * One database 'dossier', version 1, two stores: 'reports' keyed by id
 * holding the document, and 'meta' keyed by id holding metadata.
 *
 * Nothing here ever throws. A failure resolves to null or false. Private
 * browsing, a denied database, a quota error, and a blocked upgrade are all
 * expected and all return a value rather than throwing.
 *
 * Two more facts shape it. A connection the browser closes on its own (site
 * data cleared while the tab is open) is forgotten, and the next call opens
 * a new one, so saving recovers without a reload (`transaction`). And every
 * record carries a revision, its `updated` time, which only goes up: a save
 * can say which revision it was made on (`writeReport`'s `expect`), and one
 * made on an older revision than the stored one is refused rather than
 * written over another tab's newer edit.
 *
 * A write started while the page unloads never commits (a read-then-write
 * transaction least of all), so the last edit before a reload is kept by a
 * synchronous journal instead (js/report-journal.js).
 */

const DB_NAME = 'dossier';
const DB_VERSION = 1;
const STORE_REPORTS = 'reports';
const STORE_META = 'meta';

let db = null;
let initPromise = null;

const BLOCKED_RETRY_MS = 3000;

/**
 * Open the database. Never throws and never rejects.
 *
 * A blocked open (another tab holds an older connection during an upgrade)
 * used to resolve null on the spot, so storage looked empty for the whole
 * session, which reads as data loss. It now says so in the console, waits,
 * and tries once more. If that is blocked too, the calls waiting on it get
 * null (saving is off for now), but the second request is left open: when
 * the other tab lets go it succeeds, and from then on this tab uses it. The
 * first version closed that late success, so saving stayed off until the
 * page was reloaded, whatever the console said.
 */
function initDb(attempt = 0) {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      resolve(null);
      return;
    }
    let settled = false;
    // True once this request is given up on with nothing in flight after it.
    let gaveUp = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      done(null);
      return;
    }
    req.onerror = () => done(null);
    req.onsuccess = () => {
      const database = req.result;
      if (settled && (!gaveUp || db)) {
        // This request was given up on and a retry is in flight, or a
        // connection is already in use.
        database.close();
        return;
      }
      // A newer version opening in another tab asks us to let go. Holding on
      // would block that tab's upgrade; closing lets the next call reopen.
      database.onversionchange = () => {
        database.close();
        forget(database);
      };
      // The browser closed it (site data cleared): the next call reopens.
      database.onclose = () => forget(database);
      if (settled) {
        // Given up on, and then the other tab let go: use it from now on.
        db = database;
        initPromise = Promise.resolve(database);
        // eslint-disable-next-line no-console
        console.info('Dossier storage is available again: the other tab released the database.');
        return;
      }
      done(database);
    };
    req.onblocked = () => {
      // eslint-disable-next-line no-console
      console.warn('Dossier storage is waiting for another tab to release the database.');
      setTimeout(() => {
        if (settled) return;
        if (attempt === 0) {
          done(initDb(1));
        } else {
          // eslint-disable-next-line no-console
          console.warn('Dossier storage is still blocked by another tab. Saving is off in this tab until that tab closes or reloads.');
          gaveUp = true;
          done(null);
        }
      }, BLOCKED_RETRY_MS);
    };
    req.onupgradeneeded = (e) => {
      try {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_REPORTS)) {
          database.createObjectStore(STORE_REPORTS);
        }
        if (!database.objectStoreNames.contains(STORE_META)) {
          database.createObjectStore(STORE_META);
        }
      } catch {
        done(null);
      }
    };
  });
}

async function ensureDb() {
  if (db) return db;
  if (!initPromise) initPromise = initDb();
  db = await initPromise;
  return db;
}

/** Let go of a connection that is closed, so the next call opens a new one. */
function forget(database) {
  if (db !== database) return;
  db = null;
  initPromise = null;
}

/** What a transaction on a connection the browser has closed throws. */
const DEAD_CONNECTION = ['InvalidStateError', 'UnknownError'];

/**
 * A transaction, or null. A connection that died under us (the browser
 * closed it, and the close event has not arrived yet) is closed, forgotten
 * and opened again, once: before this, every save after the site's data was
 * cleared failed until the page was reloaded.
 */
async function transaction(stores, mode) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const database = await ensureDb();
    if (!database) return null;
    try {
      return database.transaction(stores, mode);
    } catch (err) {
      if (attempt || !DEAD_CONNECTION.includes(err && err.name)) return null;
      try { database.close(); } catch { /* already closed */ }
      forget(database);
    }
  }
  return null;
}

// ── Change notices for other tabs ────────────────────────────────────────────

const CHANNEL_NAME = 'dossier-reports';
let channel;

/**
 * One channel object per tab, for posting and listening alike. A message is
 * never delivered to the object that posted it, so this tab does not hear its
 * own writes, and every other tab does.
 */
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
 * @returns {Promise<Array<{id, title, kind, status, pages, bytes, created, updated}>>}
 * Newest first.
 */
export async function listReports() {
  try {
    const tx = await transaction(STORE_META, 'readonly');
    if (!tx) return [];
    return new Promise((resolve) => {
      try {
        const store = tx.objectStore(STORE_META);
        const req = store.getAll();
        req.onerror = () => resolve([]);
        req.onsuccess = () => {
          const items = req.result || [];
          resolve(items.sort((a, b) => (b.updated || 0) - (a.updated || 0)));
        };
      } catch {
        resolve([]);
      }
    });
  } catch {
    return [];
  }
}

/**
 * @param {string} id
 * @returns {Promise<{meta, document}|null>}
 */
export async function readReport(id) {
  try {
    if (!id) return null;
    const tx = await transaction([STORE_REPORTS, STORE_META], 'readonly');
    if (!tx) return null;
    return new Promise((resolve) => {
      try {
        const metaStore = tx.objectStore(STORE_META);
        const reportStore = tx.objectStore(STORE_REPORTS);
        const metaReq = metaStore.get(id);
        const docReq = reportStore.get(id);
        tx.onerror = () => resolve(null);
        tx.oncomplete = () => {
          const meta = metaReq.result;
          const document = docReq.result;
          if (!meta || !document) {
            resolve(null);
          } else {
            resolve({ meta, document });
          }
        };
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

/**
 * @param {string} id
 * @param {object} document - the authored dossier document
 * @param {object} meta - title, kind, status and page count; `created` is kept
 *   from the existing record and `updated` is set here
 * @param {{expect?: number}} [opts] expect: the revision (`updated`) this save
 *   was made on. When the stored record has moved on since, nothing is
 *   written and the result says so, with the stored meta.
 * @returns {Promise<object|{conflict: true, current: object}|null>} the meta
 *   that was written (its `updated` is the new revision), a conflict, or null
 */
export async function writeReport(id, document, meta, { expect } = {}) {
  try {
    if (!id || !document || !meta) return null;
    const tx = await transaction([STORE_REPORTS, STORE_META], 'readwrite');
    if (!tx) return null;
    return new Promise((resolve) => {
      try {
        const reportStore = tx.objectStore(STORE_REPORTS);
        const metaStore = tx.objectStore(STORE_META);
        const docStr = JSON.stringify(document);
        const bytes = new Blob([docStr]).size;
        let metaOut = null;
        let conflict = null;
        // Read the existing record in the same transaction, so `created`
        // survives every save (it used to be reset on each one), and so the
        // revision check and the write cannot be split by another tab's save.
        const prior = metaStore.get(id);
        prior.onsuccess = () => {
          const before = prior.result;
          if (expect !== undefined && before && before.updated !== expect) {
            conflict = { conflict: true, current: before };
            return;
          }
          const nowTime = Date.now();
          metaOut = {
            ...meta,
            id,
            bytes,
            // Strictly later than the revision it replaces, even when two
            // saves land in the same millisecond.
            updated: Math.max(nowTime, ((before && before.updated) || 0) + 1),
            created: (before && before.created) || meta.created || nowTime,
          };
          reportStore.put(document, id);
          metaStore.put(metaOut, id);
        };
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
        tx.oncomplete = () => {
          if (conflict) {
            resolve(conflict);
            return;
          }
          announce([id], 'write');
          resolve(metaOut);
        };
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteReport(id) {
  try {
    if (!id) return false;
    const tx = await transaction([STORE_REPORTS, STORE_META], 'readwrite');
    if (!tx) return false;
    return new Promise((resolve) => {
      try {
        const reportStore = tx.objectStore(STORE_REPORTS);
        const metaStore = tx.objectStore(STORE_META);
        reportStore.delete(id);
        metaStore.delete(id);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
        tx.oncomplete = () => {
          announce([id], 'delete');
          resolve(true);
        };
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<{bytes, quota, pct}>} usage estimate
 */
export async function estimateUsage() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        bytes: estimate.usage || 0,
        quota: estimate.quota || 0,
        pct: estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0,
      };
    }
  } catch {
    /* fall through to summing */
  }
  try {
    const items = await listReports();
    let total = 0;
    for (const item of items) {
      total += item.bytes || 0;
    }
    return { bytes: total, quota: 50 * 1024 * 1024, pct: Math.round((total / (50 * 1024 * 1024)) * 100) };
  } catch {
    return { bytes: 0, quota: 0, pct: 0 };
  }
}

/**
 * Watch for changes from another tab.
 *
 * IndexedDB has no change event, so every write and delete above posts on a
 * BroadcastChannel. Returns an unsubscribe function.
 *
 * @param {(ids: string[], kind: 'write'|'delete') => void} fn
 * @returns {() => void} unsubscribe
 */
export function onExternalChange(fn) {
  const ch = getChannel();
  if (!ch) return () => {};
  const onMsg = (e) => {
    if (e.data && Array.isArray(e.data.ids)) fn(e.data.ids, e.data.kind);
  };
  ch.addEventListener('message', onMsg);
  return () => ch.removeEventListener('message', onMsg);
}
