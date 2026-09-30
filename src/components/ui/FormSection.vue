<script setup lang="ts">
// Section heading inside an editing form. `sub` is a nested grouping one level down: sentence
// case and a lighter divider. `inline` is a label within a row, so it has no divider or margin.
// `nested` is a whole form embedded in another's card (a bonus inside an item): the same
// uppercase heading, muted and smaller, so it reads as below the outer form's own sections.
import { computed } from "vue";

const props = withDefaults(
  defineProps<{ sub?: boolean; inline?: boolean; nested?: boolean }>(),
  { sub: false, inline: false, nested: false },
);

const classes = computed(() => {
  if (props.inline) return ["text-text"];
  if (props.sub)
    return [
      "mt-2",
      "mb-1",
      "border-b",
      "border-line/60",
      "pb-0.5",
      "text-text",
    ];
  const heading = [
    "mt-3",
    "mb-1.5",
    "border-b",
    "pb-1",
    "uppercase",
    "tracking-wide",
  ];
  return props.nested
    ? [...heading, "border-line/60", "text-muted", "text-[0.85em]"]
    : [...heading, "border-line", "text-text"];
});
</script>

<template>
  <div class="flex items-center gap-2 font-semibold" :class="classes">
    <slot />
  </div>
</template>
