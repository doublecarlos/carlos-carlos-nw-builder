<script setup lang="ts">
// A row of FormField instances on shared columns: ItemForm, BonusForm, SlotForm, PresetForm,
// SectionForm, FilterForm.
//
// The wrapper is the size container: the grid answers to its own width, not the viewport, so
// the same form lays out the same in a desktop rail, a nested card or a phone. Below `@md` each
// field takes a full-width line; from there the fields share equal columns of at least 10rem,
// collapsing empty tracks so a short row still fills the width. Give it a definite width: as a
// content-sized flex item, a size container collapses to nothing.
//
// The grid owns its cells' widths: a width class on a field is overridden. Each field spans a
// label row and a control row (see FormField), so controls align even when labels wrap.
import { provideFormGrid } from "../../composables/useFormField";

provideFormGrid();
</script>

<template>
  <div class="@container">
    <div
      data-testid="form-grid"
      class="grid grid-cols-1 gap-x-3 gap-y-2 *:row-span-2 *:w-auto! *:min-w-0! @md:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]"
    >
      <slot />
    </div>
  </div>
</template>
