/**
 * A small in-memory IndexedDB for the store tests: enough of open,
 * transactions, object stores and requests for js/store.js and
 * js/compare/store.js, with events fired the way a browser fires them
 * (request success in a microtask, transaction completion after the last
 * request, on a later turn). Not a test file itself (no `.test.`), so
 * `node --test tests/*.test.mjs` does not run it.
 *
 * Two hooks for the cases the tests care about:
 *   fake.killConnections() closes every open connection the way clearing
 *     site data does: their `transaction()` throws InvalidStateError and
 *     their `onclose` fires, and every record is gone.
 *   fake.abortNextWrite() makes the next readwrite transaction abort.
 */

class DomError extends Error {
  constructor(name, message = name) {
    super(message);
    this.name = name;
  }
}

const later = (fn) => setImmediate(fn);

export function createFakeIndexedDB() {
  /** name -> {version, stores: Map(name -> {keyPath, data: Map})} */
  const databases = new Map();
  const connections = new Set();
  let abortNext = false;

  function makeRequest() {
    return { result: undefined, error: null, onsuccess: null, onerror: null };
  }

  function makeTransaction(conn, names, mode) {
    const db = databases.get(conn.name);
    let pending = 0;
    let finished = false;
    let aborted = false;
    const tx = {
      mode,
      oncomplete: null,
      onerror: null,
      onabort: null,
      abort() {
        if (finished) return;
        aborted = true;
        finished = true;
        later(() => tx.onabort?.());
      },
      objectStore(name) {
        if (!names.includes(name)) throw new DomError('NotFoundError');
        const store = db.stores.get(name);
        const run = (fn) => {
          const req = makeRequest();
          pending += 1;
          queueMicrotask(() => {
            if (aborted) return;
            try {
              req.result = fn();
              req.onsuccess?.({ target: req });
            } catch (err) {
              req.error = err;
              req.onerror?.({ target: req });
            }
            pending -= 1;
            settle();
          });
          return req;
        };
        const clone = (v) => (v === undefined ? undefined : structuredClone(v));
        return {
          get: (key) => run(() => clone(store.data.get(key))),
          getAll: () => run(() => [...store.data.values()].map(clone)),
          put: (value, key) => {
            if (mode !== 'readwrite') throw new DomError('ReadOnlyError');
            return run(() => {
              const k = store.keyPath ? value[store.keyPath] : key;
              store.data.set(k, clone(value));
              return k;
            });
          },
          delete: (key) => {
            if (mode !== 'readwrite') throw new DomError('ReadOnlyError');
            return run(() => { store.data.delete(key); });
          },
        };
      },
    };
    const snapshot = new Map([...db.stores].map(([n, s]) => [n, new Map(s.data)]));
    const failThis = mode === 'readwrite' && abortNext;
    if (failThis) abortNext = false;
    function settle() {
      later(() => {
        if (finished || pending > 0) return;
        finished = true;
        if (failThis) {
          for (const [n, data] of snapshot) db.stores.get(n).data = data;
          tx.onabort?.();
          return;
        }
        tx.oncomplete?.();
      });
    }
    // A transaction with no request at all still completes.
    settle();
    return tx;
  }

  const factory = {
    open(name, version = 1) {
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        let db = databases.get(name);
        const conn = {
          name,
          closed: false,
          onclose: null,
          onversionchange: null,
          objectStoreNames: { contains: (n) => databases.get(name).stores.has(n) },
          createObjectStore(n, opts = {}) {
            databases.get(name).stores.set(n, { keyPath: opts.keyPath || null, data: new Map() });
          },
          transaction(stores, mode = 'readonly') {
            if (conn.closed) throw new DomError('InvalidStateError', 'The database connection is closing.');
            const names = Array.isArray(stores) ? stores : [stores];
            for (const n of names) if (!databases.get(name).stores.has(n)) throw new DomError('NotFoundError');
            return makeTransaction(conn, names, mode);
          },
          close() {
            conn.closed = true;
            connections.delete(conn);
          },
        };
        req.result = conn;
        if (!db || db.version < version) {
          if (!db) {
            db = { version, stores: new Map() };
            databases.set(name, db);
          }
          db.version = version;
          req.onupgradeneeded?.({ target: req });
        }
        connections.add(conn);
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };

  return {
    indexedDB: factory,
    /** Every record of a store, as stored. */
    records(dbName, store) {
      return [...(databases.get(dbName)?.stores.get(store)?.data.values() || [])].map((v) => structuredClone(v));
    },
    /** Write a record behind the app's back, as another tab would. */
    put(dbName, store, value, key) {
      const s = databases.get(dbName).stores.get(store);
      s.data.set(s.keyPath ? value[s.keyPath] : key, structuredClone(value));
    },
    get(dbName, store, key) {
      const v = databases.get(dbName)?.stores.get(store)?.data.get(key);
      return v === undefined ? undefined : structuredClone(v);
    },
    /** What clearing site data does to an open tab. */
    killConnections({ fireClose = true } = {}) {
      databases.clear();
      for (const conn of [...connections]) {
        conn.closed = true;
        connections.delete(conn);
        if (fireClose) later(() => conn.onclose?.());
      }
    },
    abortNextWrite() {
      abortNext = true;
    },
  };
}
