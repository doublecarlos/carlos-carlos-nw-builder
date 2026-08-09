<script setup lang="ts">
// The point_assignment case of BuildSlot.vue's row content: the stepper row and this type's
// diff note. Row chrome (label, cursor anchor, hover/diff highlighting, the errors list) stays
// in BuildSlot.vue since it's identical across every slot type.
import { useTemplateRef } from "vue";
import PointAssignmentInput from "./PointAssignmentInput.vue";
import BaseButton from "../ui/BaseButton.vue";
import IconButton from "../ui/IconButton.vue";
import { Plus } from "@lucide/vue";
import * as buildEditor from "../../stores/buildEditor";
import type { Build, PointAssignmentSlot } from "../../types";

const props = defineProps<{
  slotDef: PointAssignmentSlot;
  build: Build;
  compareBuild?: Build | null;
  highlightDiff: boolean;
  assignmentDiffers?: boolean;
  otherAssignmentLabel?: string;
}>();

const emit = defineEmits<{
  /** Hovering one item's row -- forwarded straight through to BuildSlot.vue, same as
   *  PointAssignmentInput's own `item-enter`/`item-leave`. */
  itemEnter: [event: MouseEvent, itemId: string];
  itemLeave: [];
  /** The row's own "new item" shortcut -- BuildSlot.vue forwards it up with this row's
   *  `filter`, so the item editor can open with a fresh draft pre-filtered to this slot. */
  addItem: [];
}>();

const assignment =
  useTemplateRef<InstanceType<typeof PointAssignmentInput>>("assignment");

defineExpose({
  focus: () => assignment.value?.focus(),
  focusAndSeed: () => assignment.value?.focusAndSeed(),
});

const values = () => props.build.assignments[props.slotDef.id] ?? {};
</script>

<template>
  <div class="flex flex-wrap items-end gap-2.5">
    <PointAssignmentInput
      ref="assignment"
      class="min-w-0 flex-1"
      :slot-def="slotDef"
      :values="values()"
      @change="
        (itemId, count) => buildEditor.setAssignment(slotDef, itemId, count)
      "
      @item-enter="(event, itemId) => emit('itemEnter', event, itemId)"
      @item-leave="emit('itemLeave')"
    />
    <IconButton
      title="Create a new item for this slot"
      data-testid="add-item-for-slot"
      @click="emit('addItem')"
    >
      <Plus />
    </IconButton>
  </div>

  <p
    v-if="highlightDiff && assignmentDiffers"
    class="slot-diff-note mt-0.5 text-sm text-muted"
  >
    {{ compareBuild?.name }}: {{ otherAssignmentLabel }}
    <BaseButton
      variant="link"
      class="ml-0.5 text-accent"
      @click.stop="buildEditor.applyAssignmentsFromCompare(slotDef)"
    >
      apply
    </BaseButton>
  </p>
</template>
