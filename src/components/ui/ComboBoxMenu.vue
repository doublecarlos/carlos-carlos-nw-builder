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
    wide?: boolean;
  }>(),
  { wide: false },
);

const el = useTemplateRef("el");

/** Scroll the `[data-highlighted]` row into view. Called by the parent picker's
 * `watch(highlight, ...)` instead of reaching into `$el`. */
function scrollToHighlighted() {
  el.value
    ?.querySelector("[data-highlighted]")
    ?.scrollIntoView({ block: "nearest" });
}

defineExpose({ scrollToHighlighted });

defineSlots<{
  default(): unknown;
}>();
</script>

<template>
  <div
    ref="el"
    data-testid="picker-menu"
    class="absolute top-full z-30 mt-0.5 max-h-80 overflow-y-auto rounded-md border border-line bg-surface shadow-lg"
    :class="wide ? 'left-0 w-[min(28rem,90vw)]' : 'inset-x-0'"
  >
    <slot />
  </div>
</template>
