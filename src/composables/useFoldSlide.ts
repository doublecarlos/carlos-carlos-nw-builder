import { nextTick, toValue, watch, type MaybeRefOrGetter } from "vue";
import type { Point } from "../lib/reorder-motion";
import { measureRows, prefersReducedMotion, slideRows } from "../lib/row-slide";

/**
 * Slides the rows below a fold as it opens or closes, so they read as pushed down or closing
 * up rather than jumping. Rows are the elements under `container` marked `data-flip-key`;
 * `state` names the rows listed and the ones open, and only a change of the open set over the
 * same rows animates, so a build switch or a filter that changes the rows stays instant. The
 * fold's own content is left to its own entrance. Skipped under reduced motion.
 */
export function useFoldSlide(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
  state: () => { rows: readonly string[]; open: readonly string[] },
) {
  let before: Map<string, Point> | null = null;
  const signature = () => {
    const { rows, open } = state();
    return { rows: rows.join("\n"), open: open.join("\n") };
  };

  // Before the DOM update, while the rows still sit where they were.
  watch(
    signature,
    (next, previous) => {
      before = null;
      if (!previous || next.rows !== previous.rows) return;
      if (next.open === previous.open || prefersReducedMotion()) return;
      before = measureRows(toValue(container));
    },
    { flush: "pre" },
  );

  // A fold is usually a child's `v-show`, applied after this component's own post-flush
  // watchers run; `nextTick` waits for the whole flush, still before the browser paints.
  watch(
    signature,
    async () => {
      if (!before) return;
      const from = before;
      before = null;
      await nextTick();
      slideRows(toValue(container), from);
    },
    { flush: "post" },
  );
}
