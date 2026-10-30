// Where a dropdown's detail panel (ComboBoxMenu's `aside`) goes relative to the open menu.
//
// Beside the menu when either side has room for it, top-aligned with it and slid up just enough
// to end inside the viewport. When neither side does (a tablet), it stacks on the far side of
// the menu from the input instead, and the menu gives up half its room so both fit.

export interface MenuRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AsideInput {
  menu: MenuRect;
  /** The aside's own rendered size. */
  aside: { width: number; height: number };
  viewport: { width: number; height: number };
  /** The menu opened above its input rather than below. */
  menuUp: boolean;
}

export interface AsidePlacement {
  left: number;
  top: number;
  maxHeight: number;
  /** Too little room to show it anywhere: covering the menu would be worse than nothing. */
  hidden: boolean;
}

/** Gap between the menu and the aside. */
export const ASIDE_GAP = 6;
/** The aside's minimum distance to the viewport edge. */
export const ASIDE_MARGIN = 8;
/** Below this a stacked aside shows too little of the card to be worth it. */
export const MIN_STACKED_HEIGHT = 96;
/** The tallest a side-by-side aside grows. */
const MAX_BESIDE_HEIGHT = 512;

/** Whether the aside fits on neither side of the menu, and so stacks under or over it. */
export function asideStacks(
  menu: MenuRect,
  asideWidth: number,
  viewportWidth: number,
): boolean {
  return (
    menu.right + ASIDE_GAP + asideWidth > viewportWidth - ASIDE_MARGIN &&
    menu.left - ASIDE_GAP - asideWidth < ASIDE_MARGIN
  );
}

/** The menu's height cap when it shares its side of the input with a stacked aside. */
export function stackedMenuRoom(room: number): number {
  return Math.floor(room / 2);
}

export function placeAside({
  menu,
  aside,
  viewport,
  menuUp,
}: AsideInput): AsidePlacement {
  if (!asideStacks(menu, aside.width, viewport.width)) {
    const right = menu.right + ASIDE_GAP;
    const left =
      right + aside.width <= viewport.width - ASIDE_MARGIN
        ? right
        : menu.left - ASIDE_GAP - aside.width;
    const top = Math.max(
      Math.min(menu.top, viewport.height - ASIDE_MARGIN - aside.height),
      ASIDE_MARGIN,
    );
    return {
      left,
      top,
      maxHeight: Math.min(
        MAX_BESIDE_HEIGHT,
        viewport.height - 2 * ASIDE_MARGIN,
      ),
      hidden: false,
    };
  }

  // Lined up with the menu, pulled in from the right edge as far as it needs.
  const left = Math.max(
    Math.min(menu.left, viewport.width - ASIDE_MARGIN - aside.width),
    ASIDE_MARGIN,
  );
  const maxHeight = menuUp
    ? menu.top - ASIDE_GAP - ASIDE_MARGIN
    : viewport.height - ASIDE_MARGIN - menu.bottom - ASIDE_GAP;
  const top = menuUp
    ? Math.max(
        menu.top - ASIDE_GAP - Math.min(aside.height, maxHeight),
        ASIDE_MARGIN,
      )
    : menu.bottom + ASIDE_GAP;
  return {
    left,
    top,
    maxHeight: Math.max(maxHeight, 0),
    hidden: maxHeight < MIN_STACKED_HEIGHT,
  };
}
