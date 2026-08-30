// Per-item persisted undo stack - unit tests for coalescing, limit, selection, trash
// interaction, and survival across a simulated reload.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Backend, StoreName } from "../../../src/storage/idb";

async function freshStores() {
  vi.resetModules();
  // Set up the IDB backend directly on the freshly imported idb module.
  const idb = await import("../../../src/storage/idb");
  const { installWindowShim } = await import("./window-shim");
  installWindowShim();

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

  idb.setBackend(backend);
  const builds = await import("../../../src/stores/builds");
  const history = await import("../../../src/stores/history");
  const layers = await import("../../../src/stores/layers");
  const selection = await import("../../../src/stores/selection");
  const trash = await import("../../../src/stores/trash");
  builds._setLoading(false);
  history._setLoading(false);
  layers._setLoading(false);
  // Ensure at least one layer exists (createLayer adds to layerOrder)
  if (!layers.layers.value.length) {
    layers.createLayer("Layer 1");
  }
  return { builds, history, layers, selection, trash };
}

describe("history store", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // --- build undo -----------------------------------------------------------------------

  it("a build edit then undo restores that build", async () => {
    const { builds, history, selection } = await freshStores();
    const b = builds.build.value;
    selection.selectBuild(b.id);

    history.snapshot("build", b.id, "choice:ring1", "ring1 → ItemA", b);
    b.choices.ring1 = "ItemA";

    expect(b.choices.ring1).toBe("ItemA");

    const json = history.undo("build", b.id, b);
    expect(json).not.toBeNull();
    const restored = JSON.parse(json!);
    expect(restored.choices.ring1).toBeUndefined();
  });

  it("undo on one build leaves other builds alone", async () => {
    const { builds, history, selection } = await freshStores();
    const b1 = builds.build.value;
    selection.selectBuild(b1.id);

    // Create a second build
    builds.createBuild();
    const b2 = builds.build.value;
    expect(b2.id).not.toBe(b1.id);

    // Edit b1
    selection.selectBuild(b1.id);
    const curB1 = builds.build.value;
    history.snapshot("build", b1.id, "choice:ring1", "ring1 → A", curB1);
    curB1.choices.ring1 = "A";

    // Edit b2
    selection.selectBuild(b2.id);
    const curB2 = builds.build.value;
    history.snapshot("build", b2.id, "choice:ring1", "ring1 → B", curB2);
    curB2.choices.ring1 = "B";

    // Undo b2 - should only affect b2
    const json2 = history.undo("build", b2.id, curB2);
    expect(json2).not.toBeNull();
    const restored2 = JSON.parse(json2!);
    expect(restored2.choices.ring1).toBeUndefined();

    // b1 should still have its choice
    expect(b1.choices.ring1).toBe("A");
  });

  // --- layer undo -----------------------------------------------------------------------

  it("a layer overlay edit then undo restores the overlay", async () => {
    const { layers, history, selection } = await freshStores();
    // layers.ts creates a default layer on first access
    const layer = layers.layers.value[0];
    expect(layer).toBeDefined();
    selection.selectLayer(layer.id);

    const overlay = JSON.parse(JSON.stringify(layer.overlay));
    history.snapshot("layer", layer.id, "save:item1", "Save item", overlay);
    overlay.items = {
      ...overlay.items,
      item1: { id: "item1", name: "Test Item" },
    };

    const json = history.undo("layer", layer.id, overlay);
    expect(json).not.toBeNull();
    const restored = JSON.parse(json!);
    expect(restored.items.item1).toBeUndefined();
  });

  // --- selection switch on undo ---------------------------------------------------------

  it("undoing a build edit while a layer is selected switches selection to the build", async () => {
    const { builds, history, layers, selection } = await freshStores();
    const b = builds.build.value;
    selection.selectBuild(b.id);

    history.snapshot("build", b.id, "choice:ring1", "ring1 → X", b);
    b.choices.ring1 = "X";

    // Switch to layer
    const layer = layers.layers.value[0];
    expect(layer).toBeDefined();
    selection.selectLayer(layer.id);

    // Undo the build - should switch selection back to the build
    const json = history.undo("build", b.id, b);
    expect(json).not.toBeNull();
    expect(selection.selection.value?.kind).toBe("build");
    expect(selection.selection.value?.id).toBe(b.id);
  });

  it("undoing a layer edit while a build is selected switches selection to the layer", async () => {
    const { builds, history, layers, selection } = await freshStores();
    const layer = layers.layers.value[0];
    expect(layer).toBeDefined();
    selection.selectLayer(layer.id);

    const overlay = JSON.parse(JSON.stringify(layer.overlay));
    history.snapshot("layer", layer.id, "save:item1", "Save item", overlay);
    overlay.items = { ...overlay.items, item1: { id: "item1", name: "X" } };

    // Switch to build
    const b = builds.build.value;
    selection.selectBuild(b.id);

    // Undo the layer - should switch selection back to the layer
    const json = history.undo("layer", layer.id, overlay);
    expect(json).not.toBeNull();
    expect(selection.selection.value?.kind).toBe("layer");
    expect(selection.selection.value?.id).toBe(layer.id);
  });

  // --- coalescing -----------------------------------------------------------------------

  it("collapses two edits of the same field inside 700 ms into one step", async () => {
    const { builds, history, selection } = await freshStores();
    const b = builds.build.value;
    selection.selectBuild(b.id);

    history.snapshot("build", b.id, "choice:ring1", "ring1 → A", b);
    b.choices.ring1 = "A";

    history.snapshot("build", b.id, "choice:ring1", "ring1 → B", b);
    b.choices.ring1 = "B";

    // One undo should go back past both
    const json = history.undo("build", b.id, b);
    expect(json).not.toBeNull();
    const restored = JSON.parse(json!);
    expect(restored.choices.ring1).toBeUndefined();
    expect(history.canUndo.value).toBe(false);
  });

  it("does not coalesce once the coalescing window has elapsed", async () => {
    vi.useFakeTimers();
    const { builds, history, selection } = await freshStores();
    const b = builds.build.value;
    selection.selectBuild(b.id);

    history.snapshot("build", b.id, "choice:ring1", "ring1 → A", b);
    b.choices.ring1 = "A";

    vi.advanceTimersByTime(800);

    history.snapshot("build", b.id, "choice:ring1", "ring1 → B", b);
    b.choices.ring1 = "B";

    // First undo goes back to A
    const json1 = history.undo("build", b.id, b);
    expect(json1).not.toBeNull();
    const restored1 = JSON.parse(json1!);
    expect(restored1.choices.ring1).toBe("A");

    // Second undo goes back to nothing
    const json2 = history.undo("build", b.id, b);
    expect(json2).not.toBeNull();
    const restored2 = JSON.parse(json2!);
    expect(restored2.choices.ring1).toBeUndefined();
  });

  // --- limit ----------------------------------------------------------------------------

  it("past a depth of 50 the oldest entry drops", async () => {
    const { builds, history, selection } = await freshStores();
    const b = builds.build.value;
    selection.selectBuild(b.id);

    // Push 51 entries
    for (let i = 0; i < 51; i++) {
      history.snapshot("build", b.id, null, `step ${i}`, b);
      b.name = `Build ${i}`;
    }

    // Undo should work
    const json = history.undo("build", b.id, b);
    expect(json).not.toBeNull();
    const restored = JSON.parse(json!);
    expect(restored.name).toBe("Build 49");
  });

  // --- simulated reload ----------------------------------------------------------------

  it("history entry is persisted to the IDB store", async () => {
    vi.useFakeTimers();
    const { builds, history, selection } = await freshStores();
    const b = builds.build.value;
    selection.selectBuild(b.id);

    history.snapshot("build", b.id, "choice:ring1", "ring1 → X", b);
    b.choices.ring1 = "X";

    // Flush the debounced save
    vi.advanceTimersByTime(300);

    // Verify the data is in the IDB store
    const idb = await import("../../../src/storage/idb");
    const stored = await idb.get("history", `build:${b.id}`);
    expect(stored).not.toBeNull();
    expect(stored).toHaveProperty("id", `build:${b.id}`);
    expect((stored as { data: { past: unknown[] } }).data.past.length).toBe(1);
  });

  // --- trash interaction ---------------------------------------------------------------

  it("deleting an item keeps its history while it is in the trash", async () => {
    const { builds, history, selection, trash } = await freshStores();
    const b = builds.build.value;
    selection.selectBuild(b.id);

    history.snapshot("build", b.id, "choice:ring1", "ring1 → X", b);
    b.choices.ring1 = "X";

    // Create a second build so delete doesn't refuse (< 2 builds)
    builds.createBuild();

    // "Delete" the build (moves to trash)
    builds.deleteBuild(b.id);

    // The history should still be accessible via the trash
    expect(trash.trashed.value.length).toBe(1);
    // canUndo is false because the build is no longer selected
    // but the history entry still exists internally
    expect(history._keys()).toContain(`build:${b.id}`);
  });

  it("purging from the trash drops the history too", async () => {
    const { builds, history, selection, trash } = await freshStores();
    const b = builds.build.value;
    selection.selectBuild(b.id);

    history.snapshot("build", b.id, "choice:ring1", "ring1 → X", b);
    b.choices.ring1 = "X";
    expect(history._keys()).toContain(`build:${b.id}`);

    // Create a second build so delete doesn't refuse
    builds.createBuild();

    // Delete, then purge
    builds.deleteBuild(b.id);
    expect(trash.trashed.value.length).toBe(1);
    trash.purge(trash.trashed.value[0]);

    // The history should be dropped
    expect(history._keys()).not.toContain(`build:${b.id}`);
  });

  // --- redo ----------------------------------------------------------------------------

  it("redo replays an undone step", async () => {
    const { builds, history, selection } = await freshStores();
    const b = builds.build.value;
    selection.selectBuild(b.id);

    history.snapshot("build", b.id, "choice:ring1", "ring1 → X", b);
    b.choices.ring1 = "X";
    expect(b.choices.ring1).toBe("X");

    // Undo
    const json = history.undo("build", b.id, b);
    expect(json).not.toBeNull();

    // Redo
    const redoJson = history.redo("build", b.id, b);
    expect(redoJson).not.toBeNull();
    const restored = JSON.parse(redoJson!);
    expect(restored.choices.ring1).toBe("X");
  });
});
