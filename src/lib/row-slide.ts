// The DOM half of a row slide, shared by useReorderMotion (a list reordered) and useFoldSlide
// (sections opened or closed): measure the keyed rows before an update, then slide each one
// from where it was drawn to where it landed. Rows are the elements marked `data-flip-key`.
import { slideOffsets, type Point } from "./reorder-motion";

/** The id every slide animation carries, so a later slide can cancel it and tests can find it. */
export const SLIDE_ID = "row-slide";
const SLIDE_MS = 150;
const EASE_SNAPPY = "cubic-bezier(0.2, 0, 0, 1)";

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function keyedRows(root: HTMLElement | null | undefined): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>("[data-flip-key]")] : [];
}

/** Where each keyed row under `root` is drawn now, by key. */
export function measureRows(
  root: HTMLElement | null | undefined,
): Map<string, Point> {
  const positions = new Map<string, Point>();
  for (const row of keyedRows(root)) {
    const rect = row.getBoundingClientRect();
    positions.set(row.dataset.flipKey!, { x: rect.left, y: rect.top });
  }
  return positions;
}

/**
 * Slides every keyed row under `root` from its `before` position to where it is now. A slide
 * still running from a quick earlier update is cancelled first, since it would skew the
 * measure; the new slide starts from where `before` saw the row, so nothing jumps.
 *
 * `settle` runs once the rows are measured where they landed and before any slide starts, the
 * moment to scroll by their final places. Transform only, ending on none with no fill, so a
 * fixed descendant (ComboBoxMenu) is offset for at most the slide itself.
 */
export function slideRows(
  root: HTMLElement | null | undefined,
  before: ReadonlyMap<string, Point>,
  settle?: (rows: ReadonlyMap<string, HTMLElement>) => void,
): void {
  const elements = new Map(
    keyedRows(root).map((row) => [row.dataset.flipKey!, row]),
  );
  for (const row of elements.values())
    for (const running of row.getAnimations())
      if (running.id === SLIDE_ID) running.cancel();

  const offsets = slideOffsets(before, measureRows(root), (key) =>
    parentKey(elements, key),
  );
  settle?.(elements);
  for (const [key, { x, y }] of offsets) {
    const slide = elements
      .get(key)
      ?.animate(
        [{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }],
        { duration: SLIDE_MS, easing: EASE_SNAPPY },
      );
    if (slide) slide.id = SLIDE_ID;
  }
}

/** The nearest keyed row around `key`'s own, which carries it along when it moves. */
function parentKey(
  elements: ReadonlyMap<string, HTMLElement>,
  key: string,
): string | null {
  return (
    elements.get(key)?.parentElement?.closest<HTMLElement>("[data-flip-key]")
      ?.dataset.flipKey ?? null
  );
}
