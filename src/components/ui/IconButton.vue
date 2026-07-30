<script setup lang="ts">
// Shared icon-button: a `button.link` wrapping a single Icon, whose `title` drives both the
// native hover tooltip and the button's accessible name (the icon is the button's only content).
import Icon from './Icon.vue';

withDefaults(defineProps<{
  icon: string;
  title: string;
  disabled?: boolean;
}>(), {
  disabled: false,
});

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button type="button" class="cursor-pointer inline-flex items-center justify-center rounded p-1 text-muted enabled:hover:bg-surface-2 enabled:hover:text-accent disabled:cursor-default disabled:opacity-35"
          :disabled="disabled" @click="$emit('click', $event)">
    <Icon :name="icon" :title="title" />
  </button>
</template>
