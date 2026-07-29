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
  <button type="button" class="link icon-btn" :disabled="disabled" @click="$emit('click', $event)">
    <Icon :name="icon" :title="title" />
  </button>
</template>

<style scoped>
/* Quieter than the text `.link` style it's built on -- muted by default, accent only on
 * hover -- since a row of six of these next to each other would otherwise read louder than
 * the row's actual content. `button.icon-btn` (not `.icon-btn`) matches `button.link`'s
 * specificity so this wins the padding/color tie by source order. */
button.icon-btn {
  align-items: center;
  border-radius: 4px;
  color: var(--muted);
  display: inline-flex;
  justify-content: center;
  padding: 3px;
}
button.icon-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--accent); }
button.icon-btn:disabled { opacity: .35; }
</style>
