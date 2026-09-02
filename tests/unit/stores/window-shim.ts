// A minimal `window` for store modules that read `localStorage`/`location`/`history` at
// import time (they bootstrap themselves, same as they would in a real page load). The unit
// suite runs under vitest's `node` environment (no jsdom dependency) -- this is enough surface
// for the stores under test without pulling in a full DOM.
//
// Also provides an in-memory IDB backend via `idb.setBackend()`.

import { setBackend } from "../../../src/storage/idb";
import type { Backend, StoreName } from "../../../src/storage/idb";

export function installWindowShim() {
  const store = new Map<string, string>();
  const win = globalThis as unknown as Record<string, unknown>;
  win.window = globalThis;
  win.localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  win.location = {
    search: "",
    pathname: "/",
    hash: "",
    href: "http://localhost/",
  };
  win.history = { pushState: () => {}, replaceState: () => {} };
  // Inert, but they have to exist for VueUse's `useStorage`, which stores that persist a
  // preference are built on. Without a `document` it decides this is not a browser and hands
  // the store no storage at all -- silently, so every stored preference reads back as unset.
  // Past that it narrows the backend with `storage instanceof Storage`, subscribes to storage
  // events, and dispatches one on every write -- so the constructor, the listener pair and
  // `dispatchEvent` all have to be present.
  win.document = { addEventListener: () => {}, removeEventListener: () => {} };
  win.Storage = class Storage {};
  win.addEventListener = () => {};
  win.removeEventListener = () => {};
  win.dispatchEvent = () => true;
}

/** An in-memory Map-based IDB backend for unit tests. Each store is a Map<string, unknown>. */
export function installIdbShim() {
  const stores = new Map<StoreName, Map<string, unknown>>();
  for (const name of [
    "builds",
    "layers",
    "history",
    "trash",
    "meta",
  ] as StoreName[]) {
    stores.set(name, new Map());
  }

  const backend: Backend = {
    async get(store: StoreName, key: string) {
      return stores.get(store)?.get(key) ?? null;
    },
    async getAll(store: StoreName) {
      const map = stores.get(store);
      if (!map) return [];
      return [...map.values()];
    },
    async put(store: StoreName, key: string, value: unknown) {
      stores.get(store)?.set(key, value);
    },
    async remove(store: StoreName, key: string) {
      stores.get(store)?.delete(key);
    },
  };

  setBackend(backend);
  return { stores, clear: () => stores.forEach((m) => m.clear()) };
}
