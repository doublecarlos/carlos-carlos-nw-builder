<script setup lang="ts">
// Editing form for one slot of any type. An existing slot live-edits; a new one is a draft
// until Save. Draft logic, the per-type field table and the save gates live in lib/slot-draft.ts.
//
// `TYPE_FIELDS[draft.type]` decides which blocks render. `type` is only editable on a new draft,
// since build data stored under a saved slot depends on its type.
import { computed } from "vue";
import { FileJson, Plus, Trash } from "@lucide/vue";
import ComboBox from "../ui/ComboBox.vue";
import ConditionRows from "./ConditionRows.vue";
import IconButton from "../ui/IconButton.vue";
import ItemPicker from "./ItemPicker.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import BaseTextarea from "../ui/BaseTextarea.vue";
import DraftFormBar from "../ui/DraftFormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import FormSection from "../ui/FormSection.vue";
import FormSectionDescription from "../ui/FormSectionDescription.vue";
import IdField from "../ui/IdField.vue";
import * as catalog from "../../data/catalog";
import { useEditorDraft } from "../../composables/useEditorDraft";
import { resolvedOptions } from "../../lib/param-options";
import {
  rowsToWhen,
  whenToRows,
  whenIsRepresentable,
  type ConditionRow,
} from "../../engine/condition-draft";
import {
  buildDraft,
  hasContent,
  toSlot,
  diffLabel,
  isNumeric,
  nounOf,
  findPathConflict,
  slotSaveError,
  SLOT_TYPE_OPTIONS,
  TYPE_FIELDS,
  type SlotDraft,
} from "../../lib/slot-draft";
import type {
  BonusOption,
  BuildParameterSlot,
  Db,
  Item,
  Slot,
  StableRole,
} from "../../types";
import type { EntryStatus } from "../../data/catalog";

const props = withDefaults(
  defineProps<{
    /** The slot being edited, or null for a brand-new one. */
    source?: Slot | null;
    /** Seeds a new draft from an existing slot, for "Duplicate". Ignored once `source` is set. */
    duplicateFrom?: Slot | null;
    /** The section a new slot lands in, from the outline's selection. */
    defaultSection?: string;
    status?: EntryStatus;
    db: Db;
    /** Every id already in use anywhere, so a new slot's generated id can't collide. */
    allocatableIds?: string[];
  }>(),
  {
    source: null,
    duplicateFrom: null,
    defaultSection: "",
    status: "base",
    allocatableIds: () => [],
  },
);

const emit = defineEmits<{
  "update:slot": [payload: { slot: Slot; label: string }];
  save: [payload: { slot: Slot }];
  delete: [];
  duplicate: [];
  revert: [];
}>();

function computeId(local: SlotDraft): string {
  const label = local.label.trim();
  // Separators and text slots have no label, so `nextSlotId` falls back to a per-type stem.
  if (!label && local.type !== "separator" && local.type !== "text") return "";
  return catalog.nextSlotId(
    local.section,
    label,
    props.allocatableIds,
    local.type,
  );
}

/** The id `toSlot` writes: the source's own once one exists, otherwise whatever `computeId`
 *  works out from the draft's current label. */
function slotId(local: SlotDraft): string {
  return props.source?.id ?? computeId(local);
}

const isNew = computed(() => !props.source);

const { draft, error, dirty, displayId } = useEditorDraft<
  Slot,
  SlotDraft,
  Slot
>({
  source: () => props.source,
  isNew,
  buildDraft: (source) => {
    const local = buildDraft(source ?? props.duplicateFrom);
    if (!source && !local.section) local.section = props.defaultSection;
    return local;
  },
  toEntity: (local) => toSlot(local, { id: slotId(local) }),
  diffLabel,
  hasContent,
  // Never persist a half-filled or conflicting draft; Save reports the same error.
  canEmit: (local) => !slotSaveError(local, props.db, slotId(local)),
  emit: (slot, label) => emit("update:slot", { slot, label }),
  displayId: {
    sourceId: () => props.source?.id,
    computeId,
  },
  draftNoun: "slot",
});

defineExpose({ draft, dirty });

/** The field blocks the active type is authored with. */
const fields = computed(() => new Set(TYPE_FIELDS[draft.value.type]));

const noun = computed(() => nounOf(draft.value.type));

const numeric = computed(() => isNumeric(draft.value.paramType));

const sectionOptions = computed(() =>
  props.db.sections.map((s) => ({ value: s.id, label: s.label })),
);

const optionsSourceOptions = [
  { value: "inline", label: "listed here" },
  { value: "tags", label: "items with tags" },
  { value: "filter", label: "items in a filter" },
];

const selectorSourceOptions = [
  { value: "filter", label: "items in a filter" },
  { value: "tags", label: "items with tags" },
];

const paramTypeOptions = [
  { value: "number", label: "number" },
  { value: "percent", label: "percent" },
  { value: "boolean", label: "boolean" },
  { value: "list", label: "list" },
];

const booleanDefaultOptions = [
  { value: "false", label: "off" },
  { value: "true", label: "on" },
];

const scalerModeOptions = [
  { value: "", label: "not a scaler" },
  { value: "relative", label: "relative (1 + value)" },
  { value: "absolute", label: "absolute (value as-is)" },
];

const stableRoleOptions = [
  { value: "", label: "not a stable row" },
  { value: "mount", label: "mount" },
  { value: "insignia", label: "insignia" },
  { value: "bonus", label: "insignia bonus" },
];

/** Every tag any item carries, offered by the derived-options and selector fields. */
const tagOptions = computed(() =>
  [...props.db.itemsByTag.keys()].sort().join(", "),
);

/** Every known bonus as a choice for the occurrences condition, by name. */
const bonusOptions = computed<BonusOption[]>(() =>
  props.db.bonuses
    .map((bonus) => ({ value: bonus.id, label: bonus.name ?? bonus.id }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

/** The items this slot's selector offers, resolved as `Db.forSlot` does, for the default picker. */
const candidates = computed<Item[]>(() => {
  if (draft.value.selectorSource === "tags") {
    const tags = draft.value.tags
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const ids = new Set(
      tags.flatMap((tag) => props.db.itemsByTag.get(tag) ?? []),
    );
    return [...ids]
      .map((id) => props.db.get(id))
      .filter((item): item is Item => Boolean(item));
  }
  const filter = draft.value.filter.trim();
  return filter ? props.db.forFilter(filter) : [];
});

/** How many items the current `optionsFrom` selector actually matches: authoring a derived
 * option set with a typo'd tag otherwise looks identical to one with no matching items yet. */
const derivedPreview = computed(() => {
  if (draft.value.type !== "build_parameter") return null;
  if (draft.value.optionsSource === "inline") return null;
  const slot = toSlot(draft.value, { id: slotId(draft.value) });
  return resolvedOptions(slot as BuildParameterSlot, props.db.items) ?? [];
});

const pathConflict = computed(() =>
  findPathConflict(draft.value, props.db, slotId(draft.value)),
);

/** What breaks outside the catalog if this slot is deleted, shown beside Delete. */
const requiredReason = computed(() =>
  props.source ? catalog.requiredSlotReason(props.source) : null,
);

function addOption() {
  draft.value.options.push({ value: "", label: "" });
}
function removeOption(index: number) {
  draft.value.options.splice(index, 1);
}

function setConditions(rows: ConditionRow[]) {
  draft.value.when = rows;
}

/** Swaps the `visibleWhen` editor between rows and raw JSON. A condition the rows cannot
 *  express stays in JSON. */
function toggleWhenMode() {
  if (draft.value.whenMode === "rows") {
    const when = rowsToWhen(draft.value.when);
    draft.value.whenJson = Object.keys(when).length
      ? JSON.stringify(when, null, 2)
      : "";
    draft.value.whenMode = "json";
    error.value = "";
    return;
  }
  const text = draft.value.whenJson.trim();
  if (!text) {
    draft.value.when = [];
    draft.value.whenMode = "rows";
    error.value = "";
    return;
  }
  try {
    const when = JSON.parse(text);
    if (!whenIsRepresentable(when)) {
      error.value =
        "That condition is too complex for the form. Keeping it as JSON.";
      return;
    }
    draft.value.when = whenToRows(when);
    draft.value.whenMode = "rows";
    error.value = "";
  } catch (err: unknown) {
    error.value = `That condition is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function save() {
  error.value = slotSaveError(draft.value, props.db, slotId(draft.value)) ?? "";
  if (error.value) return;
  emit("save", { slot: toSlot(draft.value, { id: slotId(draft.value) }) });
}
</script>

<template>
  <div>
    <DraftFormBar
      :noun="noun"
      :title="draft.label || `New ${noun}`"
      :status="status"
      :dirty="dirty"
      :is-new="isNew"
      :has-source="Boolean(source)"
      can-duplicate
      :error="error"
      save-testid="save-slot"
      duplicate-testid="duplicate-slot"
      delete-testid="delete-slot"
      error-testid="slot-error"
      @save="save"
      @revert="$emit('revert')"
      @duplicate="$emit('duplicate')"
      @delete="$emit('delete')"
    />

    <p
      v-if="requiredReason"
      class="mb-2 text-warn"
      data-testid="slot-required-warning"
    >
      Deleting this {{ noun }} breaks other parts of the app:
      {{ requiredReason }}.
    </p>

    <FormGrid class="mb-2">
      <FormField label="Label">
        <BaseInput
          v-model="draft.label"
          class="w-full"
          type="text"
          data-testid="slot-label-input"
        />
      </FormField>
      <IdField :id="displayId" label="Id" :existing="Boolean(source)" />
      <FormField label="Section" class="w-60">
        <ComboBox
          :model-value="draft.section"
          :options="sectionOptions"
          placeholder="Pick a section"
          data-testid="slot-section-input"
          @update:model-value="(v) => (draft.section = v)"
        />
      </FormField>
      <FormField
        label="Kind"
        :hint="
          isNew
            ? undefined
            : 'Fixed once saved, since builds store values by kind'
        "
        class="w-48"
      >
        <ComboBox
          :model-value="draft.type"
          :options="SLOT_TYPE_OPTIONS"
          :readonly="!isNew"
          data-testid="slot-kind-input"
          @update:model-value="(v) => (draft.type = v as Slot['type'])"
        />
      </FormField>
    </FormGrid>

    <!-- build_parameter ------------------------------------------------------------------ -->
    <template v-if="fields.has('param')">
      <FormGrid class="mb-2">
        <FormField label="Type" class="w-40">
          <ComboBox
            :model-value="draft.paramType"
            :options="paramTypeOptions"
            data-testid="slot-type-input"
            @update:model-value="
              (v) => (draft.paramType = v as BuildParameterSlot['paramType'])
            "
          />
        </FormField>
        <FormField
          label="Path"
          hint="Dotted path into the build context, e.g. toggles.myFeature"
        >
          <BaseInput
            v-model="draft.path"
            class="w-full"
            type="text"
            data-testid="slot-path-input"
          />
        </FormField>
        <FormField label="Quick">
          <BaseCheckbox v-model="draft.quick" data-testid="slot-quick-input">
            show in the quick strip
          </BaseCheckbox>
        </FormField>
      </FormGrid>

      <p
        v-if="pathConflict"
        class="mb-2 text-danger"
        data-testid="slot-path-clash"
      >
        Path "{{ draft.path.trim() }}" is already used by {{ pathConflict }};
        the two would silently share one value.
      </p>

      <FormGrid class="mb-2">
        <FormField label="Default">
          <ComboBox
            v-if="draft.paramType === 'boolean'"
            :model-value="String(draft.default)"
            :options="booleanDefaultOptions"
            data-testid="slot-default-input"
            @update:model-value="(v) => (draft.default = v)"
          />
          <BaseInput
            v-else
            v-model="draft.default"
            class="w-full"
            :type="numeric ? 'number' : 'text'"
            data-testid="slot-default-input"
          />
        </FormField>
        <template v-if="numeric">
          <FormField label="Min" class="w-24">
            <BaseInput
              v-model="draft.min"
              class="w-full"
              type="number"
              data-testid="slot-min-input"
            />
          </FormField>
          <FormField label="Max" class="w-24">
            <BaseInput
              v-model="draft.max"
              class="w-full"
              type="number"
              data-testid="slot-max-input"
            />
          </FormField>
          <FormField label="Step" class="w-24">
            <BaseInput
              v-model="draft.step"
              class="w-full"
              type="number"
              data-testid="slot-step-input"
            />
          </FormField>
          <FormField label="Presets" hint="comma-separated">
            <BaseInput
              v-model="draft.presets"
              class="w-full"
              type="text"
              data-testid="slot-presets-input"
            />
          </FormField>
        </template>
      </FormGrid>

      <!-- A scaler multiplies stat lines by this parameter's value, so only a numeric param
           can be one. Filters/tags name the items scaled wholesale; a scaler with neither is
           reached only through a grant's own `scaledBy`. -->
      <FormGrid v-if="numeric" class="mb-2">
        <FormField label="Scales stats" class="w-52">
          <ComboBox
            :model-value="draft.scalerMode"
            :options="scalerModeOptions"
            data-testid="slot-scaler-mode-input"
            @update:model-value="
              (v) => (draft.scalerMode = v as SlotDraft['scalerMode'])
            "
          />
        </FormField>
        <template v-if="draft.scalerMode">
          <FormField
            label="Scaled item filters"
            hint="comma-separated; every item in these categories"
          >
            <BaseInput
              v-model="draft.scalerFilters"
              class="w-full"
              type="text"
              data-testid="slot-scaler-filters-input"
            />
          </FormField>
          <FormField
            label="Scaled item tags"
            hint="comma-separated; every item with one of these tags"
          >
            <BaseInput
              v-model="draft.scalerTags"
              class="w-full"
              type="text"
              :title="tagOptions"
              data-testid="slot-scaler-tags-input"
            />
          </FormField>
        </template>
      </FormGrid>

      <template v-if="draft.paramType === 'list'">
        <FormGrid class="mb-2">
          <FormField label="Options are" class="w-52">
            <ComboBox
              :model-value="draft.optionsSource"
              :options="optionsSourceOptions"
              data-testid="slot-options-source-input"
              @update:model-value="
                (v) => (draft.optionsSource = v as SlotDraft['optionsSource'])
              "
            />
          </FormField>
          <FormField
            v-if="draft.optionsSource === 'tags'"
            label="Item tags"
            hint="comma-separated; one option per matching item"
          >
            <!-- Stays a native `title`: it previews the value this expression resolves to, and
                 a bubble opening on focus would sit over the field while it is being typed in. -->
            <BaseInput
              v-model="draft.optionsFromTags"
              class="w-full"
              type="text"
              :title="tagOptions"
              data-testid="slot-options-tags-input"
            />
          </FormField>
          <FormField
            v-if="draft.optionsSource === 'filter'"
            label="Item filter"
            hint="one option per item in this category"
          >
            <BaseInput
              v-model="draft.optionsFromFilter"
              class="w-full"
              type="text"
              data-testid="slot-options-filter-input"
            />
          </FormField>
          <FormField v-if="draft.optionsSource !== 'inline'" label="Empty row">
            <BaseCheckbox
              v-model="draft.allowEmpty"
              data-testid="slot-allow-empty-input"
            >
              offer “- none -”
            </BaseCheckbox>
          </FormField>
        </FormGrid>

        <p
          v-if="derivedPreview"
          class="mb-2"
          :class="derivedPreview.length ? 'text-muted' : 'text-warn'"
          data-testid="slot-derived-preview"
        >
          {{ derivedPreview.length }} option(s):
          {{
            derivedPreview.map((o) => o.label).join(", ") || "no items match"
          }}
        </p>

        <template v-if="draft.optionsSource === 'inline'">
          <FormSection
            >Options
            <IconButton title="Add an option" @click="addOption"
              ><Plus
            /></IconButton>
          </FormSection>
          <div
            v-for="(row, index) in draft.options"
            :key="index"
            class="slot-option-row mb-1 flex flex-wrap items-center gap-1.5"
          >
            <IconButton title="Remove" @click="removeOption(index)"
              ><Trash
            /></IconButton>
            <BaseInput
              v-model="row.label"
              class="w-40"
              type="text"
              placeholder="Label"
              :data-testid="`slot-option-label-${index}`"
            />
            <BaseInput
              v-model="row.value"
              class="w-40"
              type="text"
              placeholder="Value"
              :data-testid="`slot-option-value-${index}`"
            />
          </div>
        </template>
      </template>
    </template>

    <!-- item_picker / item_picker_list: filter XOR tags ----------------------------------- -->
    <FormGrid v-if="fields.has('selector')" class="mb-2">
      <FormField label="Offers" class="w-52">
        <ComboBox
          :model-value="draft.selectorSource"
          :options="selectorSourceOptions"
          data-testid="slot-selector-source-input"
          @update:model-value="
            (v) => (draft.selectorSource = v as SlotDraft['selectorSource'])
          "
        />
      </FormField>
      <FormField
        v-if="draft.selectorSource === 'filter'"
        label="Item filter"
        hint="every item in this category"
      >
        <BaseInput
          v-model="draft.filter"
          class="w-full"
          type="text"
          data-testid="slot-filter-input"
        />
      </FormField>
      <FormField
        v-else
        label="Item tags"
        hint="comma-separated; every item with one of these tags"
      >
        <BaseInput
          v-model="draft.tags"
          class="w-full"
          type="text"
          :title="tagOptions"
          data-testid="slot-tags-input"
        />
      </FormField>
    </FormGrid>

    <!-- point_assignment: one row per matching item, so only a filter makes sense ---------- -->
    <FormGrid v-if="fields.has('filter')" class="mb-2">
      <FormField label="Item filter" hint="one row per item in this category">
        <BaseInput
          v-model="draft.filter"
          class="w-full"
          type="text"
          data-testid="slot-filter-input"
        />
      </FormField>
    </FormGrid>

    <p
      v-if="fields.has('selector') || fields.has('filter')"
      class="mb-2"
      :class="candidates.length ? 'text-muted' : 'text-warn'"
      data-testid="slot-candidate-preview"
    >
      {{ candidates.length }} item(s) match.
    </p>

    <!-- item_picker -------------------------------------------------------------------- -->
    <FormGrid v-if="fields.has('itemDefault')" class="mb-2">
      <FormField
        label="Default"
        hint="what new builds start with, and what clearing it restores"
      >
        <ItemPicker
          v-model="draft.itemDefault"
          class="w-64"
          data-testid="slot-item-default-input"
          :items="candidates"
          :selected-item="db.get(draft.itemDefault)"
          :db="db"
        />
      </FormField>
    </FormGrid>

    <div v-if="fields.has('pickerFlags')" class="mb-2 flex flex-wrap gap-x-4">
      <BaseCheckbox
        v-model="draft.disallowEmpty"
        data-testid="slot-disallow-empty-input"
        >cannot be emptied</BaseCheckbox
      >
      <BaseCheckbox
        v-model="draft.hidePreview"
        data-testid="slot-hide-preview-input"
        >hide stat previews in the picker</BaseCheckbox
      >
      <BaseCheckbox
        v-model="draft.toggleable"
        data-testid="slot-toggleable-input"
        >can be switched off</BaseCheckbox
      >
      <BaseCheckbox v-model="draft.quick" data-testid="slot-quick-input"
        >show in the quick strip</BaseCheckbox
      >
    </div>

    <!-- item_picker_list ---------------------------------------------------------------- -->
    <FormGrid v-if="fields.has('defaultRows')" class="mb-2">
      <FormField label="Starting rows" class="w-40">
        <BaseInput
          v-model="draft.defaultRows"
          class="w-full"
          type="number"
          min="0"
          data-testid="slot-default-rows-input"
        />
      </FormField>
    </FormGrid>

    <div v-if="fields.has('toggleable')" class="mb-2">
      <BaseCheckbox
        v-model="draft.toggleable"
        data-testid="slot-toggleable-input"
        >every row can be switched off</BaseCheckbox
      >
    </div>

    <!-- text ---------------------------------------------------------------------------- -->
    <FormGrid v-if="fields.has('text')" class="mb-2">
      <FormField label="Text">
        <BaseInput
          v-model="draft.text"
          class="w-full"
          type="text"
          data-testid="slot-text-input"
        />
      </FormField>
    </FormGrid>

    <!-- the stable ---------------------------------------------------------------------- -->
    <template v-if="fields.has('stable')">
      <FormSection>Stable</FormSection>
      <FormSectionDescription>
        Links this row to a mount group, so its insignia match that mount's
        insignia slots.
      </FormSectionDescription>
      <FormGrid class="mb-2">
        <FormField label="Role" class="w-44">
          <ComboBox
            :model-value="draft.stableRole"
            :options="stableRoleOptions"
            data-testid="slot-stable-role-input"
            @update:model-value="
              (v) => (draft.stableRole = v as '' | StableRole)
            "
          />
        </FormField>
        <template v-if="draft.stableRole">
          <FormField label="Group" class="w-24">
            <BaseInput
              v-model="draft.stableGroup"
              class="w-full"
              type="number"
              data-testid="slot-stable-group-input"
            />
          </FormField>
          <FormField
            v-if="draft.stableRole === 'insignia'"
            label="Position"
            class="w-24"
          >
            <BaseInput
              v-model="draft.stableIndex"
              class="w-full"
              type="number"
              min="1"
              data-testid="slot-stable-index-input"
            />
          </FormField>
        </template>
      </FormGrid>
    </template>

    <!-- visibleWhen, on every type --------------------------------------------------------- -->
    <FormSection
      >Shown when
      <IconButton
        :title="draft.whenMode === 'json' ? 'Use the form' : 'Edit as JSON'"
        data-testid="slot-when-json-toggle"
        @click="toggleWhenMode"
        ><FileJson
      /></IconButton>
    </FormSection>
    <FormSectionDescription>
      Leave empty to always show the row. A hidden row's value still applies to
      the build.
    </FormSectionDescription>
    <BaseTextarea
      v-if="draft.whenMode === 'json'"
      v-model="draft.whenJson"
      class="mb-2 w-full font-mono"
      rows="6"
      data-testid="slot-when-json"
    />
    <ConditionRows
      v-else
      class="mb-2"
      :rows="draft.when"
      :depth="0"
      :bonus-options="bonusOptions"
      tree-id="slot"
      :path="[]"
      @update="setConditions"
    />
  </div>
</template>
