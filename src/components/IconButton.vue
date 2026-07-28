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
