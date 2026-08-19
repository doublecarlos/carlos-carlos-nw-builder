<script setup lang="ts">
// System -> Light -> Dark -> System, one click at a time. Icon mirrors the current preference
// (monitor for system, sun for light, moon for dark).
import BaseButton from "./BaseButton.vue";
import BaseTooltip from "./BaseTooltip.vue";
import { Monitor, Moon, Sun } from "@lucide/vue";
import { preference, cyclePreference } from "../../stores/theme";

const labels = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
} as const;

const icon = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const;
</script>

<template>
  <BaseTooltip :text="`${labels[preference]} (click to change)`">
    <BaseButton @click="cyclePreference">
      <component :is="icon[preference]" />
      <span class="capitalize">{{ preference }}</span>
    </BaseButton>
  </BaseTooltip>
</template>
