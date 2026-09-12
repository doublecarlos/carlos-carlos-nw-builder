// StableBrowser.vue's card derivation. Fixtures are authored here rather than read off the
// shipped catalog: these are rules about how the reference reads, not facts about current
// data.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import { metaLine, stableCards } from "../../src/lib/stable-rows";
import type { Item, Schema, SlotsData } from "../../src/types";

const schema: Schema = {
  stats: [{ key: "il", label: "Item Level", kind: "flat" }],
  statByKey: { il: { key: "il", label: "Item Level", kind: "flat" } },
  statKeys: ["il"],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  statContributions: [],
  forteSplit: {},
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1 } },
  statScalers: [],
};

const slots: SlotsData = {
  sections: [{ id: "insignia", label: "Insignia" }],
  slots: [
    {
      id: "steed",
      label: "Mount",
      section: "insignia",
      type: "item_picker",
      filter: "mount",
    },
  ],
};

const shapes = ["barbed", "crescent", "regal"];

const insigniaItems: Item[] = shapes.map(
  (shape) =>
    ({
      id: shape,
      name: shape,
      filter: "insignia",
      insigniaShape: shape,
      il: 750,
    }) as Item,
);

const items: Item[] = [
  ...insigniaItems,
  {
    id: "zebra",
    name: "Zebra",
    filter: "mount",
    insigniaSlots: [{ shape: "barbed" }, { universal: true }],
  } as Item,
  {
    id: "aurochs",
    name: "Aurochs",
    filter: "mount",
    insigniaSlots: [{ shape: "crescent" }, { universal: true }],
  } as Item,
  {
    id: "roc",
    name: "Roc",
    filter: "mount",
    insigniaSlots: [{ universal: true }, { universal: true }],
  } as Item,
  {
    id: "barbed-pair",
    name: "Twin Barbs",
    filter: "insignia_bonus",
    insigniaRecipe: ["barbed", "barbed"],
    shortDescription: "Two barbed insignia and nothing else.",
  } as Item,
  {
    id: "mixed-pair",
    name: "Crescent Guard",
    filter: "insignia_bonus",
    insigniaRecipe: ["crescent", "regal"],
  } as Item,
];

const testDb = db.build(items, [], schema, slots);

const names = (tab: "mount" | "bonus", query = "") =>
  stableCards(testDb, tab, query).map((card) => card.name);

describe("stableCards", () => {
  it("heads the mount tab with mounts and the bonus tab with bonuses, sorted by name", () => {
    expect(names("mount")).toEqual(["Aurochs", "Roc", "Zebra"]);
    expect(names("bonus")).toEqual(["Crescent Guard", "Twin Barbs"]);
  });

  it("matches the head's own name", () => {
    expect(names("mount", "zeb")).toEqual(["Zebra"]);
    expect(names("bonus", "twin")).toEqual(["Twin Barbs"]);
  });

  // The point of a two-way reference is that either end answers the question, so a bonus name
  // has to narrow the mount tab without the user switching sides first.
  it("matches a row's name on the opposite tab too", () => {
    expect(names("mount", "Twin Barbs")).toEqual(["Roc", "Zebra"]);
    expect(names("bonus", "Zebra")).toEqual(["Twin Barbs"]);
  });

  // Naming a row asks "which heads reach this", so the card narrows to the rows that answer
  // it rather than burying them in everything else that head happens to reach.
  it("narrows a row-matched card to the rows that matched", () => {
    // Roc's two universal slots reach both bonuses, so narrowing is visible.
    const card = stableCards(testDb, "mount", "Twin Barbs").find(
      (c) => c.name === "Roc",
    )!;
    expect(card.matchedByRow).toBe(true);
    expect(card.rows.map((row) => row.name)).toEqual(["Twin Barbs"]);
    // The full count survives, so the card can say what it is a subset of.
    expect(card.total).toBe(2);
  });

  // Naming the head asks "what does this reach", which is the whole list.
  it("keeps every row when the head itself matched", () => {
    const [card] = stableCards(testDb, "mount", "Aurochs");
    expect(card.matchedByRow).toBe(false);
    expect(card.rows.length).toBe(card.total);
  });

  // A head match wins outright: the rows are all still listed, and the ones that also matched
  // are the only thing `matched` is left to mark.
  it("keeps every row when both halves match, flagging the matching rows", () => {
    const [card] = stableCards(testDb, "bonus", "Crescent");
    expect(card.name).toBe("Crescent Guard");
    expect(card.matchedByRow).toBe(false);
    expect(card.rows.length).toBe(card.total);
  });

  it("lists nothing when neither end matches", () => {
    expect(names("mount", "nothing at all")).toEqual([]);
    expect(names("bonus", "nothing at all")).toEqual([]);
  });
});

// A row carries the same identity line its card's heading does, so the table says what each
// entry is made of without a hover to ask for it.
describe("row meta", () => {
  it("gives each row the opposite end's own combination", () => {
    const [card] = stableCards(testDb, "mount", "Zebra");
    const row = card.rows.find((r) => r.name === "Twin Barbs")!;
    expect(row.meta).toBe("barbed · barbed");
  });

  it("reads as the mount's slot line on the bonus tab", () => {
    const [card] = stableCards(testDb, "bonus", "Twin Barbs");
    const row = card.rows.find((r) => r.name === "Zebra")!;
    expect(row.meta).toContain("barbed");
  });
});

describe("metaLine", () => {
  it("gives a mount its slot line and a bonus its recipe", () => {
    expect(metaLine(testDb.get("aurochs")!)).toContain("crescent");
    expect(metaLine(testDb.get("mixed-pair")!)).toBe("crescent · regal");
  });
});
