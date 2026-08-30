<script setup lang="ts">
// Bundle export picker: two checkbox lists (builds and layers) with a filter box each.
// Ticking builds auto-ticks the layers those builds depend on; auto-ticked layers can be
// unticked, but doing so shows an inline warning.
import { ref, computed } from "vue";
import * as builds from "../stores/builds";
import * as layers from "../stores/layers";
import * as storage from "../storage/storage";
import { db } from "../stores/resolved";
import * as catalog from "../data/catalog";
import { showNotice } from "../stores/notice";
import { matchesQuery } from "../lib/text-filter";
import { Download } from "@lucide/vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseModal from "./ui/BaseModal.vue";

const emit = defineEmits<{
  close: [];
}>();

const buildFilter = ref("");
const layerFilter = ref("");

const selectedBuildIds = ref<Set<string>>(new Set());
const selectedLayerIds = ref<Set<string>>(new Set());
const autoTickedLayerIds = ref<Set<string>>(new Set());

// All builds, filtered by name.
const filteredBuilds = computed(() =>
  builds.builds.value.filter((b) => matchesQuery(b.name, buildFilter.value)),
);

// All layers, filtered by name.
const filteredLayers = computed(() =>
  layers.layers.value.filter((l) => matchesQuery(l.name, layerFilter.value)),
);

// Warn when a required layer is unticked.
const warnings = computed(() => {
  const result: string[] = [];
  for (const layerId of autoTickedLayerIds.value) {
    if (!selectedLayerIds.value.has(layerId)) {
      const layer = layers.layers.value.find((l) => l.id === layerId);
      if (!layer) continue;
      const buildNames = [...selectedBuildIds.value]
        .map((bid) => builds.builds.value.find((b) => b.id === bid)?.name)
        .filter(Boolean);
      result.push(
        `“${layer.name}” is required by ${buildNames.join(", ")} - imported builds will have missing items.`,
      );
    }
  }
  return result;
});

/** Every layer that at least one of `buildIds` depends on (per `catalog.referencedOverlay`). */
function computeAutoTickedLayers(buildIds: Iterable<string>): Set<string> {
  const newAuto = new Set<string>();
  for (const buildId of buildIds) {
    const b = builds.builds.value.find((b) => b.id === buildId);
    if (!b) continue;
    const overlay = catalog.referencedOverlay(db.value, b);
    for (const layer of layers.layers.value) {
      for (const key of Object.keys(overlay.items ?? {})) {
        if (layer.overlay.items?.[key] !== undefined) {
          newAuto.add(layer.id);
          break;
        }
      }
      for (const key of Object.keys(overlay.bonuses ?? {})) {
        if (layer.overlay.bonuses?.[key] !== undefined) {
          newAuto.add(layer.id);
          break;
        }
      }
    }
  }
  return newAuto;
}

function toggleBuild(id: string) {
  const next = new Set(selectedBuildIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedBuildIds.value = next;

  const newAuto = computeAutoTickedLayers(next);
  autoTickedLayerIds.value = newAuto;

  // Auto-tick required layers, but keep any manually unticked ones.
  const newSelected = new Set(selectedLayerIds.value);
  for (const lid of newAuto) {
    if (!newSelected.has(lid)) {
      // Only auto-tick if it wasn't previously manually unticked
      newSelected.add(lid);
    }
  }
  selectedLayerIds.value = newSelected;
}

function toggleLayer(id: string) {
  const next = new Set(selectedLayerIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedLayerIds.value = next;
}

function exportBundle() {
  const selectedBuilds = builds.builds.value.filter((b) =>
    selectedBuildIds.value.has(b.id),
  );
  const selectedLayers = layers.layers.value.filter((l) =>
    selectedLayerIds.value.has(l.id),
  );

  if (!selectedBuilds.length && !selectedLayers.length) {
    showNotice("Select at least one build or layer to export.");
    return;
  }

  const json = storage.toBundleJson({
    builds: selectedBuilds,
    layers: selectedLayers,
  });
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `nw-bundle-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  emit("close");
}

function selectAllBuilds() {
  const allBuildIds = builds.builds.value.map((b) => b.id);
  selectedBuildIds.value = new Set(allBuildIds);
  const newAuto = computeAutoTickedLayers(allBuildIds);
  autoTickedLayerIds.value = newAuto;
  selectedLayerIds.value = new Set(newAuto);
}

function selectAllLayers() {
  selectedLayerIds.value = new Set(layers.layers.value.map((l) => l.id));
}
</script>

<template>
  <BaseModal
    title="Export bundle"
    panel-class="max-h-[80vh] w-[520px]"
    data-testid="bundle-export-picker"
    @close="emit('close')"
  >
    <div class="flex flex-1 gap-4 overflow-y-auto p-4">
      <!-- Builds column -->
      <div class="flex-1">
        <h3 class="mb-2 font-medium">Builds</h3>
        <input
          v-model="buildFilter"
          type="text"
          placeholder="Filter builds…"
          class="mb-2 w-full rounded border border-line bg-surface px-2 py-1"
          data-testid="bundle-build-filter"
        />
        <div class="max-h-48 space-y-1 overflow-y-auto">
          <label
            v-for="b in filteredBuilds"
            :key="b.id"
            class="flex cursor-pointer items-center gap-2"
          >
            <input
              type="checkbox"
              :checked="selectedBuildIds.has(b.id)"
              data-testid="bundle-build-checkbox"
              @change="toggleBuild(b.id)"
            />
            {{ b.name }}
          </label>
        </div>
        <button
          type="button"
          class="mt-2 cursor-pointer text-sm text-accent hover:underline"
          @click="selectAllBuilds"
        >
          Select all
        </button>
      </div>

      <!-- Layers column -->
      <div class="flex-1">
        <h3 class="mb-2 font-medium">Layers</h3>
        <input
          v-model="layerFilter"
          type="text"
          placeholder="Filter layers…"
          class="mb-2 w-full rounded border border-line bg-surface px-2 py-1"
          data-testid="bundle-layer-filter"
        />
        <div class="max-h-48 space-y-1 overflow-y-auto">
          <label
            v-for="l in filteredLayers"
            :key="l.id"
            class="flex cursor-pointer items-center gap-2"
            :class="{
              'text-accent':
                autoTickedLayerIds.has(l.id) && selectedLayerIds.has(l.id),
            }"
          >
            <input
              type="checkbox"
              :checked="selectedLayerIds.has(l.id)"
              data-testid="bundle-layer-checkbox"
              @change="toggleLayer(l.id)"
            />
            {{ l.name }}
            <span
              v-if="autoTickedLayerIds.has(l.id) && selectedLayerIds.has(l.id)"
              class="text-sm text-muted"
              >(auto)</span
            >
          </label>
        </div>
        <button
          type="button"
          class="mt-2 cursor-pointer text-sm text-accent hover:underline"
          @click="selectAllLayers"
        >
          Select all
        </button>
      </div>
    </div>

    <!-- Warnings -->
    <div v-if="warnings.length" class="px-4 pb-2">
      <p
        v-for="(w, i) in warnings"
        :key="i"
        class="text-sm text-warning"
        data-testid="bundle-warning"
      >
        ⚠ {{ w }}
      </p>
    </div>

    <!-- Footer -->
    <div class="flex justify-end gap-2 border-t border-line px-4 py-3">
      <BaseButton @click="emit('close')"> Cancel </BaseButton>
      <BaseButton
        data-testid="bundle-export-button"
        variant="primary"
        @click="exportBundle"
      >
        <Download />
        Export
      </BaseButton>
    </div>
  </BaseModal>
</template>
