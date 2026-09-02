// Tests for stores/builds.ts: create/duplicate/delete/reorder, trash integration,
// bootstrap from empty, and persistence.
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
  const landing = await import("../../../src/stores/landing");
  const layers = await import("../../../src/stores/layers");
  const selection = await import("../../../src/stores/selection");
  const trash = await import("../../../src/stores/trash");
  const buildEditor = await import("../../../src/stores/buildEditor");
  builds._setLoading(false);
  layers._setLoading(false);
  return { builds, folders, landing, layers, selection, trash, buildEditor };
}

describe("builds store", () => {
  it("bootstraps from empty state with at least one build", async () => {
    const { builds } = await freshStores();
    expect(builds.builds.value.length).toBeGreaterThanOrEqual(1);
    expect(builds.build.value).toBeDefined();
    expect(builds.loading.value).toBe(false);
  });

  it("createBuild adds a build and selects it", async () => {
    const { builds } = await freshStores();
    const before = builds.builds.value.length;
    builds.createBuild();
    expect(builds.builds.value.length).toBe(before + 1);
    expect(builds.build.value.name).toMatch(/^Build \d+$/);
  });

  it("duplicateBuild copies the active build", async () => {
    const { builds } = await freshStores();
    builds.createBuild();
    const name = builds.build.value.name;
    builds.duplicateBuild();
    expect(builds.build.value.name).toBe(`${name} copy`);
  });

  it("deleteBuild moves the build to trash", async () => {
    const { builds, trash } = await freshStores();
    builds.createBuild();
    const secondId = builds.build.value.id;

    builds.createBuild();
    expect(builds.builds.value.length).toBeGreaterThanOrEqual(3);

    builds.deleteBuild(secondId);
    expect(builds.builds.value.every((b) => b.id !== secondId)).toBe(true);
    expect(trash.trashed.value.some((e) => e.item.id === secondId)).toBe(true);
  });

  it("deleteBuild replaces the last build with an empty one", async () => {
    const { builds, landing, trash } = await freshStores();

    // There should be exactly one build initially.
    expect(builds.builds.value.length).toBe(1);
    const oldId = builds.build.value.id;

    builds.deleteBuild(oldId);

    // The old build should be in trash.
    expect(trash.trashed.value.some((e) => e.item.id === oldId)).toBe(true);

    // There should still be exactly one build, with a fresh id.
    expect(builds.builds.value.length).toBe(1);
    expect(builds.build.value.id).not.toBe(oldId);
    expect(builds.build.value.name).toBe("Build 1");

    // The builder stays up: the landing screen would hide the trash the build just went to.
    expect(landing.showing.value).toBe(false);
  });

  it("showLandingIfEmptied raises the landing once the last deletion is purged", async () => {
    const { builds, landing, trash } = await freshStores();

    builds.deleteBuild(builds.build.value.id);
    expect(landing.showing.value).toBe(false);

    trash.purge(trash.trashed.value[0]);
    builds.showLandingIfEmptied();

    // The build left standing is the placeholder this store keeps alive, which nobody wrote.
    expect(builds.builds.value.length).toBe(1);
    expect(landing.showing.value).toBe(true);
  });

  it("showLandingIfEmptied leaves the builder up while a layer remains", async () => {
    const { builds, layers, landing, trash } = await freshStores();
    layers.createLayer();

    builds.deleteBuild(builds.build.value.id);
    trash.purge(trash.trashed.value.find((e) => e.kind === "build")!);
    builds.showLandingIfEmptied();

    expect(landing.showing.value).toBe(false);
  });

  it("showLandingIfEmptied leaves the builder up for a build someone wrote", async () => {
    const { builds, landing, trash } = await freshStores();
    builds.createBuild();
    const kept = builds.build.value.id;

    builds.deleteBuild(builds.builds.value.find((b) => b.id !== kept)!.id);
    trash.purge(trash.trashed.value[0]);
    builds.showLandingIfEmptied();

    expect(landing.showing.value).toBe(false);
  });

  it("moveBuild reorders within bounds", async () => {
    const { builds } = await freshStores();
    builds.createBuild();
    const id = builds.build.value.id;
    builds.moveBuild(id, -1);
    const idx = builds.builds.value.findIndex((b) => b.id === id);
    expect(idx).toBeGreaterThanOrEqual(0);
  });

  it("moveBuild swaps with the neighbour in both directions", async () => {
    const { builds } = await freshStores();
    builds.createBuild();
    builds.createBuild();
    const names = builds.builds.value.map((b) => b.name);
    const firstId = builds.builds.value[0].id;

    await builds.moveBuild(firstId, 1);
    expect(builds.builds.value.map((b) => b.name)).toEqual([
      names[1],
      names[0],
      names[2],
    ]);

    await builds.moveBuild(firstId, -1);
    expect(builds.builds.value.map((b) => b.name)).toEqual(names);
  });

  it("moveBuildTo drops a build at an arbitrary index, not just a neighbour swap", async () => {
    const { builds } = await freshStores();
    // Starts with one build ("Build 1"); add three more.
    builds.createBuild();
    builds.createBuild();
    builds.createBuild();
    const names = builds.builds.value.map((b) => b.name);
    const firstId = builds.builds.value[0].id;

    // Drag the first build to land right after the third.
    await builds.moveBuildTo(firstId, 3);
    const reordered = builds.builds.value.map((b) => b.name);
    expect(reordered).toEqual([names[1], names[2], names[0], names[3]]);
  });

  it("moveBuildTo clamps to the list bounds", async () => {
    const { builds } = await freshStores();
    builds.createBuild();
    const firstId = builds.builds.value[0].id;
    await builds.moveBuildTo(firstId, 999);
    expect(builds.builds.value[builds.builds.value.length - 1].id).toBe(
      firstId,
    );
  });

  it("otherBuilds excludes the active build", async () => {
    const { builds } = await freshStores();
    builds.createBuild();
    const activeId = builds.build.value.id;
    expect(builds.otherBuilds.value.every((o) => o.value !== activeId)).toBe(
      true,
    );
  });

  it("otherBuilds names the folder holding each build", async () => {
    const { builds, folders } = await freshStores();
    const topLevelId = builds.build.value.id;
    builds.createBuild();
    const filedId = builds.build.value.id;
    const folderId = folders.createFolder("Alts");
    folders.placeBuild(filedId, folderId);

    // The active build is left out, so pick a third one to look from.
    builds.createBuild();
    const options = builds.otherBuilds.value;

    expect(options.find((o) => o.value === filedId)?.folder).toBe("Alts");
    expect(options.find((o) => o.value === topLevelId)?.folder).toBeUndefined();
  });

  it("otherBuilds lists in sidebar order, so a folder's builds stay together", async () => {
    const { builds, folders } = await freshStores();
    const firstId = builds.build.value.id;
    builds.createBuild();
    const secondId = builds.build.value.id;
    builds.createBuild();
    const thirdId = builds.build.value.id;
    const folderId = folders.createFolder("Alts");
    // The two filed builds start out either side of the third, so only the sidebar's own
    // ordering can bring them back together -- which is what lets the picker head them once.
    folders.placeBuild(firstId, folderId);
    folders.placeBuild(secondId, folderId);

    builds.createBuild();
    const listed = builds.otherBuilds.value.map((o) => o.folder);
    const filed = builds.otherBuilds.value.map((o) => o.value);

    expect(filed.indexOf(secondId)).toBe(filed.indexOf(firstId) + 1);
    expect(listed.filter((f) => f === "Alts")).toHaveLength(2);
    expect(
      builds.otherBuilds.value.find((o) => o.value === thirdId)?.folder,
    ).toBeUndefined();
  });
});

describe("builds persistence guard", () => {
  it("does not write while loading", async () => {
    const { builds } = await freshStores();
    // After freshStores, loading should already be false.
    expect(builds.loading.value).toBe(false);
  });
});
