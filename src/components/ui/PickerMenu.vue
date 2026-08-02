<script setup lang="ts">
import { ref } from "vue";

// Floating dropdown shell shared by ComboBox and ItemPicker -- same interaction (type to
// filter, arrow keys, Enter, Escape), just different row content. `data-testid` rather than a
// styling class: e2e specs need a stable hook that survives restyling.

const el = ref<HTMLElement | null>(null);

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
    class="absolute inset-x-0 top-full z-30 mt-0.5 max-h-80 overflow-y-auto rounded-md border border-line bg-surface shadow-lg"
  >
    <slot />
  </div>
</template>
