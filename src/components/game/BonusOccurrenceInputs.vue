<script setup lang="ts">
// The inputs for one item's BonusOccurrenceConfig attachments: a 0-1 range reads as a checkbox
// (a per-item on/off toggle, e.g. a proc), a wider range as a stepper. A fixed (min === max)
// config never reaches here at all -- see useItemBonusOccurrences.ts.
//
// Multi-root on purpose: every caller wraps these in its own layout (an item_picker row, a
// point_assignment column, a preset's item row), so the wrapper -- and where the counts are
// read from and written to -- stays theirs, and only the controls are shared.
import { Minus, Plus } from "@lucide/vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import IconButton from "../ui/IconButton.vue";
import { isMac } from "../../lib/platform";
import type { OccurrenceRow } from "../../composables/useItemBonusOccurrences";

const modKey = isMac ? "Cmd" : "Ctrl";

defineProps<{
  rows: OccurrenceRow[];
  /** Leading part of each control's `data-testid` -- `<prefix>-toggle-<bonusId>` and
   *  `<prefix>-input-<bonusId>`. Callers whose rows aren't unique on the page on their own
   *  (a point_assignment row renders a set per item) fold their own key into it. */
  testidPrefix: string;
}>();

const emit = defineEmits<{
  /** `label` rides along so the caller's undo entry can name the row the user actually saw --
   *  a config's `label` override, not necessarily the bonus's own name. */
  change: [bonusId: string, count: number, label: string];
}>();

function onCheckbox(row: OccurrenceRow, checked: boolean) {
  emit("change", row.bonusId, checked ? 1 : 0, row.label);
}

function onInput(row: OccurrenceRow, event: Event) {
  const raw = Number((event.target as HTMLInputElement).value);
  emit(
    "change",
    row.bonusId,
    Number.isFinite(raw) ? raw : row.defaultValue,
    row.label,
  );
}

/** A plain click steps by one, Ctrl/Cmd+click jumps straight to that direction's bound -- the
 *  same platform-modifier convention every other stepper in the app uses. Stopped from
 *  bubbling: an item_picker row's own Ctrl+click jumps to that item in the layer editor, which
 *  would otherwise fire instead of the step. */
function step(row: OccurrenceRow, dir: 1 | -1, event: MouseEvent) {
  event.stopPropagation();
  if (isMac ? event.metaKey : event.ctrlKey) {
    emit("change", row.bonusId, dir === 1 ? row.max : row.min, row.label);
    return;
  }
  emit(
    "change",
    row.bonusId,
    Math.min(Math.max(row.value + dir, row.min), row.max),
    row.label,
  );
}
</script>

<template>
  <BaseCheckbox
    v-for="row in rows.filter((r) => r.kind === 'checkbox')"
    :key="row.bonusId"
    inline
    :data-testid="`${testidPrefix}-toggle-${row.bonusId}`"
    :model-value="row.value === 1"
    @update:model-value="onCheckbox(row, $event as boolean)"
  >
    {{ row.label }}
  </BaseCheckbox>
  <div
    v-for="row in rows.filter((r) => r.kind === 'stepper')"
    :key="row.bonusId"
    class="flex items-center gap-1.5"
  >
    <span class="text-sm">{{ row.label }}</span>
    <div class="flex items-center gap-1">
      <IconButton
        :title="`Decrease (${modKey}+click for min)`"
        :disabled="row.value <= row.min"
        @click="step(row, -1, $event)"
      >
        <Minus />
      </IconButton>
      <input
        type="number"
        class="w-14 rounded-md border border-line bg-surface py-0.5 text-center focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        :min="row.min"
        :max="row.max"
        :value="row.value"
        :data-testid="`${testidPrefix}-input-${row.bonusId}`"
        @input="onInput(row, $event)"
      />
      <IconButton
        :title="`Increase (${modKey}+click for max)`"
        :disabled="row.value >= row.max"
        @click="step(row, 1, $event)"
      >
        <Plus />
      </IconButton>
    </div>
  </div>
</template>
