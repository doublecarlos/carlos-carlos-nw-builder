// Builds saved while the scenario flags were items picked in the `options.scenario` list.
// Each flag became a boolean global input, so a stored pick has to turn into that input's
// value, or every such build silently loses its Boss or location setting.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import { getPath } from "../../src/lib/build-path";
import {
  FLAG_PATHS,
  migrateOverlayScenarioFlags,
} from "../../src/storage/migrate-scenario-flags";
import * as storage from "../../src/storage/storage";
import type { Build, SectionPreset } from "../../src/types";

const flagged = (choices: Record<string, string>, extra = {}) =>
  storage.normalize({
    choices,
    listRows: { "options.scenario": Object.keys(choices).length },
    ...extra,
  });

describe("scenario flag migration", () => {
  it("sets the global input of each picked flag and drops the list", () => {
    const build = flagged({
      "options.scenario#1": "enemy-type-boss",
      "options.scenario#2": "location-thay",
    });
    expect(getPath(build.context, FLAG_PATHS["enemy-type-boss"]!)).toBe(true);
    expect(getPath(build.context, FLAG_PATHS["location-thay"]!)).toBe(true);
    expect(getPath(build.context, FLAG_PATHS["location-chult"]!)).toBe(
      undefined,
    );
    expect(Object.keys(build.choices)).not.toContain("options.scenario#1");
    expect(build.listRows).not.toHaveProperty("options.scenario");
  });

  it("drops a Non-boss pick, which Boss off already says", () => {
    const build = flagged({ "options.scenario#1": "enemy-type-non-boss" });
    expect(build.choices).not.toHaveProperty("options.scenario#1");
    expect(getPath(build.context, FLAG_PATHS["enemy-type-boss"]!)).toBe(
      undefined,
    );
  });

  // The fixed Location and Enemy Type slots came before the list, so they chain through it.
  it("migrates the slots the list replaced", () => {
    const build = storage.normalize({
      choices: { "options.location": "location-chult" },
    });
    expect(getPath(build.context, FLAG_PATHS["location-chult"]!)).toBe(true);
    expect(build.choices).not.toHaveProperty("options.location");
  });

  it("keeps a value the context already stores", () => {
    const build = flagged(
      { "options.scenario#1": "enemy-type-boss" },
      { context: { globals: { boss: false } } },
    );
    expect(getPath(build.context, FLAG_PATHS["enemy-type-boss"]!)).toBe(false);
  });

  it("is idempotent", () => {
    const once = flagged({ "options.scenario#1": "location-wildspace" });
    expect(storage.normalize(once)).toEqual(once);
  });

  it("leaves the input untouched", () => {
    const context = { globals: { thay: false } };
    flagged({ "options.scenario#1": "location-thay" }, { context });
    expect(context.globals.thay).toBe(false);
  });

  // `sameContent` compares the live build with its downloaded snapshot, so both migrate.
  it("migrates the downloaded snapshot too", () => {
    const raw = {
      id: "b1",
      name: "Boss build",
      choices: { "options.scenario#1": "enemy-type-boss" },
      listRows: { "options.scenario": 1 },
    };
    const build = storage.normalize({
      ...raw,
      downloaded: { snapshot: raw, at: 1 },
    });
    expect(storage.sameContent<Build>(build, build.downloaded!.snapshot)).toBe(
      true,
    );
  });

  it("drops the list's rows from a layer's section presets", () => {
    const preset: SectionPreset = {
      id: "p",
      label: "P",
      section: "options",
      choices: {
        "options.scenario#1": "enemy-type-boss",
        "options.class": "class-a",
      },
      clears: ["options.scenario#2", "options.paragon"],
    };
    const overlay = migrateOverlayScenarioFlags({
      ...storage.defaultLayer().overlay,
      sectionPresets: { p: preset },
    });
    expect(overlay.sectionPresets.p).toEqual({
      ...preset,
      choices: { "options.class": "class-a" },
      clears: ["options.paragon"],
    });
  });

  // The frozen table and the catalog are written separately; a renamed path would silently
  // migrate builds to an address nothing reads.
  it("writes only to the paths of shipped global inputs", () => {
    const paths = new Set(
      [...db.fromData().globalInputs.values()].map((slot) => slot.path),
    );
    const targets = Object.values(FLAG_PATHS).filter((path) => path !== null);
    expect(targets.filter((path) => !paths.has(path))).toEqual([]);
  });
});
