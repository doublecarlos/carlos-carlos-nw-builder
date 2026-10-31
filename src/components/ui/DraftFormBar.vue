<script lang="ts">
import type { Component } from "vue";
/** One secondary action, drawn as an icon button with its title as the tooltip, or as a
 *  labeled entry in the compact bar's menu. */
export interface FormBarAction {
  key: string;
  title: string;
  icon: Component;
  testid?: string;
  run: (event: MouseEvent) => void;
}
</script>

<script setup lang="ts">
// Shared header bar for the editor forms (Item/Bonus/Preset/Slot): title, status badges, the
// Save/Revert/Duplicate/Delete actions and the form-level error line. `#leading` sits before
// the title (ItemBonuses' collapse chevron), `#after-title` holds the caller's badges and
// chips, `#extra-actions` its own controls (ItemBonuses' Detach), `extraActions` its own
// actions as entries (ItemForm's From screenshot).
// Revert/Duplicate/Delete are icon buttons right after the title; Save is the one labeled
// button, on the right. A wide bar is one row where a long title wraps in place. A narrow
// one (a container query, since the layer editor's list narrows the form at any width) puts
// the title and badges on their own row, and the icon actions and right-hand group below.
// `embedded`: an in-flow row inside another form's card, the same layout, just not sticky.
// `toggleable`: a click on the bar's inert area (title, badges, chips, spacer) raises
// `toggle`; its controls never do.
//
// Under a `FORM_BAR_CONTEXT` (the phone layer editor) a top-level bar is one compact row: Back,
// the title, Save for a new entry, and a menu holding the actions with their labels, the
// host's own actions and `#before-actions`. Host actions such as undo leave the menu open.
import { computed, inject, ref } from "vue";
import {
  ChevronLeft,
  Copy,
  EllipsisVertical,
  Save,
  Trash,
  Undo2,
} from "@lucide/vue";
import BaseBadge from "./BaseBadge.vue";
import BaseButton from "./BaseButton.vue";
import BaseMenu from "./BaseMenu.vue";
import BaseMenuItem from "./BaseMenuItem.vue";
import FormBar from "./FormBar.vue";
import IconButton from "./IconButton.vue";
import type { EntryStatus } from "../../data/catalog";
import { clickedControl } from "../../lib/control-click";
import { FORM_BAR_CONTEXT } from "../../lib/form-bar-context";

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
    /** Whether the Delete action appears at all. Off for a bonus embedded in an item, where
     *  Detach is the only removal. */
    canDelete?: boolean;
    embedded?: boolean;
    toggleable?: boolean;
    error?: string;
    saveTestid?: string;
    duplicateTestid?: string;
    deleteTestid?: string;
    errorTestid?: string;
    /** The caller's own actions, after the built-in ones. */
    extraActions?: FormBarAction[];
  }>(),
  {
    status: "base",
    canDuplicate: false,
    canDelete: true,
    embedded: false,
    toggleable: false,
    error: "",
    saveTestid: undefined,
    duplicateTestid: undefined,
    deleteTestid: undefined,
    errorTestid: undefined,
    extraActions: () => [],
  },
);

const context = inject(FORM_BAR_CONTEXT, ref(null));
const compact = computed(() => !props.embedded && context.value !== null);
const menu = ref<InstanceType<typeof BaseMenu> | null>(null);

function runFromMenu(action: FormBarAction, event: MouseEvent) {
  menu.value?.close();
  action.run(event);
}

const emit = defineEmits<{
  save: [];
  revert: [];
  duplicate: [];
  delete: [event: MouseEvent];
  /** The inert part of a `toggleable` bar was clicked. */
  toggle: [];
}>();

function onBarClick(event: MouseEvent) {
  if (props.toggleable && !clickedControl(event)) emit("toggle");
}

const actions = computed<FormBarAction[]>(() => [
  ...builtInActions.value,
  ...props.extraActions,
]);

const builtInActions = computed<FormBarAction[]>(() =>
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
      show: props.hasSource && props.canDelete,
      testid: props.deleteTestid,
      run: (event: MouseEvent) => emit("delete", event),
    },
  ]
    .filter((action) => action.show)
    .map(({ show: _show, ...action }) => action),
);
</script>

<template>
  <FormBar
    v-if="compact"
    class="-mx-3 mb-3 flex-nowrap!"
    data-testid="form-bar-compact"
  >
    <IconButton
      title="Back to list"
      data-testid="layer-form-back"
      @click="context?.back()"
      ><ChevronLeft
    /></IconButton>
    <span
      class="flex min-w-0 flex-1 items-center gap-1.5"
      data-testid="form-bar-heading"
    >
      <strong class="min-w-0 wrap-anywhere" data-testid="form-bar-title">{{
        title
      }}</strong>
      <BaseBadge v-if="status !== 'base'" :variant="status">{{
        status
      }}</BaseBadge>
      <BaseBadge v-if="dirty && isNew">unsaved</BaseBadge>
      <slot name="after-title" />
    </span>
    <BaseButton
      v-if="isNew"
      variant="primary"
      class="flex-none"
      :disabled="!dirty"
      :data-testid="saveTestid"
      @click="$emit('save')"
      ><Save />Save {{ noun }}</BaseButton
    >
    <BaseMenu
      v-if="
        actions.length || context?.actions.length || $slots['before-actions']
      "
      ref="menu"
      fit-content
      role="group"
      :label="`${noun} actions`"
      panel-class="flex min-w-56 max-w-[calc(100vw-1rem)] flex-col p-1"
      item-selector="button[tabindex='-1']:not(:disabled), input[type='checkbox']"
      :ignore="['[data-testid=form-bar-menu]']"
    >
      <template #trigger="{ toggle, attrs }">
        <IconButton
          :title="`${noun} actions`"
          class="flex-none"
          data-testid="form-bar-menu"
          v-bind="attrs"
          @click="toggle"
          ><EllipsisVertical
        /></IconButton>
      </template>
      <BaseMenuItem
        v-for="action in actions"
        :key="action.key"
        :icon="action.icon"
        :data-testid="action.testid"
        @click="runFromMenu(action, $event)"
        >{{ action.title }}</BaseMenuItem
      >
      <template v-if="context?.actions.length">
        <div v-if="actions.length" class="my-1 h-px bg-line" />
        <BaseMenuItem
          v-for="action in context.actions"
          :key="action.key"
          :icon="action.icon"
          :disabled="action.disabled"
          :data-testid="`form-bar-${action.key}`"
          @click="action.run()"
          >{{ action.label }}</BaseMenuItem
        >
      </template>
      <template v-if="$slots['before-actions']">
        <div v-if="actions.length" class="my-1 h-px bg-line" />
        <div class="px-2 py-1.5"><slot name="before-actions" /></div>
      </template>
    </BaseMenu>
  </FormBar>
  <FormBar
    v-else
    :embedded="embedded"
    class="@container"
    :class="[
      embedded ? 'mb-1' : '-mx-3 mb-3',
      toggleable && 'cursor-pointer select-none',
    ]"
    @click="onBarClick"
  >
    <!-- Wide: the title and its actions share one shrinking group, so the title wraps
         instead of the row. Narrow: the group dissolves into the bar's own wrapping row. -->
    <span class="flex min-w-0 flex-1 items-center gap-1.5 @max-xl:contents">
      <span
        class="flex min-w-0 items-center gap-1.5 @max-xl:basis-full"
        data-testid="form-bar-heading"
      >
        <slot name="leading" />
        <strong class="min-w-0 wrap-anywhere" data-testid="form-bar-title">{{
          title
        }}</strong>
        <BaseBadge v-if="status !== 'base'" :variant="status">{{
          status
        }}</BaseBadge>
        <BaseBadge v-if="dirty && isNew">unsaved</BaseBadge>
        <slot name="after-title" />
      </span>
      <!-- Secondary actions stay snug against the title, as icon buttons. -->
      <span
        v-if="actions.length || $slots['extra-actions']"
        class="flex shrink-0 items-center gap-1.5 text-[14px]"
        data-testid="form-bar-actions"
      >
        <IconButton
          v-for="action in actions"
          :key="action.key"
          :title="action.title"
          :data-testid="action.testid"
          @click="action.run($event)"
        >
          <component :is="action.icon" />
        </IconButton>
        <slot name="extra-actions" />
      </span>
    </span>
    <span
      v-if="isNew || $slots['before-actions']"
      class="ml-auto flex shrink-0 items-center gap-1.5"
    >
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
