<script setup lang="ts">
// Root component: page shell, URL sync.
//
// Layout: header (always visible), then either a loading skeleton, an empty state, or the
// three-column builder (nav, editor area with sticky header, stat panel).
import { watch, computed } from "vue";
import { useEventListener } from "@vueuse/core";
import Nav from "./components/Nav.vue";
import AppHeader from "./components/AppHeader.vue";
import EmptyState from "./components/EmptyState.vue";
import BuildEditor from "./components/BuildEditor.vue";
import BuildDetails from "./components/BuildDetails.vue";
import LayerEditor from "./components/LayerEditor.vue";
import * as router from "./lib/router";
import * as engine from "./stores/resolved";
import * as details from "./stores/details";
import * as selection from "./stores/selection";
import * as builds from "./stores/builds";
import * as layers from "./stores/layers";
import RailToggle from "./components/ui/RailToggle.vue";
import * as rails from "./stores/rails";
import { useGlobalShortcuts } from "./composables/useGlobalShortcuts";

const resolved = engine.resolved;

// --- side rails ---------------------------------------------------------------------------
// Collapsing a rail hands its width back to the editor column. The page's own minimum shrinks
// with it, which is the point: at 1100px the three columns already squeeze, and below that the
// whole page scrolls sideways with the stat panel's last column cut off.

/** What the editor column itself needs -- today's 1100px floor less the two open rails. */
const EDITOR_MIN_PX = 324;
const NAV_PX = { open: 256, closed: 28 };
const DETAILS_PX = { open: 520, closed: 28 };

const navCollapsed = rails.collapsed("nav");
const detailsCollapsed = rails.collapsed("details");

const minWidthPx = computed(
  () =>
    EDITOR_MIN_PX +
    (navCollapsed.value ? NAV_PX.closed : NAV_PX.open) +
    (detailsCollapsed.value ? DETAILS_PX.closed : DETAILS_PX.open),
);

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
</script>

<template>
  <div class="flex h-screen flex-col" :style="{ minWidth: minWidthPx + 'px' }">
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
        <!-- Column 1: Nav. The toggle gets its own strip rather than floating over the
             content: the rail's top corner is already full (Import / New), and a strip is
             also all that is left to render once the rail collapses. -->
        <div
          class="flex flex-none flex-col border-r border-line"
          :class="navCollapsed ? 'w-7' : 'w-64'"
          data-testid="nav-column"
        >
          <div class="flex flex-none justify-end px-0.5 pt-1">
            <RailToggle
              side="left"
              label="builds and layers"
              :collapsed="navCollapsed"
              @toggle="rails.toggle('nav')"
            />
          </div>
          <Nav v-if="!navCollapsed" class="min-h-0 flex-1 overflow-y-auto" />
        </div>

        <!-- Layer selected: editor spans columns 2 and 3 -->
        <template v-if="selectedLayer">
          <div class="flex min-w-0 flex-1">
            <LayerEditor :layer="selectedLayer" />
          </div>
        </template>

        <!-- Build selected: BuildEditor + StatPanel -->
        <template v-else>
          <!-- Column 2: Editor area -->
          <div class="flex min-w-0 flex-1 flex-col">
            <BuildEditor />
          </div>

          <!-- Column 3: Stat panel. Same strip treatment as the nav, mirrored. -->
          <div
            class="flex flex-none flex-col border-l border-line"
            :class="detailsCollapsed ? 'w-7' : 'w-130'"
            data-testid="stat-panel-column"
          >
            <div class="flex flex-none justify-start px-0.5 pt-1">
              <RailToggle
                side="right"
                label="stats"
                :collapsed="detailsCollapsed"
                @toggle="rails.toggle('details')"
              />
            </div>
            <div
              v-if="!detailsCollapsed"
              class="min-h-0 flex-1 overflow-y-auto"
            >
              <BuildDetails v-if="resolved.ok" />
              <div v-else class="p-6 text-muted">No build selected</div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
