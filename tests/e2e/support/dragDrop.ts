// Helpers for driving the pointer-based drag-and-drop composable (useDragAndDrop.ts) via
// `page.mouse`, so a real gesture exercises the same path a user's cursor would. Unlike
// native DnD, there is no `dragstart` recognition step for a nested scroll container to
// swallow.
import type { Locator, Page } from "@playwright/test";

/** A locator's bounding box, or an error if it isn't rendered. Scrolls into view first, since
 *  `boundingBox()` does not, unlike Playwright's actions. Without that, a row inside a nested
 *  scroll container could yield off-screen coordinates. */
export async function requireBox(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Element is not visible");
  return box;
}

/** Which band of the target's height the pointer sits in: before/after it, or inside a row
 *  that accepts drops, like a build folder's header. */
export type DragEdge = "before" | "after" | "into";

const BAND_OFFSET: Record<DragEdge, number> = {
  before: 0.125,
  into: 0.5,
  after: 0.875,
};

/** A drag held open across several steps, for specs that inspect the page *while* something is
 *  in flight. Always finish with `dropOn` or `end`. */
export interface DragSession {
  /** Moves the pointer over `target` without dropping. */
  over(target: Locator, edge?: DragEdge): Promise<void>;
  /** Drops on `target` and ends the drag. */
  dropOn(target: Locator, edge?: DragEdge): Promise<void>;
  /** Ends the drag without dropping (Escape, then releases the mouse button). */
  end(): Promise<void>;
}

async function point(target: Locator, edge: DragEdge) {
  const box = await requireBox(target);
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height * BAND_OFFSET[edge],
  };
}

/** Starts a drag from `handle`, the element carrying the pointerdown binding. Presses its
 *  center, then moves past useDragHandle's move threshold to start the drag. */
export async function beginDrag(handle: Locator): Promise<DragSession> {
  const page = handle.page();
  const box = await requireBox(handle);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Past useDragHandle's 4px move threshold, so this arms a real drag.
  await page.mouse.move(startX, startY + 8, { steps: 2 });

  return {
    async over(target, edge = "after") {
      const at = await point(target, edge);
      await page.mouse.move(at.x, at.y, { steps: 3 });
    },
    async dropOn(target, edge = "after") {
      const at = await point(target, edge);
      await page.mouse.move(at.x, at.y, { steps: 3 });
      await page.mouse.up();
    },
    async end() {
      await page.keyboard.press("Escape");
      await page.mouse.up();
    },
  };
}

/** Drags `handle` onto `target`, landing in the requested band of the target's own height so
 *  it lands immediately before or after it, or inside it ("into"). Defaults to "after", the
 *  more common reordering gesture. */
export async function dragOnto(
  handle: Locator,
  target: Locator,
  edge: DragEdge = "after",
) {
  const drag = await beginDrag(handle);
  await drag.dropOn(target, edge);
}

/** Ends a drag by dropping at a raw page position, for gaps or below the last row, which have
 *  no target row for `dropOn`. */
export async function dropAt(page: Page, x: number, y: number) {
  await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.up();
}
