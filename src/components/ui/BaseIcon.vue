<script setup lang="ts">
// Standalone 1em lucide glyph. `title`, if given, becomes both the SVG's accessible name and
// its native hover tooltip -- the same role it plays inline in IconButton, just generalized so
// any consumer can render a bare icon.
import { computed } from "vue";
import { icons } from "../../lib/icons";

const props = defineProps<{
  name: string;
  title?: string;
}>();

const markup = computed(() => icons[props.name] ?? "");
</script>

<template>
  <svg
    role="img"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="size-3.5"
  >
    <title v-if="title">{{ title }}</title>
    <!-- `markup` is a bundled lucide glyph looked up by a developer-supplied icon name
         (icons.ts), never user input. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <g v-html="markup"></g>
  </svg>
</template>
