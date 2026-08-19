<script setup lang="ts">
// Compact "quick options" strip: whichever build_parameter slots are marked `quick: true` in
// slots.json (today: the 5 toggles, combat type, duration) -- laid out as one small
// horizontal row instead of a wrapping column, matching the sheet's own quick-options widget.
//
// Everything else in the "options" section (class, role, damage type, magnitude, forte) is
// rarely changed mid-session, so it stays in BuildEditor's collapsible Options section instead
// of eating width here. No field list is hardcoded in either place any more -- `quick` on the
// slot itself is what decides where a field renders, not this component's own knowledge of
// which fields exist.
import { computed } from "vue";
import BuildParamInput from "./BuildParamInput.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import { getPath } from "../../lib/build-path";
import { slotVisible } from "../../lib/slot-visibility";
import { paramDiffers, paramDiffTitle } from "../../composables/useCompareDiff";
import * as builds from "../../stores/builds";
import * as compare from "../../stores/compare";
import * as buildEditor from "../../stores/buildEditor";
import * as engine from "../../stores/resolved";
import type { BuildParameterSlot } from "../../types";

const build = builds.build;
const compareBuild = compare.compareBuild;
const highlightDiff = () => build.value.compare.highlight;

/** Off the composed catalogue, not the shipped file: a layer can add, edit or remove a
 * `quick` param, and this strip has to show what the build editor is actually resolving. */
const allQuickSlots = computed(() =>
  engine.db.value.slots.filter(
    (slot): slot is BuildParameterSlot =>
      slot.type === "build_parameter" && !!slot.quick,
  ),
);

/** Same `visibleWhen` pass BuildEditor runs over its section lists -- a `quick` param renders
 * here *instead of* in its section, so without this the two would disagree about whether a
 * scoped param exists. */
const quickSlots = computed(() =>
  allQuickSlots.value.filter((slot) =>
    slotVisible(
      slot,
      engine.resolved.value.ok ? engine.resolved.value.result.context : null,
    ),
  ),
);

function differs(slot: BuildParameterSlot) {
  return highlightDiff() && paramDiffers(build.value, compareBuild.value, slot);
}

/** `getPath` returns `unknown`; cast to the non-boolean union used by non-boolean slots.
 * Falls back to the slot's own `default` for the same reason BuildParameterRow does -- see
 * its `paramValue`. */
function paramValue(slot: BuildParameterSlot): unknown {
  return getPath(build.value.context, slot.path) ?? slot.default;
}

function asStrNum(slot: BuildParameterSlot): string | number {
  return paramValue(slot) as string | number;
}
</script>

<template>
  <div
    data-testid="quick-options"
    class="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-line px-2.5 py-1.5"
  >
    <template v-for="(slot, index) in quickSlots" :key="slot.id">
      <span
        v-if="
          index > 0 &&
          slot.paramType !== 'boolean' &&
          quickSlots[index - 1].paramType === 'boolean'
        "
        class="h-4 w-px bg-line"
      ></span>

      <div
        v-if="slot.paramType !== 'boolean'"
        class="flex items-center gap-1.5 whitespace-nowrap"
      >
        <BaseTooltip
          :text="differs(slot) ? paramDiffTitle(compareBuild, slot) : ''"
        >
          <span
            :class="differs(slot) ? 'cursor-help font-bold text-diff' : ''"
            :tabindex="differs(slot) ? 0 : undefined"
          >
            {{ slot.label }}<template v-if="differs(slot)"> ●</template>
          </span>
        </BaseTooltip>
        <BuildParamInput
          :slot-def="slot"
          :model-value="asStrNum(slot)"
          @update:model-value="buildEditor.setParam(slot, $event!)"
        />
      </div>

      <BuildParamInput
        v-else
        :slot-def="slot"
        :model-value="paramValue(slot) as boolean"
        @update:model-value="buildEditor.setParam(slot, $event!)"
      >
        <BaseTooltip
          :text="differs(slot) ? paramDiffTitle(compareBuild, slot) : ''"
        >
          <span
            :class="differs(slot) ? 'font-bold text-diff' : ''"
            :tabindex="differs(slot) ? 0 : undefined"
          >
            {{ slot.label }}<template v-if="differs(slot)"> ●</template>
          </span>
        </BaseTooltip>
      </BuildParamInput>
    </template>
  </div>
</template>
