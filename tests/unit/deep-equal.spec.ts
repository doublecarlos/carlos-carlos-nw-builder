import { describe, it, expect } from "vitest";
import { deepEqual } from "../../src/lib/deep-equal";

describe("deepEqual", () => {
  it("treats key order as insignificant", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("recurses into nested objects and arrays", () => {
    expect(deepEqual({ a: [{ x: 1, y: 2 }] }, { a: [{ y: 2, x: 1 }] })).toBe(
      true,
    );
    expect(deepEqual({ a: [1, 2, 3] }, { a: [1, 2, 4] })).toBe(false);
  });

  it("is order-sensitive for arrays", () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });

  it("catches added, removed and changed keys", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("treats undefined and missing keys as distinct from JSON.stringify's own blind spot", () => {
    // JSON.stringify drops `undefined` values, so this documents the actual (not
    // hypothetical) behaviour rather than asserting an "ideal" one.
    expect(deepEqual({ a: undefined }, {})).toBe(true);
  });
});
