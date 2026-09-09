import { ref, nextTick, watch, type Ref } from "vue";
import { onKeyStroke } from "@vueuse/core";

/**
 * The open/query/highlight state and ArrowUp/ArrowDown/Escape handling shared by CreatableComboBox
 * and TokenInput: both are a text input driving a filtered menu, with the highlighted row clamped
 * to the current entry list and Escape closing on the spot. Committing a highlighted entry
 * (Enter/Tab/comma) stays with each caller, since what "commit" means differs - replace the field
 * versus add another token.
 */
export function useMenuNavigation(options: {
  target: Ref<HTMLElement | null>;
  entryCount: () => number;
  /** Runs after the DOM reflects a new `highlight`, to scroll the highlighted row into view. */
  onHighlightChange?: () => void;
}) {
  const open = ref(false);
  const query = ref("");
  const highlight = ref(0);

  if (options.onHighlightChange) {
    const onHighlightChange = options.onHighlightChange;
    watch(highlight, () => nextTick(onHighlightChange));
  }

  function close() {
    open.value = false;
    query.value = "";
  }

  onKeyStroke(
    ["ArrowDown", "ArrowUp"],
    (event) => {
      event.preventDefault();
      open.value = true;
      const step = event.key === "ArrowDown" ? 1 : -1;
      highlight.value = Math.min(
        Math.max(highlight.value + step, 0),
        options.entryCount() - 1,
      );
    },
    { target: options.target },
  );

  onKeyStroke("Escape", close, { target: options.target });

  return { open, query, highlight, close };
}
