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
      tiers: [{ pieces: { set: "s", atLeast: 1 }, stats: {} }],
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
