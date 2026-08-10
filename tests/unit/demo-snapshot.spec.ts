// demo-snapshot.ts: turns the generic node tree into characters/loadouts/items, still with no
// app knowledge (no slots, no catalogue, no Build).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDemo } from "../../src/lib/demo-format";
import { readSnapshot } from "../../src/lib/demo-snapshot";

const fixture = readFileSync(
  join(__dirname, "fixtures/build-export.demo.txt"),
  "utf-8",
);

describe("readSnapshot: fixture", () => {
  const snapshot = readSnapshot(parseDemo(fixture));

  it("reads the one character with its name and class", () => {
    expect(snapshot.characters).toHaveLength(1);
    const character = snapshot.characters[0];
    expect(character.name).toBe("Carlos o Bardo");
    expect(character.gameClass).toBe("Player_Bard");
  });

  it("reads the character's species off the sibling Costumev5 block", () => {
    expect(snapshot.characters[0].species).toBe("Aasimar_Male");
  });

  it("reads both loadouts, in file order, with their (possibly junk) names", () => {
    const { loadouts } = snapshot.characters[0];
    expect(loadouts).toHaveLength(2);
    expect(loadouts.map((l) => l.name)).toEqual(["1. DPS ST", "aaaaaa"]);
    expect(loadouts.map((l) => l.index)).toEqual([0, 1]);
  });

  it("marks the loadout whose items best-overlap Ppbuilds as active", () => {
    const { loadouts } = snapshot.characters[0];
    expect(loadouts[0].active).toBe(true);
    expect(loadouts[1].active).toBe(false);
  });

  it("counts every item in the active loadout, including the empty slot", () => {
    const items = snapshot.characters[0].loadouts[0].items;
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.bag)).toEqual([
      "Head",
      "MainHand",
      "FashionAccessory",
      "MountEquippedActiveSlots",
    ]);
  });

  it("preserves an empty slot with a null gameId rather than dropping it", () => {
    const fashion = snapshot.characters[0].loadouts[0].items[2];
    expect(fashion.gameId).toBeNull();
    expect(fashion.inventoryId).toBeNull();
  });

  it("defaults Islotidx to 0 when absent from the file", () => {
    const head = snapshot.characters[0].loadouts[0].items[0];
    expect(head.slot).toBe(0);
  });

  it("reads an explicit Islotidx on the second loadout's item", () => {
    const offenseGem = snapshot.characters[0].loadouts[1].items[1];
    expect(offenseGem.bag).toBe("OffenseGem");
    expect(offenseGem.slot).toBe(1);
  });

  it("attaches gems to the right mount item, in file order", () => {
    const mount = snapshot.characters[0].loadouts[0].items[3];
    expect(mount.gems).toEqual([
      "Insignia_Barbed_Power_R6",
      "Insignia_Bile_Power_R5",
    ]);
    // No other item in the loadout carries gems.
    const others = snapshot.characters[0].loadouts[0].items.slice(0, 3);
    expect(others.every((i) => i.gems.length === 0)).toBe(true);
  });

  it("round-trips 64-bit ids as exact strings", () => {
    const head = snapshot.characters[0].loadouts[0].items[0];
    expect(head.gameId).toBe("Head_M31_Heavyheal_S-tier");
    expect(head.inventoryId).toBe("2218087575996877068");
    const junkLoadoutHead = snapshot.characters[0].loadouts[1].items[0];
    expect(junkLoadoutHead.inventoryId).toBe("9999999999999999999");
  });
});

// Braces must sit alone on their own line (demo-format.ts's grammar), so every block below
// is built line-by-line rather than as a one-line `{ ... }` literal.
const demoItem = (hitem: string, iitemid: string, ebagid: string) => `
Pploadoutitems
{
Hitem ${hitem}
Iitemid ${iitemid}
Ebagid ${ebagid}
}`;

const ppitem = (ebagid: string, ulitemid: string) => `
Ppitems
{
Ebagid ${ebagid}
Ulitemid ${ulitemid}
}`;

const loadout = (name: string, ...items: string[]) => `
Ppentityloadouts
{
Loadoutname "${name}"
${items.join("\n")}
}`;

describe("readSnapshot: active-loadout join", () => {
  const demo = (body: string) => readSnapshot(parseDemo(`{\n${body}\n}\n`));

  const entity = (extra: string) => `
Packets
{
Createdents
{
EntityRef 1
EntityAttach
{
Savedname "P"
${extra}
}
}
}`;

  it("yields no active loadout when Ppbuilds is absent", () => {
    const snapshot = demo(
      entity(`
Pentityloadouts
{
${loadout("A", demoItem("X", "1", "Head"))}
}`),
    );
    expect(snapshot.characters[0].loadouts.every((l) => !l.active)).toBe(true);
  });

  it("does not throw for a file with no Ppbuilds", () => {
    expect(() =>
      demo(
        entity(`
Pentityloadouts
{
${loadout("A")}
}`),
      ),
    ).not.toThrow();
  });

  it("resolves a tie between two equally-overlapping loadouts to no active loadout", () => {
    const snapshot = demo(
      entity(`
Ppbuilds
{
${ppitem("Head", "1")}
}
Pentityloadouts
{
${loadout("A", demoItem("X", "1", "Head"))}
${loadout("B", demoItem("Y", "1", "Head"))}
}`),
    );
    expect(snapshot.characters[0].loadouts.every((l) => !l.active)).toBe(true);
  });

  it("picks the loadout with the higher overlap, not just any overlap", () => {
    const snapshot = demo(
      entity(`
Ppbuilds
{
${ppitem("Head", "1")}
${ppitem("MainHand", "2")}
}
Pentityloadouts
{
${loadout("PartialMatch", demoItem("X", "1", "Head"))}
${loadout(
  "FullMatch",
  demoItem("X", "1", "Head"),
  demoItem("Y", "2", "MainHand"),
)}
}`),
    );
    const [partial, full] = snapshot.characters[0].loadouts;
    expect(partial.active).toBe(false);
    expect(full.active).toBe(true);
  });
});

describe("readSnapshot: species", () => {
  const demo = (body: string) => readSnapshot(parseDemo(`{\n${body}\n}\n`));

  // Costumev5 is a sibling of EntityAttach within Createdents, not nested inside it.
  const entityWithCostume = (costume: string) => `
Packets
{
Createdents
{
EntityRef 1
EntityAttach
{
Savedname "P"
Pentityloadouts
{
${loadout("A")}
}
}
${costume}
}
}`;

  it("reads Species off a nested Peffectivecostume block with a quoted scalar value", () => {
    const snapshot = demo(
      entityWithCostume(`
Costumev5
{
Peffectivecostume "Bardo Do Carlos"
{
Species Aasimar_Male
Costumetype Player
}
}`),
    );
    expect(snapshot.characters[0].species).toBe("Aasimar_Male");
  });

  it("reads Species off an unquoted, preset-token-shaped Peffectivecostume scalar value too", () => {
    const snapshot = demo(
      entityWithCostume(`
Costumev5
{
Peffectivecostume Species_Aasimar_M_05
{
Species Aasimar_Male
Costumetype Player
}
}`),
    );
    expect(snapshot.characters[0].species).toBe("Aasimar_Male");
  });

  it("is null when Costumev5 is absent entirely", () => {
    const snapshot = demo(entityWithCostume(""));
    expect(snapshot.characters[0].species).toBeNull();
  });

  it("is null when Costumetype is not Player (e.g. a companion's own costume)", () => {
    const snapshot = demo(
      entityWithCostume(`
Costumev5
{
Peffectivecostume Companion_Diana_01
{
Species Human_Female
Costumetype Unrestricted
}
}`),
    );
    expect(snapshot.characters[0].species).toBeNull();
  });
});

describe("readSnapshot: multiple characters", () => {
  it("only emits entities that have Pentityloadouts", () => {
    const root = parseDemo(`{
Packets
{
  Createdents
  {
    EntityRef 1
    EntityAttach
    {
      Savedname "NPC, no loadouts"
    }
  }
  Createdents
  {
    EntityRef 2
    EntityAttach
    {
      Savedname "Player"
      Pentityloadouts
      {
      ${loadout("A")}
      }
    }
  }
}
}
`);
    const snapshot = readSnapshot(root);
    expect(snapshot.characters).toHaveLength(1);
    expect(snapshot.characters[0].name).toBe("Player");
  });

  it("puts the character matching Activeplayerref first", () => {
    const root = parseDemo(`{
Activeplayerref 2
Packets
{
  Createdents
  {
    EntityRef 1
    EntityAttach
    {
      Savedname "First in file"
      Pentityloadouts
      {
      ${loadout("A")}
      }
    }
  }
  Createdents
  {
    EntityRef 2
    EntityAttach
    {
      Savedname "Active player"
      Pentityloadouts
      {
      ${loadout("A")}
      }
    }
  }
}
}
`);
    const snapshot = readSnapshot(root);
    expect(snapshot.characters.map((c) => c.name)).toEqual([
      "Active player",
      "First in file",
    ]);
  });
});
