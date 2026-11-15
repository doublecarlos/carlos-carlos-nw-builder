// Builds saved before a catalog change retired what they stored. The scenario flag picks of the
// retired `options.scenario` list, and two private bonus inputs, moved onto the shared inputs
// that replaced them; without the move every such build silently reads the shared default.
import { describe, expect, it } from "vitest";
import * as db from "../../src/data/db";
import { getPath } from "../../src/lib/build-path";
import {
  FLAG_VALUES,
  LOCATION_FLAGS,
  LOCATION_SLOT,
  RETIRED_INPUTS,
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
    const targets = [
      ...Object.values(FLAG_VALUES).map(({ path }) => path),
      ...RETIRED_INPUTS.flatMap(({ becomes }) =>
        becomes.kind === "value" ? [becomes.path] : [],
      ),
    ];
    expect(targets.filter((path) => !paths.has(path))).toEqual([]);
  });

  it("picks only shipped Location candidates", () => {
    const shipped = db.fromData();
    const candidates = shipped.forSlot(LOCATION_SLOT).map((item) => item.id);
    const picks = RETIRED_INPUTS.flatMap(({ becomes }) =>
      becomes.kind === "pick" ? [becomes.item] : [],
    );
    expect(
      [...LOCATION_FLAGS, ...picks].filter((id) => !candidates.includes(id)),
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

// Fleeting Haste had a private "action points below 100%" checkbox; the bonus now reads the
// shared action point input, where full action points is the state that switches it off.
describe("Fleeting Haste input migration", () => {
  const stored = (active: boolean, extra = {}) =>
    storage.normalize({
      bonusValues: { "fleeting-haste-2": { input: { active } } },
      ...extra,
    });
  const AP = "shared.actionPoints";

  it("turns an unchecked box into full action points and drops the input", () => {
    const build = stored(false);
    expect(getPath(build.context, AP)).toBe(1);
    expect(build.bonusValues).not.toHaveProperty("fleeting-haste-2");
  });

  // The shared default is 50%, below 100%, so the stored "yes" needs no value of its own.
  it("drops a checked box, leaving action points unset", () => {
    const build = stored(true);
    expect(getPath(build.context, AP)).toBeUndefined();
    expect(build.bonusValues).not.toHaveProperty("fleeting-haste-2");
  });

  it("keeps action points the build already holds", () => {
    const build = stored(false, {
      context: { shared: { actionPoints: 0.25 } },
    });
    expect(getPath(build.context, AP)).toBe(0.25);
  });

  // The bonus's dynamic stats are stored beside its inputs and stay there.
  it("keeps the bonus's other stored values", () => {
    const build = storage.normalize({
      bonusValues: {
        "fleeting-haste-2": {
          input: { active: false },
          stat: { movement: 1 },
        },
      },
    });
    expect(build.bonusValues["fleeting-haste-2"]).toEqual({
      stat: { movement: 1 },
    });
  });

  it("is idempotent", () => {
    const once = stored(false);
    expect(storage.normalize(once)).toEqual(once);
  });
});

// Master's Cruelty and Master's Precision split the stamina bar between them, and Trainer's
// Restoration reads action points. All three had a private Proc checkbox answering their gate.
describe("Master's and Trainer's input migrations", () => {
  const stored = (bonus: string, active: boolean, extra = {}) =>
    storage.normalize({
      bonusValues: { [bonus]: { input: { active } } },
      ...extra,
    });
  const STAMINA = "shared.stamina";
  const AP = "shared.actionPoints";

  it("turns Cruelty's unchecked box into mid stamina and drops the input", () => {
    const set = stored("master-cruelty", false);
    expect(getPath(set.context, STAMINA)).toBe(0.5);
    expect(set.bonusValues).not.toHaveProperty("master-cruelty");

    // The default stamina is full, which keeps Cruelty on, what a checked box meant.
    const unset = stored("master-cruelty", true);
    expect(getPath(unset.context, STAMINA)).toBeUndefined();
    expect(unset.bonusValues).not.toHaveProperty("master-cruelty");
  });

  it("turns Precision's checked box into mid stamina and drops the input", () => {
    const set = stored("master-s-precision", true);
    expect(getPath(set.context, STAMINA)).toBe(0.5);
    expect(set.bonusValues).not.toHaveProperty("master-s-precision");
    expect(getPath(stored("master-s-precision", false).context, STAMINA)).toBe(
      undefined,
    );
  });

  it("turns Trainer's checked box into full action points and drops the input", () => {
    const set = stored("trainer-s-restoration", true);
    expect(getPath(set.context, AP)).toBe(1);
    expect(set.bonusValues).not.toHaveProperty("trainer-s-restoration");
    expect(getPath(stored("trainer-s-restoration", false).context, AP)).toBe(
      undefined,
    );
  });

  it("keeps a shared value the build already holds", () => {
    const build = stored("master-cruelty", false, {
      context: { shared: { stamina: 0.9 } },
    });
    expect(getPath(build.context, STAMINA)).toBe(0.9);
  });

  // Whenever the two Master's boxes agreed, they agreed on the same stamina state, so both
  // land on one value; a contradictory pair keeps the state one of the two stored.
  it("lands both Master's boxes on the same stamina value", () => {
    const build = storage.normalize({
      bonusValues: {
        "master-cruelty": { input: { active: false } },
        "master-s-precision": { input: { active: true } },
      },
    });
    expect(getPath(build.context, STAMINA)).toBe(0.5);
    expect(build.bonusValues).toEqual({});
  });

  it("is idempotent", () => {
    const once = stored("trainer-s-restoration", true);
    expect(storage.normalize(once)).toEqual(once);
  });
});
