<script setup lang="ts">
// Root component: page shell, URL sync.
//
// Layout: header (always visible), then either a loading skeleton, an empty state, or the
// three-column builder (nav, editor area with sticky header, stat panel).
import { watch, computed, nextTick, useTemplateRef } from "vue";
import { useEventListener } from "@vueuse/core";
import Nav from "./components/Nav.vue";
import AppHeader from "./components/AppHeader.vue";
import EmptyState from "./components/EmptyState.vue";
import BuildEditor from "./components/BuildEditor.vue";
import BuildDetails from "./components/BuildDetails.vue";
import QuickOptions from "./components/game/QuickOptions.vue";
import LayerEditor from "./components/LayerEditor.vue";
import * as router from "./lib/router";
import * as engine from "./stores/resolved";
import * as details from "./stores/details";
import * as selection from "./stores/selection";
import * as builds from "./stores/builds";
import * as layers from "./stores/layers";
import * as editorScroll from "./stores/editorScroll";
import { useGlobalShortcuts } from "./composables/useGlobalShortcuts";

const resolved = engine.resolved;

useGlobalShortcuts();

// --- loading state ------------------------------------------------------------------------
const loading = builds.loading;

// --- empty state (no builds and no layers) ------------------------------------------------
const hasContent = computed(
  () => builds.builds.value.length > 0 || layers.layers.value.length > 0,
);

/** The selected layer object, for the LayerEditor prop. */
const selectedLayer = computed(() => {
  const sel = selection.selection.value;
  if (sel?.kind !== "layer") return null;
  return layers.layers.value.find((l) => l.id === sel.id) ?? null;
});

// --- routing --------------------------------------------------------------------------

function syncRoute({ push = true }: { push?: boolean } = {}) {
  const sel = selection.selection.value;
  router.apply(
    {
      build: sel?.kind === "build" ? sel.id : null,
      layer: sel?.kind === "layer" ? sel.id : null,
      tab: details.tab.value === "bonuses" ? "bonuses" : null,
    },
    { push },
  );
}

function onPopState() {
  const route = router.parse();
  if (route.build) {
    selection.selectBuild(route.build);
  } else if (route.layer) {
    selection.selectLayer(route.layer);
  } else {
    // If no selection in route, pick the first build.
    const first = builds.builds.value[0];
    if (first) selection.selectBuild(first.id);
  }
  details.setTab(route.tab === "bonuses" ? "bonuses" : "stats");
}

watch(
  () => selection.selection.value,
  () => syncRoute(),
);
watch(details.tab, () => syncRoute({ push: false }));

useEventListener(window, "popstate", onPopState);

syncRoute({ push: false });

// --- build editor scroll position ------------------------------------------------------
// Selecting a layer unmounts this element (the layer editor takes over columns 2-3), so
// restoring scrollTop on mount is what makes switching back to the build feel like it never
// left, instead of snapping back to the top of the list.
const buildScrollEl = useTemplateRef<HTMLElement>("buildScrollEl");

watch(buildScrollEl, async (el) => {
  if (!el) return;
  await nextTick();
  el.scrollTop = editorScroll.buildScrollTop.value;
});

function onBuildScroll(event: Event) {
  editorScroll.buildScrollTop.value = (event.target as HTMLElement).scrollTop;
}
</script>

<template>
  <div class="flex h-screen flex-col min-w-[1100px]">
    <AppHeader class="flex-none" />

    <!-- Loading skeleton: header stays visible, rest is a muted panel -->
    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center"
      data-testid="loading-skeleton"
    >
      <div class="h-48 w-96 rounded-md bg-surface-2/50"></div>
    </div>

    <!-- Empty state: no builds and no layers -->
    <EmptyState v-else-if="!hasContent" />

    <!-- Three-column builder -->
    <template v-else>
      <div class="flex min-h-0 flex-1">
        <!-- Column 1: Nav -->
        <Nav class="w-64 flex-none overflow-y-auto border-r border-line" />

        <!-- Layer selected: editor spans columns 2 and 3 -->
        <template v-if="selectedLayer">
          <div class="flex min-w-0 flex-1">
            <LayerEditor :layer="selectedLayer" />
          </div>
        </template>

        <!-- Build selected: sticky header + BuildEditor + StatPanel -->
        <template v-else>
          <!-- Column 2: Editor area -->
          <div class="flex min-w-0 flex-1 flex-col">
            <!-- Sticky editor header -->
            <div
              class="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-3.5 py-2"
            >
              <QuickOptions class="flex-1" />
            </div>

            <!-- Engine error -->
            <main
              v-if="!resolved.ok"
              class="flex-1 min-h-0 overflow-y-auto p-6 text-danger"
            >
              <h2 class="text-lg font-semibold">The engine threw</h2>
              <p>{{ resolved.message }}</p>
              <pre class="overflow-x-auto rounded-md bg-surface p-3">{{
                resolved.stack
              }}</pre>
            </main>

            <!-- Build editor -->
            <main
              v-else
              ref="buildScrollEl"
              class="flex-1 min-h-0 overflow-y-auto p-3.5"
              data-testid="editor-column"
              @scroll="onBuildScroll"
            >
              <BuildEditor />
            </main>
          </div>

          <!-- Column 3: Stat panel -->
          <div
            class="w-130 flex-none overflow-y-auto border-l border-line"
            data-testid="stat-panel-column"
          >
            <BuildDetails v-if="resolved.ok" />
            <div v-else class="p-6 text-muted">No build selected</div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
