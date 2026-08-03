// Tests for stores/bonus-draft.ts: the grant/stat/tier/variant mutations the editor's
// stat rows call. Regression coverage for issue #65 — the "+"/"−" buttons in tiered and
// variant payloads used to target the hidden flat `grant.stats` array, so clicks appeared
// to do nothing.
import { describe, expect, it } from "vitest";
import { BonusDraftStore } from "../../../src/stores/bonus-draft";
import * as bonusDraft from "../../../src/engine/bonus-draft";

/** One-grant store, payload pre-switched when requested, change count tracked. */
function makeStore(
  payload: "flat" | "tiers" | "variants" = "flat",
  setIds: string[] = [],
) {
  const grants = [bonusDraft.toDraft({ when: {}, stats: {} })];
  let changes = 0;
  const store = new BonusDraftStore(
    () => grants,
    () => changes++,
    setIds,
  );
  const gs = store.grantStore(0)!;
  if (payload !== "flat") gs.setPayload(payload);
  return { grants, store, gs, changes: () => changes };
}

describe("GrantStore stat mutations", () => {
  it("addStat targets the flat payload's stats", () => {
    const { gs, changes } = makeStore("flat");
    gs.addStat();
    expect(gs.grant.stats).toEqual([{ key: "", value: 0 }]);
    expect(gs.grant.tiers).toHaveLength(0);
    expect(changes()).toBe(1);
  });

  it("removeStat removes from the flat payload's stats", () => {
    const { gs } = makeStore("flat");
    gs.addStat();
    gs.addStat();
    gs.removeStat(0);
    expect(gs.grant.stats).toHaveLength(1);
  });

  it("addTierStat targets the selected tier, not grant.stats", () => {
    const { gs } = makeStore("tiers", ["set-a"]);
    expect(gs.grant.tiers).toHaveLength(1); // auto-created by setPayload
    gs.addTierStat(0);
    expect(gs.grant.tiers[0].stats).toEqual([{ key: "", value: 0 }]);
    expect(gs.grant.stats).toHaveLength(0); // flat array stays untouched
  });

  it("removeTierStat removes the right row from the selected tier", () => {
    const { gs } = makeStore("tiers", ["set-a"]);
    gs.addTierStat(0);
    gs.addTierStat(0);
    gs.removeTierStat(0, 0);
    expect(gs.grant.tiers[0].stats).toHaveLength(1);
  });

  it("addTierStat on a missing tier is a no-op (no onChange)", () => {
    const { gs, changes } = makeStore("tiers", ["set-a"]);
    const before = changes();
    gs.addTierStat(5);
    expect(changes()).toBe(before);
  });

  it("addVariantStat targets the selected variant, not grant.stats", () => {
    const { gs } = makeStore("variants");
    expect(gs.grant.variants).toHaveLength(1); // auto-created by setPayload
    gs.addVariantStat(0);
    expect(gs.grant.variants[0].stats).toEqual([{ key: "", value: 0 }]);
    expect(gs.grant.stats).toHaveLength(0);
  });

  it("removeVariantStat removes the right row from the selected variant", () => {
    const { gs } = makeStore("variants");
    gs.addVariantStat(0);
    gs.addVariantStat(0);
    gs.removeVariantStat(1, 0);
    expect(gs.grant.variants[0].stats).toHaveLength(1);
  });

  it("addVariantStat on a missing variant is a no-op (no onChange)", () => {
    const { gs, changes } = makeStore("variants");
    const before = changes();
    gs.addVariantStat(5);
    expect(changes()).toBe(before);
  });
});

describe("BonusDraftStore setIds wiring", () => {
  it("setPayload('tiers') seeds the auto-created tier with the first set id", () => {
    const { gs } = makeStore("tiers", ["set-a", "set-b"]);
    expect(gs.grant.tiers[0].set).toBe("set-a");
  });
});
