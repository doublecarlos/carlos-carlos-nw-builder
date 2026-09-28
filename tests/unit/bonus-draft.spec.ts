// Round-trip coverage for lib/bonus-draft.ts's `problem` payload: the same
// toDraft/toGrant/needsJson contract the flat/tiers/variants payloads already have,
// verified separately since bonus-draft-store.spec.ts only covers the GrantStore mutation
// layer, not this conversion.
import { describe, it, expect } from "vitest";
import {
  toDraft,
  toGrant,
  needsJson,
  buildDraft,
  toBonus,
  newInput,
  inputRows,
  rowsToInputs,
  duplicateInputNames,
  inputOptions,
  diffLabel,
} from "../../src/lib/bonus-draft";
import type { Bonus, Grant } from "../../src/types";

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
      tiers: [{ atLeast: 1, stats: {} }],
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

describe("bonus-draft scale", () => {
  const byScaler = { formula: 'scaler("scalers.encounterDamage")' };

  it("round-trips a single scaler() on a flat grant and stays in the form", () => {
    const grant: Grant = {
      when: { toggle: "combat" },
      stats: { outgoing_damage: 0.15 },
      scale: byScaler,
    };
    expect(needsJson(grant)).toBe(false);
    const draft = toDraft(grant);
    expect(draft.scaledBy).toBe("scalers.encounterDamage");
    expect(toGrant(draft)).toEqual(grant);
  });

  it("round-trips alongside a tiered payload, since it applies per grant", () => {
    const grant: Grant = {
      tiers: [{ atLeast: 1, stats: { outgoing_damage: 0.22 } }],
      scale: byScaler,
    };
    expect(toGrant(toDraft(grant))).toEqual(grant);
  });

  it("clearing it in the draft drops the key from the rebuilt grant", () => {
    const draft = toDraft({
      stats: { outgoing_damage: 0.15 },
      scale: byScaler,
    });
    draft.scaledBy = "";
    expect(toGrant(draft)).not.toHaveProperty("scale");
    expect(toGrant(toDraft({ stats: {} }))).not.toHaveProperty("scale");
  });

  it("any other formula, a labeled scale, tierBy or an unknown key forces JSON", () => {
    const stats = { outgoing_damage: 0.15 };
    expect(needsJson({ stats, scale: { formula: "duration / 5" } })).toBe(true);
    expect(needsJson({ stats, scale: { ...byScaler, label: "Share" } })).toBe(
      true,
    );
    expect(
      needsJson({
        tierBy: { formula: "duration" },
        tiers: [{ atLeast: 1, stats }],
      }),
    ).toBe(true);
    expect(
      needsJson({ stats, scaledBy: "scalers.encounterDamage" } as Grant),
    ).toBe(true);
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
      tiers: [{ atLeast: 1, stats: {} }],
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

describe("bonus-draft grant with an equipped.below condition", () => {
  // Regression for a real shipped bonus (db-bonuses.json's "Leveling Ability Score Warning"),
  // whose `when` uses `equipped: { tag, atLeast, below }` -- previously representable enough
  // to open in the form, but `condition-draft.ts` only ever read/wrote `atLeast`, so the
  // `below` bound silently vanished on the next round-trip.
  it("round-trips the below bound through the full grant conversion", () => {
    const grant: Grant = {
      when: {
        any: [
          { not: { equipped: { tag: "level_attr:3", atLeast: 2, below: 3 } } },
          { not: { equipped: { tag: "level_attr:6", atLeast: 2, below: 3 } } },
        ],
      },
      problem: {
        severity: "warning",
        message: "Need to select 2 Ability Score points for each level",
      },
    };
    expect(needsJson(grant)).toBe(false);
    expect(toGrant(toDraft(grant))).toEqual(grant);
  });
});

describe("bonus-draft tiers", () => {
  it("a tier ladder round-trips through the form", () => {
    const grant: Grant = {
      tiers: [
        { atLeast: 1, stats: { power: 1 } },
        { atLeast: 2, stats: { power: 2 } },
      ],
    };
    expect(needsJson(grant)).toBe(false);
    const draft = toDraft(grant);
    expect(draft.tiers.map((tier) => tier.atLeast)).toEqual([1, 2]);
    expect(toGrant(draft)).toEqual(grant);
  });

  it("a tier missing atLeast or carrying another key forces JSON", () => {
    const old = {
      tiers: [{ bonusOccurrences: { atLeast: 1 }, stats: {} }],
    } as unknown as Grant;
    expect(needsJson(old)).toBe(true);
  });
});

describe("bonus-draft inputs", () => {
  const bonus: Bonus = {
    id: "proc",
    name: "Proc",
    inputs: {
      active: { type: "boolean", default: true, label: "Proc" },
      stacks: {
        type: "number",
        min: 0,
        max: 12,
        step: 2,
        presets: [0, 6, 12],
        control: "field",
        default: 12,
      },
      share: { type: "percent", min: 0, max: 0.5, default: 0.1 },
    },
    grants: [
      { when: { input: { key: "active", is: true } }, stats: { power: 1 } },
    ],
  };

  it("round-trips a bonus's inputs and the grants reading them", () => {
    const draft = buildDraft(bonus);
    expect(draft.grants[0].mode).toBe("simple");
    expect(toBonus(draft)).toEqual(bonus);
  });

  it("writes a number's fields in declaration order", () => {
    expect(Object.keys(rowsToInputs(inputRows(bonus.inputs)).stacks)).toEqual([
      "type",
      "min",
      "max",
      "step",
      "presets",
      "control",
      "default",
    ]);
  });

  it("drops unnamed rows and omits inputs when none are named", () => {
    const draft = buildDraft({ id: "b", name: "B", grants: [] });
    draft.inputs.push(newInput());
    expect(toBonus(draft)).not.toHaveProperty("inputs");
  });

  it("keeps only a boolean's default and label after switching type", () => {
    const [row] = inputRows({
      stacks: { type: "number", min: 0, max: 3, default: 2 },
    });
    row.type = "boolean";
    row.on = true;
    expect(rowsToInputs([row])).toEqual({
      stacks: { type: "boolean", default: true },
    });
  });

  it("writes control on a number only", () => {
    const row = { ...newInput(), name: "x", type: "percent" as const };
    row.min = 0;
    row.max = 1;
    row.control = "field";
    expect(rowsToInputs([row]).x).not.toHaveProperty("control");
  });

  it("freezes the ids a saved bonus declares, not new or duplicated ones", () => {
    expect(buildDraft(bonus).inputs.every((row) => row.frozen)).toBe(true);
    expect(buildDraft(bonus, false).inputs.some((row) => row.frozen)).toBe(
      false,
    );
    expect(newInput().frozen).toBe(false);
  });

  it("reports names used twice", () => {
    const rows = ["a", "b", " a "].map((name) => ({ ...newInput(), name }));
    expect(duplicateInputNames(rows)).toEqual(["a"]);
  });

  it("offers named inputs with their type for the input leaf", () => {
    expect(inputOptions(inputRows(bonus.inputs))).toEqual([
      { value: "active", label: "Proc", type: "boolean" },
      { value: "stacks", label: "stacks", type: "number" },
      { value: "share", label: "share", type: "percent" },
    ]);
  });
});

describe("bonus-draft diffLabel", () => {
  const label = (old: Bonus, nw: Bonus) =>
    diffLabel(JSON.stringify(old), JSON.stringify(nw));
  const base: Bonus = { id: "b", name: "B", grants: [] };

  it("names an added or removed input", () => {
    const withInput: Bonus = {
      ...base,
      inputs: { active: { type: "boolean", default: false } },
    };
    expect(label(base, withInput)).toBe("add input (1)");
    expect(label(withInput, base)).toBe("remove input (1)");
  });

  it("names the input whose declaration changed", () => {
    const old: Bonus = {
      ...base,
      inputs: { active: { type: "boolean", default: false } },
    };
    const nw: Bonus = {
      ...base,
      inputs: { active: { type: "boolean", default: true } },
    };
    expect(label(old, nw)).toBe('edit input "active"');
  });

  it("keeps the excludes labels", () => {
    expect(label(base, { ...base, excludes: ["x", "y"] })).toBe(
      "add excludes (2)",
    );
  });
});
