<script setup lang="ts">
// Marks a field that reads pasted screenshots. Sits on the field itself rather than beside a
// label or heading, so it can never claim the feature for a neighbouring control that lacks it.
import { ScanText } from "@lucide/vue";
import BaseTooltip from "./BaseTooltip.vue";
</script>

<template>
  <BaseTooltip
    text="You can paste a screenshot in this field to automatically recognise its text. Crop it first."
    :width="240"
  >
    <span
      tabindex="0"
      data-testid="ocr-hint"
      aria-label="This field reads pasted screenshots"
      class="cursor-help text-muted hover:text-accent focus-visible:text-accent [&_svg]:size-[14px]"
    >
      <ScanText />
    </span>
  </BaseTooltip>
</template>
