<script setup lang="ts">
// Editing form for one build_parameter slot. Same hybrid lifecycle as ItemForm/BonusForm/
// PresetForm: an existing slot live-edits on every change, a brand-new one is a draft until
// Save. The draft shape and its `BuildParameterSlot` conversion live in lib/slot-draft.ts, the
// same pattern the other three forms' draft mapping follows now (see bonus-draft.ts's header
// comment); this file owns markup and wiring only.
//
// Deliberately narrow: `build_parameter` only, appended to an existing section.
// The other four `Slot` variants carry layout structure (section membership, ordering,
// separators) that an overlay's flat id->value map cannot express, so they stay base-only
// and never reach this form.
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
import {
  buildDraft,
  passthroughOf,
  toSlot,
  diffLabel,
  isNumeric,
  findPathConflict,
  type SlotDraft,
} from "../../lib/slot-draft";
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

function computeId(local: SlotDraft): string {
  return local.label.trim()
    ? catalog.nextSlotId(
        local.section,
        local.label.trim(),
        props.allocatableIds,
      )
    : "";
}

/** The id `toSlot` writes: the source's own once one exists, otherwise whatever `computeId`
 *  works out from the draft's current label. */
function slotId(local: SlotDraft): string {
  return props.source?.id ?? computeId(local);
}

/** Fields the form does not edit, kept aside and re-attached by `toSlot`; updated alongside
 *  the draft (initial build and every `props.source` rebuild) rather than derived from it,
 *  since `SlotDraft` itself is what `useEditorDraft` diffs/undoes and has no room for it. */
const passthrough = ref<Partial<BuildParameterSlot>>(
  passthroughOf(props.source),
);

const numeric = computed(() => isNumeric(draft.value.paramType));

const isNew = computed(() => !props.source);

const { draft, error, dirty, displayId } = useEditorDraft<
  BuildParameterSlot,
  SlotDraft,
  BuildParameterSlot
>({
  source: () => props.source,
  isNew,
  buildDraft: (source) => {
    passthrough.value = passthroughOf(source);
    return buildDraft(source);
  },
  toEntity: (local) =>
    toSlot(local, { id: slotId(local), passthrough: passthrough.value }),
  diffLabel,
  hasContent: (d) => Boolean(d.label || d.path),
  // A path collision is never worth persisting: the two slots would silently share one value.
  canEmit: (d) =>
    Boolean(d.label.trim() && d.section && d.path.trim()) &&
    !findPathConflict(d, props.db, slotId(d)),
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
  const slot = toSlot(draft.value, {
    id: slotId(draft.value),
    passthrough: passthrough.value,
  });
  return resolvedOptions(slot, props.db.items) ?? [];
});

const pathConflict = computed(() =>
  findPathConflict(draft.value, props.db, slotId(draft.value)),
);

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
  emit("save", {
    slot: toSlot(draft.value, {
      id: slotId(draft.value),
      passthrough: passthrough.value,
    }),
  });
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
