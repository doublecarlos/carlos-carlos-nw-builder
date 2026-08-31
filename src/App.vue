<script setup lang="ts">
// Root component: page shell, URL sync.
//
// Layout: header (always visible), then either a loading skeleton, the first-run landing
// screen, or the three-column builder (nav, editor area with sticky header, stat panel).
import { watch, computed } from "vue";
import { useEventListener } from "@vueuse/core";
import Nav from "./components/Nav.vue";
import AppHeader from "./components/AppHeader.vue";
import LandingScreen from "./components/LandingScreen.vue";
import BuildEditor from "./components/BuildEditor.vue";
import BuildDetails from "./components/BuildDetails.vue";
import LayerEditor from "./components/LayerEditor.vue";
import * as router from "./lib/router";
import * as engine from "./stores/resolved";
import * as details from "./stores/details";
import * as selection from "./stores/selection";
import * as builds from "./stores/builds";
import * as landing from "./stores/landing";
import * as layers from "./stores/layers";
import RailGutter from "./components/ui/RailGutter.vue";
import * as rails from "./stores/rails";
import { useGlobalShortcuts } from "./composables/useGlobalShortcuts";

const resolved = engine.resolved;

// --- side rails ---------------------------------------------------------------------------
// Collapsing or narrowing a rail hands its width back to the editor column. The page's own
// minimum tracks whatever the rails currently take, which is the point: once the three columns
// no longer fit, the whole page scrolls sideways with the stat panel's last column cut off.

/** What the editor column itself needs, whatever the rails are doing. */
const EDITOR_MIN_PX = 324;

const navCollapsed = rails.collapsed("nav");
const detailsCollapsed = rails.collapsed("details");

const navRailWidth = rails.width("nav");
const detailsRailWidth = rails.width("details");

/** A collapsed rail is its bare strip; an open one is as wide as the user left it. */
const navWidth = computed(() =>
  navCollapsed.value ? rails.RAIL_COLLAPSED_PX : navRailWidth.value,
);
const detailsWidth = computed(() =>
  detailsCollapsed.value ? rails.RAIL_COLLAPSED_PX : detailsRailWidth.value,
);

useGlobalShortcuts();

// --- loading state ------------------------------------------------------------------------
const loading = builds.loading;

// --- landing screen -----------------------------------------------------------------------
// Stands in front of the builder whenever the app holds nothing at all.
const showLanding = landing.showing;

/** The selected layer object, for the LayerEditor prop. */
const selectedLayer = computed(() => {
  const sel = selection.selection.value;
  if (sel?.kind !== "layer") return null;
  return layers.layers.value.find((l) => l.id === sel.id) ?? null;
});

const minWidthPx = computed(
  () => EDITOR_MIN_PX + navWidth.value + detailsWidth.value,
);

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

    <!-- Landing: first visit, nothing stored yet -->
    <LandingScreen v-else-if="showLanding" />

    <!-- Three-column builder -->
    <template v-else>
      <div class="flex min-h-0 flex-1">
        <!-- Column 1: Nav. The gutter along its inner edge carries both the collapse toggle
             and the resize handle, and is all that is left to render once the rail
             collapses. -->
        <div
          class="flex flex-none border-r border-line"
          :style="{ width: navWidth + 'px' }"
          data-testid="nav-column"
        >
          <Nav v-if="!navCollapsed" class="min-w-0 flex-1 overflow-y-auto" />
          <RailGutter
            rail="nav"
            side="left"
            label="builds and layers"
            :collapsed="navCollapsed"
          />
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

          <!-- Column 3: Stat panel. Same gutter treatment as the nav, mirrored. -->
          <div
            class="flex flex-none border-l border-line"
            :style="{ width: detailsWidth + 'px' }"
            data-testid="stat-panel-column"
          >
            <RailGutter
              rail="details"
              side="right"
              label="stats"
              :collapsed="detailsCollapsed"
            />
            <div
              v-if="!detailsCollapsed"
              class="min-w-0 flex-1 overflow-y-auto"
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
