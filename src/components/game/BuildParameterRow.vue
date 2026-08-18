<script setup lang="ts">
// The build_parameter case of BuildSlot.vue's row content: the generic control and this
// type's diff note. Row chrome (label, cursor anchor, hover/diff highlighting, the errors
// list) stays in BuildSlot.vue since it's identical across every slot type.
import { useTemplateRef } from "vue";
import BuildParamInput from "./BuildParamInput.vue";
import BaseButton from "../ui/BaseButton.vue";
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
}>();

const param = useTemplateRef<InstanceType<typeof BuildParamInput>>("param");

defineExpose({
  focus: () => param.value?.focus(),
  focusAndSeed: (char: string) => param.value?.focusAndSeed(char),
});

/** Falls back to the slot's own `default`, the same way bonus.ts's `collect()` does when it
 * fills `ctx.params`. Without it an overlay-added param renders blank until it is first
 * touched, while the engine is already resolving it at its default -- the control and the
 * numbers would disagree. `defaultBuild` only seeds `context` from the *base* slot list, so
 * this is the read that has to cover the gap, not a reseed of stored state. */
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
      :model-value="paramValue()"
      @update:model-value="buildEditor.setParam(slotDef, $event!)"
    />
  </div>

  <p
    v-if="highlightDiff && paramDiffers"
    class="slot-diff-note mt-0.5 text-muted"
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
      class="mt-0.5 font-semibold text-diff"
    >
      {{ bonusDiff.message }}
    </p>
  </template>
</template>
