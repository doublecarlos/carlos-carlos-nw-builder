// Tests for stores/selection.ts: a nav pick lights `highlighted` at once and lands in
// `selection` only after the paint, while a direct select is immediate and wins over a pick
// still in flight.
import { afterEach, describe, expect, it, vi } from "vitest";

/** Frames are hand-driven: `paint()` runs the queued frame and the timer behind it. */
let frames: FrameRequestCallback[] = [];

async function freshStore() {
  vi.resetModules();
  vi.useFakeTimers();
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  installIdbShim();
  return import("../../../src/stores/selection");
}

function paint() {
  const due = frames;
  frames = [];
  for (const cb of due) cb(0);
  vi.runAllTimers();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("selection store", () => {
  it("selectBuild is immediate and mirrored by highlighted", async () => {
    const selection = await freshStore();
    selection.selectBuild("b1");
    expect(selection.selection.value).toEqual({ kind: "build", id: "b1" });
    expect(selection.highlighted.value).toEqual({ kind: "build", id: "b1" });
  });

  it("pickBuild highlights now and selects after the paint", async () => {
    const selection = await freshStore();
    selection.selectBuild("b1");

    selection.pickBuild("b2");
    expect(selection.highlighted.value).toEqual({ kind: "build", id: "b2" });
    expect(selection.selection.value).toEqual({ kind: "build", id: "b1" });

    paint();
    expect(selection.selection.value).toEqual({ kind: "build", id: "b2" });
    expect(selection.highlighted.value).toEqual({ kind: "build", id: "b2" });
  });

  it("the last of several picks in one frame is the one that lands", async () => {
    const selection = await freshStore();
    selection.pickBuild("b1");
    selection.pickLayer("l1");
    expect(selection.highlighted.value).toEqual({ kind: "layer", id: "l1" });

    paint();
    expect(selection.selection.value).toEqual({ kind: "layer", id: "l1" });
  });

  it("a direct select supersedes a pick still in flight", async () => {
    const selection = await freshStore();
    selection.pickBuild("b1");
    selection.selectLayer("l1");
    expect(selection.selection.value).toEqual({ kind: "layer", id: "l1" });
    expect(selection.highlighted.value).toEqual({ kind: "layer", id: "l1" });

    paint();
    expect(selection.selection.value).toEqual({ kind: "layer", id: "l1" });
  });

  it("clearSelection drops a pending pick too", async () => {
    const selection = await freshStore();
    selection.pickBuild("b1");
    selection.clearSelection();
    paint();
    expect(selection.selection.value).toBeNull();
    expect(selection.highlighted.value).toBeNull();
  });
});
