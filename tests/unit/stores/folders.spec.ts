// Tests for stores/folders.ts: the one-level-deep grouping under the sidebar's Builds
// heading, and the way builds.ts's own mutations keep it consistent.
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
  // Touching `build` guarantees the always-present "Build 1" exists before each test.
  void builds.build.value;
  return { builds, folders, selection, trash };
}

const names = (list: { name: string }[]) => list.map((b) => b.name);

describe("folders store", () => {
  it("a new folder is an empty top-level row", async () => {
    const { builds, folders } = await freshStores();
    const id = folders.createFolder("Alts");

    expect(folders.byId(id)?.builds).toEqual([]);
    expect(folders.orderedFolders.value.map((f) => f.name)).toEqual(["Alts"]);
    // An empty folder contributes no builds, so the flat list is untouched.
    expect(names(builds.builds.value)).toEqual(["Build 1"]);
  });

  it("placeBuild moves a build into a folder and back out to the top level", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild();
    const id = builds.build.value.id;
    const folderId = folders.createFolder("Alts");

    folders.placeBuild(id, folderId);
    expect(folders.folderOf(id)?.id).toBe(folderId);
    expect(folders.byId(folderId)?.builds).toEqual([id]);

    folders.placeBuild(id, null);
    expect(folders.folderOf(id)).toBeUndefined();
    expect(folders.byId(folderId)?.builds).toEqual([]);
  });

  it("a build is never in two containers at once", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild();
    const id = builds.build.value.id;
    const first = folders.createFolder("One");
    const second = folders.createFolder("Two");

    folders.placeBuild(id, first);
    folders.placeBuild(id, second);

    expect(folders.byId(first)?.builds).toEqual([]);
    expect(folders.byId(second)?.builds).toEqual([id]);
    expect(builds.builds.value.filter((b) => b.id === id)).toHaveLength(1);
  });

  it("the flat build list expands each folder in place", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild(); // Build 2
    builds.createBuild(); // Build 3
    const folderId = folders.createFolder("Alts");
    // Folder row sits last; move it to the front so ordering is actually observable.
    folders.moveFolderTo(folderId, 0);
    folders.placeBuild(builds.builds.value[1].id, folderId); // Build 2

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
    folders.placeBuild(builds.build.value.id, folderId);

    expect(folders.byId(folderId)?.collapsed).toBe(false);
  });

  it("deleting a folder keeps its builds, at the folder's own position", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild(); // Build 2
    builds.createBuild(); // Build 3
    const folderId = folders.createFolder("Alts");
    folders.moveFolderTo(folderId, 1);
    folders.placeBuild(builds.builds.value[2].id, folderId); // Build 3

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

    folders.moveFolder(second, -1);
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
    folders.placeBuild(second, folderId);
    folders.placeBuild(third, folderId);

    builds.moveBuild(third, -1);
    expect(folders.byId(folderId)?.builds).toEqual([third, second]);

    // Nudging past the top of the folder is a clamp, not an escape.
    builds.moveBuild(third, -1);
    expect(folders.folderOf(third)?.id).toBe(folderId);
  });

  it("moveBuildTo can drop a build into a folder at a chosen index", async () => {
    const { builds, folders } = await freshStores();
    builds.createBuild(); // Build 2
    builds.createBuild(); // Build 3
    const folderId = folders.createFolder("Alts");
    const [first, second, third] = builds.builds.value.map((b) => b.id);
    folders.placeBuild(second, folderId);
    folders.placeBuild(third, folderId);

    builds.moveBuildTo(first, 1, folderId);
    expect(folders.byId(folderId)?.builds).toEqual([second, first, third]);
  });

  it("duplicating a build inside a folder keeps the copy next to it", async () => {
    const { builds, folders, selection } = await freshStores();
    const folderId = folders.createFolder("Alts");
    const id = builds.build.value.id;
    folders.placeBuild(id, folderId);
    selection.selectBuild(id);

    builds.duplicateBuild();

    const copyId = builds.build.value.id;
    expect(folders.byId(folderId)?.builds).toEqual([id, copyId]);
  });

  it("creating a build in a folder puts it there", async () => {
    const { builds, folders } = await freshStores();
    const folderId = folders.createFolder("Alts");

    builds.createBuild(folderId);

    expect(folders.byId(folderId)?.builds).toEqual([builds.build.value.id]);
  });

  it("deleting a build leaves no dangling id in its folder", async () => {
    const { builds, folders, trash } = await freshStores();
    builds.createBuild();
    const id = builds.build.value.id;
    const folderId = folders.createFolder("Alts");
    folders.placeBuild(id, folderId);

    builds.deleteBuild(id);

    expect(folders.byId(folderId)?.builds).toEqual([]);
    expect(trash.trashed.value.some((e) => e.item.id === id)).toBe(true);
  });
});
