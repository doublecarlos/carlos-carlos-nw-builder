// Undo and redo restore persisted snapshots, which can predate a format change. Each restore
// path must migrate them like a stored build or layer. The legacy shape used here is a fixed
// Misc slot, since moved onto the `misc.misc` list.
import { describe, expect, it, vi } from "vitest";
import type { ItemHistory } from "../../../src/stores/history";

async function freshStores() {
  vi.resetModules();
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  installIdbShim();
  const builds = await import("../../../src/stores/builds");
  const buildEditor = await import("../../../src/stores/buildEditor");
  const history = await import("../../../src/stores/history");
  const layers = await import("../../../src/stores/layers");
  const layerEditor = await import("../../../src/stores/layerEditor");
  const storage = await import("../../../src/storage/storage");
  builds._setLoading(false);
  history._setLoading(false);
  layers._setLoading(false);
  return { builds, buildEditor, history, layers, layerEditor, storage };
}

/** A persisted stack holding one entry, on the undo side or the redo side. */
function stackWith(side: "past" | "future", snapshot: unknown): ItemHistory {
  const entry = { json: JSON.stringify(snapshot), label: "edit" };
  return {
    past: side === "past" ? [entry] : [],
    future: side === "future" ? [entry] : [],
    lastKey: null,
    lastAt: 0,
  };
}

const legacyOverlay = {
  sectionPresets: {
    p: { id: "p", label: "P", section: "misc", choices: { "misc.misc6": "a" } },
  },
};

describe("build undo restores", () => {
  async function withLegacyBuild(side: "past" | "future") {
    const stores = await freshStores();
    const b = stores.storage.defaultBuild("Build 1");
    stores.builds.replaceActive(b);
    const legacy = { ...b, choices: { "misc.misc4": "a" } };
    stores.history._init(new Map([[`build:${b.id}`, stackWith(side, legacy)]]));
    return { ...stores, id: b.id };
  }

  it("migrates a snapshot restored by undo", async () => {
    const { builds, buildEditor } = await withLegacyBuild("past");
    buildEditor.undo();
    expect(builds.build.value!.choices).toEqual({ "misc.misc#1": "a" });
  });

  it("migrates a snapshot restored by redo", async () => {
    const { builds, buildEditor } = await withLegacyBuild("future");
    buildEditor.redo();
    expect(builds.build.value!.choices).toEqual({ "misc.misc#1": "a" });
  });

  it("migrates a snapshot restored by an undo notice", async () => {
    const { builds, id } = await withLegacyBuild("past");
    builds.undoFor(id);
    expect(builds.get(id)!.choices).toEqual({ "misc.misc#1": "a" });
  });
});

describe("layer undo restores", () => {
  async function withLegacyLayer(side: "past" | "future", snapshot: unknown) {
    const stores = await freshStores();
    const layer = stores.layers.createLayer("L");
    stores.history._init(
      new Map([[`layer:${layer.id}`, stackWith(side, snapshot)]]),
    );
    const current = () =>
      stores.layers.layers.value.find((l) => l.id === layer.id)!;
    return { ...stores, id: layer.id, current };
  }

  it("migrates an overlay restored by undo", async () => {
    const { layerEditor, current } = await withLegacyLayer(
      "past",
      legacyOverlay,
    );
    layerEditor.undo();
    expect(current().overlay.sectionPresets.p?.choices).toEqual({
      "misc.misc#1": "a",
    });
  });

  it("migrates an overlay restored by redo", async () => {
    const { layerEditor, current } = await withLegacyLayer(
      "future",
      legacyOverlay,
    );
    layerEditor.redo();
    expect(current().overlay.sectionPresets.p?.choices).toEqual({
      "misc.misc#1": "a",
    });
  });

  it("migrates an overlay restored by an undo notice", async () => {
    const { layers, id, current } = await withLegacyLayer(
      "past",
      legacyOverlay,
    );
    layers.undoOverlayFor(id);
    expect(current().overlay.sectionPresets.p?.choices).toEqual({
      "misc.misc#1": "a",
    });
  });

  it("migrates a whole layer restored by undoing a revert", async () => {
    const stores = await freshStores();
    const layer = stores.layers.createLayer("L");
    const legacyLayer = { ...layer, overlay: legacyOverlay };
    stores.history._init(
      new Map([[`layer:${layer.id}`, stackWith("past", legacyLayer)]]),
    );
    stores.layers.undoLayerFor(layer.id);
    const restored = stores.layers.layers.value.find((l) => l.id === layer.id)!;
    expect(restored.name).toBe("L");
    expect(restored.overlay.sectionPresets.p?.choices).toEqual({
      "misc.misc#1": "a",
    });
  });
});
