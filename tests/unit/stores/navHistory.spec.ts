// Tests for stores/navHistory.ts and the workspace operations routed through it: every
// create/duplicate/delete/move/rename/enable on builds, layers and folders is one nav step
// whose undo and redo put the sidebar back exactly as it was.
import { describe, expect, it, vi } from "vitest";

async function freshStores() {
  vi.resetModules();
  // The stores get a fresh `storage/idb` from `resetModules`, so the shims are loaded after
  // it: a `setBackend` bound to this file's own import would land on the stale instance and
  // leave the stores reaching for an IndexedDB the node environment has not got.
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  installIdbShim();
  const builds = await import("../../../src/stores/builds");
  const buildEditor = await import("../../../src/stores/buildEditor");
  const folders = await import("../../../src/stores/folders");
  const history = await import("../../../src/stores/history");
  const layers = await import("../../../src/stores/layers");
  const navHistory = await import("../../../src/stores/navHistory");
  const selection = await import("../../../src/stores/selection");
  const trash = await import("../../../src/stores/trash");
  builds._setLoading(false);
  history._setLoading(false);
  layers._setLoading(false);
  // Touching `build` guarantees the always-present "Build 1" exists before each test.
  void builds.build.value;
  return {
    builds,
    buildEditor,
    folders,
    history,
    layers,
    navHistory,
    selection,
    trash,
  };
}

type Stores = Awaited<ReturnType<typeof freshStores>>;

const names = (list: { name: string }[]) => list.map((b) => b.name);

/** The sidebar as a list of names, folders spelled `Name[a, b]`. */
function tree({ builds }: Stores) {
  return builds.navEntries.value.map((entry) =>
    entry.kind === "folder"
      ? `${entry.folder.name}[${names(entry.builds).join(", ")}]`
      : entry.build.name,
  );
}

function trashedIds({ trash }: Stores) {
  return trash.trashed.value.map((entry) => entry.item.id);
}

describe("nav history stack", () => {
  it("starts empty and reports no labels", async () => {
    const { navHistory } = await freshStores();
    expect(navHistory.canUndo.value).toBe(false);
    expect(navHistory.canRedo.value).toBe(false);
    expect(navHistory.undoLabel.value).toBe("");
    expect(navHistory.redoLabel.value).toBe("");
    expect(navHistory.undo()).toBeUndefined();
    expect(navHistory.redo()).toBeUndefined();
  });

  it("labels read the step each direction would apply next", async () => {
    const s = await freshStores();
    const { builds, buildEditor, navHistory } = s;
    builds.createBuild();
    buildEditor.renameBuild("Warlock");
    expect(navHistory.undoLabel.value).toBe('rename build → "Warlock"');
    expect(navHistory.redoLabel.value).toBe("");

    navHistory.undo();
    expect(navHistory.undoLabel.value).toBe('create build "Build 2"');
    expect(navHistory.redoLabel.value).toBe('rename build → "Warlock"');

    navHistory.undo();
    expect(navHistory.undoLabel.value).toBe("");
    expect(navHistory.redoLabel.value).toBe('create build "Build 2"');
  });

  it("a new operation after an undo clears the redo stack", async () => {
    const s = await freshStores();
    const { builds, navHistory } = s;
    builds.createBuild();
    navHistory.undo();
    expect(navHistory.canRedo.value).toBe(true);

    builds.createBuild();
    expect(navHistory.canRedo.value).toBe(false);
    expect(navHistory.redoLabel.value).toBe("");
  });

  it("keeps the 50 most recent steps", async () => {
    const s = await freshStores();
    const { buildEditor, navHistory } = s;
    for (let i = 1; i <= 55; i++) buildEditor.renameBuild(`Name ${i}`);

    let undone = 0;
    while (navHistory.canUndo.value) {
      navHistory.undo();
      undone++;
    }
    expect(undone).toBe(50);
    // The five oldest steps fell off, so the name settles where step 6 started.
    expect(s.builds.build.value.name).toBe("Name 5");
  });

  it("undo and redo publish the row to focus", async () => {
    const s = await freshStores();
    const { builds, navHistory } = s;
    builds.createBuild();
    const id = builds.build.value.id;
    expect(navHistory.focusRequest.value).toBeNull();

    navHistory.undo();
    const afterUndo = navHistory.focusRequest.value;
    expect(afterUndo?.focusId).toBe(builds.build.value.id);

    expect(navHistory.redo()).toEqual({ focusId: id });
    expect(navHistory.focusRequest.value?.focusId).toBe(id);
    // A fresh request object each time, so a watcher fires on every step.
    expect(navHistory.focusRequest.value).not.toBe(afterUndo);
  });

  it("drops a step whose trash entry was purged instead of moving it to redo", async () => {
    const s = await freshStores();
    const { builds, navHistory, trash } = s;
    builds.createBuild();
    const id = builds.build.value.id;
    builds.deleteBuild(id);
    trash.purge(trash.trashed.value.find((entry) => entry.item.id === id)!);

    expect(navHistory.undoLabel.value).toBe('delete build "Build 2"');
    expect(navHistory.undo()).toBeUndefined();
    expect(navHistory.canRedo.value).toBe(false);
    expect(builds.builds.value.some((b) => b.id === id)).toBe(false);
    // The create step underneath is next, and it cannot apply either: the build is gone.
    expect(navHistory.undoLabel.value).toBe('create build "Build 2"');
    expect(navHistory.undo()).toBeUndefined();
    expect(navHistory.canUndo.value).toBe(false);
  });

  it("the trash UI's restore and an import record nothing", async () => {
    const s = await freshStores();
    const { builds, layers, navHistory, trash, folders } = s;
    builds.createBuild();
    const id = builds.build.value.id;
    builds.deleteBuild(id);
    const entry = trash.trashed.value.find((e) => e.item.id === id)!;
    const stepsBefore = navHistory.undoLabel.value;

    builds.importBuilds([trash.restore(entry) as never], false);
    layers.importLayerText(JSON.stringify(layers.createLayer("L")));
    folders.addFolder({
      id: "f-import",
      name: "In",
      collapsed: false,
      builds: [],
    });
    expect(navHistory.undoLabel.value).toBe('create layer "L"');
    navHistory.undo();
    expect(navHistory.undoLabel.value).toBe(stepsBefore);
  });
});

describe("nav history: builds", () => {
  it("create: undo sends the build to the trash, redo brings it back selected", async () => {
    const s = await freshStores();
    const { builds, navHistory, selection } = s;
    builds.createBuild();
    const id = builds.build.value.id;
    expect(tree(s)).toEqual(["Build 1", "Build 2"]);

    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1"]);
    expect(trashedIds(s)).toEqual([id]);
    expect(selection.selection.value?.id).not.toBe(id);

    navHistory.redo();
    expect(tree(s)).toEqual(["Build 1", "Build 2"]);
    expect(trashedIds(s)).toEqual([]);
    expect(selection.selection.value).toEqual({ kind: "build", id });
  });

  it("create inside a folder: redo puts the build back in that folder", async () => {
    const s = await freshStores();
    const { builds, folders, navHistory } = s;
    const folderId = folders.createFolder("Alts");
    builds.createBuild(folderId);
    expect(tree(s)).toEqual(["Build 1", "Alts[Build 2]"]);

    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1", "Alts[]"]);
    navHistory.redo();
    expect(tree(s)).toEqual(["Build 1", "Alts[Build 2]"]);
  });

  it("undo of create keeps what was edited into the build, in the trash", async () => {
    const s = await freshStores();
    const { builds, buildEditor, navHistory, trash } = s;
    builds.createBuild();
    const id = builds.build.value.id;
    buildEditor.setChoice("ring1", "ItemA");
    expect(navHistory.undoLabel.value).toBe('create build "Build 2"');

    navHistory.undo();
    const entry = trash.trashed.value.find((e) => e.item.id === id)!;
    expect(
      (entry.item as { choices: Record<string, string> }).choices.ring1,
    ).toBe("ItemA");

    navHistory.redo();
    expect(builds.build.value.choices.ring1).toBe("ItemA");
  });

  it("duplicate: undo trashes the copy, redo puts it back next to its source", async () => {
    const s = await freshStores();
    const { builds, navHistory } = s;
    builds.createBuild();
    builds.createBuild();
    s.selection.selectBuild(builds.builds.value[0].id);
    builds.duplicateBuild();
    expect(tree(s)).toEqual(["Build 1", "Build 1 copy", "Build 2", "Build 3"]);
    expect(navHistory.undoLabel.value).toBe('duplicate build "Build 1"');

    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1", "Build 2", "Build 3"]);
    navHistory.redo();
    expect(tree(s)).toEqual(["Build 1", "Build 1 copy", "Build 2", "Build 3"]);
  });

  it("delete: undo restores the build to its folder and position, redo trashes it again", async () => {
    const s = await freshStores();
    const { builds, folders, navHistory, selection } = s;
    const folderId = folders.createFolder("Alts");
    builds.createBuild(folderId);
    const id = builds.build.value.id;
    builds.createBuild(folderId);
    expect(tree(s)).toEqual(["Build 1", "Alts[Build 2, Build 3]"]);

    builds.deleteBuild(id);
    expect(tree(s)).toEqual(["Build 1", "Alts[Build 3]"]);
    expect(navHistory.undoLabel.value).toBe('delete build "Build 2"');

    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1", "Alts[Build 2, Build 3]"]);
    expect(trashedIds(s)).toEqual([]);
    expect(selection.selection.value).toEqual({ kind: "build", id });

    navHistory.redo();
    expect(tree(s)).toEqual(["Build 1", "Alts[Build 3]"]);
    expect(trashedIds(s)).toEqual([id]);
  });

  it("delete of the last build: undo brings it back beside the placeholder", async () => {
    const s = await freshStores();
    const { builds, navHistory } = s;
    const id = builds.build.value.id;
    builds.deleteBuild(id);
    expect(tree(s)).toEqual(["Build 1"]);
    expect(builds.build.value.id).not.toBe(id);

    navHistory.undo();
    expect(builds.builds.value.map((b) => b.id)).toContain(id);
    expect(builds.build.value.id).toBe(id);
  });

  it("delete of a build the undo cannot place in its folder falls back to the top level", async () => {
    const s = await freshStores();
    const { builds, folders, navHistory } = s;
    const folderId = folders.createFolder("Alts");
    builds.createBuild(folderId);
    const id = builds.build.value.id;
    builds.deleteBuild(id);
    // The grouping goes away without a recorded step, as a purge-like edge case would.
    folders.removeFolder(folderId);

    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1", "Build 2"]);
  });

  it("move up/down: undo and redo swap the rows back and forth", async () => {
    const s = await freshStores();
    const { builds, navHistory } = s;
    builds.createBuild();
    const id = builds.build.value.id;
    builds.moveBuild(id, -1);
    expect(tree(s)).toEqual(["Build 2", "Build 1"]);
    expect(navHistory.undoLabel.value).toBe("move build");

    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1", "Build 2"]);
    navHistory.redo();
    expect(tree(s)).toEqual(["Build 2", "Build 1"]);
  });

  it("move into a folder: undo returns the build to its top-level index", async () => {
    const s = await freshStores();
    const { builds, folders, navHistory, selection } = s;
    builds.createBuild();
    const id = builds.build.value.id;
    builds.createBuild();
    const folderId = folders.createFolder("Alts");
    expect(tree(s)).toEqual(["Build 1", "Build 2", "Build 3", "Alts[]"]);

    builds.moveBuildTo(id, 0, folderId);
    expect(tree(s)).toEqual(["Build 1", "Build 3", "Alts[Build 2]"]);

    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1", "Build 2", "Build 3", "Alts[]"]);
    expect(selection.selection.value).toEqual({ kind: "build", id });
    navHistory.redo();
    expect(tree(s)).toEqual(["Build 1", "Build 3", "Alts[Build 2]"]);
  });

  it("the Move to menu (placeBuild) is one step like any other move", async () => {
    const s = await freshStores();
    const { builds, folders, navHistory } = s;
    builds.createBuild();
    const id = builds.build.value.id;
    const folderId = folders.createFolder("Alts");
    const before = navHistory.undoLabel.value;

    folders.placeBuild(id, folderId);
    expect(tree(s)).toEqual(["Build 1", "Alts[Build 2]"]);
    expect(navHistory.undoLabel.value).toBe("move build");

    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1", "Build 2", "Alts[]"]);
    expect(navHistory.undoLabel.value).toBe(before);
  });

  it("a move that changes nothing records nothing", async () => {
    const s = await freshStores();
    const { builds, navHistory } = s;
    const id = builds.build.value.id;
    builds.moveBuild(id, -1);
    expect(navHistory.canUndo.value).toBe(false);
  });

  it("rename: undo restores the previous name, redo the new one", async () => {
    const s = await freshStores();
    const { builds, buildEditor, history, navHistory, selection } = s;
    builds.createBuild();
    const id = builds.build.value.id;
    buildEditor.renameBuild("Warlock");
    expect(builds.build.value.name).toBe("Warlock");
    expect(history.canUndo.value).toBe(false);

    selection.selectBuild(builds.builds.value[0].id);
    navHistory.undo();
    expect(builds.get(id)?.name).toBe("Build 2");
    expect(selection.selection.value).toEqual({ kind: "build", id });

    navHistory.redo();
    expect(builds.get(id)?.name).toBe("Warlock");
  });

  it("delete folder with its builds: one step, undone as a whole", async () => {
    const s = await freshStores();
    const { builds, folders, navHistory, trash } = s;
    const folderId = folders.createFolder("Alts");
    builds.createBuild(folderId);
    builds.createBuild(folderId);
    const ids = folders.byId(folderId)!.builds.slice();
    const before = navHistory.undoLabel.value;

    builds.deleteFolderWithBuilds(folderId);
    expect(tree(s)).toEqual(["Build 1"]);
    expect(trashedIds(s).sort()).toEqual(ids.slice().sort());
    expect(navHistory.undoLabel.value).toBe('delete folder "Alts"');

    expect(navHistory.undo()).toEqual({ focusId: folderId });
    expect(tree(s)).toEqual(["Build 1", "Alts[Build 2, Build 3]"]);
    expect(trash.trashed.value).toEqual([]);
    expect(navHistory.undoLabel.value).toBe(before);

    navHistory.redo();
    expect(tree(s)).toEqual(["Build 1"]);
    expect(trashedIds(s).sort()).toEqual(ids.slice().sort());
  });

  it("delete folder with its builds: undo puts back whatever the trash still holds", async () => {
    const s = await freshStores();
    const { builds, folders, navHistory, trash } = s;
    const folderId = folders.createFolder("Alts");
    builds.createBuild(folderId);
    const purgedId = builds.build.value.id;
    builds.createBuild(folderId);

    builds.deleteFolderWithBuilds(folderId);
    trash.purge(trash.trashed.value.find((e) => e.item.id === purgedId)!);

    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1", "Alts[Build 3]"]);
  });
});

describe("nav history: layers", () => {
  it("create: undo trashes the layer, redo restores it selected", async () => {
    const s = await freshStores();
    const { layers, navHistory, selection } = s;
    const layer = layers.createLayer();
    expect(navHistory.undoLabel.value).toBe('create layer "Layer 1"');

    navHistory.undo();
    expect(layers.layers.value).toEqual([]);
    expect(trashedIds(s)).toEqual([layer.id]);

    navHistory.redo();
    expect(names(layers.layers.value)).toEqual(["Layer 1"]);
    expect(trashedIds(s)).toEqual([]);
    expect(selection.selection.value).toEqual({ kind: "layer", id: layer.id });
  });

  it("duplicate: undo trashes the copy, redo puts it back", async () => {
    const s = await freshStores();
    const { layers, navHistory } = s;
    const source = layers.createLayer("A");
    layers.duplicateLayer(source.id);
    expect(names(layers.layers.value)).toEqual(["A", "A copy"]);
    expect(navHistory.undoLabel.value).toBe('duplicate layer "A"');

    navHistory.undo();
    expect(names(layers.layers.value)).toEqual(["A"]);
    navHistory.redo();
    expect(names(layers.layers.value)).toEqual(["A", "A copy"]);
  });

  it("delete: undo restores the layer at its old fold index, redo trashes it again", async () => {
    const s = await freshStores();
    const { layers, navHistory, selection } = s;
    layers.createLayer("A");
    const middle = layers.createLayer("B");
    layers.createLayer("C");

    layers.deleteLayer(middle.id);
    expect(names(layers.layers.value)).toEqual(["A", "C"]);
    expect(navHistory.undoLabel.value).toBe('delete layer "B"');

    navHistory.undo();
    expect(names(layers.layers.value)).toEqual(["A", "B", "C"]);
    expect(trashedIds(s)).toEqual([]);
    expect(selection.selection.value).toEqual({
      kind: "layer",
      id: middle.id,
    });

    navHistory.redo();
    expect(names(layers.layers.value)).toEqual(["A", "C"]);
    expect(trashedIds(s)).toEqual([middle.id]);
  });

  it("move up/down: undo and redo swap the rows back and forth", async () => {
    const s = await freshStores();
    const { layers, navHistory } = s;
    layers.createLayer("A");
    const b = layers.createLayer("B");
    await layers.moveLayer(b.id, -1);
    expect(names(layers.layers.value)).toEqual(["B", "A"]);
    expect(navHistory.undoLabel.value).toBe("move layer");

    navHistory.undo();
    expect(names(layers.layers.value)).toEqual(["A", "B"]);
    navHistory.redo();
    expect(names(layers.layers.value)).toEqual(["B", "A"]);
  });

  it("moveLayerTo (drag and drop): undo returns the layer to its old index", async () => {
    const s = await freshStores();
    const { layers, navHistory } = s;
    const a = layers.createLayer("A");
    layers.createLayer("B");
    layers.createLayer("C");
    await layers.moveLayerTo(a.id, 3);
    expect(names(layers.layers.value)).toEqual(["B", "C", "A"]);

    navHistory.undo();
    expect(names(layers.layers.value)).toEqual(["A", "B", "C"]);
    navHistory.redo();
    expect(names(layers.layers.value)).toEqual(["B", "C", "A"]);
  });

  it("rename: undo restores the previous name and is not a content edit", async () => {
    const s = await freshStores();
    const { history, layers, navHistory } = s;
    const layer = layers.createLayer("A");
    layers.renameLayer(layer.id, "Alpha");
    expect(layer.name).toBe("Alpha");
    expect(history.canUndo.value).toBe(false);
    expect(navHistory.undoLabel.value).toBe('rename layer → "Alpha"');

    navHistory.undo();
    expect(layers.layers.value[0].name).toBe("A");
    navHistory.redo();
    expect(layers.layers.value[0].name).toBe("Alpha");
  });

  it("enable/disable: undo flips the flag back and is not a content edit", async () => {
    const s = await freshStores();
    const { history, layers, navHistory } = s;
    const layer = layers.createLayer("A");
    layers.setLayerEnabled(layer.id, false);
    expect(layer.enabled).toBe(false);
    expect(history.canUndo.value).toBe(false);
    expect(navHistory.undoLabel.value).toBe('disable layer "A"');

    navHistory.undo();
    expect(layers.layers.value[0].enabled).toBe(true);
    navHistory.redo();
    expect(layers.layers.value[0].enabled).toBe(false);

    layers.setLayerEnabled(layer.id, false);
    expect(navHistory.undoLabel.value).toBe('disable layer "A"');
    layers.setLayerEnabled(layer.id, true);
    expect(navHistory.undoLabel.value).toBe('enable layer "A"');
  });
});

describe("nav history: folders", () => {
  it("create: undo removes the folder, redo recreates it under the same id", async () => {
    const s = await freshStores();
    const { folders, navHistory } = s;
    const id = folders.createFolder("Alts");
    expect(navHistory.undoLabel.value).toBe('create folder "Alts"');

    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1"]);
    expect(folders.byId(id)).toBeUndefined();

    expect(navHistory.redo()).toEqual({ focusId: id });
    expect(tree(s)).toEqual(["Build 1", "Alts[]"]);
    expect(folders.byId(id)?.name).toBe("Alts");
  });

  it("undo of create frees the builds moved in to the top level", async () => {
    const s = await freshStores();
    const { builds, folders, navHistory } = s;
    const id = folders.createFolder("Alts");
    builds.createBuild(id);
    // Steps undo in order: the build's creation first, then the folder's.
    navHistory.undo();
    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1"]);
    expect(folders.byId(id)).toBeUndefined();
  });

  it("rename: undo restores the previous name, redo the new one", async () => {
    const s = await freshStores();
    const { folders, navHistory } = s;
    const id = folders.createFolder("Alts");
    folders.renameFolder(id, "  Mains ");
    expect(folders.byId(id)?.name).toBe("Mains");
    expect(navHistory.undoLabel.value).toBe('rename folder → "Mains"');

    expect(navHistory.undo()).toEqual({ focusId: id });
    expect(folders.byId(id)?.name).toBe("Alts");
    navHistory.redo();
    expect(folders.byId(id)?.name).toBe("Mains");
  });

  it("delete: undo recreates the folder with its builds, position and collapsed state", async () => {
    const s = await freshStores();
    const { builds, folders, navHistory } = s;
    const id = folders.createFolder("Alts", true);
    builds.createBuild(id);
    builds.createBuild(id);
    builds.createBuild();
    expect(tree(s)).toEqual(["Build 1", "Alts[Build 2, Build 3]", "Build 4"]);

    folders.deleteFolder(id);
    expect(tree(s)).toEqual(["Build 1", "Build 2", "Build 3", "Build 4"]);
    expect(navHistory.undoLabel.value).toBe('delete folder "Alts"');

    expect(navHistory.undo()).toEqual({ focusId: id });
    expect(tree(s)).toEqual(["Build 1", "Alts[Build 2, Build 3]", "Build 4"]);
    expect(folders.byId(id)?.collapsed).toBe(true);

    expect(navHistory.redo()).toEqual({ focusId: null });
    expect(tree(s)).toEqual(["Build 1", "Build 2", "Build 3", "Build 4"]);
  });

  it("move up/down and moveFolderTo: undo returns the folder to its old row", async () => {
    const s = await freshStores();
    const { builds, folders, navHistory } = s;
    builds.createBuild();
    const id = folders.createFolder("Alts");
    expect(tree(s)).toEqual(["Build 1", "Build 2", "Alts[]"]);

    folders.moveFolder(id, -1);
    expect(tree(s)).toEqual(["Build 1", "Alts[]", "Build 2"]);
    expect(navHistory.undoLabel.value).toBe("move folder");
    expect(navHistory.undo()).toEqual({ focusId: id });
    expect(tree(s)).toEqual(["Build 1", "Build 2", "Alts[]"]);
    navHistory.redo();
    expect(tree(s)).toEqual(["Build 1", "Alts[]", "Build 2"]);

    folders.moveFolderTo(id, 0);
    expect(tree(s)).toEqual(["Alts[]", "Build 1", "Build 2"]);
    navHistory.undo();
    expect(tree(s)).toEqual(["Build 1", "Alts[]", "Build 2"]);
  });
});
