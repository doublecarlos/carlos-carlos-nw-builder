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
  const navHistory = await import("../../../src/stores/navHistory");
  builds._setLoading(false);
  history._setLoading(false);
  layers._setLoading(false);
  return { builds, buildEditor, history, layers, storage, navHistory };
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

describe("undoing a delete", () => {
  // The build sat in the trash while the catalog changed, so it missed that sync.
  it("migrates a build the catalog promoted an input of while it was deleted", async () => {
    const { builds, layers, navHistory, layerId, id } =
      await withLayer(privateOverlay());
    builds.get(id)!.bonusValues = structuredClone(privateValue);
    builds.deleteBuild(id);
    layers.updateOverlay(layerId, promotedOverlay());
    await nextTick();
    navHistory.undo();
    expect(songAt(builds.get(id))).toBe(true);
    expect(builds.get(id)!.bonusValues).toEqual({});
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

/** Boots the stores from a backend holding `builds` and `layers`, the layers in that order.
 *  `before` runs on the fresh stores first. */
async function boot(
  stored: (storage: typeof import("../../../src/storage/storage")) => {
    builds: Build[];
    overlays: CatalogOverlay[];
  },
  before?: (stores: {
    layers: typeof import("../../../src/stores/layers");
  }) => Promise<void>,
) {
  vi.resetModules();
  const { installWindowShim } = await import("./window-shim");
  installWindowShim();
  const idb = await import("../../../src/storage/idb");
  const storage = await import("../../../src/storage/storage");
  const { builds: storedBuilds, overlays } = stored(storage);
  const storedLayers = overlays.map((overlay, index) => ({
    ...storage.defaultLayer(`L${index}`),
    overlay,
  }));
  const backend: Backend = {
    get: async (store) =>
      store === "meta"
        ? {
            buildOrder: storedBuilds.map((b) => b.id),
            folders: [],
            layerOrder: storedLayers.map((l) => l.id),
            lastSelection: null,
          }
        : null,
    getAll: async (store) =>
      store === "builds"
        ? storedBuilds
        : store === "layers"
          ? storedLayers
          : [],
    put: async () => {},
    remove: async () => {},
  };
  idb.setBackend(backend);
  const bootstrap = await import("../../../src/stores/bootstrap");
  const builds = await import("../../../src/stores/builds");
  const layers = await import("../../../src/stores/layers");
  await before?.({ layers });
  await bootstrap.hydrate();
  await nextTick();
  return { builds, id: storedBuilds[0].id };
}

describe("a load", () => {
  it("migrates a stored build against its stored layers", async () => {
    const { builds, id } = await boot((storage) => ({
      builds: [
        { ...storage.defaultBuild("Stored"), bonusValues: privateValue },
      ],
      overlays: [promotedOverlay()],
    }));
    expect(songAt(builds.get(id))).toBe(true);
    expect(builds.get(id)!.bonusValues).toEqual({});
  });

  // Loading is not a catalog change: whatever catalog the stores held before the load, the
  // pool was not in line with it, so nothing demotes.
  it("does not demote against the catalog held before the load", async () => {
    const { builds, id } = await boot(
      (storage) => ({
        builds: [
          {
            ...storage.defaultBuild("Stored"),
            context: {
              ...storage.defaultBuild().context,
              zzglobals: { song: true },
            } as Build["context"],
          },
        ],
        overlays: [privateOverlay()],
      }),
      async ({ layers }) => {
        const layer = layers.createLayer("Before");
        layers.updateOverlay(layer.id, promotedOverlay());
        await nextTick();
      },
    );
    expect(songAt(builds.get(id))).toBe(true);
    expect(builds.get(id)!.bonusValues).toEqual({});
  });
});
