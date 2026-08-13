// Round-trip coverage for engine/bonus-draft.ts's `problem` payload: the same
// toDraft/toGrant/needsJson contract the flat/tiers/variants payloads already have,
// verified separately since bonus-draft-store.spec.ts only covers the GrantStore mutation
// layer, not this conversion.
import { describe, it, expect } from "vitest";
import { toDraft, toGrant, needsJson } from "../../src/engine/bonus-draft";
import type { Grant } from "../../src/types";

describe("bonus-draft problem payload", () => {
  it("a simple problem grant round-trips through the form, not JSON", () => {
    const grant: Grant = {
      when: { class: "fighter" },
      problem: { severity: "warning", message: "Needs 10 tier 1 points" },
    };
    expect(needsJson(grant)).toBe(false);

    const draft = toDraft(grant);
    expect(draft.mode).toBe("simple");
    expect(draft.payload).toBe("problem");
    expect(draft.problemSeverity).toBe("warning");
    expect(draft.problemMessage).toBe("Needs 10 tier 1 points");

    expect(toGrant(draft)).toEqual(grant);
  });

  it("an error-severity problem grant round-trips the same way", () => {
    const grant: Grant = {
      problem: { severity: "error", message: "Race bonus mismatch" },
    };
    const draft = toDraft(grant);
    expect(draft.payload).toBe("problem");
    expect(draft.problemSeverity).toBe("error");
    expect(toGrant(draft)).toEqual(grant);
  });

  it("a problem grant with a label round-trips it, and omits it entirely when blank", () => {
    const labeled: Grant = {
      problem: {
        severity: "warning",
        message: "Spend more on tier 1 boons",
        label: "Boon progression",
      },
    };
    const draft = toDraft(labeled);
    expect(draft.problemLabel).toBe("Boon progression");
    expect(toGrant(draft)).toEqual(labeled);

    const unlabeled: Grant = {
      problem: { severity: "warning", message: "Spend more on tier 1 boons" },
    };
    expect(toDraft(unlabeled).problemLabel).toBe("");
    expect(toGrant(toDraft(unlabeled))).toEqual(unlabeled);
    expect(toGrant(toDraft(unlabeled)).problem).not.toHaveProperty("label");
  });

  it("a problem grant's hideFromPicker flag round-trips, and is omitted when unset", () => {
    const hidden: Grant = {
      problem: {
        severity: "error",
        message: "Not usable while a shard is equipped",
        hideFromPicker: true,
      },
    };
    const draft = toDraft(hidden);
    expect(draft.problemHideFromPicker).toBe(true);
    expect(toGrant(draft)).toEqual(hidden);

    const shown: Grant = {
      problem: {
        severity: "error",
        message: "Not usable while a shard is equipped",
      },
    };
    expect(toDraft(shown).problemHideFromPicker).toBe(false);
    expect(toGrant(toDraft(shown))).toEqual(shown);
    expect(toGrant(toDraft(shown)).problem).not.toHaveProperty(
      "hideFromPicker",
    );
  });

  it("a grant with no condition still round-trips (always active)", () => {
    const grant: Grant = {
      problem: { severity: "warning", message: "Always shown" },
    };
    expect(needsJson(grant)).toBe(false);
    expect(toGrant(toDraft(grant))).toEqual(grant);
  });

  it("problem combined with tiers or variants falls through to JSON, same as tiers+variants does", () => {
    const withTiers: Grant = {
      problem: { severity: "error", message: "x" },
      tiers: [{ bonusOccurrences: { bonus: "s", atLeast: 1 }, stats: {} }],
    };
    expect(needsJson(withTiers)).toBe(true);

    const withVariants: Grant = {
      problem: { severity: "error", message: "x" },
      variants: [{ stats: {} }],
    };
    expect(needsJson(withVariants)).toBe(true);
  });

  it("an unrecognized severity or an extra field forces JSON mode", () => {
    const badSeverity = {
      problem: { severity: "critical", message: "x" },
    } as unknown as Grant;
    expect(needsJson(badSeverity)).toBe(true);

    const extraField = {
      problem: { severity: "error", message: "x", icon: "boom" },
    } as unknown as Grant;
    expect(needsJson(extraField)).toBe(true);
  });

  it("toDraft defaults an empty grant's problem fields to a warning with no message", () => {
    const draft = toDraft({ stats: {} });
    expect(draft.problemSeverity).toBe("warning");
    expect(draft.problemMessage).toBe("");
  });
});

describe("bonus-draft short/long description", () => {
  it("round-trips both fields on a flat-payload grant", () => {
    const grant: Grant = {
      stats: { ap: 300 },
      shortDescription: "AP when killing mobs",
      longDescription: "When you kill an enemy, gain 3% Action Points.",
    };
    expect(needsJson(grant)).toBe(false);

    const draft = toDraft(grant);
    expect(draft.shortDescription).toBe("AP when killing mobs");
    expect(draft.longDescription).toBe(
      "When you kill an enemy, gain 3% Action Points.",
    );
    expect(toGrant(draft)).toEqual(grant);
  });

  it("omits both fields entirely when blank", () => {
    const grant: Grant = { stats: { ap: 300 } };
    const draft = toDraft(grant);
    expect(draft.shortDescription).toBe("");
    expect(draft.longDescription).toBe("");
    const result = toGrant(draft);
    expect(result).not.toHaveProperty("shortDescription");
    expect(result).not.toHaveProperty("longDescription");
  });

  it("round-trips on a problem-payload grant too, alongside its own fields", () => {
    const grant: Grant = {
      problem: { severity: "warning", message: "Needs 10 tier 1 points" },
      shortDescription: "short",
      longDescription: "long",
    };
    expect(needsJson(grant)).toBe(false);
    expect(toGrant(toDraft(grant))).toEqual(grant);
  });
});

describe("bonus-draft dynamic stats", () => {
  it("a flat grant with dynamicStats round-trips through the form, not JSON", () => {
    const grant: Grant = {
      stats: { power: 100 },
      dynamicStats: [{ stat: "critChance", min: 0, max: 5, default: 3 }],
    };
    expect(needsJson(grant)).toBe(false);

    const draft = toDraft(grant);
    expect(draft.mode).toBe("simple");
    expect(draft.payload).toBe("flat");
    expect(draft.dynamicStats).toEqual([
      { stat: "critChance", min: 0, max: 5, default: 3, label: "" },
    ]);

    expect(toGrant(draft)).toEqual(grant);
  });

  it("a dynamicStats label round-trips, and is omitted entirely when blank", () => {
    const grant: Grant = {
      stats: {},
      dynamicStats: [
        { stat: "power", min: 0, max: 10, default: 5, label: "Custom label" },
      ],
    };
    const draft = toDraft(grant);
    expect(draft.dynamicStats[0].label).toBe("Custom label");
    expect(toGrant(draft)).toEqual(grant);

    const unlabeled = toGrant(toDraft({ stats: {}, dynamicStats: [] }));
    expect(unlabeled).not.toHaveProperty("dynamicStats");
  });

  it("a variant's own dynamicStats round-trips independently of the grant's", () => {
    const grant: Grant = {
      variants: [
        {
          when: { class: "fighter" },
          stats: { power: 50 },
          dynamicStats: [{ stat: "ap", min: 0, max: 3, default: 1 }],
        },
        { stats: { power: 25 } },
      ],
    };
    expect(needsJson(grant)).toBe(false);

    const draft = toDraft(grant);
    expect(draft.variants[0].dynamicStats).toEqual([
      { stat: "ap", min: 0, max: 3, default: 1, label: "" },
    ]);
    expect(draft.variants[1].dynamicStats).toEqual([]);

    expect(toGrant(draft)).toEqual(grant);
  });

  it("dynamicStats combined with tiers, variants, or problem on the same grant forces JSON", () => {
    const withTiers: Grant = {
      dynamicStats: [{ stat: "power", min: 0, max: 5, default: 1 }],
      tiers: [{ bonusOccurrences: { bonus: "s", atLeast: 1 }, stats: {} }],
    };
    expect(needsJson(withTiers)).toBe(true);

    const withVariants: Grant = {
      dynamicStats: [{ stat: "power", min: 0, max: 5, default: 1 }],
      variants: [{ stats: {} }],
    };
    expect(needsJson(withVariants)).toBe(true);

    const withProblem: Grant = {
      dynamicStats: [{ stat: "power", min: 0, max: 5, default: 1 }],
      problem: { severity: "warning", message: "x" },
    };
    expect(needsJson(withProblem)).toBe(true);
  });

  it("an unrecognized key on a variant (other than when/stats/dynamicStats) forces JSON", () => {
    const grant = {
      variants: [{ stats: {}, icon: "boom" }],
    } as unknown as Grant;
    expect(needsJson(grant)).toBe(true);
  });
});
