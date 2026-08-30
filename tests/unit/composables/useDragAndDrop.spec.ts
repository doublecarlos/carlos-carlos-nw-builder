// Only the pure index/edge helpers are covered here -- useDragHandle/useDropList's actual
// dragover/drop handlers need a real DOM (DragEvent, getBoundingClientRect), which Vitest's
// `environment: "node"` doesn't provide. Playwright e2e specs are the only net for those.
import { describe, it, expect } from "vitest";
import {
  resolveDropEdge,
  resolveDropZone,
  reorderIndex,
} from "../../../src/composables/useDragAndDrop";

describe("resolveDropEdge", () => {
  it("the top half of a row resolves to 'before'", () => {
    expect(resolveDropEdge(0)).toBe("before");
    expect(resolveDropEdge(0.49)).toBe("before");
  });

  it("the bottom half of a row resolves to 'after'", () => {
    expect(resolveDropEdge(0.5)).toBe("after");
    expect(resolveDropEdge(1)).toBe("after");
  });
});

describe("reorderIndex", () => {
  // `toIndex` is always computed against the list as it stood *before* the dragged item is
  // removed (that's what dragover math naturally produces, since nothing has spliced yet).

  it("a target after the dragged item's original slot shifts left by one once it's removed", () => {
    // [A,B,C,D]: drag A (0) to land after C -- rowProps(2 /* C */) with edge "after" computes
    // a raw target of 3. Once A is spliced out, index 3 no longer exists; the real slot is 2.
    expect(reorderIndex(0, 3)).toBe(2);
    // splice(0,1) -> [B,C,D]; splice(2,0,A) -> [B,C,A,D], i.e. A now sits right after C.
  });

  it("a target before the dragged item's original slot is unaffected by its own removal", () => {
    // [A,B,C,D]: drag D (3) to land before B -- rowProps(1 /* B */) with edge "before" computes
    // a raw target of 1, which is still valid once D (at index 3) is gone.
    expect(reorderIndex(3, 1)).toBe(1);
    // splice(3,1) -> [A,B,C]; splice(1,0,D) -> [A,D,B,C], i.e. D now sits right before B.
  });

  it("a target exactly one past the source collapses to the source's own original slot", () => {
    // [A,B,C,D]: drag A (0) to land after A itself (raw target 1) -- a no-visible-move case.
    expect(reorderIndex(0, 1)).toBe(0);
  });

  it("a target equal to the source index is unaffected (caller should treat this as a no-op)", () => {
    expect(reorderIndex(2, 2)).toBe(2);
  });
});

describe("resolveDropZone", () => {
  // The three-way split a row opts into when something can be dropped *inside* it (a build
  // folder's header). The outer quarters keep the plain reorder gesture reachable.
  it("the outer quarters still resolve to before/after", () => {
    expect(resolveDropZone(0)).toBe("before");
    expect(resolveDropZone(0.24)).toBe("before");
    expect(resolveDropZone(0.75)).toBe("after");
    expect(resolveDropZone(1)).toBe("after");
  });

  it("the middle half resolves to 'into'", () => {
    expect(resolveDropZone(0.25)).toBe("into");
    expect(resolveDropZone(0.5)).toBe("into");
    expect(resolveDropZone(0.74)).toBe("into");
  });
});
