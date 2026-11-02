// The DOM half of a row slide, shared by useReorderMotion (a list reordered) and useFoldSlide
// (a fold opened or closed): measure elements before an update, then slide each one from where
// it was drawn to where it landed. A reorder's rows are the elements marked `data-flip-key`.
import { slideOffsets, type Point } from "./reorder-motion";

/** The id every slide animation carries, so a later slide can cancel it and tests can find it. */
export const SLIDE_ID = "row-slide";
const SLIDE_MS = 150;
const EASE_SNAPPY = "cubic-bezier(0.2, 0, 0, 1)";

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Stops any slide still running on `elements`, so they can be measured where they lie. */
export function cancelSlides(elements: Iterable<HTMLElement>) {
  for (const el of elements)
    for (const running of el.getAnimations())
      if (running.id === SLIDE_ID) running.cancel();
}

/** A frame that took longer than this is still busy with the update, not yet animating. */
const BUSY_FRAME_MS = 34;
/** The longest a slide waits for the browser to settle before it runs regardless. */
const MAX_HOLD_MS = 250;

/**
 * Slides `el` from `x`/`y` pixels away back to where it lies. The slide holds its first frame
 * until the browser draws frames promptly again: an expanded body can take a long frame or two
 * to lay out, often a frame after the toggle, and a clock running through them would leave
 * only the slide's last few frames to see.
 */
export function slideFrom(el: HTMLElement, x: number, y: number) {
  const slide = el.animate(
    [{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }],
    { duration: SLIDE_MS, easing: EASE_SNAPPY },
  );
  slide.id = SLIDE_ID;
  slide.pause();
  whenSettled(() => {
    if (slide.playState === "paused") slide.play();
  });
}

/** Runs `fn` on the first prompt frame after at least two, or once `MAX_HOLD_MS` has passed. */
function whenSettled(fn: () => void) {
  const start = performance.now();
  let last = start;
  let frames = 0;
  const tick = (now: number) => {
    const gap = now - last;
    last = now;
    frames += 1;
    if ((frames >= 2 && gap < BUSY_FRAME_MS) || now - start > MAX_HOLD_MS) fn();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
  cancelSlides(elements.values());

  const offsets = slideOffsets(before, measureRows(root), (key) =>
    parentKey(elements, key),
  );
  settle?.(elements);
  for (const [key, { x, y }] of offsets) {
    const row = elements.get(key);
    if (row) slideFrom(row, x, y);
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
