<script setup lang="ts">
// The item_picker case of BuildSlot.vue's row content: the picker itself, its dynamic-stat
// magnitude(s) (item-level and/or bonus-level -- useDynamicStats.ts), and this type's diff
// notes (choice/bonus/value). Row chrome (label, cursor anchor, hover/diff highlighting, the
// errors list) stays in BuildSlot.vue since it's identical across every slot type.
import { computed, useTemplateRef } from "vue";
import ItemPicker from "./ItemPicker.vue";
import BonusOccurrenceInputs from "./BonusOccurrenceInputs.vue";
import PercentInput from "../ui/PercentInput.vue";
import BaseButton from "../ui/BaseButton.vue";
import * as buildEditor from "../../stores/buildEditor";
import { useItemBonusOccurrences } from "../../composables/useItemBonusOccurrences";
import {
  useSlotDynamicStats,
  type DynamicStatRow,
} from "../../composables/useDynamicStats";
import { isPercentKind, kindOf, stat as formatStat } from "../../lib/format";
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
  statSummary?: string;
  invalid?: boolean;
  choiceDiffers?: boolean;
  otherChoiceLabel?: string;
  bonusDiffs?: { id: string; message: string }[];
  valueDiffs?: ValueDiff[];
  occurrenceDiffers?: boolean;
  otherOccurrenceLabel?: string;
}>();

const picker = useTemplateRef<InstanceType<typeof ItemPicker>>("picker");

const occurrenceRows = useItemBonusOccurrences(computed(() => props.item));

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
</script>

<template>
  <div class="flex flex-wrap items-center gap-2.5">
    <ItemPicker
      ref="picker"
      class="grow-0 basis-80 min-w-40"
      :items="items ?? []"
      :model-value="choice()"
      :selected-item="item"
      :invalid="invalid"
      :db="db"
      :bonus-preview="{ db, build, slotId: slotDef.id }"
      :hide-preview="slotDef.hidePreview"
      @update:model-value="buildEditor.setChoice(slotDef.id, $event)"
    />
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
    class="mt-1 flex flex-wrap items-center gap-2.5"
  >
    <div
      v-for="row in dynamicStatRows"
      :key="row.key"
      class="flex items-center gap-1.5"
    >
      <span>{{ rangeLabel(row) }}</span>
      <PercentInput
        v-if="isPercent(row.stat)"
        :model-value="row.value"
        class="w-20"
        @update:model-value="setDynamic(row, $event)"
      />
      <input
        v-else
        type="number"
        class="w-20 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        :min="row.min"
        :max="row.max"
        :value="row.value"
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
