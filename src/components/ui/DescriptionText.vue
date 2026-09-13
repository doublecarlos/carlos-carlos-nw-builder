<script setup lang="ts">
// Renders the paragraphs of an authored description (`descriptionParagraphs`).
withDefaults(
  defineProps<{
    paragraphs: string[];
    /** Mutes the prose where it sits beside primary content, as on a stable card. */
    muted?: boolean;
  }>(),
  { muted: false },
);
</script>

<template>
  <div
    v-if="paragraphs.length"
    class="space-y-1.5 leading-snug"
    :class="muted && 'text-muted'"
  >
    <p v-for="(paragraph, index) in paragraphs" :key="index">
      {{ paragraph }}
    </p>
  </div>
</template>
