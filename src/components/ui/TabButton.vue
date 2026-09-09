<script setup lang="ts">
// `margin-bottom: -1px` on TabStrip pulls the row down onto the panel's own top border, and
// the active tab paints its bottom border in the panel's own background colour to erase the
// seam -- `border-b-surface` when active does that.
//
// `z-2` is deliberately not on base.css's scale: local ordering against its own siblings, one
// above TabStrip's `z-base`, never escaping to overlap anything else.
import { computed } from "vue";

const props = withDefaults(defineProps<{ active?: boolean }>(), {
  active: false,
});

const toneClasses = computed(() =>
  props.active
    ? "relative z-2 border-line border-b-surface bg-surface font-semibold text-text"
    : "border-line bg-surface-2 text-muted hover:bg-surface hover:text-text",
);
</script>

<template>
  <button
    type="button"
    class="flex items-center gap-1.5 rounded-t-md border px-3 py-1.5"
    :class="toneClasses"
  >
    <slot />
  </button>
</template>
