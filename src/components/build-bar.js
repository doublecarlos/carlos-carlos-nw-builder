// Build management strip (plan §Phase 4): switch, duplicate, delete, copy a section between
// builds, import/export JSON, share link, undo/redo.
//
// Read-only operations (encoding a share link, serialising to JSON) are done here directly.
// Anything that *changes* a build is emitted to app.js instead, so every mutation still passes
// through the one place the undo stack watches.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.BuildBar = (() => {
  'use strict';

  return {
    name: 'BuildBar',

    props: {
      builds: { type: Array, required: true },
      build: { type: Object, required: true },
      sections: { type: Array, required: true },
      canUndo: { type: Boolean, default: false },
      canRedo: { type: Boolean, default: false },
      undoLabel: { type: String, default: '' },
      redoLabel: { type: String, default: '' },
    },

    emits: ['select', 'create', 'duplicate', 'remove', 'rename', 'copy-section', 'import',
      'undo', 'redo'],

    data: () => ({
      panel: '',              // '' | 'copy' | 'share' | 'io'
      confirmDelete: false,
      confirmTimer: null,
      copyFromId: '',
      copySections: [],
      shareLink: '',
      shareError: '',
      exportText: '',
      importText: '',
      importError: '',
      importNote: '',
    }),

    computed: {
      others() {
        return this.builds.filter((build) => build.id !== this.build.id);
      },

      undoTitle() {
        return this.canUndo ? `Undo: ${this.undoLabel} (Ctrl+Z)` : 'Nothing to undo';
      },

      redoTitle() {
        return this.canRedo ? `Redo: ${this.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo';
      },
    },

    methods: {
      /**
       * Two-step delete rather than a `confirm()` dialog: deleting a build is the one
       * irreversible action here (undo is scoped to edits within a build), and a modal dialog
       * would block the page for anything driving the UI programmatically.
       */
      onDelete() {
        if (!this.confirmDelete) {
          this.confirmDelete = true;
          this.confirmTimer = window.setTimeout(() => { this.confirmDelete = false; }, 4000);
          return;
        }
        window.clearTimeout(this.confirmTimer);
        this.confirmDelete = false;
        this.$emit('remove');
      },

      toggle(panel) {
        this.panel = this.panel === panel ? '' : panel;
        this.shareError = '';
        this.importError = '';
        this.importNote = '';
        if (this.panel === 'share') this.makeShareLink();
        if (this.panel === 'io') this.exportText = window.NW.storage.toJson(this.build);
        if (this.panel === 'copy') {
          this.copyFromId = this.others[0]?.id ?? '';
          this.copySections = [];
        }
      },

      async makeShareLink() {
        this.shareLink = '';
        this.shareError = '';
        try {
          const payload = await window.NW.storage.encodeShare(this.build);
          this.shareLink = window.NW.storage.shareUrl(payload);
        } catch (error) {
          this.shareError = String(error.message ?? error);
        }
      },

      selectAllText(event) {
        event.target.select();
      },

      async copyToClipboard(text) {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Clipboard permission denied. The text is on screen and already selected, so the
          // user can copy it by hand -- no need to interrupt them.
        }
      },

      applyCopySection() {
        if (!this.copyFromId || !this.copySections.length) return;
        this.$emit('copy-section', { fromId: this.copyFromId, sectionIds: [...this.copySections] });
        this.panel = '';
      },

      downloadExport() {
        const blob = new Blob([this.exportText], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this.build.name.replace(/[^\w.-]+/g, '-') || 'build'}.json`;
        link.click();
        URL.revokeObjectURL(url);
      },

      async onImportFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        this.importText = await file.text();
        event.target.value = '';
        this.applyImport();
      },

      applyImport() {
        this.importError = '';
        this.importNote = '';
        try {
          const builds = window.NW.storage.parseJson(this.importText);
          this.$emit('import', builds);
          this.importNote = `imported ${builds.length} build(s)`;
          this.importText = '';
        } catch (error) {
          this.importError = String(error.message ?? error);
        }
      },
    },

    template: `
      <div class="buildbar">
        <div class="buildbar-row">
          <label class="field">
            <span class="field-label">Build</span>
            <select class="build-select" :value="build.id"
                    @change="$emit('select', $event.target.value)">
              <option v-for="item in builds" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">Name</span>
            <input class="name-input" type="text" :value="build.name"
                   @input="$emit('rename', $event.target.value)">
          </label>

          <div class="buildbar-actions">
            <button type="button" class="btn" @click="$emit('create')">New</button>
            <button type="button" class="btn" @click="$emit('duplicate')">Duplicate</button>
            <button type="button" class="btn" :class="{ 'is-danger': confirmDelete }"
                    :disabled="builds.length < 2" @click="onDelete">
              {{ confirmDelete ? 'Really delete?' : 'Delete' }}
            </button>

            <span class="sep"></span>

            <button type="button" class="btn" :class="{ 'is-on': panel === 'copy' }"
                    :disabled="others.length === 0" @click="toggle('copy')">Copy section…</button>
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

        <!-- copy a section between builds. Slot-id keyed, so it cannot misalign the way a
             spreadsheet range paste can. -->
        <div v-if="panel === 'copy'" class="drawer">
          <div class="drawer-row">
            <label class="field">
              <span class="field-label">Copy from</span>
              <select v-model="copyFromId">
                <option v-for="item in others" :key="item.id" :value="item.id">{{ item.name }}</option>
              </select>
            </label>
            <button type="button" class="btn btn--primary"
                    :disabled="!copySections.length" @click="applyCopySection">
              Copy {{ copySections.length }} section(s) into “{{ build.name }}”
            </button>
            <button type="button" class="link" @click="copySections = sections.map(s => s.id)">
              all
            </button>
            <button type="button" class="link" @click="copySections = []">none</button>
          </div>
          <div class="drawer-grid">
            <label v-for="section in sections" :key="section.id" class="check">
              <input type="checkbox" :value="section.id" v-model="copySections">
              <span>{{ section.label }}</span>
            </label>
          </div>
          <p class="hint">Replaces every slot in the chosen sections, including clearing ones
            the source build leaves empty.</p>
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
    `,
  };
})();
