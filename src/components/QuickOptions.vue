<script setup lang="ts">
// Compact "quick options" strip: whichever build_parameter slots are marked `quick: true` in
// slots.json (today: the 5 toggles, combat type, location, duration) -- laid out as one small
// horizontal row instead of a wrapping column, matching the sheet's own quick-options widget.
//
// Everything else in the "options" section (class, role, damage type, magnitude, forte) is
// rarely changed mid-session, so it stays in BuildEditor's collapsible Options section instead
// of eating width here. No field list is hardcoded in either place any more -- `quick` on the
// slot itself is what decides where a field renders, not this component's own knowledge of
// which fields exist.
import BuildParamInput from './ui/BuildParamInput.vue';
import { NW_SLOTS } from '../data';
import { getPath } from '../build-path';
import { paramDiffers, paramDiffTitle } from '../composables/useCompareDiff';
import * as library from '../stores/library';
import * as compare from '../stores/compare';
import * as buildEditor from '../stores/buildEditor';
import type { BuildParameterSlot } from '../types';

const build = library.build;
const compareBuild = compare.compareBuild;
const highlightDiff = () => build.value.compare.highlight;

const quickSlots = NW_SLOTS.slots.filter((slot): slot is BuildParameterSlot => (
  slot.type === 'build_parameter' && !!slot.quick
));

function differs(slot: BuildParameterSlot) {
  return highlightDiff() && paramDiffers(build.value, compareBuild.value, slot);
}
</script>

<template>
  <div class="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-line px-2.5 py-1.5">
    <template v-for="(slot, index) in quickSlots" :key="slot.id">
      <span v-if="index > 0 && slot.paramType !== 'boolean' && quickSlots[index - 1].paramType === 'boolean'"
            class="h-4 w-px bg-line"></span>

      <div v-if="slot.paramType !== 'boolean'" class="flex items-center gap-1.5 whitespace-nowrap text-sm">
        <span :class="differs(slot) ? 'cursor-help font-bold text-diff' : ''"
              :title="differs(slot) ? paramDiffTitle(compareBuild, slot) : undefined">
          {{ slot.label }}<template v-if="differs(slot)"> ●</template>
        </span>
        <BuildParamInput :class="slot.paramType === 'list' && 'w-36'" :slot="slot"
                          :model-value="getPath(build.context, slot.path) as string | number"
                          @update:model-value="buildEditor.setParam(slot, $event)" />
      </div>

      <BuildParamInput v-else :slot="slot" :model-value="getPath(build.context, slot.path) as boolean"
                        @update:model-value="buildEditor.setParam(slot, $event)">
        <span :class="differs(slot) ? 'font-bold text-diff' : ''"
              :title="differs(slot) ? paramDiffTitle(compareBuild, slot) : undefined">
          {{ slot.label }}<template v-if="differs(slot)"> ●</template>
        </span>
      </BuildParamInput>
    </template>
  </div>
</template>
