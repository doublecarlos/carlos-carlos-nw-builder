<script setup lang="ts">
// A purely informational line of muted text in a section's list. Deliberately carries no
// data-cursor-key/data-cursor-anchor and no focusable elements, so BuildEditor.vue's arrow-key
// cursor (which walks `[data-cursor-key]`) and native Tab both skip it without any extra logic.
import type { TextSlot } from "../../types";

defineProps<{
  slotDef: TextSlot;
}>();
</script>

<template>
  <div
    class="border-b border-line/45 px-2.5 py-1 text-left text-sm text-muted last:border-b-0"
    :data-testid="'text:' + slotDef.id"
  >
    {{ slotDef.text }}
  </div>
</template>
