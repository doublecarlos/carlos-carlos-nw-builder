import { nextTick, toValue, watch, type MaybeRefOrGetter } from "vue";
import {
  cancelSlides,
  prefersReducedMotion,
  slideFrom,
} from "../lib/row-slide";

/**
 * Slides whatever sits below a fold as it opens or closes, so it reads as pushed down or
 * closing up rather than jumping. A fold is the element under `container` marked
 * `data-fold-key`; `state` names the folds listed and the ones open, and only a change of the
 * open set over the same folds animates, so a build switch or a filter that changes the list
 * stays instant. The fold's own content is left to its own entrance. Skipped under reduced
 * motion.
 *
 * What sits below is found from the page, not the list: the elements after the fold, and
 * after each of its ancestors. That takes in a nested fold's outer list and the rest of the
 * form below it, and never one element inside another, so nothing slides twice. Only what
 * actually moved slides, so whatever lies outside the fold's scroll container stays put.
 */
export function useFoldSlide(
  container: MaybeRefOrGetter<HTMLElement | null | undefined>,
  state: () => { folds: readonly string[]; open: readonly string[] },
) {
  let pending: { elements: HTMLElement[]; tops: number[] } | null = null;
  const signature = () => {
    const { folds, open } = state();
    return { folds: folds.join("\n"), open: [...open] };
  };

  // Before the DOM update, while everything still sits where it was.
  watch(
    signature,
    (next, previous) => {
      pending = null;
      if (!previous || next.folds !== previous.folds) return;
      const toggled = symmetricDifference(previous.open, next.open);
      if (!toggled.length || prefersReducedMotion()) return;
      const root = toValue(container);
      if (!root) return;

      const elements = new Set<HTMLElement>();
      for (const key of toggled) {
        const fold = root.querySelector<HTMLElement>(
          `[data-fold-key="${CSS.escape(key)}"]`,
        );
        if (fold) for (const el of below(fold)) elements.add(el);
      }
      const list = [...elements];
      pending = {
        elements: list,
        tops: list.map((el) => el.getBoundingClientRect().top),
      };
    },
    { flush: "pre" },
  );

  // A fold is usually a child's `v-show` or `v-if`, applied after this component's own
  // post-flush watchers run; `nextTick` waits for the whole flush, still before the browser
  // paints.
  watch(
    signature,
    async () => {
      if (!pending) return;
      const { elements, tops } = pending;
      pending = null;
      await nextTick();
      cancelSlides(elements);
      elements.forEach((el, i) => {
        if (!el.isConnected) return;
        const dy = tops[i] - el.getBoundingClientRect().top;
        if (Math.abs(dy) >= 0.5) slideFrom(el, 0, dy);
      });
    },
    { flush: "post" },
  );
}

/** Keys in one list and not the other. */
function symmetricDifference(a: readonly string[], b: readonly string[]) {
  const left = new Set(a);
  const right = new Set(b);
  return [
    ...a.filter((key) => !right.has(key)),
    ...b.filter((key) => !left.has(key)),
  ];
}

/** The elements after `fold` and after each of its ancestors. The walk goes all the way up:
 *  a scroll container cannot be told apart from a box that only scrolls sideways, since
 *  either one reports `overflow-y: auto`. */
function below(fold: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (
    let node: HTMLElement | null = fold;
    node && node !== document.body;
    node = node.parentElement
  ) {
    for (
      let next = node.nextElementSibling;
      next;
      next = next.nextElementSibling
    )
      if (next instanceof HTMLElement) out.push(next);
  }
  return out;
}
