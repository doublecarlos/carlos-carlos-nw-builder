<script setup lang="ts">
// The item_picker case of BuildSlot.vue's row content: the picker itself, its dynamic-stat
// magnitude(s) (item-level and/or bonus-level -- useDynamicStats.ts), and this type's diff
// notes (choice/bonus/value). Row chrome (label, cursor anchor, hover/diff highlighting, the
// errors list) stays in BuildSlot.vue since it's identical across every slot type.
import { computed, useTemplateRef } from "vue";
import ItemPicker from "./ItemPicker.vue";
import PercentInput from "../ui/PercentInput.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import IconButton from "../ui/IconButton.vue";
import { Minus, Plus } from "@lucide/vue";
import * as buildEditor from "../../stores/buildEditor";
import {
  useItemBonusOccurrences,
  type OccurrenceRow,
} from "../../composables/useItemBonusOccurrences";
import {
  useSlotDynamicStats,
  type DynamicStatRow,
} from "../../composables/useDynamicStats";
import { isPercentKind, kindOf, stat as formatStat } from "../../lib/format";
import { isMac } from "../../lib/platform";
import type { Build, Db, Item, ItemPickerSlot } from "../../types";
import type { ValueDiff } from "../../composables/useCompareDiff";

const modKey = isMac ? "Cmd" : "Ctrl";

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

const emit = defineEmits<{
  /** The row's own "new item" shortcut -- BuildSlot.vue forwards it up with this row's
   *  `filter`, so the item editor can open with a fresh draft pre-filtered to this slot. */
  addItem: [];
}>();

const picker = useTemplateRef<InstanceType<typeof ItemPicker>>("picker");

const occurrenceRows = useItemBonusOccurrences(computed(() => props.item));

function onOccurrenceCheckbox(row: OccurrenceRow, checked: boolean) {
  buildEditor.setOccurrenceInput(
    props.item!.id,
    row.bonusId,
    checked ? 1 : 0,
    row.label,
  );
}

function onOccurrenceInput(row: OccurrenceRow, event: Event) {
  const raw = Number((event.target as HTMLInputElement).value);
  buildEditor.setOccurrenceInput(
    props.item!.id,
    row.bonusId,
    Number.isFinite(raw) ? raw : row.defaultValue,
    row.label,
  );
}

/** As PointAssignmentInput.vue's own stepper: a plain click steps by one, Ctrl/Cmd+click jumps
 *  straight to that direction's bound. Stopped from bubbling: unlike a point_assignment row
 *  (which has no single `itemIn` resolution of its own, so BuildEditor's row-level Ctrl+click
 *  handler already no-ops there), an item_picker row's Ctrl+click jumps straight to its one
 *  item in the layer editor -- a stepper embedded in this row would otherwise trigger that
 *  navigation on every Ctrl+click instead of stepping. */
function stepOccurrence(row: OccurrenceRow, dir: 1 | -1, event: MouseEvent) {
  event.stopPropagation();
  if (isMac ? event.metaKey : event.ctrlKey) {
    buildEditor.setOccurrenceInput(
      props.item!.id,
      row.bonusId,
      dir === 1 ? row.max : row.min,
      row.label,
    );
    return;
  }
  const next = Math.min(Math.max(row.value + dir, row.min), row.max);
  buildEditor.setOccurrenceInput(props.item!.id, row.bonusId, next, row.label);
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
  return `${row.label} ${formatStat(row.stat, row.min)}–${formatStat(row.stat, row.max)}`;
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
      :bonus-preview="{ db, build, slotId: slotDef.id }"
      @update:model-value="buildEditor.setChoice(slotDef.id, $event)"
    />
    <span class="min-w-0 flex-1 truncate text-sm text-text">{{
      item ? statSummary : ""
    }}</span>
    <IconButton
      title="Create a new item for this slot"
      data-testid="add-item-for-slot"
      @click="emit('addItem')"
    >
      <Plus />
    </IconButton>
  </div>

  <!-- One row per BonusOccurrenceConfig this item carries -- a 0-1 range reads as a checkbox
       (a per-item on/off toggle, e.g. a proc), a wider range as a stepper. A fixed
       (min === max) config never produces a row at all -- see useItemBonusOccurrences.ts. -->
  <div
    v-if="occurrenceRows.length"
    class="mt-1 flex flex-wrap items-center gap-2.5"
  >
    <BaseCheckbox
      v-for="row in occurrenceRows.filter((r) => r.kind === 'checkbox')"
      :key="row.bonusId"
      inline
      :data-testid="`occurrence-toggle-${row.bonusId}`"
      :model-value="row.value === 1"
      @update:model-value="onOccurrenceCheckbox(row, $event as boolean)"
    >
      {{ row.label }}
    </BaseCheckbox>
    <div
      v-for="row in occurrenceRows.filter((r) => r.kind === 'stepper')"
      :key="row.bonusId"
      class="flex items-center gap-1.5"
    >
      <span class="text-sm">{{ row.label }}</span>
      <div class="flex items-center gap-1">
        <IconButton
          :title="`Decrease (${modKey}+click for min)`"
          :disabled="row.value <= row.min"
          @click="stepOccurrence(row, -1, $event)"
        >
          <Minus />
        </IconButton>
        <input
          type="number"
          class="w-14 rounded-md border border-line bg-surface py-0.5 text-center focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          :min="row.min"
          :max="row.max"
          :value="row.value"
          :data-testid="`occurrence-input-${row.bonusId}`"
          @input="onOccurrenceInput(row, $event)"
        />
        <IconButton
          :title="`Increase (${modKey}+click for max)`"
          :disabled="row.value >= row.max"
          @click="stepOccurrence(row, 1, $event)"
        >
          <Plus />
        </IconButton>
      </div>
    </div>
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
      <span class="text-sm text-muted">{{ rangeLabel(row) }}</span>
    </div>
  </div>

  <p
    v-if="highlightDiff && choiceDiffers"
    class="slot-diff-note mt-0.5 text-sm text-muted"
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
      class="mt-0.5 text-sm font-semibold text-diff"
    >
      {{ bonusDiff.message }}
    </p>
  </template>

  <template v-if="highlightDiff">
    <p
      v-for="diff in valueDiffs ?? []"
      :key="diff.key"
      class="slot-diff-note mt-0.5 text-sm text-muted"
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
    class="slot-diff-note mt-0.5 text-sm text-muted"
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
