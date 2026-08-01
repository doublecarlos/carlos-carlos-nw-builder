<script setup lang="ts">
// Root component: page shell, global undo/redo shortcut, URL sync.
//
// Layout: header (always visible), then either a loading skeleton, an empty state, or the
// three-column builder (nav, editor area with sticky header, stat panel).
import { watch, onMounted, onUnmounted, computed } from "vue";
import Nav from "./components/Nav.vue";
import AppHeader from "./components/AppHeader.vue";
import EmptyState from "./components/EmptyState.vue";
import BuildEditor from "./components/BuildEditor.vue";
import BuildDetails from "./components/BuildDetails.vue";
import QuickOptions from "./components/QuickOptions.vue";
import LayerEditor from "./components/LayerEditor.vue";
import * as router from "./router";
import * as buildEditor from "./stores/buildEditor";
import * as engine from "./stores/engine";
import * as details from "./stores/details";
import * as selection from "./stores/selection";
import * as builds from "./stores/builds";
import * as layers from "./stores/layers";

const resolved = engine.resolved;

// --- loading state ------------------------------------------------------------------------
const loading = builds.loading;

// --- empty state (no builds and no layers) ------------------------------------------------
const hasContent = computed(
  () => builds.builds.value.length > 0 || layers.layers.value.length > 0,
);

// --- draft indicator ----------------------------------------------------------------------
const activeBuildId = computed(() => {
  const sel = selection.selection.value;
  if (sel?.kind === "build") return sel.id;
  // Fall back to the auto-created default build.
  return builds.build.value?.id ?? null;
});

const isDownloaded = computed(() => {
  const id = activeBuildId.value;
  if (!id) return true;
  return builds.isDownloaded(id);
});

const downloadedAt = computed(() => {
  const id = activeBuildId.value;
  if (!id) return null;
  return builds.downloadedAt(id);
});

const draftLabel = computed(() => {
  if (!isDownloaded.value) return "Draft — not downloaded";
  const at = downloadedAt.value;
  if (!at) return "Downloaded";
  const seconds = Math.floor((Date.now() - at) / 1000);
  if (seconds < 60) return "Downloaded just now";
  if (seconds < 3600) return `Downloaded ${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `Downloaded ${Math.floor(seconds / 3600)}h ago`;
  return `Downloaded ${Math.floor(seconds / 86400)}d ago`;
});

const draftTitle = computed(() => {
  const at = downloadedAt.value;
  if (!at) return "";
  return new Date(at).toLocaleString();
});

// The selected item's name, for the editor header.
// Falls back to the auto-created default build when no selection exists.
const selectedName = computed(() => {
  const sel = selection.selection.value;
  if (sel?.kind === "build") {
    const b = builds.builds.value.find((b) => b.id === sel.id);
    return b?.name ?? "";
  }
  if (sel?.kind === "layer") {
    const l = layers.layers.value.find((l) => l.id === sel.id);
    return l?.name ?? "";
  }
  // Fall back to the active build (auto-created default).
  return builds.build.value?.name ?? "";
});

/** The selected layer object, for the LayerEditor prop. */
const selectedLayer = computed(() => {
  const sel = selection.selection.value;
  if (sel?.kind !== "layer") return null;
  return layers.layers.value.find((l) => l.id === sel.id) ?? null;
});

// --- keyboard shortcut --------------------------------------------------------------------

function onKeydown(event: KeyboardEvent) {
  // Layer editor has its own Ctrl+Z/Y handler, so skip the global one when a layer is active.
  if (selection.selection.value?.kind === "layer") return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return;

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

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("popstate", onPopState);
  syncRoute({ push: false });
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("popstate", onPopState);
});
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
          <!-- Column 3 placeholder (absorbed by LayerEditor) -->
          <div class="w-130 flex-none"></div>
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

              <div class="flex items-center gap-2 text-sm">
                <input
                  class="name-input min-w-40 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                  type="text"
                  :value="selectedName"
                  placeholder="Build name"
                  data-testid="build-name-input"
                  @input="
                    buildEditor.renameBuild(
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
                <span
                  v-if="
                    !selection.selection.value ||
                    selection.selection.value?.kind === 'build'
                  "
                  class="text-xs text-muted"
                  :title="draftTitle"
                  data-testid="draft-indicator"
                >
                  {{ draftLabel }}
                </span>
              </div>
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
              class="flex-1 min-h-0 overflow-y-auto p-3.5"
              data-testid="editor-column"
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
