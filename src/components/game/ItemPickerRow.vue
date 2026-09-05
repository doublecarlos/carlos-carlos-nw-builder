<script setup lang="ts">
// The item_picker case of BuildSlot.vue's row content: the picker itself, its dynamic-stat
// magnitude(s) (item-level and/or bonus-level -- useDynamicStats.ts), and this type's diff
// notes (choice/bonus/value). Row chrome (label, cursor anchor, hover/diff highlighting, the
// errors list) stays in BuildSlot.vue since it's identical across every slot type.
import { computed, useTemplateRef } from "vue";
import ItemPicker from "./ItemPicker.vue";
import BonusOccurrenceInputs from "./BonusOccurrenceInputs.vue";
import InlineRepetitionStepper from "./InlineRepetitionStepper.vue";
import PercentInput from "../ui/PercentInput.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseButton from "../ui/BaseButton.vue";
import IconButton from "../ui/IconButton.vue";
import { Replace, Trash } from "@lucide/vue";
import * as buildEditor from "../../stores/buildEditor";
import * as pickerLens from "../../stores/pickerLens";
import { useItemBonusOccurrences } from "../../composables/useItemBonusOccurrences";
import {
  useSlotDynamicStats,
  type DynamicStatRow,
} from "../../composables/useDynamicStats";
import { isPercentKind, kindOf, stat as formatStat } from "../../lib/format";
import { inlineRepetitionCount } from "../../lib/inline-repetition";
import type { Build, Db, Item, ItemPickerSlot } from "../../types";
import type { ValueDiff } from "../../composables/useCompareDiff";

const props = defineProps<{
  slotDef: ItemPickerSlot;
  build: Build;
  /** The active build's resolved db -- only needed for the picker's bonus-aware preview
   *  (ItemPicker.vue's `bonusPreview` prop below). */
  db: Db;
  compareBuild?: Build | null;
  highlightDiff: boolean;
  item?: Item | null;
  items?: Item[];
  /** Why each of `items` would normally be withheld, when the editor's lens is re-showing
   *  them -- passed straight to the picker. */
  hiddenReasons?: ReadonlyMap<string, string> | null;
  statSummary?: string;
  invalid?: boolean;
  choiceDiffers?: boolean;
  otherChoiceLabel?: string;
  bonusDiffs?: { id: string; message: string }[];
  valueDiffs?: ValueDiff[];
  occurrenceDiffers?: boolean;
  otherOccurrenceLabel?: string;
  /** The pick's inline-repetition count against the compare build -- same pair of props a
   *  point_assignment row takes, since it is the same stored value. */
  assignmentDiffers?: boolean;
  otherAssignmentLabel?: string;
  /** DOM id for the picker input, so BuildSlot's row label can point at it. */
  inputId?: string;
}>();

const picker = useTemplateRef<InstanceType<typeof ItemPicker>>("picker");

const occurrenceRows = useItemBonusOccurrences(computed(() => props.item));

/** The item this slot's pick would migrate to, or null when it is not retired. */
const replacement = computed(() =>
  props.db.replacementFor(props.build.choices?.[props.slotDef.id]),
);

function setOccurrence(bonusId: string, count: number, label: string) {
  buildEditor.setOccurrenceInput(props.item!.id, bonusId, count, label);
}

defineExpose({
  focus: () => picker.value?.focus(),
  focusAndSeed: (char: string) => picker.value?.focusAndSeed(char),
});

const choice = () => props.build.choices[props.slotDef.id] ?? "";

const dynamicStatRows = useSlotDynamicStats(
  props.slotDef.id,
  computed(() => props.item),
);

const isPercent = (stat: string) => isPercentKind(kindOf(stat));

function setDynamic(row: DynamicStatRow, raw: string | number) {
  buildEditor.setDynamicValue(
    props.slotDef.id,
    row.key,
    raw === "" ? "" : String(raw),
  );
}

function rangeLabel(row: DynamicStatRow) {
  return `${row.label} (${formatStat(row.stat, row.min)} - ${formatStat(row.stat, row.max)})`;
}

// --- the pick's own inline repetition -------------------------------------------------------
// The item's own config turns the stepper on, exactly as `dynamicStats` and
// `BonusOccurrenceConfig` do for their inputs above. The slot says nothing about it.

const repetitions = computed(() =>
  props.item
    ? inlineRepetitionCount(props.build, props.slotDef.id, props.item)
    : 0,
);

/** Not the item name the shared control defaults to -- the picker above already says that, so
 *  the caption says what the number means. `InlineRepetitionConfig.label` overrides it. */
const repetitionLabel = computed(
  () => props.item?.inlineRepetition?.label ?? "Copies",
);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2.5">
    <ItemPicker
      ref="picker"
      class="grow-0 basis-80 min-w-40"
      :items="items ?? []"
      :input-id="inputId"
      :model-value="choice()"
      :selected-item="item"
      :invalid="invalid"
      :db="db"
      :hidden-reasons="hiddenReasons"
      :bonus-preview="{
        db,
        build,
        slotId: slotDef.id,
        filterHidden: !pickerLens.showHidden.value,
      }"
      :hide-preview="slotDef.hidePreview"
      :allow-empty="!slotDef.disallowEmpty"
      @update:model-value="buildEditor.setChoice(slotDef.id, $event)"
    />
    <!-- Rows of an item_picker_list are the only removable ones; a hand-authored slot has no
         `list` and so no button. -->
    <IconButton
      v-if="slotDef.list"
      :title="`Remove ${slotDef.label}`"
      :data-testid="'list-remove:' + slotDef.id"
      @click.stop="buildEditor.removeListRow(slotDef.id)"
    >
      <Trash />
    </IconButton>
    <InlineRepetitionStepper
      v-if="item?.inlineRepetition"
      :item="item"
      :value="repetitions"
      testid-prefix="repetition"
      @change="(count) => buildEditor.setAssignment(slotDef, item!.id, count)"
    >
      <template #label>{{ repetitionLabel }}</template>
    </InlineRepetitionStepper>
    <!-- The build-wide notice's offer, scoped to this row. -->
    <span
      v-if="replacement"
      class="flex shrink-0 items-center gap-1"
      :data-testid="'slot-retired:' + slotDef.id"
    >
      <BaseBadge variant="warn">retired</BaseBadge>
      <IconButton
        :title="`Replace with ${replacement.name}`"
        :data-testid="'slot-retired-apply:' + slotDef.id"
        @click="buildEditor.applyRetiredItem(slotDef.id)"
        ><Replace
      /></IconButton>
    </span>
    <span
      class="min-w-0 flex-1 truncate text-text"
      data-testid="slot-stat-summary"
      >{{ item ? statSummary : "" }}</span
    >
  </div>

  <!-- This item's BonusOccurrenceConfig inputs, if it carries any -- see
       BonusOccurrenceInputs.vue for what each config's range renders as. -->
  <div
    v-if="occurrenceRows.length"
    class="mt-1 flex flex-wrap items-center gap-2.5"
  >
    <BonusOccurrenceInputs
      :rows="occurrenceRows"
      testid-prefix="occurrence"
      @change="setOccurrence"
    />
  </div>

  <!-- Every dynamic-stat magnitude this slot's pick carries -- item-level and/or bonus-level
       (useDynamicStats.ts), one input per row, driven entirely by the item/bonus's own
       declared configs so a second (or third) one works with no UI change. -->
  <div
    v-if="dynamicStatRows.length"
    class="mt-1 flex flex-col flex-wrap gap-2.5"
  >
    <div v-for="row in dynamicStatRows" :key="row.key" class="flex gap-1.5">
      <span>{{ rangeLabel(row) }}</span>
      <PercentInput
        v-if="isPercent(row.stat)"
        :model-value="row.value"
        class="w-20"
        :data-testid="'slot-dynamic:' + row.stat"
        @update:model-value="setDynamic(row, $event)"
      />
      <input
        v-else
        type="number"
        class="w-20 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        :min="row.min"
        :max="row.max"
        :value="row.value"
        :data-testid="'slot-dynamic:' + row.stat"
        @input="setDynamic(row, ($event.target as HTMLInputElement).value)"
      />
    </div>
  </div>

  <p
    v-if="highlightDiff && choiceDiffers"
    class="slot-diff-note mt-0.5 text-muted"
  >
    {{ compareBuild?.name }}: {{ otherChoiceLabel || "(empty)" }}
    <BaseButton
      variant="link"
      class="ml-0.5 text-accent"
      @click.stop="buildEditor.applyFromCompare(slotDef.id)"
    >
      apply
    </BaseButton>
  </p>

  <template v-if="highlightDiff">
    <p
      v-for="bonusDiff in bonusDiffs ?? []"
      :key="bonusDiff.id"
      class="mt-0.5 font-semibold text-diff"
    >
      {{ bonusDiff.message }}
    </p>
  </template>

  <template v-if="highlightDiff">
    <p
      v-for="diff in valueDiffs ?? []"
      :key="diff.key"
      class="slot-diff-note mt-0.5 text-muted"
    >
      {{ compareBuild?.name }}: {{ diff.label }} {{ diff.other ?? "(none)" }}
      <BaseButton
        variant="link"
        class="ml-0.5 text-accent"
        @click.stop="buildEditor.applyValueFromCompare(slotDef.id, diff.key)"
      >
        apply
      </BaseButton>
    </p>
  </template>

  <p
    v-if="highlightDiff && assignmentDiffers"
    class="slot-diff-note mt-0.5 text-muted"
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

  <p
    v-if="highlightDiff && occurrenceDiffers"
    class="slot-diff-note mt-0.5 text-muted"
  >
    {{ compareBuild?.name }}: {{ otherOccurrenceLabel ?? "(none)" }}
    <BaseButton
      variant="link"
      class="ml-0.5 text-accent"
      @click.stop="buildEditor.applyOccurrenceFromCompare(item!.id)"
    >
      apply
    </BaseButton>
  </p>
</template>
