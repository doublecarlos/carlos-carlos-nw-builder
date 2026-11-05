import { describe, expect, it } from "vitest";
import {
  keepArray,
  keepEqual,
  keepMap,
  keepSet,
} from "../../src/lib/keep-identity";

// BuildEditor rebuilds every row and section prop on each edit or filter keystroke, and relies
// on these to hand back the previous object when nothing changed, so Vue skips re-rendering the
// rows and sections the change left alone.
describe("keep-identity", () => {
  const a = { id: "a" };
  const b = { id: "b" };

  it("keeps an array holding the same elements in order", () => {
    const previous = [a, b];
    expect(keepArray(previous, [a, b])).toBe(previous);
  });

  it("takes the new array once an element, the order or the length changes", () => {
    const previous = [a, b];
    const swapped = [b, a];
    const equalCopy = [a, { id: "b" }];
    const shorter = [a];
    expect(keepArray(previous, swapped)).toBe(swapped);
    expect(keepArray(previous, equalCopy)).toBe(equalCopy);
    expect(keepArray(previous, shorter)).toBe(shorter);
    expect(keepArray(undefined, shorter)).toBe(shorter);
  });

  it("keeps a map holding the same entries", () => {
    const previous = new Map([["x", "hidden"]]);
    expect(keepMap(previous, new Map([["x", "hidden"]]))).toBe(previous);
  });

  it("takes the new map once a key or a value changes", () => {
    const previous = new Map([["x", "hidden"]]);
    const otherValue = new Map([["x", "withheld"]]);
    const otherKey = new Map([["y", "hidden"]]);
    expect(keepMap(previous, otherValue)).toBe(otherValue);
    expect(keepMap(previous, otherKey)).toBe(otherKey);
  });

  it("keeps a set holding the same members, in any order", () => {
    const previous = new Set(["x", "y"]);
    expect(keepSet(previous, new Set(["y", "x"]))).toBe(previous);
  });

  it("takes the new set once a member changes", () => {
    const previous = new Set(["x", "y"]);
    const other = new Set(["x", "z"]);
    const smaller = new Set(["x"]);
    expect(keepSet(previous, other)).toBe(other);
    expect(keepSet(previous, smaller)).toBe(smaller);
  });

  it("keeps a deeply equal value and takes a different one", () => {
    const previous = { first: true, last: false };
    const moved = { first: false, last: false };
    expect(keepEqual(previous, { first: true, last: false })).toBe(previous);
    expect(keepEqual(previous, moved)).toBe(moved);
    expect(keepEqual(undefined, moved)).toBe(moved);
  });
});
