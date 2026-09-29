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
  newNamedFormula,
  rowsToNamedFormulas,
  duplicateFormulaNames,
  formulaOwner,
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

  it("round-trips any formula and its label on a flat grant", () => {
    const grant: Grant = {
      when: { toggle: "combat" },
      stats: { strike_p: 0.018 },
      scale: { formula: "min(floor(duration / 5), 5)", label: "Stacks" },
    };
    expect(needsJson(grant)).toBe(false);
    const draft = toDraft(grant);
    expect(draft.scale).toEqual({
      formula: "min(floor(duration / 5), 5)",
      label: "Stacks",
    });
    expect(toGrant(draft)).toEqual(grant);
  });

  it("round-trips alongside a tiered payload, since it applies per grant", () => {
    const grant: Grant = {
      tiers: [{ atLeast: 1, stats: { outgoing_damage: 0.22 } }],
      scale: byScaler,
    };
    expect(toGrant(toDraft(grant))).toEqual(grant);
  });

  it("clearing the formula drops the key, and a blank label is left out", () => {
    const draft = toDraft({
      stats: { outgoing_damage: 0.15 },
      scale: byScaler,
    });
    draft.scale.label = "  ";
    expect(toGrant(draft).scale).toEqual(byScaler);
    draft.scale.formula = " ";
    expect(toGrant(draft)).not.toHaveProperty("scale");
    expect(toGrant(toDraft({ stats: {} }))).not.toHaveProperty("scale");
  });

  it("round-trips a step ladder hint, dropped with the formula or a cleared axis", () => {
    const grant: Grant = {
      stats: { strike_p: 0.018 },
      scale: {
        formula: "clamp(floor(duration / 5), 0, 5)",
        steps: { over: "duration", min: 0, max: 25, step: 5 },
      },
    };
    expect(needsJson(grant)).toBe(false);
    const draft = toDraft(grant);
    expect(toGrant(draft)).toEqual(grant);
    draft.scaleSteps.over = " ";
    expect(toGrant(draft).scale).not.toHaveProperty("steps");
    draft.scaleSteps.over = "duration";
    draft.scale.formula = "";
    expect(toGrant(draft)).not.toHaveProperty("scale");
  });

  it("fills a cleared step number from the others", () => {
    const draft = toDraft({ stats: {}, scale: { formula: "$n" } });
    draft.scaleSteps = { over: "$n", min: 2, max: "", step: null };
    expect(toGrant(draft).scale?.steps).toEqual({
      over: "$n",
      min: 2,
      max: 2,
      step: 1,
    });
  });

  it("saves steps on a flat payload only, keeping them in the draft", () => {
    const draft = toDraft({
      stats: {},
      scale: {
        formula: "duration",
        steps: { over: "duration", min: 0, max: 5, step: 1 },
      },
    });
    draft.payload = "tiers";
    expect(toGrant(draft).scale).toEqual({ formula: "duration" });
    draft.payload = "flat";
    expect(toGrant(draft).scale?.steps).toEqual({
      over: "duration",
      min: 0,
      max: 5,
      step: 1,
    });
  });

  it("steps beside a tiered payload force JSON rather than being dropped", () => {
    expect(
      needsJson({
        tiers: [{ atLeast: 1, stats: {} }],
        scale: {
          formula: "duration",
          steps: { over: "duration", min: 0, max: 5, step: 1 },
        },
      }),
    ).toBe(true);
  });

  it("an unknown steps key forces JSON", () => {
    expect(
      needsJson({
        stats: {},
        scale: {
          formula: "duration",
          steps: { over: "duration", min: 0, max: 5, step: 1, extra: 1 },
        },
      } as unknown as Grant),
    ).toBe(true);
  });

  it("a malformed formula or an unknown key forces JSON", () => {
    const stats = { outgoing_damage: 0.15 };
    expect(
      needsJson({ stats, scale: { formula: 3 } } as unknown as Grant),
    ).toBe(true);
    expect(
      needsJson({
        stats,
        scale: { ...byScaler, extra: 1 },
      } as unknown as Grant),
    ).toBe(true);
    expect(needsJson({ stats, scale: "duration" } as unknown as Grant)).toBe(
      true,
    );
    expect(
      needsJson({ stats, scaledBy: "scalers.encounterDamage" } as Grant),
    ).toBe(true);
  });
});

describe("bonus-draft tierBy", () => {
  const tiers = [
    { atLeast: 1, stats: { strike_p: 0.018 } },
    { atLeast: 3, stats: { strike_p: 0.054 } },
  ];

  it("round-trips on a tiered grant", () => {
    const grant: Grant = { tierBy: { formula: "$stacks" }, tiers };
    expect(needsJson(grant)).toBe(false);
    const draft = toDraft(grant);
    expect(draft.tierBy).toEqual({ formula: "$stacks", label: "" });
    expect(toGrant(draft)).toEqual(grant);
  });

  it("is dropped once the payload is no longer tiered", () => {
    const draft = toDraft({ tierBy: { formula: "$stacks" }, tiers });
    draft.payload = "flat";
    expect(toGrant(draft)).not.toHaveProperty("tierBy");
  });

  it("without tiers forces JSON, since the form would drop it", () => {
    expect(needsJson({ tierBy: { formula: "1" }, stats: {} })).toBe(true);
  });

  it("keeps a threshold of 0 or below, and reads a cleared one as 1", () => {
    const grant: Grant = {
      tierBy: { formula: "$stacks" },
      tiers: [
        { atLeast: -1, stats: {} },
        { atLeast: 0, stats: {} },
        { atLeast: 3, stats: {} },
      ],
    };
    expect(toGrant(toDraft(grant))).toEqual(grant);

    const draft = toDraft(grant);
    // What a cleared number field binds through `v-model.number`.
    (draft.tiers[2] as { atLeast: number | string }).atLeast = "";
    expect(toGrant(draft).tiers?.map((tier) => tier.atLeast)).toEqual([
      -1, 0, 1,
    ]);
  });
});

describe("bonus-draft named formulas", () => {
  const formulas = {
    stacks: { formula: "min(floor(duration / 5), 5)", label: "Stacks" },
    half: { formula: "$stacks / 2" },
  };

  it("round-trip through the bonus draft", () => {
    const bonus: Bonus = { id: "b", name: "B", formulas, grants: [] };
    const draft = buildDraft(bonus);
    expect(draft.formulas).toEqual([
      { name: "stacks", formula: formulas.stacks.formula, label: "Stacks" },
      { name: "half", formula: "$stacks / 2", label: "" },
    ]);
    expect(toBonus(draft)).toEqual(bonus);
  });

  it("drop unnamed rows and keep a named one with no formula", () => {
    expect(
      rowsToNamedFormulas([
        { ...newNamedFormula(), formula: "1" },
        { ...newNamedFormula(), name: "empty" },
      ]),
    ).toEqual({ empty: { formula: "" } });
  });

  it("report names given twice", () => {
    expect(
      duplicateFormulaNames([
        { ...newNamedFormula(), name: "a" },
        { ...newNamedFormula(), name: " a " },
        { ...newNamedFormula(), name: "b" },
      ]),
    ).toEqual(["a"]);
  });

  it("are what the draft's formulas read, with its inputs", () => {
    const draft = buildDraft({
      id: "b",
      name: "B",
      formulas,
      inputs: { n: { type: "number", default: 2 } },
      grants: [],
    });
    expect(formulaOwner(draft, "b")).toEqual({
      id: "b",
      inputs: { n: { type: "number", default: 2 } },
      formulas,
    });
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

  it("edits a percent input's presets in percent, stored as decimals", () => {
    const [row] = inputRows({
      share: { type: "percent", default: 0.1, presets: [0.1, 0.036] },
    });
    expect(row.presets).toBe("10, 3.6");
    row.presets = "25%, 3.6";
    expect(rowsToInputs([row]).share.presets).toEqual([0.25, 0.036]);
  });

  it("leaves a number input's presets as typed", () => {
    const [row] = inputRows({
      stacks: { type: "number", default: 0, presets: [1, 5] },
    });
    expect(row.presets).toBe("1, 5");
    expect(rowsToInputs([row]).stacks.presets).toEqual([1, 5]);
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

  it("names an added, removed or edited formula by its reference", () => {
    const withFormula: Bonus = {
      ...base,
      formulas: { stacks: { formula: "duration / 5" } },
    };
    expect(label(base, withFormula)).toBe("add formula (1)");
    expect(label(withFormula, base)).toBe("remove formula (1)");
    expect(
      label(withFormula, {
        ...base,
        formulas: { stacks: { formula: "duration / 5", label: "Stacks" } },
      }),
    ).toBe("edit formula $stacks");
  });

  it("keeps the excludes labels", () => {
    expect(label(base, { ...base, excludes: ["x", "y"] })).toBe(
      "add excludes (2)",
    );
  });
});
