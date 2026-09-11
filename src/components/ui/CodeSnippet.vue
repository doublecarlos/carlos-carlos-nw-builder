<script setup lang="ts">
// Simple code snippet component.
// Inline by default, call with class="block" for a code block.
</script>

<template>
  <code
    class="overflow-x-auto rounded-md bg-surface-2 p-1 font-mono text-text-700"
  >
    <slot></slot>
  </code>
</template>
