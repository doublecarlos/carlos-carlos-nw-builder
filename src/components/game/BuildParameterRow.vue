<script setup lang="ts">
// The build_parameter case of BuildSlot.vue's row content: the generic control and this
// type's diff note. Row chrome (label, cursor anchor, hover/diff highlighting, the errors
// list) stays in BuildSlot.vue since it's identical across every slot type.
import { useTemplateRef } from "vue";
import BuildParamInput from "./BuildParamInput.vue";
import BaseButton from "../ui/BaseButton.vue";
import * as buildEditor from "../../stores/buildEditor";
import { getPath } from "../../lib/build-path";
import type { Build, BuildParameterSlot, Item } from "../../types";

const props = defineProps<{
  slotDef: BuildParameterSlot;
  build: Build;
  compareBuild?: Build | null;
  highlightDiff: boolean;
  /** The slot's resolved `linkedItem`, if it has one -- see build-path.ts's
   * `resolveLinkedItem`. Only a list/boolean param's current value ever resolves one. */
  item?: Item | null;
  statSummary?: string;
  bonusDiffs?: { id: string; message: string }[];
  paramDiffers?: boolean;
  otherParamLabel?: string;
}>();

const param = useTemplateRef<InstanceType<typeof BuildParamInput>>("param");

defineExpose({
  focus: () => param.value?.focus(),
  focusAndSeed: (char: string) => param.value?.focusAndSeed(char),
});

const paramValue = () =>
  getPath(props.build.context, props.slotDef.path) as
    string | number | boolean | undefined;
</script>

<template>
  <div class="flex flex-wrap items-center gap-2.5">
    <BuildParamInput
      ref="param"
      class="grow-0 basis-80 min-w-40"
      :slot-def="slotDef"
      :wide="true"
      :model-value="paramValue()"
      @update:model-value="buildEditor.setParam(slotDef, $event!)"
    />
    <span v-if="item" class="min-w-0 flex-1 truncate text-sm text-text">{{
      statSummary
    }}</span>
  </div>

  <p
    v-if="highlightDiff && paramDiffers"
    class="slot-diff-note mt-0.5 text-sm text-muted"
  >
    {{ compareBuild?.name }}: {{ otherParamLabel }}
    <BaseButton
      variant="link"
      class="ml-0.5 text-accent"
      @click.stop="buildEditor.applyParamFromCompare(slotDef)"
    >
      apply
    </BaseButton>
  </p>

  <template v-if="highlightDiff && !paramDiffers">
    <p
      v-for="bonusDiff in bonusDiffs ?? []"
      :key="bonusDiff.id"
      class="mt-0.5 text-sm font-semibold text-diff"
    >
      {{ bonusDiff.message }}
    </p>
  </template>
</template>
