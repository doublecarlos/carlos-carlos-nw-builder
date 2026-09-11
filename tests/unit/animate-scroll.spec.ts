// The jump scroll's contract: a fixed beat that lands exactly on target, instant under reduced
// motion, and silent once cancelled. Frames and the clock are hand-driven so the timing is
// asserted rather than waited for.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  animateScrollTop,
  easeOutCubic,
  JUMP_SCROLL_MS,
} from "../../src/lib/animate-scroll";

let now = 0;
let nextFrameId = 1;
let frames = new Map<number, FrameRequestCallback>();
let reduceMotion = false;

/** A scroll container with plenty of room below, unless a case needs the bounds to bite. */
function scroller(
  scrollTop: number,
  { scrollHeight = 10000, clientHeight = 500 } = {},
) {
  return { scrollTop, scrollHeight, clientHeight };
}

/** Advances the clock and runs every frame queued before this tick, the way a browser would. */
function tick(ms: number) {
  now += ms;
  const due = [...frames.values()];
  frames = new Map();
  for (const cb of due) cb(now);
}

beforeEach(() => {
  now = 0;
  nextFrameId = 1;
  frames = new Map();
  reduceMotion = false;
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") && reduceMotion,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("animateScrollTop", () => {
  it("eases from the start value and lands exactly on the target after the duration", () => {
    const el = scroller(100);
    animateScrollTop(el, 4100);

    // Nothing moves until the first frame is painted.
    expect(el.scrollTop).toBe(100);

    tick(JUMP_SCROLL_MS / 2);
    const halfway = 100 + 4000 * easeOutCubic(0.5);
    expect(el.scrollTop).toBeCloseTo(halfway);
    // Ease-out: more than half the distance is covered by the halfway mark.
    expect(el.scrollTop).toBeGreaterThan(2100);

    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBe(4100);
    // The last frame does not queue another one.
    expect(frames.size).toBe(0);
  });

  it("takes the same time whatever the distance", () => {
    const short = scroller(0);
    const long = scroller(0);
    animateScrollTop(short, 50);
    animateScrollTop(long, 8000);

    tick(JUMP_SCROLL_MS - 1);
    expect(short.scrollTop).toBeLessThan(50);
    expect(long.scrollTop).toBeLessThan(8000);

    tick(1);
    expect(short.scrollTop).toBe(50);
    expect(long.scrollTop).toBe(8000);
  });

  it("scrolls upward too", () => {
    const el = scroller(3000);
    animateScrollTop(el, 500);

    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBeLessThan(3000);
    expect(el.scrollTop).toBeGreaterThan(500);

    tick(JUMP_SCROLL_MS);
    expect(el.scrollTop).toBe(500);
  });

  it("jumps at once when the user prefers reduced motion", () => {
    reduceMotion = true;
    const el = scroller(100);
    animateScrollTop(el, 4100);

    expect(el.scrollTop).toBe(4100);
    expect(frames.size).toBe(0);
  });

  it("jumps at once when there is nothing to animate across", () => {
    const same = scroller(300);
    animateScrollTop(same, 300);
    expect(same.scrollTop).toBe(300);

    const noTime = scroller(0);
    animateScrollTop(noTime, 900, { duration: 0 });
    expect(noTime.scrollTop).toBe(900);

    expect(frames.size).toBe(0);
  });

  it("stops writing once cancelled", () => {
    const el = scroller(0);
    const cancel = animateScrollTop(el, 1000);

    tick(JUMP_SCROLL_MS / 4);
    const partial = el.scrollTop;
    expect(partial).toBeGreaterThan(0);

    cancel();
    expect(frames.size).toBe(0);

    tick(JUMP_SCROLL_MS);
    expect(el.scrollTop).toBe(partial);
    // Cancelling again, or after completion, is harmless.
    expect(() => cancel()).not.toThrow();
  });

  it("lets a new animation take over from where the cancelled one left off", () => {
    const el = scroller(0);
    const cancel = animateScrollTop(el, 1000);
    tick(JUMP_SCROLL_MS / 2);
    cancel();
    const midway = el.scrollTop;

    animateScrollTop(el, 0);
    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBeLessThan(midway);
    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBe(0);
  });
});

describe("animateScrollTop with a distance cap", () => {
  it("animates a jump under the cap from where it actually starts", () => {
    const el = scroller(100);
    animateScrollTop(el, 700, { maxDistance: 1000 });

    expect(el.scrollTop).toBe(100);
    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBeCloseTo(100 + 600 * easeOutCubic(0.5));
    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBe(700);
  });

  it("snaps a long downward jump to the cap short of the target, then glides in", () => {
    const el = scroller(0);
    animateScrollTop(el, 8000, { maxDistance: 1000 });

    // Before any frame: already within one cap of the target, on the near side.
    expect(el.scrollTop).toBe(7000);

    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBeCloseTo(7000 + 1000 * easeOutCubic(0.5));
    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBe(8000);
    expect(frames.size).toBe(0);
  });

  it("snaps a long upward jump to the cap past the target, then glides in", () => {
    const el = scroller(8000);
    animateScrollTop(el, 500, { maxDistance: 1000 });

    expect(el.scrollTop).toBe(1500);

    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBeCloseTo(1500 - 1000 * easeOutCubic(0.5));
    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBe(500);
  });

  it("still jumps straight to the target under reduced motion", () => {
    reduceMotion = true;
    const el = scroller(0);
    animateScrollTop(el, 8000, { maxDistance: 1000 });

    expect(el.scrollTop).toBe(8000);
    expect(frames.size).toBe(0);
  });
});

describe("animateScrollTop against the scroll range", () => {
  it("eases to the furthest reachable position when the target lies past it", () => {
    const el = scroller(6000, { scrollHeight: 8000, clientHeight: 500 });
    animateScrollTop(el, 9000);

    // The curve is drawn over the reachable 1500px, not the 3000px asked for, so it is still
    // moving at the halfway mark and lands on its final frame instead of stalling early.
    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBeCloseTo(6000 + 1500 * easeOutCubic(0.5));
    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBe(7500);
    expect(frames.size).toBe(0);
  });

  it("clamps a negative target to the top", () => {
    const el = scroller(800);
    animateScrollTop(el, -300);

    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBeCloseTo(800 - 800 * easeOutCubic(0.5));
    tick(JUMP_SCROLL_MS / 2);
    expect(el.scrollTop).toBe(0);
  });

  it("measures the distance cap against the clamped target", () => {
    const el = scroller(0, { scrollHeight: 5500, clientHeight: 500 });
    animateScrollTop(el, 20000, { maxDistance: 1000 });

    expect(el.scrollTop).toBe(4000);
    tick(JUMP_SCROLL_MS);
    expect(el.scrollTop).toBe(5000);
  });
});

describe("easeOutCubic", () => {
  it("pins both ends and front-loads the motion", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});
