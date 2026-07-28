<script setup lang="ts">
// Slim per-build action strip: rename, save/revert, import/export JSON, share link, undo/redo.
//
// Switching/creating/duplicating/deleting a build, and copying a section from another build,
// live in BuildNav.vue's sidebar (the former resp. per-section controls in SlotList.vue) --
// this bar is left with only what always applies to *the build currently on screen*.
//
// Read-only operations (encoding a share link, serialising to JSON) are done here directly.
// Anything that *changes* a build is emitted to app.js instead, so every mutation still passes
// through the one place the undo stack watches.
import { ref, computed, watch } from 'vue';
import * as storage from '../storage';

const props = withDefaults(defineProps<{
  build: any;
  canUndo?: boolean;
  canRedo?: boolean;
  undoLabel?: string;
  redoLabel?: string;
  dirty?: boolean;
}>(), {
  canUndo: false,
  canRedo: false,
  undoLabel: '',
  redoLabel: '',
  dirty: false,
});

const emit = defineEmits<{
  rename: [value: string];
  import: [builds: any[]];
  undo: [];
  redo: [];
  save: [];
  revert: [];
}>();

const panel = ref('');              // '' | 'share' | 'io'
const confirmRevert = ref(false);
let confirmRevertTimer: number | undefined;
const shareLink = ref('');
const shareError = ref('');
const exportText = ref('');
const importText = ref('');
const importError = ref('');
const importNote = ref('');

const undoTitle = computed(() => (props.canUndo ? `Undo: ${props.undoLabel} (Ctrl+Z)` : 'Nothing to undo'));
const redoTitle = computed(() => (props.canRedo ? `Redo: ${props.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'));

// An armed "Really revert?" refers to whichever build was active when it was clicked --
// switching builds inside the 4s window must not leave it armed against a different one.
watch(() => props.build.id, () => {
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
  emit('revert');
}

async function makeShareLink() {
  shareLink.value = '';
  shareError.value = '';
  try {
    const payload = await storage.encodeShare(props.build);
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
  if (panel.value === 'io') exportText.value = storage.toJson(props.build);
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
  link.download = `${props.build.name.replace(/[^\w.-]+/g, '-') || 'build'}.json`;
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
    emit('import', builds);
    importNote.value = `imported ${builds.length} build(s)`;
    importText.value = '';
  } catch (error: any) {
    importError.value = String(error.message ?? error);
  }
}
</script>

<template>
  <div class="buildbar">
    <div class="buildbar-row">
      <label class="field">
        <span class="field-label">Name</span>
        <input class="name-input" type="text" :value="build.name"
               @input="$emit('rename', ($event.target as HTMLInputElement).value)">
      </label>

      <div class="buildbar-actions">
        <button type="button" class="btn btn--primary" :disabled="!dirty"
                @click="$emit('save')">Save</button>
        <button type="button" class="btn" :class="{ 'is-danger': confirmRevert }"
                :disabled="!dirty" @click="onRevert">
          {{ confirmRevert ? 'Really revert?' : 'Revert' }}
        </button>

        <span class="sep"></span>

        <button type="button" class="btn" :class="{ 'is-on': panel === 'io' }"
                @click="toggle('io')">Import / export…</button>
        <button type="button" class="btn" :class="{ 'is-on': panel === 'share' }"
                @click="toggle('share')">Share…</button>

        <span class="sep"></span>

        <button type="button" class="btn btn--history" :disabled="!canUndo"
                :title="undoTitle" @click="$emit('undo')">
          ↶ Undo<span v-if="canUndo" class="btn-detail">{{ undoLabel }}</span>
        </button>
        <button type="button" class="btn btn--history" :disabled="!canRedo"
                :title="redoTitle" @click="$emit('redo')">
          ↷ Redo<span v-if="canRedo" class="btn-detail">{{ redoLabel }}</span>
        </button>
      </div>
    </div>

    <div v-if="panel === 'io'" class="drawer">
      <div class="drawer-cols">
        <div>
          <h4 class="drawer-head">Export</h4>
          <textarea class="code" rows="7" readonly :value="exportText"
                    @focus="selectAllText"></textarea>
          <div class="drawer-row">
            <button type="button" class="btn" @click="copyToClipboard(exportText)">
              Copy to clipboard
            </button>
            <button type="button" class="btn" @click="downloadExport">Download .json</button>
          </div>
        </div>
        <div>
          <h4 class="drawer-head">Import</h4>
          <textarea class="code" rows="7" v-model="importText"
                    placeholder="Paste a build, or an array of builds…"></textarea>
          <div class="drawer-row">
            <button type="button" class="btn btn--primary" :disabled="!importText.trim()"
                    @click="applyImport">Import</button>
            <input type="file" accept=".json,application/json" @change="onImportFile">
          </div>
          <p v-if="importError" class="drawer-error">{{ importError }}</p>
          <p v-if="importNote" class="drawer-note">{{ importNote }}</p>
        </div>
      </div>
      <p class="hint">Imported builds are added alongside the existing ones and always get a
        fresh id, so an import can never overwrite a build you already have.</p>
    </div>

    <div v-if="panel === 'share'" class="drawer">
      <div class="drawer-row">
        <input class="share-input" type="text" readonly :value="shareLink"
               @focus="selectAllText">
        <button type="button" class="btn" :disabled="!shareLink"
                @click="copyToClipboard(shareLink)">Copy link</button>
      </div>
      <p v-if="shareError" class="drawer-error">{{ shareError }}</p>
      <p class="hint">The whole build is compressed into the link — no server involved.
        Opening it adds a copy to the recipient's library.</p>
    </div>
  </div>
</template>
