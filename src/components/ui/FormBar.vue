<script setup lang="ts">
// Sticky action bar at the top of an editing form (ItemForm/BonusSetForm/DataEditor).
// The parent owns the outer spacing (the `-m-3 mb-3` convention used by the form's
// `p-3` container).
</script>

<template>
  <div
    data-testid="form-bar"
    class="sticky top-0 z-2 flex flex-wrap items-center gap-1.5 border-b border-line bg-surface p-3"
  >
    <slot />
  </div>
</template>
