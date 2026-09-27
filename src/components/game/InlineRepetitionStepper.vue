<script setup lang="ts">
// One item's inline-repetition count (`Item.inlineRepetition`): a caption over a NumberStepper.
// Shared by PointAssignmentInput (one per candidate) and ItemPickerRow (one for the current
// pick), so the control reads and behaves the same either way.
import NumberStepper from "../ui/NumberStepper.vue";

defineProps<{
  itemId: string;
  label: string;
  /** Current count, already resolved against the config's `default` by the caller. */
  value: number;
  min: number;
  max: number;
  /** Namespaces the `data-testid`s below: one build can hold two steppers for one item. */
  testidPrefix: string;
}>();

const emit = defineEmits<{
  change: [count: number];
  /** Hovering the caption, forwarded so the owning row can feed useHoverCard.ts. */
  labelEnter: [event: MouseEvent];
  labelLeave: [];
}>();
</script>

<template>
  <div class="flex flex-col items-center gap-1">
    <span
      class="truncate text-center"
      :data-testid="`${testidPrefix}-label-${itemId}`"
      :data-item-id="itemId"
      @mouseenter="emit('labelEnter', $event)"
      @mouseleave="emit('labelLeave')"
      >{{ label }}</span
    >
    <NumberStepper
      :min="min"
      :max="max"
      :model-value="value"
      :data-testid="`${testidPrefix}-input-${itemId}`"
      @update:model-value="emit('change', $event)"
    />
    <slot />
  </div>
</template>
