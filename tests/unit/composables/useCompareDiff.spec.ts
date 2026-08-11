// occurrenceDiffers/occurrenceDiffTitle (#218): whether an item's BonusOccurrenceConfig counts
// differ from the compare build, and a display string for what the compare build's counts are.
// Pure functions, so exercised directly rather than through the full useCompareDiff() setup
// (db/build/result/compareBuild/compareResult/itemIn) the rest of that module needs.
import { describe, it, expect } from "vitest";
import {
  occurrenceDiffers,
  occurrenceDiffTitle,
} from "../../../src/composables/useCompareDiff";
import type { Build, Db, Item } from "../../../src/types";

const item: Item = {
  id: "test-ring",
  name: "Test Ring",
  filter: "gear_ring",
  bonuses: [
    { bonus: "stack-bonus", min: 0, max: 5, default: 0 },
    { bonus: "fixed-bonus", min: 3, max: 3, default: 3 },
  ],
};

const db = {
  bonusById: new Map([
    ["stack-bonus", { id: "stack-bonus", name: "Stack Bonus" }],
    ["fixed-bonus", { id: "fixed-bonus", name: "Fixed Bonus" }],
  ]),
} as unknown as Db;

function build(occurrenceInputs: Record<string, Record<string, number>>) {
  return { occurrenceInputs } as unknown as Build;
}

describe("occurrenceDiffers", () => {
  it("is false with no compare build", () => {
    expect(occurrenceDiffers(item, build({}), null)).toBe(false);
  });

  it("is false with no item", () => {
    expect(occurrenceDiffers(null, build({}), build({}))).toBe(false);
  });

  it("is false when both builds fall back to the config's own default", () => {
    expect(occurrenceDiffers(item, build({}), build({}))).toBe(false);
  });

  it("is true when one build has an explicit count and the other doesn't", () => {
    const here = build({ "test-ring": { "stack-bonus": 3 } });
    const there = build({});
    expect(occurrenceDiffers(item, here, there)).toBe(true);
  });

  it("is false when both builds carry the same explicit count", () => {
    const here = build({ "test-ring": { "stack-bonus": 3 } });
    const there = build({ "test-ring": { "stack-bonus": 3 } });
    expect(occurrenceDiffers(item, here, there)).toBe(false);
  });

  it("ignores a fixed (min === max) attachment entirely", () => {
    // fixed-bonus has no player-set count to differ on -- only stack-bonus should matter.
    const here = build({ "test-ring": { "fixed-bonus": 3 } });
    const there = build({ "test-ring": { "fixed-bonus": 3 } });
    expect(occurrenceDiffers(item, here, there)).toBe(false);
  });
});

describe("occurrenceDiffTitle", () => {
  it("is undefined with no compare build", () => {
    expect(occurrenceDiffTitle(db, item, null)).toBeUndefined();
  });

  it("lists the compare build's count for each non-fixed attachment, by bonus name", () => {
    const there = build({ "test-ring": { "stack-bonus": 4 } });
    expect(occurrenceDiffTitle(db, item, there)).toBe("Stack Bonus 4");
  });

  it("falls back to the config's own default for a bonus the compare build never touched", () => {
    const there = build({});
    expect(occurrenceDiffTitle(db, item, there)).toBe("Stack Bonus 0");
  });

  it("falls back to the raw bonus id when the bonus has no name", () => {
    const unnamed: Item = {
      id: "other-ring",
      name: "Other Ring",
      filter: "gear_ring",
      bonuses: [{ bonus: "unnamed-bonus", min: 0, max: 2, default: 0 }],
    };
    const there = build({});
    expect(occurrenceDiffTitle(db, unnamed, there)).toBe("unnamed-bonus 0");
  });
});
