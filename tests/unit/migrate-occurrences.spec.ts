import { describe, expect, it } from "vitest";
import { migrateOccurrenceInputs } from "../../src/storage/migrate-occurrences";
import { NW_BONUSES } from "../../src/data/data";

describe("migrateOccurrenceInputs", () => {
  it("turns a 0-1 count into a boolean input", () => {
    expect(
      migrateOccurrenceInputs(
        {
          "accursed-resolve": { "accursed-resolve": 1 },
          "class-fighter": { "fighter-s-unshakable-shieldarm": 0 },
        },
        {},
      ),
    ).toEqual({
      "accursed-resolve": { input: { active: true } },
      "fighter-s-unshakable-shieldarm": { input: { active: false } },
    });
  });

  it("keeps a stack count as a number input", () => {
    expect(
      migrateOccurrenceInputs({ "frigid-winds": { "frigid-winds-2": 3 } }, {}),
    ).toEqual({ "frigid-winds-2": { input: { chill: 3 } } });
  });

  it("lets a stored input win and keeps the bonus's other values", () => {
    const bonusValues = {
      "pack-tactics": { stat: { Power: 10 }, input: { stacks: 4 } },
      "masterwork-sets": { stat: { Power: 5 } },
    };
    expect(
      migrateOccurrenceInputs(
        {
          "pack-tactics-group": { "pack-tactics": 2 },
          "masterwork-sets-2": { "masterwork-sets": 3 },
        },
        bonusValues,
      ),
    ).toEqual({
      "pack-tactics": { stat: { Power: 10 }, input: { stacks: 4 } },
      "masterwork-sets": { stat: { Power: 5 }, input: { stacks: 3 } },
    });
    expect(bonusValues["masterwork-sets"]).not.toHaveProperty("input");
  });

  it("drops unknown bonuses and malformed counts", () => {
    expect(
      migrateOccurrenceInputs(
        {
          ring: { "some-bonus": 3, "accursed-resolve": "1" },
          broken: 5,
        },
        {},
      ),
    ).toEqual({});
    expect(migrateOccurrenceInputs(null, {})).toEqual({});
  });

  // Guards the frozen table against the catalog drifting away from it.
  it("targets inputs the shipped bonuses still declare", () => {
    const bonuses = new Map(NW_BONUSES.map((bonus) => [bonus.id, bonus]));
    const targets = migrateOccurrenceInputs(
      Object.fromEntries([...bonuses.keys()].map((id) => [id, { [id]: 1 }])),
      {},
    );
    expect(Object.keys(targets)).toHaveLength(30);
    for (const [bonusId, { input }] of Object.entries(targets)) {
      const [key, value] = Object.entries(input ?? {})[0]!;
      const spec = bonuses.get(bonusId)?.inputs?.[key];
      expect(spec, `${bonusId}.${key}`).toBeDefined();
      expect(spec?.type).toBe(
        typeof value === "boolean" ? "boolean" : "number",
      );
    }
  });
});
