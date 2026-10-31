<script setup lang="ts">
// Root component: page shell, URL sync.
//
// Layout: header (always visible), then either a loading skeleton, the first-run landing
// screen, or the builder (nav, editor area with sticky header, stat panel). With no builds,
// the landing content takes the place of the editor and stat panel. Which builder panes show
// at each viewport size is `shellLayout`'s call.
import { watch, computed } from "vue";
import { useEventListener } from "@vueuse/core";
import NavBar from "./components/NavBar.vue";
import AppHeader from "./components/AppHeader.vue";
import LandingScreen from "./components/LandingScreen.vue";
import BuildEditor from "./components/BuildEditor.vue";
import BuildDetails from "./components/BuildDetails.vue";
import QuickOptionsBand from "./components/game/QuickOptionsBand.vue";
import LayerEditor from "./components/LayerEditor.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import * as router from "./lib/router";
import * as engine from "./stores/resolved";
import * as details from "./stores/details";
import * as selection from "./stores/selection";
import * as builds from "./stores/builds";
import * as landing from "./stores/landing";
import * as layers from "./stores/layers";
import * as stableBrowser from "./stores/stableBrowser";
import RailGutter from "./components/ui/RailGutter.vue";
import BaseSheet from "./components/ui/BaseSheet.vue";
import SegmentedControl from "./components/ui/SegmentedControl.vue";
import * as rails from "./stores/rails";
import * as viewport from "./stores/viewport";
import * as shell from "./stores/shell";
import {
  shellLayout,
  viewportKind,
  type PhonePane,
  type StatsMode,
} from "./lib/shell-layout";
import { useGlobalShortcuts } from "./composables/useGlobalShortcuts";
import { undoScope, useUndoScope } from "./composables/useUndoScope";
import { useUndoRedoKeys } from "./composables/useUndoRedoKeys";
import { useRevealFocusedField } from "./composables/useRevealFocusedField";

const resolved = engine.resolved;

// --- side rails ---------------------------------------------------------------------------
// Collapsing or narrowing a rail hands its width back to the editor column. The page's own
// minimum tracks whatever the rails currently take, which is the point: once the three columns
// no longer fit, the whole page scrolls sideways with the stat panel's last column cut off.
// The floor only applies to the desktop layout; narrower viewports reflow instead.

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
// The scope tracker and the keys it routes are installed together: the keyboard binding
// belongs to the whole page, not to any one of the toolbars showing an undo pair.
useUndoScope();
useUndoRedoKeys();

// Typing on a touch screen: the pane switch makes way so it doesn't ride up over the field.
const { typing } = useRevealFocusedField();

// --- focus bar ---------------------------------------------------------------------------
// Shows which region contains the current focus for undo/redo shortcuts.
const navFocused = computed(() => undoScope.value === "nav");
const editorFocused = computed(() => undoScope.value === "editor");

// --- loading state ------------------------------------------------------------------------
const loading = builds.loading;

// --- landing screen -----------------------------------------------------------------------
// Stands in front of the builder whenever the app holds nothing at all.
const showLanding = landing.showing;
const activeBuild = builds.build;

/** The selected layer object, for the LayerEditor prop. */
const selectedLayer = computed(() => {
  const sel = selection.selection.value;
  if (sel?.kind !== "layer") return null;
  return layers.layers.value.find((l) => l.id === sel.id) ?? null;
});

// --- narrow layouts -----------------------------------------------------------------------

const layout = computed(() =>
  shellLayout(
    viewportKind(viewport.isDesktop.value, viewport.isPhone.value),
    selectedLayer.value ? "layer" : activeBuild.value ? "build" : "none",
    shell.phonePane.value,
  ),
);

/** The rail's own collapse state only applies while it is a rail. */
const statsCollapsed = computed(
  () => layout.value.stats === "rail" && detailsCollapsed.value,
);

// A fixed column is as wide as the narrowest phone, a width the stat panel has to fit anyway.
const STATS_COLUMN_CLASSES: Record<StatsMode, string> = {
  rail: "flex-none border-l",
  fixed: "w-[360px] flex-none border-l",
  pane: "min-w-0 flex-1",
  hidden: "",
};

const PANE_OPTIONS: { value: PhonePane; label: string; testid: string }[] = [
  { value: "editor", label: "Editor", testid: "pane-editor" },
  { value: "stats", label: "Stats", testid: "pane-stats" },
];

// The drawer is a way to pick something: once a pick lands, get out of the way of it. A pick
// a dirty draft vetoes lands nothing, so the drawer stays open on the choice still to make.
watch(selection.selection, () => shell.closeNavDrawer());

// Nothing may reopen a drawer the layout no longer has: widening to desktop, or the landing
// screen taking over, closes it for good.
watch(
  () => layout.value.nav !== "drawer" || loading.value || showLanding.value,
  (gone) => {
    if (gone) shell.closeNavDrawer();
  },
);

const minWidthPx = computed(() =>
  viewport.isDesktop.value
    ? EDITOR_MIN_PX + navWidth.value + detailsWidth.value
    : null,
);

// --- routing --------------------------------------------------------------------------

/** Only the group-less reference is addressable: a group a link names may no longer exist. */
const stableParam = () =>
  stableBrowser.isOpen.value && stableBrowser.group.value === null
    ? stableBrowser.tab.value
    : null;

const stableTabIn = (route: Record<string, string>) =>
  route.stable === "mount" || route.stable === "bonus" ? route.stable : null;

function syncRoute({ push = true }: { push?: boolean } = {}) {
  const sel = selection.selection.value;
  router.apply(
    {
      build: sel?.kind === "build" ? sel.id : null,
      layer: sel?.kind === "layer" ? sel.id : null,
      tab: details.tab.value === "bonuses" ? "bonuses" : null,
      stable: stableParam(),
    },
    { push },
  );
}

/** A group-scoped browse writes no param, so leave one open rather than closing it. */
function applyStableRoute(route: Record<string, string>) {
  const tab = stableTabIn(route);
  if (tab) stableBrowser.openReference({ tab, query: "" });
  else if (stableBrowser.isOpen.value && stableBrowser.group.value === null)
    stableBrowser.close();
}

async function onPopState() {
  const route = router.parse();
  // A dirty draft can veto the change; the URL already moved, so put it back to what is
  // still selected rather than leaving browser history and the editor out of step.
  let ok = true;
  if (route.build) {
    ok = await selection.selectBuild(route.build);
  } else if (route.layer) {
    ok = await selection.selectLayer(route.layer);
  } else {
    // If no selection in route, pick the first build.
    const first = builds.builds.value[0];
    if (first) ok = await selection.selectBuild(first.id);
  }
  if (!ok) {
    syncRoute({ push: false });
    return;
  }
  details.setTab(route.tab === "bonuses" ? "bonuses" : "stats");
  applyStableRoute(route);
}

watch(
  () => selection.selection.value,
  () => syncRoute(),
);
watch(details.tab, () => syncRoute({ push: false }));
watch([stableBrowser.isOpen, stableBrowser.tab, stableBrowser.group], () =>
  syncRoute(),
);

useEventListener(window, "popstate", onPopState);

// Read before the first write, or the sync below scrubs an incoming `?stable=`.
applyStableRoute(router.parse());
syncRoute({ push: false });
</script>

<template>
  <!-- The active undo scope is reflected here so tests can read it off the DOM. -->
  <div
    class="flex h-dvh flex-col"
    :style="minWidthPx === null ? undefined : { minWidth: minWidthPx + 'px' }"
    :data-undo-scope-active="undoScope"
  >
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

    <!-- Builder: nav, editor and stats, arranged by `layout` -->
    <template v-else>
      <div class="flex min-h-0 flex-1">
        <!-- Column 1: Nav. The gutter along its inner edge carries both the collapse toggle
             and the resize handle, and is all that is left to render once the rail
             collapses. -->
        <div
          v-if="layout.nav === 'rail'"
          class="relative flex flex-none border-r border-line"
          :style="{ width: navWidth + 'px' }"
          data-testid="nav-column"
        >
          <NavBar v-if="!navCollapsed" class="min-w-0 flex-1 overflow-y-auto" />
          <RailGutter
            rail="nav"
            side="left"
            label="builds and layers"
            :collapsed="navCollapsed"
          />
          <!-- Above the rail gutter and the editor's sticky toolbar, which would otherwise
               paint over the bar. -->
          <div
            v-if="navFocused"
            class="pointer-events-none absolute inset-x-0 top-0 z-menu h-[2px] bg-accent/90"
            data-testid="nav-focus-bar"
          />
        </div>

        <BaseSheet
          v-else-if="shell.navDrawerOpen.value"
          side="left"
          title="Builds and layers"
          panel-class="w-80"
          data-testid="nav-drawer"
          @close="shell.closeNavDrawer()"
        >
          <NavBar class="min-h-0 flex-1 overflow-y-auto" />
        </BaseSheet>

        <!-- Columns 2 and 3 share the editor undo scope, so one ring wraps both. -->
        <div class="relative flex min-w-0 flex-1">
          <!-- Layer selected: editor spans columns 2 and 3 -->
          <template v-if="selectedLayer">
            <div class="flex min-w-0 flex-1">
              <LayerEditor :layer="selectedLayer" />
            </div>
          </template>

          <!-- Build selected: BuildEditor + StatPanel -->
          <template v-else-if="activeBuild">
            <!-- Column 2: Editor area. Hidden rather than unmounted on a phone's stats pane, so
                 switching back finds it as it was left. -->
            <div
              v-show="layout.editor"
              class="flex min-w-0 flex-1 flex-col"
              data-testid="editor-pane"
            >
              <BuildEditor :build="activeBuild" />
            </div>

            <!-- Column 3: Stat panel. Same gutter treatment as the nav, mirrored, while it is a
                 rail; a fixed column or a phone pane has no width of its own to drag. -->
            <div
              v-show="layout.stats !== 'hidden'"
              class="flex border-line"
              :class="STATS_COLUMN_CLASSES[layout.stats]"
              :style="
                layout.stats === 'rail'
                  ? { width: detailsWidth + 'px' }
                  : undefined
              "
              data-testid="stat-panel-column"
            >
              <RailGutter
                v-if="layout.stats === 'rail'"
                rail="details"
                side="right"
                label="stats"
                :collapsed="detailsCollapsed"
              />
              <!-- The phone's quick options band sits above the scroller rather than sticking
                   inside it, clear of the stat cards' own sticky headers. -->
              <div v-if="!statsCollapsed" class="flex min-w-0 flex-1 flex-col">
                <QuickOptionsBand
                  v-if="layout.stats === 'pane'"
                  class="flex-none"
                  :build="activeBuild"
                />
                <div class="min-h-0 flex-1 overflow-y-auto">
                  <BuildDetails v-if="resolved.ok" :build="activeBuild" />
                  <div v-else class="p-6 text-muted">No build selected</div>
                </div>
              </div>
            </div>
          </template>

          <!-- No builds: the landing content spans columns 2 and 3, beside the nav -->
          <div v-else class="flex min-w-0 flex-1" data-testid="no-builds">
            <LandingScreen />
          </div>

          <div
            v-if="editorFocused"
            class="pointer-events-none absolute inset-x-0 top-0 z-menu h-[2px] bg-accent/90"
            data-testid="editor-focus-bar"
          />
        </div>
      </div>

      <SegmentedControl
        v-if="layout.paneSwitch"
        v-show="!(typing && viewport.coarsePointer.value)"
        v-model="shell.phonePane.value"
        :options="PANE_OPTIONS"
        fill
        class="flex-none border-t border-line bg-surface pt-2 pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))]"
        data-testid="pane-switch"
      />
    </template>

    <ConfirmDialog />
  </div>
</template>
