<script setup lang="ts">
// The build_parameter case of BuildSlot.vue's row content: the generic control and this
// type's diff note. Row chrome (label, cursor anchor, hover/diff highlighting, the errors
// list) stays in BuildSlot.vue since it's identical across every slot type.
import { useTemplateRef } from "vue";
import BuildParamInput from "./BuildParamInput.vue";
import BaseLink from "../ui/BaseLink.vue";
import * as buildEditor from "../../stores/buildEditor";
import { getPath } from "../../lib/build-path";
import type { Build, BuildParameterSlot } from "../../types";

const props = defineProps<{
  slotDef: BuildParameterSlot;
  build: Build;
  compareBuild?: Build | null;
  highlightDiff: boolean;
  bonusDiffs?: { id: string; message: string }[];
  paramDiffers?: boolean;
  otherParamLabel?: string;
  /** DOM id for this row's control, so BuildSlot's label can point at it. */
  inputId?: string;
}>();

const param = useTemplateRef<InstanceType<typeof BuildParamInput>>("param");

defineExpose({
  focus: () => param.value?.focus(),
  focusAndSeed: (char: string) => param.value?.focusAndSeed(char),
});

/** Falls back to the slot's `default`, as bonus.ts's `collect()` does, so a build saved before
 *  a layer added the param shows the value the engine is already using. */
const paramValue = () =>
  (getPath(props.build.context, props.slotDef.path) ??
    props.slotDef.default) as string | number | boolean | undefined;
</script>

<template>
  <div class="flex flex-wrap items-center gap-2.5">
    <BuildParamInput
      ref="param"
      class="grow-0 basis-80 min-w-40"
      :slot-def="slotDef"
      :wide="true"
      :input-id="inputId"
      :model-value="paramValue()"
      @update:model-value="buildEditor.setParam(slotDef, $event!)"
    />
  </div>

  <p
    v-if="highlightDiff && paramDiffers"
    class="slot-diff-note mt-0.5 text-muted"
  >
    {{ compareBuild?.name }}: {{ otherParamLabel }}
    <BaseLink
      class="ml-0.5"
      @click.stop="buildEditor.applyParamFromCompare(slotDef)"
    >
      apply
    </BaseLink>
  </p>

  <template v-if="highlightDiff && !paramDiffers">
    <p
      v-for="bonusDiff in bonusDiffs ?? []"
      :key="bonusDiff.id"
      class="mt-0.5 font-semibold text-diff"
    >
      {{ bonusDiff.message }}
    </p>
  </template>
</template>
