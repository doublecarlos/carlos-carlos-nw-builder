<script setup lang="ts">
// A row of FormField instances: ItemForm, BonusForm, SlotForm, PresetForm, SectionForm,
// FilterForm.
//
// Wide, it is a wrapping flow where each field keeps the width its caller gives it (a `w-*`, a
// growing `flex-1`). Narrow, the fields stack one per line at full width, and so do their
// controls: a caller's widths are sized for the flow and are overridden there.
//
// The wrapper is the size container, so the switch answers to the grid's own width rather than
// the viewport: the same form lays out the same in a desktop rail, a nested card or a phone.
// Give it a definite width (a block, or a growing flex item): a size container never grows to
// fit its content, so as a content-sized flex item it collapses.
</script>

<template>
  <div class="@container">
    <div
      data-testid="form-grid"
      class="flex flex-wrap gap-x-3 gap-y-2 @max-md:flex-col @max-md:*:w-full! @max-md:*:min-w-0! @max-md:*:flex-none! @max-md:[&>*>*:not(button)]:w-full!"
    >
      <slot />
    </div>
  </div>
</template>
