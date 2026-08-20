// `Item.publishes` (issue #273): an equipped item asserts a value into the build context,
// inverting the direction a build parameter and an item relate. Params resolve *to* items via
// `linkedItem`; this makes items resolve *to* params -- which is what lets one abstraction
// absorb the other instead of the two permanently shadowing each other.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as bonus from "../../src/engine/bonus";
import * as engine from "../../src/engine/engine";
import * as catalog from "../../src/data/catalog";
import * as storage from "../../src/storage/storage";
import { evaluate } from "../../src/engine/conditions";
import { NW_SCHEMA } from "../../src/data/data";
import type { Build, Item, Schema, Slot, SlotsData } from "../../src/types";

const emptySchema: Schema = {
  stats: [],
  statByKey: {},
  statKeys: [],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  abilityContributions: [],
  forteSplit: {},
  // `derive()` indexes this with `context.role`, falling back to `dps` -- an empty map makes
  // any full `resolveBuild` throw, so the fallback has to exist even here.
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1.2 } },
  statScalers: [],
};

const bard: Item = {
  id: "class-bard",
  name: "Bard",
  filter: "cls",
  tags: ["cls"],
  publishes: { class: "bard" },
};
const wizard: Item = {
  id: "class-wizard",
  name: "Wizard",
  filter: "cls",
  tags: ["cls"],
  publishes: { class: "wizard" },
};
/** Publishes the same value as `bard`, to prove agreement is not a conflict. */
const bardTwin: Item = {
  id: "class-bard-twin",
  name: "Bard Twin",
  filter: "cls",
  tags: ["cls"],
  publishes: { class: "bard" },
};

const slots: Slot[] = [
  {
    id: "options.class",
    label: "Class",
    section: "options",
    type: "item_picker",
    tags: ["cls"],
  },
  {
    id: "options.class2",
    label: "Class 2",
    section: "options",
    type: "item_picker",
    tags: ["cls"],
  },
];

const slotsData: SlotsData = {
  sections: [{ id: "options", label: "Options" }],
  slots,
  presets: [],
};

const testDb = db.build([bard, wizard, bardTwin], [], emptySchema, slotsData);

function testBuild(choices: Record<string, string> = {}): Build {
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    assignments: {},
    occurrenceInputs: {},
    context: {} as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

describe("an equipped item publishes into the context", () => {
  it("sets its path in ctx.params while equipped, and not once unequipped", () => {
    const equipped = bonus.collect(
      testDb,
      testBuild({ "options.class": "class-bard" }),
    ).ctx;
    expect(equipped.params.get("class")).toBe("bard");

    const bare = bonus.collect(testDb, testBuild()).ctx;
    expect(bare.params.has("class")).toBe(false);
  });

  it("reaches the dedicated `class` leaf too, not only the generic `param` one", () => {
    const ctx = bonus.collect(
      testDb,
      testBuild({ "options.class": "class-wizard" }),
    ).ctx;
    expect(ctx.class).toBe("wizard");
    expect(evaluate({ class: "wizard" }, ctx)).toBe(true);
    expect(evaluate({ param: { key: "class", equals: "wizard" } }, ctx)).toBe(
      true,
    );
  });

  it("is independent of slot order", () => {
    const first = bonus.collect(
      testDb,
      testBuild({ "options.class": "class-bard" }),
    ).ctx;
    const second = bonus.collect(
      testDb,
      testBuild({ "options.class2": "class-bard" }),
    ).ctx;
    expect(first.params.get("class")).toBe(second.params.get("class"));
    expect(first.class).toBe(second.class);
  });

  it("two items agreeing on a value is not a conflict", () => {
    // What equipping two copies of one item looks like -- there is nothing ambiguous about it.
    const { ctx, publishConflicts } = bonus.collect(
      testDb,
      testBuild({
        "options.class": "class-bard",
        "options.class2": "class-bard-twin",
      }),
    );
    expect(publishConflicts).toEqual([]);
    expect(ctx.params.get("class")).toBe("bard");
  });
});

describe("two items publishing different values for one path", () => {
  const conflicted = testBuild({
    "options.class": "class-bard",
    "options.class2": "class-wizard",
  });

  it("is reported as a conflict rather than resolved to a winner", () => {
    const { ctx, publishConflicts } = bonus.collect(testDb, conflicted);
    expect(publishConflicts).toHaveLength(1);
    expect(publishConflicts[0].path).toBe("class");
    expect(
      publishConflicts[0].contributors.map((c) => c.itemId).sort(),
    ).toEqual(["class-bard", "class-wizard"]);
    // Deliberately absent, not arbitrarily one of the two: a condition reading it fails
    // closed, which is visible, instead of quietly picking whichever slot came first.
    expect(ctx.params.has("class")).toBe(false);
  });

  it("surfaces a clear engine error on each contributing slot", () => {
    const errors = engine
      .resolveBuild(testDb, conflicted)
      .errors.filter((e) => e.kind === "publishConflict");
    expect(errors.map((e) => e.slotId).sort()).toEqual([
      "options.class",
      "options.class2",
    ]);
    expect(errors[0].severity).toBe("error");
    expect(errors[0].message).toMatch(/sets class to/);
  });

  it("reports nothing when only one of them is equipped", () => {
    const errors = engine
      .resolveBuild(testDb, testBuild({ "options.class": "class-bard" }))
      .errors.filter((e) => e.kind === "publishConflict");
    expect(errors).toEqual([]);
  });
});

describe("catalog lint for publishes", () => {
  const paramSlot: Slot = {
    id: "options.role",
    label: "Role",
    section: "options",
    type: "build_parameter",
    paramType: "list",
    path: "role",
    default: "",
    options: [{ value: "dps", label: "DPS" }],
  };

  it("rejects publishing to a path a build_parameter already owns", () => {
    const clashing: Item = {
      id: "clash",
      name: "Clash",
      filter: "cls",
      tags: ["cls"],
      publishes: { role: "dps" },
    };
    const findings = catalog.validate(
      [clashing],
      [],
      NW_SCHEMA,
      [],
      [...slots, paramSlot],
    );
    expect(
      findings.some((f) => /already a build_parameter's path/.test(f.message)),
    ).toBe(true);
  });

  it("accepts a path no parameter declares -- that is the point", () => {
    const findings = catalog.validate([bard], [], NW_SCHEMA, [], slots);
    expect(findings.some((f) => /publishes/.test(f.message))).toBe(false);
  });

  it("rejects a non-scalar published value", () => {
    const bad = {
      id: "bad",
      name: "Bad",
      filter: "cls",
      tags: ["cls"],
      publishes: { class: { nested: true } },
    } as unknown as Item;
    const findings = catalog.validate([bad], [], NW_SCHEMA, [], slots);
    expect(
      findings.some((f) =>
        /must be a string, number or boolean/.test(f.message),
      ),
    ).toBe(true);
  });

  it("does not treat publishes as a misspelled stat", () => {
    const findings = catalog.validate([bard], [], NW_SCHEMA, [], slots);
    expect(findings.some((f) => /unknown stat/i.test(f.message))).toBe(false);
  });
});

describe("migrating options.class from a stored context value", () => {
  it("an old build's context.class becomes the class item's pick", () => {
    const migrated = storage.normalise({
      id: "old",
      name: "Old build",
      context: { class: "warlock" },
    });
    expect(migrated.choices["options.class"]).toBe("class-warlock");
  });

  it("leaves a build that already made the pick alone", () => {
    const migrated = storage.normalise({
      id: "old",
      name: "Old build",
      context: { class: "warlock" },
      choices: { "options.class": "class-bard" },
    });
    expect(migrated.choices["options.class"]).toBe("class-bard");
  });

  it("leaves a stored class no item stands for rather than guessing", () => {
    const migrated = storage.normalise({
      id: "old",
      name: "Old build",
      context: { class: "artificer" },
    });
    expect(migrated.choices["options.class"]).toBeUndefined();
  });

  it("does nothing to a build that never named a class", () => {
    const migrated = storage.normalise({ id: "old", name: "Old build" });
    expect(migrated.choices["options.class"]).toBeUndefined();
  });

  it("the migrated pick resolves back to the class it used to name", () => {
    const migrated = storage.normalise({
      id: "old",
      name: "Old build",
      context: { class: "warlock" },
    });
    const { ctx } = bonus.collect(catalog.makeDb([]), migrated);
    expect(ctx.class).toBe("warlock");
  });
});
