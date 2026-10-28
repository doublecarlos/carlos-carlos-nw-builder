import { describe, it, expect } from "vitest";
import { createPointerMoveFilter } from "../../src/lib/pointer-moved";

const at = (clientX: number, clientY: number) =>
  ({ clientX, clientY }) as MouseEvent;

describe("createPointerMoveFilter", () => {
  it("counts the first event and every changed position", () => {
    const moved = createPointerMoveFilter();
    expect(moved(at(10, 10))).toBe(true);
    expect(moved(at(10, 11))).toBe(true);
    expect(moved(at(12, 11))).toBe(true);
  });

  it("ignores an event at the position it last saw", () => {
    const moved = createPointerMoveFilter();
    moved(at(10, 10));
    expect(moved(at(10, 10))).toBe(false);
  });

  it("keeps each filter's position its own", () => {
    const a = createPointerMoveFilter();
    const b = createPointerMoveFilter();
    a(at(5, 5));
    expect(b(at(5, 5))).toBe(true);
  });
});
