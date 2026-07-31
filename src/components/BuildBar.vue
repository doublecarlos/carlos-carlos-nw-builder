<script setup lang="ts">
// Slim per-build action strip: rename, save/revert, import/export JSON, share link, undo/redo.
// Switching/creating/duplicating/deleting a build lives in BuildLibrary.vue's sidebar; copying a
// section between builds is a per-section control in BuildEditor.vue. This bar is left with only
// what always applies to *the build currently on screen*.
import { ref, computed, watch } from "vue";
import * as storage from "../storage";
import * as library from "../stores/library";
import * as buildEditor from "../stores/buildEditor";
import BaseButton from "./ui/BaseButton.vue";
import HistoryButton from "./ui/HistoryButton.vue";
import BaseDrawer from "./ui/BaseDrawer.vue";
import CodeBlock from "./ui/CodeBlock.vue";
import FormField from "./ui/FormField.vue";

const build = library.build;
const dirty = library.dirty;
const canUndo = buildEditor.canUndo;
const canRedo = buildEditor.canRedo;
const undoLabel = buildEditor.undoLabel;
const redoLabel = buildEditor.redoLabel;

const panel = ref(""); // '' | 'share' | 'io'
const confirmRevert = ref(false);
let confirmRevertTimer: number | undefined;
const shareLink = ref("");
const shareError = ref("");
const exportText = ref("");
const importText = ref("");
const importError = ref("");
const importNote = ref("");

const undoTitle = computed(() =>
  canUndo.value ? `Undo: ${undoLabel.value} (Ctrl+Z)` : "Nothing to undo",
);
const redoTitle = computed(() =>
  canRedo.value ? `Redo: ${redoLabel.value} (Ctrl+Shift+Z)` : "Nothing to redo",
);

// An armed "Really revert?" refers to whichever build was active when it was clicked --
// switching builds inside the 4s window must not leave it armed against a different one.
watch(
  () => build.value.id,
  () => {
    window.clearTimeout(confirmRevertTimer);
    confirmRevert.value = false;
  },
);

/** Two-step confirm rather than a `confirm()` dialog: reverting throws away unsaved
 * edits, and a modal dialog would block the page for anything driving the UI
 * programmatically. */
function onRevert() {
  if (!confirmRevert.value) {
    confirmRevert.value = true;
    confirmRevertTimer = window.setTimeout(() => {
      confirmRevert.value = false;
    }, 4000);
    return;
  }
  window.clearTimeout(confirmRevertTimer);
  confirmRevert.value = false;
  buildEditor.revertActive();
}

async function makeShareLink() {
  shareLink.value = "";
  shareError.value = "";
  try {
    const payload = await storage.encodeShare(build.value);
    shareLink.value = storage.shareUrl(payload);
  } catch (error: unknown) {
    shareError.value = error instanceof Error ? error.message : String(error);
  }
}

function toggle(name: string) {
  panel.value = panel.value === name ? "" : name;
  shareError.value = "";
  importError.value = "";
  importNote.value = "";
  if (panel.value === "share") makeShareLink();
  if (panel.value === "io") exportText.value = storage.toBuildJson(build.value);
}

function selectAllText(event: FocusEvent) {
  (event.target as HTMLInputElement).select();
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard permission denied. The text is on screen and already selected, so the
    // user can copy it by hand -- no need to interrupt them.
  }
}

function downloadExport() {
  const blob = new Blob([exportText.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${build.value.name.replace(/[^\w.-]+/g, "-") || "build"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importText.value = await file.text();
  input.value = "";
  applyImport();
}

function applyImport() {
  importError.value = "";
  importNote.value = "";
  try {
    const { builds, catalogStale } = storage.parseJson(importText.value);
    library.importBuilds(builds);
    const stale = catalogStale
      ? " — made against an older item catalogue; some items may no longer resolve"
      : "";
    importNote.value = `imported ${builds.length} build(s)${stale}`;
    importText.value = "";
  } catch (error: unknown) {
    importError.value = error instanceof Error ? error.message : String(error);
  }
}
</script>

<template>
  <div class="min-w-0 flex-1 basis-full">
    <div class="flex flex-wrap items-end gap-x-2.5 gap-y-2">
      <FormField label="Name">
        <input
          class="name-input min-w-60 w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="text"
          :value="build.name"
          @input="
            buildEditor.renameBuild(($event.target as HTMLInputElement).value)
          "
        />
      </FormField>

      <div class="buildbar-actions flex flex-wrap items-center gap-1">
        <BaseButton
          variant="primary"
          :disabled="!dirty"
          @click="buildEditor.saveActive()"
          >Save</BaseButton
        >
        <BaseButton
          :danger="confirmRevert"
          :disabled="!dirty"
          @click="onRevert"
        >
          {{ confirmRevert ? "Really revert?" : "Revert" }}
        </BaseButton>

        <span class="mx-1 h-4 w-px bg-line"></span>

        <BaseButton :active="panel === 'io'" @click="toggle('io')"
          >Import / export…</BaseButton
        >
        <BaseButton :active="panel === 'share'" @click="toggle('share')"
          >Share…</BaseButton
        >

        <span class="mx-1 h-4 w-px bg-line"></span>

        <HistoryButton
          type="undo"
          :disabled="!canUndo"
          :detail="canUndo ? undoLabel : ''"
          :title="undoTitle"
          @click="buildEditor.undo()"
          >Undo</HistoryButton
        >
        <HistoryButton
          type="redo"
          :disabled="!canRedo"
          :detail="canRedo ? redoLabel : ''"
          :title="redoTitle"
          @click="buildEditor.redo()"
          >Redo</HistoryButton
        >
      </div>
    </div>

    <BaseDrawer v-if="panel === 'io'">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h4 class="mb-1 text-sm uppercase text-muted">Export</h4>
          <CodeBlock :value="exportText" :rows="7" />
          <div class="mt-1.5 flex flex-wrap items-end gap-2">
            <BaseButton @click="copyToClipboard(exportText)"
              >Copy to clipboard</BaseButton
            >
            <BaseButton @click="downloadExport">Download .json</BaseButton>
          </div>
        </div>
        <div>
          <h4 class="mb-1 text-sm uppercase text-muted">Import</h4>
          <textarea
            v-model="importText"
            class="w-full resize-y rounded-md border border-line bg-surface p-2 font-mono"
            rows="7"
            placeholder="Paste a build, or an array of builds…"
          ></textarea>
          <div class="mt-1.5 flex flex-wrap items-end gap-2">
            <BaseButton
              variant="primary"
              :disabled="!importText.trim()"
              @click="applyImport"
              >Import</BaseButton
            >
            <input
              type="file"
              accept=".json,application/json"
              @change="onImportFile"
            />
          </div>
          <p v-if="importError" class="mt-1 text-danger">{{ importError }}</p>
          <p v-if="importNote" class="mt-1 text-ok">{{ importNote }}</p>
        </div>
      </div>
      <p class="mt-1.5 text-sm text-muted">
        Imported builds are added alongside the existing ones and always get a
        fresh id, so an import can never overwrite a build you already have.
      </p>
    </BaseDrawer>

    <BaseDrawer v-if="panel === 'share'">
      <div class="flex flex-wrap items-end gap-2">
        <input
          class="min-w-64 flex-1 rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="text"
          readonly
          :value="shareLink"
          @focus="selectAllText"
        />
        <BaseButton :disabled="!shareLink" @click="copyToClipboard(shareLink)"
          >Copy link</BaseButton
        >
      </div>
      <p v-if="shareError" class="mt-1 text-danger">{{ shareError }}</p>
      <p class="mt-1.5 text-sm text-muted">
        The whole build is compressed into the link — no server involved.
        Opening it adds a copy to the recipient's library.
      </p>
    </BaseDrawer>
  </div>
</template>
