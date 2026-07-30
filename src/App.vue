<script setup lang="ts">
// Root component: page shell, plus the cross-cutting navigation concerns that genuinely span
// multiple stores (URL sync, the global undo/redo shortcut, consuming a share link on load).
// Everything else -- the build library, the active build's content and undo history, the
// compare picker, the resolved-engine pipeline, the data editor's workspace overlay, which
// page is showing -- lives in src/stores and is read/mutated by whichever component needs it.
import { ref, watch, onMounted, onUnmounted } from 'vue';
import BuildBar from './components/BuildBar.vue';
import ThemeToggle from './components/ui/ThemeToggle.vue';
import BuildNav from './components/BuildNav.vue';
import BonusInspector from './components/BonusInspector.vue';
import ComboBox from './components/ui/ComboBox.vue';
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
import Button from './components/ui/Button.vue';
import Checkbox from './components/ui/Checkbox.vue';
import Badge from './components/ui/Badge.vue';
import Notice from './components/ui/Notice.vue';
import TabStrip from './components/ui/TabStrip.vue';
import TabButton from './components/ui/TabButton.vue';

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
  <!-- Stacks above the builder below `lg`, matching BuildNav.vue's own breakpoint -- a
       height:100vh column layout makes no sense once the sidebar and the builder are
       stacked instead of side-by-side. -->
  <div class="flex flex-col items-stretch bg-bg text-text lg:min-h-screen lg:flex-row">
    <BuildNav />

    <div class="flex min-w-0 flex-1 flex-col lg:h-screen">
      <header class="flex flex-none flex-wrap items-start gap-x-5 gap-y-3 border-b border-line bg-surface px-3.5 py-2 max-lg:sticky max-lg:top-0 max-lg:z-20">
        <div class="flex min-w-38 flex-col gap-1">
          <h1 class="text-base font-semibold tracking-wide">Neverwinter build planner</h1>
        </div>

        <BuildBar />

        <QuickOptions />

        <div class="flex flex-1 basis-full flex-wrap items-center justify-end gap-2 max-sm:justify-start">
          <Notice v-if="notice" @dismiss="showNotice('')">{{ notice }}</Notice>
          <!-- Quick compare: pick another build, see it inline against the active one (slot
               highlights, the stat panel's headline row) -- deliberately just a picker in the
               top bar, not a page of its own. -->
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-sm text-muted">Compare</span>
            <ComboBox class="compare-select min-w-48" :model-value="build.compare.id" :options="compare.compareOptions.value"
                      @update:model-value="compare.setCompareBuild" />

            <Checkbox :model-value="build.compare.highlight" :disabled="!compareBuild"
                      @update:model-value="v => compare.setCompareFlag('highlight', v)">Highlight changes</Checkbox>
            <Checkbox :model-value="build.compare.onlyDiff" :disabled="!compareBuild"
                      @update:model-value="v => compare.setCompareFlag('onlyDiff', v)">Only show changes</Checkbox>
          </div>

          <Button variant="link" @click="buildEditor.resetAll()">reset</Button>
          <span class="text-sm text-muted">{{ buildEditor.filledSlots.value }}/{{ db.slots.length }} slots</span>

          <Button @click="ui.openEditor()">
            Edit data<Badge v-if="overlayCount" variant="edited">{{ overlayCount }}</Badge>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main class="flex min-h-0 flex-1 items-stretch gap-4 p-3.5 max-lg:flex-col" v-if="resolved.ok">
        <div class="min-w-0 flex-1 overflow-y-auto max-lg:w-auto max-lg:overflow-y-visible" data-testid="builder-content">
          <SlotList />
        </div>
        <aside class="sidebar w-130 flex-none overflow-y-auto max-lg:w-auto max-lg:overflow-y-visible">
          <TabStrip>
            <TabButton :active="tab === 'stats'" @click="tab = 'stats'">Stats</TabButton>
            <TabButton :active="tab === 'bonuses'" @click="tab = 'bonuses'">
              Bonuses <span class="text-sm opacity-75 tabular-nums">{{ engine.bonusCounts.value.active }}/{{ engine.bonusCounts.value.total }}</span>
              <Badge v-if="engine.bonusCounts.value.nearMiss" variant="near">
                {{ engine.bonusCounts.value.nearMiss }} away
              </Badge>
            </TabButton>
          </TabStrip>

          <!-- v-show, not v-if: switching tabs must not discard the inspector's filter. -->
          <StatPanel v-show="tab === 'stats'" />
          <BonusInspector v-show="tab === 'bonuses'" />
        </aside>
      </main>

      <main v-else class="flex-1 min-h-0 overflow-y-auto p-6 text-danger">
        <h2 class="text-lg font-semibold">The engine threw</h2>
        <p>{{ resolved.message }}</p>
        <pre class="overflow-x-auto rounded-md bg-surface p-3">{{ resolved.stack }}</pre>
      </main>
    </div>
  </div>

  <div v-if="ui.view.value === 'editor'" class="editor-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-0 md:p-7"
       @click.self="ui.closeEditor()">
    <div class="flex h-full w-full max-w-7xl overflow-hidden rounded-none bg-surface shadow-2xl md:rounded-md">
      <DataEditor />
    </div>
  </div>
</template>
