// Builds saved while the scenario flags were items picked in the `options.scenario` list.
// The Boss and Non-boss flags became enemy ranks and a location the shared Location pick, so a
// stored pick has to move there, or every such build silently loses its rank or location.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import { getPath } from "../../src/lib/build-path";
import {
  FLAG_VALUES,
  LOCATION_FLAGS,
  LOCATION_SLOT,
  migrateOverlayScenarioFlags,
} from "../../src/storage/migrate-scenario-flags";
import * as storage from "../../src/storage/storage";
import type { Build, SectionPreset } from "../../src/types";

const RANK = FLAG_VALUES["enemy-type-boss"]!.path;

const flagged = (choices: Record<string, string>, extra = {}) =>
  storage.normalize({
    choices,
    listRows: { "options.scenario": Object.keys(choices).length },
    ...extra,
  });

describe("scenario flag migration", () => {
  it("sets Boss, picks the location and drops the list", () => {
    const build = flagged({
      "options.scenario#1": "enemy-type-boss",
      "options.scenario#2": "location-thay",
    });
    expect(getPath(build.context, RANK)).toBe(6);
    expect(build.choices[LOCATION_SLOT]).toBe("location-thay");
    expect(Object.keys(build.choices)).not.toContain("options.scenario#1");
    expect(build.listRows).not.toHaveProperty("options.scenario");
  });

  // Location holds one pick, and the first one stored is the one the player set first.
  it("keeps the first of several location picks", () => {
    const build = flagged({
      "options.scenario#1": "location-chult",
      "options.scenario#2": "location-wildspace",
    });
    expect(build.choices[LOCATION_SLOT]).toBe("location-chult");
  });

  it("keeps a Location pick the build already holds", () => {
    const build = flagged({
      "options.scenario#1": "location-thay",
      [LOCATION_SLOT]: "location-chult",
    });
    expect(build.choices[LOCATION_SLOT]).toBe("location-chult");
  });

  // The rank defaults to Boss, so a Non-boss pick has to store a lower rank to stay non-boss.
  it("stores a rank below Boss for a Non-boss pick", () => {
    const build = flagged({ "options.scenario#1": "enemy-type-non-boss" });
    expect(build.choices).not.toHaveProperty("options.scenario#1");
    expect(getPath(build.context, RANK)).toBeLessThan(6);
  });

  it("keeps the first stored of a Boss and a Non-boss pick", () => {
    const build = flagged({
      "options.scenario#1": "enemy-type-boss",
      "options.scenario#2": "enemy-type-non-boss",
    });
    expect(getPath(build.context, RANK)).toBe(6);
  });

  // The fixed Location and Enemy Type slots came before the list, so they chain through it.
  it("migrates the slots the list replaced", () => {
    const build = storage.normalize({
      choices: { "options.location": "location-chult" },
    });
    expect(build.choices[LOCATION_SLOT]).toBe("location-chult");
    expect(build.choices).not.toHaveProperty("options.location");
  });

  it("keeps a value the context already stores", () => {
    const build = flagged(
      { "options.scenario#1": "enemy-type-boss" },
      { context: { shared: { enemyRank: 3 } } },
    );
    expect(getPath(build.context, RANK)).toBe(3);
  });

  it("is idempotent", () => {
    const once = flagged({ "options.scenario#1": "location-wildspace" });
    expect(storage.normalize(once)).toEqual(once);
  });

  // The flag lands beside a stored sibling, in a copy of the nested objects they share.
  it("does not mutate the stored build", () => {
    const context = { shared: { enemyType: { demon: true } } };
    const build = flagged(
      { "options.scenario#1": "enemy-type-boss" },
      { context },
    );
    expect(getPath(build.context, RANK)).toBe(6);
    expect(getPath(build.context, "shared.enemyType.demon")).toBe(true);
    expect(context).toEqual({ shared: { enemyType: { demon: true } } });
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
  it("writes only to the paths of shipped shared inputs", () => {
    const paths = new Set(
      [...db.fromData().sharedInputs.values()].map((slot) => slot.path),
    );
    const targets = Object.values(FLAG_VALUES).map(({ path }) => path);
    expect(targets.filter((path) => !paths.has(path))).toEqual([]);
  });

  it("picks only shipped Location candidates", () => {
    const shipped = db.fromData();
    const candidates = shipped.forSlot(LOCATION_SLOT).map((item) => item.id);
    expect(
      [...LOCATION_FLAGS, "location-sword-coast"].filter(
        (id) => !candidates.includes(id),
      ),
    ).toEqual([]);
  });
});

// Sword Coast Tactician had a private "on Sword Coast" checkbox; the bonus now reads Location.
describe("Sword Coast input migration", () => {
  const stored = (active: boolean, extra = {}) =>
    storage.normalize({
      bonusValues: { "sword-coast-tactician-2": { input: { active } } },
      ...extra,
    });

  it("picks Sword Coast for a checked box and drops the input", () => {
    const build = stored(true);
    expect(build.choices[LOCATION_SLOT]).toBe("location-sword-coast");
    expect(build.bonusValues).not.toHaveProperty("sword-coast-tactician-2");
  });

  it("drops an unchecked box without picking anything", () => {
    const build = stored(false);
    expect(build.choices).not.toHaveProperty(LOCATION_SLOT);
    expect(build.bonusValues).not.toHaveProperty("sword-coast-tactician-2");
  });

  it("keeps a Location pick the build already holds", () => {
    const build = stored(true, {
      choices: { [LOCATION_SLOT]: "location-thay" },
    });
    expect(build.choices[LOCATION_SLOT]).toBe("location-thay");
  });

  it("is idempotent", () => {
    const once = stored(true);
    expect(storage.normalize(once)).toEqual(once);
  });
});
