<script setup lang="ts">
// Side panel shell: StatPanel.vue and BonusInspector.vue.
import { useTemplateRef } from "vue";

const root = useTemplateRef<HTMLElement>("root");

/** The panel's own element, for callers that look up rows inside it. */
defineExpose({ root });
</script>

<template>
  <div
    ref="root"
    class="overflow-x-auto rounded-md border border-line bg-surface px-3 pb-3.5 pt-2.5"
  >
    <slot />
  </div>
</template>
