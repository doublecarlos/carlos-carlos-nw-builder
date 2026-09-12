<script setup lang="ts">
// The undo/redo pair as two icon buttons, one instance per undo stack the app shows (the
// sidebar's, the editor's). The tooltip names the step the button would take back or replay;
// the accessible name stays a plain "Undo" / "Redo", so a query by name finds the same button
// whatever sits on top of the stack.
import { computed } from "vue";
import { Redo2, Undo2 } from "@lucide/vue";
import IconButton from "./IconButton.vue";

const props = withDefaults(
  defineProps<{
    canUndo: boolean;
    canRedo: boolean;
    /** What the next undo would take back, or empty when there is nothing to undo. */
    undoLabel: string;
    /** What the next redo would replay, or empty when there is nothing to redo. */
    redoLabel: string;
    /** Prefix of the buttons' test ids, `<testid>-undo` and `<testid>-redo`. */
    testid?: string;
  }>(),
  { testid: "history" },
);

defineEmits<{ undo: []; redo: [] }>();

const describe = (verb: string, label: string, chord: string) =>
  label ? `${verb}: ${label} (${chord})` : `${verb} (${chord})`;

const undoTitle = computed(() => describe("Undo", props.undoLabel, "Ctrl+Z"));
const redoTitle = computed(() =>
  describe("Redo", props.redoLabel, "Ctrl+Shift+Z"),
);
</script>

<template>
  <span class="inline-flex items-center gap-0.5">
    <IconButton
      label="Undo"
      :title="undoTitle"
      :disabled="!canUndo"
      :data-testid="`${testid}-undo`"
      @click="$emit('undo')"
      ><Undo2
    /></IconButton>
    <IconButton
      label="Redo"
      :title="redoTitle"
      :disabled="!canRedo"
      :data-testid="`${testid}-redo`"
      @click="$emit('redo')"
      ><Redo2
    /></IconButton>
  </span>
</template>
