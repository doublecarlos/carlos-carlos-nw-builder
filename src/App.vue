<script setup lang="ts">
// Root component: page shell, plus the cross-cutting navigation concerns that genuinely span
// multiple stores (URL sync, the global undo/redo shortcut, consuming a share link on load).
// Everything else -- the build library, the active build's content and undo history, the
// compare picker, the resolved-engine pipeline, the data editor's workspace overlay, which
// page is showing -- lives in src/stores and is read/mutated by whichever component needs it.
import { ref, watch, onMounted, onUnmounted } from 'vue';
import BuildBar from './components/BuildBar.vue';
import BuildNav from './components/BuildNav.vue';
import BonusInspector from './components/BonusInspector.vue';
import ComboBox from './components/ComboBox.vue';
import DataEditor from './components/DataEditor.vue';
import QuickOptions from './components/QuickOptions.vue';
import SlotList from './components/SlotList.vue';
import StatPanel from './components/StatPanel.vue';
import * as storage from './storage';
import * as router from './router';
import * as library from './stores/library';
import * as buildEditor from './stores/buildEditor';
import * as compare from './stores/compare';
import * as engine from './stores/engine';
import * as ui from './stores/ui';
import { notice, showNotice } from './stores/notice';
import { overlayCount } from './stores/workspace';

const build = library.build;
const db = engine.db;
const resolved = engine.resolved;
const compareBuild = compare.compareBuild;

const initialRoute = router.parse();
const tab = ref<'stats' | 'bonuses'>(initialRoute.tab === 'bonuses' ? 'bonuses' : 'stats');
if (initialRoute.view === 'editor') ui.setView('editor');

function onKeydown(event: KeyboardEvent) {
  if (ui.view.value === 'editor') return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;

  // Leave the browser's own undo alone inside free-text fields, where the user means
  // "undo my typing" rather than "undo my last build edit".
  const target = event.target as HTMLElement;
  if (target?.tagName === 'TEXTAREA' || target?.classList?.contains('name-input')) return;

  event.preventDefault();
  if (key === 'y' || event.shiftKey) buildEditor.redo();
  else buildEditor.undo();
}

/** A `#b=…` link is consumed once: the build joins the library and the hash is dropped. */
async function consumeShareLink() {
  const payload = storage.readHash();
  if (!payload) return;
  try {
    const shared = await storage.decodeShare(payload);
    if (shared) library.addSharedBuild(shared);
  } catch (error: any) {
    showNotice(`That share link could not be read: ${error.message ?? error}`);
  }
  storage.clearHash();
}

// --- routing --------------------------------------------------------------------------
// Only view/build/tab live here. The editor's own "which item is open" is a level down
// (DataEditor.vue) and reads/writes the `item` param itself.

/** Writes the current view/build/tab to the URL. `push: false` for changes that
 * shouldn't be their own back/forward stop (see the `tab` watcher). */
function syncRoute({ push = true }: { push?: boolean } = {}) {
  router.apply({
    view: ui.view.value === 'editor' ? 'editor' : null,
    collection: library.activeCollectionId.value,
    build: library.activeId.value,
    tab: tab.value === 'bonuses' ? 'bonuses' : null,
  }, { push });
}

/** Back/forward landed here: read the URL rather than trust the popstate payload, since
 * the payload is whatever was current when *this* session pushed it, not necessarily
 * what's now in the address bar (a page reload rebuilds history-less). */
function onPopState() {
  const route = router.parse();
  ui.setView(route.view === 'editor' ? 'editor' : 'builder');
  library.restoreFromRoute(route.collection, route.build);
  tab.value = route.tab === 'bonuses' ? 'bonuses' : 'stats';
}

watch(library.activeId, () => syncRoute());
watch(library.activeCollectionId, () => syncRoute());
watch(ui.view, () => syncRoute());
// The sidebar tab is a lighter switch than a build/view change -- it still belongs in
// the URL for a refresh to restore, but it would clutter the back button if every click
// were its own stop.
watch(tab, () => syncRoute({ push: false }));

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('popstate', onPopState);
  // Establishes the canonical `?view=&build=&tab=` for a first-ever visit, without
  // pushing a history entry for it.
  syncRoute({ push: false });
  consumeShareLink();
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('popstate', onPopState);
});
</script>

<template>
  <div class="page">
    <BuildNav />

    <div class="page-main">
      <header class="topbar">
        <div class="brand">
          <h1>Neverwinter build planner</h1>
        </div>

        <BuildBar />

        <QuickOptions />

        <div class="topbar-actions">
          <span v-if="notice" class="notice" @click="showNotice('')">{{ notice }}</span>
          <div class="compare-quick">
            <span class="field-label">Compare</span>
            <ComboBox class="compare-select" :model-value="build.compare.id" :options="compare.compareOptions.value"
                      @update:model-value="compare.setCompareBuild" />
            <label class="check">
              <input type="checkbox" :checked="build.compare.highlight" :disabled="!compareBuild"
                     @change="compare.setCompareFlag('highlight', ($event.target as HTMLInputElement).checked)">
              <span>highlight diffs</span>
            </label>
            <label class="check">
              <input type="checkbox" :checked="build.compare.onlyDiff" :disabled="!compareBuild"
                     @change="compare.setCompareFlag('onlyDiff', ($event.target as HTMLInputElement).checked)">
              <span>only diffs</span>
            </label>
          </div>

          <button type="button" class="link" @click="buildEditor.resetAll()">reset</button>
          <span class="hint">{{ buildEditor.filledSlots.value }}/{{ db.slots.length }} slots</span>
          <button type="button" class="btn" @click="ui.openEditor()">
            Edit data<span v-if="overlayCount" class="badge badge--edited">{{ overlayCount }}</span>
          </button>
        </div>
      </header>

      <main class="layout" v-if="resolved.ok">
        <div class="content">
        <SlotList />
        </div>
        <aside class="sidebar">
          <div class="tabs">
            <button type="button" class="tab" :class="{ 'is-on': tab === 'stats' }"
                    @click="tab = 'stats'">Stats</button>
            <button type="button" class="tab" :class="{ 'is-on': tab === 'bonuses' }"
                    @click="tab = 'bonuses'">
              Bonuses <span class="tab-count">{{ engine.bonusCounts.value.active }}/{{ engine.bonusCounts.value.total }}</span>
              <span v-if="engine.bonusCounts.value.nearMiss" class="badge badge--near">
                {{ engine.bonusCounts.value.nearMiss }} away
              </span>
            </button>
          </div>

          <!-- v-show, not v-if: switching tabs must not discard the inspector's filter. -->
          <StatPanel v-show="tab === 'stats'" />
          <BonusInspector v-show="tab === 'bonuses'" />
        </aside>
      </main>

      <main v-else class="crash">
        <h2>The engine threw</h2>
        <p>{{ resolved.message }}</p>
        <pre>{{ resolved.stack }}</pre>
      </main>
    </div>
  </div>

  <div v-if="ui.view.value === 'editor'" class="editor-overlay" @click.self="ui.closeEditor()">
    <div class="editor-overlay-panel">
      <DataEditor />
    </div>
  </div>
</template>

<style scoped>
/* --- page shell --------------------------------------------------------------------- */
.page { display: flex; align-items: stretch; min-height: 100vh; }
.page-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; height: 100vh; }

/* --- top bar -------------------------------------------------------------------------- */

.topbar {
  flex: none;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px 20px;
  padding: 8px 14px;
}

.brand { display: flex; flex-direction: column; gap: 4px; min-width: 150px; }
.brand h1 { font-size: 1.083rem; letter-spacing: .01em; }

.topbar-actions {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

/* Quick compare: pick another build, see it inline against the active one (slot highlights,
 * the stat panel's headline row) -- deliberately just a picker in the top bar, not a page of
 * its own. */
.compare-quick { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; }
.compare-select { min-width: 170px; }

/* --- builder layout --------------------------------------------------------------------- */

.layout {
  display: flex;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
  gap: 16px;
  padding: 14px;
}

.content { flex: 1 1 auto; min-width: 0; overflow-y: auto; }

.sidebar { flex: none; width: 460px; overflow-y: auto; }

.panel { border-radius: 0 var(--radius) var(--radius) var(--radius); }
.tabs { padding-left: 0 }

.crash { flex: 1 1 auto; min-height: 0; overflow-y: auto; color: var(--danger); padding: 24px; }
.crash pre { background: var(--surface); border-radius: var(--radius); overflow-x: auto; padding: 12px; }

@media (max-width: 1100px) {
  /* Below this width `.build-nav` itself gives up its own `height: 100vh` pane (see its
   * media query) and goes back to plain document flow -- match that here instead of running
   * two different "who owns the scrollbar" models at once. The top bar goes back to
   * `position: sticky` since it's the page, not a pane, that scrolls in this mode. */
  .page { flex-direction: column; }
  .page-main { height: auto; }
  .topbar { position: sticky; top: 0; z-index: 20; }
  .layout { flex-direction: column; }
  .content, .sidebar { width: auto; overflow-y: visible; }
}

@media (max-width: 560px) {
  /* Below this the compare picker and the reset/edit-data actions no longer fit on one
   * line with the notice -- let the whole action cluster wrap onto its own row rather than
   * squeezing every control down to nothing. */
  .topbar-actions { justify-content: flex-start; }
}

/* --- data editor overlay ---------------------------------------------------------------
 * `.page` stays mounted underneath -- this is a layer on top of it, not a replacement, so a
 * Ctrl+click on a slot can jump into the editor without losing the builder's own scroll
 * position/state. */

.editor-overlay {
  align-items: center;
  background: color-mix(in srgb, black 45%, transparent);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 28px;
  position: fixed;
  z-index: 50;
}

.editor-overlay-panel {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: 0 12px 40px rgba(0, 0, 0, .35);
  display: flex;
  height: 100%;
  max-width: 1400px;
  overflow: hidden;
  width: 100%;
}

@media (max-width: 900px) {
  .editor-overlay { padding: 0; }
  .editor-overlay-panel { border-radius: 0; }
}
</style>
