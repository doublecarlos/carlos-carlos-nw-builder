<script setup lang="ts">
// Editing form for one build_parameter slot. Same hybrid lifecycle as ItemForm/BonusForm/
// PresetForm: an existing slot live-edits on every change, a brand-new one is a draft until
// Save.
//
// Deliberately narrow: `build_parameter` only, appended to an existing section.
// The other four `Slot` variants carry layout structure (section membership, ordering,
// separators) that an overlay's flat id->value map cannot express, so they stay base-only
// and never reach this form.
//
// Fields this form does not offer are carried through verbatim rather than dropped:
// `visibleWhen` is the one that exists today, and editing a shipped param's label must not
// silently un-scope it. `passthrough` below is what keeps that true for anything added later.
import { ref, computed } from "vue";
import { Plus, Trash } from "@lucide/vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import DraftFormBar from "../ui/DraftFormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import FormSection from "../ui/FormSection.vue";
import IdField from "../ui/IdField.vue";
import * as catalog from "../../data/catalog";
import { useEditorDraft } from "../../composables/useEditorDraft";
import { resolvedOptions } from "../../lib/param-options";
import type { BuildParameterSlot, Db } from "../../types";
import type { EntryStatus } from "../../data/catalog";

const props = withDefaults(
  defineProps<{
    /** The slot being edited, or null for a brand-new one. */
    source?: BuildParameterSlot | null;
    status?: EntryStatus;
    db: Db;
    /** Every id already in use anywhere, so a new slot's generated id can't collide. */
    allocatableIds?: string[];
  }>(),
  {
    source: null,
    status: "base",
    allocatableIds: () => [],
  },
);

const emit = defineEmits<{
  "update:slot": [payload: { slot: BuildParameterSlot; label: string }];
  save: [payload: { slot: BuildParameterSlot }];
  delete: [];
  revert: [];
}>();

interface OptionRow {
  value: string;
  label: string;
}

interface SlotDraft {
  label: string;
  section: string;
  paramType: BuildParameterSlot["paramType"];
  path: string;
  quick: boolean;
  /** Held loosely in the draft: `toSlot` casts back per `paramType`, so switching type
   *  mid-edit can't leave a number sitting in a boolean's `default`. `string | number`
   *  rather than `string` because Vue's `v-model` casts to a number by itself on an
   *  `<input type="number">`, so these fields start as strings and become numbers as soon
   *  as they are typed into. */
  default: string | number;
  /** Which way the option set is authored. A three-way choice rather than two independent
   *  fields so `options` XOR `optionsFrom`, and `filter` XOR `tags` within it, are structurally
   *  impossible to violate from this form; `validateSlots` still enforces both for data
   *  arriving from a file. */
  optionsSource: "inline" | "tags" | "filter";
  options: OptionRow[];
  optionsFromTags: string;
  optionsFromFilter: string;
  allowEmpty: boolean;
  min: string | number;
  max: string | number;
  step: string | number;
  presets: string;
}

/** Fields the form does not edit, kept aside and re-attached by `toSlot`. */
const passthrough = ref<Partial<BuildParameterSlot>>({});

function buildDraft(slot: BuildParameterSlot | null | undefined): SlotDraft {
  const {
    id: _id,
    label,
    section,
    type: _type,
    paramType,
    path,
    quick,
    default: fallback,
    options,
    min,
    max,
    step,
    presets,
    optionsFrom,
    allowEmpty,
    ...rest
  } = slot ?? ({} as Partial<BuildParameterSlot>);
  passthrough.value = rest;
  return {
    label: label ?? "",
    section: section ?? "",
    paramType: paramType ?? "number",
    path: path ?? "",
    quick: quick ?? false,
    default: fallback == null ? "" : String(fallback),
    optionsSource: optionsFrom
      ? optionsFrom.tags?.length
        ? "tags"
        : "filter"
      : "inline",
    options: (options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
    })),
    optionsFromTags: (optionsFrom?.tags ?? []).join(", "),
    optionsFromFilter: optionsFrom?.filter ?? "",
    allowEmpty: allowEmpty ?? false,
    min: min == null ? "" : String(min),
    max: max == null ? "" : String(max),
    step: step == null ? "" : String(step),
    presets: (presets ?? []).join(", "),
  };
}

const numeric = computed(
  () =>
    draft.value.paramType === "number" || draft.value.paramType === "percent",
);

const number = (raw: string | number) => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const value = Number(raw);
  return raw.trim() !== "" && Number.isFinite(value) ? value : undefined;
};

function computeId(local: SlotDraft): string {
  return local.label.trim()
    ? catalog.nextSlotId(
        local.section,
        local.label.trim(),
        props.allocatableIds,
      )
    : "";
}

function toSlot(local: SlotDraft): BuildParameterSlot {
  const slot: BuildParameterSlot = {
    ...passthrough.value,
    id: props.source?.id ?? computeId(local),
    label: local.label.trim(),
    section: local.section,
    type: "build_parameter",
    paramType: local.paramType,
    path: local.path.trim(),
  };
  if (local.quick) slot.quick = true;

  // `default` is typed by `paramType`, not by what the text field happens to hold: a boolean
  // param storing the string "true" would compare unequal to `true` everywhere downstream.
  if (local.paramType === "boolean") {
    slot.default = String(local.default) === "true";
  } else if (numeric.value) {
    const fallback = number(local.default);
    if (fallback !== undefined) slot.default = fallback;
    const min = number(local.min);
    const max = number(local.max);
    const step = number(local.step);
    if (min !== undefined) slot.min = min;
    if (max !== undefined) slot.max = max;
    if (step !== undefined) slot.step = step;
    const presets = local.presets
      .split(",")
      .map((part) => number(part))
      .filter((value): value is number => value !== undefined);
    if (presets.length) slot.presets = presets;
  } else {
    slot.default = String(local.default);
    if (local.optionsSource === "inline") {
      const options = local.options
        .filter((row) => row.label.trim())
        .map((row) => ({
          value: row.value,
          label: row.label.trim(),
        }));
      if (options.length) slot.options = options;
    } else {
      slot.optionsFrom =
        local.optionsSource === "tags"
          ? {
              tags: local.optionsFromTags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            }
          : { filter: local.optionsFromFilter.trim() };
      if (local.allowEmpty) slot.allowEmpty = true;
    }
  }
  return slot;
}

function diffLabel(oldJson: string, newJson: string): string {
  try {
    const old = JSON.parse(oldJson);
    const nw = JSON.parse(newJson);
    if (old.label !== nw.label) return `edit label to "${nw.label}"`;
    if (old.path !== nw.path) return `edit path to "${nw.path}"`;
    if (old.paramType !== nw.paramType) return `edit type to "${nw.paramType}"`;
    if (JSON.stringify(old.options) !== JSON.stringify(nw.options))
      return "edit options";
    if (old.default !== nw.default) return "edit default";
  } catch {
    // JSON parse error, shouldn't happen but be safe.
  }
  return "edit parameter";
}

/** The other slot already sitting on this `path`, if any. Two slots sharing a path silently
 * fight over one value in `context`, so this blocks the save outright rather than leaving it
 * to the lint drawer to report after the damage is saved. */
function findPathConflict(local: SlotDraft): string | null {
  const path = local.path.trim();
  if (!path) return null;
  const clash = props.db.slots.find(
    (slot) =>
      slot.type === "build_parameter" &&
      slot.path === path &&
      slot.id !== (props.source?.id ?? computeId(local)),
  );
  return clash ? clash.id : null;
}

const isNew = computed(() => !props.source);

const { draft, error, dirty, displayId } = useEditorDraft<
  BuildParameterSlot,
  SlotDraft,
  BuildParameterSlot
>({
  source: () => props.source,
  isNew,
  buildDraft,
  toEntity: toSlot,
  diffLabel,
  hasContent: (d) => Boolean(d.label || d.path),
  // A path collision is never worth persisting: the two slots would silently share one value.
  canEmit: (d) =>
    Boolean(d.label.trim() && d.section && d.path.trim()) &&
    !findPathConflict(d),
  emit: (slot, label) => emit("update:slot", { slot, label }),
  displayId: {
    sourceId: () => props.source?.id,
    computeId,
  },
});

defineExpose({ draft, dirty });

const sectionOptions = computed(() =>
  props.db.sections.map((s) => ({ value: s.id, label: s.label })),
);

const optionsSourceOptions = [
  { value: "inline", label: "listed here" },
  { value: "tags", label: "items with tags" },
  { value: "filter", label: "items in a filter" },
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

/** Every tag any item carries, so the derived-options field can be filled from the real
 * vocabulary instead of a guess. */
const tagOptions = computed(() =>
  [...props.db.itemsByTag.keys()].sort().join(", "),
);

/** How many items the current `optionsFrom` selector actually matches: authoring a derived
 * option set with a typo'd tag otherwise looks identical to one with no matching items yet. */
const derivedPreview = computed(() => {
  if (draft.value.optionsSource === "inline") return null;
  const preview = resolvedOptions(toSlot(draft.value), props.db.items) ?? [];
  return preview;
});

const pathConflict = computed(() => findPathConflict(draft.value));

function addOption() {
  draft.value.options.push({ value: "", label: "" });
}
function removeOption(index: number) {
  draft.value.options.splice(index, 1);
}

function save() {
  error.value = "";
  if (!draft.value.label.trim()) {
    error.value = "The parameter needs a label.";
    return;
  }
  if (!draft.value.section) {
    error.value = "The parameter needs a section.";
    return;
  }
  if (!draft.value.path.trim()) {
    error.value = "The parameter needs a path into the build context.";
    return;
  }
  if (pathConflict.value) {
    error.value = `Path "${draft.value.path.trim()}" is already used by ${pathConflict.value} - the two would silently share one value.`;
    return;
  }
  emit("save", { slot: toSlot(draft.value) });
}
</script>

<template>
  <div>
    <DraftFormBar
      noun="parameter"
      :title="draft.label || 'New parameter'"
      :status="status"
      :dirty="dirty"
      :is-new="isNew"
      :has-source="Boolean(source)"
      :error="error"
      save-testid="save-slot"
      delete-testid="delete-slot"
      error-testid="slot-error"
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
          data-testid="slot-label-input"
        />
      </FormField>
      <IdField :id="displayId" label="Id" :existing="Boolean(source)" />
      <FormField label="Section" class="w-60">
        <ComboBox
          :model-value="draft.section"
          :options="sectionOptions"
          placeholder="pick a section"
          data-testid="slot-section-input"
          @update:model-value="(v) => (draft.section = v)"
        />
      </FormField>
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
      Path "{{ draft.path.trim() }}" is already used by {{ pathConflict }} - the
      two would silently share one value.
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
        {{ derivedPreview.map((o) => o.label).join(", ") || "no items match" }}
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
  </div>
</template>
