// `Build.catalog` is a wire-format field: an import unpacks it into a top-priority layer and
// clears it, so the entries a build brought with it are visible and editable like any other
// catalog content, and the build still resolves the way its author saw it. These cover the
// import path, the content dedup that keeps one sender's builds on one layer, and the boot
// migration for builds stored before any of that.
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptAll } from "../../../src/lib/import-plan";
import type { Build, CatalogOverlay } from "../../../src/types";

const CUSTOM_ITEM_ID = "test-imported-ring";

const customOverlay = (): CatalogOverlay => ({
  items: {
    [CUSTOM_ITEM_ID]: {
      id: CUSTOM_ITEM_ID,
      name: "Imported Ring",
      filter: "gear_ring",
    },
  },
  bonuses: {},
  sectionPresets: {},
  slots: {},
});

async function freshStores() {
  vi.resetModules();
  // The stores get a fresh `storage/idb` from `resetModules`, so the shims are loaded after it.
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  const idb = installIdbShim();
  const builds = await import("../../../src/stores/builds");
  const layers = await import("../../../src/stores/layers");
  const notice = await import("../../../src/stores/notice");
  const storage = await import("../../../src/storage/storage");
  const importFile = await import("../../../src/stores/importFile");
  const resolved = await import("../../../src/stores/resolved");
  const bootstrap = await import("../../../src/stores/bootstrap");
  builds._setLoading(false);
  layers._setLoading(false);
  return {
    builds,
    layers,
    notice,
    storage,
    importFile,
    resolved,
    bootstrap,
    idb,
  };
}

type Stores = Awaited<ReturnType<typeof freshStores>>;

/** A build export file whose builds each carry `overlay` as their embedded catalog. */
const buildFile = (
  storage: Stores["storage"],
  names: string[],
  overlay: CatalogOverlay,
) =>
  JSON.stringify({
    v: storage.SCHEMA_VERSION,
    kind: "build",
    data: names.map((name) => ({
      ...storage.defaultBuild(name),
      catalog: overlay,
    })),
  });

/** Reads a file and takes everything it offers, as the picker's default does. */
function importAll(importFile: Stores["importFile"], text: string) {
  importFile.importFileText(text, "import.json");
  const plan = importFile.pending.value!;
  importFile.applyImport(plan, acceptAll(plan));
}

describe("unpacking an imported build's catalog", () => {
  it("lands it in a new top-priority layer, enabled", async () => {
    const { builds, layers, storage, importFile } = await freshStores();

    importAll(importFile, buildFile(storage, ["Shared"], customOverlay()));

    expect(layers.layers.value.length).toBe(1);
    const [layer] = layers.layers.value;
    expect(layer.name).toBe("Shared (imported)");
    expect(layer.enabled).toBe(true);
    expect(layer.overlay.items?.[CUSTOM_ITEM_ID]).toBeDefined();
    // Index 0 is the highest priority, which is where the embedded catalog used to fold.
    expect(layers.layers.value[0].id).toBe(layer.id);
    expect(builds.build.value.name).toBe("Shared");
  });

  it("clears the field, so the build is stored without it", async () => {
    const { builds, storage, importFile } = await freshStores();

    importAll(importFile, buildFile(storage, ["Shared"], customOverlay()));

    const imported = builds.builds.value.find((b) => b.name === "Shared")!;
    expect(imported.catalog).toBeUndefined();
  });

  it("leaves the item resolvable, which is the point of the layer", async () => {
    const { storage, importFile, resolved } = await freshStores();

    importAll(importFile, buildFile(storage, ["Shared"], customOverlay()));

    expect(resolved.db.value.get(CUSTOM_ITEM_ID)?.name).toBe("Imported Ring");
  });

  it("puts several builds carrying the same catalog on one layer", async () => {
    const { layers, storage, importFile } = await freshStores();

    importAll(
      importFile,
      buildFile(storage, ["One", "Two", "Three"], customOverlay()),
    );

    expect(layers.layers.value.length).toBe(1);
  });

  it("reuses the matching layer when the same file is imported again", async () => {
    const { layers, storage, importFile } = await freshStores();
    const text = buildFile(storage, ["Shared"], customOverlay());

    importAll(importFile, text);
    importAll(importFile, text);

    expect(layers.layers.value.length).toBe(1);
  });

  it("names the layer it created in the import notice", async () => {
    const { notice, storage, importFile } = await freshStores();

    importAll(importFile, buildFile(storage, ["Shared"], customOverlay()));

    expect(notice.notice.value).toContain("Shared (imported)");
    expect(notice.notice.value).toMatch(/on top of your other layers/);
  });

  it("says the entries were already there when a layer matched", async () => {
    const { notice, storage, importFile } = await freshStores();
    const text = buildFile(storage, ["Shared"], customOverlay());

    importAll(importFile, text);
    importAll(importFile, text);

    expect(notice.notice.value).toMatch(/already held them/);
    expect(notice.notice.value).not.toMatch(/switched off/);
  });

  it("warns when the matching layer is switched off, since the items then stay unresolved", async () => {
    const { layers, notice, storage, importFile } = await freshStores();
    const text = buildFile(storage, ["Shared"], customOverlay());

    importAll(importFile, text);
    layers.setLayerEnabled(layers.layers.value[0].id, false);
    importAll(importFile, text);

    // Left as the user arranged it, so the notice is what tells them.
    expect(layers.layers.value.length).toBe(1);
    expect(layers.layers.value[0].enabled).toBe(false);
    expect(notice.notice.value).toMatch(
      /“Shared \(imported\)” already held them but is switched off/,
    );
  });

  it("says nothing about catalogs for a build that carries none", async () => {
    const { notice, storage, importFile } = await freshStores();

    importAll(
      importFile,
      JSON.stringify({
        v: storage.SCHEMA_VERSION,
        kind: "build",
        data: storage.defaultBuild("Plain"),
      }),
    );

    expect(notice.notice.value).not.toMatch(/custom catalog entries/);
  });
});

describe("migrating a stored build's catalog at boot", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Seeds the IDB shim with one build record that still carries an embedded catalog. */
  function seedStoredBuild(idb: Stores["idb"], build: Build) {
    idb.stores.get("builds")!.set(build.id, build);
  }

  /** Both stores debounce their writes; this lets the pending ones run. */
  const flushSaves = () => vi.advanceTimersByTimeAsync(300);

  it("unpacks it into a top-priority layer and clears the field", async () => {
    const { builds, layers, storage, bootstrap, idb } = await freshStores();
    const stored: Build = {
      ...storage.defaultBuild("Stored"),
      catalog: customOverlay(),
    };
    seedStoredBuild(idb, stored);

    await bootstrap.hydrate();

    expect(layers.layers.value.length).toBe(1);
    expect(layers.layers.value[0].name).toBe("Stored (imported)");
    expect(layers.layers.value[0].enabled).toBe(true);
    expect(builds.get(stored.id)?.catalog).toBeUndefined();
  });

  it("writes the stripped build and the new layer back to storage", async () => {
    vi.useFakeTimers();
    const { storage, bootstrap, idb } = await freshStores();
    const stored: Build = {
      ...storage.defaultBuild("Stored"),
      catalog: customOverlay(),
    };
    seedStoredBuild(idb, stored);

    await bootstrap.hydrate();
    await flushSaves();

    const reloaded = await storage.loadAll();
    expect(reloaded.builds[0].catalog).toBeUndefined();
    expect(reloaded.layers.length).toBe(1);
    // The order record has to carry the new layer, or it comes back at the bottom next boot.
    expect(reloaded.meta.layerOrder[0]).toBe(reloaded.layers[0].id);
  });

  it("leaves nothing to do on the second boot", async () => {
    vi.useFakeTimers();
    const { layers, storage, bootstrap, idb } = await freshStores();
    const stored: Build = {
      ...storage.defaultBuild("Stored"),
      catalog: customOverlay(),
    };
    seedStoredBuild(idb, stored);

    await bootstrap.hydrate();
    await flushSaves();
    await bootstrap.hydrate();

    expect(layers.layers.value.length).toBe(1);
  });
});
