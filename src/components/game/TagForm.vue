<script setup lang="ts">
// Editing form for one item tag's metadata: its label. An existing entry live-edits; a new one
// is a draft until Save. Draft logic lives in lib/tag-draft.ts.
//
// Also opens on a tag in use with no declaration yet: `fixedId` names it for the first save.
import { computed } from "vue";
import BaseInput from "../ui/BaseInput.vue";
import DraftFormBar from "../ui/DraftFormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import IdField from "../ui/IdField.vue";
import { useEditorDraft } from "../../composables/useEditorDraft";
import {
  buildDraft,
  toTag,
  diffLabel,
  hasContent,
  tagIdOf,
  type TagDraft,
} from "../../lib/tag-draft";
import type { Db, TagDef } from "../../types";
import type { EntryStatus } from "../../data/catalog";

const props = withDefaults(
  defineProps<{
    /** The declared tag being edited, or null for a tag with no declaration yet. */
    source?: TagDef | null;
    /** The undeclared tag this form adds metadata for. */
    fixedId?: string | null;
    status?: EntryStatus;
    db: Db;
    /** Every tag already known anywhere, which a new declaration must not repeat. */
    takenIds?: string[];
  }>(),
  {
    source: null,
    fixedId: null,
    status: "base",
    takenIds: () => [],
  },
);

const emit = defineEmits<{
  "update:tag": [payload: { tag: TagDef; label: string }];
  save: [payload: { tag: TagDef }];
  delete: [];
  revert: [];
}>();

/** The id `toTag` writes: the declaration's, else `fixedId`, else the typed tag. */
function tagId(local: TagDraft): string {
  return props.source?.id ?? props.fixedId ?? tagIdOf(local.name);
}

const isNew = computed(() => !props.source);

const { draft, error, dirty, displayId } = useEditorDraft<
  TagDef,
  TagDraft,
  TagDef
>({
  source: () => props.source,
  isNew,
  buildDraft,
  toEntity: (local) => toTag(local, { id: tagId(local) }),
  diffLabel,
  hasContent,
  canEmit: (local) => Boolean(tagId(local)),
  emit: (tag, label) => emit("update:tag", { tag, label }),
  displayId: {
    sourceId: () => props.source?.id,
    computeId: tagId,
  },
  draftNoun: "tag",
});

defineExpose({ draft, dirty });

/** Whether the tag is fixed, rather than typed for a new declaration. */
const namesTag = computed(() => Boolean(props.source || props.fixedId));

/** How many items carry this tag, which makes a typo'd tag visible. */
const itemCount = computed(
  () => props.db.itemsByTag.get(displayId.value)?.length ?? 0,
);

function save() {
  error.value = "";
  const id = tagId(draft.value);
  if (!id) {
    error.value = "The tag needs a name.";
    return;
  }
  if (!namesTag.value && props.takenIds.includes(id)) {
    error.value = `The tag "${id}" already exists.`;
    return;
  }
  emit("save", { tag: toTag(draft.value, { id }) });
}
</script>

<template>
  <div>
    <DraftFormBar
      noun="tag"
      :title="displayId || 'New tag'"
      :status="status"
      :dirty="dirty"
      :is-new="isNew"
      :has-source="Boolean(source)"
      :error="error"
      save-testid="save-tag"
      delete-testid="delete-tag"
      error-testid="tag-error"
      @save="save"
      @revert="$emit('revert')"
      @delete="$emit('delete')"
    />

    <FormGrid class="mb-2">
      <FormField v-if="!namesTag" label="Tag">
        <BaseInput
          v-model="draft.name"
          class="w-full"
          type="text"
          placeholder="gem:jade"
          data-testid="tag-name-input"
        />
      </FormField>
      <IdField v-else :id="displayId" label="Tag" existing />
      <FormField label="Label">
        <BaseInput
          v-model="draft.label"
          class="w-full"
          type="text"
          placeholder="the tag itself"
          data-testid="tag-label-input"
        />
      </FormField>
    </FormGrid>

    <p class="mb-2 text-muted" data-testid="tag-item-count">
      {{ itemCount }} item(s) carry this tag
    </p>
  </div>
</template>
