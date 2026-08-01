// Minimal IndexedDB wrapper — one database, five object stores, a `setBackend()` seam for
// unit tests. No wrapper library: get/getAll/put/remove on five keyed stores is too small
// for a library to earn its keep, and the transaction-lifetime footgun (see below) means
// we own an interface layer either way.
//
// ## Transaction lifetime
// An IDB transaction auto-commits once the microtask queue drains, so `await`ing anything
// non-IDB between opening a transaction and using it kills it. `withStore` takes the
// request-building callback synchronously — one operation per transaction.
//
// ## onupgradeneeded must be additive
// Create each store only if `db.objectStoreNames.contains(name)` is false, so a later
// version bump adding a sixth store cannot fail on browsers already holding v1.

import { isReactive, isRef, toRaw } from "vue";

const DB_NAME = "nw";
const DB_VERSION = 1;
const STORE_NAMES = ["builds", "layers", "history", "trash", "meta"] as const;
export type StoreName = (typeof STORE_NAMES)[number];

// --- Backend abstraction (real IDB vs in-memory for tests) --------------------------------

export interface Backend {
  get(store: StoreName, key: string): Promise<unknown>;
  getAll(store: StoreName): Promise<unknown[]>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  remove(store: StoreName, key: string): Promise<void>;
}

let _backend: Backend | null = null;

/** Inject a test backend (e.g. Map-based). `null` restores the real IDB implementation. */
export function setBackend(backend: Backend | null) {
  _backend = backend;
}

// --- Real IDB implementation --------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("indexedDB.open failed"));
    request.onblocked = () => reject(new Error("indexedDB.open blocked"));
  });
}

function withStore<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then((db) => {
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = callback(store);
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () =>
        reject(request.error ?? new Error("IDB request failed"));
      transaction.oncomplete = () => {
        db.close();
        resolve(result);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? new Error("IDB transaction failed"));
      };
    });
  });
}

// --- Public API ---------------------------------------------------------------------------

const idbBackend: Backend = {
  get(store: StoreName, key: string) {
    return withStore(store, "readonly", (s) => s.get(key));
  },

  async getAll(store: StoreName) {
    const items: unknown[] = [];
    const db = await openDb();
    return new Promise<unknown[]>((resolve, reject) => {
      const transaction = db.transaction(store, "readonly");
      const objectStore = transaction.objectStore(store);
      const request = objectStore.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          items.push(cursor.value);
          cursor.continue();
        }
      };
      transaction.oncomplete = () => {
        db.close();
        resolve(items);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? new Error("IDB getAll failed"));
      };
    });
  },

  put(store: StoreName, key: string, value: unknown) {
    return withStore(store, "readwrite", (s) => s.put(value, key)).then(
      () => {},
    );
  },

  remove(store: StoreName, key: string) {
    return withStore(store, "readwrite", (s) => s.delete(key));
  },
};

function backend(): Backend {
  return _backend ?? idbBackend;
}

// --- Exported store operations ------------------------------------------------------------

export function get(store: StoreName, key: string): Promise<unknown> {
  return backend()
    .get(store, key)
    .catch((e) => Promise.reject(e));
}

export function getAll(store: StoreName): Promise<unknown[]> {
  return backend()
    .getAll(store)
    .catch((e) => Promise.reject(e));
}

export function put(
  store: StoreName,
  key: string,
  value: unknown,
): Promise<void> {
  return backend()
    .put(store, key, deepToRaw(value))
    .catch((e) => Promise.reject(e));
}

export function remove(store: StoreName, key: string): Promise<void> {
  return backend()
    .remove(store, key)
    .catch((e) => Promise.reject(e));
}

export function deepToRaw<T>(value: T): T {
  if (isRef(value)) {
    return deepToRaw(value.value) as T;
  }

  if (isReactive(value)) {
    value = toRaw(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map(deepToRaw) as T;
  }

  if (value instanceof Date) {
    return new Date(value) as T;
  }

  if (value instanceof Map) {
    return new Map(
      Array.from(value.entries(), ([k, v]) => [deepToRaw(k), deepToRaw(v)]),
    ) as T;
  }

  if (value instanceof Set) {
    return new Set(Array.from(value, deepToRaw)) as T;
  }

  if (value !== null && typeof value === "object") {
    const result: Record<PropertyKey, unknown> = {};

    for (const key of Reflect.ownKeys(value)) {
      result[key] = deepToRaw((value as Record<PropertyKey, unknown>)[key]);
    }

    return result as T;
  }

  return value;
}
