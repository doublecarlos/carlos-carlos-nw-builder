// Helpers for driving native HTML5 drag-and-drop in e2e specs.
//
// This dispatches synthetic dragstart/dragover/drop/dragend DragEvents directly (Playwright's
// documented approach for drag-and-drop testing: a shared DataTransfer JSHandle passed to
// `locator.dispatchEvent()`) rather than relying on `locator.dragTo()`'s real OS-level mouse
// gesture. `dragTo()` depends on Chromium actually recognizing the simulated mouse movement as
// a native drag session, which in practice was unreliable once the draggable handle sat several
// scrollable ancestors deep (e.g. a bonus's grant list nested inside the layer editor) --
// dragstart never fired at all in that case, for reasons that didn't reproduce on the flatter
// sidebar nav rows. Dispatching the events directly sidesteps that gesture-recognition step
// entirely: the composable only cares that dragover/drop fire with the right target and
// coordinates, not how they got there.
import type { Locator } from "@playwright/test";

/** Drags a drag-handle element onto `target`, landing in the requested band of the target's
 *  own height so the row lands immediately before or after it (see useDragAndDrop's
 *  before/after edge split), or -- for a row that accepts drops inside it, like a build
 *  folder's header -- within it ("into", the middle half). Defaults to "after", the more
 *  common reordering gesture. */
export async function dragOnto(
  handle: Locator,
  target: Locator,
  edge: "before" | "after" | "into" = "after",
) {
  const page = handle.page();
  const box = await target.boundingBox();
  if (!box) throw new Error("Drop target is not visible");
  const clientX = box.x + box.width / 2;
  const bandOffset = { before: 0.125, into: 0.5, after: 0.875 }[edge];
  const clientY = box.y + box.height * bandOffset;

  // Resolved to a concrete element up front, rather than dispatched on via the live `handle`
  // locator throughout: a successful drop can move the dragged row's DOM node somewhere else
  // entirely (e.g. nested inside a group it was just dropped into), at which point re-querying
  // `handle`'s selector may match a *different* element (or several) than the one actually
  // dragged -- an ElementHandle keeps pointing at the exact node regardless.
  const handleEl = await handle.elementHandle();
  if (!handleEl) throw new Error("Drag handle is not visible");

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await handleEl.dispatchEvent("dragstart", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer, clientX, clientY });
  await target.dispatchEvent("drop", { dataTransfer, clientX, clientY });
  // A successful drop already clears the composable's drag-bus state itself (see
  // useDragAndDrop's handleDrop) and may have detached the handle's own row from the DOM --
  // e.g. a condition dragged out of a list that's now empty. dragend at that point is just
  // best-effort OS-level cleanup, so skip it once the original node is gone rather than firing
  // an event nothing can receive.
  const stillAttached = await handleEl
    .evaluate((el) => el.isConnected)
    .catch(() => false);
  if (stillAttached) {
    await handleEl.dispatchEvent("dragend", { dataTransfer });
  }
}
