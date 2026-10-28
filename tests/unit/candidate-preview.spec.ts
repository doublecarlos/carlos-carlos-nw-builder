// The picker card's "what if this candidate were picked" resolve, against the shipped catalog.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import { defaultBuild } from "../../src/storage/storage";
import {
  bonusesForItem,
  resolveWithCandidate,
} from "../../src/lib/candidate-preview";
import type { Db, EvaluatedBonus, Item } from "../../src/types";

const shipped = db.fromData();
const build = defaultBuild("Test", shipped);

/** The first item_picker slot offering a candidate with bonuses that is not already picked. */
function candidateWithBonuses(): { slotId: string; item: Item } {
  for (const slot of shipped.slots) {
    if (slot.type !== "item_picker") continue;
    const item = db
      .forSlotAndBuild(shipped, slot.id, build)
      .find(
        (candidate) =>
          candidate.bonuses?.length && build.choices[slot.id] !== candidate.id,
      );
    if (item) return { slotId: slot.id, item };
  }
  throw new Error("no candidate with bonuses in the shipped catalog");
}

describe("resolveWithCandidate", () => {
  it("resolves with the candidate picked and leaves the build alone", () => {
    const { slotId, item } = candidateWithBonuses();
    const before = structuredClone(build);
    const result = resolveWithCandidate(shipped, build, slotId, item.id);
    const row = result.rows.find((r) => r.slotId === slotId);
    expect(row?.item?.id).toBe(item.id);
    expect(build).toEqual(before);
  });
});

describe("bonusesForItem", () => {
  it("lists each resolved bonus the item belongs to once", () => {
    const { slotId, item } = candidateWithBonuses();
    const result = resolveWithCandidate(shipped, build, slotId, item.id);
    const byId = new Map(result.bonuses.map((b) => [b.id, b]));
    const ids = bonusesForItem(shipped, item, byId).map((b) => b.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(item.bonuses).toContain(id);
  });

  it("skips a bonus the resolve did not return", () => {
    const item = {
      id: "i",
      name: "I",
      bonuses: ["a", "b"],
    } as unknown as Item;
    const stub = {
      bonusesFor: () => [
        { bonus: { id: "a" }, bonusId: "a", source: "I" },
        { bonus: { id: "a" }, bonusId: "a", source: "I" },
        { bonus: { id: "b" }, bonusId: "b", source: "I" },
      ],
    } as unknown as Db;
    const a = { id: "a" } as EvaluatedBonus;
    expect(bonusesForItem(stub, item, new Map([["a", a]]))).toEqual([a]);
  });
});
