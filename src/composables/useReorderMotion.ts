import { toValue, watch, type MaybeRefOrGetter } from "vue";
import { droppedKey } from "./useDragAndDrop";
import {
  isReorder,
  movedKeys,
  revealDelta,
  type Point,
} from "../lib/reorder-motion";
import {
  keyedRows,
  measureRows,
  prefersReducedMotion,
  slideRows,
} from "../lib/row-slide";

const FLASH_MS = 700;
/** Room left between a revealed row and the edge of its scroll area. */
const REVEAL_MARGIN = 8;

/**
 * Shows where a reordered row went, on a drop, an undo or a move up/down. Every row slides from
 * where it was to where it lands (lib/row-slide.ts), the list scrolls the moved row into view so
 * it cannot slide out of sight, and a ring on the moved row fades out to mark it. Rows are the
 * elements under `container` marked `data-flip-key`; `order` lists the rendered keys, and only
 * a change of their order counts (lib/reorder-motion.ts), so adding, removing, filtering and
 * folding stay instant.
 *
 * Under reduced motion the moved row is still scrolled to, at once and without the slide or
 * ring.
 */
export function useReorderMotion(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
  order: () => readonly string[],
) {
  let pending: { moved: string[]; before: Map<string, Point> | null } | null =
    null;

  /** The keyed rows inside `key`'s own, which move along with it. */
  function nestedKeys(key: string): string[] {
    const row = keyedRows(toValue(container)).find(
      (el) => el.dataset.flipKey === key,
    );
    return row ? keyedRows(row).map((el) => el.dataset.flipKey!) : [];
  }

  /** The row holding focus, as rendered before the update. A keyboard move keeps it there. */
  function focusedKey(): string | null {
    const root = toValue(container);
    const focused = document.activeElement;
    if (!root || !focused || !root.contains(focused)) return null;
    return (
      focused.closest<HTMLElement>("[data-flip-key]")?.dataset.flipKey ?? null
    );
  }

  // Before the DOM update, while the rows still sit where they were.
  watch(
    order,
    (next, previous) => {
      pending = null;
      if (!previous || !isReorder(previous, next)) return;
      pending = {
        moved: movedKeys(
          previous,
          next,
          [droppedKey(), focusedKey()],
          nestedKeys,
        ),
        before: prefersReducedMotion() ? null : measureRows(toValue(container)),
      };
    },
    { flush: "pre" },
  );

  watch(
    order,
    () => {
      if (!pending) return;
      const { moved, before } = pending;
      pending = null;
      const root = toValue(container);
      const targetIn = (rows: ReadonlyMap<string, HTMLElement>) =>
        moved.map((key) => rows.get(key)).find(Boolean);

      if (!before) {
        const rows = new Map(
          keyedRows(root).map((row) => [row.dataset.flipKey!, row]),
        );
        const target = targetIn(rows);
        if (target) reveal(target, "instant");
        return;
      }

      let target: HTMLElement | undefined;
      // Scrolled before the slides start, so the scroll aims at the row's final place.
      slideRows(root, before, (rows) => {
        target = targetIn(rows);
        if (target) reveal(target, "smooth");
      });
      if (target) flash(target);
    },
    { flush: "post" },
  );
}

/**
 * Scrolls `row`'s nearest scrolling ancestor so the row shows, clear of the sticky bars marked
 * `data-scroll-inset-top` in it. Only that one container moves: `scrollIntoView` would scroll
 * every ancestor, the page included.
 */
function reveal(row: HTMLElement, behavior: ScrollBehavior) {
  const scroller = scrollParent(row);
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  let top = box.top;
  for (const bar of scroller.querySelectorAll<HTMLElement>(
    "[data-scroll-inset-top]",
  )) {
    if (!bar.contains(row))
      top = Math.max(top, bar.getBoundingClientRect().bottom);
  }
  const rect = row.getBoundingClientRect();
  const delta = revealDelta(
    { top: rect.top, bottom: rect.bottom },
    { top: top + REVEAL_MARGIN, bottom: box.bottom - REVEAL_MARGIN },
  );
  if (delta) scroller.scrollBy({ top: delta, behavior });
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    )
      return node;
  }
  return null;
}

/** An accent ring inside the row, held briefly and then faded out. Resolved to a color here
 *  so it follows the theme in effect. */
function flash(row: HTMLElement) {
  const accent = getComputedStyle(row).getPropertyValue("--accent").trim();
  const ring = `inset 0 0 0 2px ${accent}`;
  const animation = row.animate(
    [
      { boxShadow: ring },
      { boxShadow: ring, offset: 0.4 },
      { boxShadow: "inset 0 0 0 2px transparent" },
    ],
    { duration: FLASH_MS, easing: "ease-out" },
  );
  animation.id = "reorder-flash";
}
