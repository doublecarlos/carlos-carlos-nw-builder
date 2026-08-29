// Drag- and keyboard-resizing for a side rail.
//
// Pointer capture rather than window-level listeners: the handle keeps receiving moves even
// when the pointer runs off it, and the browser releases capture for us if the gesture is
// cancelled, so there is no listener left behind to leak.
import { ref } from "vue";
import * as rails from "../stores/rails";
import type { RailId } from "../stores/rails";

/** How far one arrow-key press nudges the edge. */
const KEY_STEP_PX = 16;

export function useRailResize(rail: RailId, side: "left" | "right") {
  const dragging = ref(false);
  /** A left rail widens as the edge moves right; a right rail is the mirror. */
  const towards = side === "left" ? 1 : -1;

  let startX = 0;
  let startWidth = 0;

  // Measured from where the drag began rather than accumulated per move, so a pointer dragged
  // well past the clamp and back does not move the edge until it returns inside the range.
  function onPointerdown(event: PointerEvent) {
    if (event.button !== 0) return;
    startX = event.clientX;
    startWidth = rails.widthOf(rail);
    dragging.value = true;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    // Keeps the drag from selecting the text it sweeps across.
    event.preventDefault();
  }

  function onPointermove(event: PointerEvent) {
    if (!dragging.value) return;
    rails.setWidth(rail, startWidth + (event.clientX - startX) * towards);
  }

  function onPointerup(event: PointerEvent) {
    if (!dragging.value) return;
    dragging.value = false;
    (event.currentTarget as Element).releasePointerCapture(event.pointerId);
  }

  function onKeydown(event: KeyboardEvent) {
    const step =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!step) return;
    rails.setWidth(rail, rails.widthOf(rail) + step * towards * KEY_STEP_PX);
    event.preventDefault();
  }

  const reset = () => rails.resetWidth(rail);

  return {
    dragging,
    onPointerdown,
    onPointermove,
    onPointerup,
    onKeydown,
    reset,
  };
}
