<script setup lang="ts">
// A typed control in a fixed leading column, right-aligned, with its description after it. The
// column is a stepper's width, so a bare input stretches to fill it and every description in a
// stack starts at the same x. `note` renders muted after the description.
//
// When the description cannot keep 10rem beside the control, it moves onto its own line under
// the control. This is a wrapping flex row rather than a container query: rows like
// PointAssignmentRow size an InputRow to its content, and a size container there would
// collapse to zero width.
</script>

<template>
  <div
    data-testid="input-row"
    class="flex flex-wrap items-center gap-x-2 gap-y-0.5"
  >
    <div class="flex w-28 flex-none items-center justify-end gap-1">
      <slot />
    </div>
    <div class="flex min-w-0 flex-1 basis-40 flex-wrap items-baseline">
      <span>
        <slot name="description" />
      </span>
      <span v-if="$slots.note" class="ml-1.5 text-muted"
        ><slot name="note"
      /></span>
    </div>
  </div>
</template>
