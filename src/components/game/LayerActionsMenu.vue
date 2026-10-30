<script setup lang="ts">
// The layer editor toolbar's actions folded into one menu, for a phone where the toolbar has
// no room for them: undo/redo, export, import and discard.
//
// History steps leave the menu open, so several undos take one visit. The others close it:
// each opens a window or a file picker of its own.
import { computed, useTemplateRef, type Component } from "vue";
import {
  Download,
  EllipsisVertical,
  Redo2,
  RotateCcw,
  Undo2,
  Upload,
} from "@lucide/vue";
import BaseMenu from "../ui/BaseMenu.vue";
import BaseMenuItem from "../ui/BaseMenuItem.vue";
import IconButton from "../ui/IconButton.vue";

const props = defineProps<{
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  canDiscard: boolean;
}>();

const emit = defineEmits<{
  undo: [];
  redo: [];
  export: [];
  import: [event: Event];
  discard: [event: MouseEvent];
}>();

const menu = useTemplateRef<InstanceType<typeof BaseMenu>>("menu");
const fileInput = useTemplateRef<HTMLInputElement>("fileInput");

interface Action {
  key: string;
  label: string;
  /** What the step would do, shown muted after the label. */
  detail: string;
  icon: Component;
  disabled: boolean;
  run: (event: MouseEvent) => void;
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
    key: "export",
    label: "Export…",
    detail: "",
    icon: Download,
    disabled: false,
    run: () => emit("export"),
    keepOpen: false,
  },
  {
    key: "import",
    label: "Import",
    detail: "",
    icon: Upload,
    disabled: false,
    run: () => fileInput.value?.click(),
    keepOpen: false,
  },
  {
    key: "discard",
    label: "Discard changes",
    detail: "",
    icon: RotateCcw,
    disabled: !props.canDiscard,
    run: (event) => emit("discard", event),
    keepOpen: false,
  },
]);

function onAction(action: Action, event: MouseEvent) {
  if (!action.keepOpen) menu.value?.close();
  action.run(event);
}
</script>

<template>
  <BaseMenu
    ref="menu"
    fit-content
    label="Layer actions"
    panel-class="flex min-w-56 max-w-[calc(100vw-1rem)] flex-col p-1"
    :ignore="['[data-testid=layer-actions]']"
  >
    <template #trigger="{ toggle, attrs }">
      <IconButton
        title="Layer actions"
        data-testid="layer-actions"
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
      :data-testid="`layer-actions-${action.key}`"
      @click="onAction(action, $event)"
      >{{ action.label
      }}<span v-if="action.detail" class="min-w-0 truncate text-muted">{{
        action.detail
      }}</span></BaseMenuItem
    >
  </BaseMenu>
  <input
    ref="fileInput"
    type="file"
    accept=".json"
    hidden
    data-testid="layer-actions-import-file"
    @change="emit('import', $event)"
  />
</template>
