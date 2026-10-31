// Keeps a focused text field out from under the on-screen keyboard. The panes scroll inside
// their own containers, so where the keyboard only shrinks the visual viewport (iOS Safari),
// the browser's own reveal has no page scroll to pan and can leave the field covered. This
// scrolls the field's own scroller instead, when the visible box shrinks or a field gets focus.
//
// BaseSheet and ComboBoxScreen size themselves to the visible box already, so fields inside
// them (marked `data-fits-visual-viewport`) are left alone.
import { ref, watch } from "vue";
import { useEventListener } from "@vueuse/core";
import { useVisualViewport } from "./useVisualViewport";
import { revealDelta } from "../lib/visual-viewport";

const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
]);

/** A field that brings up the on-screen keyboard. A read-only one doesn't: a phone picker opens
 *  its own screen instead. */
function isTextEntry(el: Element | null): el is HTMLElement {
  if (el instanceof HTMLInputElement)
    return !el.readOnly && !NON_TEXT_INPUTS.has(el.type);
  return (
    (el instanceof HTMLTextAreaElement && !el.readOnly) ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
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

/** Returns whether a text field has focus, for chrome that should make way while typing. */
export function useRevealFocusedField() {
  const box = useVisualViewport();
  const typing = ref(false);

  function reveal() {
    const field = document.activeElement;
    if (!isTextEntry(field) || field.closest("[data-fits-visual-viewport]"))
      return;
    const delta = revealDelta(field.getBoundingClientRect(), box.value);
    if (!delta) return;
    const scroller = scrollParent(field);
    if (scroller) scroller.scrollTop += delta;
  }

  useEventListener(document, "focusin", (event) => {
    typing.value = isTextEntry(event.target as Element);
    if (typing.value) requestAnimationFrame(reveal);
  });
  useEventListener(document, "focusout", () => {
    typing.value = false;
  });
  watch(box, (next, prev) => {
    if (next.height < prev.height) reveal();
  });

  return { typing };
}
