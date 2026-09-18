<script setup lang="ts">
// A row inside BaseMenu. `tabindex="-1"` means useRovingFocus is the only thing that ever puts
// Tab-focus on it. Enter/Space activate it for free since it's a native button. Left as a plain
// button rather than `role="menuitem"`: the existing test suite (and real screen readers, for a
// list this short) reads these by their native "button" role.
import type { Component } from "vue";

withDefaults(
  defineProps<{
    icon?: Component;
    danger?: boolean;
    disabled?: boolean;
  }>(),
  { icon: undefined, danger: false, disabled: false },
);

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button
    type="button"
    tabindex="-1"
    class="inline-flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left"
    :class="
      disabled
        ? 'text-muted'
        : danger
          ? 'cursor-pointer hover:bg-danger-soft hover:text-danger'
          : 'cursor-pointer hover:bg-surface-2'
    "
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <component :is="icon" v-if="icon" class="size-[14px] flex-none" />
    <slot />
  </button>
</template>
