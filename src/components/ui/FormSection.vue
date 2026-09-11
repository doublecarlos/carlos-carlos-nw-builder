<script setup lang="ts">
// Section heading inside an editing form. `sub` drops the border/uppercase for a nested
// grouping one level down (e.g. a sub-heading inside a bonus's form).
import { computed } from "vue";

const props = withDefaults(defineProps<{ sub?: boolean; inline?: boolean }>(), {
  sub: false,
  inline: false,
});

const classes = computed(() => {
  let marginClasses = props.sub ? ["mt-2", "mb-1"] : ["mt-3", "mb-1.5"];
  if (props.inline) marginClasses = [];

  const formatClasses = props.sub
    ? []
    : ["border-b", "border-line", "pb-1", "uppercase", "tracking-wide"];

  return [...marginClasses, ...formatClasses];
});
</script>

<template>
  <div class="flex items-center gap-2 font-semibold text-text" :class="classes">
    <slot />
  </div>
</template>
