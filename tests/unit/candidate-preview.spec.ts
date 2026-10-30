// The picker card's "what if this candidate were picked" resolve, against the shipped catalog.
import { afterEach, describe, it, expect, vi } from "vitest";
import * as db from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { defaultBuild } from "../../src/storage/storage";
import {
  bonusesForItem,
  candidatePreviews,
  resolveWithCandidate,
  samePreviewInputs,
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

  it("applies the candidate's defaultParams to the resolve, not to the build", () => {
    const before = structuredClone(build);
    const result = resolveWithCandidate(
      shipped,
      build,
      "options.paragon",
      "paragon-hellbringer",
    );
    expect(result.ctx.params.get("role")).toBe("dps");
    expect(result.ctx.params.get("forte.primary")).toBe("power_p");
    expect(build).toEqual(before);
  });

  it("previews an insignia as the variant its slot would upgrade it to", () => {
    const stable = structuredClone(build);
    // This mount's fourth slot is universal, preferring illuminated.
    stable.choices["insignia.mount1"] = "stable-armored-pale-horse";
    const result = resolveWithCandidate(
      shipped,
      stable,
      "insignia.insignia1_4",
      "aggression-illuminated",
    );
    const row = result.rows.find((r) => r.slotId === "insignia.insignia1_4");
    expect(row?.item?.id).toBe("aggression-illuminated-pref");
    expect(stable.choices["insignia.insignia1_4"]).toBeUndefined();
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

describe("candidatePreviews", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps what the card reads next to the row's sums", () => {
    const { slotId, item } = candidateWithBonuses();
    const preview = candidatePreviews({ db: shipped, build, slotId }, [
      item,
    ]).get(item.id)!;
    const result = resolveWithCandidate(shipped, build, slotId, item.id);
    const byId = new Map(result.bonuses.map((b) => [b.id, b]));
    expect(preview.bonuses.map((b) => b.id)).toEqual(
      bonusesForItem(shipped, item, byId).map((b) => b.id),
    );
    expect([...preview.bonusById.keys()]).toEqual([...byId.keys()]);
    expect(preview.ctx.equipped.get(item.id)).toBeGreaterThan(0);
  });

  it("resolves each candidate once", () => {
    const { slotId } = candidateWithBonuses();
    const items = db.forSlotAndBuild(shipped, slotId, build).slice(0, 5);
    const spy = vi.spyOn(engine, "resolveBonuses");
    candidatePreviews({ db: shipped, build, slotId }, items);
    expect(spy).toHaveBeenCalledTimes(items.length);
  });

  it("maps a candidate whose resolve throws to null, and keeps the rest", () => {
    const { slotId } = candidateWithBonuses();
    const items = db.forSlotAndBuild(shipped, slotId, build).slice(0, 2);
    vi.spyOn(engine, "resolveBonuses").mockImplementationOnce(() => {
      throw new Error("bad");
    });
    const map = candidatePreviews({ db: shipped, build, slotId }, items);
    expect(map.get(items[0].id)).toBeNull();
    expect(map.get(items[1].id)).not.toBeNull();
  });
});

describe("samePreviewInputs", () => {
  const inputs = { db: shipped, build, slotId: "gear.head" };

  it("matches a fresh object with the same parts", () => {
    expect(samePreviewInputs(inputs, { ...inputs })).toBe(true);
  });

  it("tells apart a changed build or slot", () => {
    expect(samePreviewInputs(inputs, { ...inputs, build: { ...build } })).toBe(
      false,
    );
    expect(samePreviewInputs(inputs, { ...inputs, slotId: "gear.armor" })).toBe(
      false,
    );
  });

  it("matches only undefined against undefined", () => {
    expect(samePreviewInputs(undefined, undefined)).toBe(true);
    expect(samePreviewInputs(inputs, undefined)).toBe(false);
  });
});
