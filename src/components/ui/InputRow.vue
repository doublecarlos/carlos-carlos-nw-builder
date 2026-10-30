<script setup lang="ts">
// A typed control in a fixed leading column, right-aligned, with its description after it. The
// column is a stepper's width, so a bare input stretches to fill it and every description in a
// stack starts at the same x. `note` renders muted after the description.
//
// A phone has no room for the column: the description reads first and the control sits under
// it, left-aligned like the phone's other build rows.
</script>

<template>
  <div
    data-testid="input-row"
    class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-2 max-md:flex max-md:flex-col max-md:items-start max-md:gap-y-1"
  >
    <div
      data-testid="input-row-control"
      class="flex min-w-0 items-center justify-end gap-1 max-md:order-last max-md:max-w-full max-md:min-w-28 max-md:justify-start"
    >
      <slot />
    </div>
    <div
      data-testid="input-row-description"
      class="min-w-0 flex flex-wrap items-baseline"
    >
      <span>
        <slot name="description" />
      </span>
      <span v-if="$slots.note" class="ml-1.5 text-muted"
        ><slot name="note"
      /></span>
    </div>
  </div>
</template>
