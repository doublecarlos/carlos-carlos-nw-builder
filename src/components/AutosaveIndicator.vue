<script setup lang="ts">
// Reads `storageFailed`, not just the happy path: the toast announcing a failed write clears
// itself after a few seconds, and this line is what is left saying so afterwards.
import { computed } from "vue";
import { HardDrive, TriangleAlert } from "@lucide/vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import { storageFailed } from "../stores/notice";

const label = computed(() =>
  storageFailed.value
    ? "Not saved to this browser"
    : "Auto-saved to this browser",
);

const tooltip = computed(() =>
  storageFailed.value
    ? "This browser's storage cannot be written to, so nothing you do here is being kept. Use Export to save a copy before closing the tab."
    : "Edits are saved automatically to this browser's storage. That storage can be cleared or lost - use Export to keep a backup elsewhere.",
);

const toneClass = computed(() =>
  storageFailed.value ? "text-danger" : "text-muted",
);
</script>

<template>
  <BaseTooltip :text="tooltip" :width="300">
    <span
      class="flex items-center gap-1 whitespace-nowrap"
      :class="toneClass"
      data-testid="autosave-indicator"
      :data-state="storageFailed ? 'failed' : 'saving'"
      tabindex="0"
    >
      <TriangleAlert v-if="storageFailed" class="h-[14px] w-[14px]" />
      <HardDrive v-else class="h-[14px] w-[14px]" />
      {{ label }}
    </span>
  </BaseTooltip>
</template>
