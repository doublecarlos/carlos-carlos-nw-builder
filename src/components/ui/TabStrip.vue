<script setup lang="ts">
// Real tabs, not a row of pill buttons: each sits flush against its neighbour with only the
// top corners rounded, and the active one shares its background/bottom edge with the panel
// right below it so the seam disappears -- see TabButton.vue.
</script>

<template>
  <div class="relative z-1 -mb-px flex gap-0.5 pl-0.5">
    <slot />
  </div>
</template>
