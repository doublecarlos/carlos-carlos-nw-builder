<script setup lang="ts">
// Reusable kebab-menu flyout for builds, layers, and trash entries. Positioned by the
// parent via absolute `position` (fixed to the viewport, already computed by Nav.vue).
defineProps<{
  position: { top: number; left: number };
  items: {
    action: string;
    label: string;
    danger?: boolean;
    disabled?: boolean;
  }[];
}>();

defineEmits<{
  action: [action: string];
}>();
</script>

<template>
  <div
    class="navmenu fixed z-30 flex min-w-48 -translate-x-full flex-col rounded-md border border-line bg-surface p-1 shadow-lg"
    :style="{ top: position.top + 'px', left: position.left + 'px' }"
  >
    <button
      v-for="item in items"
      :key="item.action"
      type="button"
      class="rounded-md px-2 py-1 text-left"
      :class="
        item.disabled
          ? 'text-muted'
          : item.danger
            ? 'cursor-pointer hover:bg-danger-soft hover:text-danger'
            : 'cursor-pointer hover:bg-surface-2'
      "
      :disabled="item.disabled"
      @click="$emit('action', item.action)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
