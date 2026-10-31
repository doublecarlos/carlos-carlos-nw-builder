<script setup lang="ts">
// Marks a field that reads pasted screenshots. Sits on the field itself rather than beside a
// label or heading, so it can never claim the feature for a neighbouring control that lacks it.
// Left off on a phone: game screenshots live on the computer the game runs on.
import ScanText from "virtual:icon/scan-text.vue";
import BaseTooltip from "./BaseTooltip.vue";
import { isPhone } from "../../stores/viewport";
</script>

<template>
  <BaseTooltip
    v-if="!isPhone"
    tappable
    text="Paste a screenshot to read its text. Crop it first."
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
