<script setup lang="ts">
// Editing form for one build_parameter slot. Same hybrid lifecycle as ItemForm/BonusForm/
// PresetForm: an existing slot live-edits on every change, a brand-new one is a draft until
// Save.
//
// Deliberately narrow (issue #271): `build_parameter` only, appended to an existing section.
// The other four `Slot` variants carry layout structure -- section membership, ordering,
// separators -- that an overlay's flat id->value map cannot express, so they stay base-only
// and never reach this form.
//
// Fields this form does not offer are carried through verbatim rather than dropped:
// `visibleWhen` is the one that exists today, and editing a shipped param's label must not
// silently un-scope it. `passthrough` below is what keeps that true for anything added later.
import { ref, computed, watch } from "vue";
import { Plus, Save, Trash, Undo2 } from "@lucide/vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import FormBar from "../ui/FormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import FormSection from "../ui/FormSection.vue";
import IdField from "../ui/IdField.vue";
import * as catalog from "../../data/catalog";
import { deepEqual } from "../../lib/deep-equal";
import { useDraftHistory } from "../../composables/useDraftHistory";
import { resolvedOptions } from "../../lib/param-options";
import type { BuildParameterSlot, Db, Slot } from "../../types";

const props = withDefaults(
  defineProps<{
    /** The slot being edited, or null for a brand-new one. */
    source?: BuildParameterSlot | null;
    status?: string;
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
  /** Held loosely in the draft -- `toSlot` casts back per `paramType`, so switching type
   *  mid-edit can't leave a number sitting in a boolean's `default`. `string | number`
   *  rather than `string` because Vue's `v-model` casts to a number by itself on an
   *  `<input type="number">`, so these fields start as strings and become numbers as soon
   *  as they are typed into. */
  default: string | number;
  /** Which way the option set is authored. A three-way choice rather than two independent
   *  fields so `options` XOR `optionsFrom`, and `filter` XOR `tags` within it, are structurally
   *  impossible to violate from this form -- `validateSlots` still enforces both for data
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

const isNew = computed(() => !props.source);
const draft = ref<SlotDraft>(buildDraft(props.source));
const error = ref("");

const numeric = computed(
  () =>
    draft.value.paramType === "number" || draft.value.paramType === "percent",
);

const displayId = computed(
  () =>
    props.source?.id ??
    (draft.value.label.trim()
      ? catalog.nextSlotId(
          draft.value.section,
          draft.value.label.trim(),
          props.allocatableIds,
        )
      : ""),
);

const number = (raw: string | number) => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const value = Number(raw);
  return raw.trim() !== "" && Number.isFinite(value) ? value : undefined;
};

function toSlot(): BuildParameterSlot {
  const slot: BuildParameterSlot = {
    ...passthrough.value,
    id: displayId.value,
    label: draft.value.label.trim(),
    section: draft.value.section,
    type: "build_parameter",
    paramType: draft.value.paramType,
    path: draft.value.path.trim(),
  };
  if (draft.value.quick) slot.quick = true;

  // `default` is typed by `paramType`, not by what the text field happens to hold: a boolean
  // param storing the string "true" would compare unequal to `true` everywhere downstream.
  if (draft.value.paramType === "boolean") {
    slot.default = String(draft.value.default) === "true";
  } else if (numeric.value) {
    const fallback = number(draft.value.default);
    if (fallback !== undefined) slot.default = fallback;
    const min = number(draft.value.min);
    const max = number(draft.value.max);
    const step = number(draft.value.step);
    if (min !== undefined) slot.min = min;
    if (max !== undefined) slot.max = max;
    if (step !== undefined) slot.step = step;
    const presets = draft.value.presets
      .split(",")
      .map((part) => number(part))
      .filter((value): value is number => value !== undefined);
    if (presets.length) slot.presets = presets;
  } else {
    slot.default = String(draft.value.default);
    if (draft.value.optionsSource === "inline") {
      const options = draft.value.options
        .filter((row) => row.label.trim())
        .map((row) => ({
          value: row.value,
          label: row.label.trim(),
        }));
      if (options.length) slot.options = options;
    } else {
      slot.optionsFrom =
        draft.value.optionsSource === "tags"
          ? {
              tags: draft.value.optionsFromTags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            }
          : { filter: draft.value.optionsFromFilter.trim() };
      if (draft.value.allowEmpty) slot.allowEmpty = true;
    }
  }
  return slot;
}

let lastEmittedJson = JSON.stringify(props.source ? toSlot() : draft.value);

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
    // JSON parse error -- shouldn't happen but be safe.
  }
  return "edit parameter";
}

function emitChange() {
  if (
    !draft.value.label.trim() ||
    !draft.value.section ||
    !draft.value.path.trim()
  )
    return;
  // A path collision is never worth persisting: the two slots would silently share one value.
  if (pathConflict.value) return;
  const slot = toSlot();
  const currentJson = JSON.stringify(slot);
  if (currentJson === lastEmittedJson) return;
  const changeLabel = diffLabel(lastEmittedJson, currentJson);
  lastEmittedJson = currentJson;
  emit("update:slot", { slot, label: changeLabel });
}

const { resetDraftHistory } = useDraftHistory({
  draft,
  isNew,
  diffLabel,
  onEmit: emitChange,
});

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

/** How many items the current `optionsFrom` selector actually matches -- authoring a derived
 * option set with a typo'd tag otherwise looks identical to one with no matching items yet. */
const derivedPreview = computed(() => {
  if (draft.value.optionsSource === "inline") return null;
  const preview = resolvedOptions(toSlot(), props.db.items) ?? [];
  return preview;
});

/** The other slot already sitting on this `path`, if any. Two slots sharing a path silently
 * fight over one value in `context`, so this blocks the save outright rather than leaving it
 * to the lint drawer to report after the damage is saved. */
const pathConflict = computed(() => {
  const path = draft.value.path.trim();
  if (!path) return null;
  const clash = props.db.slots.find(
    (slot) =>
      slot.type === "build_parameter" &&
      slot.path === path &&
      slot.id !== displayId.value,
  );
  return clash ? clash.id : null;
});

function addOption() {
  draft.value.options.push({ value: "", label: "" });
}
function removeOption(index: number) {
  draft.value.options.splice(index, 1);
}

const dirty = computed(() => {
  if (!props.source) return Boolean(draft.value.label || draft.value.path);
  return !deepEqual(toSlot(), props.source as Slot);
});

defineExpose({ draft, dirty });

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
    error.value = `Path "${draft.value.path.trim()}" is already used by ${pathConflict.value} — the two would silently share one value.`;
    return;
  }
  emit("save", { slot: toSlot() });
}

watch(
  () => props.source,
  (value) => {
    // Same round-trip-echo guard the other forms use: a live edit's own update:slot comes
    // back through the layer overlay as a new `source`, and rebuilding from that echo would
    // wipe a half-typed field.
    if (value && lastEmittedJson && JSON.stringify(value) === lastEmittedJson)
      return;
    draft.value = buildDraft(value);
    error.value = "";
    lastEmittedJson = value
      ? JSON.stringify(toSlot())
      : JSON.stringify(draft.value);
    resetDraftHistory();
  },
);
</script>

<template>
  <div>
    <FormBar class="-mx-3 mb-3" data-testid="form-bar">
      <strong>{{ draft.label || "New parameter" }}</strong>
      <BaseBadge v-if="status !== 'base'" :variant="status as any">{{
        status
      }}</BaseBadge>
      <BaseBadge v-if="dirty && isNew">unsaved</BaseBadge>
      <span class="flex-1"></span>
      <BaseButton
        v-if="isNew"
        variant="primary"
        :disabled="!dirty"
        data-testid="save-slot"
        @click="save"
        ><Save />Save parameter</BaseButton
      >
      <BaseButton v-if="status === 'edited'" @click="$emit('revert')"
        ><Undo2 />Revert to shipped</BaseButton
      >
      <BaseButton
        v-if="source"
        data-testid="delete-slot"
        @click="$emit('delete')"
        ><Trash />Delete</BaseButton
      >
    </FormBar>

    <p v-if="error" class="mt-1 text-danger" data-testid="slot-error">
      {{ error }}
    </p>

    <FormGrid class="mb-2">
      <FormField label="Label">
        <input
          v-model="draft.label"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
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
        <input
          v-model="draft.path"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
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
      Path "{{ draft.path.trim() }}" is already used by {{ pathConflict }} — the
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
        <input
          v-else
          v-model="draft.default"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          :type="numeric ? 'number' : 'text'"
          data-testid="slot-default-input"
        />
      </FormField>
      <template v-if="numeric">
        <FormField label="Min" class="w-24">
          <input
            v-model="draft.min"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="number"
            data-testid="slot-min-input"
          />
        </FormField>
        <FormField label="Max" class="w-24">
          <input
            v-model="draft.max"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="number"
            data-testid="slot-max-input"
          />
        </FormField>
        <FormField label="Step" class="w-24">
          <input
            v-model="draft.step"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="number"
            data-testid="slot-step-input"
          />
        </FormField>
        <FormField label="Presets" hint="comma-separated">
          <input
            v-model="draft.presets"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
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
          <input
            v-model="draft.optionsFromTags"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
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
          <input
            v-model="draft.optionsFromFilter"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="text"
            data-testid="slot-options-filter-input"
          />
        </FormField>
        <FormField v-if="draft.optionsSource !== 'inline'" label="Empty row">
          <BaseCheckbox
            v-model="draft.allowEmpty"
            data-testid="slot-allow-empty-input"
          >
            offer “— none —”
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
          <input
            v-model="row.label"
            class="w-40 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="text"
            placeholder="Label"
            :data-testid="`slot-option-label-${index}`"
          />
          <input
            v-model="row.value"
            class="w-40 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="text"
            placeholder="Value"
            :data-testid="`slot-option-value-${index}`"
          />
        </div>
      </template>
    </template>
  </div>
</template>
