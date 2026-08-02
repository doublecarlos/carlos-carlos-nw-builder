<script setup lang="ts">
// One row inside ComboBoxMenu.vue. `data-highlighted` is a JS/scroll-into-view hook (see
// ComboBox.vue's `watch(highlight, ...)`), kept separate from the `highlighted` prop's
// Tailwind styling so restyling the row never breaks that lookup.
withDefaults(defineProps<{ highlighted?: boolean; muted?: boolean }>(), {
  highlighted: false,
  muted: false,
});

defineSlots<{
  default(): unknown;
}>();
</script>

<template>
  <div
    class="cursor-pointer px-2 py-1"
    :class="[highlighted && 'bg-accent-soft', muted && 'italic text-muted']"
    :data-highlighted="highlighted || undefined"
  >
    <slot />
  </div>
</template>
