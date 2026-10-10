/**
 * IndexedDB report library.
 *
 * One database 'dossier', version 1, two stores: 'reports' keyed by id
 * holding the document, and 'meta' keyed by id holding metadata.
 *
 * Nothing here ever throws. A failure resolves to null or false. Private
 * browsing, a denied database, a quota error, and a blocked upgrade are all
 * expected and all return a value rather than throwing.
 */

const DB_NAME = 'dossier';
const DB_VERSION = 1;
const STORE_REPORTS = 'reports';
const STORE_META = 'meta';

let db = null;
const initPromise = initDb();

async function initDb() {
  try {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
      req.onsuccess = () => resolve(req.result);
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
          resolve(null);
        }
      };
    });
  } catch {
    return null;
  }
}

async function ensureDb() {
  if (db === null) {
    db = await initPromise;
  }
  return db;
}

/**
 * @returns {Promise<Array<{id, title, kind, status, pages, blocks, bytes, created, updated}>>}
 * Newest first.
 */
export async function listReports() {
  try {
    const database = await ensureDb();
    if (!database) return [];
    return new Promise((resolve) => {
      try {
        const tx = database.transaction(STORE_META, 'readonly');
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
    const database = await ensureDb();
    if (!database || !id) return null;
    return new Promise((resolve) => {
      try {
        const tx = database.transaction([STORE_REPORTS, STORE_META], 'readonly');
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
 * @param {object} document - the full dossier document
 * @param {object} meta - metadata from derivation
 * @returns {Promise<object|null>} the meta that was written
 */
export async function writeReport(id, document, meta) {
  try {
    const database = await ensureDb();
    if (!database || !id || !document || !meta) return null;
    return new Promise((resolve) => {
      try {
        const tx = database.transaction([STORE_REPORTS, STORE_META], 'readwrite');
        const reportStore = tx.objectStore(STORE_REPORTS);
        const metaStore = tx.objectStore(STORE_META);
        const docStr = JSON.stringify(document);
        const bytes = new Blob([docStr]).size;
        const nowTime = Date.now();
        const metaOut = {
          ...meta,
          id,
          bytes,
          updated: nowTime,
        };
        if (!meta.created) {
          metaOut.created = nowTime;
        }
        const docReq = reportStore.put(document, id);
        const metaReq = metaStore.put(metaOut, id);
        tx.onerror = () => resolve(null);
        tx.oncomplete = () => resolve(metaOut);
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
    const database = await ensureDb();
    if (!database || !id) return false;
    return new Promise((resolve) => {
      try {
        const tx = database.transaction([STORE_REPORTS, STORE_META], 'readwrite');
        const reportStore = tx.objectStore(STORE_REPORTS);
        const metaStore = tx.objectStore(STORE_META);
        reportStore.delete(id);
        metaStore.delete(id);
        tx.onerror = () => resolve(false);
        tx.oncomplete = () => resolve(true);
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
 * IndexedDB has no change event, so use BroadcastChannel if available,
 * with localStorage storage event as a fallback. Returns an unsubscribe function.
 *
 * @param {(ids: string[]) => void} fn - called with changed report ids
 * @returns {() => void} unsubscribe
 */
export function onExternalChange(fn) {
  let channel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('dossier-reports');
      const onMsg = (e) => {
        if (e.data && Array.isArray(e.data.ids)) {
          fn(e.data.ids);
        }
      };
      channel.addEventListener('message', onMsg);
      return () => {
        try {
          channel.removeEventListener('message', onMsg);
          channel.close();
        } catch {
          /* ignore close errors */
        }
      };
    }
  } catch {
    /* fall through to storage fallback */
  }
  try {
    const onStorageChange = (e) => {
      if (e.key && e.key.startsWith('dossier-report-')) {
        fn([e.key.replace('dossier-report-', '')]);
      }
    };
    window.addEventListener('storage', onStorageChange);
    return () => {
      window.removeEventListener('storage', onStorageChange);
    };
  } catch {
    return () => {};
  }
}
