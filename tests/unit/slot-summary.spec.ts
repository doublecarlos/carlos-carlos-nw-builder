// BuildEditor.vue's per-row stat summary and insignia bonus-slot placeholder, moved to
// lib/slot-summary.ts so they are testable independent of the component.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import {
  slotStablePlaceholder,
  slotStatSummary,
} from "../../src/lib/slot-summary";
import { abbr, signedStat } from "../../src/lib/format";
import type {
  Build,
  EvaluatedBonus,
  Item,
  Schema,
  Slot,
  SlotsData,
} from "../../src/types";

const item = (over: Partial<Item> = {}): Item =>
  ({ id: "i1", name: "Test Item", ...over }) as Item;

const part = (key: string, value: number) =>
  `${abbr(key)} ${signedStat(key, value)}`;

describe("slotStatSummary", () => {
  it("returns an empty string for an item with nothing to show", () => {
    expect(slotStatSummary(item(), 1, [])).toBe("");
  });

  it("lists the item's own non-zero stats, scaled by the factor", () => {
    expect(slotStatSummary(item({ power: 100 }), 1, [])).toBe(
      part("power", 100),
    );
    expect(slotStatSummary(item({ power: 100 }), 2, [])).toBe(
      part("power", 200),
    );
  });

  it("leads with the item's own description, then its insignia slot summary", () => {
    const withDescription = item({ shortDescription: "Grants a boon." });
    expect(slotStatSummary(withDescription, 1, [])).toBe("Grants a boon.");

    const mount = item({ insigniaSlots: [{ shape: "square" }] });
    expect(slotStatSummary(mount, 1, [])).toBe("Slots: square");
  });

  it("folds an active bonus's appliedStats into the same totals", () => {
    const bonus = {
      appliedStats: { power: 10 },
      grants: [{ active: true, raw: { shortDescription: "Active grant." } }],
    } as unknown as EvaluatedBonus;
    expect(slotStatSummary(item({ power: 90 }), 1, [bonus])).toBe(
      `Active grant. • ${part("power", 100)}`,
    );
  });

  it("skips an inactive grant's description", () => {
    const bonus = {
      appliedStats: {},
      grants: [{ active: false, raw: { shortDescription: "Hidden." } }],
    } as unknown as EvaluatedBonus;
    expect(slotStatSummary(item(), 1, [bonus])).toBe("");
  });
});

const schema: Schema = {
  stats: [{ key: "il", label: "Item Level", kind: "flat" }],
  statByKey: { il: { key: "il", label: "Item Level", kind: "flat" } },
  statKeys: ["il"],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  abilityContributions: [],
  forteSplit: {},
  roles: {},
  statScalers: [],
};

// One group, one insignia slot: enough to exercise stableRef's role gate and oneShortOf's
// "missing exactly one" case without the shipped catalog's 3-4 slot groups.
const slots: SlotsData = {
  sections: [{ id: "insignia", label: "Insignia" }],
  slots: [
    {
      id: "mount",
      label: "Mount",
      section: "insignia",
      type: "item_picker",
      filter: "mount",
      stable: { group: 1, role: "mount" },
    },
    {
      id: "gem",
      label: "Gem",
      section: "insignia",
      type: "item_picker",
      filter: "insignia",
      stable: { group: 1, role: "insignia", index: 1 },
    },
    {
      id: "setbonus",
      label: "Set Bonus",
      section: "insignia",
      type: "item_picker",
      filter: "insignia_bonus",
      stable: { group: 1, role: "bonus" },
    },
  ] as Slot[],
};

const items: Item[] = [
  {
    id: "steed",
    name: "Steed",
    filter: "mount",
    insigniaSlots: [{ shape: "square" }],
  } as Item,
  {
    id: "sq",
    name: "Square Gem",
    filter: "insignia",
    insigniaShape: "square",
  } as Item,
  {
    id: "b1",
    name: "Squared Up",
    filter: "insignia_bonus",
    insigniaRecipe: ["square"],
  } as Item,
];

const made = db.build(items, [], schema, slots);

function testBuild(choices: Record<string, string>): Build {
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    assignments: {},
    occurrenceInputs: {},
    listRows: {},
    disabledSlots: {},
    context: {
      class: "",
      role: "",
      damageType: "",
      duration: 0,
      enemies: 0,
      magnitude: 0,
      m32Forte: false,
      mountBolster: 1,
      companionBolster: 1,
      forte: {},
      toggles: {},
    },
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

describe("slotStablePlaceholder", () => {
  it("is undefined for a slot that isn't the group's bonus slot", () => {
    expect(
      slotStablePlaceholder(made, testBuild({}), "mount", new Map()),
    ).toBeUndefined();
  });

  it("is undefined with no mount chosen and nothing one insignia short", () => {
    expect(
      slotStablePlaceholder(made, testBuild({}), "setbonus", new Map()),
    ).toBeUndefined();
  });

  it("names the recipe it's one insignia short of", () => {
    const build = testBuild({ mount: "steed" });
    expect(slotStablePlaceholder(made, build, "setbonus", new Map())).toBe(
      "1 short of Squared Up",
    );
  });

  it("reads a derived bonus straight off the passed-in map, not off the build", () => {
    const build = testBuild({ mount: "steed", gem: "sq" });
    expect(
      slotStablePlaceholder(
        made,
        build,
        "setbonus",
        new Map([[1, { name: "Squared Up", counted: true }]]),
      ),
    ).toBe("Squared Up");
  });

  it("labels a derived bonus past its cap instead of dropping it", () => {
    const build = testBuild({ mount: "steed", gem: "sq" });
    expect(
      slotStablePlaceholder(
        made,
        build,
        "setbonus",
        new Map([[1, { name: "Squared Up", counted: false }]]),
      ),
    ).toBe("Squared Up (at cap)");
  });
});
