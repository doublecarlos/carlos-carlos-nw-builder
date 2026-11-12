<script setup lang="ts">
// The point_assignment case of BuildSlot.vue's row content: the stepper row, its typed values
// one per line below it, and this type's diff notes. Row chrome (label, cursor anchor,
// hover/diff highlighting, the errors list) stays in BuildSlot.vue since it's identical across
// every slot type.
import { computed, useTemplateRef } from "vue";
import PointAssignmentInput from "./PointAssignmentInput.vue";
import BuildInputControl from "./BuildInputControl.vue";
import BaseLink from "../ui/BaseLink.vue";
import * as buildEditor from "../../stores/buildEditor";
import { db } from "../../stores/resolved";
import { useSlotInputs } from "../../composables/useSlotInputs";
import { assignmentAddress, inputKey } from "../../lib/build-inputs";
import type { Build, PointAssignmentSlot } from "../../types";
import type { InputDiff } from "../../composables/useCompareDiff";

const props = defineProps<{
  slotDef: PointAssignmentSlot;
  build: Build;
  compareBuild?: Build | null;
  highlightDiff: boolean;
  inputDiffs?: InputDiff[];
}>();

const emit = defineEmits<{
  /** Hovering one item's row -- forwarded straight through to BuildSlot.vue, same as
   *  PointAssignmentInput's own `item-enter`/`item-leave`. */
  itemEnter: [event: MouseEvent, itemId: string];
  itemLeave: [];
}>();

const assignment =
  useTemplateRef<InstanceType<typeof PointAssignmentInput>>("assignment");

defineExpose({
  focus: () => assignment.value?.focus(),
  focusAndSeed: () => assignment.value?.focusAndSeed(),
});

const values = () => props.build.assignments[props.slotDef.id] ?? {};

const inputs = useSlotInputs(
  () => props.slotDef,
  () => (props.inputDiffs ?? []).map((diff) => diff.address),
);

/** The repetition counts are the steppers themselves. Every other value is listed below the
 *  row in stepper order, so the steppers keep one line and each value gets a whole line for
 *  its label. Values tied to no item come last. */
const listed = computed(() => {
  const order = new Map(
    db.value.forSlot(props.slotDef.id).map((item, index) => [item.id, index]),
  );
  const rank = (itemId?: string) =>
    (itemId === undefined ? undefined : order.get(itemId)) ?? order.size;
  return inputs.value
    .filter((input) => input.kind !== "repetition")
    .sort((a, b) => rank(a.anchor.itemId) - rank(b.anchor.itemId));
});

function setCount(itemId: string, count: number) {
  buildEditor.setInput(assignmentAddress(props.slotDef.id, itemId), count);
}
</script>

<template>
  <!-- Sits on the section's shared column grid, so it just passes the tracks through. -->
  <div class="grid col-span-full [grid-template-columns:subgrid]">
    <PointAssignmentInput
      ref="assignment"
      subgrid
      :slot-def="slotDef"
      :values="values()"
      @change="setCount"
      @item-enter="(event, itemId) => emit('itemEnter', event, itemId)"
      @item-leave="emit('itemLeave')"
    />
  </div>

  <div
    v-if="listed.length"
    class="mt-1 flex flex-col gap-1.5 col-span-full"
    data-testid="assignment-inputs"
  >
    <BuildInputControl
      v-for="input in listed"
      :key="inputKey(input.address)"
      :input="input"
    />
  </div>

  <template v-if="highlightDiff">
    <p
      v-for="diff in inputDiffs ?? []"
      :key="inputKey(diff.address)"
      class="slot-diff-note mt-0.5 text-muted col-span-full"
    >
      {{ compareBuild?.name }}: {{ diff.label }} {{ diff.otherLabel }}
      <BaseLink
        class="ml-0.5"
        @click.stop="buildEditor.applyInputFromCompare(diff.address)"
      >
        apply
      </BaseLink>
    </p>
  </template>
</template>
