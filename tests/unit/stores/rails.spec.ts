// Rail widths: the clamp is what keeps a dragged-out rail from surviving into a window that
// cannot carry it, and what keeps a persisted width from arriving as a layout the user never
// chose.
import { describe, expect, it, beforeEach } from "vitest";
import { nextTick } from "vue";
import { installWindowShim } from "./window-shim";
import * as storage from "../../../src/storage/storage";

const freshStore = async () => {
  const mod = await import("../../../src/stores/rails");
  mod._reset();
  return mod;
};

beforeEach(() => {
  installWindowShim();
});

describe("rail widths", () => {
  it("opens each rail at its default", async () => {
    const rails = await freshStore();

    expect(rails.widthOf("nav")).toBe(rails.RAIL_DEFAULTS.nav);
    expect(rails.widthOf("details")).toBe(rails.RAIL_DEFAULTS.details);
  });

  it("keeps a set width and rounds it to whole pixels", async () => {
    const rails = await freshStore();

    rails.setWidth("nav", 312.4);

    expect(rails.widthOf("nav")).toBe(312);
  });

  it("refuses to shrink a rail past the point of showing anything", async () => {
    const rails = await freshStore();

    rails.setWidth("nav", 20);

    expect(rails.widthOf("nav")).toBe(rails.MIN_RAIL_PX);
  });

  it("never caps a rail below its own default", async () => {
    const rails = await freshStore();

    // The shim has no `innerWidth`, so the cap is whatever the default guarantees.
    expect(rails.maxWidth("details").value).toBeGreaterThanOrEqual(
      rails.RAIL_DEFAULTS.details,
    );
  });

  it("restores the default width on reset", async () => {
    const rails = await freshStore();
    rails.setWidth("layerEntries", 260);

    rails.resetWidth("layerEntries");

    expect(rails.widthOf("layerEntries")).toBe(
      rails.RAIL_DEFAULTS.layerEntries,
    );
  });

  it("persists widths beside the collapse state", async () => {
    const rails = await freshStore();

    rails.setWidth("nav", 300);
    rails.toggle("details");
    await nextTick();

    const stored = storage.loadUiState();
    expect(stored.railWidths?.nav).toBe(300);
    expect(stored.collapsed?.details).toBe(true);
  });
});
