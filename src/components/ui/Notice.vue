<script setup lang="ts">
// Dismissible inline message -- App.vue's topbar notice, DataEditor's own. Click to dismiss;
// the parent owns clearing its message text.
defineEmits<{ dismiss: [] }>();
</script>

<template>
  <span class="cursor-pointer rounded-md bg-accent-soft px-2 py-0.5" @click="$emit('dismiss')">
    <slot />
  </span>
</template>
