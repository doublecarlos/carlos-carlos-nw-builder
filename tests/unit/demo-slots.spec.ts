// demo-slots.ts: the bag -> app-slot map and its placement rule. Run against the shipped
// game-import.json and data/slots.json, so these double as a lint of the shipped tables, with
// an overlay of synthetic items supplying the gameIds the real catalog has not got yet.
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/data/catalog";
import { NW_SLOTS } from "../../src/data/data";
import {
  GAME_IMPORT_DATA,
  bagEntry,
  candidateSlotIds,
  classFromHclass,
  placeBag,
  notInDemoSlotIds,
  notInDemoGroups,
  raceFromSpecies,
  validateDefaultChoices,
  validateGameBags,
  validateItemValueMap,
  validateNotInDemoReasons,
  validateValueMap,
} from "../../src/lib/demo-slots";
import type { DemoItem } from "../../src/lib/demo-snapshot";
import type { Item } from "../../src/types";

const testItem = (
  id: string,
  filter: string,
  gameIds: string[],
  extra: Partial<Item> = {},
): Item => ({
  id,
  name: id,
  filter,
  gameIds,
  ...extra,
});

let overlay = catalog.emptyOverlay();
for (const item of [
  testItem("test-head", "gear_head", ["Head_Test"]),
  testItem("test-mainhand", "gear_weapon_mainhand", ["Primary_Test"]),
  testItem("test-offhand", "gear_weapon_offhand", ["Secondary_Test"]),
  // companions.offense selects by tag, not by filter.
  testItem("test-companion-power", "companion_power", ["Pet_Bonus_Test"], {
    tags: ["companion_power:offense"],
  }),
  testItem("test-companion-enh", "companion_enhancement", ["Pet_Enh_Test"]),
  // One power per companion_power tag, so a whole active-bonus bar can be placed.
  testItem("test-cp-offense", "companion_power", ["Pet_Off_Test"], {
    tags: ["companion_power:offense"],
  }),
  testItem("test-cp-defense", "companion_power", ["Pet_Def_Test"], {
    tags: ["companion_power:defense"],
  }),
  testItem("test-cp-utility", "companion_power", ["Pet_Util_Test"], {
    tags: ["companion_power:utility"],
  }),
  // Reaches every power slot, so it can occupy one a narrower item needs.
  testItem("test-cp-any", "companion_power", ["Pet_Any_Test"], {
    tags: [
      "companion_power:offense",
      "companion_power:defense",
      "companion_power:utility",
    ],
  }),
  testItem("test-collar-sturdy", "sturdy_collar", ["Collar_Sturdy_Test"]),
  testItem("test-collar-supportive", "supportive_collar", [
    "Collar_Supportive_Test",
  ]),
  testItem("test-offense-gem", "enchantment_offense", ["OffenseGem_Test"]),
  // One in-game enchantment, three catalog forms, one shared `Hitem`. Listed offense-first
  // so a test can tell the form a bag accepts from the claimant listed first.
  testItem("test-garnet-power", "enchantment_offense", ["Garnet_Test"]),
  testItem("test-garnet-defense", "enchantment_defense", ["Garnet_Test"]),
  testItem("test-garnet-forte", "enchantment_utility", ["Garnet_Test"]),
  testItem("test-insignia", "insignia", [
    "Insignia_A",
    "Insignia_B",
    "Insignia_C",
    "Insignia_D",
    "Insignia_E",
  ]),
  testItem("test-mount", "mount", ["Mount_Test"]),
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

  it("hclassToClass passes its own lint against the classes items publish", () => {
    expect(
      validateValueMap(
        GAME_IMPORT_DATA.hclassToClass,
        "class",
        db.items,
        "hclassToClass",
      ),
    ).toEqual([]);
  });

  it("defaultChoices passes its own lint against the slots it names", () => {
    expect(
      validateDefaultChoices(
        GAME_IMPORT_DATA.defaultChoices,
        db,
        "defaultChoices",
      ),
    ).toEqual([]);
  });

  it("speciesToRace passes its own lint against raceLeveling.race's own item ids", () => {
    expect(
      validateItemValueMap(
        GAME_IMPORT_DATA.speciesToRace,
        "raceLeveling.race",
        db,
        "speciesToRace",
      ),
    ).toEqual([]);
  });
});

describe("validateValueMap", () => {
  it("errors when nothing publishes the target path at all", () => {
    const findings = validateValueMap(
      { X: "y" },
      "not.a.real.path",
      db.items,
      "test",
    );
    expect(
      findings.some(
        (f) => f.level === "error" && /no item publishes/.test(f.message),
      ),
    ).toBe(true);
  });

  it("errors when a mapped value is one no item publishes", () => {
    const findings = validateValueMap(
      { Player_Made_Up: "not-a-real-class" },
      "class",
      db.items,
      "test",
    );
    expect(
      findings.some(
        (f) => f.level === "error" && /which no item publishes/.test(f.message),
      ),
    ).toBe(true);
  });

  it("passes for a map whose values are all published", () => {
    expect(
      validateValueMap({ Player_Bard: "bard" }, "class", db.items, "test"),
    ).toEqual([]);
  });
});

describe("placeBag: simple mapped bag", () => {
  it("places a recognized item in its one slot", () => {
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

  it("an unrecognized Hitem with no catalog mapping", () => {
    const results = placeBag(
      "Head",
      [demoItem("Head", 0, "Head_Unknown_Item")],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "unrecognized",
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

  it("a bag not in the table at all is reported unrecognized, not dropped", () => {
    const results = placeBag(
      "TotallyNewBagFromAClientUpdate",
      [demoItem("TotallyNewBagFromAClientUpdate", 0, "Some_Gid")],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "unrecognized",
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

describe("placeBag: a bag is seated as a whole, not first-come-first-served", () => {
  // One companion bar recorded against two class layouts. First-fit seats in file order, so
  // the last item finding a home would depend on which layout it was recorded against.
  const bar = (order: string[]) =>
    order.map((gameId, index) =>
      demoItem("PetEquippedActiveBonus", index, gameId),
    );
  const CLERIC = [
    "Pet_Enh_Test",
    "Pet_Off_Test",
    "Pet_Util_Test",
    "Pet_Def_Test",
    "Pet_Off_Test",
    "Pet_Def_Test",
  ];
  const WARLOCK = [
    "Pet_Enh_Test",
    "Pet_Off_Test",
    "Pet_Def_Test",
    "Pet_Util_Test",
    "Pet_Off_Test",
    "Pet_Def_Test",
  ];

  it.each([
    ["a Cleric's recorded order", CLERIC],
    ["a Warlock's recorded order", WARLOCK],
  ])("seats the whole bar in %s", (_label, order) => {
    const results = placeBag(
      "PetEquippedActiveBonus",
      bar(order),
      db,
      new Set(),
    );
    expect(results.every((r) => r.kind === "imported")).toBe(true);
    // Every seating of one bar fills the same six slots.
    expect(
      results.map((r) => (r.kind === "imported" ? r.slotId : r.kind)).sort(),
    ).toEqual([
      "companions.defense",
      "companions.enhancement",
      "companions.offense",
      "companions.universal1",
      "companions.universal2",
      "companions.utility",
    ]);
  });

  it("displaces earlier items that had somewhere else to go", () => {
    // First-fit hands the four flexible powers the offense slot and both universals, leaving
    // the narrow fifth nowhere to go.
    const results = placeBag(
      "PetEquippedActiveBonus",
      [
        ...Array.from({ length: 4 }, (_, i) =>
          demoItem("PetEquippedActiveBonus", i, "Pet_Any_Test"),
        ),
        demoItem("PetEquippedActiveBonus", 4, "Pet_Off_Test"),
      ],
      db,
      new Set(),
    );
    expect(results.every((r) => r.kind === "imported")).toBe(true);
    expect(results.at(-1)).toEqual({
      kind: "imported",
      slotId: "companions.offense",
      gameId: "Pet_Off_Test",
      itemId: "test-cp-offense",
    });
    expect(
      results.map((r) => (r.kind === "imported" ? r.slotId : r.kind)).sort(),
    ).toEqual([
      "companions.defense",
      "companions.offense",
      "companions.universal1",
      "companions.universal2",
      "companions.utility",
    ]);
  });

  it("still overflows when there is genuinely no seating for every item", () => {
    const results = placeBag(
      "PetEquippedActiveBonus",
      Array.from({ length: 4 }, (_, i) =>
        demoItem("PetEquippedActiveBonus", i, "Pet_Util_Test"),
      ),
      db,
      new Set(),
    );
    // Utility powers reach only the utility slot and the two universals.
    expect(results.filter((r) => r.kind === "imported")).toHaveLength(3);
    expect(results.at(-1)).toEqual({
      kind: "overflow",
      bag: "PetEquippedActiveBonus",
      gameId: "Pet_Util_Test",
      itemId: "test-cp-utility",
    });
  });

  it("respects slots a previous bag already took", () => {
    const occupied = new Set(["companions.offense"]);
    const results = placeBag(
      "PetEquippedActiveBonus",
      [demoItem("PetEquippedActiveBonus", 0, "Pet_Off_Test")],
      db,
      occupied,
    );
    expect(results).toEqual([
      {
        kind: "imported",
        slotId: "companions.universal1",
        gameId: "Pet_Off_Test",
        itemId: "test-cp-offense",
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

describe("placeBag: notModelled bags report ignored, never unrecognized", () => {
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

describe("placeBag: one game id shared by several slot-dependent forms", () => {
  // Pins the catalog order the disambiguation has to beat: offense is the last claimant.
  it("indexes all three forms under the one game id", () => {
    expect(db.itemByGameId.get("Garnet_Test")).toEqual([
      "test-garnet-defense",
      "test-garnet-forte",
      "test-garnet-power",
    ]);
  });

  it.each([
    ["OffenseGem", "enchantments.offense1", "test-garnet-power"],
    ["DefenseGem", "enchantments.defense1", "test-garnet-defense"],
    ["UtilityGem", "enchantments.utility", "test-garnet-forte"],
  ])("%s resolves it to the form its slots accept", (bag, slotId, itemId) => {
    const results = placeBag(
      bag,
      [demoItem(bag, 0, "Garnet_Test")],
      db,
      new Set(),
    );
    expect(results).toEqual([
      { kind: "imported", slotId, gameId: "Garnet_Test", itemId },
    ]);
  });

  it("the same game id in all three bags fills all three, sharing one occupied set", () => {
    const occupied = new Set<string>();
    const results = ["OffenseGem", "DefenseGem", "UtilityGem"].flatMap((bag) =>
      placeBag(bag, [demoItem(bag, 0, "Garnet_Test")], db, occupied),
    );
    expect(
      results.map((r) => (r.kind === "imported" ? r.itemId : r.kind)),
    ).toEqual([
      "test-garnet-power",
      "test-garnet-defense",
      "test-garnet-forte",
    ]);
    expect([...occupied]).toEqual([
      "enchantments.offense1",
      "enchantments.defense1",
      "enchantments.utility",
    ]);
  });

  it("repeats within one bag all resolve to that bag's form, in slot order", () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      demoItem("DefenseGem", i, "Garnet_Test"),
    );
    const results = placeBag("DefenseGem", items, db, new Set());
    expect(results).toEqual(
      [
        "enchantments.defense1",
        "enchantments.defense2",
        "enchantments.defense3",
      ].map((slotId) => ({
        kind: "imported",
        slotId,
        gameId: "Garnet_Test",
        itemId: "test-garnet-defense",
      })),
    );
  });

  it("an overflowing shared id reports the form the bag would have used", () => {
    // Not `claimants[0]`: a full OffenseGem bag still read the item as the offense form.
    const items = Array.from({ length: 5 }, (_, i) =>
      demoItem("OffenseGem", i, "Garnet_Test"),
    );
    const results = placeBag("OffenseGem", items, db, new Set());
    expect(results.filter((r) => r.kind === "imported")).toHaveLength(4);
    expect(results.at(-1)).toEqual({
      kind: "overflow",
      bag: "OffenseGem",
      gameId: "Garnet_Test",
      itemId: "test-garnet-power",
    });
  });

  it("a game id no item claims is still unrecognized, not an empty-claimant overflow", () => {
    const results = placeBag(
      "OffenseGem",
      [demoItem("OffenseGem", 0, "Nothing_Claims_This")],
      db,
      new Set(),
    );
    expect(results).toEqual([
      {
        kind: "unrecognized",
        bag: "OffenseGem",
        slot: 0,
        gameId: "Nothing_Claims_This",
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
        kind: "unrecognized",
        bag: "MountEquippedActiveSlots",
        slot: 2,
        gameId: "Mount_Whatever",
      },
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

  it("places the bag's own item as that group's mount", () => {
    const mount = demoItem("MountEquippedActiveSlots", 0, "Mount_Test", []);
    expect(
      placeBag("MountEquippedActiveSlots", [mount], db, new Set()),
    ).toEqual([
      {
        kind: "imported",
        slotId: "insignia.mount1",
        gameId: "Mount_Test",
        itemId: "test-mount",
      },
    ]);
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

describe("candidateSlotIds", () => {
  it("returns a plain bag's candidate slots", () => {
    expect(candidateSlotIds("Head", 0)).toEqual(["gear.head"]);
  });

  it("indexes a gemSlots bag by the outcome's own slot (mount index)", () => {
    // An outcome records only the mount index, so the mount and its insignia are both offered.
    expect(candidateSlotIds("MountEquippedActiveSlots", 0)).toEqual([
      "insignia.mount1",
      "insignia.insignia1_1",
      "insignia.insignia1_2",
      "insignia.insignia1_3",
      "insignia.insignia1_4",
    ]);
  });

  it("returns nothing for a mount index with no insignia group", () => {
    expect(candidateSlotIds("MountEquippedActiveSlots", 99)).toEqual([]);
  });

  it("returns nothing for an unknown bag", () => {
    expect(candidateSlotIds("TotallyNewBagFromAClientUpdate", 0)).toEqual([]);
  });

  it("returns nothing for a notModelled bag", () => {
    expect(candidateSlotIds("FashionHead", 0)).toEqual([]);
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

describe("raceFromSpecies", () => {
  it("maps a confirmed Species token, stripping the gender suffix", () => {
    expect(raceFromSpecies("Aasimar_Male")).toBe("race-aasimar");
    expect(raceFromSpecies("Human_Female")).toBe("race-human");
    expect(raceFromSpecies("Sunelf_Male")).toBe("race-sun-elf");
    expect(raceFromSpecies("Halforc_Male")).toBe("race-half-orc");
  });

  it("returns null for an unconfirmed or unknown Species, or when absent", () => {
    expect(raceFromSpecies("Gith_Male")).toBeNull();
    expect(raceFromSpecies("Wood_Elf_Female")).toBeNull();
    expect(raceFromSpecies("Something_Unexpected")).toBeNull();
    expect(raceFromSpecies(null)).toBeNull();
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

  it("excludes raceLeveling.race even though no bag names it -- it comes from Species", () => {
    expect(missing).not.toContain("raceLeveling.race");
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

  it("falls back to a section-labeled group for a slot no authored reason names", () => {
    const groups = notInDemoGroups(db, ["overloads.overload1"]);
    expect(groups).toEqual([
      {
        label: "Enchantments",
        reason: "Not recorded in this demo - set it by hand.",
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

  it("errors when a bag places nothing, or places and is notModelled at once", () => {
    const findings = validateGameBags(
      [
        { bag: "Neither" },
        { bag: "Both", slots: ["gear.head"], notModelled: "x" },
      ],
      NW_SLOTS.slots,
    );
    expect(
      findings.filter((f) => /must declare either notModelled/.test(f.message)),
    ).toHaveLength(2);
  });

  it("accepts a bag pairing slots with gemSlots, as the stable's does", () => {
    const findings = validateGameBags(
      [
        {
          bag: "MountEquippedActiveSlots",
          slots: ["insignia.mount1"],
          gemSlots: [["insignia.insignia1_1"]],
        },
      ],
      NW_SLOTS.slots,
    );
    expect(findings).toEqual([]);
  });
});

describe("validateDefaultChoices", () => {
  it("errors on a slot that isn't an item_picker", () => {
    const findings = validateDefaultChoices(
      { "companions.sep1": "generic-companion" },
      db,
      "test",
    );
    expect(
      findings.some((f) => /does not exist as an item_picker/.test(f.message)),
    ).toBe(true);
  });

  it("errors on a value that isn't one of the slot's own candidates", () => {
    const findings = validateDefaultChoices(
      { "companions.companion": "test-head" },
      db,
      "test",
    );
    expect(
      findings.some((f) =>
        /not one of its own candidate item ids/.test(f.message),
      ),
    ).toBe(true);
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
