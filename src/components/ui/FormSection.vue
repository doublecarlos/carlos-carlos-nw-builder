<script setup lang="ts">
// Section heading inside an editing form. `sub` drops the border/uppercase for a nested
// grouping one level down (e.g. a sub-heading inside a bonus's form).
import { computed } from "vue";

const props = withDefaults(defineProps<{ sub?: boolean }>(), { sub: false });

const sizeClasses = computed(() =>
  props.sub
    ? "mt-2 mb-1 text-sm"
    : "mt-3 mb-1.5 border-b border-line pb-1 text-sm uppercase tracking-wide",
);
</script>

<template>
  <div
    class="flex items-center gap-2 font-semibold text-text"
    :class="sizeClasses"
  >
    <slot />
  </div>
</template>
