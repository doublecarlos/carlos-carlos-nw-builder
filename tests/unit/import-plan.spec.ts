// Tests for lib/import-plan.ts: what a file offers against the workspace as it stands, and
// the ids, names and cross-references that come out of the user's ticks.
import { describe, expect, it } from "vitest";
import {
  acceptAll,
  buildPlan,
  conflictCount,
  resolveImport,
  type EntryDecision,
  type ImportPlan,
  type ParsedFile,
} from "../../src/lib/import-plan";
import * as storage from "../../src/storage/storage";
import type { Build, Layer } from "../../src/types";

const parsed = (over: Partial<ParsedFile> = {}): ParsedFile => ({
  fileName: "import.json",
  builds: [],
  layers: [],
  catalogStale: false,
  ...over,
});

const plan = (
  over: Partial<ParsedFile> = {},
  existing = { builds: [] as Build[], layers: [] as Layer[] },
) => buildPlan(parsed(over), existing);

const decide = (
  target: ImportPlan,
  over: Partial<{ builds: EntryDecision[]; layers: EntryDecision[] }> = {},
) => ({ ...acceptAll(target), ...over });

const resolve = (
  target: ImportPlan,
  over: Partial<{ builds: EntryDecision[]; layers: EntryDecision[] }> = {},
  workspace: { buildIds?: string[]; usedIds?: string[] } = {},
) =>
  resolveImport(target, decide(target, over), {
    buildIds: new Set(workspace.buildIds ?? []),
    usedIds: new Set(workspace.usedIds ?? workspace.buildIds ?? []),
  });

describe("buildPlan", () => {
  it("flags an entry whose id the workspace already uses, by that one's name", () => {
    const mine = storage.defaultBuild("Mine");
    const incoming = { ...storage.defaultBuild("Theirs"), id: mine.id };

    const result = plan({ builds: [incoming] }, { builds: [mine], layers: [] });

    expect(result.builds[0].conflictName).toBe("Mine");
    expect(conflictCount(result)).toBe(1);
  });

  it("leaves an entry with an id of its own unflagged", () => {
    const result = plan(
      { builds: [storage.defaultBuild("Theirs")] },
      { builds: [storage.defaultBuild("Mine")], layers: [] },
    );

    expect(result.builds[0].conflictName).toBeUndefined();
    expect(conflictCount(result)).toBe(0);
  });

  it("names the folder a build was grouped under", () => {
    const build = storage.defaultBuild("Grouped");
    const result = plan({
      builds: [build],
      folders: [
        { id: "f_1", name: "Alts", collapsed: false, builds: [build.id] },
      ],
    });

    expect(result.builds[0].folderName).toBe("Alts");
  });
});

describe("resolveImport", () => {
  it("keeps the file's id when nothing here is using it", () => {
    const build = storage.defaultBuild("Fresh");
    const result = resolve(plan({ builds: [build] }));

    // What makes importing the same file twice read as the same build twice.
    expect(result.builds[0].build.id).toBe(build.id);
    expect(result.builds[0].replacing).toBe(false);
  });

  it("mints a fresh id for an entry taken as new beside the one it clashes with", () => {
    const mine = storage.defaultBuild("Mine");
    const incoming = { ...storage.defaultBuild("Theirs"), id: mine.id };
    const target = plan({ builds: [incoming] }, { builds: [mine], layers: [] });

    const result = resolve(target, {}, { buildIds: [mine.id] });

    expect(result.builds[0].build.id).not.toBe(mine.id);
    expect(result.builds[0].replacing).toBe(false);
  });

  it("mints a fresh id when the trash still holds that one", () => {
    const build = storage.defaultBuild("Deleted, then re-imported");
    const result = resolve(
      plan({ builds: [build] }),
      {},
      {
        buildIds: [],
        usedIds: [build.id],
      },
    );

    expect(result.builds[0].build.id).not.toBe(build.id);
  });

  it("keeps the file's id for an entry taken as a replacement", () => {
    const mine = storage.defaultBuild("Mine");
    const incoming = { ...storage.defaultBuild("Theirs"), id: mine.id };
    const target = plan({ builds: [incoming] }, { builds: [mine], layers: [] });

    const result = resolve(
      target,
      { builds: [{ selected: true, resolution: "replace" }] },
      { buildIds: [mine.id] },
    );

    expect(result.builds[0].build.id).toBe(mine.id);
    expect(result.builds[0].build.name).toBe("Theirs");
    expect(result.builds[0].replacing).toBe(true);
  });

  it("replaces only where there is something to replace", () => {
    const target = plan({ builds: [storage.defaultBuild("No clash")] });

    const result = resolve(target, {
      builds: [{ selected: true, resolution: "replace" }],
    });

    expect(result.builds[0].replacing).toBe(false);
  });

  it("leaves out what was unticked", () => {
    const target = plan({
      builds: [storage.defaultBuild("In"), storage.defaultBuild("Out")],
    });

    const result = resolve(target, {
      builds: [
        { selected: true, resolution: "new" },
        { selected: false, resolution: "new" },
      ],
    });

    expect(result.builds.map((b) => b.build.name)).toEqual(["In"]);
  });

  it("suffixes names colliding inside one import", () => {
    const target = plan({
      builds: [storage.defaultBuild("Same"), storage.defaultBuild("Same")],
    });

    expect(resolve(target).builds.map((b) => b.build.name)).toEqual([
      "Same",
      "Same (2)",
    ]);
  });

  it("remaps a comparison to the fresh id its target ended up with", () => {
    const targetBuild = storage.defaultBuild("Target");
    const source = storage.defaultBuild("Source");
    source.compare = {
      id: targetBuild.id,
      highlight: true,
      onlyDiff: true,
      statLines: true,
    };

    const result = resolve(plan({ builds: [source, targetBuild] }));
    const imported = result.builds.find((b) => b.build.name === "Source")!;
    const importedTarget = result.builds.find(
      (b) => b.build.name === "Target",
    )!;

    expect(imported.build.compare).toEqual({
      id: importedTarget.build.id,
      highlight: true,
      onlyDiff: true,
      statLines: true,
    });
  });

  it("drops a comparison whose target was left unticked", () => {
    const targetBuild = storage.defaultBuild("Target");
    const source = storage.defaultBuild("Source");
    source.compare = {
      id: targetBuild.id,
      highlight: true,
      onlyDiff: false,
      statLines: false,
    };

    const result = resolve(plan({ builds: [source, targetBuild] }), {
      builds: [
        { selected: true, resolution: "new" },
        { selected: false, resolution: "new" },
      ],
    });

    expect(result.builds[0].build.compare.id).toBe("");
    expect(result.builds[0].build.compare.highlight).toBe(false);
  });

  it("keeps a comparison naming a build the workspace already has", () => {
    const source = storage.defaultBuild("Source");
    source.compare = {
      id: "b_here",
      highlight: true,
      onlyDiff: false,
      statLines: false,
    };

    const result = resolve(
      plan({ builds: [source] }),
      {},
      {
        buildIds: ["b_here"],
      },
    );

    expect(result.builds[0].build.compare.id).toBe("b_here");
  });

  it("rebuilds folder membership in the ids the builds ended up with", () => {
    const inside = storage.defaultBuild("Grouped");
    const target = plan({
      builds: [inside],
      folders: [
        { id: "f_1", name: "Alts", collapsed: true, builds: [inside.id] },
      ],
    });

    const result = resolve(target);

    expect(result.folders).toEqual([
      {
        name: "Alts",
        collapsed: true,
        builds: [result.builds[0].build.id],
      },
    ]);
  });

  it("drops a folder left with no members", () => {
    const build = storage.defaultBuild("Out");
    const target = plan({
      builds: [build],
      folders: [
        { id: "f_1", name: "Alts", collapsed: false, builds: [build.id] },
      ],
    });

    const result = resolve(target, {
      builds: [{ selected: false, resolution: "new" }],
    });

    expect(result.folders).toEqual([]);
  });

  it("leaves a replaced build where it already sits rather than refoldering it", () => {
    const mine = storage.defaultBuild("Mine");
    const incoming = { ...storage.defaultBuild("Theirs"), id: mine.id };
    const target = plan(
      {
        builds: [incoming],
        folders: [
          { id: "f_1", name: "Alts", collapsed: false, builds: [incoming.id] },
        ],
      },
      { builds: [mine], layers: [] },
    );

    const result = resolve(target, {
      builds: [{ selected: true, resolution: "replace" }],
    });

    expect(result.folders).toEqual([]);
  });

  it("gives the second copy of a repeated id its own fresh one", () => {
    const mine = storage.defaultBuild("Mine");
    const twice = { ...storage.defaultBuild("Theirs"), id: mine.id };
    const target = plan(
      { builds: [twice, { ...twice }] },
      { builds: [mine], layers: [] },
    );

    const result = resolve(
      target,
      {
        builds: [
          { selected: true, resolution: "replace" },
          { selected: true, resolution: "replace" },
        ],
      },
      { buildIds: [mine.id] },
    );

    expect(result.builds[0].build.id).toBe(mine.id);
    expect(result.builds[1].build.id).not.toBe(mine.id);
    expect(result.builds.map((b) => b.replacing)).toEqual([true, false]);
  });
});
