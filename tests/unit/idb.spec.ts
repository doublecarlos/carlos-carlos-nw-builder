// idb.ts — the IndexedDB wrapper. Unit tests use the in-memory Map backend so no DOM is
// needed. Verifies get/getAll/put/remove round trips and that a rejected write surfaces as
// a rejection rather than a throw.
import { describe, it, expect, beforeEach } from "vitest";
import { installIdbShim } from "./stores/window-shim";
import * as idb from "../../src/storage/idb";

beforeEach(() => {
  installIdbShim();
});

describe("idb backend", () => {
  it("put / get round-trips across all stores", async () => {
    for (const store of [
      "builds",
      "layers",
      "history",
      "trash",
      "meta",
    ] as idb.StoreName[]) {
      await idb.put(store, "key1", { value: 42 });
      const result = await idb.get(store, "key1");
      expect(result).toEqual({ value: 42 });
    }
  });

  it("get returns null for a missing key", async () => {
    const result = await idb.get("builds", "nonexistent");
    expect(result).toBeNull();
  });

  it("getAll returns all stored records", async () => {
    await idb.put("builds", "a", { id: "a" });
    await idb.put("builds", "b", { id: "b" });
    const all = await idb.getAll("builds");
    expect(all).toHaveLength(2);
    expect(all).toContainEqual({ id: "a" });
    expect(all).toContainEqual({ id: "b" });
  });

  it("getAll returns empty array for an empty store", async () => {
    const all = await idb.getAll("layers");
    expect(all).toEqual([]);
  });

  it("remove deletes a record", async () => {
    await idb.put("builds", "key1", { value: 42 });
    await idb.remove("builds", "key1");
    const result = await idb.get("builds", "key1");
    expect(result).toBeNull();
  });

  it("put overwrites an existing key", async () => {
    await idb.put("builds", "key1", { value: 1 });
    await idb.put("builds", "key1", { value: 2 });
    const result = await idb.get("builds", "key1");
    expect(result).toEqual({ value: 2 });
  });

  it("a rejected write surfaces as a rejection, not a throw", async () => {
    // The in-memory backend doesn't reject, so we simulate by injecting a rejecting backend.
    const rejectingBackend: idb.Backend = {
      get: () => Promise.reject(new Error("simulated failure")),
      getAll: () => Promise.reject(new Error("simulated failure")),
      put: () => Promise.reject(new Error("simulated failure")),
      remove: () => Promise.reject(new Error("simulated failure")),
    };
    idb.setBackend(rejectingBackend);
    await expect(idb.put("builds", "x", {})).rejects.toThrow(
      "simulated failure",
    );
    await expect(idb.get("builds", "x")).rejects.toThrow("simulated failure");
    await expect(idb.remove("builds", "x")).rejects.toThrow(
      "simulated failure",
    );
    // Restore the normal test backend
    installIdbShim();
  });

  it("stores are independent — put in one does not appear in another", async () => {
    await idb.put("builds", "shared", { from: "builds" });
    await idb.put("layers", "shared", { from: "layers" });
    expect(await idb.get("builds", "shared")).toEqual({ from: "builds" });
    expect(await idb.get("layers", "shared")).toEqual({ from: "layers" });
  });
});
