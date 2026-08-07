<script setup lang="ts">
// Editing form for one section preset. Hybrid approach (same as ItemForm.vue/BonusSetForm.vue):
// - Existing presets (source != null): live edits, changes emit immediately
// - New presets (source == null): explicit Save button, draft until label is finalized
//
// Each of a preset's four value fields (params/choices/values/assignments) is edited as a
// small add/remove row list -- the same "pick a key, then enter a type-appropriate value"
// pattern ItemForm.vue's stat-row editor already uses -- except the value control for each row
// is not a generic number input: it's the *actual* control the real build editor uses for that
// slot type (BuildParamInput/ItemPicker/PointAssignmentInput), reused as-is via its existing
// slotDef + v-model contract. That reuse is what keeps this form from needing any new
// per-paramType/per-slot-type value editing code.
import { ref, computed, watch } from "vue";
import { Plus, Save, Trash, Undo2 } from "@lucide/vue";
import BuildParamInput from "./BuildParamInput.vue";
import ItemPicker from "./ItemPicker.vue";
import PointAssignmentInput from "./PointAssignmentInput.vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import FormBar from "../ui/FormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import FormSection from "../ui/FormSection.vue";
import IdField from "../ui/IdField.vue";
import { NW_SLOTS } from "../../data/data";
import * as catalog from "../../data/catalog";
import { deepEqual } from "../../lib/deep-equal";
import { useDraftHistory } from "../../composables/useDraftHistory";
import type {
  SectionPreset,
  Db,
  BuildParameterSlot,
  ItemPickerSlot,
  PointAssignmentSlot,
} from "../../types";

const props = withDefaults(
  defineProps<{
    /** The preset being edited, or null for a brand-new one. */
    source?: SectionPreset | null;
    status?: string;
    db: Db;
    allocatableIds?: string[];
  }>(),
  {
    source: null,
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

interface ParamRow {
  slotId: string;
  value: string | number | boolean;
}
interface ItemRow {
  slotId: string;
  choice: string;
  value: number | string | null;
}
interface AssignmentRow {
  slotId: string;
  counts: Record<string, number>;
}

interface PresetDraft {
  label: string;
  section: string;
  paramRows: ParamRow[];
  itemRows: ItemRow[];
  assignmentRows: AssignmentRow[];
}

function buildDraft(preset: SectionPreset | null | undefined): PresetDraft {
  const source = preset ?? ({} as Partial<SectionPreset>);
  return {
    label: source.label ?? "",
    section: source.section ?? "",
    paramRows: Object.entries(source.params ?? {}).map(([slotId, value]) => ({
      slotId,
      value,
    })),
    itemRows: Object.entries(source.choices ?? {}).map(([slotId, choice]) => ({
      slotId,
      choice,
      value: source.values?.[slotId] ?? null,
    })),
    assignmentRows: Object.entries(source.assignments ?? {}).map(
      ([slotId, counts]) => ({ slotId, counts: { ...counts } }),
    ),
  };
}

// Existing presets: live edits. New presets: draft until Save.
const isNew = computed(() => !props.source);

const draft = ref<PresetDraft>(buildDraft(props.source));
const error = ref("");

function toPreset(): SectionPreset {
  const label = draft.value.label.trim();
  const id =
    props.source?.id ?? catalog.nextId(label, props.allocatableIds, "preset");
  const preset: SectionPreset = {
    id,
    label,
    section: draft.value.section,
  };

  const params: Record<string, string | number | boolean> = {};
  for (const row of draft.value.paramRows) {
    if (!row.slotId) continue;
    params[row.slotId] = row.value;
  }
  if (Object.keys(params).length) preset.params = params;

  const choices: Record<string, string> = {};
  const values: Record<string, number> = {};
  for (const row of draft.value.itemRows) {
    if (!row.slotId || !row.choice) continue;
    choices[row.slotId] = row.choice;
    if (row.value != null && row.value !== "") {
      const number = Number(row.value);
      if (Number.isFinite(number)) values[row.slotId] = number;
    }
  }
  if (Object.keys(choices).length) preset.choices = choices;
  if (Object.keys(values).length) preset.values = values;

  const assignments: Record<string, Record<string, number>> = {};
  for (const row of draft.value.assignmentRows) {
    if (!row.slotId || !Object.keys(row.counts).length) continue;
    assignments[row.slotId] = { ...row.counts };
  }
  if (Object.keys(assignments).length) preset.assignments = assignments;

  return preset;
}

// Initialize with preset JSON for correct comparison on existing presets.
let lastEmittedJson = JSON.stringify(props.source ? toPreset() : draft.value);

function diffLabel(oldJson: string, newJson: string): string {
  try {
    const old = JSON.parse(oldJson);
    const nw = JSON.parse(newJson);
    if (old.label !== nw.label) return `edit label → "${nw.label}"`;
    if (old.section !== nw.section) return `edit section → "${nw.section}"`;
    if (JSON.stringify(old.params) !== JSON.stringify(nw.params))
      return "edit params";
    if (
      JSON.stringify(old.choices) !== JSON.stringify(nw.choices) ||
      JSON.stringify(old.values) !== JSON.stringify(nw.values)
    )
      return "edit item choices";
    if (JSON.stringify(old.assignments) !== JSON.stringify(nw.assignments))
      return "edit point assignments";
  } catch {
    // JSON parse error -- shouldn't happen but be safe.
  }
  return "edit preset";
}

// --- Live edit emit (existing presets) -------------------------------------------------

function emitChange() {
  const label = draft.value.label.trim();
  if (!label || !draft.value.section) return;
  const preset = toPreset();
  const currentJson = JSON.stringify(preset);
  if (currentJson === lastEmittedJson) return;
  const changeLabel = diffLabel(lastEmittedJson, currentJson);
  lastEmittedJson = currentJson;
  emit("update:preset", { preset, label: changeLabel });
}

const { resetDraftHistory } = useDraftHistory({
  draft,
  isNew,
  diffLabel,
  onEmit: emitChange,
});

// --- Common ---------------------------------------------------------------------------

const sectionOptions = NW_SLOTS.sections.map((s) => ({
  value: s.id,
  label: s.label,
}));

const slotsInSection = computed(() =>
  NW_SLOTS.slots.filter((slot) => slot.section === draft.value.section),
);

const paramSlotOptions = computed(() =>
  slotsInSection.value
    .filter((slot) => slot.type === "build_parameter")
    .map((slot) => ({ value: slot.id, label: slot.label })),
);
const itemSlotOptions = computed(() =>
  slotsInSection.value
    .filter((slot) => slot.type === "item_picker")
    .map((slot) => ({ value: slot.id, label: slot.label })),
);
const assignmentSlotOptions = computed(() =>
  slotsInSection.value
    .filter((slot) => slot.type === "point_assignment")
    .map((slot) => ({ value: slot.id, label: slot.label })),
);

function paramSlotDef(slotId: string): BuildParameterSlot | undefined {
  const slot = NW_SLOTS.slots.find((s) => s.id === slotId);
  return slot?.type === "build_parameter" ? slot : undefined;
}
function itemSlotDef(slotId: string): ItemPickerSlot | undefined {
  const slot = NW_SLOTS.slots.find((s) => s.id === slotId);
  return slot?.type === "item_picker" ? slot : undefined;
}
function assignmentSlotDef(slotId: string): PointAssignmentSlot | undefined {
  const slot = NW_SLOTS.slots.find((s) => s.id === slotId);
  return slot?.type === "point_assignment" ? slot : undefined;
}

/** Changing the section invalidates every row (each addresses a slot in the *old* section),
 * so they're cleared rather than left dangling -- an explicit user action, not a reactive
 * watcher, so rebuilding `draft` from an incoming `source` (below) doesn't also wipe itself. */
function chooseSection(section: string) {
  if (section === draft.value.section) return;
  draft.value.section = section;
  draft.value.paramRows = [];
  draft.value.itemRows = [];
  draft.value.assignmentRows = [];
}

function addParamRow() {
  draft.value.paramRows.push({ slotId: "", value: "" });
}
function removeParamRow(index: number) {
  draft.value.paramRows.splice(index, 1);
}

function addItemRow() {
  draft.value.itemRows.push({ slotId: "", choice: "", value: null });
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

const dirty = computed(() => {
  if (!props.source) {
    return Boolean(
      draft.value.label ||
      draft.value.paramRows.length ||
      draft.value.itemRows.length ||
      draft.value.assignmentRows.length,
    );
  }
  return !deepEqual(toPreset(), props.source);
});

defineExpose({ draft, dirty });

const displayId = computed(
  () =>
    props.source?.id ??
    (draft.value.label.trim()
      ? catalog.nextId(draft.value.label.trim(), props.allocatableIds, "preset")
      : ""),
);

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
    );
  if (!hasRow) {
    error.value = "Add at least one slot value.";
    return;
  }
  emit("save", { preset: toPreset() });
}

// Rebuild draft when source changes (e.g. after undo/redo reverts the overlay).
watch(
  () => props.source,
  (value) => {
    // Same round-trip-echo guard BonusSetForm.vue uses: a live edit's own update:preset
    // round-trips through the layer overlay back into this prop, and rebuilding from that
    // echo would wipe a half-drawn row (e.g. a slot picked but no value entered yet).
    if (value && lastEmittedJson && JSON.stringify(value) === lastEmittedJson)
      return;
    draft.value = buildDraft(value);
    error.value = "";
    lastEmittedJson = value
      ? JSON.stringify(toPreset())
      : JSON.stringify(draft.value);
    resetDraftHistory();
  },
);
</script>

<template>
  <div>
    <FormBar class="-m-3 mb-3" data-testid="form-bar">
      <strong>{{ draft.label || "New preset" }}</strong>
      <BaseBadge v-if="status !== 'base'" :variant="status as any">{{
        status
      }}</BaseBadge>
      <BaseBadge v-if="dirty && isNew">unsaved</BaseBadge>
      <span class="flex-1"></span>
      <BaseButton
        v-if="isNew"
        variant="primary"
        :disabled="!dirty"
        @click="save"
        ><Save />Save preset</BaseButton
      >
      <BaseButton v-if="status === 'edited'" @click="$emit('revert')"
        ><Undo2 />Revert to shipped</BaseButton
      >
      <BaseButton v-if="source" @click="$emit('delete')"
        ><Trash />Delete</BaseButton
      >
    </FormBar>

    <p v-if="error" class="mt-1 text-danger">{{ error }}</p>

    <FormGrid class="mb-2">
      <FormField label="Label">
        <input
          v-model="draft.label"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="text"
          data-testid="preset-label-input"
        />
      </FormField>
      <IdField :id="displayId" label="Id" :existing="Boolean(source)" />
      <FormField label="Section" class="w-60">
        <ComboBox
          :model-value="draft.section"
          :options="sectionOptions"
          placeholder="— pick a section —"
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
          placeholder="— pick a slot —"
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
          placeholder="— pick a slot —"
          @update:model-value="(v) => (row.slotId = v)"
        />
        <ItemPicker
          v-if="itemSlotDef(row.slotId)"
          v-model="row.choice"
          class="w-64"
          :items="db.forSlot(row.slotId)"
          :selected-item="db.get(row.choice)"
        />
        <input
          v-if="db.get(row.choice)?.dynamicStat"
          v-model.number="row.value"
          class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="number"
          placeholder="value"
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
          placeholder="— pick a slot —"
          @update:model-value="(v) => (row.slotId = v)"
        />
        <PointAssignmentInput
          v-if="assignmentSlotDef(row.slotId)"
          :slot-def="assignmentSlotDef(row.slotId)!"
          :values="row.counts"
          @change="
            (itemId, count) => (row.counts = { ...row.counts, [itemId]: count })
          "
        />
      </div>
    </template>
    <p v-else class="text-sm text-muted">
      Pick a section above to start adding slot values.
    </p>
  </div>
</template>
