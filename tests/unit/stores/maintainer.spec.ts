// The maintainer flag's one subtlety: `?maintainer=1` seeds the stored preference and then
// leaves the URL, so it cannot ride along on later navigations or turn itself back on every
// time someone reloads a link that was pasted around.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { installWindowShim } from "./window-shim";

/**
 * Imports the store against a given query string and build mode, reporting the URLs it wrote
 * back. `dev` is what decides the flag's default, so it has to be settled before the import
 * that reads it -- the unit suite itself runs as a dev build, which would otherwise make the
 * shipped default untestable.
 */
const load = async (search: string, { dev = false } = {}) => {
  vi.resetModules();
  // Loaded after `resetModules` so `setBackend` lands on the same `storage/idb` the store
  // under test imports, not the instance the reset discarded.
  const { installIdbShim } = await import("./window-shim");
  installIdbShim();
  vi.stubEnv("DEV", dev);
  const win = globalThis as unknown as Record<string, unknown>;
  const replaced: string[] = [];
  win.location = {
    search,
    pathname: "/",
    hash: "",
    href: `http://localhost/${search}`,
  };
  win.history = {
    pushState: () => {},
    replaceState: (_state: unknown, _title: string, url: string) => {
      replaced.push(url);
    },
  };
  const mod = await import("../../../src/stores/maintainer");
  return { mod, replaced };
};

const seedStored = (value: string) =>
  (globalThis as unknown as { localStorage: Storage }).localStorage.setItem(
    "nw:maintainer",
    value,
  );

beforeEach(() => {
  vi.unstubAllEnvs();
  installWindowShim();
});

describe("maintainer mode", () => {
  it("stays off in a shipped build for a browser that never asked for it", async () => {
    const { mod } = await load("");

    mod.initMaintainer();

    expect(mod.enabled.value).toBe(false);
  });

  it("starts on in a dev build, where working on the data files is the point", async () => {
    const { mod } = await load("", { dev: true });

    mod.initMaintainer();

    expect(mod.enabled.value).toBe(true);
  });

  it("lets a dev build turn it off and keeps it off", async () => {
    const { mod } = await load("?maintainer=0", { dev: true });

    mod.initMaintainer();

    expect(mod.enabled.value).toBe(false);
  });

  it("turns on from ?maintainer=1", async () => {
    const { mod } = await load("?maintainer=1");

    mod.initMaintainer();

    expect(mod.enabled.value).toBe(true);
  });

  it("drops the param once it has been applied", async () => {
    const { mod, replaced } = await load("?maintainer=1");

    mod.initMaintainer();

    expect(replaced.at(-1)).toBe("/");
  });

  it("leaves the rest of the query string in place", async () => {
    const { mod, replaced } = await load("?build=abc&maintainer=1");

    mod.initMaintainer();

    expect(replaced.at(-1)).toBe("/?build=abc");
  });

  it("does not touch a URL that never carried the param", async () => {
    const { mod, replaced } = await load("?build=abc");

    mod.initMaintainer();

    expect(replaced).toHaveLength(0);
  });

  it("turns back off from ?maintainer=0", async () => {
    seedStored("true");
    const { mod } = await load("?maintainer=0");

    mod.initMaintainer();

    expect(mod.enabled.value).toBe(false);
  });

  it("survives a reload once stored, with no param present", async () => {
    seedStored("true");
    const { mod } = await load("");

    mod.initMaintainer();

    expect(mod.enabled.value).toBe(true);
  });
});
