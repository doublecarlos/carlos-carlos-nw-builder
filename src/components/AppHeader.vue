<script setup lang="ts">
// Full-width header bar: app title, export/import, an auto-save indicator, undo/redo, theme
// toggle, and notice.
import { ref, useTemplateRef } from "vue";
import ThemeToggle from "./ui/ThemeToggle.vue";
import HistoryButton from "./ui/HistoryButton.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseNotice from "./ui/BaseNotice.vue";
import BundleExport from "./BundleExport.vue";
import { Download, HardDrive, Upload } from "@lucide/vue";
import { useUndoRedoKeys } from "../composables/useUndoRedoKeys";
import * as builds from "../stores/builds";
import * as layers from "../stores/layers";
import { notice, showNotice } from "../stores/notice";

const importFileInput = useTemplateRef("importFileInput");
const showBundleExport = ref(false);

const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } =
  useUndoRedoKeys();

function triggerExportBundle() {
  showBundleExport.value = true;
}

function triggerImport() {
  importFileInput.value?.click();
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const text = await file.text();
  // Sniff the envelope kind — routes to build, layer or bundle.
  try {
    const parsed = JSON.parse(text);
    if (parsed?.kind === "layer") {
      layers.importLayerText(text);
    } else if (parsed?.kind === "bundle") {
      layers.importBundleText(text);
    } else {
      builds.importBuildText(text);
    }
  } catch {
    builds.importBuildText(text);
  }
}
</script>

<template>
  <header
    class="flex items-center gap-3 border-b border-line bg-surface px-2 py-2 text-sm"
    data-testid="app-header"
  >
    <h1 class="text-base font-semibold tracking-wide whitespace-nowrap">
      Neverwinter build planner
    </h1>

    <BaseButton data-testid="header-export-bundle" @click="triggerExportBundle"
      ><Download />Export</BaseButton
    >
    <BundleExport v-if="showBundleExport" @close="showBundleExport = false" />

    <BaseButton data-testid="header-import" @click="triggerImport"
      ><Upload />Import</BaseButton
    >

    <input
      ref="importFileInput"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="onImportFile"
    />

    <span class="h-4 w-px bg-line" />

    <span
      class="flex items-center gap-1 whitespace-nowrap text-muted"
      data-testid="autosave-indicator"
      title="Edits are saved automatically to this browser's storage. That storage can be cleared or lost — use Export to keep a backup elsewhere."
    >
      <HardDrive class="h-[14px] w-[14px]" />
      Auto-saved to this browser
    </span>

    <span class="ml-auto">
      <BaseNotice
        v-if="notice"
        class="inline-block max-w-80 overflow-hidden text-ellipsis whitespace-nowrap"
        :title="notice"
        @dismiss="showNotice('')"
      >
        {{ notice }}
      </BaseNotice>
    </span>

    <span class="flex-1"></span>

    <span class="h-4 w-px bg-line" />

    <HistoryButton
      type="undo"
      :disabled="!canUndo"
      :detail="canUndo ? undoLabel : ''"
      :title="canUndo ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'"
      data-testid="header-undo"
      @click="undo()"
    >
      Undo
    </HistoryButton>
    <HistoryButton
      type="redo"
      :disabled="!canRedo"
      :detail="canRedo ? redoLabel : ''"
      :title="canRedo ? `Redo: ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'"
      data-testid="header-redo"
      @click="redo()"
    >
      Redo
    </HistoryButton>

    <span class="h-4 w-px bg-line" />

    <ThemeToggle class="w-30 justify-center" />
  </header>
</template>
