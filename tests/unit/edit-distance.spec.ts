import { describe, expect, it } from "vitest";
import { closest, editDistance } from "../../src/lib/edit-distance";

describe("editDistance", () => {
  it("counts inserts, deletes and substitutions", () => {
    expect(editDistance("stacks", "stacks")).toBe(0);
    expect(editDistance("stack", "stacks")).toBe(1);
    expect(editDistance("stacks", "stocks")).toBe(1);
  });

  it("counts a swap of neighbors as one edit", () => {
    expect(editDistance("stakcs", "stacks")).toBe(1);
  });
});

describe("closest", () => {
  it("suggests the nearest candidate within typo range", () => {
    expect(closest("duraton", ["duration", "enemies"])).toBe("duration");
    expect(closest("xyz", ["duration", "enemies"])).toBeNull();
  });

  it("ignores case and a candidate's leading $", () => {
    expect(closest("Stakcs", ["$stacks"])).toBe("$stacks");
  });
});
