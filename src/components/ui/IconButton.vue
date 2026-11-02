<script setup lang="ts">
// Icon-only BaseButton: the consumer supplies the icon (typically a lucide component) as the
// default slot. `title` is required, as both the accessible name (the button has no visible
// text) and the tooltip; `label` splits the two when the tooltip carries detail that would
// leave the name unstable (a step, a count).
import BaseButton from "./BaseButton.vue";

withDefaults(
  defineProps<{
    title: string;
    /** The accessible name, when it should stay put while `title` changes. */
    label?: string;
    disabled?: boolean;
  }>(),
  {
    label: undefined,
    disabled: false,
  },
);

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <BaseButton
    variant="subtle"
    shape="icon"
    :title="title"
    :disabled="disabled"
    :aria-label="label ?? title"
    @click="$emit('click', $event)"
  >
    <slot />
  </BaseButton>
</template>
