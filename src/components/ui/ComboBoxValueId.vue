<script setup lang="ts">
// The id a closed ComboBox or CreatableComboBox shows after its label (`showValue`), laid over
// the box. An invisible copy of the label pushes the id to just past the box's own text, so
// the id truncates first and never covers the label. Hidden from assistive tech, which reads
// the label as the box's value.
defineProps<{ label: string; value: string }>();
</script>

<template>
  <div
    aria-hidden="true"
    class="pointer-events-none absolute inset-y-0 left-0 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-pre border border-transparent py-0.5 pl-1.5"
  >
    <span class="invisible max-w-full shrink-0 overflow-hidden">{{
      label
    }}</span>
    <span
      class="min-w-0 overflow-hidden text-ellipsis text-xs text-muted"
      data-testid="combobox-value-id"
      >{{ value }}</span
    >
  </div>
</template>
