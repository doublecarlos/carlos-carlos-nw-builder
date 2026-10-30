<script setup lang="ts">
// The build editor toolbar's right-hand actions folded into one menu, for a phone where the
// toolbar has no room for them: undo/redo, expand/collapse all, and the picker options.
//
// History steps leave the menu open, so several undos take one visit. Expanding or collapsing
// closes it: the list under it has just changed.
import { computed, useTemplateRef, type Component } from "vue";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  EllipsisVertical,
  Redo2,
  Undo2,
} from "@lucide/vue";
import BaseMenu from "../ui/BaseMenu.vue";
import BaseMenuItem from "../ui/BaseMenuItem.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import IconButton from "../ui/IconButton.vue";
import * as pickerLens from "../../stores/pickerLens";

const props = defineProps<{
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  allExpanded: boolean;
  noneExpanded: boolean;
}>();

const emit = defineEmits<{
  undo: [];
  redo: [];
  setAll: [open: boolean];
}>();

const menu = useTemplateRef<InstanceType<typeof BaseMenu>>("menu");

interface Action {
  key: string;
  label: string;
  /** What the step would do, shown muted after the label. */
  detail: string;
  icon: Component;
  disabled: boolean;
  run: () => void;
  keepOpen: boolean;
}

const actions = computed<Action[]>(() => [
  {
    key: "undo",
    label: "Undo",
    detail: props.undoLabel,
    icon: Undo2,
    disabled: !props.canUndo,
    run: () => emit("undo"),
    keepOpen: true,
  },
  {
    key: "redo",
    label: "Redo",
    detail: props.redoLabel,
    icon: Redo2,
    disabled: !props.canRedo,
    run: () => emit("redo"),
    keepOpen: true,
  },
  {
    key: "expand-all",
    label: "Expand all",
    detail: "",
    icon: ChevronsUpDown,
    disabled: props.allExpanded,
    run: () => emit("setAll", true),
    keepOpen: false,
  },
  {
    key: "collapse-all",
    label: "Collapse all",
    detail: "",
    icon: ChevronsDownUp,
    disabled: props.noneExpanded,
    run: () => emit("setAll", false),
    keepOpen: false,
  },
]);

function onAction(action: Action) {
  action.run();
  if (!action.keepOpen) menu.value?.close();
}
</script>

<template>
  <BaseMenu
    ref="menu"
    fit-content
    role="group"
    label="Editor actions"
    panel-class="flex min-w-56 max-w-[calc(100vw-1rem)] flex-col p-1"
    item-selector="button[tabindex='-1']:not(:disabled), input[type='checkbox']"
    :ignore="['[data-testid=editor-actions]']"
  >
    <template #trigger="{ toggle, attrs }">
      <IconButton
        title="Editor actions"
        data-testid="editor-actions"
        v-bind="attrs"
        @click="toggle"
        ><EllipsisVertical
      /></IconButton>
    </template>
    <BaseMenuItem
      v-for="action in actions"
      :key="action.key"
      :icon="action.icon"
      :disabled="action.disabled"
      :data-testid="`editor-actions-${action.key}`"
      @click="onAction(action)"
      >{{ action.label
      }}<span v-if="action.detail" class="min-w-0 truncate text-muted">{{
        action.detail
      }}</span></BaseMenuItem
    >
    <div class="my-1 h-px bg-line" />
    <div class="px-2 py-1 text-muted">Picker options</div>
    <BaseCheckbox
      v-for="option in pickerLens.OPTIONS"
      :key="option.key"
      class="rounded-md px-2 py-1.5 hover:bg-surface-2"
      :model-value="option.value.value"
      :data-testid="`editor-actions-picker:${option.key}`"
      @update:model-value="pickerLens.toggle(option.key)"
    >
      {{ option.label }}
    </BaseCheckbox>
  </BaseMenu>
</template>
