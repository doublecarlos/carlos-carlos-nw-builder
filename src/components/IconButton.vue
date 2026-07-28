<script setup lang="ts">
// Shared icon-button: a `button.link` whose content is a 24x24 lucide glyph plus an inline
// `<title>` for the native hover tooltip (and the accessible name, since the svg is the
// button's only content).
import { computed } from 'vue';
import { icons } from '../icons';

const props = withDefaults(defineProps<{
  icon: string;
  title: string;
  disabled?: boolean;
}>(), {
  disabled: false,
});

defineEmits<{ click: [] }>();

// `<title>` inside the svg drives both the hover tooltip and the button's accessible name.
const markup = computed(() => `${icons[props.icon] ?? ''}<title>${props.title}</title>`);
</script>

<template>
  <button type="button" class="link icon-btn" :disabled="disabled" @click="$emit('click')">
    <svg role="img" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
         stroke-linejoin="round" class="lucide" v-html="markup"></svg>
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

.lucide {
  width: 1em;
  height: 1em;
}
</style>
