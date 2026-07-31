<script setup lang="ts">
// Read-only, resizable JSON preview -- DataEditor's export panel, BuildBar's export/import.
defineProps<{ value: string; rows?: number }>();

function selectAll(event: FocusEvent) {
  (event.target as HTMLTextAreaElement).select();
}
</script>

<template>
  <textarea
    class="w-full resize-y rounded-md border border-line bg-surface p-2 font-mono"
    :rows="rows ?? 12"
    readonly
    :value="value"
    @focus="selectAll"
  ></textarea>
</template>
