// Tests for stores/importFile.ts: the header's Import button is the app's only file entry
// point, so every shape the app can hand out has to reach the picker as the right plan, and
// land in the right store once that plan is applied.
import { describe, expect, it, vi } from "vitest";
import { installWindowShim } from "./window-shim";
import { acceptAll } from "../../../src/lib/import-plan";

async function freshStores() {
  vi.resetModules();
  installWindowShim();
  const builds = await import("../../../src/stores/builds");
  const layers = await import("../../../src/stores/layers");
  const notice = await import("../../../src/stores/notice");
  const storage = await import("../../../src/storage/storage");
  const trash = await import("../../../src/stores/trash");
  const landing = await import("../../../src/stores/landing");
  const importFile = await import("../../../src/stores/importFile");
  builds._setLoading(false);
  layers._setLoading(false);
  return { builds, layers, notice, storage, trash, landing, importFile };
}

/** A bundle of one build and one layer, neither of which the workspace already has. */
const bundleText = (storage: typeof import("../../../src/storage/storage")) =>
  enveloped(
    "bundle",
    {
      builds: [storage.defaultBuild("Bundled build")],
      layers: [storage.defaultLayer("Bundled layer")],
    },
    storage.SCHEMA_VERSION,
  );

/** An export envelope without `catalog`, so nothing reads as catalogue-stale. */
const enveloped = (kind: string, data: unknown, v = 1) =>
  JSON.stringify({ v, kind, data });

describe("importFile store", () => {
  /** Reads a file and takes everything it offers, as the picker's default does. */
  function importAll(
    importFile: Awaited<ReturnType<typeof freshStores>>["importFile"],
    text: string,
    fileName = "import.json",
  ) {
    importFile.importFileText(text, fileName);
    const plan = importFile.pending.value!;
    importFile.applyImport(plan, acceptAll(plan));
    return plan;
  }

  it("routes an enveloped build export to the builds store", async () => {
    const { builds, storage, importFile } = await freshStores();
    const before = builds.builds.value.length;

    importAll(
      importFile,
      enveloped(
        "build",
        storage.defaultBuild("Exported build"),
        storage.SCHEMA_VERSION,
      ),
      "build.json",
    );

    expect(builds.builds.value.length).toBe(before + 1);
    expect(builds.build.value.name).toBe("Exported build");
  });

  it("routes an enveloped layer export to the layers store", async () => {
    const { layers, storage, importFile } = await freshStores();
    const before = layers.layers.value.length;

    importAll(
      importFile,
      enveloped(
        "layer",
        storage.defaultLayer("Shared layer"),
        storage.SCHEMA_VERSION,
      ),
      "layer.json",
    );

    expect(layers.layers.value.length).toBe(before + 1);
    expect(layers.layers.value.some((l) => l.name === "Shared layer")).toBe(
      true,
    );
  });

  it("holds every file at the picker rather than importing it outright", async () => {
    const { builds, layers, storage, importFile } = await freshStores();
    const buildsBefore = builds.builds.value.length;
    const layersBefore = layers.layers.value.length;

    importFile.importFileText(bundleText(storage), "nw-bundle.json");

    expect(builds.builds.value.length).toBe(buildsBefore);
    expect(layers.layers.value.length).toBe(layersBefore);
    expect(importFile.pending.value?.fileName).toBe("nw-bundle.json");
    expect(importFile.pending.value?.builds[0].name).toBe("Bundled build");
    expect(importFile.pending.value?.layers[0].name).toBe("Bundled layer");
  });

  it("recognises the same file imported twice as what is already here", async () => {
    const { storage, importFile } = await freshStores();
    const text = bundleText(storage);
    importAll(importFile, text, "nw-bundle.json");

    importFile.importFileText(text, "nw-bundle.json");

    const plan = importFile.pending.value!;
    expect(plan.builds[0].conflictName).toBe("Bundled build");
    expect(plan.layers[0].conflictName).toBe("Bundled layer");
  });

  it("writes what the picker settled on, and clears it", async () => {
    const { builds, layers, storage, importFile } = await freshStores();
    const buildsBefore = builds.builds.value.length;
    const layersBefore = layers.layers.value.length;
    importFile.importFileText(bundleText(storage), "nw-bundle.json");
    const plan = importFile.pending.value!;

    importFile.applyImport(plan, acceptAll(plan));

    expect(builds.builds.value.length).toBe(buildsBefore + 1);
    expect(layers.layers.value.length).toBe(layersBefore + 1);
    expect(builds.builds.value.some((b) => b.name === "Bundled build")).toBe(
      true,
    );
    expect(importFile.pending.value).toBeNull();
  });

  it("imports only the ticked rows", async () => {
    const { builds, layers, storage, importFile } = await freshStores();
    const layersBefore = layers.layers.value.length;
    importFile.importFileText(bundleText(storage), "nw-bundle.json");
    const plan = importFile.pending.value!;

    importFile.applyImport(plan, {
      builds: [{ selected: true, resolution: "new" }],
      layers: [{ selected: false, resolution: "new" }],
    });

    expect(builds.builds.value.some((b) => b.name === "Bundled build")).toBe(
      true,
    );
    expect(layers.layers.value.length).toBe(layersBefore);
  });

  it("replaces the build whose id an entry carries, trashing the old copy", async () => {
    const { builds, trash, storage, importFile } = await freshStores();
    const mine = builds.builds.value[0];
    const before = builds.builds.value.length;

    importFile.importFileText(
      enveloped(
        "build",
        { ...storage.defaultBuild("Newer"), id: mine.id },
        storage.SCHEMA_VERSION,
      ),
      "build.json",
    );
    const plan = importFile.pending.value!;
    expect(plan.builds[0].conflictName).toBe(mine.name);

    importFile.applyImport(plan, {
      builds: [{ selected: true, resolution: "replace" }],
      layers: [],
    });

    expect(builds.builds.value.length).toBe(before);
    expect(builds.get(mine.id)?.name).toBe("Newer");
    expect(trash.trashed.value[0].item.id).toBe(mine.id);
  });

  it("drops the landing screen's placeholder rather than importing beside it", async () => {
    const { builds, landing, storage, importFile } = await freshStores();
    landing.show();
    const placeholder = builds.build.value.id;

    importAll(
      importFile,
      enveloped(
        "build",
        storage.defaultBuild("Imported"),
        storage.SCHEMA_VERSION,
      ),
      "build.json",
    );

    expect(builds.builds.value.map((b) => b.name)).toEqual(["Imported"]);
    expect(builds.get(placeholder)).toBeUndefined();
  });

  it("keeps the placeholder when the file brings no builds of its own", async () => {
    const { builds, landing, storage, importFile } = await freshStores();
    landing.show();
    const placeholder = builds.build.value.id;

    importAll(
      importFile,
      enveloped(
        "layer",
        storage.defaultLayer("Just a layer"),
        storage.SCHEMA_VERSION,
      ),
      "layer.json",
    );

    expect(builds.get(placeholder)).toBeDefined();
  });

  it("cancelling drops the plan and imports nothing", async () => {
    const { builds, storage, importFile } = await freshStores();
    const before = builds.builds.value.length;
    importFile.importFileText(bundleText(storage), "nw-bundle.json");

    importFile.cancelImport();

    expect(importFile.pending.value).toBeNull();
    expect(builds.builds.value.length).toBe(before);
  });

  it("imports a bare catalog overlay as a layer named after the file", async () => {
    const { layers, importFile } = await freshStores();
    const overlay = {
      items: { itm_x: { id: "itm_x", name: "Custom item" } },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    };

    importAll(importFile, JSON.stringify(overlay), "catalog-overlay.json");

    const imported = layers.layers.value.find(
      (l) => l.name === "catalog-overlay",
    );
    expect(imported).toBeDefined();
    expect(imported!.overlay.items.itm_x).toBeDefined();
  });

  it("imports a pre-envelope build array", async () => {
    const { builds, storage, importFile } = await freshStores();
    const before = builds.builds.value.length;

    importAll(
      importFile,
      JSON.stringify([storage.defaultBuild("Legacy build")]),
      "legacy.json",
    );

    expect(builds.builds.value.length).toBe(before + 1);
    expect(builds.builds.value.some((b) => b.name === "Legacy build")).toBe(
      true,
    );
  });

  it("reports unparseable text instead of importing it", async () => {
    const { builds, notice, importFile } = await freshStores();
    const before = builds.builds.value.length;

    importFile.importFileText("not json at all", "junk.json");

    expect(importFile.pending.value).toBeNull();
    expect(builds.builds.value.length).toBe(before);
    expect(notice.notice.value).toMatch(/could not be read/i);
  });

  it("reports an envelope kind it does not know", async () => {
    const { builds, layers, notice, importFile } = await freshStores();
    const buildsBefore = builds.builds.value.length;
    const layersBefore = layers.layers.value.length;

    importFile.importFileText(enveloped("starship", { warp: 9 }), "weird.json");

    expect(importFile.pending.value).toBeNull();
    expect(builds.builds.value.length).toBe(buildsBefore);
    expect(layers.layers.value.length).toBe(layersBefore);
    expect(notice.notice.value).toMatch(/could not be read/i);
  });
});
