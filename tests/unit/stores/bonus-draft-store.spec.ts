// Tests for stores/bonus-draft.ts: the grant/stat/tier/variant mutations the editor's
// stat rows call. Regression coverage for issue #65 — the "+"/"−" buttons in tiered and
// variant payloads used to target the hidden flat `grant.stats` array, so clicks appeared
// to do nothing.
import { describe, expect, it } from "vitest";
import { BonusDraftStore } from "../../../src/stores/bonus-draft";
import * as bonusDraft from "../../../src/engine/bonus-draft";
import { newLeafRow, newGroupRow } from "../../../src/engine/condition-draft";

/** One-grant store, payload pre-switched when requested, change count tracked. */
function makeStore(
  payload: "flat" | "tiers" | "variants" | "problem" = "flat",
  bonusIds: string[] = [],
) {
  const grants = [bonusDraft.toDraft({ when: {}, stats: {} })];
  let changes = 0;
  const store = new BonusDraftStore(
    () => grants,
    () => changes++,
    bonusIds,
  );
  const gs = store.grantStore(0)!;
  if (payload !== "flat") gs.setPayload(payload);
  return { grants, store, gs, changes: () => changes };
}

/** A store with `n` grants, each an empty draft, for grant/condition reorder tests. */
function makeMultiGrantStore(n: number) {
  const grants = Array.from({ length: n }, () =>
    bonusDraft.toDraft({ when: {}, stats: {} }),
  );
  let changes = 0;
  const store = new BonusDraftStore(
    () => grants,
    () => changes++,
  );
  return { grants, store, changes: () => changes };
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

describe("BonusDraftStore.moveGrantTo", () => {
  it("drops a grant at an arbitrary index, not just a neighbour swap", () => {
    const { grants, store } = makeMultiGrantStore(4);
    const [a, b, c, d] = grants;
    store.moveGrantTo(0, 3); // drag A to land after C
    expect(grants).toEqual([b, c, a, d]);
  });

  it("clamps to the list bounds", () => {
    const { grants, store } = makeMultiGrantStore(2);
    const [a, b] = grants;
    store.moveGrantTo(0, 999);
    expect(grants).toEqual([b, a]);
  });

  it("is a no-op when the target index resolves back to the same slot", () => {
    const { grants, store, changes } = makeMultiGrantStore(3);
    const before = changes();
    const uidsBefore = grants.map((g) => g.uid);
    store.moveGrantTo(0, 0);
    expect(changes()).toBe(before);
    expect(grants.map((g) => g.uid)).toEqual(uidsBefore);
  });
});

describe("GrantStore.moveTierTo / moveVariantTo", () => {
  it("moveTierTo drops a tier at an arbitrary index", () => {
    const { gs } = makeStore("tiers", ["a"]);
    gs.addTier();
    gs.addTier();
    gs.addTier();
    // Each addTier() carries the previous tier's atLeast+1, so this is a distinguishing
    // field across all four tiers (unlike `set`, which every tier inherits unchanged).
    const atLeasts = gs.grant.tiers.map((t) => t.atLeast);
    gs.moveTierTo(0, 3);
    expect(gs.grant.tiers.map((t) => t.atLeast)).toEqual([
      atLeasts[1],
      atLeasts[2],
      atLeasts[0],
      atLeasts[3],
    ]);
  });

  it("moveVariantTo drops a variant at an arbitrary index", () => {
    const { gs } = makeStore("variants");
    gs.addVariant();
    gs.addVariant();
    gs.addVariant();
    const ids = gs.grant.variants.map((v) => v.uid);
    gs.moveVariantTo(0, 3);
    expect(gs.grant.variants.map((v) => v.uid)).toEqual([
      ids[1],
      ids[2],
      ids[0],
      ids[3],
    ]);
  });
});

describe("BonusDraftStore.moveCondition", () => {
  const leaf = (value: string) => {
    const row = newLeafRow("toggle");
    row.value = value;
    return row;
  };

  it("moves a condition from one grant's tree to another grant's tree", () => {
    const { grants, store, changes } = makeMultiGrantStore(2);
    grants[0].conditions = [leaf("a"), leaf("b")];
    grants[1].conditions = [leaf("c")];
    const before = changes();

    store.moveCondition(
      { grantIndex: 0, scope: "grant", path: [0] },
      { grantIndex: 1, scope: "grant", path: [1] },
    );

    expect(grants[0].conditions.map((r) => r.value)).toEqual(["b"]);
    expect(grants[1].conditions.map((r) => r.value)).toEqual(["c", "a"]);
    expect(changes()).toBe(before + 1);
  });

  it("moves a condition from a grant's tree into one of its variants' trees", () => {
    const { gs, grants, store } = makeStore("variants");
    gs.grant.conditions = [leaf("a")];
    gs.grant.variants[0].conditions = [leaf("b")];

    store.moveCondition(
      { grantIndex: 0, scope: "grant", path: [0] },
      { grantIndex: 0, scope: "variant", variantIndex: 0, path: [1] },
    );

    expect(grants[0].conditions).toHaveLength(0);
    expect(grants[0].variants[0].conditions.map((r) => r.value)).toEqual([
      "b",
      "a",
    ]);
  });

  it("adjusts the target path when moving within one tree shifts a sibling's index (drag into a sibling group's branch)", () => {
    // rows = [ leaf(a), group(not) [ [] ] ] -- dragging the leaf into the not's own empty
    // branch. Regression: naively reusing the pre-removal path silently drops the row, since
    // the not group shifts from index 1 to index 0 once the leaf ahead of it is removed.
    const { gs, grants, store } = makeStore("flat");
    const notGroup = newGroupRow("not");
    notGroup.branches = [[]];
    gs.grant.conditions = [leaf("a"), notGroup];

    store.moveCondition(
      { grantIndex: 0, scope: "grant", path: [0] },
      { grantIndex: 0, scope: "grant", path: [1, 0, 0] },
    );

    expect(grants[0].conditions).toHaveLength(1);
    expect(grants[0].conditions[0].branches![0]).toHaveLength(1);
    expect(grants[0].conditions[0].branches![0][0].value).toBe("a");
  });

  it("is a no-op when either location doesn't resolve (stale grant/variant index)", () => {
    const { grants, store, changes } = makeMultiGrantStore(1);
    grants[0].conditions = [leaf("a")];
    const before = changes();

    store.moveCondition(
      { grantIndex: 0, scope: "grant", path: [0] },
      { grantIndex: 5, scope: "grant", path: [0] },
    );

    expect(grants[0].conditions.map((r) => r.value)).toEqual(["a"]);
    expect(changes()).toBe(before);
  });
});

describe("BonusDraftStore.moveBranch", () => {
  const leaf = (value: string) => {
    const row = newLeafRow("toggle");
    row.value = value;
    return row;
  };

  it("moves a branch from one grant's group to another grant's group", () => {
    const { grants, store, changes } = makeMultiGrantStore(2);
    const any = newGroupRow("any");
    any.branches = [[leaf("a")], [leaf("b")]];
    const all = newGroupRow("all");
    all.branches = [[leaf("c")]];
    grants[0].conditions = [any];
    grants[1].conditions = [all];
    const before = changes();

    store.moveBranch(
      { grantIndex: 0, scope: "grant", groupPath: [0], branchIndex: 0 },
      { grantIndex: 1, scope: "grant", groupPath: [0], branchIndex: 1 },
    );

    expect(grants[0].conditions[0].branches).toHaveLength(1);
    expect(grants[0].conditions[0].branches![0][0].value).toBe("b");
    expect(grants[1].conditions[0].branches).toHaveLength(2);
    expect(grants[1].conditions[0].branches!.map((b) => b[0].value)).toEqual([
      "c",
      "a",
    ]);
    expect(changes()).toBe(before + 1);
  });

  it("adjusts the target group path when moving within one tree shifts a sibling's index", () => {
    // rows = [ group(any) [ [a], [b] ], group(all) [ [c] ] ] -- dragging branch 0 out of the
    // first group shifts it from index 0 to nothing, but the second group's own row index
    // (originally 1) shifts down to 0 once the first group's branch count changes... actually
    // the group *row* index only shifts when a *row* is removed, not a branch -- this instead
    // covers a group nested inside a sibling *branch* shifting when an earlier branch of the
    // same parent group is removed.
    const { gs, grants, store } = makeStore("flat");
    const outer = newGroupRow("any");
    const innerTarget = newGroupRow("all");
    innerTarget.branches = [[leaf("x")], [leaf("y")]];
    outer.branches = [[leaf("a")], [innerTarget]];
    gs.grant.conditions = [outer];

    // Drag outer's branch 0 (the "a" leaf's branch) into innerTarget's own group -- innerTarget
    // lives at groupPath [0, 1, 0] before the removal (rows[0].branches[1][0]), which shifts
    // to [0, 0, 0] once branch 0 is spliced out from under it.
    store.moveBranch(
      { grantIndex: 0, scope: "grant", groupPath: [0], branchIndex: 0 },
      { grantIndex: 0, scope: "grant", groupPath: [0, 1, 0], branchIndex: 2 },
    );

    expect(grants[0].conditions[0].branches).toHaveLength(1);
    const shiftedInner = grants[0].conditions[0].branches![0][0];
    expect(shiftedInner.branches).toHaveLength(3);
    expect(shiftedInner.branches!.map((b) => b[0].value)).toEqual([
      "x",
      "y",
      "a",
    ]);
  });

  it("is a no-op when dragging away a group's last remaining branch", () => {
    const { grants, store, changes } = makeMultiGrantStore(2);
    const any = newGroupRow("any");
    any.branches = [[leaf("a")]];
    const all = newGroupRow("all");
    all.branches = [[leaf("c")]];
    grants[0].conditions = [any];
    grants[1].conditions = [all];
    const before = changes();

    store.moveBranch(
      { grantIndex: 0, scope: "grant", groupPath: [0], branchIndex: 0 },
      { grantIndex: 1, scope: "grant", groupPath: [0], branchIndex: 0 },
    );

    expect(grants[0].conditions[0].branches).toHaveLength(1);
    expect(grants[1].conditions[0].branches).toHaveLength(1);
    expect(changes()).toBe(before);
  });

  it("is a no-op when the target is a 'not' group (always exactly one branch)", () => {
    const { grants, store, changes } = makeMultiGrantStore(2);
    const any = newGroupRow("any");
    any.branches = [[leaf("a")], [leaf("b")]];
    const not = newGroupRow("not");
    grants[0].conditions = [any];
    grants[1].conditions = [not];
    const before = changes();

    store.moveBranch(
      { grantIndex: 0, scope: "grant", groupPath: [0], branchIndex: 0 },
      { grantIndex: 1, scope: "grant", groupPath: [0], branchIndex: 0 },
    );

    expect(grants[0].conditions[0].branches).toHaveLength(2);
    expect(grants[1].conditions[0].branches).toHaveLength(1);
    expect(changes()).toBe(before);
  });

  it("is a no-op when either location doesn't resolve (stale grant/variant index)", () => {
    const { grants, store, changes } = makeMultiGrantStore(1);
    const any = newGroupRow("any");
    any.branches = [[leaf("a")], [leaf("b")]];
    grants[0].conditions = [any];
    const before = changes();

    store.moveBranch(
      { grantIndex: 0, scope: "grant", groupPath: [0], branchIndex: 0 },
      { grantIndex: 5, scope: "grant", groupPath: [0], branchIndex: 0 },
    );

    expect(grants[0].conditions[0].branches).toHaveLength(2);
    expect(changes()).toBe(before);
  });
});

describe("BonusDraftStore bonusIds wiring", () => {
  it("setPayload('tiers') seeds the auto-created tier with the first bonus id", () => {
    const { gs } = makeStore("tiers", ["set-a", "set-b"]);
    expect(gs.grant.tiers[0].bonus).toBe("set-a");
  });
});

describe("GrantStore setPayload('problem')", () => {
  it("switches the payload and leaves the default severity/message in place", () => {
    const { gs, changes } = makeStore("problem");
    expect(gs.grant.payload).toBe("problem");
    expect(gs.grant.problemSeverity).toBe("warning");
    expect(gs.grant.problemMessage).toBe("");
    expect(gs.grant.problemLabel).toBe("");
    expect(changes()).toBe(1);
  });

  it("severity, message and label are plain draft fields, mutated directly like a tier's stat row", () => {
    const { gs } = makeStore("problem");
    gs.grant.problemSeverity = "error";
    gs.grant.problemMessage = "Wrong race";
    gs.grant.problemLabel = "Race check";
    expect(gs.grant.problemSeverity).toBe("error");
    expect(gs.grant.problemMessage).toBe("Wrong race");
    expect(gs.grant.problemLabel).toBe("Race check");
  });
});
