// The on-screen box a full-screen surface is sized to, and how far a focused field's scroller
// moves to keep the field inside it when the keyboard covers part of the screen.
import { describe, expect, it } from "vitest";
import { revealDelta, visibleBox } from "../../src/lib/visual-viewport";

const window = { innerWidth: 412, innerHeight: 915 };

describe("visibleBox", () => {
  it("follows the visual viewport, which shrinks under a keyboard", () => {
    expect(
      visibleBox(
        { offsetTop: 120, offsetLeft: 4, width: 404, height: 480 },
        window,
      ),
    ).toEqual({ top: 120, left: 4, width: 404, height: 480 });
  });

  it("falls back to the window without a visual viewport", () => {
    expect(visibleBox(null, window)).toEqual({
      top: 0,
      left: 0,
      width: 412,
      height: 915,
    });
  });
});

describe("revealDelta", () => {
  // A 915px screen with the keyboard over its bottom half.
  const box = { top: 0, left: 0, width: 412, height: 450 };

  it("scrolls a field under the keyboard up into the visible box", () => {
    expect(revealDelta({ top: 600, bottom: 640 }, box, 10)).toBe(200);
  });

  it("leaves a field that is already visible alone", () => {
    expect(revealDelta({ top: 100, bottom: 140 }, box, 10)).toBe(0);
  });

  it("scrolls a field above the visible box down into it", () => {
    expect(revealDelta({ top: -50, bottom: -10 }, box, 10)).toBe(-60);
  });

  it("keeps the top of a field taller than the box in view", () => {
    expect(revealDelta({ top: 300, bottom: 1000 }, box, 10)).toBe(290);
  });
});
