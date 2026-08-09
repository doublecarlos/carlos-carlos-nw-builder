// demo-slots.ts: the bag -> app-slot map and its one placement rule. Exercised against the
// real, shipped game-import.json + data/slots.json (so these tests double as a sanity check
// of the shipped table itself), with a small overlay of synthetic items giving controlled
// gameIds to test against -- the real catalogue has zero gameIds populated yet (#176's job).
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/data/catalog";
import { NW_SLOTS } from "../../src/data/data";
import {
  GAME_IMPORT_DATA,
  bagEntry,
  classFromHclass,
  placeBag,
  notInDemoSlotIds,
  notInDemoGroups,
  validateGameBags,
  validateNotInDemoReasons,
} from "../../src/lib/demo-slots";
import type { DemoItem } from "../../src/lib/demo-snapshot";
import type { Item } from "../../src/types";

const testItem = (id: string, filter: string, gameIds: string[]): Item => ({
  id,
  name: id,
  filter,
  gameIds,
});

let overlay = catalog.emptyOverlay();
for (const item of [
  testItem("test-head", "gear_head", ["Head_Test"]),
  testItem("test-mainhand", "gear_weapon_mainhand", ["Primary_Test"]),
  testItem("test-offhand", "gear_weapon_offhand", ["Secondary_Test"]),
  testItem("test-combat-off", "combat_enchant_offense", ["CombatGem_Off_Test"]),
  testItem("test-combat-def", "combat_enchant_defense", ["CombatGem_Def_Test"]),
  testItem("test-companion-power", "companion_power", ["Pet_Bonus_Test"]),
  testItem("test-companion-enh", "companion_enhancement", ["Pet_Enh_Test"]),
  testItem("test-collar-sturdy", "sturdy_collar", ["Collar_Sturdy_Test"]),
  testItem("test-collar-supportive", "supportive_collar", [
    "Collar_Supportive_Test",
  ]),
  testItem("test-offense-gem", "enchantment_offense", ["OffenseGem_Test"]),
  testItem("test-insignia", "insignia", [
    "Insignia_A",
    "Insignia_B",
    "Insignia_C",
    "Insignia_D",
    "Insignia_E",
  ]),
]) {
  overlay = catalog.upsert(overlay, "items", item.id, item);
}
const db = catalog.makeDb([overlay]);

const demoItem = (
  bag: string,
  slot: number,
  gameId: string | null,
  gems: string[] = [],
): DemoItem => ({ bag, slot, gameId, inventoryId: null, gems });

describe("demo-slots: shipped data", () => {
  it("has 39 bags", () => {
    expect(GAME_IMPORT_DATA.bags).toHaveLength(39);
  });

  it("passes its own lint against the real slot list", () => {
    expect(validateGameBags(GAME_IMPORT_DATA.bags, NW_SLOTS.slots)).toEqual([]);
  });

  it("has 12 notInDemoReasons groups", () => {
    expect(GAME_IMPORT_DATA.notInDemoReasons).toHaveLength(12);
  });

  it("notInDemoReasons passes its own lint against the real slot/section list", () => {
    expect(
      validateNotInDemoReasons(
        GAME_IMPORT_DATA.notInDemoReasons,
        NW_SLOTS.slots,
        NW_SLOTS.sections,
      ),
    ).toEqual([]);
  });
});

describe("placeBag: simple mapped bag", () => {
  it("places a recognised item in its one slot", () => {
    const results = placeBag(
      "Head",
      [demoItem("Head", 0, "Head_Test")],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "imported",
        slotId: "gear.head",
        gameId: "Head_Test",
        itemId: "test-head",
      },
    ]);
  });

  it("an unrecognised Hitem with no catalogue mapping", () => {
    const results = placeBag(
      "Head",
      [demoItem("Head", 0, "Head_Unknown_Item")],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "unrecognised",
        bag: "Head",
        slot: 0,
        gameId: "Head_Unknown_Item",
      },
    ]);
  });

  it("an empty demo slot (null gameId) produces no outcome at all", () => {
    const results = placeBag(
      "Head",
      [demoItem("Head", 0, null)],
      db,
      new Set(),
    );
    expect(results).toEqual([]);
  });

  it("a bag not in the table at all is reported unrecognised, not dropped", () => {
    const results = placeBag(
      "TotallyNewBagFromAClientUpdate",
      [demoItem("TotallyNewBagFromAClientUpdate", 0, "Some_Gid")],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "unrecognised",
        bag: "TotallyNewBagFromAClientUpdate",
        slot: 0,
        gameId: "Some_Gid",
      },
    ]);
  });
});

describe("placeBag: Melee -> mainhand/offhand, filter-driven not index-driven", () => {
  it("places the offhand item correctly even when it's demo slot 0", () => {
    const results = placeBag(
      "Melee",
      [
        demoItem("Melee", 0, "Secondary_Test"),
        demoItem("Melee", 1, "Primary_Test"),
      ],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "imported",
        slotId: "gear.offhand",
        gameId: "Secondary_Test",
        itemId: "test-offhand",
      },
      {
        kind: "imported",
        slotId: "gear.mainhand",
        gameId: "Primary_Test",
        itemId: "test-mainhand",
      },
    ]);
  });
});

describe("placeBag: CombatGem, one bag two filters", () => {
  it("the offense/defense enchant land in their own slot regardless of order", () => {
    const results = placeBag(
      "CombatGem",
      [demoItem("CombatGem", 0, "CombatGem_Def_Test")],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "imported",
        slotId: "enchantments.combatDefense",
        gameId: "CombatGem_Def_Test",
        itemId: "test-combat-def",
      },
    ]);
  });
});

describe("placeBag: PetEquippedActiveBonus mixes companion_power and companion_enhancement", () => {
  it("a companion_power item lands in the first open power slot, the enhancement in its own", () => {
    const results = placeBag(
      "PetEquippedActiveBonus",
      [
        demoItem("PetEquippedActiveBonus", 0, "Pet_Enh_Test"),
        demoItem("PetEquippedActiveBonus", 1, "Pet_Bonus_Test"),
      ],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "imported",
        slotId: "companions.enhancement",
        gameId: "Pet_Enh_Test",
        itemId: "test-companion-enh",
      },
      {
        kind: "imported",
        slotId: "companions.offense",
        gameId: "Pet_Bonus_Test",
        itemId: "test-companion-power",
      },
    ]);
  });
});

describe("placeBag: MountCollars is filter-driven, game order need not match ours", () => {
  it("a supportive collar seen before a sturdy one still lands in its own slot", () => {
    const results = placeBag(
      "MountCollars",
      [
        demoItem("MountCollars", 0, "Collar_Supportive_Test"),
        demoItem("MountCollars", 1, "Collar_Sturdy_Test"),
      ],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "imported",
        slotId: "mounts.supportiveCollar",
        gameId: "Collar_Supportive_Test",
        itemId: "test-collar-supportive",
      },
      {
        kind: "imported",
        slotId: "mounts.sturdyCollar",
        gameId: "Collar_Sturdy_Test",
        itemId: "test-collar-sturdy",
      },
    ]);
  });
});

describe("placeBag: notModelled bags report ignored, never unrecognised", () => {
  it("FashionHead's item is ignored with the table's reason", () => {
    const results = placeBag(
      "FashionHead",
      [demoItem("FashionHead", 0, "Fashion_Whatever")],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "ignored",
        bag: "FashionHead",
        gameId: "Fashion_Whatever",
        reason: bagEntry("FashionHead")!.notModelled,
      },
    ]);
  });
});

describe("placeBag: overflow", () => {
  it("a 5th offense enchant with only 4 slots overflows instead of being dropped", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      demoItem("OffenseGem", i, "OffenseGem_Test"),
    );
    const results = placeBag("OffenseGem", items, db, new Set());
    expect(results.filter((r) => r.kind === "imported")).toHaveLength(4);
    expect(results.at(-1)).toEqual({
      kind: "overflow",
      bag: "OffenseGem",
      gameId: "OffenseGem_Test",
      itemId: "test-offense-gem",
    });
  });

  it("occupied carries across bags sharing a candidate slot", () => {
    const occupied = new Set(["gear.head"]);
    const results = placeBag(
      "Head",
      [demoItem("Head", 0, "Head_Test")],
      db,
      occupied,
    );
    expect(results).toEqual([
      {
        kind: "overflow",
        bag: "Head",
        gameId: "Head_Test",
        itemId: "test-head",
      },
    ]);
  });
});

describe("placeBag: MountEquippedActiveSlots gems, two-dimensional placement", () => {
  it("a mount's gems land in that mount's own insignia group, in gem order", () => {
    const mount = demoItem("MountEquippedActiveSlots", 2, "Mount_Whatever", [
      "Insignia_A",
      "Insignia_B",
    ]);
    const results = placeBag(
      "MountEquippedActiveSlots",
      [mount],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "imported",
        slotId: "insignia.insignia3_1",
        gameId: "Insignia_A",
        itemId: "test-insignia",
      },
      {
        kind: "imported",
        slotId: "insignia.insignia3_2",
        gameId: "Insignia_B",
        itemId: "test-insignia",
      },
    ]);
  });

  it("the mount item itself produces no outcome -- only its gems do", () => {
    const mount = demoItem("MountEquippedActiveSlots", 0, "Mount_Whatever", []);
    expect(
      placeBag("MountEquippedActiveSlots", [mount], db, new Set()),
    ).toEqual([]);
  });

  it("more equipped mounts than insignia groups modelled are skipped, not thrown", () => {
    const mount = demoItem("MountEquippedActiveSlots", 99, "Mount_Whatever", [
      "Insignia_A",
    ]);
    expect(() =>
      placeBag("MountEquippedActiveSlots", [mount], db, new Set()),
    ).not.toThrow();
  });
});

describe("classFromHclass", () => {
  it("maps every documented Hclass value", () => {
    expect(classFromHclass("Player_Bard")).toBe("bard");
    expect(classFromHclass("Player_Scourge")).toBe("warlock");
  });

  it("returns null for an unknown or absent Hclass", () => {
    expect(classFromHclass("Player_SomethingNew")).toBeNull();
    expect(classFromHclass(null)).toBeNull();
  });
});

describe("notInDemoSlotIds", () => {
  const missing = notInDemoSlotIds(NW_SLOTS.slots);

  it("includes a slot from a section the demo never touches", () => {
    expect(missing).toContain("boons.tier1");
  });

  it("excludes options.class even though no bag names it -- it comes from Hclass", () => {
    expect(missing).not.toContain("options.class");
  });

  it("excludes a slot a bag does name", () => {
    expect(missing).not.toContain("gear.head");
  });

  it("never includes a separator", () => {
    const separatorIds = NW_SLOTS.slots
      .filter((s) => s.type === "separator")
      .map((s) => s.id);
    expect(missing.some((id) => separatorIds.includes(id))).toBe(false);
  });

  it("never includes a text slot", () => {
    const textIds = NW_SLOTS.slots
      .filter((s) => s.type === "text")
      .map((s) => s.id);
    expect(missing.some((id) => textIds.includes(id))).toBe(false);
  });
});

describe("notInDemoGroups", () => {
  const missing = notInDemoSlotIds(NW_SLOTS.slots);

  it("rolls a whole missing section up into one authored group", () => {
    const groups = notInDemoGroups(db, missing);
    const boons = groups.find((g) => g.label === "Boons");
    expect(boons?.reason).toMatch(/boon points/);
    expect(boons?.slotIds).toContain("boons.tier1");
    expect(boons?.slotIds).toHaveLength(
      NW_SLOTS.slots.filter(
        (s) => s.section === "boons" && s.type !== "separator",
      ).length,
    );
  });

  it("only includes options.class as its own group when the loadout actually lacks a class", () => {
    const withClass = notInDemoGroups(
      db,
      missing.filter((id) => id !== "options.class"),
    );
    expect(withClass.find((g) => g.label === "Class")).toBeUndefined();

    const withoutClass = notInDemoGroups(db, [...missing, "options.class"]);
    expect(withoutClass.find((g) => g.label === "Class")).toBeDefined();
  });

  it("never drops a slot -- everything passed in lands in some group", () => {
    const groups = notInDemoGroups(db, missing);
    const covered = new Set(groups.flatMap((g) => g.slotIds));
    expect(missing.every((id) => covered.has(id))).toBe(true);
  });

  it("falls back to a section-labelled group for a slot no authored reason names", () => {
    const groups = notInDemoGroups(db, ["overloads.overload1"]);
    expect(groups).toEqual([
      {
        label: "Overloads",
        reason: "Not recorded in this demo — set it by hand.",
        slotIds: ["overloads.overload1"],
      },
    ]);
  });
});

describe("validateGameBags", () => {
  it("errors on a slot id that doesn't exist", () => {
    const findings = validateGameBags(
      [{ bag: "Test", slots: ["not.a.real.slot"] }],
      NW_SLOTS.slots,
    );
    expect(
      findings.some(
        (f) => f.level === "error" && /does not exist/.test(f.message),
      ),
    ).toBe(true);
  });

  it("errors when two bags claim the same slot", () => {
    const findings = validateGameBags(
      [
        { bag: "A", slots: ["gear.head"] },
        { bag: "B", slots: ["gear.head"] },
      ],
      NW_SLOTS.slots,
    );
    expect(
      findings.some((f) => /claimed by both "A" and "B"/.test(f.message)),
    ).toBe(true);
  });

  it("errors when a bag declares zero or more than one of slots/gemSlots/notModelled", () => {
    const findings = validateGameBags(
      [
        { bag: "Neither" },
        { bag: "Both", slots: ["gear.head"], notModelled: "x" },
      ],
      NW_SLOTS.slots,
    );
    expect(
      findings.filter((f) => /must declare exactly one/.test(f.message)),
    ).toHaveLength(2);
  });
});

describe("validateNotInDemoReasons", () => {
  it("errors on a section id that doesn't exist", () => {
    const findings = validateNotInDemoReasons(
      [{ label: "Test", reason: "x", sections: ["not-a-real-section"] }],
      NW_SLOTS.slots,
      NW_SLOTS.sections,
    );
    expect(
      findings.some(
        (f) => f.level === "error" && /does not exist/.test(f.message),
      ),
    ).toBe(true);
  });

  it("errors on a slot id that doesn't exist", () => {
    const findings = validateNotInDemoReasons(
      [{ label: "Test", reason: "x", slotIds: ["not.a.real.slot"] }],
      NW_SLOTS.slots,
      NW_SLOTS.sections,
    );
    expect(
      findings.some(
        (f) => f.level === "error" && /does not exist/.test(f.message),
      ),
    ).toBe(true);
  });

  it("errors when an entry declares neither sections nor slotIds", () => {
    const findings = validateNotInDemoReasons(
      [{ label: "Empty", reason: "x" }],
      NW_SLOTS.slots,
      NW_SLOTS.sections,
    );
    expect(
      findings.some((f) => /must declare at least one/.test(f.message)),
    ).toBe(true);
  });
});
