<script setup lang="ts">
// Read-only display for a frozen id (item, bonus): ItemForm.vue, BonusForm.vue and
// ItemBonuses.vue's per-card view all show one next to the entry's name. Never an `<input>`:
// an id is generator-assigned (catalog.ts's `nextId`) at first save and never user-edited
// afterwards, so there is nothing here to type into, only to read and copy.
//
// Ids run long, so the field has a fixed width a caller can override and truncates, keeping its
// row steady from entry to entry. A click copies the whole id.
import { computed } from "vue";
import FormField from "./FormField.vue";
import BaseTooltip from "./BaseTooltip.vue";
import { showNotice } from "../../stores/notice";

const props = defineProps<{
  label: string;
  /** The frozen id for an existing entry, or a live preview of what `nextId` would assign
   * on first save for a brand-new one. Callers compute which via their own `nextId` call
   * against `source?.id`. */
  id: string;
  /** Whether this entry already exists (id is frozen) vs. not yet saved (id is only a preview). */
  existing: boolean;
}>();

const tooltip = computed(() => {
  const state = props.existing
    ? "Frozen; renaming does not change it"
    : "Assigned when first saved";
  return props.id ? `${props.id}. ${state}. Click to copy.` : state;
});

async function copy() {
  if (!props.id) return;
  try {
    await navigator.clipboard.writeText(props.id);
    showNotice(`Copied the id "${props.id}"`);
  } catch {
    showNotice("Could not copy the id");
  }
}
</script>

<template>
  <FormField :label="label" class="w-48">
    <BaseTooltip tappable :text="tooltip">
      <button
        type="button"
        class="flex w-full cursor-pointer items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-left text-muted"
        data-testid="item-id-copy"
        :disabled="!id"
        @click="copy"
      >
        <span class="min-w-0 truncate" data-testid="item-id-value">{{
          id || "(assigned on save)"
        }}</span>
      </button>
    </BaseTooltip>
  </FormField>
</template>
