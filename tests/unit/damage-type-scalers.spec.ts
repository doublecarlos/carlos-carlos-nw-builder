// The three shipped entries that store a real game value and reach a damage-type share
// through `scaledBy`: Warlock's Curse (one grant per power type), Risky Investment (a Soul
// Investiture stack ladder, encounters only) and the Sturdy Crescent Collar (encounters
// only). Resolved against the shipped catalog on a Hellbringer build so the gates each entry
// carries (class, paragon, combat) are the real ones.

import { describe, it, expect } from "vitest";
import { fromData } from "../../src/data/db";
import * as engine from "../../src/engine/engine";
import { storedListRows } from "../../src/lib/item-picker-list";
import type { Build } from "../../src/types";

const shipped = fromData();

const CHOICES = {
  "options.class": "class-warlock",
  "options.paragon": "paragon-hellbringer",
  "classStuff.feat2": "warlock-s-curse",
  "classStuff.feat3": "risky-investment",
  "mounts.sturdyCollar": "sturdy-crescent-collar",
};

/** A rotation that is 40% encounters, 5% at-wills and 5% dailies: the weights the old
 *  pre-multiplied catalog values assumed, so the shipped numbers reproduce them. */
const SHARES = { encounterDamage: 0.4, atWillDamage: 0.05, dailyDamage: 0.05 };

function resolve(
  context: Record<string, unknown> = {},
  occurrenceInputs: Build["occurrenceInputs"] = {},
) {
  return engine.resolveBuild(shipped, {
    id: "b",
    name: "b",
    choices: CHOICES,
    values: {},
    assignments: {},
    occurrenceInputs,
    listRows: storedListRows({
      choices: CHOICES,
      values: {},
      assignments: {},
      disabledSlots: {},
    }),
    context: { role: "dps", forte: {}, toggles: { combat: true }, ...context },
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  } as unknown as Build);
}

function bonusStats(result: ReturnType<typeof resolve>, id: string) {
  const entry = result.bonuses.find((b) => b.bonusId === id);
  expect(entry?.active, `${id} active`).toBe(true);
  return entry!.appliedStats!;
}

const FIVE_STACKS = { "risky-investment": { "risky-investment": 5 } };

describe("shipped damage-type scaled entries", () => {
  it("reproduce the old pre-multiplied values at the weights those assumed", () => {
    const result = resolve({ scalers: SHARES }, FIVE_STACKS);
    // 0.30 at five stacks x 0.40 encounters.
    expect(bonusStats(result, "risky-investment").outgoing_damage).toBeCloseTo(
      0.12,
      9,
    );
    // 0.05 x 0.40 encounters.
    expect(
      bonusStats(result, "sturdy-crescent-collar").outgoing_damage_mult,
    ).toBeCloseTo(0.02, 9);
    // 0.15 x (0.40 + 0.05 + 0.05): the three power-type grants summed.
    expect(bonusStats(result, "warlock-s-curse").outgoing_damage).toBeCloseTo(
      0.075,
      9,
    );
  });

  it("contribute nothing at the default shares of 0", () => {
    const result = resolve({}, FIVE_STACKS);
    expect(bonusStats(result, "risky-investment").outgoing_damage).toBe(0);
    expect(
      bonusStats(result, "sturdy-crescent-collar").outgoing_damage_mult,
    ).toBe(0);
    expect(bonusStats(result, "warlock-s-curse").outgoing_damage).toBe(0);
  });

  it("give Risky Investment nothing at zero Soul Investiture stacks", () => {
    const result = resolve({ scalers: SHARES });
    const entry = result.bonuses.find((b) => b.bonusId === "risky-investment");
    expect(entry?.active).toBe(false);
    expect(entry?.appliedStats).toBeNull();
  });

  it("climb Risky Investment's ladder two points per stack", () => {
    const at = (stacks: number) =>
      bonusStats(
        resolve(
          { scalers: { encounterDamage: 1 } },
          {
            "risky-investment": { "risky-investment": stacks },
          },
        ),
        "risky-investment",
      ).outgoing_damage;
    expect([1, 2, 3, 4, 5].map(at)).toEqual([0.22, 0.24, 0.26, 0.28, 0.3]);
  });

  it("keep the collar's item level and combined rating as unscaled item stats", () => {
    const collar = shipped.get("sturdy-crescent-collar")!;
    expect(collar.il).toBe(1000);
    expect(collar.combined_rating).toBe(900);
    expect(collar).not.toHaveProperty("outgoing_damage_mult");
  });
});
