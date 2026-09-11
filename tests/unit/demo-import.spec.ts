// demo-import.ts's buildFromLoadout. Pure, so it runs against hand-built DemoCharacter and
// DemoLoadout fixtures, plus one end-to-end pass over the shared parser fixture.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as catalog from "../../src/data/catalog";
import { parseDemo } from "../../src/lib/demo-format";
import { readSnapshot } from "../../src/lib/demo-snapshot";
import { buildFromLoadout } from "../../src/lib/demo-import";
import { GAME_IMPORT_DATA } from "../../src/lib/demo-slots";
import type {
  DemoCharacter,
  DemoItem,
  DemoLoadout,
} from "../../src/lib/demo-snapshot";
import type { CatalogOverlay, Item } from "../../src/types";

const fixture = readFileSync(
  join(__dirname, "fixtures/build-export.demo.txt"),
  "utf-8",
);

const demoItem = (
  bag: string,
  slot: number,
  gameId: string | null,
  gems: string[] = [],
): DemoItem => ({ bag, slot, gameId, inventoryId: null, gems });

function loadoutOf(
  items: DemoItem[],
  overrides: Partial<DemoLoadout> = {},
): DemoLoadout {
  return {
    name: "Test Loadout",
    index: 0,
    items,
    active: false,
    savedAt: null,
    loadedAt: null,
    ...overrides,
  };
}

function characterOf(
  name: string,
  gameClass: string | null,
  loadouts: DemoLoadout[],
  species: string | null = null,
): DemoCharacter {
  return { name, gameClass, species, loadouts };
}

const testItem = (id: string, filter: string, gameIds: string[]): Item => ({
  id,
  name: id,
  filter,
  gameIds,
});

/** Strips the shipped gameIds, so only mappings a test authors are in play and adding one to
 *  the shipped data cannot change what these assert. */
const noShippedGameIds: CatalogOverlay = {
  ...catalog.emptyOverlay(),
  items: Object.fromEntries(
    catalog
      .base()
      .items.filter((item) => item.gameIds?.length)
      .map((item) => {
        const { gameIds: _dropped, ...rest } = item;
        return [item.id, rest];
      }),
  ),
};

let overlay = noShippedGameIds;
for (const item of [
  testItem("test-head", "gear_head", ["Head_Test"]),
  testItem("test-mainhand", "gear_weapon_mainhand", ["Primary_Test"]),
  testItem("test-offense-gem", "enchantment_offense", ["OffenseGem_Test"]),
]) {
  overlay = catalog.upsert(overlay, "items", item.id, item);
}
const mappedDb = catalog.makeDb([overlay]);
const zeroMappingsDb = catalog.makeDb([noShippedGameIds]);

/** One companion power per `companion_power` tag, so a whole active-bonus bar can be placed. */
let companionOverlay = overlay;
for (const [id, gameId, tag] of [
  ["test-cp-offense", "Pet_Off_Test", "offense"],
  ["test-cp-defense", "Pet_Def_Test", "defense"],
  ["test-cp-utility", "Pet_Util_Test", "utility"],
]) {
  companionOverlay = catalog.upsert(companionOverlay, "items", id, {
    ...testItem(id, "companion_power", [gameId]),
    tags: [`companion_power:${tag}`],
  });
}
const companionDb = catalog.makeDb([companionOverlay]);

/** Read off the shipped table, so a new stand-in needs no edit to the assertions below. */
const DEFAULT_CHOICES = GAME_IMPORT_DATA.defaultChoices;

describe("buildFromLoadout: placement", () => {
  it("a fully-mapped loadout produces the expected choices", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([
      demoItem("Head", 0, "Head_Test"),
      demoItem("Melee", 0, "Primary_Test"),
    ]);
    const { build } = buildFromLoadout(character, loadout, mappedDb);
    expect(build.choices["gear.head"]).toBe("test-head");
    expect(build.choices["gear.mainhand"]).toBe("test-mainhand");
  });

  it("picks the class item its Hclass maps to", () => {
    // `hclassToClass` yields a bare class value, resolved through the item publishing it.
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([]);
    const { build } = buildFromLoadout(character, loadout, mappedDb);
    expect(build.choices["options.class"]).toBe("class-bard");
  });

  it("sets choices['raceLeveling.race'] from the character's Species", () => {
    const character = characterOf("Carlos", "Player_Bard", [], "Aasimar_Male");
    const loadout = loadoutOf([]);
    const { build } = buildFromLoadout(character, loadout, mappedDb);
    expect(build.choices["raceLeveling.race"]).toBe("race-aasimar");
  });

  it("an unrecognized Hitem produces an unrecognized outcome and leaves the slot empty", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([demoItem("Melee", 0, "Some_Unmapped_Weapon")]);
    const { build, report } = buildFromLoadout(character, loadout, mappedDb);
    expect(build.choices["gear.mainhand"]).toBeUndefined();
    expect(
      report.outcomes.some(
        (o) => o.kind === "unrecognized" && o.gameId === "Some_Unmapped_Weapon",
      ),
    ).toBe(true);
  });

  it("a notModelled bag's item is ignored, never unrecognized", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([demoItem("FashionHead", 0, "Fashion_Whatever")]);
    const { report } = buildFromLoadout(character, loadout, mappedDb);
    expect(report.counts.ignored).toBe(1);
    expect(report.counts.unrecognized).toBe(0);
    expect(
      report.outcomes.some(
        (o) => o.kind === "ignored" && o.gameId === "Fashion_Whatever",
      ),
    ).toBe(true);
  });

  it("overflow when a bag has more items than app slots", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      demoItem("OffenseGem", i, "OffenseGem_Test"),
    );
    const character = characterOf("Carlos", "Player_Bard", []);
    const { report } = buildFromLoadout(character, loadoutOf(items), mappedDb);
    expect(report.counts.imported).toBe(4);
    expect(report.counts.overflow).toBe(1);
  });

  it("notInDemo covers the boons and raceLeveling sections", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const { report } = buildFromLoadout(character, loadoutOf([]), mappedDb);
    const notInDemoIds = report.outcomes
      .filter((o) => o.kind === "notInDemo")
      .map((o) => o.slotId);
    expect(notInDemoIds).toContain("boons.tier1");
    expect(notInDemoIds).toContain("raceLeveling.race");
  });

  it("an unresolvable Hclass reports options.class as notInDemo instead of throwing", () => {
    const character = characterOf("Carlos", "Player_SomeFutureClass", []);
    const { build, report } = buildFromLoadout(
      character,
      loadoutOf([]),
      mappedDb,
    );
    // An unresolvable class leaves the slot empty rather than forcing a value.
    expect(build.choices["options.class"]).toBeUndefined();
    expect(
      report.outcomes.some(
        (o) => o.kind === "notInDemo" && o.slotId === "options.class",
      ),
    ).toBe(true);
  });

  it("an unresolvable or absent Species reports raceLeveling.race as notInDemo instead of throwing", () => {
    const character = characterOf("Carlos", "Player_Bard", [], "Gith_Male");
    const { build, report } = buildFromLoadout(
      character,
      loadoutOf([]),
      mappedDb,
    );
    expect(build.choices["raceLeveling.race"]).toBeUndefined();
    expect(
      report.outcomes.some(
        (o) => o.kind === "notInDemo" && o.slotId === "raceLeveling.race",
      ),
    ).toBe(true);
  });

  it("a recognized Species excludes raceLeveling.race from notInDemo", () => {
    const character = characterOf("Carlos", "Player_Bard", [], "Aasimar_Male");
    const { report } = buildFromLoadout(character, loadoutOf([]), mappedDb);
    expect(
      report.outcomes.some(
        (o) => o.kind === "notInDemo" && o.slotId === "raceLeveling.race",
      ),
    ).toBe(false);
  });
});

describe("buildFromLoadout: generic stand-ins", () => {
  it("applies the generic companion and mount combat power to an empty loadout", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const { build } = buildFromLoadout(character, loadoutOf([]), mappedDb);
    expect(build.choices["companions.companion"]).toBe("generic-companion");
    expect(build.choices["mounts.mountCombat"]).toBe(
      "mount-combat-power-celestial",
    );
  });

  it("a recognized game item keeps the slot instead", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const withMountPower = catalog.upsert(
      overlay,
      "items",
      "test-mount-combat",
      testItem("test-mount-combat", "mount_combat", ["Mount_Power_Test"]),
    );
    const { build } = buildFromLoadout(
      character,
      loadoutOf([demoItem("MountEquippedActivePower", 0, "Mount_Power_Test")]),
      catalog.makeDb([withMountPower]),
    );
    expect(build.choices["mounts.mountCombat"]).toBe("test-mount-combat");
  });
});

describe("buildFromLoadout: the companion bar seats whatever order it was recorded in", () => {
  // The same five powers under two class layouts: a Cleric reads Utility third, a Warlock
  // last. Neither order should decide whether the bar imports.
  const bar = (order: string[]) =>
    order.map((gameId, index) =>
      demoItem("PetEquippedActiveBonus", index + 1, gameId),
    );
  const CLERIC = [
    "Pet_Off_Test",
    "Pet_Util_Test",
    "Pet_Def_Test",
    "Pet_Off_Test",
    "Pet_Def_Test",
  ];
  const WARLOCK = [
    "Pet_Off_Test",
    "Pet_Def_Test",
    "Pet_Util_Test",
    "Pet_Off_Test",
    "Pet_Def_Test",
  ];

  it.each([
    ["Player_Devoted", CLERIC],
    ["Player_Scourge", WARLOCK],
  ])("imports every power for %s", (hclass, order) => {
    const { build, report } = buildFromLoadout(
      characterOf("Carlos", hclass, []),
      loadoutOf(bar(order)),
      companionDb,
    );
    expect(report.counts.overflow).toBe(0);
    expect(build.choices["companions.offense"]).toBe("test-cp-offense");
    expect(build.choices["companions.defense"]).toBe("test-cp-defense");
    expect(build.choices["companions.utility"]).toBe("test-cp-utility");
    expect(build.choices["companions.universal1"]).toBeDefined();
    expect(build.choices["companions.universal2"]).toBeDefined();
  });
});

describe("buildFromLoadout: zero mappings", () => {
  it("yields a valid, empty build rather than crashing", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([
      demoItem("Head", 0, "Head_Test"),
      demoItem("Melee", 0, "Primary_Test"),
    ]);
    expect(() =>
      buildFromLoadout(character, loadout, zeroMappingsDb),
    ).not.toThrow();
    const { build, report } = buildFromLoadout(
      character,
      loadout,
      zeroMappingsDb,
    );
    // The class comes from Hclass and the stand-ins from the table, so neither needs a
    // gameId mapping.
    expect(build.choices).toEqual({
      "options.class": "class-bard",
      ...DEFAULT_CHOICES,
    });
    expect(build.id).toBeTruthy();
    expect(report.counts.imported).toBe(0);
    expect(report.counts.unrecognized).toBe(2);
  });
});

describe("buildFromLoadout: naming and independence", () => {
  it("defaults the name to '<character> - <loadout>'", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([], { name: "1. DPS ST" });
    const { build } = buildFromLoadout(character, loadout, mappedDb);
    expect(build.name).toBe("Carlos - 1. DPS ST");
  });

  it("falls back to 'loadout <n>' when Loadoutname is blank", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([], { name: "", index: 2 });
    const { build } = buildFromLoadout(character, loadout, mappedDb);
    expect(build.name).toBe("Carlos - loadout 3");
  });

  it("an explicit name option overrides the default", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const { build } = buildFromLoadout(character, loadoutOf([]), mappedDb, {
      name: "My Custom Name",
    });
    expect(build.name).toBe("My Custom Name");
  });

  it("two loadouts from one character produce two independent builds with distinct ids", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const a = buildFromLoadout(
      character,
      loadoutOf([demoItem("Head", 0, "Head_Test")], { name: "A" }),
      mappedDb,
    );
    const b = buildFromLoadout(
      character,
      loadoutOf([demoItem("Melee", 0, "Primary_Test")], {
        name: "B",
        index: 1,
      }),
      mappedDb,
    );
    expect(a.build.id).not.toBe(b.build.id);
    // Both carry the character's own class pick; only the per-loadout gear differs.
    expect(a.build.choices).toEqual({
      "options.class": "class-bard",
      "gear.head": "test-head",
      ...DEFAULT_CHOICES,
    });
    expect(b.build.choices).toEqual({
      "options.class": "class-bard",
      "gear.mainhand": "test-mainhand",
      ...DEFAULT_CHOICES,
    });
  });
});

describe("buildFromLoadout: report counts agree with outcomes", () => {
  it("counts sum to the outcome list length and match per-kind filters", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([
      demoItem("Head", 0, "Head_Test"),
      demoItem("Melee", 0, "Some_Unmapped_Weapon"),
      demoItem("FashionHead", 0, "Fashion_Whatever"),
      ...Array.from({ length: 5 }, (_, i) =>
        demoItem("OffenseGem", i, "OffenseGem_Test"),
      ),
    ]);
    const { report } = buildFromLoadout(character, loadout, mappedDb);
    const total = Object.values(report.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(report.outcomes.length);
    for (const kind of Object.keys(
      report.counts,
    ) as (keyof typeof report.counts)[]) {
      expect(report.counts[kind]).toBe(
        report.outcomes.filter((o) => o.kind === kind).length,
      );
    }
  });
});

describe("buildFromLoadout: against the shared parser fixture", () => {
  it("resolves the fixture's active loadout end to end with zero mappings authored", () => {
    const snapshot = readSnapshot(parseDemo(fixture));
    const character = snapshot.characters[0];
    const loadout = character.loadouts.find((l) => l.active)!;
    const { build, report } = buildFromLoadout(
      character,
      loadout,
      zeroMappingsDb,
    );

    expect(report.character).toBe("Carlos o Bardo");
    expect(report.loadout).toBe("1. DPS ST");
    expect(build.choices["options.class"]).toBe("class-bard");
    expect(build.choices["raceLeveling.race"]).toBe("race-aasimar");
    // With no gameIds authored, every item comes back unrecognized and the build is valid.
    expect(report.counts.imported).toBe(0);
    expect(report.counts.unrecognized).toBeGreaterThan(0);
    const total = Object.values(report.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(report.outcomes.length);
  });
});

describe("buildFromLoadout: the stable", () => {
  // A mount whose fourth slot prefers enlightened, and one insignia of each shape it needs.
  const stableOverlay = [
    testItem("test-stable-mount", "mount", ["Mount_Test"]),
    testItem("test-crescent", "insignia", ["Insignia_Crescent_Test"]),
    testItem("test-regal", "insignia", ["Insignia_Regal_Test"]),
    testItem("test-barbed", "insignia", ["Insignia_Barbed_Test"]),
    testItem("test-enlightened", "insignia", ["Insignia_Enlightened_Test"]),
  ].reduce((acc, item) => catalog.upsert(acc, "items", item.id, item), overlay);

  const withShapes = [
    {
      id: "test-stable-mount",
      insigniaSlots: [
        { shape: "crescent" },
        { shape: "regal" },
        { universal: true },
        { universal: true, preferred: "enlightened" },
      ],
    },
    { id: "test-crescent", insigniaShape: "crescent" },
    { id: "test-regal", insigniaShape: "regal" },
    { id: "test-barbed", insigniaShape: "barbed" },
    {
      id: "test-enlightened",
      insigniaShape: "enlightened",
      preferredVariant: "test-enlightened-pref",
    },
    {
      id: "test-enlightened-pref",
      name: "test-enlightened-pref",
      filter: "insignia",
      insigniaShape: "enlightened",
    },
  ].reduce(
    (acc, patch) =>
      catalog.upsert(acc, "items", patch.id, {
        ...(acc.items[patch.id] as Item),
        ...patch,
      } as Item),
    stableOverlay,
  );

  const stableDb = catalog.makeDb([withShapes]);

  const loadout = loadoutOf([
    demoItem("MountEquippedActiveSlots", 0, "Mount_Test", [
      "Insignia_Crescent_Test",
      "Insignia_Regal_Test",
      "Insignia_Barbed_Test",
      "Insignia_Enlightened_Test",
    ]),
  ]);

  it("imports the mount alongside its insignia", () => {
    const { build } = buildFromLoadout(
      characterOf("Tester", null, [loadout]),
      loadout,
      stableDb,
    );
    expect(build.choices["insignia.mount1"]).toBe("test-stable-mount");
    expect(build.choices["insignia.insignia1_1"]).toBe("test-crescent");
    expect(build.choices["insignia.insignia1_3"]).toBe("test-barbed");
  });

  it("upgrades an imported insignia whose slot prefers its shape", () => {
    // A demo only ever records the ordinary insignia, so the swap has to happen on import.
    const { build, report } = buildFromLoadout(
      characterOf("Tester", null, [loadout]),
      loadout,
      stableDb,
    );
    expect(build.choices["insignia.insignia1_4"]).toBe("test-enlightened-pref");
    const imported = report.outcomes.find(
      (o) => o.kind === "imported" && o.slotId === "insignia.insignia1_4",
    );
    // The report names what the build actually holds, not the pre-swap pick.
    expect(imported).toMatchObject({ itemId: "test-enlightened-pref" });
  });
});
