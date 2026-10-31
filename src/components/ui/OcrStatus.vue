<script setup lang="ts">
// Progress and failure of a screenshot paste, out of flow over whatever follows the field. A
// control that grows a line while it works moves everything below it, and these work mid-edit.
// Sits inside a `relative` wrapper around the field.
import LoaderCircle from "virtual:icon/loader-circle.vue";

defineProps<{ busy: boolean; error: string }>();
</script>

<template>
  <p
    v-if="busy"
    class="absolute top-full left-0 z-sticky flex items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-0.5 text-muted shadow-lg"
    data-testid="ocr-field-busy"
  >
    <LoaderCircle class="animate-spin" />Reading the screenshot…
  </p>
  <p
    v-else-if="error"
    class="absolute top-full left-0 z-sticky max-w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-error shadow-lg"
    data-testid="ocr-field-error"
  >
    {{ error }}
  </p>
</template>
