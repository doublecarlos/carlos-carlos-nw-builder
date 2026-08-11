<script setup lang="ts">
// Read-only display for a frozen id (item, bonus set) -- ItemForm.vue, BonusForm.vue and
// ItemBonuses.vue's per-card view all show one next to the entry's name. Never an `<input>`:
// an id is generator-assigned (catalog.ts's `nextId`) at first save and never user-edited
// afterwards, so there is nothing here to type into, only to read.
import FormField from "./FormField.vue";

defineProps<{
  label: string;
  /** The frozen id for an existing entry, or a live preview of what `nextId` would assign
   * on first save for a brand-new one -- callers compute which via their own `nextId` call
   * against `source?.id`. */
  id: string;
  /** Whether this entry already exists (id is frozen) vs. not yet saved (id is only a preview). */
  existing: boolean;
}>();
</script>

<template>
  <FormField :label="label">
    <span
      class="flex w-full items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-sm text-muted"
      :title="
        existing
          ? 'Frozen -- renaming does not change it'
          : 'Assigned when first saved'
      "
    >
      {{ id || "(assigned on save)" }}
    </span>
  </FormField>
</template>
