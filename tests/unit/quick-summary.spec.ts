// The collapsed quick options band's summary line: values read in order and toggles fold
// into one count, so the line stays short however many toggles a catalog marks quick.
import { describe, expect, it } from "vitest";
import { quickSummary } from "../../src/lib/quick-summary";

describe("quickSummary", () => {
  it("lists values in order and counts the toggles that are on", () => {
    expect(
      quickSummary([
        { label: "Enemies", value: "3" },
        { label: "A", value: true },
        { label: "Duration", value: "30" },
        { label: "B", value: false },
        { label: "C", value: true },
      ]),
    ).toBe("Enemies 3 · Duration 30 · 2/3 toggles on");
  });

  it("leaves the toggle count out when there are no toggles", () => {
    expect(quickSummary([{ label: "Enemies", value: "1" }])).toBe("Enemies 1");
  });
});
