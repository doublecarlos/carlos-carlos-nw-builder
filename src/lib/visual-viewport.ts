// The part of the page actually on screen. A phone's on-screen keyboard shrinks the visual
// viewport but not the window, so a full-screen surface sized from the window would run under
// the keyboard.

export interface ViewportBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The subset of `window.visualViewport` read here. */
export interface VisualViewportLike {
  offsetTop: number;
  offsetLeft: number;
  width: number;
  height: number;
}

/** The visual viewport's box in layout viewport coordinates, which is what `position: fixed`
 *  places against. Falls back to the window where the browser has no visual viewport. */
export function visibleBox(
  visual: VisualViewportLike | null | undefined,
  window: { innerWidth: number; innerHeight: number },
): ViewportBox {
  if (!visual)
    return {
      top: 0,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  return {
    top: visual.offsetTop,
    left: visual.offsetLeft,
    width: visual.width,
    height: visual.height,
  };
}

/** Room kept between a revealed field and the edge of the visible box. */
export const REVEAL_MARGIN = 12;

/** How far a field's scroller has to scroll for the field to sit inside the visible box: positive
 *  when it is below the box (under the keyboard), negative when above it, 0 when it fits. */
export function revealDelta(
  field: { top: number; bottom: number },
  box: ViewportBox,
  margin = REVEAL_MARGIN,
): number {
  const bottom = box.top + box.height - margin;
  const top = box.top + margin;
  if (field.bottom > bottom)
    return Math.min(field.bottom - bottom, field.top - top);
  if (field.top < top) return field.top - top;
  return 0;
}
