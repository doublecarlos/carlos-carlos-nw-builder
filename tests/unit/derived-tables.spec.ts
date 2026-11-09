// The summary's stored case per table: a case the table no longer lists falls back to the
// average rather than showing a row that reads zero.
import { describe, expect, it } from "vitest";
import { summaryCase, type DerivedTable } from "../../src/lib/derived-tables";

const table: DerivedTable = {
  source: "healing",
  label: "Healing",
  rows: [
    ["Average", "average"],
    ["Crit", "crit"],
  ],
};

describe("summaryCase", () => {
  it("keeps a case the table lists", () => {
    expect(summaryCase(table, "crit")).toBe("crit");
  });

  it("falls back to the average for anything else", () => {
    expect(summaryCase(table, "critDeflect")).toBe("average");
    expect(summaryCase(table, undefined)).toBe("average");
  });
});
