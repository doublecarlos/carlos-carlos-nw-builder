// hydrate() must never reject: it runs before the app is mounted, so an escaping rejection
// leaves the page on index.html's boot screen with no way forward.
import { describe, expect, it, vi } from "vitest";
import { installWindowShim } from "./window-shim";
import type { Backend } from "../../../src/storage/idb";

const refusing: Backend = {
  get: () => Promise.reject(new Error("The operation is insecure.")),
  getAll: () => Promise.reject(new Error("The operation is insecure.")),
  put: () => Promise.reject(new Error("The operation is insecure.")),
  remove: () => Promise.reject(new Error("The operation is insecure.")),
};

const working: Backend = {
  get: async () => null,
  getAll: async () => [],
  put: async () => {},
  remove: async () => {},
};

/** Boots the stores from scratch against `backend`. Modules are reset first because every
 *  store here is a singleton, and the notice store deliberately latches its failure flag. */
async function boot(backend: Backend) {
  vi.resetModules();
  installWindowShim();
  const idb = await import("../../../src/storage/idb");
  idb.setBackend(backend);

  const bootstrap = await import("../../../src/stores/bootstrap");
  const builds = await import("../../../src/stores/builds");
  const landing = await import("../../../src/stores/landing");
  const notice = await import("../../../src/stores/notice");

  await bootstrap.hydrate();
  return { builds, landing, notice };
}

describe("hydrate", () => {
  it("finishes loading and flags nothing when storage works", async () => {
    const { builds, notice } = await boot(working);

    expect(builds.loading.value).toBe(false);
    expect(notice.storageFailed.value).toBe(false);
  });

  it("still finishes loading when storage refuses to open", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { builds, landing } = await boot(refusing);

    // App.vue gates its loading skeleton on this; left true, it never renders anything else.
    expect(builds.loading.value).toBe(false);
    expect(landing.showing.value).toBe(true);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it("warns that nothing will be saved, and keeps warning after the toast expires", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { notice } = await boot(refusing);

    expect(notice.notice.value).toMatch(/nothing will be saved/i);
    // The toast clears itself; this flag is what the header's indicator reads afterwards.
    expect(notice.storageFailed.value).toBe(true);

    warn.mockRestore();
  });

  it("leaves a usable, in-memory builder behind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { builds } = await boot(refusing);
    builds.createBuild();

    expect(builds.builds.value.length).toBeGreaterThanOrEqual(1);

    warn.mockRestore();
  });
});
