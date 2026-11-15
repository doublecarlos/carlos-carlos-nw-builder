<script setup lang="ts">
// Marks a shared control on a reader's row: a link icon whose tooltip names where else the
// value is set. The full "Used by" note stays on the shared slot's own row, so the many reader
// rows carry only this.
import { Link2 } from "@lucide/vue";
import BaseTooltip from "../ui/BaseTooltip.vue";

defineProps<{ text: string; testid: string }>();
</script>

<template>
  <BaseTooltip :text="text" tappable>
    <span
      class="inline-flex shrink-0 align-middle text-muted"
      tabindex="0"
      :aria-label="text"
      :data-testid="testid"
      ><Link2 class="size-3.5"
    /></span>
  </BaseTooltip>
</template>
