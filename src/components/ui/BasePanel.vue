<script setup lang="ts">
// Side panel shell -- StatPanel.vue / BonusInspector.vue, and App.vue's sidebar tabs sit right
// above one. `flush` drops the top-left radius for the case where a tab strip sits flush
// against the panel's top edge (App.vue's sidebar).
withDefaults(defineProps<{ flush?: boolean }>(), { flush: false });
</script>

<template>
  <div
    class="overflow-x-auto rounded-md border border-line bg-surface px-3 pb-3.5 pt-2.5"
    :class="flush && 'rounded-tl-none'"
  >
    <slot />
  </div>
</template>
