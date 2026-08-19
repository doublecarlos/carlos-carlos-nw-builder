<script setup lang="ts">
import { useTemplateRef } from "vue";

// Floating dropdown shell used by ComboBox.vue. Same interaction (type to filter, arrow keys,
// Enter, Escape), just different row content via the `#option` slot. `data-testid` rather than
// a styling class: e2e specs need a stable hook that survives restyling.

withDefaults(
  defineProps<{
    /** Grows the menu past the input's own width, up to a cap, instead of matching it exactly
     *  -- for callers (ItemPicker) whose row content (stat/bonus preview) needs more room than
     *  a plain option label does. Anchored to the input's left edge, so it only ever grows
     *  rightward. */
    menuClass?: string;
    /** The listbox's own id, so the input driving it can point `aria-controls` here and its
     *  `aria-activedescendant` at one of the rows inside. Omitted by callers that have not
     *  been wired for it yet -- the role still applies, only the association is missing. */
    listboxId?: string;
  }>(),
  { menuClass: "inset-x-0", listboxId: undefined },
);

const el = useTemplateRef("el");

/** Scroll the `[data-highlighted]` row into view. Called by the parent picker's
 * `watch(highlight, ...)` instead of reaching into `$el`.
 *
 * Adjusts this menu's own `scrollTop` rather than calling `scrollIntoView`: that scrolls every
 * scrollable ancestor, the document included, so opening a picker whose selected row sits far
 * down the list would yank the page out from under the input the user just clicked. The maths
 * below is `block: "nearest"`, scoped to the menu box. */
function scrollToHighlighted() {
  const menu = el.value;
  const row = menu?.querySelector("[data-highlighted]");
  if (!menu || !row) return;
  const menuBox = menu.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  if (rowBox.top < menuBox.top) menu.scrollTop -= menuBox.top - rowBox.top;
  else if (rowBox.bottom > menuBox.bottom)
    menu.scrollTop += rowBox.bottom - menuBox.bottom;
}

defineExpose({ scrollToHighlighted });

defineSlots<{
  default(): unknown;
}>();
</script>

<template>
  <div
    :id="listboxId"
    ref="el"
    role="listbox"
    data-testid="picker-menu"
    class="absolute top-full z-30 mt-0.5 max-h-80 overflow-y-auto rounded-md border border-line bg-surface shadow-lg"
    :class="menuClass"
  >
    <slot />
  </div>
</template>
