<script setup lang="ts">
// One tab, drawn as an ordinary button: the seam-erasing version only looked right where the
// strip sat directly on a panel border, which is not true of every call site.
import { computed } from "vue";

const props = withDefaults(defineProps<{ active?: boolean }>(), {
  active: false,
});

const toneClasses = computed(() =>
  props.active
    ? "border-accent bg-accent-soft font-semibold text-accent"
    : "border-line bg-surface-2 text-muted hover:bg-surface hover:text-text",
);
</script>

<template>
  <button
    type="button"
    class="flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5"
    :class="toneClasses"
    :aria-pressed="active"
  >
    <slot />
  </button>
</template>
