<script setup lang="ts">
// LayerEditor's export drawer: three modes -- the composed db-items/db-bonuses files (for
// regenerating the shipped data, across every enabled layer) and this layer's own raw
// overlay JSON. Self-contained aside from which tab is active, which the parent keeps so
// reopening the drawer remembers the last tab.
import { computed } from "vue";
import { Copy, Download } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseDrawer from "../ui/BaseDrawer.vue";
import CodeBlock from "../ui/CodeBlock.vue";
import TabStrip from "../ui/TabStrip.vue";
import TabButton from "../ui/TabButton.vue";
import * as catalog from "../../data/catalog";
import * as layers from "../../stores/layers";
import type { CatalogOverlay } from "../../types";

const props = defineProps<{
  /** This layer's own raw overlay, for the "This layer" tab. */
  overlay: CatalogOverlay;
}>();

const emit = defineEmits<{
  notice: [message: string];
}>();

const activeTab = defineModel<string>({ default: "items" }); // items | bonuses | overlay

const exportText = computed(() => {
  if (activeTab.value === "items") {
    // Composed across all enabled layers for the maintainer path.
    const allEnabled = catalog.compose(layers.enabledOverlays.value);
    return catalog.toItemsFile(allEnabled.items);
  }
  if (activeTab.value === "bonuses") {
    const allEnabled = catalog.compose(layers.enabledOverlays.value);
    return catalog.toBonusesFile(allEnabled.bonusSets);
  }
  // "This layer": raw overlay JSON.
  return JSON.stringify(props.overlay, null, 2);
});

const exportName = computed(() => {
  if (activeTab.value === "items") return "db-items.json";
  if (activeTab.value === "bonuses") return "db-bonuses.json";
  return "catalog-overlay.json";
});

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText.value);
    emit("notice", `Copied ${exportName.value} to the clipboard`);
  } catch {
    emit("notice", "Clipboard blocked — select the text and copy it manually");
  }
}

function downloadExport() {
  const blob = new Blob([exportText.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportName.value;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <BaseDrawer>
    <div class="mb-1.5 flex flex-wrap items-end gap-2">
      <TabStrip>
        <TabButton :active="activeTab === 'items'" @click="activeTab = 'items'"
          >db-items.json</TabButton
        >
        <TabButton
          :active="activeTab === 'bonuses'"
          @click="activeTab = 'bonuses'"
          >db-bonuses.json</TabButton
        >
        <TabButton
          :active="activeTab === 'overlay'"
          @click="activeTab = 'overlay'"
          >This layer</TabButton
        >
      </TabStrip>
      <span class="flex-1"></span>
      <BaseButton @click="copyExport"><Copy />Copy</BaseButton>
      <BaseButton @click="downloadExport"
        ><Download />Download {{ exportName }}</BaseButton
      >
    </div>
    <CodeBlock :value="exportText" :rows="12" class="w-full" />
    <p class="mt-1 text-sm text-muted">
      <template v-if="activeTab === 'items'">
        Composed from all enabled layers — for regenerating the shipped data
        files.
      </template>
      <template v-else-if="activeTab === 'bonuses'">
        Composed from all enabled layers — for regenerating the shipped data
        files.
      </template>
      <template v-else> Just this layer's raw overlay JSON. </template>
    </p>
  </BaseDrawer>
</template>
