// This build's lead over the compare build, as the summary and the damage, healing and EHP
// tables print it: signed, relative to the compare build, green ahead and red behind.
import { describe, expect, it } from "vitest";
import { delta, relativeChange, signedPct } from "../../src/lib/compare-delta";

describe("delta", () => {
  it("reads this build's value as a share of the compare build's", () => {
    expect(delta(250, 200).text).toBe(signedPct(0.25));
    expect(delta(150, 200).text).toBe(signedPct(-0.25));
  });

  it("is ahead when bigger and behind when smaller", () => {
    expect(delta(250, 200).trend).toBe("ahead");
    expect(delta(150, 200).trend).toBe("behind");
  });

  it("is plain when even or when there is no share of zero to take", () => {
    expect(delta(100, 100)).toEqual({ text: "-", trend: "even" });
    expect(delta(120, 0)).toEqual({ text: "-", trend: "even" });
    expect(delta(120, null)).toEqual({ text: "-", trend: "even" });
  });
});

describe("relativeChange", () => {
  it("is positive when the value is the bigger one", () => {
    expect(relativeChange(100, 110)).toBeCloseTo(0.1);
    expect(relativeChange(100, 90)).toBeCloseTo(-0.1);
  });
});
