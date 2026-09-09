<script setup lang="ts">
// Shared header bar for the four editor forms (Item/Bonus/Preset/Slot): title, status badges,
// the Save/Revert/Duplicate/Delete actions and the form-level error line. Each form supplies
// its noun for the Save button's label and whichever testids its buttons still answer to;
// `#before-actions` holds ItemForm's "Show all fields" checkbox, `#extra-actions` holds
// ItemBonuses' per-item Detach button.
import { Copy, Save, Trash, Undo2 } from "@lucide/vue";
import BaseBadge from "./BaseBadge.vue";
import BaseButton from "./BaseButton.vue";
import FormBar from "./FormBar.vue";
import type { EntryStatus } from "../../data/catalog";

withDefaults(
  defineProps<{
    /** What the Save button's label calls this entity, e.g. "item", "bonus". */
    noun: string;
    title: string;
    status?: EntryStatus;
    dirty: boolean;
    isNew: boolean;
    /** Whether this form is editing an already-saved entry; gates Duplicate and Delete. */
    hasSource: boolean;
    canDuplicate?: boolean;
    error?: string;
    saveTestid?: string;
    duplicateTestid?: string;
    deleteTestid?: string;
    errorTestid?: string;
  }>(),
  {
    status: "base",
    canDuplicate: false,
    error: "",
    saveTestid: undefined,
    duplicateTestid: undefined,
    deleteTestid: undefined,
    errorTestid: undefined,
  },
);

defineEmits<{
  save: [];
  revert: [];
  duplicate: [];
  delete: [];
}>();
</script>

<template>
  <FormBar class="-mx-3 mb-3">
    <strong>{{ title }}</strong>
    <BaseBadge v-if="status !== 'base'" :variant="status">{{
      status
    }}</BaseBadge>
    <BaseBadge v-if="dirty && isNew">unsaved</BaseBadge>
    <span class="flex-1"></span>
    <slot name="before-actions" />
    <!-- Save button only for new entries -->
    <BaseButton
      v-if="isNew"
      variant="primary"
      :disabled="!dirty"
      :data-testid="saveTestid"
      @click="$emit('save')"
      ><Save />Save {{ noun }}</BaseButton
    >
    <BaseButton v-if="status === 'edited'" @click="$emit('revert')"
      ><Undo2 />Revert to shipped</BaseButton
    >
    <BaseButton
      v-if="hasSource && canDuplicate"
      :data-testid="duplicateTestid"
      @click="$emit('duplicate')"
      ><Copy />Duplicate</BaseButton
    >
    <BaseButton
      v-if="hasSource"
      :data-testid="deleteTestid"
      @click="$emit('delete')"
      ><Trash />Delete</BaseButton
    >
    <slot name="extra-actions" />
  </FormBar>

  <p v-if="error" class="mt-1 text-danger" :data-testid="errorTestid">
    {{ error }}
  </p>
</template>
