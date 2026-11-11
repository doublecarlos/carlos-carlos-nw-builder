<script setup lang="ts">
// A typed control in a fixed leading column, right-aligned, with its description after it. The
// column is a stepper's width, so a bare input stretches to fill it and every description in a
// stack starts at the same x. `note` renders muted after the description, and `presets`, one-click
// values for the control, follow the description's text. A phone keeps the same layout, the
// description wrapping beside the control. A coarse pointer draws the stepper's buttons larger,
// so the column grows to match.
</script>

<template>
  <div
    data-testid="input-row"
    class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-2 pointer-coarse:grid-cols-[calc(2*var(--spacing-tap-drawn)+4rem)_minmax(0,1fr)]"
  >
    <div
      data-testid="input-row-control"
      class="flex min-w-0 items-center justify-end gap-1"
    >
      <slot />
    </div>
    <div
      data-testid="input-row-description"
      class="min-w-0 flex flex-wrap items-baseline"
    >
      <span>
        <slot name="description" />
        <template v-if="$slots.presets">
          {{ " " }}<span class="ml-1.5"><slot name="presets" /></span>
        </template>
      </span>
      <span v-if="$slots.note" class="ml-1.5 text-muted"
        ><slot name="note"
      /></span>
    </div>
  </div>
</template>
