// demo-import.ts's buildFromLoadout: turns one demo loadout into a Build + coverage report.
// Pure -- no Vue, no stores -- so it's exercised directly against hand-built DemoCharacter/
// DemoLoadout fixtures (for precise control over outcomes) plus one end-to-end pass over the
// shared parser fixture.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as catalog from "../../src/data/catalog";
import { parseDemo } from "../../src/lib/demo-format";
import { readSnapshot } from "../../src/lib/demo-snapshot";
import { buildFromLoadout } from "../../src/lib/demo-import";
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

/** The shipped catalogue authors gameIds of its own, which would resolve items these tests
 *  never asked for. Every db here is composed over this overlay instead, so the only mappings
 *  in play are the ones the test itself authors -- and adding a gameId to the shipped data
 *  cannot change what any of them assert. */
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
    // `hclassToClass` still yields the bare class value; the importer resolves that through
    // whichever item publishes it, since the class is an ordinary pick now (#273).
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

  it("an unrecognised Hitem produces an unrecognised outcome and leaves the slot empty", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([demoItem("Melee", 0, "Some_Unmapped_Weapon")]);
    const { build, report } = buildFromLoadout(character, loadout, mappedDb);
    expect(build.choices["gear.mainhand"]).toBeUndefined();
    expect(
      report.outcomes.some(
        (o) => o.kind === "unrecognised" && o.gameId === "Some_Unmapped_Weapon",
      ),
    ).toBe(true);
  });

  it("a notModelled bag's item is ignored, never unrecognised", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([demoItem("FashionHead", 0, "Fashion_Whatever")]);
    const { report } = buildFromLoadout(character, loadout, mappedDb);
    expect(report.counts.ignored).toBe(1);
    expect(report.counts.unrecognised).toBe(0);
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
    // Same as any other freshly created build (builds.createBuild() included): an
    // unresolvable class simply leaves the slot empty, the ordinary "nothing chosen yet"
    // state, rather than forcing a value.
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

  it("a recognised Species excludes raceLeveling.race from notInDemo", () => {
    const character = characterOf("Carlos", "Player_Bard", [], "Aasimar_Male");
    const { report } = buildFromLoadout(character, loadoutOf([]), mappedDb);
    expect(
      report.outcomes.some(
        (o) => o.kind === "notInDemo" && o.slotId === "raceLeveling.race",
      ),
    ).toBe(false);
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
    // The class still resolves -- it comes from the character's Hclass, not from any gameId
    // mapping, so it is unaffected by this db having none.
    expect(build.choices).toEqual({ "options.class": "class-bard" });
    expect(build.id).toBeTruthy();
    expect(report.counts.imported).toBe(0);
    expect(report.counts.unrecognised).toBe(2);
  });
});

describe("buildFromLoadout: naming and independence", () => {
  it("defaults the name to '<character> — <loadout>'", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([], { name: "1. DPS ST" });
    const { build } = buildFromLoadout(character, loadout, mappedDb);
    expect(build.name).toBe("Carlos — 1. DPS ST");
  });

  it("falls back to 'loadout <n>' when Loadoutname is blank", () => {
    const character = characterOf("Carlos", "Player_Bard", []);
    const loadout = loadoutOf([], { name: "", index: 2 });
    const { build } = buildFromLoadout(character, loadout, mappedDb);
    expect(build.name).toBe("Carlos — loadout 3");
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
    });
    expect(b.build.choices).toEqual({
      "options.class": "class-bard",
      "gear.mainhand": "test-mainhand",
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
    // No gameIds authored anywhere -- every present item comes back unrecognised, none
    // imported, and the build is still perfectly valid.
    expect(report.counts.imported).toBe(0);
    expect(report.counts.unrecognised).toBeGreaterThan(0);
    const total = Object.values(report.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(report.outcomes.length);
  });
});
