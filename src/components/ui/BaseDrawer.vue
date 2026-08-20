<script setup lang="ts">
// Generic in-flow panel: a surface that stays in the layout because it is worked *alongside*
// what is beneath it -- the layer editor's findings list, which you act on while editing.
// Anything you open, use and leave is a BaseModal instead.
</script>

<template>
  <div class="rounded-md border border-line bg-surface-2 p-2.5 px-3">
    <slot />
  </div>
</template>
