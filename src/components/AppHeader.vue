<script setup lang="ts">
// Full-width header bar: app title, export/import, an auto-save indicator, undo/redo, theme
// toggle, notice, and the About/shortcut overlays.
import { ref, useTemplateRef } from "vue";
import ThemeToggle from "./ui/ThemeToggle.vue";
import HistoryButton from "./ui/HistoryButton.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseNotice from "./ui/BaseNotice.vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import AboutDialog from "./AboutDialog.vue";
import AutosaveIndicator from "./AutosaveIndicator.vue";
import BundleExport from "./BundleExport.vue";
import GameImport from "./GameImport.vue";
import ImportPicker from "./ImportPicker.vue";
import ShortcutHelp from "./ShortcutHelp.vue";
import {
  Download,
  Gamepad2,
  Info,
  Keyboard,
  Search,
  Upload,
} from "@lucide/vue";
import { useUndoRedoKeys } from "../composables/useUndoRedoKeys";
import { importFileText, pending as pendingImport } from "../stores/importFile";
import { notice, noticeAction, showNotice } from "../stores/notice";
import {
  isOpen as gameImportOpen,
  openWizard as openGameImport,
} from "../stores/gameImport";
import * as shortcutHelp from "../stores/shortcutHelp";
import * as goTo from "../stores/goTo";
import GoToPalette from "./GoToPalette.vue";
import { isMac } from "../lib/platform";

const importFileInput = useTemplateRef("importFileInput");
const modKey = isMac ? "⌘" : "Ctrl";
const showBundleExport = ref(false);
const showAbout = ref(false);

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
  importFileText(await file.text(), file.name);
}
</script>

<template>
  <header
    class="flex items-center gap-3 border-b border-line bg-surface px-2 py-2"
    data-testid="app-header"
  >
    <!-- The one item here that may shrink. Every other child is a control with a fixed
         intrinsic width, so without this the bar's own minimum grows with each one added and
         a narrow window scrolls sideways -- and of everything up here, the title is what a
         narrow window can most afford to lose the tail of. -->
    <h1 class="min-w-0 truncate text-base font-semibold tracking-wide">
      Carlos Carlos' NW Builder
    </h1>

    <BaseButton data-testid="header-export-bundle" @click="triggerExportBundle"
      ><Download />Export</BaseButton
    >
    <BundleExport v-if="showBundleExport" @close="showBundleExport = false" />

    <!-- The app's only file entry point, so it says what it takes: `importFileText` sniffs
         the file and routes it, rather than the caller picking a kind up front. -->
    <BaseTooltip text="Import a build, layer or bundle file.">
      <BaseButton data-testid="header-import" @click="triggerImport"
        ><Upload />Import</BaseButton
      >
    </BaseTooltip>

    <!-- Mounted here for every entry point, as the game-import wizard is. -->
    <ImportPicker v-if="pendingImport" :plan="pendingImport" />

    <BaseButton data-testid="header-import-from-game" @click="openGameImport"
      ><Gamepad2 />Import from game</BaseButton
    >
    <GameImport v-if="gameImportOpen" />

    <input
      ref="importFileInput"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="onImportFile"
    />

    <span class="h-4 w-px bg-line" />

    <!-- Shaped like the search box it opens, rather than an icon button: a palette nobody
         knows the shortcut for is a palette nobody uses, so the affordance states the binding
         it is standing in for. -->
    <button
      type="button"
      class="flex flex-none cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-0.5 text-muted hover:border-accent hover:text-text"
      data-testid="header-go-to"
      @click="goTo.open()"
    >
      <Search class="h-[14px] w-[14px]" />
      <span>Go to…</span>
      <kbd
        class="rounded border border-line bg-surface-2 px-1 text-xs whitespace-nowrap"
        >{{ modKey }}+K</kbd
      >
    </button>
    <GoToPalette v-if="goTo.isOpen.value" />

    <span class="h-4 w-px bg-line" />

    <AutosaveIndicator />

    <span class="ml-auto flex items-center gap-1">
      <BaseNotice
        v-if="notice"
        class="inline-block max-w-80 overflow-hidden text-ellipsis whitespace-nowrap"
        :title="notice"
        @dismiss="showNotice('')"
      >
        {{ notice }}
      </BaseNotice>
      <BaseButton
        v-if="notice && noticeAction"
        variant="link"
        data-testid="notice-action"
        @click="noticeAction.run()"
        >{{ noticeAction.label }}</BaseButton
      >
    </span>

    <span class="flex-1"></span>

    <span class="h-4 w-px bg-line" />

    <!-- A disabled button fires no pointer events, so the "nothing to undo" wording has no
         way to show; it said nothing the greyed-out button did not already. -->
    <BaseTooltip :text="canUndo ? `Undo: ${undoLabel} (Ctrl+Z)` : ''">
      <HistoryButton
        type="undo"
        :disabled="!canUndo"
        :detail="canUndo ? undoLabel : ''"
        data-testid="header-undo"
        @click="undo()"
      >
        Undo
      </HistoryButton>
    </BaseTooltip>
    <BaseTooltip :text="canRedo ? `Redo: ${redoLabel} (Ctrl+Shift+Z)` : ''">
      <HistoryButton
        type="redo"
        :disabled="!canRedo"
        :detail="canRedo ? redoLabel : ''"
        data-testid="header-redo"
        @click="redo()"
      >
        Redo
      </HistoryButton>
    </BaseTooltip>

    <span class="h-4 w-px bg-line" />

    <BaseTooltip text="Keyboard shortcuts (?)">
      <BaseButton
        data-testid="header-shortcuts"
        aria-label="Keyboard shortcuts"
        @click="shortcutHelp.toggle()"
        ><Keyboard
      /></BaseButton>
    </BaseTooltip>

    <BaseTooltip text="About this app, and where to report a problem">
      <BaseButton
        data-testid="header-about"
        aria-label="About"
        @click="showAbout = true"
        ><Info
      /></BaseButton>
    </BaseTooltip>

    <ThemeToggle class="w-30 justify-center" />

    <ShortcutHelp v-if="shortcutHelp.isOpen.value" />
    <AboutDialog v-if="showAbout" @close="showAbout = false" />
  </header>
</template>
