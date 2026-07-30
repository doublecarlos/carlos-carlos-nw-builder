<script setup lang="ts">
// Slim per-build action strip: rename, save/revert, import/export JSON, share link, undo/redo.
// Switching/creating/duplicating/deleting a build lives in Library.vue's sidebar; copying a
// section between builds is a per-section control in BuildEditor.vue. This bar is left with only
// what always applies to *the build currently on screen*.
import { ref, computed, watch } from 'vue';
import * as storage from '../storage';
import * as library from '../stores/library';
import * as buildEditor from '../stores/buildEditor';
import Button from './ui/Button.vue';
import HistoryButton from './ui/HistoryButton.vue';
import Drawer from './ui/Drawer.vue';
import CodeBlock from './ui/CodeBlock.vue';
import FormField from './ui/FormField.vue';

const build = library.build;
const dirty = library.dirty;
const canUndo = buildEditor.canUndo;
const canRedo = buildEditor.canRedo;
const undoLabel = buildEditor.undoLabel;
const redoLabel = buildEditor.redoLabel;

const panel = ref('');              // '' | 'share' | 'io'
const confirmRevert = ref(false);
let confirmRevertTimer: number | undefined;
const shareLink = ref('');
const shareError = ref('');
const exportText = ref('');
const importText = ref('');
const importError = ref('');
const importNote = ref('');

const undoTitle = computed(() => (canUndo.value ? `Undo: ${undoLabel.value} (Ctrl+Z)` : 'Nothing to undo'));
const redoTitle = computed(() => (canRedo.value ? `Redo: ${redoLabel.value} (Ctrl+Shift+Z)` : 'Nothing to redo'));

// An armed "Really revert?" refers to whichever build was active when it was clicked --
// switching builds inside the 4s window must not leave it armed against a different one.
watch(() => build.value.id, () => {
  window.clearTimeout(confirmRevertTimer);
  confirmRevert.value = false;
});

/** Two-step confirm rather than a `confirm()` dialog: reverting throws away unsaved
 * edits, and a modal dialog would block the page for anything driving the UI
 * programmatically. */
function onRevert() {
  if (!confirmRevert.value) {
    confirmRevert.value = true;
    confirmRevertTimer = window.setTimeout(() => { confirmRevert.value = false; }, 4000);
    return;
  }
  window.clearTimeout(confirmRevertTimer);
  confirmRevert.value = false;
  buildEditor.revertActive();
}

async function makeShareLink() {
  shareLink.value = '';
  shareError.value = '';
  try {
    const payload = await storage.encodeShare(build.value);
    shareLink.value = storage.shareUrl(payload);
  } catch (error: any) {
    shareError.value = String(error.message ?? error);
  }
}

function toggle(name: string) {
  panel.value = panel.value === name ? '' : name;
  shareError.value = '';
  importError.value = '';
  importNote.value = '';
  if (panel.value === 'share') makeShareLink();
  if (panel.value === 'io') exportText.value = storage.toJson(build.value);
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
  const blob = new Blob([exportText.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${build.value.name.replace(/[^\w.-]+/g, '-') || 'build'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importText.value = await file.text();
  input.value = '';
  applyImport();
}

function applyImport() {
  importError.value = '';
  importNote.value = '';
  try {
    const builds = storage.parseJson(importText.value);
    library.importBuilds(builds);
    importNote.value = `imported ${builds.length} build(s)`;
    importText.value = '';
  } catch (error: any) {
    importError.value = String(error.message ?? error);
  }
}
</script>

<template>
  <div class="min-w-0 flex-1 basis-full">
    <div class="flex flex-wrap items-end gap-x-2.5 gap-y-2">
      <FormField label="Name">
        <input class="name-input min-w-60 w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
               type="text" :value="build.name"
               @input="buildEditor.renameBuild(($event.target as HTMLInputElement).value)">
      </FormField>

      <div class="buildbar-actions flex flex-wrap items-center gap-1">
        <Button variant="primary" :disabled="!dirty" @click="buildEditor.saveActive()">Save</Button>
        <Button :danger="confirmRevert" :disabled="!dirty" @click="onRevert">
          {{ confirmRevert ? 'Really revert?' : 'Revert' }}
        </Button>

        <span class="mx-1 h-4 w-px bg-line"></span>

        <Button :active="panel === 'io'" @click="toggle('io')">Import / export…</Button>
        <Button :active="panel === 'share'" @click="toggle('share')">Share…</Button>

        <span class="mx-1 h-4 w-px bg-line"></span>

        <HistoryButton type="undo" :disabled="!canUndo" :detail="canUndo ? undoLabel : ''" :title="undoTitle" @click="buildEditor.undo()">Undo</HistoryButton>
        <HistoryButton type="redo" :disabled="!canRedo" :detail="canRedo ? redoLabel : ''" :title="redoTitle" @click="buildEditor.redo()">Redo</HistoryButton>
      </div>
    </div>

    <Drawer v-if="panel === 'io'">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h4 class="mb-1 text-sm uppercase text-muted">Export</h4>
          <CodeBlock :value="exportText" :rows="7" />
          <div class="mt-1.5 flex flex-wrap items-end gap-2">
            <Button @click="copyToClipboard(exportText)">Copy to clipboard</Button>
            <Button @click="downloadExport">Download .json</Button>
          </div>
        </div>
        <div>
          <h4 class="mb-1 text-sm uppercase text-muted">Import</h4>
          <textarea class="w-full resize-y rounded-md border border-line bg-surface p-2 font-mono"
                    rows="7" v-model="importText"
                    placeholder="Paste a build, or an array of builds…"></textarea>
          <div class="mt-1.5 flex flex-wrap items-end gap-2">
            <Button variant="primary" :disabled="!importText.trim()" @click="applyImport">Import</Button>
            <input type="file" accept=".json,application/json" @change="onImportFile">
          </div>
          <p v-if="importError" class="mt-1 text-danger">{{ importError }}</p>
          <p v-if="importNote" class="mt-1 text-ok">{{ importNote }}</p>
        </div>
      </div>
      <p class="mt-1.5 text-sm text-muted">Imported builds are added alongside the existing ones and always get a
        fresh id, so an import can never overwrite a build you already have.</p>
    </Drawer>

    <Drawer v-if="panel === 'share'">
      <div class="flex flex-wrap items-end gap-2">
        <input class="min-w-64 flex-1 rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
               type="text" readonly :value="shareLink" @focus="selectAllText">
        <Button :disabled="!shareLink" @click="copyToClipboard(shareLink)">Copy link</Button>
      </div>
      <p v-if="shareError" class="mt-1 text-danger">{{ shareError }}</p>
      <p class="mt-1.5 text-sm text-muted">The whole build is compressed into the link — no server involved.
        Opening it adds a copy to the recipient's library.</p>
    </Drawer>
  </div>
</template>
