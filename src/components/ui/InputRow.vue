<script setup lang="ts">
// A typed control in a fixed leading column, right-aligned, with its description after it. The
// column is a stepper's width, so a bare input stretches to fill it and every description in a
// stack starts at the same x. `note` renders muted after the description.
</script>

<template>
  <div
    data-testid="input-row"
    class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-2"
  >
    <div class="flex min-w-0 items-center justify-end gap-1">
      <slot />
    </div>
    <div class="min-w-0 flex flex-wrap items-baseline">
      <span>
        <slot name="description" />
      </span>
      <span v-if="$slots.note" class="ml-1.5 text-muted"
        ><slot name="note"
      /></span>
    </div>
  </div>
</template>
