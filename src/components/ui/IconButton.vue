<script setup lang="ts">
// Slot-receiver icon button: the consumer supplies the icon (typically a lucide component)
// as the default slot. `title` is both the button's accessible name (it has no visible text)
// and the text of the tooltip showing it on hover or keyboard focus; icon svgs are auto-sized
// to match the old BaseIcon's 14px default.
//
// `inheritAttrs: false` plus an explicit `v-bind="$attrs"`: BaseTooltip wraps the button, so
// without this a caller's `class` would settle on that wrapper rather than the button itself.
import BaseTooltip from "./BaseTooltip.vue";

defineOptions({ inheritAttrs: false });

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
  <BaseTooltip :text="title">
    <button
      v-bind="$attrs"
      type="button"
      class="[&_svg]:size-[14px] cursor-pointer inline-flex items-center justify-center rounded p-1 text-muted enabled:hover:bg-surface-2 enabled:hover:text-accent disabled:cursor-default disabled:opacity-35"
      :aria-label="title"
      :disabled="disabled"
      @click="$emit('click', $event)"
    >
      <slot />
    </button>
  </BaseTooltip>
</template>
