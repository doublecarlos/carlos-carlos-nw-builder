<script setup lang="ts">
// Reads `storageFailed`, not just the happy path: the toast announcing a failed write clears
// itself after a few seconds, and this line is what is left saying so afterwards.
import { computed } from "vue";
import HardDrive from "virtual:icon/hard-drive.vue";
import TriangleAlert from "virtual:icon/triangle-alert.vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import { storageFailed } from "../stores/notice";

const label = computed(() =>
  storageFailed.value
    ? "Not saved to this browser"
    : "Auto-saved to this browser",
);

const tooltip = computed(() =>
  storageFailed.value
    ? "This browser's storage cannot be written to. Use Export to save a copy before closing the tab."
    : "Edits are saved automatically to this browser's storage. That storage can be cleared or lost; use Export to keep a backup elsewhere.",
);

const toneClass = computed(() =>
  storageFailed.value ? "text-danger" : "text-muted",
);
</script>

<template>
  <BaseTooltip :text="tooltip" :width="300" tappable>
    <span
      class="flex items-center gap-1 whitespace-nowrap"
      :class="toneClass"
      data-testid="autosave-indicator"
      :data-state="storageFailed ? 'failed' : 'saving'"
      tabindex="0"
    >
      <TriangleAlert v-if="storageFailed" class="h-[14px] w-[14px]" />
      <HardDrive v-else class="h-[14px] w-[14px]" />
      <!-- Below lg the icon alone carries it; the tooltip and screen readers keep the words. -->
      <span class="max-lg:sr-only">{{ label }}</span>
    </span>
  </BaseTooltip>
</template>
