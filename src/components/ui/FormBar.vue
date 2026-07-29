<script setup lang="ts">
// Sticky action bar at the top of an editing form (ItemForm/BonusSetForm/DataEditor) --
// bleeds to the edges of its padded parent and stays pinned while the form scrolls under it.
// Assumes a `p-3` parent, same as its own bleed margin.
</script>

<template>
  <div data-testid="form-bar" class="sticky top-0 z-2 -m-3 mb-3 flex flex-wrap items-center gap-1.5 border-b border-line bg-surface p-3">
    <slot />
  </div>
</template>
