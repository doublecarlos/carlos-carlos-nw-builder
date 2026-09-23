<script setup lang="ts">
// Editing form for one layout section. An existing section live-edits; a new one is a draft
// until Save. Draft logic lives in lib/section-draft.ts.
//
// The slot and preset lists are read-only links; membership and order are edited in the outline.
import { computed } from "vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import BaseLink from "../ui/BaseLink.vue";
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
  hasContent,
  toSection,
  diffLabel,
  type SectionDraft,
} from "../../lib/section-draft";
import type { Db, SlotSection } from "../../types";
import type { EntryStatus } from "../../data/catalog";

const props = withDefaults(
  defineProps<{
    /** The section being edited, or null for a brand-new one. */
    source?: SlotSection | null;
    status?: EntryStatus;
    db: Db;
    /** Every id already in use anywhere, so a new section's generated id can't collide. */
    allocatableIds?: string[];
  }>(),
  {
    source: null,
    status: "base",
    allocatableIds: () => [],
  },
);

const emit = defineEmits<{
  "update:section": [payload: { section: SlotSection; label: string }];
  save: [payload: { section: SlotSection }];
  delete: [event: MouseEvent];
  revert: [];
  openSlot: [id: string];
  openPreset: [id: string];
}>();

function computeId(local: SectionDraft): string {
  return local.label.trim()
    ? catalog.nextId(local.label.trim(), props.allocatableIds, "section")
    : "";
}

/** The id `toSection` writes: the source's, else one computed from the label. Frozen once saved,
 *  since slot ids are namespaced by it. */
function sectionId(local: SectionDraft): string {
  return props.source?.id ?? computeId(local);
}

const isNew = computed(() => !props.source);

const { draft, error, dirty, displayId } = useEditorDraft<
  SlotSection,
  SectionDraft,
  SlotSection
>({
  source: () => props.source,
  isNew,
  buildDraft,
  toEntity: (local) =>
    toSection(local, {
      id: sectionId(local),
      slotIds: props.source?.slotIds ?? [],
    }),
  diffLabel,
  hasContent,
  canEmit: (local) => Boolean(local.label.trim()),
  emit: (section, label) => emit("update:section", { section, label }),
  displayId: {
    sourceId: () => props.source?.id,
    computeId,
  },
  draftNoun: "section",
});

defineExpose({ draft, dirty });

/** The section's authored slots in render order, so a list container shows as one slot. */
const slots = computed(() =>
  props.source
    ? props.db.authoredSlots.filter((slot) => slot.section === props.source!.id)
    : [],
);

const presets = computed(() =>
  props.source
    ? props.db.presets.filter((preset) => preset.section === props.source!.id)
    : [],
);

function save() {
  error.value = "";
  if (!draft.value.label.trim()) {
    error.value = "The section needs a label.";
    return;
  }
  emit("save", {
    section: toSection(draft.value, {
      id: sectionId(draft.value),
      slotIds: [],
    }),
  });
}
</script>

<template>
  <div>
    <DraftFormBar
      noun="section"
      :title="draft.label || 'New section'"
      :status="status"
      :dirty="dirty"
      :is-new="isNew"
      :has-source="Boolean(source)"
      :error="error"
      save-testid="save-section"
      delete-testid="delete-section"
      error-testid="section-error"
      @save="save"
      @revert="$emit('revert')"
      @delete="(event) => emit('delete', event)"
    />

    <FormGrid class="mb-2">
      <FormField label="Label">
        <BaseInput
          v-model="draft.label"
          class="w-full"
          type="text"
          data-testid="section-label-input"
        />
      </FormField>
      <IdField :id="displayId" label="Id" :existing="Boolean(source)" />
    </FormGrid>
    <div class="mb-2">
      <BaseCheckbox
        v-model="draft.defaultOpen"
        data-testid="section-default-open-input"
        >expanded by default</BaseCheckbox
      >
    </div>

    <FormSection>Slots</FormSection>
    <FormSectionDescription>
      In display order. Use the outline to reorder them or move them to another
      section.
    </FormSectionDescription>
    <ol class="mb-2 flex flex-col gap-0.5" data-testid="section-slot-list">
      <li
        v-for="slot in slots"
        :key="slot.id"
        class="flex items-baseline gap-2"
      >
        <BaseLink @click="emit('openSlot', slot.id)">{{
          slot.label || slot.id
        }}</BaseLink>
        <span class="text-muted">{{ slot.type }}</span>
      </li>
      <li v-if="!slots.length" class="text-muted">No slots yet.</li>
    </ol>

    <FormSection>Presets</FormSection>
    <ol class="mb-2 flex flex-col gap-0.5" data-testid="section-preset-list">
      <li v-for="preset in presets" :key="preset.id">
        <BaseLink @click="emit('openPreset', preset.id)">{{
          preset.label || preset.id
        }}</BaseLink>
      </li>
      <li v-if="!presets.length" class="text-muted">No presets yet.</li>
    </ol>
  </div>
</template>
