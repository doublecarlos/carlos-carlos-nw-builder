// Left sidebar (pending.md item 7): collections of builds, replacing the old dropdown-based
// build switcher in build-bar.js. A collection is a named group of build tabs that can be
// saved (browser storage or a linked file, via `window.NW.fsStore`) and exported as a whole;
// an individual build keeps its own independent save/revert (build-bar.js), unchanged.
//
// Every mutation is emitted to app.js, same discipline as every other component here -- this
// file only renders the tree and the popup menus, and reads `window.NW.storage`/`fsStore`
// directly for the read-only bits (parsing an imported build file), same as build-bar.js
// already does for its own import/export drawer.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.BuildNav = (() => {
  'use strict';

  const CONFIRM_MS = 4000;

  return {
    name: 'BuildNav',

    props: {
      collections: { type: Array, required: true },
      builds: { type: Array, required: true },
      activeCollectionId: { type: String, default: '' },
      activeId: { type: String, default: '' },
      // buildId -> bool, app.js's `dirtyByBuild` computed (mirrors the existing per-build
      // `dirty` check `build-bar.js`'s Save button already gates on).
      dirtyByBuild: { type: Object, required: true },
      // collectionId -> last-saved { name, buildIds }, app.js's `savedCollections` -- compared
      // against the live `collections` prop to decide a collection's own unsaved-dot.
      savedCollections: { type: Object, required: true },
    },

    emits: [
      'select-collection', 'select-build',
      'create-collection', 'import-collection', 'rename-collection',
      'save-collection', 'save-collection-as', 'duplicate-collection',
      'export-collection', 'delete-collection',
      'create-build', 'import-builds',
      'rename-build', 'save-build', 'revert-build', 'duplicate-build',
      'export-build', 'reset-build', 'delete-build',
    ],

    data: () => ({
      collapsed: {},          // collectionId -> true when collapsed (absent = expanded)
      openMenu: null,         // { type: 'collection'|'build', id } | null
      saveAsFor: null,        // collection id currently showing the Save As sub-panel
      renaming: null,         // { type, id } | null
      renameText: '',
      confirm: null,          // { type, id, action } | null -- two-step delete/reset
      confirmTimer: null,
      importTarget: null,     // collection id the hidden build-file input is armed for
    }),

    computed: {
      buildById() {
        return new Map(this.builds.map((build) => [build.id, build]));
      },

      fsSupported() {
        return window.NW.fsStore.supported;
      },
    },

    methods: {
      buildsIn(collection) {
        return collection.buildIds.map((id) => this.buildById.get(id)).filter(Boolean);
      },

      isExpanded(id) {
        return !this.collapsed[id];
      },

      toggleExpanded(id) {
        this.collapsed = { ...this.collapsed, [id]: !this.collapsed[id] };
      },

      /** Metadata (name/membership) differs from last saved, or any build it contains is
       * itself dirty -- either is "this collection has something unsaved in it". */
      collectionDirty(collection) {
        const saved = this.savedCollections[collection.id];
        if (!saved || saved.name !== collection.name
          || saved.buildIds.length !== collection.buildIds.length
          || saved.buildIds.some((id, index) => id !== collection.buildIds[index])) return true;
        return collection.buildIds.some((id) => this.dirtyByBuild[id]);
      },

      // --- menus ---------------------------------------------------------------------------

      isMenuOpen(type, id) {
        return this.openMenu?.type === type && this.openMenu?.id === id;
      },

      openMenuFor(type, id) {
        this.saveAsFor = null;
        this.openMenu = this.isMenuOpen(type, id) ? null : { type, id };
      },

      closeMenu() {
        this.openMenu = null;
        this.saveAsFor = null;
      },

      /** Closes any open menu/confirm when a click lands outside the sidebar entirely --
       * inside it, each control (menu, rename input) already closes itself on its own action. */
      onDocumentClick(event) {
        if (this.$el.contains(event.target)) return;
        this.closeMenu();
      },

      // --- rename (both collection and build rows share this) -------------------------------

      isRenaming(type, id) {
        return this.renaming?.type === type && this.renaming?.id === id;
      },

      startRename(type, id, name) {
        this.closeMenu();
        this.renaming = { type, id };
        this.renameText = name;
        this.$nextTick(() => this.$refs.renameInput?.[0]?.focus());
      },

      commitRename() {
        if (!this.renaming) return;
        const { type, id } = this.renaming;
        const name = this.renameText.trim();
        this.renaming = null;
        if (!name) return;
        this.$emit(type === 'collection' ? 'rename-collection' : 'rename-build', { id, name });
      },

      // --- two-step confirm for delete/reset --------------------------------------------------

      isConfirming(type, id, action) {
        return this.confirm?.type === type && this.confirm?.id === id && this.confirm?.action === action;
      },

      confirmLabel(type, id, action, label) {
        return this.isConfirming(type, id, action) ? 'Really?' : label;
      },

      runConfirmed(type, id, action) {
        if (!this.isConfirming(type, id, action)) {
          this.confirm = { type, id, action };
          window.clearTimeout(this.confirmTimer);
          this.confirmTimer = window.setTimeout(() => { this.confirm = null; }, CONFIRM_MS);
          return;
        }
        window.clearTimeout(this.confirmTimer);
        this.confirm = null;
        this.$emit(action, id);
        this.closeMenu();
      },

      // --- save as -----------------------------------------------------------------------------

      toggleSaveAs(id) {
        this.saveAsFor = this.saveAsFor === id ? null : id;
      },

      saveAsStorage(id) {
        this.$emit('duplicate-collection', id);
        this.closeMenu();
      },

      saveAsFile(id) {
        this.$emit('save-collection-as', { id, target: 'file' });
        this.closeMenu();
      },

      // --- import --------------------------------------------------------------------------

      triggerImportBuild(collectionId) {
        this.importTarget = collectionId;
        this.$refs.buildFileInput.click();
      },

      async onImportBuildFile(event) {
        const file = event.target.files?.[0];
        const collectionId = this.importTarget;
        event.target.value = '';
        if (!file || !collectionId) return;
        // Parsing (and its error notice) happens in app.js's `importBuildsIn` -- same `notice`
        // channel as every other library-level error here, rather than a blocking alert().
        this.$emit('import-builds', { collectionId, text: await file.text() });
      },

      triggerImportCollection() {
        this.$refs.collectionFileInput.click();
      },

      async onImportCollectionFile(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        this.$emit('import-collection', await file.text());
      },
    },

    mounted() {
      document.addEventListener('mousedown', this.onDocumentClick);
    },

    unmounted() {
      window.clearTimeout(this.confirmTimer);
      document.removeEventListener('mousedown', this.onDocumentClick);
    },

    template: `
      <nav class="build-nav">
        <div v-for="collection in collections" :key="collection.id" class="nav-collection">
          <div class="nav-row nav-row--collection" :class="{ 'is-active': collection.id === activeCollectionId }">
            <button type="button" class="nav-chevron" @click="toggleExpanded(collection.id)">
              {{ isExpanded(collection.id) ? '▾' : '▸' }}
            </button>

            <input v-if="isRenaming('collection', collection.id)" ref="renameInput" v-model="renameText"
                   class="nav-rename" @keydown.enter="commitRename" @keydown.esc="renaming = null"
                   @blur="commitRename">
            <button v-else type="button" class="nav-name" @click="$emit('select-collection', collection.id)"
                    @dblclick="startRename('collection', collection.id, collection.name)"
                    @contextmenu.prevent="openMenuFor('collection', collection.id)">
              {{ collection.name }}
            </button>

            <span v-if="collectionDirty(collection)" class="unsaved-dot" title="Unsaved changes"></span>

            <div class="nav-menu-wrap">
              <button type="button" class="nav-kebab" title="Collection menu"
                      @click="openMenuFor('collection', collection.id)">⋮</button>

              <div v-if="isMenuOpen('collection', collection.id)" class="navmenu">
                <button type="button" class="navmenu-item"
                        @click="startRename('collection', collection.id, collection.name)">Rename</button>
                <button type="button" class="navmenu-item" @click="$emit('save-collection', collection.id); closeMenu()">
                  Save
                </button>
                <button type="button" class="navmenu-item" @click="toggleSaveAs(collection.id)">Save As…</button>
                <div v-if="saveAsFor === collection.id" class="nav-saveas">
                  <button type="button" class="navmenu-item" @click="saveAsStorage(collection.id)">
                    Browser storage (new copy)
                  </button>
                  <button type="button" class="navmenu-item" :disabled="!fsSupported"
                          :title="fsSupported ? '' : 'This browser cannot keep a file linked -- use Export instead'"
                          @click="saveAsFile(collection.id)">
                    File on this PC…
                  </button>
                </div>
                <button type="button" class="navmenu-item"
                        @click="$emit('duplicate-collection', collection.id); closeMenu()">Duplicate</button>
                <button type="button" class="navmenu-item"
                        @click="$emit('export-collection', collection.id); closeMenu()">Export…</button>
                <button type="button" class="navmenu-item navmenu-item--danger"
                        @click="runConfirmed('collection', collection.id, 'delete-collection')">
                  {{ confirmLabel('collection', collection.id, 'delete-collection', 'Delete') }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="isExpanded(collection.id)" class="nav-builds">
            <div v-for="build in buildsIn(collection)" :key="build.id" class="nav-row nav-row--build"
                 :class="{ 'is-active': build.id === activeId }">
              <input v-if="isRenaming('build', build.id)" ref="renameInput" v-model="renameText"
                     class="nav-rename" @keydown.enter="commitRename" @keydown.esc="renaming = null"
                     @blur="commitRename">
              <button v-else type="button" class="nav-name"
                      @click="$emit('select-build', { collectionId: collection.id, id: build.id })"
                      @dblclick="startRename('build', build.id, build.name)"
                      @contextmenu.prevent="openMenuFor('build', build.id)">
                {{ build.name }}
              </button>

              <span v-if="dirtyByBuild[build.id]" class="unsaved-dot" title="Unsaved changes"></span>

              <div class="nav-menu-wrap">
                <button type="button" class="nav-kebab" title="Build menu"
                        @click="openMenuFor('build', build.id)">⋮</button>

                <div v-if="isMenuOpen('build', build.id)" class="navmenu">
                  <button type="button" class="navmenu-item"
                          @click="startRename('build', build.id, build.name)">Rename</button>
                  <button type="button" class="navmenu-item"
                          :disabled="!dirtyByBuild[build.id]"
                          @click="$emit('save-build', build.id); closeMenu()">Save</button>
                  <button type="button" class="navmenu-item"
                          :disabled="!dirtyByBuild[build.id]"
                          @click="$emit('revert-build', build.id); closeMenu()">Revert</button>
                  <button type="button" class="navmenu-item"
                          @click="$emit('duplicate-build', build.id); closeMenu()">Duplicate</button>
                  <button type="button" class="navmenu-item"
                          @click="$emit('export-build', build.id); closeMenu()">Export…</button>
                  <button type="button" class="navmenu-item"
                          @click="runConfirmed('build', build.id, 'reset-build')">
                    {{ confirmLabel('build', build.id, 'reset-build', 'Reset') }}
                  </button>
                  <button type="button" class="navmenu-item navmenu-item--danger"
                          :disabled="buildsIn(collection).length < 2"
                          @click="runConfirmed('build', build.id, 'delete-build')">
                    {{ confirmLabel('build', build.id, 'delete-build', 'Delete') }}
                  </button>
                </div>
              </div>
            </div>

            <div class="nav-row nav-row--actions">
              <button type="button" class="link" @click="$emit('create-build', collection.id)">+ New build</button>
              <button type="button" class="link" @click="triggerImportBuild(collection.id)">Import</button>
            </div>
          </div>
        </div>

        <div class="nav-row nav-row--actions nav-row--top">
          <button type="button" class="link" @click="$emit('create-collection')">+ New collection</button>
          <button type="button" class="link" @click="triggerImportCollection">Import collection</button>
        </div>

        <input ref="buildFileInput" type="file" accept=".json,application/json" class="nav-hidden-file"
               @change="onImportBuildFile">
        <input ref="collectionFileInput" type="file" accept=".json,application/json" class="nav-hidden-file"
               @change="onImportCollectionFile">
      </nav>
    `,
  };
})();
