// A promoted bonus input's stored value must follow it to the global input at every door a
// build meets the catalog through: a layer change, an undo restore, an import and a load.
// The catalog is a layer of its own entries over the shipped one, in two versions: the
// bonus's input private, and the same input read through a global input.
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { Backend } from "../../../src/storage/idb";
import type { Build, CatalogOverlay } from "../../../src/types";
import type { ItemHistory } from "../../../src/stores/history";

const SLOT = "zzglobals.song";

const privateOverlay = (): CatalogOverlay => ({
  items: {},
  bonuses: {
    "zz-ballad": {
      id: "zz-ballad",
      name: "Ballad",
      inputs: { song: { type: "boolean", default: false } },
      grants: [],
    },
  },
  sectionPresets: {},
  slots: {},
  sections: {},
  filters: {},
});

const promotedOverlay = (): CatalogOverlay => ({
  ...privateOverlay(),
  bonuses: {
    "zz-ballad": {
      id: "zz-ballad",
      name: "Ballad",
      inputs: { song: { global: SLOT } },
      grants: [],
    },
  },
  slots: {
    [SLOT]: {
      id: SLOT,
      label: "Played a song",
      section: "zzglobals",
      type: "build_parameter",
      paramType: "boolean",
      path: SLOT,
      default: false,
      globalInput: true,
    },
  },
  sections: {
    zzglobals: { id: "zzglobals", label: "Global inputs", slotIds: [] },
  },
});

const privateValue = { "zz-ballad": { input: { song: true } } };
const songAt = (b: Build | undefined) =>
  (b?.context as unknown as { zzglobals?: { song?: boolean } }).zzglobals?.song;

async function freshStores() {
  vi.resetModules();
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  installIdbShim();
  const builds = await import("../../../src/stores/builds");
  const buildEditor = await import("../../../src/stores/buildEditor");
  const history = await import("../../../src/stores/history");
  const layers = await import("../../../src/stores/layers");
  const storage = await import("../../../src/storage/storage");
  builds._setLoading(false);
  history._setLoading(false);
  layers._setLoading(false);
  return { builds, buildEditor, history, layers, storage };
}

/** One build in the pool, synced against a layer holding `overlay`. */
async function withLayer(overlay: CatalogOverlay) {
  const stores = await freshStores();
  const layer = stores.layers.createLayer("L");
  stores.layers.updateOverlay(layer.id, overlay);
  const b = stores.storage.defaultBuild("Build 1");
  stores.builds.replaceActive(b);
  stores.builds.syncAll();
  return { ...stores, layerId: layer.id, id: b.id };
}

describe("a layer change", () => {
  it("moves a stored value onto the global input it was promoted to", async () => {
    const { builds, layers, layerId, id } = await withLayer(privateOverlay());
    builds.get(id)!.bonusValues = structuredClone(privateValue);
    layers.updateOverlay(layerId, promotedOverlay());
    await nextTick();
    expect(songAt(builds.get(id))).toBe(true);
    expect(builds.get(id)!.bonusValues).toEqual({});
  });

  it("moves it back when the input is demoted again", async () => {
    const { builds, layers, layerId, id } = await withLayer(promotedOverlay());
    builds.get(id)!.context = {
      ...builds.get(id)!.context,
      zzglobals: { song: true },
    } as Build["context"];
    layers.updateOverlay(layerId, privateOverlay());
    await nextTick();
    expect(builds.get(id)!.bonusValues).toEqual(privateValue);
    expect(songAt(builds.get(id))).toBeUndefined();
  });

  // Switching off a layer promoting a lower layer's input is a demotion, and back on a
  // promotion.
  it("round-trips through switching the promoting layer off and on", async () => {
    const { builds, layers, layerId, id } = await withLayer(promotedOverlay());
    // A new layer goes below the existing ones.
    const lower = layers.createLayer("Lower");
    layers.updateOverlay(lower.id, privateOverlay());
    await nextTick();
    builds.get(id)!.context = {
      ...builds.get(id)!.context,
      zzglobals: { song: true },
    } as Build["context"];
    layers.setLayerEnabled(layerId, false);
    await nextTick();
    expect(builds.get(id)!.bonusValues).toEqual(privateValue);
    expect(songAt(builds.get(id))).toBeUndefined();
    layers.setLayerEnabled(layerId, true);
    await nextTick();
    expect(songAt(builds.get(id))).toBe(true);
    expect(builds.get(id)!.bonusValues).toEqual({});
  });
});

describe("an undo restore", () => {
  it("migrates a snapshot taken before the promotion", async () => {
    const { builds, buildEditor, history, id } =
      await withLayer(promotedOverlay());
    const before = { ...builds.get(id)!, bonusValues: privateValue };
    const stack: ItemHistory = {
      past: [{ json: JSON.stringify(before), label: "edit" }],
      future: [],
      lastKey: null,
      lastAt: 0,
    };
    history._init(new Map([[`build:${id}`, stack]]));
    buildEditor.undo();
    expect(songAt(builds.build.value!)).toBe(true);
    expect(builds.build.value!.bonusValues).toEqual({});
  });
});

describe("an import", () => {
  // The snapshot moves too, or the import reads as changed since its download at once.
  it("migrates the build and its downloaded snapshot alike", async () => {
    const { builds, storage } = await withLayer(promotedOverlay());
    const raw = {
      ...storage.defaultBuild("Imported"),
      bonusValues: privateValue,
    };
    const imported = storage.normalize({
      ...raw,
      downloaded: { snapshot: raw, at: 1 },
    });
    builds.upsertImported(imported, false);
    expect(songAt(builds.get(imported.id))).toBe(true);
    expect(builds.isDownloaded(imported.id)).toBe(true);
  });
});

describe("a load", () => {
  it("migrates a stored build against its stored layers", async () => {
    vi.resetModules();
    const { installWindowShim } = await import("./window-shim");
    installWindowShim();
    const idb = await import("../../../src/storage/idb");
    const storage = await import("../../../src/storage/storage");
    const stored = {
      ...storage.defaultBuild("Stored"),
      bonusValues: privateValue,
    };
    const layer = {
      ...storage.defaultLayer("L"),
      overlay: promotedOverlay(),
    };
    const backend: Backend = {
      get: async (store) =>
        store === "meta"
          ? {
              buildOrder: [stored.id],
              folders: [],
              layerOrder: [layer.id],
              lastSelection: null,
            }
          : null,
      getAll: async (store) =>
        store === "builds" ? [stored] : store === "layers" ? [layer] : [],
      put: async () => {},
      remove: async () => {},
    };
    idb.setBackend(backend);
    const bootstrap = await import("../../../src/stores/bootstrap");
    const builds = await import("../../../src/stores/builds");
    await bootstrap.hydrate();
    expect(songAt(builds.get(stored.id))).toBe(true);
    expect(builds.get(stored.id)!.bonusValues).toEqual({});
  });
});
