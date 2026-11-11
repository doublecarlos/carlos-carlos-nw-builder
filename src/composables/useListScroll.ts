// A list's scroll position, remembered by key across remounts, with its current row kept in
// view. A phone unmounts the layer editor's list while a form shows, so Back to the list
// returns to where it was; the row marked `aria-current="true"` scrolls into view whenever it
// changes or the remembered position does not show it.
import { onMounted, watch, type Ref } from "vue";
import { useEventListener } from "@vueuse/core";

const positions = new Map<string, number>();

export function useListScroll(
  scroller: Readonly<Ref<HTMLElement | null>>,
  key: () => string,
  current: () => unknown,
) {
  function currentRow() {
    return scroller.value?.querySelector<HTMLElement>('[aria-current="true"]');
  }

  /** Scrolls the current row into view, leaving the list alone when it already shows. */
  function reveal() {
    currentRow()?.scrollIntoView({ block: "nearest" });
  }

  function restore() {
    const el = scroller.value;
    if (el) el.scrollTop = positions.get(key()) ?? 0;
    reveal();
  }

  onMounted(restore);
  watch(key, restore, { flush: "post" });
  watch(current, reveal, { flush: "post" });
  useEventListener(
    scroller,
    "scroll",
    () => {
      if (scroller.value) positions.set(key(), scroller.value.scrollTop);
    },
    { passive: true },
  );

  /** Focuses the current row without scrolling past where `reveal` put it. */
  function focusCurrent() {
    reveal();
    currentRow()?.focus({ preventScroll: true });
  }

  return { reveal, focusCurrent };
}
