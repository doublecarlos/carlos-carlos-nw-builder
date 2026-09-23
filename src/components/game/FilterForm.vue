<script setup lang="ts">
// Editing form for one filter's metadata: the copy cap and the item field groups. An existing
// entry live-edits; a new one is a draft until Save. Draft logic lives in lib/filter-draft.ts.
//
// Also opens on a category with no declaration yet: `fixedId` names it for the first save.
import { computed } from "vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import DraftFormBar from "../ui/DraftFormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import FormSection from "../ui/FormSection.vue";
import FormSectionDescription from "../ui/FormSectionDescription.vue";
import IdField from "../ui/IdField.vue";
import * as catalog from "../../data/catalog";
import { useEditorDraft } from "../../composables/useEditorDraft";
import {
  buildDraft,
  toFilter,
  diffLabel,
  hasContent,
  FIELD_GROUP_OPTIONS,
  type FilterDraft,
} from "../../lib/filter-draft";
import type { Db, FilterDef } from "../../types";
import type { EntryStatus } from "../../data/catalog";

const props = withDefaults(
  defineProps<{
    /** The declared filter being edited, or null for a category with no declaration yet. */
    source?: FilterDef | null;
    /** The undeclared category this form adds metadata for. */
    fixedId?: string | null;
    status?: EntryStatus;
    db: Db;
    /** Every id already in use anywhere, so a new declaration's id can't collide. */
    allocatableIds?: string[];
  }>(),
  {
    source: null,
    fixedId: null,
    status: "base",
    allocatableIds: () => [],
  },
);

const emit = defineEmits<{
  "update:filter": [payload: { filter: FilterDef; label: string }];
  save: [payload: { filter: FilterDef }];
  delete: [];
  revert: [];
}>();

function computeId(local: FilterDraft): string {
  if (props.fixedId) return props.fixedId;
  return local.name.trim()
    ? catalog.nextFilterId(local.name.trim(), props.allocatableIds)
    : "";
}

/** The id `toFilter` writes: the declaration's, else `fixedId`, else one computed from the name. */
function filterId(local: FilterDraft): string {
  return props.source?.id ?? computeId(local);
}

const isNew = computed(() => !props.source);

const { draft, error, dirty, displayId } = useEditorDraft<
  FilterDef,
  FilterDraft,
  FilterDef
>({
  source: () => props.source,
  isNew,
  buildDraft,
  toEntity: (local) => toFilter(local, { id: filterId(local) }),
  diffLabel,
  hasContent,
  canEmit: (local) => Boolean(filterId(local)),
  emit: (filter, label) => emit("update:filter", { filter, label }),
  displayId: {
    sourceId: () => props.source?.id,
    computeId,
  },
  draftNoun: "filter",
});

defineExpose({ draft, dirty });

/** Whether the id is fixed, rather than typed as a new name. */
const namesCategory = computed(() => Boolean(props.source || props.fixedId));

/** How many items carry this category, which makes a typo'd name visible. */
const itemCount = computed(() =>
  displayId.value ? props.db.forFilter(displayId.value).length : 0,
);

function save() {
  error.value = "";
  const id = filterId(draft.value);
  if (!id) {
    error.value = "The filter needs a name.";
    return;
  }
  emit("save", { filter: toFilter(draft.value, { id }) });
}
</script>

<template>
  <div>
    <DraftFormBar
      noun="filter"
      :title="displayId || 'New filter'"
      :status="status"
      :dirty="dirty"
      :is-new="isNew"
      :has-source="Boolean(source)"
      :error="error"
      save-testid="save-filter"
      delete-testid="delete-filter"
      error-testid="filter-error"
      @save="save"
      @revert="$emit('revert')"
      @delete="$emit('delete')"
    />

    <FormGrid class="mb-2">
      <FormField v-if="!namesCategory" label="Name">
        <BaseInput
          v-model="draft.name"
          class="w-full"
          type="text"
          data-testid="filter-name-input"
        />
      </FormField>
      <IdField :id="displayId" label="Id" :existing="namesCategory" />
      <FormField label="Max copies">
        <BaseInput
          v-model.number="draft.maxCopies"
          class="w-full"
          type="number"
          min="0"
          placeholder="no limit"
          data-testid="filter-max-copies"
        />
      </FormField>
    </FormGrid>

    <p class="mb-2 text-muted" data-testid="filter-item-count">
      {{ itemCount }} item(s) in this category
    </p>

    <FormSection>Item fields</FormSection>
    <FormSectionDescription>
      Fields the item form shows for this category. Fields that no filter claims
      show on every item.
    </FormSectionDescription>
    <div class="mb-2 flex flex-wrap gap-x-4 gap-y-1">
      <BaseCheckbox
        v-for="group in FIELD_GROUP_OPTIONS"
        :key="group.value"
        v-model="draft.groups"
        :value="group.value"
        :data-testid="`filter-field-${group.value}`"
        >{{ group.label }}</BaseCheckbox
      >
    </div>
  </div>
</template>
