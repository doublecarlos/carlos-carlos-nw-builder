<script setup lang="ts">
// Editing form for one section preset. Hybrid approach (same as ItemForm.vue/BonusForm.vue).
// The draft shape and its `SectionPreset` conversion live in lib/preset-draft.ts, the same
// pattern ItemForm.vue's own draft mapping follows now (see that module's header comment); this
// file owns markup and wiring only.
//
// Each of a preset's slot-keyed value fields (params/choices/values/assignments) is edited as a
// small add/remove row list, the same "pick a key, then enter a type-appropriate value"
// pattern ItemForm.vue's stat-row editor already uses, except the value control for each row
// is not a generic number input: it's the *actual* control the real build editor uses for that
// slot type (BuildParamInput/ItemPicker/PointAssignmentInput), reused as-is via its existing
// slotDef + v-model contract. That reuse is what keeps this form from needing any new
// per-paramType/per-slot-type value editing code.
import { computed } from "vue";
import { Plus, Trash } from "@lucide/vue";
import BonusOccurrenceInputs from "./BonusOccurrenceInputs.vue";
import BuildParamInput from "./BuildParamInput.vue";
import ItemPicker from "./ItemPicker.vue";
import PointAssignmentInput from "./PointAssignmentInput.vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import BaseInput from "../ui/BaseInput.vue";
import DraftFormBar from "../ui/DraftFormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import FormSection from "../ui/FormSection.vue";
import IdField from "../ui/IdField.vue";
import * as catalog from "../../data/catalog";
import { useEditorDraft } from "../../composables/useEditorDraft";
import { occurrenceRows } from "../../composables/useItemBonusOccurrences";
import { dynamicValueKey } from "../../lib/dynamic-stats";
import { parseRowSlotId, rowSlot } from "../../lib/item-picker-list";
import {
  buildDraft,
  toPreset,
  diffLabel,
  type PresetDraft,
} from "../../lib/preset-draft";
import type {
  SectionPreset,
  Db,
  BuildParameterSlot,
  ItemPickerSlot,
  ItemPickerListSlot,
  PointAssignmentSlot,
} from "../../types";
import type { EntryStatus } from "../../data/catalog";
import FormSectionDescription from "../ui/FormSectionDescription.vue";

const props = withDefaults(
  defineProps<{
    /** The preset being edited, or null for a brand-new one. */
    source?: SectionPreset | null;
    /** Seeds a brand-new draft (`source == null`) from an existing preset shape, how
     *  BuildEditor's "Create new from current" hands over a section's live state. Ignored once
     *  `source` is set, same contract ItemForm/BonusForm's own `duplicateFrom` has. */
    duplicateFrom?: SectionPreset | null;
    status?: EntryStatus;
    db: Db;
    allocatableIds?: string[];
  }>(),
  {
    source: null,
    duplicateFrom: null,
    status: "base",
    allocatableIds: () => [],
  },
);

const emit = defineEmits<{
  /** Emitted on every change for an existing preset (debounced). */
  "update:preset": [payload: { preset: SectionPreset; label: string }];
  /** Emitted on Save click for a new preset. */
  save: [payload: { preset: SectionPreset }];
  delete: [];
  revert: [];
}>();

function computeId(local: PresetDraft): string {
  const label = local.label.trim();
  return label ? catalog.nextId(label, props.allocatableIds, "preset") : "";
}

/** The id `toPreset` writes: the source's own once one exists, otherwise whatever
 *  `computeId` works out from the draft's current label. */
function presetId(local: PresetDraft): string {
  return props.source?.id ?? computeId(local);
}

// Existing presets: live edits. New presets: draft until Save.
const isNew = computed(() => !props.source);

const { draft, error, dirty, displayId } = useEditorDraft<
  SectionPreset,
  PresetDraft,
  SectionPreset
>({
  source: () => props.source,
  isNew,
  buildDraft: (source) => buildDraft(source ?? props.duplicateFrom),
  toEntity: (local) => toPreset(local, { id: presetId(local), db: props.db }),
  diffLabel,
  hasContent: (d) =>
    Boolean(
      d.label ||
      d.paramRows.length ||
      d.itemRows.length ||
      d.assignmentRows.length ||
      d.clearRows.length,
    ),
  canEmit: (d) => Boolean(d.label.trim() && d.section),
  emit: (preset, label) => emit("update:preset", { preset, label }),
  displayId: {
    sourceId: () => props.source?.id,
    computeId,
  },
});

function occurrenceRowsFor(itemId: string) {
  return occurrenceRows(props.db.get(itemId), draft.value.occurrences[itemId]);
}

function setOccurrence(itemId: string, bonusId: string, count: number) {
  draft.value.occurrences[itemId] = {
    ...draft.value.occurrences[itemId],
    [bonusId]: count,
  };
}

// --- Common ---------------------------------------------------------------------------

const sectionOptions = computed(() =>
  props.db.sections.map((s) => ({ value: s.id, label: s.label })),
);

/** Off the composed catalog rather than the shipped file, so a layer-authored param is
 * offered here the same as a shipped one: a preset seeding a custom param is the whole
 * point of both being overlayable. */
const slotsInSection = computed(() =>
  props.db.slots.filter((slot) => slot.section === draft.value.section),
);

const paramSlotOptions = computed(() =>
  slotsInSection.value
    .filter((slot) => slot.type === "build_parameter")
    .map((slot) => ({ value: slot.id, label: slot.label })),
);
/** An `item_picker_list`'s rows as pickable options: every row the draft already names, plus
 *  one more so a preset can be extended a row at a time. A preset has no build to read a row
 *  count off, so the draft's own reach is the count. */
function listRowOptions(slot: ItemPickerListSlot, named: string[]) {
  const highest = named.reduce((max, slotId) => {
    const row = parseRowSlotId(slotId);
    return row?.listId === slot.id ? Math.max(max, row.index) : max;
  }, 0);
  return Array.from({ length: highest + 1 }, (_, index) => {
    const row = rowSlot(slot, index + 1);
    return { value: row.id, label: row.label };
  });
}

const itemSlotOptions = computed(() =>
  slotsInSection.value.flatMap((slot) => {
    if (slot.type === "item_picker")
      return [{ value: slot.id, label: slot.label }];
    if (slot.type === "item_picker_list")
      return listRowOptions(
        slot,
        draft.value.itemRows.map((row) => row.slotId),
      );
    return [];
  }),
);
const assignmentSlotOptions = computed(() =>
  slotsInSection.value
    .filter((slot) => slot.type === "point_assignment")
    .map((slot) => ({ value: slot.id, label: slot.label })),
);

/** Every value-holding slot in the section, whatever its type; `clears` resets a slot rather
 *  than writing a typed value into it, so it isn't restricted to one of them. */
const clearableSlotOptions = computed(() =>
  slotsInSection.value.flatMap((slot) => {
    if (
      slot.type === "build_parameter" ||
      slot.type === "item_picker" ||
      slot.type === "point_assignment"
    )
      return [{ value: slot.id, label: slot.label }];
    // A list offers both: the container, which resets every row, and each row on its own.
    if (slot.type === "item_picker_list")
      return [
        { value: slot.id, label: slot.label },
        ...listRowOptions(
          slot,
          draft.value.clearRows.map((row) => row.slotId),
        ),
      ];
    return [];
  }),
);

function paramSlotDef(slotId: string): BuildParameterSlot | undefined {
  const slot = props.db.slotById.get(slotId);
  return slot?.type === "build_parameter" ? slot : undefined;
}
function itemSlotDef(slotId: string): ItemPickerSlot | undefined {
  const slot = props.db.slotFor(slotId);
  return slot?.type === "item_picker" ? slot : undefined;
}
function assignmentSlotDef(slotId: string): PointAssignmentSlot | undefined {
  const slot = props.db.slotById.get(slotId);
  return slot?.type === "point_assignment" ? slot : undefined;
}

/** Changing the section invalidates every row (each addresses a slot in the *old* section),
 * so they're cleared rather than left dangling: an explicit user action, not a reactive
 * watcher, so rebuilding `draft` from an incoming `source` (below) doesn't also wipe itself. */
function chooseSection(section: string) {
  if (section === draft.value.section) return;
  draft.value.section = section;
  draft.value.paramRows = [];
  draft.value.itemRows = [];
  draft.value.assignmentRows = [];
  draft.value.clearRows = [];
  draft.value.occurrences = {};
}

function addParamRow() {
  draft.value.paramRows.push({ slotId: "", value: "" });
}
function removeParamRow(index: number) {
  draft.value.paramRows.splice(index, 1);
}

function addItemRow() {
  draft.value.itemRows.push({ slotId: "", choice: "", values: {} });
}
function removeItemRow(index: number) {
  draft.value.itemRows.splice(index, 1);
}

function addAssignmentRow() {
  draft.value.assignmentRows.push({ slotId: "", counts: {} });
}
function removeAssignmentRow(index: number) {
  draft.value.assignmentRows.splice(index, 1);
}

function addClearRow() {
  draft.value.clearRows.push({ slotId: "" });
}
function removeClearRow(index: number) {
  draft.value.clearRows.splice(index, 1);
}

defineExpose({ draft, dirty });

function save() {
  error.value = "";
  if (!draft.value.label.trim()) {
    error.value = "The preset needs a label.";
    return;
  }
  if (!draft.value.section) {
    error.value = "The preset needs a section.";
    return;
  }
  const hasRow =
    draft.value.paramRows.some((r) => r.slotId) ||
    draft.value.itemRows.some((r) => r.slotId && r.choice) ||
    draft.value.assignmentRows.some(
      (r) => r.slotId && Object.keys(r.counts).length,
    ) ||
    draft.value.clearRows.some((r) => r.slotId);
  if (!hasRow) {
    error.value = "Add at least one slot value.";
    return;
  }
  emit("save", {
    preset: toPreset(draft.value, { id: presetId(draft.value), db: props.db }),
  });
}
</script>

<template>
  <div>
    <DraftFormBar
      noun="preset"
      :title="draft.label || 'New preset'"
      :status="status"
      :dirty="dirty"
      :is-new="isNew"
      :has-source="Boolean(source)"
      :error="error"
      @save="save"
      @revert="$emit('revert')"
      @delete="$emit('delete')"
    />

    <FormGrid class="mb-2">
      <FormField label="Label">
        <BaseInput
          v-model="draft.label"
          class="w-full"
          type="text"
          data-testid="preset-label-input"
        />
      </FormField>
      <IdField :id="displayId" label="Id" :existing="Boolean(source)" />
      <FormField label="Section" class="w-60">
        <ComboBox
          :model-value="draft.section"
          :options="sectionOptions"
          placeholder="- pick a section -"
          data-testid="preset-section-input"
          @update:model-value="chooseSection"
        />
      </FormField>
    </FormGrid>

    <template v-if="draft.section">
      <FormSection
        >Parameters
        <IconButton
          title="Add a parameter"
          :disabled="!paramSlotOptions.length"
          @click="addParamRow"
          ><Plus
        /></IconButton>
      </FormSection>
      <div
        v-for="(row, index) in draft.paramRows"
        :key="index"
        class="preset-row mb-1 flex flex-wrap items-center gap-1.5"
      >
        <IconButton title="Remove" @click="removeParamRow(index)"
          ><Trash
        /></IconButton>
        <ComboBox
          class="w-52"
          :model-value="row.slotId"
          :options="paramSlotOptions"
          placeholder="- pick a slot -"
          @update:model-value="(v) => (row.slotId = v)"
        />
        <BuildParamInput
          v-if="paramSlotDef(row.slotId)"
          v-model="row.value"
          :slot-def="paramSlotDef(row.slotId)!"
        />
      </div>

      <FormSection
        >Item pickers
        <IconButton
          title="Add an item slot"
          :disabled="!itemSlotOptions.length"
          @click="addItemRow"
          ><Plus
        /></IconButton>
      </FormSection>
      <div
        v-for="(row, index) in draft.itemRows"
        :key="index"
        class="preset-row mb-1 flex flex-wrap items-center gap-1.5"
      >
        <IconButton title="Remove" @click="removeItemRow(index)"
          ><Trash
        /></IconButton>
        <ComboBox
          class="w-52"
          :model-value="row.slotId"
          :options="itemSlotOptions"
          placeholder="- pick a slot -"
          @update:model-value="(v) => (row.slotId = v)"
        />
        <ItemPicker
          v-if="itemSlotDef(row.slotId)"
          v-model="row.choice"
          class="w-64"
          :items="db.forSlot(row.slotId)"
          :selected-item="db.get(row.choice)"
          :db="db"
        />
        <span
          v-for="config in db.get(row.choice)?.dynamicStats ?? []"
          :key="config.stat"
          class="flex items-center gap-1"
        >
          <BaseInput
            v-model.number="row.values[dynamicValueKey(config.stat)]"
            class="w-24"
            type="number"
            :placeholder="String(config.default)"
          />
          <span class="text-muted">{{ config.label ?? config.stat }}</span>
        </span>
        <!-- The picked item's own occurrence inputs, written into the draft-wide map keyed by
             that item rather than by this row's slot. -->
        <BonusOccurrenceInputs
          :rows="occurrenceRowsFor(row.choice)"
          :testid-prefix="`preset-occurrence-${row.choice}`"
          @change="
            (bonusId, count) => setOccurrence(row.choice, bonusId, count)
          "
        />
      </div>

      <FormSection
        >Point assignments
        <IconButton
          title="Add a point assignment slot"
          :disabled="!assignmentSlotOptions.length"
          @click="addAssignmentRow"
          ><Plus
        /></IconButton>
      </FormSection>
      <div
        v-for="(row, index) in draft.assignmentRows"
        :key="index"
        class="preset-row mb-1.5 flex flex-wrap items-start gap-1.5"
      >
        <IconButton title="Remove" @click="removeAssignmentRow(index)"
          ><Trash
        /></IconButton>
        <ComboBox
          class="w-52"
          :model-value="row.slotId"
          :options="assignmentSlotOptions"
          placeholder="- pick a slot -"
          @update:model-value="(v) => (row.slotId = v)"
        />
        <PointAssignmentInput
          v-if="assignmentSlotDef(row.slotId)"
          :slot-def="assignmentSlotDef(row.slotId)!"
          :values="row.counts"
          :occurrence-values="draft.occurrences"
          @change="
            (itemId, count) => (row.counts = { ...row.counts, [itemId]: count })
          "
          @occurrence-change="
            (itemId, bonusId, count) => setOccurrence(itemId, bonusId, count)
          "
        />
      </div>
      <FormSection
        >Cleared slots
        <IconButton
          title="Add a slot to clear"
          :disabled="!clearableSlotOptions.length"
          @click="addClearRow"
          ><Plus
        /></IconButton>
      </FormSection>
      <FormSectionDescription>
        Applying the preset resets these slots to their defaults.
      </FormSectionDescription>
      <div
        v-for="(row, index) in draft.clearRows"
        :key="index"
        class="preset-clear-row mb-1 flex flex-wrap items-center gap-1.5"
      >
        <IconButton title="Remove" @click="removeClearRow(index)"
          ><Trash
        /></IconButton>
        <ComboBox
          class="w-52"
          :model-value="row.slotId"
          :options="clearableSlotOptions"
          placeholder="- pick a slot -"
          @update:model-value="(v) => (row.slotId = v)"
        />
      </div>
    </template>
    <FormSectionDescription v-else>
      Pick a section above to start adding slot values.
    </FormSectionDescription>
  </div>
</template>
