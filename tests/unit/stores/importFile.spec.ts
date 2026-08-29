// Tests for stores/importFile.ts: the header's Import button is the app's only file entry
// point, so every shape the app can hand out has to route to the right store from here.
import { describe, expect, it, vi } from "vitest";
import { installWindowShim } from "./window-shim";

async function freshStores() {
  vi.resetModules();
  installWindowShim();
  const builds = await import("../../../src/stores/builds");
  const layers = await import("../../../src/stores/layers");
  const notice = await import("../../../src/stores/notice");
  const storage = await import("../../../src/storage/storage");
  const importFile = await import("../../../src/stores/importFile");
  builds._setLoading(false);
  layers._setLoading(false);
  return { builds, layers, notice, storage, importFile };
}

/** An export envelope without `catalog`, so nothing reads as catalogue-stale. */
const enveloped = (kind: string, data: unknown, v = 1) =>
  JSON.stringify({ v, kind, data });

describe("importFile store", () => {
  it("routes an enveloped build export to the builds store", async () => {
    const { builds, storage, importFile } = await freshStores();
    const before = builds.builds.value.length;

    importFile.importFileText(
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

    importFile.importFileText(
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

  it("routes an enveloped bundle export to both stores", async () => {
    const { builds, layers, storage, importFile } = await freshStores();
    const buildsBefore = builds.builds.value.length;
    const layersBefore = layers.layers.value.length;

    importFile.importFileText(
      enveloped(
        "bundle",
        {
          builds: [storage.defaultBuild("Bundled build")],
          layers: [storage.defaultLayer("Bundled layer")],
        },
        storage.SCHEMA_VERSION,
      ),
      "nw-bundle.json",
    );

    expect(builds.builds.value.length).toBe(buildsBefore + 1);
    expect(layers.layers.value.length).toBe(layersBefore + 1);
    expect(builds.builds.value.some((b) => b.name === "Bundled build")).toBe(
      true,
    );
  });

  it("imports a bare catalog overlay as a layer named after the file", async () => {
    const { layers, importFile } = await freshStores();
    const overlay = {
      items: { itm_x: { id: "itm_x", name: "Custom item" } },
      bonuses: {},
      sectionPresets: {},
      slots: {},
    };

    importFile.importFileText(JSON.stringify(overlay), "catalog-overlay.json");

    const imported = layers.layers.value.find(
      (l) => l.name === "catalog-overlay",
    );
    expect(imported).toBeDefined();
    expect(imported!.overlay.items.itm_x).toBeDefined();
  });

  it("imports a pre-envelope build array", async () => {
    const { builds, storage, importFile } = await freshStores();
    const before = builds.builds.value.length;

    importFile.importFileText(
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

    expect(builds.builds.value.length).toBe(before);
    expect(notice.notice.value).toMatch(/could not be read/i);
  });

  it("reports an envelope kind it does not know", async () => {
    const { builds, layers, notice, importFile } = await freshStores();
    const buildsBefore = builds.builds.value.length;
    const layersBefore = layers.layers.value.length;

    importFile.importFileText(enveloped("starship", { warp: 9 }), "weird.json");

    expect(builds.builds.value.length).toBe(buildsBefore);
    expect(layers.layers.value.length).toBe(layersBefore);
    expect(notice.notice.value).toMatch(/could not be read/i);
  });
});
