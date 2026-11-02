// Reordered rows slide to their new place. Only a true reorder animates: adding, removing,
// filtering and folding stay instant. A row inside a moving row travels with it and adds no
// slide of its own. The row the user moved, not the ones it displaced, is the one scrolled to
// and marked.
import { describe, it, expect } from "vitest";
import {
  isReorder,
  movedKeys,
  revealDelta,
  slideOffsets,
} from "../../src/lib/reorder-motion";

describe("isReorder", () => {
  it("is true for the same keys in another order", () => {
    expect(isReorder(["a", "b", "c"], ["b", "a", "c"])).toBe(true);
  });

  it("is false for the first read and for an unchanged order", () => {
    expect(isReorder(undefined, ["a", "b"])).toBe(false);
    expect(isReorder(["a", "b"], ["a", "b"])).toBe(false);
  });

  it("is false when a key comes or goes", () => {
    expect(isReorder(["a", "b"], ["b", "a", "c"])).toBe(false);
    expect(isReorder(["a", "b", "c"], ["c", "a"])).toBe(false);
    expect(isReorder(["a", "b"], ["b", "c"])).toBe(false);
  });
});

describe("movedKeys", () => {
  it("names the one row carried across the others", () => {
    expect(movedKeys(["a", "b", "c", "d"], ["b", "c", "d", "a"], [])).toEqual([
      "a",
    ]);
    expect(movedKeys(["a", "b", "c", "d"], ["d", "a", "b", "c"], [])).toEqual([
      "d",
    ]);
  });

  it("settles a swap of neighbours on the hinted row", () => {
    expect(movedKeys(["a", "b"], ["b", "a"], ["a"])).toEqual(["a"]);
    expect(movedKeys(["a", "b"], ["b", "a"], ["b"])).toEqual(["b"]);
  });

  it("moves a hinted row together with the rows nested inside it", () => {
    // Grant `a` holds variants `a1` and `a2`; moving it below `b` carries them along.
    const nested = (key: string) => (key === "a" ? ["a1", "a2"] : []);
    expect(
      movedKeys(["a", "a1", "a2", "b"], ["b", "a", "a1", "a2"], ["a"], nested),
    ).toEqual(["a"]);
  });

  it("skips a hint that does not explain the new order alone", () => {
    expect(
      movedKeys(["a", "b", "c", "d"], ["b", "c", "d", "a"], [null, "c"]),
    ).toEqual(["a"]);
  });
});

describe("slideOffsets", () => {
  const at = (entries: Record<string, number>) =>
    new Map(Object.entries(entries).map(([key, y]) => [key, { x: 0, y }]));

  it("moves each row back to where it was drawn", () => {
    const offsets = slideOffsets(
      at({ a: 0, b: 40 }),
      at({ a: 40, b: 0 }),
      () => null,
    );
    expect(offsets.get("a")).toEqual({ x: 0, y: -40 });
    expect(offsets.get("b")).toEqual({ x: 0, y: 40 });
  });

  it("leaves out rows that stayed put or are new", () => {
    const offsets = slideOffsets(
      at({ a: 0, b: 40 }),
      at({ a: 0, b: 40, c: 80 }),
      () => null,
    );
    expect(offsets.size).toBe(0);
  });

  it("gives a row carried by its moving parent no slide of its own", () => {
    const parents: Record<string, string> = { child: "parent" };
    const offsets = slideOffsets(
      at({ parent: 0, child: 20, other: 100 }),
      at({ parent: 60, child: 80, other: 0 }),
      (key) => parents[key] ?? null,
    );
    expect(offsets.has("child")).toBe(false);
    expect(offsets.get("parent")).toEqual({ x: 0, y: -60 });
  });
});

describe("revealDelta", () => {
  const view = { top: 100, bottom: 300 };

  it("leaves a row that already shows", () => {
    expect(revealDelta({ top: 120, bottom: 160 }, view)).toBe(0);
  });

  it("brings a row above or below the view to the nearest edge", () => {
    expect(revealDelta({ top: 60, bottom: 100 }, view)).toBe(-40);
    expect(revealDelta({ top: 320, bottom: 360 }, view)).toBe(60);
  });

  it("lines up the top of a row taller than the view", () => {
    expect(revealDelta({ top: 250, bottom: 650 }, view)).toBe(150);
  });
});
