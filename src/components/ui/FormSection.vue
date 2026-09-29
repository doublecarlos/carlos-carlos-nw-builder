<script setup lang="ts">
// Section heading inside an editing form. `sub` is a nested grouping one level down: sentence
// case and a lighter divider. `inline` is a label within a row, so it has no divider or margin.
import { computed } from "vue";

const props = withDefaults(defineProps<{ sub?: boolean; inline?: boolean }>(), {
  sub: false,
  inline: false,
});

const classes = computed(() => {
  if (props.inline) return [];
  return props.sub
    ? ["mt-2", "mb-1", "border-b", "border-line/60", "pb-0.5"]
    : [
        "mt-3",
        "mb-1.5",
        "border-b",
        "border-line",
        "pb-1",
        "uppercase",
        "tracking-wide",
      ];
});
</script>

<template>
  <div class="flex items-center gap-2 font-semibold text-text" :class="classes">
    <slot />
  </div>
</template>
