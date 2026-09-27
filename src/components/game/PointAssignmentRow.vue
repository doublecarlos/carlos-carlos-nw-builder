<script setup lang="ts">
// The point_assignment case of BuildSlot.vue's row content: the stepper row, each item's own
// typed values under its stepper, and this type's diff notes. Row chrome (label, cursor anchor,
// hover/diff highlighting, the errors list) stays in BuildSlot.vue since it's identical across
// every slot type.
import { computed, useTemplateRef } from "vue";
import PointAssignmentInput from "./PointAssignmentInput.vue";
import BuildInputControl from "./BuildInputControl.vue";
import BaseLink from "../ui/BaseLink.vue";
import * as buildEditor from "../../stores/buildEditor";
import {
  useSlotInputs,
  type BuildInput,
} from "../../composables/useSlotInputs";
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

/** The repetition counts are the steppers themselves. Values tied to one item render under
 *  its stepper, anything else below the row. */
const byItem = computed(() => {
  const map = new Map<string, BuildInput[]>();
  for (const input of inputs.value) {
    const itemId = input.anchor.itemId;
    if (input.kind === "repetition" || !itemId) continue;
    map.set(itemId, [...(map.get(itemId) ?? []), input]);
  }
  return map;
});
const unanchored = computed(() =>
  inputs.value.filter((input) => !input.anchor.itemId),
);

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
    >
      <template #item="{ item }">
        <div
          v-if="byItem.get(item.id)?.length"
          class="flex flex-wrap items-center justify-center gap-2"
        >
          <BuildInputControl
            v-for="input in byItem.get(item.id)"
            :key="inputKey(input.address)"
            :input="input"
          />
        </div>
      </template>
    </PointAssignmentInput>
  </div>

  <div
    v-if="unanchored.length"
    class="mt-1 flex flex-col gap-1.5 col-span-full"
  >
    <BuildInputControl
      v-for="input in unanchored"
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
