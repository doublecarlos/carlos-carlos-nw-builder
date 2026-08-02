<script setup lang="ts">
// Scrollable body area of a BaseCard. Provides overflow-y: auto and padding.
</script>

<template>
  <div class="overflow-y-auto overscroll-contain px-2.5 py-2">
    <slot />
  </div>
</template>
