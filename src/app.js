// Root component and mount (plan §4.2).
//
// State container, as recommended in the handoff §8.2: one reactive build document plus a
// `computed` that calls `resolveBuild`. No store library -- they need a bundler, and
// `resolveBuild` is pure and ~2 ms, so recomputing the whole result on every keystroke is
// cheaper than any incremental machinery would be (handoff §6).
//
// Every mutation goes through a method here rather than being written into the build from a
// child component. That is what makes the undo stack a dozen lines instead of a subsystem:
// `snapshot()` runs at exactly one layer, and nothing can edit a build behind its back.

window.NW = window.NW ?? {};

(() => {
  'use strict';

  const { createApp, markRaw } = window.Vue;
  const storage = window.NW.storage;
  const router = window.NW.router;
  const fmt = window.NW.format;

  // Context keys whose title-cased name would read oddly in an undo tooltip.
  const FIELD_LABELS = {
    combatType: 'Combat type',
    damageType: 'Damage type',
    m32Forte: 'M32 Forte',
    duration: 'Duration (s)',
  };

  const FORTE_LABELS = { primary: 'Forte 1', secondaryA: 'Forte 2A', secondaryB: 'Forte 2B' };

  const SAVE_DEBOUNCE_MS = 250;
  const UNDO_LIMIT = 50;

  // Consecutive edits of the same thing inside this window collapse into one undo step, so
  // typing 3589 into a number field is one undo, not four.
  const COALESCE_MS = 700;

  const app = createApp({
    components: {
      BuildBar: window.NW.components.BuildBar,
      BuildNav: window.NW.components.BuildNav,
      BonusInspector: window.NW.components.BonusInspector,
      ComboBox: window.NW.components.ComboBox,
      DataEditor: window.NW.components.DataEditor,
      QuickOptions: window.NW.components.QuickOptions,
      SlotList: window.NW.components.SlotList,
      StatPanel: window.NW.components.StatPanel,
    },

    data() {
      // `builds`/`build` is the live, possibly-unsaved draft, loaded from its own key so a
      // reload never loses work in progress. `savedById` is the last-saved copy of each build
      // (the `nw:builds` library) -- `dirty` compares the active build against its entry here.
      const savedLibrary = storage.loadLibrary();
      const draftLibrary = storage.loadDraft(savedLibrary);

      // Collections are a grouping layer over the flat pool above -- see storage.js's own
      // "--- collections ---" section comment. Same draft/saved split, same reasoning.
      const savedCollectionsState = storage.loadCollections(savedLibrary.builds);
      const draftCollectionsState = storage.loadCollectionsDraft(draftLibrary.builds, savedCollectionsState);

      // A `?build=`/`collection=`/`view=`/`tab=` from the URL (a refresh, or a back/forward
      // landing here) wins over the draft's own idea of what was active, as long as it still
      // exists -- a specific `build=` wins over `collection=` (jumping to a build implies
      // jumping to whichever collection actually owns it).
      const route = router.parse();
      const ownerOf = (buildId) => draftCollectionsState.collections.find((c) => c.buildIds.includes(buildId));

      let activeId;
      let activeCollectionId;
      const owner = route.build && draftLibrary.builds.some((b) => b.id === route.build) && ownerOf(route.build);
      if (owner) {
        activeId = route.build;
        activeCollectionId = owner.id;
      } else {
        activeCollectionId = draftCollectionsState.collections.some((c) => c.id === route.collection)
          ? route.collection
          : draftCollectionsState.activeCollectionId;
        const collection = draftCollectionsState.collections.find((c) => c.id === activeCollectionId);
        activeId = collection.buildIds.includes(collection.activeBuildId)
          ? collection.activeBuildId
          : collection.buildIds[0];
      }

      const savedById = {};
      for (const build of savedLibrary.builds) savedById[build.id] = build;
      const savedCollections = {};
      for (const collection of savedCollectionsState.collections) savedCollections[collection.id] = collection;

      return {
        builds: draftLibrary.builds,
        activeId,
        savedById,
        collections: draftCollectionsState.collections,
        activeCollectionId,
        savedCollections,
        // FileSystemFileHandle per collection id, for collections linked to a file on disk
        // (BuildNav's collection menu -> Save As -> File on this PC). Populated lazily --
        // never eagerly from `fsStore`'s IndexedDB on load, since using a handle needs a user
        // gesture (Chromium re-checks permission per session) anyway, so there's nothing to
        // gain by fetching it before a Save is actually clicked.
        fileLinks: {},
        // The editor's layer over the shipped catalogue. Persisted separately from builds --
        // it is a workspace, not part of any one build.
        workspaceOverlay: storage.loadOverlay(),
        view: route.view === 'editor' ? 'editor' : 'builder',        // 'builder' | 'editor'

        // buildId -> { past, future, … } of JSON snapshots. Per build, so switching away and
        // back preserves what you could undo. Strings, so Vue does not deep-proxy 50 copies.
        // Never persisted: history is a session concept, not part of the document.
        histories: {},

        tab: route.tab === 'bonuses' ? 'bonuses' : 'stats',
        saveTimer: null,
        collectionsSaveTimer: null,
        noticeTimer: null,
        topbarObserver: null,
        notice: '',
        storageFailed: false,
      };
    },

    computed: {
      build() {
        return this.builds.find((build) => build.id === this.activeId) ?? this.builds[0];
      },

      activeCollection() {
        return this.collections.find((c) => c.id === this.activeCollectionId) ?? this.collections[0];
      },

      /** buildId -> bool, for BuildNav's per-tab unsaved-dot -- same comparison `dirty` below
       * already does for just the active build, extended to every build in the pool. */
      dirtyByBuild() {
        const map = {};
        for (const build of this.builds) map[build.id] = !storage.sameBuild(build, this.savedById[build.id]);
        return map;
      },

      /** The active collection's other builds, for slot-list.js's per-section "copy from"
       * control. Scoped to the collection (not every build in the app) -- collections exist
       * to group related builds, and that's the set a "copy a section over" is actually
       * useful against. */
      otherBuildsInCollection() {
        const ids = new Set(this.activeCollection.buildIds);
        return this.builds
          .filter((build) => build.id !== this.activeId && ids.has(build.id))
          .map((build) => ({ value: build.id, label: build.name }));
      },

      /**
       * Catalogue layers, lowest priority first. The shipped data is the base (inside
       * `catalog.makeDb`); everything here is folded over it.
       *
       * Custom gear saved with a build slots in as one more entry —
       * `this.build.catalog` — and nothing else in the app has to change. `storage.normalise`
       * already preserves that key on a build so it survives a save/reload round trip.
       */
      overlays() {
        return [this.workspaceOverlay, this.build.catalog].filter(Boolean);
      },

      /**
       * markRaw: 369 items plus several Maps. Vue deep-proxying it would cost more than the
       * whole calculation. Rebuilt only when a layer actually changes -- indexing is well
       * under a millisecond, so there is no reason to be cleverer than this.
       */
      db() {
        return markRaw(window.NW.catalog.makeDb(this.overlays));
      },

      /**
       * The engine is verified, so a throw here is a bug worth seeing rather than hiding --
       * but it must not blank the page, or there would be nothing left to debug with.
       */
      resolved() {
        try {
          return { ok: true, result: window.NW.engine.resolveBuild(this.db, this.build) };
        } catch (error) {
          return { ok: false, message: String(error), stack: error?.stack ?? '' };
        }
      },

      filledSlots() {
        return Object.values(this.build.choices).filter(Boolean).length;
      },

      // --- quick compare ----------------------------------------------------------------------
      // Picker + toggles live on `build.compare` -- saved with the build (storage.js), not
      // session state -- so reopening a build remembers what it was being sized up against.

      compareOptions() {
        return [
          { value: '', label: '— none —' },
          ...this.builds.filter((b) => b.id !== this.activeId).map((b) => ({ value: b.id, label: b.name })),
        ];
      },

      compareBuild() {
        const id = this.build.compare.id;
        if (!id || id === this.activeId) return null;
        return this.builds.find((b) => b.id === id) ?? null;
      },

      /**
       * Resolved against the *active* build's own `db`, not one composed for the compare
       * build's own `catalog` -- this is a quick "how does this other build stack up" glance,
       * not the editor's per-build custom-gear machinery. A compare build whose custom items
       * live only in its own catalog would show those slots as unresolved; acceptable for what
       * this is.
       */
      compareResolved() {
        if (!this.compareBuild) return null;
        try {
          return { ok: true, result: window.NW.engine.resolveBuild(this.db, this.compareBuild) };
        } catch (error) {
          return { ok: false, message: String(error) };
        }
      },

      /** Summarised here so the tab can show it without mounting the inspector. */
      bonusCounts() {
        if (!this.resolved.ok) return { total: 0, active: 0, nearMiss: 0 };
        const all = this.resolved.result.bonuses;
        return {
          total: all.length,
          active: all.filter((bonus) => bonus.active).length,
          nearMiss: all.filter((bonus) => !bonus.active && !bonus.excluded
            && (bonus.gate?.unmet?.length ?? 0) === 1).length,
        };
      },

      // Read without creating: a computed must not mutate state, so these tolerate a build
      // that has not been edited yet and therefore has no history entry.
      overlayCount() {
        return Object.keys(this.workspaceOverlay.items ?? {}).length
          + Object.keys(this.workspaceOverlay.bonusSets ?? {}).length;
      },

      canUndo() { return (this.histories[this.activeId]?.past.length ?? 0) > 0; },
      canRedo() { return (this.histories[this.activeId]?.future.length ?? 0) > 0; },

      /** Compared against the saved copy, not a plain equality: `storage.sameBuild` is
       * key-order-insensitive and ignores `updated`, or a save-then-revert (or a build the
       * `updated` stamp alone touched) would read as still dirty. */
      dirty() { return !storage.sameBuild(this.build, this.savedById[this.activeId]); },

      /** What the buttons would actually reverse, for their tooltips. */
      undoLabel() {
        const past = this.histories[this.activeId]?.past;
        return past?.length ? past[past.length - 1].label : '';
      },

      redoLabel() {
        const future = this.histories[this.activeId]?.future;
        return future?.length ? future[future.length - 1].label : '';
      },
    },

    watch: {
      // The draft autosaves continuously -- this is "don't lose work on a reload", not "save
      // my changes"; that is `saveActive()`, wired to the Save button.
      builds: {
        deep: true,
        handler() {
          window.clearTimeout(this.saveTimer);
          this.saveTimer = window.setTimeout(() => this.saveDraft(), SAVE_DEBOUNCE_MS);
        },
      },
      // Same continuous "don't lose this on a reload" autosave as `builds` above, for the
      // collections grouping (creating/renaming/reordering) rather than build content.
      collections: {
        deep: true,
        handler() {
          window.clearTimeout(this.collectionsSaveTimer);
          this.collectionsSaveTimer = window.setTimeout(() => this.saveCollectionsDraft(), SAVE_DEBOUNCE_MS);
        },
      },
      // Every one of these is either a deliberate navigation (switch build, open/close the
      // editor) or, via `applyRoute`, the URL catching us up after the user already navigated
      // with the browser's own back/forward -- `router.apply`'s no-op guard means the latter
      // case can't turn into a duplicate history entry.
      activeId() { this.saveDraft(); this.syncRoute(); },
      activeCollectionId() { this.saveCollectionsDraft(); this.syncRoute(); },
      view() { this.syncRoute(); },
      // The sidebar tab is a lighter switch than a build/view change -- it still belongs in
      // the URL for a refresh to restore, but it would clutter the back button if every click
      // were its own stop.
      tab() { this.syncRoute({ push: false }); },

      notice(value) {
        window.clearTimeout(this.noticeTimer);
        if (value) this.noticeTimer = window.setTimeout(() => { this.notice = ''; }, 6000);
      },

      workspaceOverlay: {
        deep: true,
        handler(value) { storage.saveOverlay(value); },
      },
    },

    mounted() {
      this.measureTopbar();
      window.addEventListener('keydown', this.onKeydown);
      window.addEventListener('popstate', this.onPopState);
      // Establishes the canonical `?view=&build=&tab=` for a first-ever visit, without
      // pushing a history entry for it.
      this.syncRoute({ push: false });
      this.consumeShareLink();
    },

    unmounted() {
      this.topbarObserver?.disconnect();
      window.removeEventListener('keydown', this.onKeydown);
      window.removeEventListener('popstate', this.onPopState);
    },

    methods: {
      // --- undo -----------------------------------------------------------------------------

      /** The active build's history, created on first use. */
      historyFor(id = this.activeId) {
        let history = this.histories[id];
        if (!history) {
          history = { past: [], future: [], lastKey: null, lastAt: 0 };
          this.histories[id] = history;
        }
        return history;
      },

      /** A deleted build's history would otherwise sit in memory forever. */
      dropHistory(id) {
        delete this.histories[id];
      },

      /**
       * Record the build as it is *before* a change. `key` identifies the thing being edited
       * so repeated edits of one field coalesce; pass a unique key to force a distinct step.
       * `label` describes the change in the user's words and ends up in the undo tooltip.
       *
       * Coalesced edits keep the first label, which is correct: a matching key means the same
       * field, so "Duration → 45" still names the step even after it becomes "→ 4500".
       */
      snapshot(key, label) {
        const history = this.historyFor();
        const now = Date.now();
        const coalesce = key != null
          && key === history.lastKey
          && now - history.lastAt < COALESCE_MS
          && history.past.length > 0;

        if (!coalesce) {
          history.past.push({ json: JSON.stringify(this.build), label });
          if (history.past.length > UNDO_LIMIT) history.past.shift();
        }
        history.lastKey = key;
        history.lastAt = now;
        history.future.length = 0;
      },

      /** Slot ids are internal; the tooltip should say "Ring 1", not "gear.ring1". */
      slotLabel(slotId) {
        return this.db.slotById.get(slotId)?.label ?? slotId;
      },

      replaceActive(build) {
        const index = this.builds.findIndex((item) => item.id === this.activeId);
        if (index === -1) this.builds.push(build);
        else this.builds.splice(index, 1, build);
        this.activeId = build.id;
      },

      // The label travels with the state it describes, so after undoing "Duration → 45" the
      // redo button offers exactly that same step back.
      undo() {
        if (!this.canUndo) return;
        const history = this.historyFor();
        const entry = history.past.pop();
        history.future.push({ json: JSON.stringify(this.build), label: entry.label });
        this.replaceActive(JSON.parse(entry.json));
        history.lastKey = null;
      },

      redo() {
        if (!this.canRedo) return;
        const history = this.historyFor();
        const entry = history.future.pop();
        history.past.push({ json: JSON.stringify(this.build), label: entry.label });
        this.replaceActive(JSON.parse(entry.json));
        history.lastKey = null;
      },

      onKeydown(event) {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const key = event.key.toLowerCase();
        if (key !== 'z' && key !== 'y') return;

        // Leave the browser's own undo alone inside free-text fields, where the user means
        // "undo my typing" rather than "undo my last build edit".
        const target = event.target;
        if (target?.tagName === 'TEXTAREA' || target?.classList?.contains('name-input')) return;

        event.preventDefault();
        if (key === 'y' || event.shiftKey) this.redo();
        else this.undo();
      },

      // --- build edits ----------------------------------------------------------------------

      setChoice(slotId, name) {
        const slot = this.slotLabel(slotId);
        this.snapshot(`choice:${slotId}`, name ? `${slot} → ${name}` : `clear ${slot}`);
        if (name) {
          this.build.choices[slotId] = name;
        } else {
          delete this.build.choices[slotId];
          delete this.build.values[slotId];
        }
      },

      setValue(slotId, raw) {
        this.snapshot(`value:${slotId}`, `${this.slotLabel(slotId)} value`);
        if (raw === '' || raw == null) delete this.build.values[slotId];
        else this.build.values[slotId] = Number(raw);
      },

      /** The quick-compare picker's row: this build's slot made to match the compare build's,
       * choice and typed value together, in one undo step. Unlike `setChoice`, silently no-ops
       * with nothing selected to compare against -- the "apply" link only exists on a row a
       * compare build is already lighting up. */
      applyFromCompare(slotId) {
        const other = this.compareBuild;
        if (!other) return;
        const slot = this.slotLabel(slotId);
        const name = other.choices[slotId] || '';
        this.snapshot(`choice:${slotId}`,
          name ? `${slot} → ${name} (from “${other.name}”)` : `clear ${slot} (from “${other.name}”)`);
        if (name) {
          this.build.choices[slotId] = name;
          const value = other.values?.[slotId];
          if (value != null) this.build.values[slotId] = value;
          else delete this.build.values[slotId];
        } else {
          delete this.build.choices[slotId];
          delete this.build.values[slotId];
        }
      },

      // Picker + toggles are a view preference, not a build edit -- saved with the build (so
      // reopening it remembers what it was compared against) but deliberately not run through
      // `snapshot()`, so flipping them never costs an undo step.
      setCompareBuild(id) {
        this.build.compare.id = id;
      },

      setCompareFlag(key, value) {
        this.build.compare[key] = value;
      },

      // Same reasoning as compare above: which sections are open is saved with the build, but
      // toggling one is not a "build edit" worth an undo step.
      toggleSection(sectionId) {
        this.build.expanded[sectionId] = !this.build.expanded[sectionId];
      },

      /** "expand all"/"collapse all" -- `db.sections` only, same as before: the Options header
       * isn't a real section and has never been part of this. */
      setExpanded(open) {
        for (const section of this.db.sections) this.build.expanded[section.id] = open;
      },

      setContext(key, value) {
        const name = FIELD_LABELS[key] ?? fmt.titleCase(key);
        const shown = typeof value === 'boolean'
          ? (value ? 'on' : 'off')
          : fmt.titleCase(String(value));
        this.snapshot(`context:${key}`, `${name} → ${shown}`);
        this.build.context[key] = value;
      },

      setToggle(name, value) {
        this.snapshot(`toggle:${name}`, `${fmt.titleCase(name)} ${value ? 'on' : 'off'}`);
        this.build.context.toggles[name] = value;
      },

      setForte(slot, statKey) {
        const target = statKey ? fmt.label(statKey) : 'none';
        this.snapshot(`forte:${slot}`, `${FORTE_LABELS[slot] ?? slot} → ${target}`);
        if (statKey) this.build.context.forte[slot] = statKey;
        else delete this.build.context.forte[slot];
      },

      renameBuild(name) {
        this.snapshot('name', 'rename build');
        this.build.name = name;
      },

      clearSlots() {
        this.snapshot(null, `clear all ${this.filledSlots} slots`);
        this.build.choices = {};
        this.build.values = {};
      },

      resetAll() {
        this.snapshot(null, 'reset build');
        const fresh = storage.defaultBuild(this.build.name);
        fresh.id = this.build.id;
        this.replaceActive(fresh);
      },

      // --- library --------------------------------------------------------------------------

      // Switching, creating and importing never touch history: each build keeps its own, and
      // a build that has just been created has nothing to undo to yet.

      /** BuildNav's own collection row. */
      selectCollection(id) {
        const collection = this.collections.find((c) => c.id === id);
        if (!collection) return;
        this.activeCollectionId = id;
        this.activeId = collection.buildIds.includes(collection.activeBuildId)
          ? collection.activeBuildId
          : collection.buildIds[0];
      },

      /** BuildNav's own build row -- also remembers it as that collection's own `activeBuildId`,
       * so reopening the collection later returns to the same tab. */
      selectBuild(collectionId, id) {
        const collection = this.collections.find((c) => c.id === collectionId);
        if (!collection || !collection.buildIds.includes(id)) return;
        this.activeCollectionId = collectionId;
        this.activeId = id;
        collection.activeBuildId = id;
      },

      /** The build tab menu's own actions (save/revert/duplicate/reset/delete/rename) don't
       * know or care which collection a build lives in -- they just need it made active first,
       * so the existing active-build methods below can do the rest unchanged. */
      ownerOf(buildId) {
        return this.collections.find((c) => c.buildIds.includes(buildId));
      },

      selectBuildById(id) {
        const owner = this.ownerOf(id);
        if (owner) this.selectBuild(owner.id, id);
      },

      /** Refreshes `savedCollections[id]`'s own membership snapshot to match the live
       * collection, without touching any build's content -- for the structural methods below,
       * which promote a build's *content* into `savedById` themselves (`storage.cloneBuild`)
       * but would otherwise leave the collection's own saved copy still missing the build id
       * they just added or removed, showing a false "unsaved" dot forever after. */
      syncSavedCollection(collection) {
        this.savedCollections[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
      },

      // Create/duplicate/delete/import/share all save themselves immediately, unlike an
      // ordinary edit: there is nothing pending to lose, since the build's own saved copy
      // starts out identical to what was just built. All four act on `activeCollection` --
      // BuildNav's own per-collection "+ New build"/"Import" buttons select that collection
      // active first (see `onCreateBuildIn`/`onImportBuildsIn` below) when it isn't already.
      createBuild() {
        const build = storage.defaultBuild(`Build ${this.builds.length + 1}`);
        this.builds.push(build);
        this.savedById[build.id] = storage.cloneBuild(build);
        this.activeCollection.buildIds.push(build.id);
        this.activeCollection.activeBuildId = build.id;
        this.activeId = build.id;
        this.syncSavedCollection(this.activeCollection);
        this.persistSaved();
        this.persistSavedCollections();
      },

      duplicateBuild() {
        const copy = storage.duplicate(this.build);
        this.builds.push(copy);
        this.savedById[copy.id] = storage.cloneBuild(copy);
        this.activeCollection.buildIds.push(copy.id);
        this.activeCollection.activeBuildId = copy.id;
        this.activeId = copy.id;
        this.notice = `Duplicated as “${copy.name}”`;
        this.syncSavedCollection(this.activeCollection);
        this.persistSaved();
        this.persistSavedCollections();
      },

      /** Guarded per collection (at least one build must remain in it), not globally -- how
       * many builds exist in *other* collections is irrelevant to whether this one can lose
       * its last tab. */
      removeBuild() {
        const collection = this.activeCollection;
        if (collection.buildIds.length < 2) return;
        const index = this.builds.findIndex((item) => item.id === this.activeId);
        const [removed] = this.builds.splice(index, 1);
        delete this.savedById[removed.id];
        this.dropHistory(removed.id);
        const buildIndex = collection.buildIds.indexOf(removed.id);
        collection.buildIds.splice(buildIndex, 1);
        this.activeId = collection.buildIds[Math.min(buildIndex, collection.buildIds.length - 1)];
        collection.activeBuildId = this.activeId;
        this.notice = `Deleted “${removed.name}”`;
        this.syncSavedCollection(collection);
        this.persistSaved();
        this.persistSavedCollections();
      },

      importBuilds(builds) {
        this.builds.push(...builds);
        for (const build of builds) this.savedById[build.id] = storage.cloneBuild(build);
        this.activeCollection.buildIds.push(...builds.map((build) => build.id));
        this.activeId = builds[builds.length - 1].id;
        this.activeCollection.activeBuildId = this.activeId;
        this.notice = `Imported ${builds.length} build(s)`;
        this.syncSavedCollection(this.activeCollection);
        this.persistSaved();
        this.persistSavedCollections();
      },

      /** A single build's own JSON download -- BuildNav's build tab menu -> Export. Same
       * Blob/anchor technique as `build-bar.js`'s own single-build export drawer. */
      exportBuild(id) {
        const build = this.builds.find((item) => item.id === id);
        if (!build) return;
        const blob = new Blob([storage.toJson(build)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${build.name.replace(/[^\w.-]+/g, '-') || 'build'}.json`;
        link.click();
        URL.revokeObjectURL(url);
      },

      // --- collections ------------------------------------------------------------------------

      createCollection() {
        const build = storage.defaultBuild('New build');
        const collection = storage.defaultCollection(`Collection ${this.collections.length + 1}`, build);
        this.builds.push(build);
        this.savedById[build.id] = storage.cloneBuild(build);
        this.collections.push(collection);
        this.savedCollections[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
        this.activeCollectionId = collection.id;
        this.activeId = build.id;
        this.persistSaved();
        this.persistSavedCollections();
      },

      renameCollection({ id, name }) {
        const collection = this.collections.find((c) => c.id === id);
        if (collection) collection.name = name;
      },

      duplicateCollection(id) {
        const source = this.collections.find((c) => c.id === id);
        if (!source) return;
        const buildsById = Object.fromEntries(this.builds.map((build) => [build.id, build]));
        const { collection, builds } = storage.duplicateCollection(source, buildsById);
        this.builds.push(...builds);
        for (const build of builds) this.savedById[build.id] = storage.cloneBuild(build);
        this.collections.push(collection);
        this.savedCollections[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
        this.activeCollectionId = collection.id;
        this.activeId = collection.activeBuildId;
        this.notice = `Duplicated as “${collection.name}”`;
        this.persistSaved();
        this.persistSavedCollections();
      },

      /** Guarded so at least one collection always remains -- mirrors `removeBuild`'s own
       * guard, one level up. Drops its builds from the flat pool entirely (nothing else can
       * reference them once their collection is gone) and its file link, if any. */
      deleteCollection(id) {
        if (this.collections.length < 2) return;
        const index = this.collections.findIndex((c) => c.id === id);
        if (index === -1) return;
        const [removed] = this.collections.splice(index, 1);
        for (const buildId of removed.buildIds) {
          const buildIndex = this.builds.findIndex((build) => build.id === buildId);
          if (buildIndex !== -1) this.builds.splice(buildIndex, 1);
          delete this.savedById[buildId];
          this.dropHistory(buildId);
        }
        delete this.savedCollections[removed.id];
        delete this.fileLinks[removed.id];
        window.NW.fsStore.deleteHandle(removed.id);
        const next = this.collections[Math.min(index, this.collections.length - 1)];
        this.activeCollectionId = next.id;
        this.activeId = next.activeBuildId;
        this.notice = `Deleted “${removed.name}”`;
        this.persistSaved();
        this.persistSavedCollections();
      },

      /** BuildNav's collection menu -> Save: commits every build the collection contains
       * (same promotion `saveActive` does for just the active one) and persists the grouping,
       * then -- if this collection is linked to a file -- writes it there too. */
      async saveCollection(id) {
        const collection = this.collections.find((c) => c.id === id);
        if (!collection) return;
        for (const buildId of collection.buildIds) {
          const build = this.builds.find((item) => item.id === buildId);
          if (build) this.savedById[buildId] = { ...storage.cloneBuild(build), updated: Date.now() };
        }
        this.savedCollections[id] = { ...collection, buildIds: [...collection.buildIds] };
        this.persistSaved();
        this.persistSavedCollections();
        const handle = await this.fileHandleFor(id);
        if (handle) await this.writeCollectionFile(id, handle);
      },

      /** `fileLinks[id]` only holds a handle picked *this session* (Save As -> File) -- a
       * reload loses that in-memory link even though the handle itself is still sitting in
       * `fsStore`'s IndexedDB, so a Save has to fall back to looking it up there before
       * concluding the collection isn't file-linked at all. */
      async fileHandleFor(id) {
        if (this.fileLinks[id]) return this.fileLinks[id];
        const handle = await window.NW.fsStore.getHandle(id);
        if (handle) this.fileLinks[id] = handle;
        return handle;
      },

      async writeCollectionFile(id, handle) {
        const collection = this.collections.find((c) => c.id === id);
        if (!collection) return;
        try {
          if (!(await window.NW.fsStore.verifyPermission(handle))) throw new Error('permission denied');
          const buildsById = Object.fromEntries(this.builds.map((build) => [build.id, build]));
          const bundle = storage.bundleCollection(collection, buildsById);
          await window.NW.fsStore.writeText(handle, storage.toJson(bundle));
        } catch (error) {
          delete this.fileLinks[id];
          this.notice = `Could not write “${collection.name}” to its linked file: ${error.message ?? error}`;
        }
      },

      /** BuildNav's collection menu -> Save As. `target: 'storage'` is just `duplicateCollection`
       * under another name (both produce an independent saved copy); `target: 'file'` picks a
       * file, links it to *this* collection going forward, and writes it immediately. */
      async saveCollectionAs({ id, target }) {
        if (target === 'storage') {
          this.duplicateCollection(id);
          return;
        }
        const collection = this.collections.find((c) => c.id === id);
        if (!collection || !window.NW.fsStore.supported) return;
        try {
          const suggested = `${collection.name.replace(/[^\w.-]+/g, '-') || 'collection'}.json`;
          const handle = await window.NW.fsStore.pickSaveFile(suggested);
          this.fileLinks[id] = handle;
          await window.NW.fsStore.setHandle(id, handle);
          await this.saveCollection(id);
          this.notice = `“${collection.name}” now saves to that file`;
        } catch (error) {
          if (error?.name !== 'AbortError') {
            this.notice = `Could not link that file: ${error.message ?? error}`;
          }
        }
      },

      /** BuildNav's collection menu -> Export: a one-shot download, no persistent link --
       * distinct from Save As -> File, which remembers the file for future Saves. Same
       * Blob/anchor technique as `exportBuild` above. */
      exportCollection(id) {
        const collection = this.collections.find((c) => c.id === id);
        if (!collection) return;
        const buildsById = Object.fromEntries(this.builds.map((build) => [build.id, build]));
        const bundle = storage.bundleCollection(collection, buildsById);
        const blob = new Blob([storage.toJson(bundle)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${collection.name.replace(/[^\w.-]+/g, '-') || 'collection'}.json`;
        link.click();
        URL.revokeObjectURL(url);
      },

      /** BuildNav's own "Import collection" button at the bottom of the sidebar. Parsing (and
       * its failure) happens here, not in BuildNav, so it can share the one `notice` channel
       * every other library-level error already uses. */
      importCollectionText(text) {
        try {
          const { collection, builds } = storage.parseCollectionJson(text);
          this.builds.push(...builds);
          for (const build of builds) this.savedById[build.id] = storage.cloneBuild(build);
          this.collections.push(collection);
          this.savedCollections[collection.id] = { ...collection, buildIds: [...collection.buildIds] };
          this.activeCollectionId = collection.id;
          this.activeId = collection.activeBuildId;
          this.notice = `Imported “${collection.name}” (${builds.length} build(s))`;
          this.persistSaved();
          this.persistSavedCollections();
        } catch (error) {
          this.notice = `That collection file could not be read: ${error.message ?? error}`;
        }
      },

      /** BuildNav's per-collection "+ New build"/"Import" row -- makes that collection active
       * first (a no-op if it already is) so `createBuild`/`importBuilds` land in it. */
      onCreateBuildIn(collectionId) {
        this.selectCollection(collectionId);
        this.createBuild();
      },

      onImportBuildsIn({ collectionId, text }) {
        this.selectCollection(collectionId);
        try {
          this.importBuilds(storage.parseJson(text));
        } catch (error) {
          this.notice = `That file could not be read: ${error.message ?? error}`;
        }
      },

      // BuildNav's per-build tab menu: select the build (and its collection) active, then
      // reuse the same active-build method the top toolbar's own buttons call.
      onSaveBuild(id) { this.selectBuildById(id); this.saveActive(); },
      onRevertBuild(id) { this.selectBuildById(id); this.revertActive(); },
      onDuplicateBuild(id) { this.selectBuildById(id); this.duplicateBuild(); },
      onResetBuild(id) { this.selectBuildById(id); this.resetAll(); },
      onDeleteBuild(id) { this.selectBuildById(id); this.removeBuild(); },
      onRenameBuild({ id, name }) { this.selectBuildById(id); this.renameBuild(name); },

      /**
       * Slot-id keyed, so it cannot misalign the way a spreadsheet range paste can. Slots the
       * source leaves empty are cleared in the target -- "copy this section" means the section
       * ends up matching, not "merge whatever happens to be set".
       */
      copySection({ fromId, sectionIds }) {
        const source = this.builds.find((item) => item.id === fromId);
        if (!source) return;

        this.snapshot(null, `copy ${sectionIds.length} section(s) from “${source.name}”`);
        const wanted = new Set(sectionIds);
        for (const slot of this.db.slots) {
          if (!wanted.has(slot.section)) continue;

          const choice = source.choices[slot.id];
          if (choice) this.build.choices[slot.id] = choice;
          else delete this.build.choices[slot.id];

          const value = source.values[slot.id];
          if (value != null) this.build.values[slot.id] = value;
          else delete this.build.values[slot.id];
        }
        this.notice = `Copied ${sectionIds.length} section(s) from “${source.name}”`;
      },

      /** One slot's own "revert" icon (slot-list.js): undoes just that slot's unsaved edit,
       * leaving the rest of the draft alone -- unlike `revertActive`, which throws away
       * everything unsaved in the build. */
      revertSlot(slotId) {
        const saved = this.savedById[this.activeId];
        if (!saved) return;
        this.snapshot(null, `revert ${this.slotLabel(slotId)}`);
        const choice = saved.choices[slotId];
        if (choice) this.build.choices[slotId] = choice;
        else delete this.build.choices[slotId];
        const value = saved.values[slotId];
        if (value != null) this.build.values[slotId] = value;
        else delete this.build.values[slotId];
      },

      /** Same, for every slot in one section at once (a section header's own "revert" icon). */
      revertSection(sectionId) {
        const saved = this.savedById[this.activeId];
        const slots = this.db.slots.filter((slot) => slot.section === sectionId);
        if (!saved || !slots.length) return;
        const label = this.db.sections.find((section) => section.id === sectionId)?.label ?? sectionId;
        this.snapshot(null, `revert ${label}`);
        for (const slot of slots) {
          const choice = saved.choices[slot.id];
          if (choice) this.build.choices[slot.id] = choice;
          else delete this.build.choices[slot.id];
          const value = saved.values[slot.id];
          if (value != null) this.build.values[slot.id] = value;
          else delete this.build.values[slot.id];
        }
      },

      // --- plumbing -------------------------------------------------------------------------

      /** The continuous, debounced "don't lose this on a reload" write -- not a save the user
       * asked for, so it never touches `savedById` or clears `storageFailed`'s one-shot notice. */
      saveDraft() {
        const ok = storage.saveDraft({ builds: this.builds, activeId: this.activeId });
        if (!ok && !this.storageFailed) {
          this.storageFailed = true;
          this.notice = 'Could not save to localStorage — export your build to keep it.';
        }
      },

      /** Writes `savedById` as it stands right now to `nw:builds`. Shared by the explicit Save
       * button and by structural changes that save themselves immediately. */
      persistSaved() {
        const ok = storage.saveLibrary({ builds: Object.values(this.savedById), activeId: this.activeId });
        if (!ok && !this.storageFailed) {
          this.storageFailed = true;
          this.notice = 'Could not save to localStorage — export your build to keep it.';
        }
      },

      /** The collections analogue of `saveDraft` above -- continuous, debounced, never touches
       * `savedCollections`. */
      saveCollectionsDraft() {
        const ok = storage.saveCollectionsDraft({
          collections: this.collections,
          activeCollectionId: this.activeCollectionId,
        });
        if (!ok && !this.storageFailed) {
          this.storageFailed = true;
          this.notice = 'Could not save to localStorage — export your build to keep it.';
        }
      },

      /** The collections analogue of `persistSaved` above -- writes `savedCollections` as it
       * stands right now to `nw:collections`. */
      persistSavedCollections() {
        const ok = storage.saveCollections({
          collections: Object.values(this.savedCollections),
          activeCollectionId: this.activeCollectionId,
        });
        if (!ok && !this.storageFailed) {
          this.storageFailed = true;
          this.notice = 'Could not save to localStorage — export your build to keep it.';
        }
      },

      /** The Save button: promotes the live draft to the saved library. */
      saveActive() {
        this.savedById[this.activeId] = { ...storage.cloneBuild(this.build), updated: Date.now() };
        this.persistSaved();
      },

      /** Discards unsaved edits back to what was last saved. `build-bar.js` gates this behind
       * its own two-step confirm, same as delete -- this is the one place an ordinary edit can
       * be lost, since the draft otherwise survives everything (including a reload). */
      revertActive() {
        const saved = this.savedById[this.activeId];
        if (!saved) return;
        this.snapshot(null, 'revert unsaved changes');
        this.replaceActive(storage.cloneBuild(saved));
      },

      /** A `#b=…` link is consumed once: the build joins the library and the hash is dropped. */
      async consumeShareLink() {
        const payload = storage.readHash();
        if (!payload) return;
        try {
          const shared = await storage.decodeShare(payload);
          this.builds.push(shared);
          this.savedById[shared.id] = storage.cloneBuild(shared);
          this.activeId = shared.id;
          this.notice = `Opened “${shared.name}” from a share link`;
          this.persistSaved();
        } catch (error) {
          this.notice = `That share link could not be read: ${error.message ?? error}`;
        }
        storage.clearHash();
      },

      measureTopbar() {
        // The stat panel is sticky below the top bar, whose height changes as its controls
        // wrap. Measure it instead of guessing, or the panel's first rows hide behind the bar.
        const header = document.querySelector('.topbar');
        if (!header || !window.ResizeObserver) return;
        const apply = () => document.documentElement.style
          .setProperty('--topbar-h', `${header.offsetHeight}px`);
        apply();
        this.topbarObserver = markRaw(new ResizeObserver(apply));
        this.topbarObserver.observe(header);
      },

      // --- routing --------------------------------------------------------------------------
      // Only view/build/tab live here. The editor's own "which item is open" is a level down
      // (data-editor.js) and reads/writes the `item` param itself -- app.js already knows
      // nothing about the editor's internals, and routing keeps to that boundary.

      /** Writes the current view/build/tab to the URL. `push: false` for changes that
       * shouldn't be their own back/forward stop (see the `tab` watcher). */
      syncRoute({ push = true } = {}) {
        router.apply({
          view: this.view === 'editor' ? 'editor' : null,
          collection: this.activeCollectionId,
          build: this.activeId,
          tab: this.tab === 'bonuses' ? 'bonuses' : null,
        }, { push });
      },

      /** Ctrl+click on a filled slot (slot-list.js): jump straight into that item in the data
       * editor. `item` has to land in the URL before `view` flips -- the `view` watcher's own
       * `syncRoute()` runs (flush: pre, so before the DOM patches DataEditor into existence) and
       * merges `view=editor` onto whatever is already there, and DataEditor reads `item` off the
       * URL once, in its own `mounted()`. */
      editItem(itemName) {
        router.apply({ item: itemName });
        this.view = 'editor';
      },

      /** Back/forward landed here: read the URL rather than trust the popstate payload, since
       * the payload is whatever was current when *this* session pushed it, not necessarily
       * what's now in the address bar (a page reload rebuilds history-less). */
      onPopState() {
        const route = router.parse();
        this.view = route.view === 'editor' ? 'editor' : 'builder';
        if (route.collection && this.collections.some((c) => c.id === route.collection)) {
          this.activeCollectionId = route.collection;
        }
        if (route.build && this.builds.some((build) => build.id === route.build)) {
          this.activeId = route.build;
        }
        this.tab = route.tab === 'bonuses' ? 'bonuses' : 'stats';
      },
    },

    template: `
      <DataEditor
        v-if="view === 'editor'"
        :db="db"
        :overlay="workspaceOverlay"
        @update-overlay="workspaceOverlay = $event"
        @close="view = 'builder'" />

      <template v-else>
      <header class="topbar">
        <div class="brand">
          <h1>Neverwinter build planner</h1>
        </div>

        <BuildBar
          :build="build"
          :can-undo="canUndo"
          :can-redo="canRedo"
          :undo-label="undoLabel"
          :redo-label="redoLabel"
          :dirty="dirty"
          @rename="renameBuild"
          @import="importBuilds"
          @undo="undo"
          @redo="redo"
          @save="saveActive"
          @revert="revertActive" />

        <QuickOptions
          :context="build.context"
          @set="setContext"
          @set-toggle="setToggle" />

        <div class="topbar-actions">
          <div class="compare-quick">
            <span class="field-label">Compare</span>
            <ComboBox class="compare-select" :model-value="build.compare.id" :options="compareOptions"
                      @update:model-value="setCompareBuild" />
            <label class="check">
              <input type="checkbox" :checked="build.compare.highlight" :disabled="!compareBuild"
                     @change="setCompareFlag('highlight', $event.target.checked)">
              <span>highlight diffs</span>
            </label>
            <label class="check">
              <input type="checkbox" :checked="build.compare.onlyDiff" :disabled="!compareBuild"
                     @change="setCompareFlag('onlyDiff', $event.target.checked)">
              <span>only diffs</span>
            </label>
          </div>

          <span v-if="notice" class="notice" @click="notice = ''">{{ notice }}</span>
          <span class="hint">{{ filledSlots }}/{{ db.slots.length }} slots</span>
          <button type="button" class="link" @click="clearSlots">clear slots</button>
          <button type="button" class="link" @click="resetAll">reset</button>
          <button type="button" class="btn" @click="view = 'editor'">
            Edit data<span v-if="overlayCount" class="badge badge--edited">{{ overlayCount }}</span>
          </button>
        </div>
      </header>

      <main class="layout" v-if="resolved.ok">
        <BuildNav
          :collections="collections"
          :builds="builds"
          :active-collection-id="activeCollectionId"
          :active-id="activeId"
          :dirty-by-build="dirtyByBuild"
          :saved-collections="savedCollections"
          @select-collection="selectCollection"
          @select-build="({ collectionId, id }) => selectBuild(collectionId, id)"
          @create-collection="createCollection"
          @import-collection="importCollectionText"
          @rename-collection="renameCollection"
          @save-collection="saveCollection"
          @save-collection-as="saveCollectionAs"
          @duplicate-collection="duplicateCollection"
          @export-collection="exportCollection"
          @delete-collection="deleteCollection"
          @create-build="onCreateBuildIn"
          @import-builds="onImportBuildsIn"
          @rename-build="onRenameBuild"
          @save-build="onSaveBuild"
          @revert-build="onRevertBuild"
          @duplicate-build="onDuplicateBuild"
          @export-build="exportBuild"
          @reset-build="onResetBuild"
          @delete-build="onDeleteBuild" />

        <SlotList
          :db="db"
          :build="build"
          :result="resolved.result"
          :context="build.context"
          :expanded="build.expanded"
          :compare-build="compareBuild"
          :highlight-diff="build.compare.highlight"
          :only-diff="build.compare.onlyDiff"
          :saved-build="savedById[activeId]"
          :other-builds="otherBuildsInCollection"
          @choose="setChoice"
          @set-value="setValue"
          @set="setContext"
          @set-forte="setForte"
          @apply-slot="applyFromCompare"
          @toggle-section="toggleSection"
          @set-expanded="setExpanded"
          @edit-item="editItem"
          @revert-slot="revertSlot"
          @revert-section="revertSection"
          @copy-section="copySection" />
        <aside class="sidebar">
          <div class="tabs">
            <button type="button" class="tab" :class="{ 'is-on': tab === 'stats' }"
                    @click="tab = 'stats'">Stats</button>
            <button type="button" class="tab" :class="{ 'is-on': tab === 'bonuses' }"
                    @click="tab = 'bonuses'">
              Bonuses <span class="tab-count">{{ bonusCounts.active }}/{{ bonusCounts.total }}</span>
              <span v-if="bonusCounts.nearMiss" class="badge badge--near">
                {{ bonusCounts.nearMiss }} away
              </span>
            </button>
          </div>

          <!-- v-show, not v-if: switching tabs must not discard the inspector's filter. -->
          <StatPanel v-show="tab === 'stats'" :result="resolved.result"
                     :compare-result="compareResolved?.ok ? compareResolved.result : null"
                     :compare-name="compareBuild?.name ?? ''" />
          <BonusInspector v-show="tab === 'bonuses'" :result="resolved.result" :db="db" />
        </aside>
      </main>

      <main v-else class="crash">
        <h2>The engine threw</h2>
        <p>{{ resolved.message }}</p>
        <pre>{{ resolved.stack }}</pre>
      </main>
      </template>
    `,
  });

  window.NW.dataReady
    .then(() => { window.NW.app = app.mount('#app'); })
    .catch((error) => {
      document.getElementById('app').textContent =
        `Failed to load data: ${error?.message ?? error}`;
    });
})();
