<script setup lang="ts">
// LayerEditor's export drawer: this layer's own raw overlay JSON, plus -- dev builds only --
// the composed db-items/db-bonuses/slots files for regenerating the shipped data across every
// enabled layer. Self-contained aside from which tab is active, which the parent keeps so
// reopening the drawer remembers the last tab.
import { computed, ref } from "vue";
import { Copy, Download } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseDrawer from "../ui/BaseDrawer.vue";
import CodeBlock from "../ui/CodeBlock.vue";
import TabStrip from "../ui/TabStrip.vue";
import TabButton from "../ui/TabButton.vue";
import * as catalog from "../../data/catalog";
import * as layers from "../../stores/layers";
import { NW_SLOTS } from "../../data/data";
import type { CatalogOverlay } from "../../types";

const props = defineProps<{
  /** This layer's own raw overlay, for the "This layer" tab. */
  overlay: CatalogOverlay;
}>();

const emit = defineEmits<{
  notice: [message: string];
}>();

const activeTab = defineModel<string>({ default: "items" }); // items | bonuses | slots | overlay

// The maintainer tabs (items/bonuses/slots) regenerate the shipped db-*.json files -- only
// useful with the source repo on hand, so they're dev-only. `import.meta.env.DEV` is
// statically replaced by Vite, so this branch is dead-code-eliminated from the production
// build entirely -- including the dynamic import below, which means `catalogExport.ts`
// (the module that actually composes those files) is never even fetched in production.
const maintainerTabsEnabled = import.meta.env.DEV;

type CatalogExportModule = typeof import("../../data/catalogExport");
const catalogExport = ref<CatalogExportModule | null>(null);
if (maintainerTabsEnabled) {
  import("../../data/catalogExport").then((mod) => {
    catalogExport.value = mod;
  });
}

/** The tab actually in effect: the maintainer tabs collapse to "overlay" in production,
 *  even if `activeTab` was left pointing at one of them (e.g. restored from a stale URL). */
const effectiveTab = computed(() =>
  maintainerTabsEnabled ? activeTab.value : "overlay",
);

const exportText = computed(() => {
  if (effectiveTab.value === "items") {
    if (!catalogExport.value) return "Loading…";
    // Composed across all enabled layers for the maintainer path.
    const allEnabled = catalog.compose(layers.enabledOverlays.value);
    return catalogExport.value.toItemsFile(allEnabled.items);
  }
  if (effectiveTab.value === "bonuses") {
    if (!catalogExport.value) return "Loading…";
    const allEnabled = catalog.compose(layers.enabledOverlays.value);
    return catalogExport.value.toBonusesFile(allEnabled.bonuses);
  }
  if (effectiveTab.value === "slots") {
    if (!catalogExport.value) return "Loading…";
    // `slots` and `sectionPresets` both fold across every enabled layer, same "maintainer
    // path" as items/bonuses above. Sections are still the static shipped ones -- an overlay
    // carries build_parameter slots, not the section structure they hang off (see
    // `CatalogOverlay.slots`).
    const allEnabled = catalog.compose(layers.enabledOverlays.value);
    return catalogExport.value.toSlotsFile(
      NW_SLOTS.sections,
      allEnabled.slots,
      allEnabled.sectionPresets,
    );
  }
  // "This layer": raw overlay JSON.
  return JSON.stringify(props.overlay, null, 2);
});

const exportName = computed(() => {
  if (effectiveTab.value === "items") return "db-items.json";
  if (effectiveTab.value === "bonuses") return "db-bonuses.json";
  if (effectiveTab.value === "slots") return "slots.json";
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
        <template v-if="maintainerTabsEnabled">
          <TabButton
            :active="effectiveTab === 'items'"
            @click="activeTab = 'items'"
            >db-items.json</TabButton
          >
          <TabButton
            :active="effectiveTab === 'bonuses'"
            @click="activeTab = 'bonuses'"
            >db-bonuses.json</TabButton
          >
          <TabButton
            :active="effectiveTab === 'slots'"
            @click="activeTab = 'slots'"
            >slots.json</TabButton
          >
        </template>
        <TabButton
          :active="effectiveTab === 'overlay'"
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
    <p class="mt-1 text-muted">
      <template v-if="effectiveTab === 'items'">
        Composed from all enabled layers — for regenerating the shipped data
        files.
      </template>
      <template v-else-if="effectiveTab === 'bonuses'">
        Composed from all enabled layers — for regenerating the shipped data
        files.
      </template>
      <template v-else-if="effectiveTab === 'slots'">
        Composed from all enabled layers' presets — for regenerating
        <code>data/slots.json</code>.
      </template>
      <template v-else> Just this layer's raw overlay JSON. </template>
    </p>
  </BaseDrawer>
</template>
