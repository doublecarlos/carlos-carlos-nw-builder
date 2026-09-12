<script setup lang="ts">
// Editing form for one item. Hybrid approach:
// - Existing items (source != null): live edits, changes emit immediately
// - New items (source == null): explicit Save button, draft until name is finalized
import { ref, computed, watch } from "vue";
import ItemBonuses from "./ItemBonuses.vue";
import BuildParamInput from "./BuildParamInput.vue";
import TokenInput from "../ui/TokenInput.vue";
import CreatableComboBox from "../ui/CreatableComboBox.vue";
import ComboBox from "../ui/ComboBox.vue";
import StatValueInput from "./StatValueInput.vue";
import StatRowList from "./StatRowList.vue";
import DynamicStatRowList from "./DynamicStatRowList.vue";
import IconButton from "../ui/IconButton.vue";
import RepeatableRows from "../ui/RepeatableRows.vue";
import { Plus, ScanText, Trash } from "@lucide/vue";
import BaseInput from "../ui/BaseInput.vue";
import DraftFormBar from "../ui/DraftFormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import IdField from "../ui/IdField.vue";
import OcrTextField from "../ui/OcrTextField.vue";
import FormSection from "../ui/FormSection.vue";
import { NW_SCHEMA } from "../../data/data";
import { findParamSlot } from "../../lib/build-path";
import * as catalog from "../../data/catalog";
import type { EntryStatus } from "../../data/catalog";
import { useEditorDraft } from "../../composables/useEditorDraft";
import { statPickerOptions } from "../../lib/format";
import type {
  Item,
  Db,
  Bonus,
  BonusOption,
  BuildParameterSlot,
} from "../../types";
import { INSIGNIA_SHAPES } from "../../types";
import {
  buildDraft,
  toItem,
  diffLabel,
  hasDescription,
  hasInlineRepetition,
  FIELD_GROUPS,
  type ItemDraft,
  type OccurrenceDraft,
  type FieldGroup,
} from "../../lib/item-draft";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import { showAllFields } from "../../stores/itemFormFields";
import FormSectionDescription from "../ui/FormSectionDescription.vue";

const props = withDefaults(
  defineProps<{
    /** The item being edited, or null for a brand-new one. */
    source?: Item | null;
    /** Seed values for a brand-new draft, copied from an existing item ("Duplicate").
     *  Ignored once `source` is set: only meaningful while creating a new item. */
    duplicateFrom?: Item | null;
    status?: EntryStatus;
    db: Db;
    filters?: string[];
    /** Every known bonus id, forwarded to ItemBonuses for id-collision avoidance. */
    allBonusIds?: string[];
    tags?: string[];
    /** Every known bonus, forwarded to ItemBonuses for its pickers. */
    bonusOptions?: BonusOption[];
    allocatableIds?: string[];
  }>(),
  {
    source: null,
    duplicateFrom: null,
    status: "base",
    filters: () => [],
    allBonusIds: () => [],
    tags: () => [],
    bonusOptions: () => [],
    allocatableIds: () => [],
  },
);

const emit = defineEmits<{
  /** Emitted on every change for existing items (debounced). */
  "update:item": [payload: { item: Item; label: string }];
  /** Emitted on Save click for new items. */
  save: [payload: { item: Item }];
  delete: [];
  duplicate: [];
  revert: [];
  "save-bonus": [payload: { id: string; bonus: Bonus }];
  "delete-bonus": [id: string];
  "update-bonus": [payload: { id: string; bonus: Bonus }];
  "open-item": [itemId: string];
  "tooltip-import": [];
}>();

// --- Common ---------------------------------------------------------------------------

function computeId(local: ItemDraft): string {
  return local.name.trim()
    ? catalog.nextId(
        local.name.trim(),
        props.allocatableIds.length
          ? props.allocatableIds
          : props.db.items.map((i) => i.id),
        "item",
      )
    : "";
}

/** The class vocabulary these checkboxes offer: every distinct value the catalog publishes
 * at `class`, labeled by the item that publishes it. A class param's options are still
 * honored as a fallback, so an overlay declaring the older param-based shape keeps working.
 * Blank values are dropped either way; "no class at all" is not a restriction. */
const classSlot = computed(() => findParamSlot(props.db.slots, "class"));
/** A tag is its own label. */
const tagOptions = computed(() =>
  props.tags.map((tag) => ({ value: tag, label: tag })),
);
/** `replacedBy` candidates. This item is left out: a self-reference is a lint error. */
const replacementOptions = computed(() => [
  { value: "", label: "- not replaced -" },
  ...props.db.items
    .filter((item) => item.id !== props.source?.id)
    .map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]);

const classes = computed(() => {
  const byValue = new Map<string, string>();
  for (const option of classSlot.value?.options ?? []) {
    if (option.value) byValue.set(option.value, option.label);
  }
  for (const item of props.db.items) {
    const value = item.publishes?.class;
    if (typeof value === "string" && value) byValue.set(value, item.name);
  }
  return [...byValue].map(([value, label]) => ({ value, label }));
});

// Off the composed catalog, so a layer-authored param can be seeded by `defaultParams`
// exactly like a shipped one.
const buildParamSlots = computed(() =>
  props.db.slots.filter(
    (slot): slot is BuildParameterSlot => slot.type === "build_parameter",
  ),
);
const defaultParamSlotOptions = computed(() =>
  buildParamSlots.value.map((slot) => ({
    value: slot.id,
    label: slot.label,
  })),
);
function slotForDefaultParam(slotId: string): BuildParameterSlot | undefined {
  return buildParamSlots.value.find((slot) => slot.id === slotId);
}

/** What a blank field resolves to: the filter's own default, or unlimited. */
const maxCopiesHint = computed(() => {
  const fallback =
    props.db.filterDefaults[draft.value.filter.trim()]?.maxCopies;
  return fallback === undefined ? "unlimited" : `${fallback} for this filter`;
});

/** The id `toItem` writes: the source's own once one exists, otherwise whatever `computeId`
 *  works out from the draft's current name. */
function itemId(local: ItemDraft): string {
  return props.source?.id ?? computeId(local);
}

function save() {
  error.value = "";
  const item = toItem(draft.value, { id: itemId(draft.value) });
  if (!item.name) {
    error.value = "The item needs a name.";
    return;
  }
  if (!item.filter) {
    error.value = "The item needs a filter, or no slot can hold it.";
    return;
  }
  emit("save", { item });
}

/** Merge item-shaped values, currently the ones read off a tooltip screenshot, into the
 *  open draft. Imperative rather than a prop: the tooltip window is a sibling of this form, and
 *  routing its values through the layer overlay would reach a saved item but never an unsaved
 *  new draft, which is exactly the state the screenshot flow starts from. The draft watcher
 *  takes it from here, so the merge debounces out as an ordinary edit and joins undo like one.
 *
 *  The name and stats overwrite what is there: taking the screenshot's value is the point.
 *  `gameIds` appends instead, since one item legitimately carries several. */
function applyPatch(patch: Partial<Item>) {
  const statKeys = new Set<string>(NW_SCHEMA.statKeys);
  for (const [key, value] of Object.entries(patch)) {
    if (key === "name") {
      draft.value.name = String(value);
    } else if (key === "gameIds") {
      const added = (value as string[]).filter(
        (id) => !draft.value.gameIds.includes(id),
      );
      if (added.length)
        draft.value.gameIds = [...draft.value.gameIds, ...added];
    } else if (statKeys.has(key)) {
      const row = draft.value.stats.find((stat) => stat.key === key);
      if (row) row.value = value as number;
      else draft.value.stats.push({ key, value: value as number });
    }
  }
}

defineExpose({ applyPatch });

function addStat() {
  draft.value.stats.push({ key: "", value: 0 });
}
function removeStat(index: number) {
  draft.value.stats.splice(index, 1);
}

const shapeOptions = INSIGNIA_SHAPES.map((shape) => ({
  value: shape,
  label: shape,
}));

/** The empty row is "universal", so a slot cannot be both universal and shaped. */
const slotShapeOptions = [{ value: "", label: "universal" }, ...shapeOptions];

/** A universal slot's preference. A fixed slot grants no preferred bonus. */
const preferredOptions = [
  { value: "", label: "- no preference -" },
  ...shapeOptions,
];

const recipeOptions = [
  { value: "", label: "- pick a shape -" },
  ...shapeOptions,
];

/** Insignia that do not themselves declare a pairing, narrowed to this item's shape once one
 *  is chosen. A pairing across shapes is an authoring error `validate` rejects. */
const preferredVariantOptions = computed(() => [
  { value: "", label: "- no preferred item -" },
  ...props.db.items
    .filter(
      (item) =>
        item.insigniaShape &&
        !item.preferredVariant &&
        item.id !== props.source?.id &&
        (!draft.value.insigniaShape ||
          item.insigniaShape === draft.value.insigniaShape),
    )
    .map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]);

function addInsigniaSlot() {
  draft.value.insigniaSlots.push({ shape: "", preferred: "" });
}

function removeInsigniaSlot(index: number) {
  draft.value.insigniaSlots.splice(index, 1);
}

function addRecipeShape() {
  draft.value.insigniaRecipe.push("");
}

function removeRecipeShape(index: number) {
  draft.value.insigniaRecipe.splice(index, 1);
}

function addReplacedByValue() {
  draft.value.replacedByValues.push({ stat: "", value: null });
}

function removeReplacedByValue(index: number) {
  draft.value.replacedByValues.splice(index, 1);
}

function addDynamicStat() {
  draft.value.dynamicStats.push({
    stat: "",
    min: null,
    max: null,
    default: null,
    label: "",
  });
}
function removeDynamicStat(index: number) {
  draft.value.dynamicStats.splice(index, 1);
}

function addPublishes() {
  draft.value.publishes.push({ path: "", value: "" });
}
function removePublishes(index: number) {
  draft.value.publishes.splice(index, 1);
}

function addDefaultParam() {
  draft.value.defaultParams.push({ slotId: "", value: "" });
}
function removeDefaultParam(index: number) {
  draft.value.defaultParams.splice(index, 1);
}

// Description and inline repetition are single field groups rather than arrays, so
// "added"/"removed" is tracked as its own flag instead of splicing a list (`hasDescription`/
// `hasInlineRepetition`, from item-draft.ts). Both start active whenever the source item
// already carries values for them. Dynamic stats, like Stats below, are a plain repeatable
// list instead, no separate group toggle.

// Built separately from `useEditorDraft`'s own draft below rather than read off it: these
// flags need a value before that call exists, and `onRebuild` keeps them in sync afterward.
const initialDraft = buildDraft(props.source ?? props.duplicateFrom);
const descriptionActive = ref(hasDescription(initialDraft));
const repetitionActive = ref(hasInlineRepetition(initialDraft));

// Existing items: live edits. New items: draft until Save.
const isNew = computed(() => !props.source);

const { draft, error, dirty, displayId } = useEditorDraft<
  Item,
  ItemDraft,
  Item
>({
  source: () => props.source,
  isNew,
  buildDraft: (source) => buildDraft(source ?? props.duplicateFrom),
  toEntity: (local) => toItem(local, { id: itemId(local) }),
  diffLabel,
  hasContent: (d) => Boolean(d.name || d.filter || d.stats.length),
  emit: (item, label) => emit("update:item", { item, label }),
  displayId: {
    sourceId: () => props.source?.id,
    computeId,
  },
  onRebuild: (d) => {
    descriptionActive.value = hasDescription(d);
    repetitionActive.value = hasInlineRepetition(d);
  },
});

// Draft undo/redo (new-item history) replaces `draft.value` wholesale, bypassing the
// add/remove handlers below, so resurface the group automatically whenever its fields come
// back populated so a redo of "add" doesn't leave the fields hidden behind a stale flag.
// Never flips a flag to false itself; only the explicit remove handlers do that.
watch(
  () => [draft.value.shortDescription, draft.value.longDescription],
  () => {
    if (hasDescription(draft.value)) descriptionActive.value = true;
  },
);
watch(
  () => [
    draft.value.repetitionMin,
    draft.value.repetitionMax,
    draft.value.repetitionDefault,
    draft.value.repetitionPriority,
  ],
  () => {
    if (hasInlineRepetition(draft.value)) repetitionActive.value = true;
  },
);

function addDescription() {
  descriptionActive.value = true;
}
function removeDescription() {
  draft.value.shortDescription = "";
  draft.value.longDescription = "";
  descriptionActive.value = false;
}

function addInlineRepetition() {
  repetitionActive.value = true;
}
function removeInlineRepetition() {
  draft.value.repetitionMin = null;
  draft.value.repetitionMax = null;
  draft.value.repetitionDefault = null;
  draft.value.repetitionPriority = null;
  draft.value.repetitionLabel = "";
  repetitionActive.value = false;
}

function attachBonus(id: string) {
  if (draft.value.bonuses.includes(id)) return;
  draft.value.bonuses = [...draft.value.bonuses, id];
}

function detachBonus(id: string) {
  draft.value.bonuses = draft.value.bonuses.filter(
    (bonusId: string) => bonusId !== id,
  );
  if (id in draft.value.bonusOccurrences) {
    const { [id]: _removed, ...rest } = draft.value.bonusOccurrences;
    draft.value.bonusOccurrences = rest;
  }
}

/** Toggle or edit one attached bonus's occurrence config: `occurrence: null` drops it back
 *  to a plain-id attachment (always 1 occurrence), mirroring `removeInlineRepetition`'s
 *  clear-back-to-unset behavior. */
function updateBonusOccurrence(id: string, occurrence: OccurrenceDraft | null) {
  if (occurrence) {
    draft.value.bonusOccurrences = {
      ...draft.value.bonusOccurrences,
      [id]: occurrence,
    };
  } else if (id in draft.value.bonusOccurrences) {
    const { [id]: _removed, ...rest } = draft.value.bonusOccurrences;
    draft.value.bonusOccurrences = rest;
  }
}

// --- which field groups this item is offered ---------------------------------------------
// `filterFields` in data/slots.json says which fields each filter is authored with. Data
// rather than a constant here, so a layer can declare its own item category with no code edit.
// `FIELD_GROUPS` itself (which item fields each group edits) lives in item-draft.ts, since it
// carries no reactive state of its own; what stays here is the gating logic that reads it
// against props/draft.

/** Fields some filter claims; a field outside this set is offered everywhere. */
const gatedFields = computed(() => {
  const gated = new Set<string>();
  for (const fields of Object.values(props.db.filterFields))
    for (const field of fields) gated.add(field);
  return gated;
});

const claimedFields = computed(
  () => new Set<string>(props.db.filterFields[draft.value.filter.trim()] ?? []),
);

/** Read off the draft, not `props.source`, so a value typed a moment ago counts too. */
function carriesField(field: string): boolean {
  const local = draft.value;
  switch (field) {
    case "tags":
      return local.tags.length > 0;
    case "gameIds":
      return local.gameIds.length > 0;
    case "shortDescription":
    case "longDescription":
      return descriptionActive.value;
    case "allowedClass":
      return local.allowedClass.length > 0;
    case "inlineRepetition":
      return repetitionActive.value;
    case "insigniaShape":
      return local.insigniaShape !== "";
    case "preferredVariant":
      return local.preferredVariant !== "";
    case "insigniaSlots":
      return local.insigniaSlots.length > 0;
    case "insigniaRecipe":
      return local.insigniaRecipe.length > 0;
    case "dynamicStats":
      return local.dynamicStats.length > 0;
    case "bonuses":
      return local.bonuses.length > 0;
    case "defaultParams":
      return local.defaultParams.length > 0;
    case "publishes":
      return local.publishes.length > 0;
    case "hideFromPicker":
      return local.hideFromPicker;
    case "replacedBy":
      return local.replacedBy !== "";
    default:
      return false;
  }
}

/** The `carriesField` arm is what keeps a mis-authored `filterFields` from hiding data. */
function showsGroup(group: FieldGroup): boolean {
  if (showAllFields.value) return true;
  const fields: readonly string[] = FIELD_GROUPS[group];
  if (!fields.some((field) => gatedFields.value.has(field))) return true;
  return fields.some(
    (field) => claimedFields.value.has(field) || carriesField(field),
  );
}
</script>

<template>
  <div>
    <DraftFormBar
      noun="item"
      :title="draft.name || 'New item'"
      :status="status"
      :dirty="dirty"
      :is-new="isNew"
      :has-source="Boolean(source)"
      can-duplicate
      :error="error"
      duplicate-testid="duplicate-item"
      @save="save"
      @revert="$emit('revert')"
      @duplicate="$emit('duplicate')"
      @delete="$emit('delete')"
    >
      <template #before-actions>
        <BaseCheckbox
          v-model="showAllFields"
          inline
          data-testid="show-all-fields"
        >
          Show all fields
        </BaseCheckbox>
      </template>
      <template #extra-actions>
        <IconButton
          class="text-[16px]"
          title="From screenshot"
          data-testid="tooltip-import-toggle"
          @click="$emit('tooltip-import')"
          ><ScanText
        /></IconButton>
      </template>
    </DraftFormBar>

    <FormSection>Identification</FormSection>
    <FormGrid class="mb-2">
      <FormField label="Name">
        <BaseInput
          v-model="draft.name"
          class="w-full"
          type="text"
          data-testid="item-name-input"
        />
      </FormField>
      <IdField :id="displayId" label="Id" :existing="Boolean(source)" />
      <FormField label="Filter (category)">
        <CreatableComboBox
          v-model="draft.filter"
          :options="filters"
          testid="item-filter-input"
        />
      </FormField>
      <FormField label="Max copies (0 = unlimited)">
        <BaseInput
          v-model.number="draft.maxCopies"
          :placeholder="maxCopiesHint"
          class="w-full"
          data-testid="item-max-copies"
          type="number"
          min="0"
        />
      </FormField>
    </FormGrid>

    <datalist id="nw-tags">
      <option v-for="t in tags" :key="t" :value="t"></option>
    </datalist>

    <FormGrid v-if="showsGroup('tags')" class="mb-2" data-testid="group-tags">
      <FormField label="Tags" class="min-w-80 flex-1">
        <TokenInput
          v-model="draft.tags"
          :options="tagOptions"
          placeholder="Add a tag…"
          data-testid="item-tags-input"
        />
      </FormField>
    </FormGrid>

    <FormGrid
      v-if="showsGroup('gameIds')"
      class="mb-2"
      data-testid="group-game-ids"
    >
      <FormField label="Internal game IDs" class="min-w-80 flex-1">
        <TokenInput
          v-model="draft.gameIds"
          placeholder="Add an ID..."
          data-testid="item-gameids-input"
        />
      </FormField>
    </FormGrid>

    <template v-if="showsGroup('description')">
      <FormSection data-testid="group-description">Description</FormSection>
      <div class="flex flex-wrap items-center gap-1.5 mb-2">
        <IconButton
          v-if="!descriptionActive"
          title="Add description"
          data-testid="add-item-description"
          @click="addDescription"
          ><Plus
        /></IconButton>
        <IconButton
          v-else
          title="Remove description"
          data-testid="remove-item-description"
          @click="removeDescription"
          ><Trash
        /></IconButton>
        <FormGrid
          v-if="descriptionActive"
          data-testid="item-description-fields"
        >
          <FormField
            label="Short description, shown in the stat summary"
            class="min-w-80 flex-1"
          >
            <OcrTextField
              v-model="draft.shortDescription"
              single-line
              :rows="2"
              data-testid="item-short-description-input"
            />
          </FormField>
          <FormField
            label="Long description, shown in the hover card"
            class="min-w-80 flex-1"
          >
            <OcrTextField
              v-model="draft.longDescription"
              :rows="2"
              data-testid="item-long-description-input"
            />
          </FormField>
        </FormGrid>
      </div>
    </template>

    <template v-if="showsGroup('allowedClass')">
      <FormSection data-testid="group-allowed-class"
        >Class restrictions</FormSection
      >
      <div class="mb-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        <BaseCheckbox
          v-for="cls in classes"
          :key="cls.value"
          v-model="draft.allowedClass"
          :value="cls.value"
        >
          {{ cls.label }}
        </BaseCheckbox>
      </div>
    </template>

    <template v-if="showsGroup('inlineRepetition')">
      <FormSection data-testid="group-inline-repetition"
        >Inline repetition</FormSection
      >
      <FormSectionDescription
        >For boons, leveling attribute scores, and other point assignment
        slots.</FormSectionDescription
      >
      <div class="flex flex-wrap items-center gap-1.5 mb-2">
        <IconButton
          v-if="!repetitionActive"
          title="Add inline repetition"
          data-testid="add-inline-repetition"
          @click="addInlineRepetition"
          ><Plus
        /></IconButton>
        <IconButton
          v-else
          title="Remove inline repetition"
          data-testid="remove-inline-repetition"
          @click="removeInlineRepetition"
          ><Trash
        /></IconButton>
        <FormGrid
          v-if="repetitionActive"
          data-testid="inline-repetition-fields"
        >
          <FormField label="Min">
            <BaseInput
              v-model.number="draft.repetitionMin"
              class="w-full"
              type="number"
            />
          </FormField>
          <FormField label="Max">
            <BaseInput
              v-model.number="draft.repetitionMax"
              class="w-full"
              type="number"
            />
          </FormField>
          <FormField label="Default">
            <BaseInput
              v-model.number="draft.repetitionDefault"
              class="w-full"
              type="number"
            />
          </FormField>
          <FormField label="Priority">
            <BaseInput
              v-model.number="draft.repetitionPriority"
              class="w-full"
              type="number"
            />
          </FormField>
          <FormField label="Label (optional)">
            <BaseInput
              v-model="draft.repetitionLabel"
              class="w-40"
              type="text"
              data-testid="inline-repetition-label-input"
            />
          </FormField>
        </FormGrid>
      </div>
    </template>

    <template v-if="showsGroup('insignia')">
      <FormSection data-testid="group-insignia">Insignia</FormSection>
      <div class="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <FormField label="Insignia shape">
          <ComboBox
            class="w-44"
            data-testid="item-insignia-shape"
            :options="recipeOptions"
            :model-value="draft.insigniaShape"
            @update:model-value="(v) => (draft.insigniaShape = v)"
          />
        </FormField>
        <FormField label="Preferred version">
          <ComboBox
            class="w-80"
            data-testid="item-preferred-variant"
            :options="preferredVariantOptions"
            :model-value="draft.preferredVariant"
            @update:model-value="(v) => (draft.preferredVariant = v)"
          />
        </FormField>
      </div>
    </template>

    <template v-if="showsGroup('insigniaSlots')">
      <FormSection data-testid="group-insignia-slots"
        >Insignia slots</FormSection
      >

      <RepeatableRows
        :rows="draft.insigniaSlots"
        row-class="insignia-slot-row mb-1 flex flex-wrap items-center gap-1.5"
        add-label="Add insignia slot"
        remove-label="Remove insignia slot"
        add-testid="item-add-insignia-slot"
        @add="addInsigniaSlot"
        @remove="removeInsigniaSlot"
      >
        <template #row="{ row, index }">
          <FormField :label="`Slot ${index + 1} shape`">
            <ComboBox
              class="w-44"
              :data-testid="`item-insignia-slot-${index}`"
              :options="slotShapeOptions"
              :model-value="row.shape"
              @update:model-value="(v) => (row.shape = v)"
            />
          </FormField>
          <FormField v-if="!row.shape || row.preferred" label="Prefers">
            <ComboBox
              class="w-44"
              :data-testid="`item-insignia-slot-preferred-${index}`"
              :options="preferredOptions"
              :model-value="row.preferred"
              @update:model-value="(v) => (row.preferred = v)"
            />
          </FormField>
          <span v-if="row.shape && row.preferred" class="text-danger">
            A fixed slot cannot grant a preferred bonus.
          </span>
        </template>
      </RepeatableRows>
    </template>

    <template v-if="showsGroup('insigniaRecipe')">
      <FormSection data-testid="group-insignia-recipe"
        >Insignia bonus</FormSection
      >
      <RepeatableRows
        :rows="draft.insigniaRecipe"
        row-class="insignia-recipe-row mb-1 flex flex-wrap items-center gap-1.5"
        add-label="Add recipe shape"
        remove-label="Remove recipe shape"
        add-testid="item-add-recipe-shape"
        @add="addRecipeShape"
        @remove="removeRecipeShape"
      >
        <template #row="{ row: shape, index }">
          <FormField :label="`Recipe shape ${index + 1}`">
            <ComboBox
              class="w-44"
              :data-testid="`item-insignia-recipe-${index}`"
              :options="recipeOptions"
              :model-value="shape"
              @update:model-value="(v) => (draft.insigniaRecipe[index] = v)"
            />
          </FormField>
        </template>
        <template #empty>
          <span class="text-muted">
            Insignia shapes that define this bonus.
          </span>
        </template>
      </RepeatableRows>
    </template>

    <FormSection>Stats</FormSection>
    <StatRowList :rows="draft.stats" @add="addStat" @remove="removeStat" />

    <template v-if="showsGroup('dynamicStats')">
      <FormSection data-testid="group-dynamic-stats">Dynamic stats</FormSection>
      <DynamicStatRowList
        :rows="draft.dynamicStats"
        @add="addDynamicStat"
        @remove="removeDynamicStat"
      />
    </template>

    <template v-if="showsGroup('bonuses')">
      <ItemBonuses
        :attached-bonus-ids="draft.bonuses"
        :occurrence-configs="draft.bonusOccurrences"
        :item-name="draft.name"
        :item-id="source?.id"
        :db="db"
        :all-bonus-ids="allBonusIds"
        :tags="tags"
        :bonus-options="bonusOptions"
        :allocatable-ids="props.allocatableIds"
        @save-bonus="$emit('save-bonus', $event)"
        @delete-bonus="$emit('delete-bonus', $event)"
        @update-bonus="$emit('update-bonus', $event)"
        @detach-bonus="detachBonus"
        @attach-bonus="attachBonus"
        @update-occurrence="(e) => updateBonusOccurrence(e.id, e.occurrence)"
        @open-item="$emit('open-item', $event)"
      />
    </template>

    <template v-if="showsGroup('defaultParams')">
      <FormSection data-testid="group-default-params"
        >Default build parameters</FormSection
      >
      <FormSectionDescription>
        Applied once when this item is picked.
      </FormSectionDescription>
      <RepeatableRows
        :rows="draft.defaultParams"
        row-class="default-param-row flex flex-wrap items-center gap-1.5 mb-1"
        add-label="Add default build parameter"
        remove-label="Remove default build parameter"
        @add="addDefaultParam"
        @remove="removeDefaultParam"
      >
        <template #row="{ row }">
          <ComboBox
            class="w-52"
            :model-value="row.slotId"
            :options="defaultParamSlotOptions"
            placeholder="- pick a build parameter -"
            @update:model-value="(v) => (row.slotId = v)"
          />
          <BuildParamInput
            v-if="slotForDefaultParam(row.slotId)"
            v-model="row.value"
            :slot-def="slotForDefaultParam(row.slotId)!"
            >{{ slotForDefaultParam(row.slotId)?.label }}</BuildParamInput
          >
        </template>
      </RepeatableRows>
    </template>

    <template v-if="showsGroup('publishes')">
      <FormSection data-testid="group-publishes"
        >Published build parameters</FormSection
      >
      <FormSectionDescription>
        Applied while this item is equipped.
      </FormSectionDescription>
      <RepeatableRows
        :rows="draft.publishes"
        row-class="publishes-row flex flex-wrap items-center gap-1.5 mb-1"
        add-label="Add published value"
        remove-label="Remove published value"
        @add="addPublishes"
        @remove="removePublishes"
      >
        <template #row="{ row, index }">
          <BaseInput
            v-model="row.path"
            class="w-52"
            type="text"
            placeholder="Context path, e.g. class"
            :data-testid="`publishes-path-${index}`"
          />
          <BaseInput
            v-model="row.value"
            class="w-52"
            type="text"
            placeholder="Value"
            :data-testid="`publishes-value-${index}`"
          />
        </template>
      </RepeatableRows>
    </template>

    <template v-if="showsGroup('retirement')">
      <FormSection data-testid="group-retirement">Retirement</FormSection>
      <FormSectionDescription>
        Retired items are not offered in item pickers. <br />
        Builds using a retired item will still work, and the Build Editor will
        offer the replacement set below.
      </FormSectionDescription>
      <div class="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <BaseCheckbox
          v-model="draft.hideFromPicker"
          data-testid="item-hide-from-picker"
        >
          Retire item
        </BaseCheckbox>
        <div class="flex min-w-80 flex-1 items-center gap-1.5">
          <span class="whitespace-nowrap text-muted">Replaced by</span>
          <ComboBox
            class="min-w-0 flex-1"
            data-testid="item-replaced-by"
            :options="replacementOptions"
            :model-value="draft.replacedBy"
            @update:model-value="(v) => (draft.replacedBy = v)"
          />
        </div>
      </div>

      <template v-if="draft.replacedBy">
        <RepeatableRows
          :rows="draft.replacedByValues"
          row-class="replaced-by-value-row flex flex-wrap items-center gap-1.5 mb-1"
          add-label="Add carried value"
          remove-label="Remove carried value"
          add-testid="item-add-carried-value"
          @add="addReplacedByValue"
          @remove="removeReplacedByValue"
        >
          <template #row="{ row }">
            <FormField label="Carry stat">
              <ComboBox
                class="combo--stat w-52"
                :model-value="row.stat"
                :options="statPickerOptions"
                placeholder="- pick a stat -"
                @update:model-value="(v) => (row.stat = v)"
              />
            </FormField>
            <FormField label="Value on the replacement">
              <StatValueInput
                v-model="row.value"
                :stat-key="row.stat"
                class="w-24"
                step="any"
              />
            </FormField>
          </template>
          <template #empty>
            <span class="text-muted">
              Carry a value into the replacement's dynamic stat settings.
            </span>
          </template>
        </RepeatableRows>
      </template>
    </template>
  </div>
</template>
