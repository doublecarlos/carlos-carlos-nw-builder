<script setup lang="ts">
// Quieter than a badge: a plain dot for "not saved yet", not a number to read. `data-testid`
// rather than a styling class -- nothing else about this element needs a name, and a Tailwind
// utility string is not a stable thing for a test to depend on.
</script>

<template>
  <span class="inline-block size-1.5 flex-none rounded-full bg-accent" data-testid="unsaved-dot"></span>
</template>
