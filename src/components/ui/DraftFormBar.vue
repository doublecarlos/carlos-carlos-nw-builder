<script setup lang="ts">
// Shared header bar for the editor forms (Item/Bonus/Preset/Slot): title, status badges, the
// Save/Revert/Duplicate/Delete actions and the form-level error line. `#leading` sits before
// the title (ItemBonuses' collapse chevron), `#after-title` holds the caller's badges and
// chips, `#extra-actions` its own actions (ItemBonuses' Detach, ItemForm's From screenshot).
// Revert/Duplicate/Delete are icon buttons right after the title; Save is the one labeled
// button, on the right.
// `embedded`: an in-flow row inside another form's card, the same layout, just not sticky.
// `toggleable`: a click on the bar's inert area (title, badges, chips, spacer) raises
// `toggle`; its controls never do.
import { computed, type Component } from "vue";
import { Copy, Save, Trash, Undo2 } from "@lucide/vue";
import BaseBadge from "./BaseBadge.vue";
import BaseButton from "./BaseButton.vue";
import FormBar from "./FormBar.vue";
import IconButton from "./IconButton.vue";
import type { EntryStatus } from "../../data/catalog";

const props = withDefaults(
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
    embedded?: boolean;
    toggleable?: boolean;
    error?: string;
    saveTestid?: string;
    duplicateTestid?: string;
    deleteTestid?: string;
    errorTestid?: string;
  }>(),
  {
    status: "base",
    canDuplicate: false,
    embedded: false,
    toggleable: false,
    error: "",
    saveTestid: undefined,
    duplicateTestid: undefined,
    deleteTestid: undefined,
    errorTestid: undefined,
  },
);

const emit = defineEmits<{
  save: [];
  revert: [];
  duplicate: [];
  delete: [];
  /** The inert part of a `toggleable` bar was clicked. */
  toggle: [];
}>();

/** Toggles unless the click landed on a control. Reads the event's path rather than
 *  `target.closest`: a control that re-renders on click has already detached the target. */
function onBarClick(event: MouseEvent) {
  if (!props.toggleable) return;
  for (const node of event.composedPath()) {
    if (node === event.currentTarget) break;
    if (
      node instanceof Element &&
      node.matches("button, a, input, label, select, textarea")
    )
      return;
  }
  emit("toggle");
}

/** One secondary action, drawn as an icon button with its title as the tooltip. */
interface ActionSpec {
  key: string;
  title: string;
  icon: Component;
  show: boolean;
  testid: string | undefined;
  run: () => void;
}

const actions = computed<ActionSpec[]>(() =>
  [
    {
      key: "revert",
      title: "Revert to shipped",
      icon: Undo2,
      show: props.status === "edited",
      testid: undefined,
      run: () => emit("revert"),
    },
    {
      key: "duplicate",
      title: "Duplicate",
      icon: Copy,
      show: props.hasSource && props.canDuplicate,
      testid: props.duplicateTestid,
      run: () => emit("duplicate"),
    },
    {
      key: "delete",
      title: "Delete",
      icon: Trash,
      show: props.hasSource,
      testid: props.deleteTestid,
      run: () => emit("delete"),
    },
  ].filter((action) => action.show),
);
</script>

<template>
  <FormBar
    :embedded="embedded"
    :class="[
      embedded ? 'mb-1' : '-mx-3 mb-3',
      toggleable && 'cursor-pointer select-none',
    ]"
    @click="onBarClick"
  >
    <slot name="leading" />
    <strong data-testid="form-bar-title">{{ title }}</strong>
    <BaseBadge v-if="status !== 'base'" :variant="status">{{
      status
    }}</BaseBadge>
    <BaseBadge v-if="dirty && isNew">unsaved</BaseBadge>
    <slot name="after-title" />
    <!-- Secondary actions stay snug against the title, as icon buttons; the spacer span
         below is what parks Save at the row's end. -->
    <span
      v-if="actions.length || $slots['extra-actions']"
      class="flex flex-wrap items-center gap-1.5 text-[14px]"
    >
      <IconButton
        v-for="action in actions"
        :key="action.key"
        :title="action.title"
        :data-testid="action.testid"
        @click="action.run()"
      >
        <component :is="action.icon" />
      </IconButton>
      <slot name="extra-actions" />
    </span>
    <span class="flex flex-1 flex-wrap items-center gap-1.5">
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
    </span>
  </FormBar>

  <p v-if="error" class="mt-1 text-danger" :data-testid="errorTestid">
    {{ error }}
  </p>
</template>
