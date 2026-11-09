// Tests for stores/folders.ts: the nested grouping under the sidebar's Builds heading, and
// the way builds.ts's own mutations keep it consistent.
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
  const folders = await import("../../../src/stores/folders");
  const layers = await import("../../../src/stores/layers");
  const selection = await import("../../../src/stores/selection");
  const trash = await import("../../../src/stores/trash");
  builds._setLoading(false);
  layers._setLoading(false);
  const storage = await import("../../../src/storage/storage");
  // Every test starts from one "Build 1".
  builds.replaceActive(storage.defaultBuild("Build 1"));
  // Touching `build` guarantees the always-present "Build 1" exists before each test.
  void builds.build.value!;
  return { builds, folders, selection, trash };
}

const names = (list: { name: string }[]) => list.map((b) => b.name);

describe("folders store", () => {
  it("a new folder is an empty top-level row", async () => {
    const { builds, folders } = await freshStores();
    const id = folders.createFolder("Alts");

    expect(folders.byId(id)?.items).toEqual([]);
    expect(folders.orderedFolders.value.map((f) => f.name)).toEqual(["Alts"]);
    // An empty folder contributes no builds, so the flat list is untouched.
    expect(names(builds.builds.value)).toEqual(["Build 1"]);
  });

  it("placeBuild moves a build into a folder and back out to the top level", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild();
    const id = builds.build.value!.id;
    const folderId = folders.createFolder("Alts");

    folders.placeRow(id, folderId);
    expect(folders.parentOf(id)?.id).toBe(folderId);
    expect(folders.byId(folderId)?.items).toEqual([id]);

    folders.placeRow(id, null);
    expect(folders.parentOf(id)).toBeUndefined();
    expect(folders.byId(folderId)?.items).toEqual([]);
  });

  it("a build is never in two containers at once", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild();
    const id = builds.build.value!.id;
    const first = folders.createFolder("One");
    const second = folders.createFolder("Two");

    folders.placeRow(id, first);
    folders.placeRow(id, second);

    expect(folders.byId(first)?.items).toEqual([]);
    expect(folders.byId(second)?.items).toEqual([id]);
    expect(builds.builds.value.filter((b) => b.id === id)).toHaveLength(1);
  });

  it("the flat build list expands each folder in place", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild(); // Build 2
    builds.createBuild(); // Build 3
    const folderId = folders.createFolder("Alts");
    // Folder row sits last; move it to the front so ordering is actually observable.
    folders.placeRow(folderId, null, 0);
    folders.placeRow(builds.builds.value[1].id, folderId); // Build 2

    expect(names(builds.builds.value)).toEqual([
      "Build 2",
      "Build 1",
      "Build 3",
    ]);
    expect(builds.navEntries.value.map((e) => e.kind)).toEqual([
      "folder",
      "build",
      "build",
    ]);
  });

  it("dropping into a collapsed folder expands it", async () => {
    const { builds, folders } = await freshStores();
    const folderId = folders.createFolder("Alts", true);
    folders.placeRow(builds.build.value!.id, folderId);

    expect(folders.byId(folderId)?.collapsed).toBe(false);
  });

  it("deleting a folder keeps its builds, at the folder's own position", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild(); // Build 2
    builds.createBuild(); // Build 3
    const folderId = folders.createFolder("Alts");
    folders.placeRow(folderId, null, 1);
    folders.placeRow(builds.builds.value[2].id, folderId); // Build 3

    folders.deleteFolder(folderId);

    expect(folders.orderedFolders.value).toEqual([]);
    expect(names(builds.builds.value)).toEqual([
      "Build 1",
      "Build 3",
      "Build 2",
    ]);
  });

  it("moveFolder reorders folders among the top-level rows", async () => {
    const { folders } = await freshStores();
    const first = folders.createFolder("One");
    const second = folders.createFolder("Two");

    folders.moveRow(second, -1);
    expect(folders.orderedFolders.value.map((f) => f.id)).toEqual([
      second,
      first,
    ]);
  });

  it("toggleCollapsed flips the stored state", async () => {
    const { folders } = await freshStores();
    const id = folders.createFolder("Alts");
    folders.toggleCollapsed(id);
    expect(folders.byId(id)?.collapsed).toBe(true);
    folders.toggleCollapsed(id);
    expect(folders.byId(id)?.collapsed).toBe(false);
  });
});

describe("builds store with folders", () => {
  it("moveBuild stays inside the build's own folder", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild(); // Build 2
    builds.createBuild(); // Build 3
    const folderId = folders.createFolder("Alts");
    const second = builds.builds.value[1].id;
    const third = builds.builds.value[2].id;
    folders.placeRow(second, folderId);
    folders.placeRow(third, folderId);

    folders.moveRow(third, -1);
    expect(folders.byId(folderId)?.items).toEqual([third, second]);

    // Nudging past the top of the folder is a clamp, not an escape.
    folders.moveRow(third, -1);
    expect(folders.parentOf(third)?.id).toBe(folderId);
  });

  it("moveBuildTo can drop a build into a folder at a chosen index", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild(); // Build 2
    builds.createBuild(); // Build 3
    const folderId = folders.createFolder("Alts");
    const [first, second, third] = builds.builds.value.map((b) => b.id);
    folders.placeRow(second, folderId);
    folders.placeRow(third, folderId);

    folders.placeRow(first, folderId, 1);
    expect(folders.byId(folderId)?.items).toEqual([second, first, third]);
  });

  it("duplicating a build inside a folder keeps the copy next to it", async () => {
    const { builds, folders, selection } = await freshStores();
    const folderId = folders.createFolder("Alts");
    const id = builds.build.value!.id;
    folders.placeRow(id, folderId);
    selection.selectBuild(id);

    builds.duplicateBuild();

    const copyId = builds.build.value!.id;
    expect(folders.byId(folderId)?.items).toEqual([id, copyId]);
  });

  it("creating a build in a folder puts it there", async () => {
    const { builds, folders } = await freshStores();
    const folderId = folders.createFolder("Alts");

    builds.createBuild(folderId);

    expect(folders.byId(folderId)?.items).toEqual([builds.build.value!.id]);
  });

  it("deleting a build leaves no dangling id in its folder", async () => {
    const { builds, folders, trash } = await freshStores();
    builds.createBuild();
    const id = builds.build.value!.id;
    const folderId = folders.createFolder("Alts");
    folders.placeRow(id, folderId);

    builds.deleteBuild(id);

    expect(folders.byId(folderId)?.items).toEqual([]);
    expect(trash.trashed.value.some((e) => e.item.id === id)).toBe(true);
  });
});

describe("nested folders", () => {
  /** A chain of `count` folders, each inside the one before. Returns their ids, outermost
   *  first. */
  function chain(
    folders: Awaited<ReturnType<typeof freshStores>>["folders"],
    count: number,
  ) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++)
      ids.push(folders.createFolder(`F${i + 1}`, false, ids.at(-1) ?? null));
    return ids;
  }

  it("a folder moves into another, and the flat build list follows the tree", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild(); // Build 2
    const outer = folders.createFolder("Outer");
    const inner = folders.createFolder("Inner");
    folders.placeRow(builds.builds.value[1].id, inner);
    folders.placeRow(inner, null, 0);

    folders.placeRow(inner, outer);

    expect(folders.parentOf(inner)?.id).toBe(outer);
    expect(folders.depthOf(inner)).toBe(2);
    expect(folders.pathOf(builds.builds.value[1].id)).toBe("Outer / Inner");
    expect(names(builds.builds.value)).toEqual(["Build 1", "Build 2"]);
  });

  // The tree can never hold a cycle: a folder refuses itself and everything inside it.
  it("a folder cannot move into itself or its own subfolders", async () => {
    const { folders } = await freshStores();
    const [outer, inner] = chain(folders, 2);

    folders.placeRow(outer, outer);
    folders.placeRow(outer, inner);

    expect(folders.canPlace(outer, inner)).toBe(false);
    expect(folders.parentOf(outer)).toBeUndefined();
    expect(folders.parentOf(inner)?.id).toBe(outer);
  });

  it("nesting stops at the depth limit", async () => {
    const { folders } = await freshStores();
    const ids = chain(folders, folders.MAX_FOLDER_DEPTH);
    const deepest = ids.at(-1)!;
    expect(folders.depthOf(deepest)).toBe(folders.MAX_FOLDER_DEPTH);

    // No room for one more level below the deepest folder.
    expect(folders.canNestIn(deepest)).toBe(false);
    const extra = folders.createFolder("Extra", false, deepest);
    expect(folders.parentOf(extra)).toBeUndefined();
    folders.placeRow(extra, deepest);
    expect(folders.parentOf(extra)).toBeUndefined();

    // A two-level subtree does not fit where only one level is left.
    const pair = chain(folders, 2);
    expect(folders.canPlace(pair[0], ids.at(-2)!)).toBe(false);
    expect(folders.canPlace(pair[0], ids.at(-3)!)).toBe(true);
  });

  it("deleting a nested folder moves its contents into its parent, at its own spot", async () => {
    const { builds, folders } = await freshStores();
    const outer = folders.createFolder("Outer");
    builds.createBuild(outer); // Build 2
    const inner = folders.createFolder("Inner", false, outer);
    builds.createBuild(inner); // Build 3
    builds.createBuild(outer); // Build 4
    const [, second, third, fourth] = builds.builds.value.map((b) => b.id);

    folders.deleteFolder(inner);

    expect(folders.byId(outer)?.items).toEqual([second, third, fourth]);
  });

  it("moveRow nudges a folder inside its own parent", async () => {
    const { folders } = await freshStores();
    const outer = folders.createFolder("Outer");
    const a = folders.createFolder("A", false, outer);
    const b = folders.createFolder("B", false, outer);

    folders.moveRow(b, -1);
    expect(folders.byId(outer)?.items).toEqual([b, a]);
    // Past the top of its parent is a clamp, not an escape.
    folders.moveRow(b, -1);
    expect(folders.parentOf(b)?.id).toBe(outer);
  });

  it("moving a row into a collapsed nested folder opens it and every folder around it", async () => {
    const { builds, folders } = await freshStores();
    const [outer, inner] = chain(folders, 2);
    folders.setCollapsed(inner, true);
    folders.setCollapsed(outer, true);

    folders.placeRow(builds.build.value!.id, inner);

    expect(folders.byId(inner)?.collapsed).toBe(false);
    expect(folders.byId(outer)?.collapsed).toBe(false);
  });
});
