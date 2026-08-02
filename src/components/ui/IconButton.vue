<script setup lang="ts">
// Slot-receiver icon button: the consumer supplies the icon (typically a lucide component)
// as the default slot. `title` drives both the native hover tooltip and the button's
// accessible name; icon svgs are auto-sized to match the old BaseIcon's 14px default.
withDefaults(
  defineProps<{
    title: string;
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button
    type="button"
    class="[&_svg]:size-3.5 cursor-pointer inline-flex items-center justify-center rounded p-1 text-muted enabled:hover:bg-surface-2 enabled:hover:text-accent disabled:cursor-default disabled:opacity-35"
    :title="title"
    :aria-label="title"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>
