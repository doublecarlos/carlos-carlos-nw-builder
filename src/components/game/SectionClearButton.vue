<script setup lang="ts">
// A section header's "reset to defaults" control. Two-step confirm, mirroring Nav.vue's
// build reset -- this discards every slot in the section at once, not just one row.
import { RotateCcw } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import { useConfirm } from "../../composables/useConfirm";

const props = defineProps<{
  sectionId: string;
}>();

const emit = defineEmits<{
  clear: [];
}>();

const confirm_ = useConfirm();

function click() {
  if (confirm_.run(props.sectionId)) emit("clear");
}
</script>

<template>
  <BaseTooltip text="Reset every slot in this section to its default">
    <BaseButton
      class="mr-0.5 w-36 flex-none justify-center whitespace-nowrap"
      @click="click"
    >
      <RotateCcw />{{ confirm_.label(sectionId, "Clear section") }}
    </BaseButton>
  </BaseTooltip>
</template>
