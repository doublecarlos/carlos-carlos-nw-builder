// The one-line stand-in for a folded grant in the bonus form.
import { describe, it, expect } from "vitest";
import { grantSummary, toDraft } from "../../src/lib/bonus-draft";

describe("grantSummary", () => {
  it("prefers the grant's own name", () => {
    expect(grantSummary(toDraft({ name: "Rage", stats: { power: 1 } }))).toBe(
      "Rage",
    );
  });

  it("counts a flat payload's stats", () => {
    expect(grantSummary(toDraft({ stats: { power: 1, crit: 2 } }))).toBe(
      "2 stats",
    );
    expect(grantSummary(toDraft({ stats: {} }))).toBe("0 stats");
  });

  it("names dynamic stats alone when there are no plain ones", () => {
    const draft = toDraft({ stats: {} });
    draft.dynamicStats.push({
      stat: "power",
      min: 0,
      max: 10,
      default: 0,
      label: "",
    });
    expect(grantSummary(draft)).toBe("1 dynamic stat");
  });

  it("counts tiers and variants", () => {
    expect(
      grantSummary(
        toDraft({
          tiers: [
            { atLeast: 1, stats: { power: 1 } },
            { atLeast: 2, stats: { power: 2 } },
          ],
        }),
      ),
    ).toBe("2 tiers");
    expect(grantSummary(toDraft({ variants: [{ stats: { power: 1 } }] }))).toBe(
      "1 variant",
    );
  });

  it("reads a problem as its severity and message", () => {
    expect(
      grantSummary(
        toDraft({ problem: { severity: "error", message: "Too many" } }),
      ),
    ).toBe("error: Too many");
  });

  it("notes a condition and the scale, preferring the scale's label", () => {
    expect(
      grantSummary(
        toDraft({
          when: { class: "fighter" },
          stats: { power: 1 },
          scale: { formula: "$stacks", label: "Stacks" },
        }),
      ),
    ).toBe("1 stat, conditional, scaled by Stacks");
  });

  it("says a JSON grant is edited as JSON", () => {
    const draft = toDraft({ stats: { power: 1 } });
    draft.mode = "json";
    expect(grantSummary(draft)).toBe("edited as JSON");
  });
});
