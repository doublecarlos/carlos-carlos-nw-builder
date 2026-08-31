// Builds and layers saved before the fixed Group / Artifact call / Class stuff / Misc slots
// and the Location + Enemy Type pair became `item_picker_list` slots.
import { describe, expect, it } from "vitest";
import {
  migrateListSlots,
  migratePresetListSlots,
} from "../../src/storage/migrate-list-slots";
import * as storage from "../../src/storage/storage";
import type { SectionPreset } from "../../src/types";

const rows = (choices: Record<string, string>) =>
  migrateListSlots({ choices, values: {}, assignments: {} });

describe("migrateListSlots", () => {
  it("compacts a sparse list into contiguous rows, in authored order", () => {
    expect(
      rows({
        "group.group15": "a",
        "group.group2": "b",
        "group.group22": "c",
      }).choices,
    ).toEqual({
      "group.group#1": "b",
      "group.group#2": "a",
      "group.group#3": "c",
    });
  });

  it("carries a row's magnitudes and repetition counts with its pick", () => {
    const migrated = migrateListSlots({
      choices: { "misc.misc4": "a" },
      values: { "misc.misc4": { power: 10 } },
      assignments: { "misc.misc4": { a: 3 } },
    });
    expect(migrated.values).toEqual({ "misc.misc#1": { power: 10 } });
    expect(migrated.assignments).toEqual({ "misc.misc#1": { a: 3 } });
  });

  it("merges Location and Enemy Type into one list, location first", () => {
    expect(
      rows({ "options.enemyType": "boss", "options.location": "thay" }).choices,
    ).toEqual({
      "options.scenario#1": "thay",
      "options.scenario#2": "boss",
    });
  });

  it("gives a lone Enemy Type the list's first row", () => {
    expect(rows({ "options.enemyType": "boss" }).choices).toEqual({
      "options.scenario#1": "boss",
    });
  });

  it("leaves every other slot alone", () => {
    expect(rows({ "gear.head": "helm", "misc.misc1": "a" }).choices).toEqual({
      "gear.head": "helm",
      "misc.misc#1": "a",
    });
  });

  it("drops a retired id carrying a magnitude but no pick", () => {
    const migrated = migrateListSlots({
      choices: {},
      values: { "group.group3": { power: 10 } },
      assignments: {},
    });
    expect(migrated.values).toEqual({});
  });

  it("is a no-op on an already-migrated build", () => {
    const once = rows({ "group.group2": "a" });
    expect(migrateListSlots({ ...once })).toEqual(once);
  });
});

describe("migratePresetListSlots", () => {
  const preset = (fields: Partial<SectionPreset>): SectionPreset => ({
    id: "p",
    label: "P",
    section: "artifactCall",
    ...fields,
  });

  it("compacts a preset's own choices", () => {
    const migrated = migratePresetListSlots(
      preset({
        choices: {
          "artifactCall.artifactCall1": "a",
          "artifactCall.artifactCall9": "b",
        },
      }),
    );
    expect(migrated.choices).toEqual({
      "artifactCall.artifactCall#1": "a",
      "artifactCall.artifactCall#2": "b",
    });
  });

  it("counts a slot named only in clears as a row of its own", () => {
    const migrated = migratePresetListSlots(
      preset({
        choices: { "artifactCall.artifactCall3": "a" },
        clears: ["artifactCall.artifactCall1"],
      }),
    );
    expect(migrated.clears).toEqual(["artifactCall.artifactCall#1"]);
    expect(migrated.choices).toEqual({ "artifactCall.artifactCall#2": "a" });
  });

  it("leaves a preset naming no retired slot untouched", () => {
    const source = preset({ section: "gear", choices: { "gear.head": "a" } });
    expect(migratePresetListSlots(source)).toBe(source);
  });
});

describe("normalise: migration through the storage door", () => {
  it("migrates a stored build and counts its rows", () => {
    const build = storage.normalise({
      choices: { "group.group4": "a", "group.group20": "b" },
    });
    expect(build.choices["group.group#1"]).toBe("a");
    expect(build.choices["group.group#2"]).toBe("b");
    expect(build.choices["group.group4"]).toBeUndefined();
    expect(build.listRows["group.group"]).toBe(2);
  });

  it("migrates the downloaded snapshot too, so the build still matches it", () => {
    const snapshot = {
      id: "b1",
      name: "Build",
      choices: { "misc.misc3": "a" },
    };
    const build = storage.normalise({
      ...snapshot,
      downloaded: { snapshot, at: 1 },
    });
    expect(build.downloaded?.snapshot.choices["misc.misc#1"]).toBe("a");
    // Same cast `builds.isDownloaded` makes: a snapshot has no `downloaded` of its own.
    expect(
      storage.sameContent(
        build as { downloaded?: unknown },
        build.downloaded!.snapshot as { downloaded?: unknown },
      ),
    ).toBe(true);
  });

  it("migrates a layer's authored presets", () => {
    const layer = storage.normaliseLayer({
      id: "l1",
      name: "Layer",
      overlay: {
        sectionPresets: {
          p: {
            id: "p",
            label: "P",
            section: "misc",
            choices: { "misc.misc6": "a" },
          },
        },
      },
    });
    expect(layer.overlay.sectionPresets.p?.choices).toEqual({
      "misc.misc#1": "a",
    });
  });
});
