// Reset, the two reverts and a preset overwrite act without confirming and post an undo notice
// instead. The reverts and the preset overwrite are not reachable with Ctrl+Z from where they
// are triggered, so the notice is the only way back.
import { describe, expect, it, vi } from "vitest";
import type {
  CatalogOverlay,
  LayerSnapshot,
  SectionPreset,
} from "../../../src/types";

async function freshStores() {
  vi.resetModules();
  // The stores get a fresh `storage/idb` from `resetModules`, so the shims load after it.
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  installIdbShim();
  const builds = await import("../../../src/stores/builds");
  const buildEditor = await import("../../../src/stores/buildEditor");
  const history = await import("../../../src/stores/history");
  const layers = await import("../../../src/stores/layers");
  const notice = await import("../../../src/stores/notice");
  const layerEditor = await import("../../../src/stores/layerEditor");
  const selection = await import("../../../src/stores/selection");
  const resolved = await import("../../../src/stores/resolved");
  builds._setLoading(false);
  history._setLoading(false);
  layers._setLoading(false);
  const storage = await import("../../../src/storage/storage");
  // Every test starts from one "Build 1".
  builds.replaceActive(storage.defaultBuild("Build 1"));
  return {
    builds,
    buildEditor,
    history,
    layers,
    notice,
    layerEditor,
    selection,
    resolved,
  };
}

const emptyOverlay = (): CatalogOverlay => ({
  items: {},
  bonuses: {},
  sectionPresets: {},
  slots: {},
  sections: {},
  filters: {},
});

const preset = (fields: Partial<SectionPreset> = {}): SectionPreset => ({
  id: "p1",
  label: "P1",
  section: "options",
  params: { "options.role": "dps" },
  ...fields,
});

describe("undo notices", () => {
  it("resetting a build offers a notice that puts its choices back", async () => {
    const { builds, buildEditor, notice } = await freshStores();
    const before = builds.build.value!;
    builds.replaceActive({
      ...before,
      choices: { ...before.choices, "gear.head": "i_head" },
    });

    buildEditor.resetAll();
    expect(builds.build.value!.choices["gear.head"]).toBeUndefined();

    expect(notice.noticeAction.value?.label).toBe("Undo");
    notice.noticeAction.value?.run();

    expect(builds.build.value!.choices["gear.head"]).toBe("i_head");
    expect(notice.noticeAction.value).toBeNull();
  });

  it("reverting a build offers a notice that brings the newer state back", async () => {
    const { builds, notice } = await freshStores();
    const downloaded = builds.build.value!;
    builds.replaceActive({
      ...downloaded,
      choices: { ...downloaded.choices, "gear.head": "i_head" },
      downloaded: { at: Date.now(), snapshot: downloaded },
    });

    builds.revertToDownloaded(downloaded.id);
    expect(builds.build.value!.choices["gear.head"]).toBeUndefined();

    expect(notice.noticeAction.value?.label).toBe("Undo");
    notice.noticeAction.value?.run();

    expect(builds.build.value!.choices["gear.head"]).toBe("i_head");
    expect(notice.noticeAction.value).toBeNull();
  });

  it("reverting a layer offers a notice that brings its overlay back", async () => {
    const { layers, notice } = await freshStores();
    const layer = layers.createLayer("Reverted");
    // Nothing in the stores stamps `downloaded`; it arrives with a download or an import.
    const snapshot: LayerSnapshot = { ...layer, overlay: emptyOverlay() };
    const overlay = emptyOverlay();
    overlay.sectionPresets = { p1: preset() };
    layers.updateOverlay(layer.id, overlay);
    layer.downloaded = { at: Date.now(), snapshot };

    layers.revertToDownloaded(layer.id);
    const reverted = layers.layers.value.find((l) => l.id === layer.id);
    expect(reverted?.overlay.sectionPresets.p1).toBeUndefined();

    expect(notice.noticeAction.value?.label).toBe("Undo");
    notice.noticeAction.value?.run();

    expect(
      layers.layers.value.find((l) => l.id === layer.id)?.overlay.sectionPresets
        .p1,
    ).toEqual(preset());
    expect(notice.noticeAction.value).toBeNull();
  });

  // The revert sits on the same stack as overlay edits, so Ctrl+Z on the selected layer must
  // take it back as a whole layer, not write the layer into its own overlay.
  it("Ctrl+Z after reverting a layer brings its overlay back, and redo reverts again", async () => {
    const { layers, layerEditor, selection } = await freshStores();
    const layer = layers.createLayer("Reverted");
    const snapshot: LayerSnapshot = { ...layer, overlay: emptyOverlay() };
    const overlay = emptyOverlay();
    overlay.sectionPresets = { p1: preset() };
    layers.updateOverlay(layer.id, overlay);
    layer.downloaded = { at: Date.now(), snapshot };
    selection.selectLayer(layer.id);
    const current = () => layers.layers.value.find((l) => l.id === layer.id)!;

    layers.revertToDownloaded(layer.id);
    layerEditor.undo();
    expect(current().overlay.sectionPresets.p1).toEqual(preset());

    layerEditor.redo();
    expect(current().overlay.sectionPresets).toEqual({});
  });

  it("overwriting a preset offers a notice that restores its old contents", async () => {
    const { layers, notice } = await freshStores();
    const owner = layers.createLayer("Owner");
    const overlay = emptyOverlay();
    overlay.sectionPresets = { p1: preset() };
    layers.updateOverlay(owner.id, overlay);

    layers.updatePreset(preset({ params: { "options.role": "tank" } }));
    expect(owner.overlay.sectionPresets.p1?.params).toEqual({
      "options.role": "tank",
    });

    expect(notice.noticeAction.value?.label).toBe("Undo");
    notice.noticeAction.value?.run();

    expect(owner.overlay.sectionPresets.p1?.params).toEqual({
      "options.role": "dps",
    });
    expect(notice.noticeAction.value).toBeNull();
  });

  // Copying a section into several builds is one action, so one Undo must take it back from
  // all of them, and leave the user on the build they copied from.
  it("copying a section to other builds offers one undo for all of them", async () => {
    const { builds, buildEditor, notice, resolved, selection } =
      await freshStores();
    const slot = resolved.db.value.slots.find(
      (candidate) => candidate.type === "item_picker",
    )!;
    const storage = await import("../../../src/storage/storage");
    const first = storage.defaultBuild("Target 1");
    const second = storage.defaultBuild("Target 2");
    first.choices[slot.id] = "Before";
    builds.replaceActive(first);
    builds.replaceActive(second);
    const source = storage.defaultBuild("Source");
    builds.replaceActive(source);
    buildEditor.setChoice(slot.id, "Copied");

    buildEditor.copySectionTo([first.id, second.id], [slot.section], "Gear");

    expect(builds.get(first.id)!.choices[slot.id]).toBe("Copied");
    expect(builds.get(second.id)!.choices[slot.id]).toBe("Copied");
    expect(notice.notice.value).toContain("2 builds");

    notice.noticeAction.value!.run();

    expect(builds.get(first.id)!.choices[slot.id]).toBe("Before");
    expect(builds.get(second.id)!.choices[slot.id]).toBeUndefined();
    expect(builds.get(source.id)!.choices[slot.id]).toBe("Copied");
    expect(selection.selection.value).toEqual({
      kind: "build",
      id: source.id,
    });
  });
});
