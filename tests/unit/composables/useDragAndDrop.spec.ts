// Only the pure resolution helpers are covered here. useDragHandle/useDropList's pointer and
// registry machinery needs a real DOM, which Vitest's `environment: "node"` lacks, so
// Playwright covers it.
import { describe, it, expect } from "vitest";
import {
  resolveTarget,
  separatorTop,
  autoscrollDelta,
  reorderIndex,
} from "../../../src/composables/useDragAndDrop";

function row(top: number, bottom: number, into = false) {
  return { top, bottom, into };
}

describe("resolveTarget", () => {
  it("above every row's midpoint resolves to gap 0", () => {
    const rows = [row(0, 10), row(10, 20), row(20, 30)];
    expect(resolveTarget(rows, -5)).toEqual({ zone: "gap", gap: 0 });
    expect(resolveTarget(rows, 4)).toEqual({ zone: "gap", gap: 0 });
  });

  it("below every row's midpoint resolves to gap N", () => {
    const rows = [row(0, 10), row(10, 20), row(20, 30)];
    expect(resolveTarget(rows, 26)).toEqual({ zone: "gap", gap: 3 });
    expect(resolveTarget(rows, 100)).toEqual({ zone: "gap", gap: 3 });
  });

  it("a gap's boundary is exactly at the midpoint between two rows", () => {
    // Rows span 0..10 and 10..20. Both sides of the gap resolve to gap 1; a row's own
    // midpoint tips into the next gap.
    const rows = [row(0, 10), row(10, 20)];
    expect(resolveTarget(rows, 14.9)).toEqual({ zone: "gap", gap: 1 });
    expect(resolveTarget(rows, 15)).toEqual({ zone: "gap", gap: 1 });
    expect(resolveTarget(rows, 15.1)).toEqual({ zone: "gap", gap: 2 });
  });

  it("the middle half of an into-row's height resolves to into", () => {
    const rows = [row(0, 100, true)];
    expect(resolveTarget(rows, 25)).toEqual({ zone: "into", index: 0 });
    expect(resolveTarget(rows, 50)).toEqual({ zone: "into", index: 0 });
    expect(resolveTarget(rows, 74)).toEqual({ zone: "into", index: 0 });
  });

  it("the outer quarters of an into-row still resolve to a gap", () => {
    const rows = [row(0, 100, true)];
    expect(resolveTarget(rows, 24)).toEqual({ zone: "gap", gap: 0 });
    expect(resolveTarget(rows, 75)).toEqual({ zone: "gap", gap: 1 });
  });

  it("a non-into row never returns an into zone", () => {
    const rows = [row(0, 100, false)];
    expect(resolveTarget(rows, 50)).toEqual({ zone: "gap", gap: 0 });
  });

  it("an empty list resolves to gap 0", () => {
    expect(resolveTarget([], 500)).toEqual({ zone: "gap", gap: 0 });
  });
});

describe("separatorTop", () => {
  it("sits at the midpoint of an inner gap", () => {
    const rows = [row(0, 10), row(20, 30)];
    // Gap 1 sits between bottom 10 and top 20, so midpoint 15.
    expect(separatorTop(rows, 1, 30, 0)).toBe(15);
  });

  it("gap 0 sits at the first row's own top", () => {
    const rows = [row(10, 20), row(30, 40)];
    expect(separatorTop(rows, 0, 40, 0)).toBe(10);
  });

  it("gap N sits at the list's content bottom", () => {
    const rows = [row(0, 10), row(10, 20)];
    expect(separatorTop(rows, 2, 45, 0)).toBe(45);
  });

  it("is reported relative to the given listTop", () => {
    const rows = [row(100, 110), row(120, 130)];
    expect(separatorTop(rows, 1, 150, 100)).toBe(15);
  });
});

describe("autoscrollDelta", () => {
  it("is 0 right at the edge of the zone or beyond", () => {
    expect(autoscrollDelta(24, 24, 12)).toBe(0);
    expect(autoscrollDelta(-24, 24, 12)).toBe(0);
    expect(autoscrollDelta(100, 24, 12)).toBe(0);
  });

  it("is negative near the top edge, positive near the bottom edge", () => {
    expect(autoscrollDelta(-10, 24, 12)).toBeLessThan(0);
    expect(autoscrollDelta(10, 24, 12)).toBeGreaterThan(0);
  });

  it("caps at maxSpeed right at the edge", () => {
    expect(autoscrollDelta(0, 24, 12)).toBe(12);
  });
});

describe("reorderIndex", () => {
  // `toIndex` indexes the list before the dragged item is removed.

  it("a target after the dragged item's original slot shifts left by one once it's removed", () => {
    // [A,B,C,D]: drag A (0) after C yields raw target 3. Removing A drops index 3, so the
    // real slot is 2.
    expect(reorderIndex(0, 3)).toBe(2);
    // splice(0,1) -> [B,C,D]; splice(2,0,A) -> [B,C,A,D], i.e. A now sits right after C.
  });

  it("a target before the dragged item's original slot is unaffected by its own removal", () => {
    // [A,B,C,D]: drag D (3) before B yields raw target 1, still valid once D is gone.
    expect(reorderIndex(3, 1)).toBe(1);
    // splice(3,1) -> [A,B,C]; splice(1,0,D) -> [A,D,B,C], i.e. D now sits right before B.
  });

  it("a target exactly one past the source collapses to the source's own original slot", () => {
    // [A,B,C,D]: drag A (0) after itself yields raw target 1, a no-move case.
    expect(reorderIndex(0, 1)).toBe(0);
  });

  it("a target equal to the source index is unaffected (caller should treat this as a no-op)", () => {
    expect(reorderIndex(2, 2)).toBe(2);
  });
});
