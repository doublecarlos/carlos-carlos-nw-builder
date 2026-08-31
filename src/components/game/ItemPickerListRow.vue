<script setup lang="ts">
// The "add another row" row of an `item_picker_list` slot, rendered after the rows themselves.
// A cursor row like any other -- anchor, arrow keys, Enter to add -- so the keyboard reaches
// the button without a Tab stop of its own.
import { Plus } from "@lucide/vue";
import { useTemplateRef } from "vue";
import BaseButton from "../ui/BaseButton.vue";
import { useCursorRowKeys } from "../../composables/useCursorRowKeys";
import * as buildEditor from "../../stores/buildEditor";
import type { ItemPickerListSlot } from "../../types";

const props = defineProps<{
  slotDef: ItemPickerListSlot;
  /** Arrow keys on this row's cursor anchor, same contract every other row has. */
  onArrow: (dir: 1 | -1, bySection: boolean) => void;
}>();

const anchor = useTemplateRef("anchor");

function add() {
  buildEditor.addListRow(props.slotDef);
}

useCursorRowKeys(anchor, {
  onArrow: (dir, bySection) => props.onArrow(dir, bySection),
  onEnter: add,
});
</script>

<template>
  <div
    class="relative flex justify-center gap-2.5 px-2.5 py-1 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-accent"
    :data-cursor-key="'slot:' + slotDef.id"
    :data-testid="'list-add-row:' + slotDef.id"
  >
    <div class="w-40 shrink-0" />
    <div class="min-w-0 flex-1">
      <span ref="anchor" tabindex="-1" data-cursor-anchor class="sr-only" />
      <!-- Labelled rather than a bare icon: an empty list is nothing but this row, and a
           lone + under a section header says nothing about what it would add. -->
      <BaseButton :data-testid="'list-add:' + slotDef.id" @click="add">
        <Plus />Add {{ slotDef.label }}
      </BaseButton>
    </div>
  </div>
</template>
