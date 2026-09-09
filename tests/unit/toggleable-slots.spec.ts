// A `toggleable` slot's checkbox. The claim the feature rests on: a switched-off row resolves
// exactly as an empty slot would (stats, tags, equipped counts, published values and bonus
// occurrences all gone), while everything describing what the build holds (the pick itself,
// duplicate detection) is untouched.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as bonus from "../../src/engine/bonus";
import * as engine from "../../src/engine/engine";
import * as catalog from "../../src/data/catalog";
import * as storage from "../../src/storage/storage";
import { expandSlots, rowSlot } from "../../src/lib/item-picker-list";
import { isDisabled, isToggleable } from "../../src/lib/slot-toggle";
import type {
  Bonus,
  Build,
  Item,
  Schema,
  Slot,
  SlotsData,
} from "../../src/types";

const schema: Schema = {
  stats: [{ key: "power", label: "Power", kind: "int" }],
  statByKey: { power: { key: "power", label: "Power", kind: "int" } },
  statKeys: ["power"],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  abilityContributions: [],
  forteSplit: {},
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1.2 } },
  statScalers: [],
};

const FLAT_BONUS = "flat-bonus";
const TYPED_BONUS = "typed-bonus";

/** Carries both attachment shapes plus a published value, so one switched-off row can prove
 *  every channel an item reaches the calculation through is closed. */
const elixir: Item = {
  id: "elixir",
  name: "Test Elixir",
  filter: "consumables",
  tags: ["consumable"],
  power: 10,
  maxCopies: 1,
  publishes: { "options.mode": "brewed" },
  bonuses: [FLAT_BONUS, { bonus: TYPED_BONUS, min: 0, max: 3, default: 2 }],
};

const bonuses: Bonus[] = [
  { id: FLAT_BONUS, name: "Flat", grants: [{ stats: { power: 100 } }] },
  { id: TYPED_BONUS, name: "Typed", grants: [{ stats: { power: 1000 } }] },
];

const slots: Slot[] = [
  {
    id: "buffs.elixir",
    label: "Elixir",
    section: "buffs",
    type: "item_picker",
    filter: "consumables",
    toggleable: true,
  },
  {
    id: "buffs.spare",
    label: "Spare",
    section: "buffs",
    type: "item_picker",
    filter: "consumables",
  },
];

const slotsData: SlotsData = {
  sections: [{ id: "buffs", label: "Buffs" }],
  slots,
  presets: [],
};

const testDb = db.build([elixir], bonuses, schema, slotsData);

function testBuild(overrides: Partial<Build> = {}): Build {
  return {
    id: "b",
    name: "b",
    choices: { "buffs.elixir": elixir.id },
    values: {},
    assignments: {},
    occurrenceInputs: {},
    listRows: {},
    disabledSlots: {},
    context: { role: "dps" } as Build["context"],
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
    ...overrides,
  };
}

const switchedOff = (slotId = "buffs.elixir") =>
  testBuild({ disabledSlots: { [slotId]: true } });

describe("reading the switch", () => {
  it("is off only where the build says so", () => {
    expect(isDisabled(testBuild(), slots[0])).toBe(false);
    expect(isDisabled(switchedOff(), slots[0])).toBe(true);
  });

  it("ignores an entry left behind on a slot that is no longer toggleable", () => {
    expect(isToggleable(slots[1])).toBe(false);
    expect(isDisabled(switchedOff("buffs.spare"), slots[1])).toBe(false);
  });
});

describe("what the engine collects", () => {
  it("equips nothing, tags nothing and publishes nothing while switched off", () => {
    const { ctx } = bonus.collect(testDb, switchedOff());
    expect(ctx.equipped.has(elixir.id)).toBe(false);
    expect(ctx.tags.has("consumable")).toBe(false);
    expect(ctx.params.has("options.mode")).toBe(false);
  });

  it("keeps the pick on its row, at zero repetitions", () => {
    const { rows } = bonus.collect(testDb, switchedOff());
    const row = rows.find((entry) => entry.slotId === "buffs.elixir")!;
    expect(row.choice).toBe(elixir.id);
    expect(row.item?.id).toBe(elixir.id);
    expect(row.repetitions).toBe(0);
  });

  it("zeroes both attachment shapes, the typed count included", () => {
    const { ctx } = bonus.collect(testDb, switchedOff());
    expect(ctx.bonusOccurrences.get(FLAT_BONUS) ?? 0).toBe(0);
    expect(ctx.bonusOccurrences.get(TYPED_BONUS) ?? 0).toBe(0);
  });

  it("keeps those bonuses reachable, so a hover card can still explain them", () => {
    const { zeroCandidates } = bonus.collect(testDb, switchedOff());
    expect(zeroCandidates.some((c) => c.bonusId === FLAT_BONUS)).toBe(true);
    expect(zeroCandidates.some((c) => c.bonusId === TYPED_BONUS)).toBe(true);
  });

  it("collects everything again once the box is checked", () => {
    const { ctx } = bonus.collect(testDb, testBuild());
    expect(ctx.equipped.get(elixir.id)).toBe(1);
    expect(ctx.tags.get("consumable")).toBe(1);
    expect(ctx.params.get("options.mode")).toBe("brewed");
    expect(ctx.bonusOccurrences.get(FLAT_BONUS)).toBe(1);
    expect(ctx.bonusOccurrences.get(TYPED_BONUS)).toBe(2);
  });
});

describe("what the engine computes", () => {
  const totalPower = (build: Build) =>
    engine.resolveBuild(testDb, build).stages.totals.power;

  it("drops the item's own stats and its bonuses' alike", () => {
    expect(totalPower(switchedOff())).toBe(0);
  });

  it("totals exactly what an empty slot would, and the pick when switched on", () => {
    const empty = testBuild({ choices: {} });
    expect(totalPower(switchedOff())).toBe(totalPower(empty));
    // The typed attachment grants once however many occurrences it counts: what the checkbox
    // has to change is the occurrence count, not this bonus's own stacking rule.
    expect(totalPower(testBuild())).toBe(10 + 100 + 1000);
  });
});

describe("what the engine reports", () => {
  const messagesFor = (build: Build) =>
    engine.resolveBuild(testDb, build).errors.map((error) => error.message);

  it("still counts a switched-off copy against maxCopies", () => {
    // The picker withholds an at-cap item from every other slot whatever this row states
    // (db.ts's copyCounts), so the error has to agree or the two would disagree about what
    // the build holds.
    const both = testBuild({
      choices: { "buffs.elixir": elixir.id, "buffs.spare": elixir.id },
      disabledSlots: { "buffs.elixir": true },
    });
    expect(messagesFor(both).join(" ")).toMatch(
      /Test Elixir is equipped 2 times, maximum 1/,
    );
  });

  it("reports nothing for one switched-off copy on its own", () => {
    expect(messagesFor(switchedOff())).toEqual([]);
  });
});

describe("authoring", () => {
  it("hands the property down to every row a list expands into", () => {
    const list: Slot = {
      id: "group.group",
      label: "Group buff",
      section: "buffs",
      type: "item_picker_list",
      filter: "consumables",
      toggleable: true,
    };
    expect(rowSlot(list, 2).toggleable).toBe(true);
    const rows = expandSlots(
      [list],
      testBuild({ listRows: { "group.group": 2 } }),
    );
    expect(
      rows.filter((slot) => slot.type === "item_picker").map((slot) => slot.id),
    ).toEqual(["group.group#1", "group.group#2"]);
    expect(rows.every((slot) => isToggleable(slot))).toBe(true);
  });

  it("rejects the property on a slot that holds no pick", () => {
    const findings = catalog.validateSlots([
      {
        id: "options.duration",
        label: "Duration",
        section: "options",
        type: "build_parameter",
        paramType: "number",
        path: "duration",
        toggleable: true,
      } as unknown as Slot,
    ]);
    expect(findings.map((finding) => finding.message).join(" ")).toMatch(
      /toggleable is only meaningful on an item_picker or item_picker_list/,
    );
  });
});

describe("what a build stores", () => {
  it("keeps the off state and drops an explicit on", () => {
    const build = storage.normalise({
      disabledSlots: { "buffs.elixir": true, "buffs.spare": false },
    });
    expect(build.disabledSlots).toEqual({ "buffs.elixir": true });
  });

  it("starts every slot on, and survives a round trip", () => {
    expect(storage.defaultBuild().disabledSlots).toEqual({});
    const saved = switchedOff();
    expect(
      storage.normalise(JSON.parse(JSON.stringify(saved))).disabledSlots,
    ).toEqual({ "buffs.elixir": true });
  });

  it("reads a build saved before the feature existed as all-on", () => {
    const build = storage.normalise({ choices: { "buffs.elixir": "elixir" } });
    expect(build.disabledSlots).toEqual({});
  });

  it("grows a list to cover a row it holds nothing but an off state for", () => {
    const build = storage.normalise({ disabledSlots: { "misc.misc#3": true } });
    expect(build.listRows["misc.misc"]).toBe(3);
  });
});
