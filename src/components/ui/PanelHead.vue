<script setup lang="ts">
// A panel's own internal section heading -- StatPanel/BonusInspector use several per panel, so
// this isn't BasePanel.vue's own header slot but a repeatable child.
</script>

<template>
  <div
    class="mt-3.5 mb-0.5 border-b border-line pb-1 uppercase tracking-wide text-muted"
  >
    <slot />
  </div>
</template>
