// The on-screen box a full-screen surface is sized to.
import { describe, expect, it } from "vitest";
import { visibleBox } from "../../src/lib/visual-viewport";

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
