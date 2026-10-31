<script lang="ts">
import Monitor from "virtual:icon/monitor.vue";
import Moon from "virtual:icon/moon.vue";
import Sun from "virtual:icon/sun.vue";

/** How each preference is named and drawn, shared with AppHeader's overflow menu entry. */
export const THEME_LABELS = {
  system: "Theme: System",
  light: "Theme: Light",
  dark: "Theme: Dark",
} as const;

export const THEME_ICONS = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const;
</script>

<script setup lang="ts">
// System -> Light -> Dark -> System, one click at a time. Icon mirrors the current preference
// (monitor for system, sun for light, moon for dark).
import BaseButton from "./BaseButton.vue";
import BaseTooltip from "./BaseTooltip.vue";
import { preference, cyclePreference } from "../../stores/theme";
</script>

<template>
  <BaseTooltip :text="`${THEME_LABELS[preference]}`">
    <BaseButton :aria-label="THEME_LABELS[preference]" @click="cyclePreference">
      <component :is="THEME_ICONS[preference]" />
    </BaseButton>
  </BaseTooltip>
</template>
