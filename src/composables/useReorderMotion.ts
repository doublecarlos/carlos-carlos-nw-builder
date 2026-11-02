import { toValue, watch, type MaybeRefOrGetter } from "vue";
import { droppedKey } from "./useDragAndDrop";
import {
  listChange,
  movedKeys,
  revealDelta,
  type Point,
} from "../lib/reorder-motion";
import {
  fadeInRow,
  keyedRows,
  measureRows,
  prefersReducedMotion,
  ringRow,
  slideRows,
} from "../lib/row-slide";

/** Room left between a revealed row and the edge of its scroll area. */
const REVEAL_MARGIN = 8;

/**
 * Shows how a list's rows changed (lib/reorder-motion.ts's `listChange`). Every row that stays
 * slides from where it was to where it lands (lib/row-slide.ts). On a reorder (a drop, an undo,
 * a move up/down) the list also scrolls the moved row into view so it cannot slide out of
 * sight, and a ring marks it. On an insertion the new row fades in; a removed row just goes.
 * Rows are the elements under `container` marked `data-flip-key`, and `order` lists every key
 * the list holds, filtered out or folded away or not, so filtering and folding change nothing
 * here.
 *
 * Under reduced motion only a reorder does anything: the moved row is still scrolled to and
 * marked, at once and without the slide.
 */
export function useReorderMotion(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
  order: () => readonly string[],
) {
  let pending: {
    moved: string[];
    added: string[];
    before: Map<string, Point> | null;
  } | null = null;

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
      const kind = listChange(previous, next);
      const reduced = prefersReducedMotion();
      if (!kind || (kind !== "reorder" && reduced)) return;
      const old = new Set(previous);
      pending = {
        moved:
          kind === "reorder"
            ? movedKeys(
                previous!,
                next,
                [droppedKey(), focusedKey()],
                nestedKeys,
              )
            : [],
        added: kind === "insert" ? next.filter((key) => !old.has(key)) : [],
        before: reduced ? null : measureRows(toValue(container)),
      };
    },
    { flush: "pre" },
  );

  watch(
    order,
    () => {
      if (!pending) return;
      const { moved, added, before } = pending;
      pending = null;
      const root = toValue(container);
      const targetIn = (rows: ReadonlyMap<string, HTMLElement>) =>
        moved.map((key) => rows.get(key)).find(Boolean);

      if (!before) {
        const rows = new Map(
          keyedRows(root).map((row) => [row.dataset.flipKey!, row]),
        );
        const target = targetIn(rows);
        if (target) {
          reveal(target, "instant");
          ringRow(target);
        }
        return;
      }

      let target: HTMLElement | undefined;
      let arrived: HTMLElement[] = [];
      // Scrolled before the slides start, so the scroll aims at the row's final place.
      slideRows(root, before, (rows) => {
        target = targetIn(rows);
        if (target) reveal(target, "smooth");
        arrived = added
          .map((key) => rows.get(key))
          .filter((row): row is HTMLElement => !!row);
      });
      if (target) ringRow(target);
      arrived.forEach(fadeInRow);
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
