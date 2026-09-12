// afterPaint's contract: the callback waits for a frame and then one macrotask past it, and
// runs straight away where frames do not exist.
import { describe, it, expect, afterEach, vi } from "vitest";
import { afterPaint } from "../../src/lib/after-paint";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("afterPaint", () => {
  it("runs synchronously without requestAnimationFrame", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const fn = vi.fn();
    afterPaint(fn);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("waits for the frame, then for the timer queued behind its paint", () => {
    vi.useFakeTimers();
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    });
    const fn = vi.fn();
    afterPaint(fn);
    expect(fn).not.toHaveBeenCalled();

    frame!(0);
    expect(fn).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(fn).toHaveBeenCalledOnce();
  });
});
