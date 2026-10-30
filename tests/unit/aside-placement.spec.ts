// Where a dropdown's detail panel goes: beside the menu when a side has room, else stacked.
import { describe, expect, it } from "vitest";
import {
  ASIDE_GAP,
  ASIDE_MARGIN,
  MIN_STACKED_HEIGHT,
  asideStacks,
  placeAside,
  stackedMenuRoom,
} from "../../src/lib/aside-placement";

const desktop = { width: 1440, height: 900 };
const tablet = { width: 800, height: 1000 };
const card = { width: 320, height: 400 };

describe("placeAside", () => {
  it("sits to the right of the menu, top-aligned, when it fits there", () => {
    const menu = { left: 100, top: 200, right: 600, bottom: 500 };
    expect(
      placeAside({ menu, aside: card, viewport: desktop, menuUp: false }),
    ).toEqual({
      left: 600 + ASIDE_GAP,
      top: 200,
      maxHeight: 512,
      hidden: false,
    });
  });

  it("falls back to the left side, slid up to end inside the viewport", () => {
    const menu = { left: 900, top: 700, right: 1400, bottom: 880 };
    const placement = placeAside({
      menu,
      aside: card,
      viewport: desktop,
      menuUp: false,
    });
    expect(placement.left).toBe(900 - ASIDE_GAP - card.width);
    expect(placement.top).toBe(desktop.height - ASIDE_MARGIN - card.height);
    expect(placement.hidden).toBe(false);
  });

  it("stacks below a menu that opened downward when neither side fits", () => {
    const menu = { left: 200, top: 300, right: 712, bottom: 500 };
    expect(asideStacks(menu, card.width, tablet.width)).toBe(true);
    const placement = placeAside({
      menu,
      aside: card,
      viewport: tablet,
      menuUp: false,
    });
    expect(placement).toEqual({
      left: 200,
      top: 500 + ASIDE_GAP,
      maxHeight: tablet.height - ASIDE_MARGIN - 500 - ASIDE_GAP,
      hidden: false,
    });
  });

  it("stacks above a menu that opened upward", () => {
    const menu = { left: 200, top: 400, right: 712, bottom: 700 };
    const placement = placeAside({
      menu,
      aside: { width: 300, height: 200 },
      viewport: tablet,
      menuUp: true,
    });
    expect(placement.left).toBe(200);
    expect(placement.top).toBe(400 - ASIDE_GAP - 200);
    expect(placement.maxHeight).toBe(400 - ASIDE_GAP - ASIDE_MARGIN);
  });

  it("hides a stacked aside with too little room left to be useful", () => {
    const menu = {
      left: 200,
      top: 300,
      right: 712,
      bottom: tablet.height - MIN_STACKED_HEIGHT,
    };
    expect(
      placeAside({ menu, aside: card, viewport: tablet, menuUp: false }).hidden,
    ).toBe(true);
  });
});

describe("stackedMenuRoom", () => {
  it("leaves the menu half of its side", () => {
    expect(stackedMenuRoom(501)).toBe(250);
  });
});
