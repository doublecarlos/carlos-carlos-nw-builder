<script setup lang="ts">
// Compact "quick options" strip: whichever slots are marked `quick: true` in slots.json
// (today: the 5 toggles, combat type, duration) -- laid out as one small horizontal row instead
// of a wrapping column, matching the sheet's own quick-options widget.
//
// Everything else in the "options" section (class, role, damage type, magnitude, forte) is
// rarely changed mid-session, so it stays in BuildEditor's collapsible Options section instead
// of eating width here. No field list is hardcoded in either place -- `quick` on the slot itself
// is what decides where a field renders, not this component's own knowledge of which fields
// exist.
//
// A `build_parameter` or an `item_picker` can be `quick`. The picker renders bare-name here
// whatever its own `hidePreview` says -- the strip has no room for a preview -- and only the
// pick itself: magnitudes, occurrence steppers and repetition counts stay on the section row.
import { computed } from "vue";
import BuildParamInput from "./BuildParamInput.vue";
import ItemPicker from "./ItemPicker.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import { getPath } from "../../lib/build-path";
import { slotVisible } from "../../lib/slot-visibility";
import { paramDiffers, paramDiffTitle } from "../../composables/useCompareDiff";
import * as builds from "../../stores/builds";
import * as compare from "../../stores/compare";
import * as buildEditor from "../../stores/buildEditor";
import * as engine from "../../stores/resolved";
import type { BuildParameterSlot, ItemPickerSlot, Slot } from "../../types";

const build = builds.build;
const compareBuild = compare.compareBuild;
const highlightDiff = () => build.value.compare.highlight;

type QuickSlot = BuildParameterSlot | ItemPickerSlot;

const isQuick = (slot: Slot): slot is QuickSlot =>
  (slot.type === "build_parameter" || slot.type === "item_picker") &&
  !!slot.quick;

/** Off the composed catalogue, not the shipped file: a layer can add, edit or remove a
 * `quick` slot, and this strip has to show what the build editor is actually resolving. */
const allQuickSlots = computed(() => engine.db.value.slots.filter(isQuick));

/** Same `visibleWhen` pass BuildEditor runs over its section lists -- a `quick` slot renders
 * here *instead of* in its section, so without this the two would disagree about whether a
 * scoped slot exists. */
const quickSlots = computed(() =>
  allQuickSlots.value.filter((slot) =>
    slotVisible(
      slot,
      engine.resolved.value.ok ? engine.resolved.value.result.context : null,
    ),
  ),
);

/** Only a `build_parameter` can be a bare checkbox; a picker is always a labelled control. */
const isBooleanParam = (slot: QuickSlot) =>
  slot.type === "build_parameter" && slot.paramType === "boolean";

function differs(slot: QuickSlot) {
  if (!highlightDiff()) return false;
  if (slot.type === "item_picker")
    return (
      Boolean(compareBuild.value) &&
      (build.value.choices[slot.id] ?? "") !==
        (compareBuild.value?.choices?.[slot.id] ?? "")
    );
  return paramDiffers(build.value, compareBuild.value, slot);
}

/** The compare build's value, as the tooltip shows it -- an item id resolved to its name. */
function diffTitle(slot: QuickSlot) {
  if (slot.type !== "item_picker")
    return paramDiffTitle(compareBuild.value, slot);
  const id = compareBuild.value?.choices?.[slot.id] ?? "";
  return id ? (engine.db.value.get(id)?.name ?? id) : "(empty)";
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

const choice = (slot: ItemPickerSlot) => build.value.choices[slot.id] ?? "";
const chosenItem = (slot: ItemPickerSlot) =>
  engine.db.value.get(choice(slot)) ?? null;
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
          !isBooleanParam(slot) &&
          isBooleanParam(quickSlots[index - 1])
        "
        class="h-4 w-px bg-line"
      ></span>

      <div
        v-if="slot.type === 'item_picker'"
        class="flex items-center gap-1.5 whitespace-nowrap"
        :data-testid="`quick-picker-${slot.id}`"
      >
        <BaseTooltip :text="differs(slot) ? (diffTitle(slot) ?? '') : ''">
          <span
            :class="differs(slot) ? 'cursor-help font-bold text-diff' : ''"
            :tabindex="differs(slot) ? 0 : undefined"
          >
            {{ slot.label }}<template v-if="differs(slot)"> ●</template>
          </span>
        </BaseTooltip>
        <ItemPicker
          class="w-44"
          :items="engine.db.value.forSlot(slot.id)"
          :model-value="choice(slot)"
          :selected-item="chosenItem(slot)"
          :db="engine.db.value"
          :bonus-preview="{
            db: engine.db.value,
            build: build,
            slotId: slot.id,
          }"
          :hide-preview="true"
          :allow-empty="!slot.disallowEmpty"
          @update:model-value="buildEditor.setChoice(slot.id, $event)"
        />
      </div>

      <div
        v-else-if="!isBooleanParam(slot)"
        class="flex items-center gap-1.5 whitespace-nowrap"
      >
        <BaseTooltip :text="differs(slot) ? (diffTitle(slot) ?? '') : ''">
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
        <BaseTooltip :text="differs(slot) ? (diffTitle(slot) ?? '') : ''">
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
