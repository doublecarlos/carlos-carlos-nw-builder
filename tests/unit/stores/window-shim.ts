// A minimal `window` for store modules that read `localStorage`/`location`/`history` at
// import time (they bootstrap themselves, same as they would in a real page load). The unit
// suite runs under vitest's `node` environment (no jsdom dependency) -- this is enough surface
// for the stores under test without pulling in a full DOM.
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
}
