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
