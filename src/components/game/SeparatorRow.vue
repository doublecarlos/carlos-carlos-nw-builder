<script setup lang="ts">
// A purely visual divider between slots in a section's list. Deliberately carries no
// data-cursor-key/data-cursor-anchor and no focusable elements, so BuildEditor.vue's arrow-key
// cursor (which walks `[data-cursor-key]`) and native Tab both skip it without any extra logic.
import type { SeparatorSlot } from "../../types";

defineProps<{
  slotDef: SeparatorSlot;
}>();
</script>

<template>
  <div class="py-2" role="separator" :data-testid="'separator:' + slotDef.id">
    <hr class="border-t-2 border-muted/60" />
  </div>
</template>
