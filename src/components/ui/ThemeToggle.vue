<script setup lang="ts">
// System -> Light -> Dark -> System, one click at a time.
// TODO: no sun/moon/monitor glyph in src/assets/icons yet -- text label stands in until one's
// added to icons.ts (see AGENTS.md: assets are real lucide files imported with ?raw, not
// hand-drawn markup).
import BaseButton from "./BaseButton.vue";
import { preference, cyclePreference } from "../../stores/theme";

const labels = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
} as const;
</script>

<template>
  <BaseButton
    :title="`${labels[preference]} (click to change)`"
    @click="cyclePreference"
  >
    <span class="capitalize">{{ preference }}</span>
  </BaseButton>
</template>
