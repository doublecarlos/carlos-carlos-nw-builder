<script setup lang="ts">
// A section header's "reset to defaults" control. Undoable in one step, so it acts without
// confirming and `buildEditor.clearSection` posts the undo notice.
import { RotateCcw } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";

defineProps<{
  sectionId: string;
}>();

defineEmits<{
  clear: [];
}>();
</script>

<template>
  <BaseTooltip text="Reset every slot in this section to its default">
    <BaseButton
      class="mr-0.5 w-36 flex-none justify-center whitespace-nowrap"
      :data-testid="`clear-section-${sectionId}`"
      @click="$emit('clear')"
    >
      <RotateCcw />Clear
    </BaseButton>
  </BaseTooltip>
</template>
