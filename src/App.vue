<script setup lang="ts">
// Root component: page shell, plus the cross-cutting navigation concerns that genuinely span
// multiple stores (URL sync, the global undo/redo shortcut, consuming a share link on load).
// Everything else -- the build library, the active build's content and undo history, the
// compare picker, the resolved-engine pipeline, the data editor's workspace overlay, which
// page is showing -- lives in src/stores and is read/mutated by whichever component needs it.
import { watch, onMounted, onUnmounted } from "vue";
import BuildLibrary from "./components/BuildLibrary.vue";
import BuildHeader from "./components/BuildHeader.vue";
import BuildEditor from "./components/BuildEditor.vue";
import BuildDetails from "./components/BuildDetails.vue";
import DataEditor from "./components/DataEditor.vue";
import * as storage from "./storage";
import * as router from "./router";
import * as library from "./stores/library";
import * as buildEditor from "./stores/buildEditor";
import * as engine from "./stores/engine";
import * as ui from "./stores/ui";
import * as details from "./stores/details";
import { showNotice } from "./stores/notice";

const resolved = engine.resolved;

const initialRoute = router.parse();
if (initialRoute.tab === "bonuses") details.setTab("bonuses");
if (initialRoute.view === "editor") ui.setView("editor");

function onKeydown(event: KeyboardEvent) {
  if (ui.view.value === "editor") return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return;

  // Leave the browser's own undo alone inside free-text fields, where the user means
  // "undo my typing" rather than "undo my last build edit".
  const target = event.target as HTMLElement;
  if (
    target?.tagName === "TEXTAREA" ||
    target?.classList?.contains("name-input")
  )
    return;

  event.preventDefault();
  if (key === "y" || event.shiftKey) buildEditor.redo();
  else buildEditor.undo();
}

/** A `#b=…` link is consumed once: the build joins the library and the hash is dropped. */
async function consumeShareLink() {
  const payload = storage.readHash();
  if (!payload) return;
  try {
    const shared = await storage.decodeShare(payload);
    if (shared) {
      library.addSharedBuild(shared.build);
      if (shared.catalogStale) {
        showNotice(
          `Opened “${shared.build.name}” from a share link — made against an older item catalogue; some items may no longer resolve`,
        );
      }
    }
  } catch (error: unknown) {
    showNotice(
      `That share link could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  storage.clearHash();
}

// --- routing --------------------------------------------------------------------------
// Only view/build/tab live here. The editor's own "which item is open" is a level down
// (DataEditor.vue) and reads/writes the `item` param itself.

/** Writes the current view/build/tab to the URL. `push: false` for changes that
 * shouldn't be their own back/forward stop (see the `tab` watcher). */
function syncRoute({ push = true }: { push?: boolean } = {}) {
  router.apply(
    {
      view: ui.view.value === "editor" ? "editor" : null,
      collection: library.activeCollectionId.value,
      build: library.activeId.value,
      tab: details.tab.value === "bonuses" ? "bonuses" : null,
    },
    { push },
  );
}

/** Back/forward landed here: read the URL rather than trust the popstate payload, since
 * the payload is whatever was current when *this* session pushed it, not necessarily
 * what's now in the address bar (a page reload rebuilds history-less). */
function onPopState() {
  const route = router.parse();
  ui.setView(route.view === "editor" ? "editor" : "builder");
  library.restoreFromRoute(route.collection, route.build);
  details.setTab(route.tab === "bonuses" ? "bonuses" : "stats");
}

watch(library.activeId, () => syncRoute());
watch(library.activeCollectionId, () => syncRoute());
watch(ui.view, () => syncRoute());
// The sidebar tab is a lighter switch than a build/view change -- it still belongs in
// the URL for a refresh to restore, but it would clutter the back button if every click
// were its own stop.
watch(details.tab, () => syncRoute({ push: false }));

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("popstate", onPopState);
  // Establishes the canonical `?view=&build=&tab=` for a first-ever visit, without
  // pushing a history entry for it.
  syncRoute({ push: false });
  consumeShareLink();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("popstate", onPopState);
});
</script>

<template>
  <!-- Stacks above the builder below `lg` -- a height:100vh column layout makes no sense once
       the sidebar and the builder are stacked instead of side-by-side. Placement classes for
       BuildLibrary/BuildHeader/BuildEditor/BuildDetails all live here, passed in via class
       fallthrough, rather than baked into each component's own root. -->
  <div
    class="flex flex-col items-stretch bg-bg text-text lg:min-h-screen lg:flex-row"
  >
    <BuildLibrary
      class="flex-none border-b border-line lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:border-b-0 lg:border-r"
    />

    <div class="flex min-w-0 flex-1 flex-col lg:h-screen">
      <BuildHeader
        class="flex-none border-b border-line max-lg:sticky max-lg:top-0 max-lg:z-20"
      />

      <main
        v-if="resolved.ok"
        class="flex min-h-0 flex-1 items-stretch gap-4 p-3.5 max-lg:flex-col"
      >
        <BuildEditor
          class="min-w-0 flex-1 overflow-y-auto max-lg:w-auto max-lg:overflow-y-visible"
        />
        <BuildDetails
          class="w-130 flex-none overflow-y-auto max-lg:w-auto max-lg:overflow-y-visible"
        />
      </main>

      <main v-else class="flex-1 min-h-0 overflow-y-auto p-6 text-danger">
        <h2 class="text-lg font-semibold">The engine threw</h2>
        <p>{{ resolved.message }}</p>
        <pre class="overflow-x-auto rounded-md bg-surface p-3">{{
          resolved.stack
        }}</pre>
      </main>
    </div>
  </div>

  <div
    v-if="ui.view.value === 'editor'"
    class="editor-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-0 md:p-7"
    @click.self="ui.closeEditor()"
  >
    <div
      class="flex h-full w-full max-w-7xl overflow-hidden rounded-none bg-surface shadow-2xl md:rounded-md"
    >
      <DataEditor />
    </div>
  </div>
</template>
