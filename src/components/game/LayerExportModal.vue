<script setup lang="ts">
// LayerEditor's export window: this layer's own raw overlay JSON, plus -- for anyone who has
// turned maintainer mode on -- the composed db-items/db-bonuses/slots files for regenerating
// the shipped data across every enabled layer. Self-contained aside from which tab is active,
// which the parent keeps so reopening it remembers the last tab.
//
// The maintainer tabs can also send their file to the local server (data/writeback.ts).
//
// Modal rather than in-flow: you come here to take a file somewhere and then leave, so
// nothing behind it matters meanwhile, and the tabs want the room.
import { computed, ref, watch, watchEffect } from "vue";
import { Copy, Download, Save } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseModal from "../ui/BaseModal.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import CodeBlock from "../ui/CodeBlock.vue";
import TabStrip from "../ui/TabStrip.vue";
import TabButton from "../ui/TabButton.vue";
import * as catalog from "../../data/catalog";
import * as layers from "../../stores/layers";
import * as maintainer from "../../stores/maintainer";
import { NW_SLOTS } from "../../data/data";
import type { CatalogOverlay } from "../../types";

const props = defineProps<{
  /** This layer's own raw overlay, for the "This layer" tab. */
  overlay: CatalogOverlay;
}>();

const emit = defineEmits<{
  notice: [message: string];
  close: [];
}>();

const activeTab = defineModel<string>({ default: "overlay" }); // items | bonuses | slots | overlay

// The maintainer tabs (items/bonuses/slots) regenerate the shipped db-*.json files -- only
// useful with the source repo on hand, so they stay behind an opt-in (stores/maintainer.ts).
const maintainerTabsEnabled = maintainer.enabled;

/** The tab actually in effect: the maintainer tabs collapse to "overlay" while the flag is
 *  off, even if `activeTab` was left pointing at one of them (e.g. remembered from an
 *  earlier session, or restored from a stale URL). */
const effectiveTab = computed(() =>
  maintainerTabsEnabled.value ? activeTab.value : "overlay",
);

// Fetched only once a maintainer tab is actually in effect, so a reader who never turns the
// flag on never pays for `catalogExport.ts`: it stays a chunk of its own that the page does
// not request.
type CatalogExportModule = typeof import("../../data/catalogExport");
type WritebackModule = typeof import("../../data/writeback");
const catalogExport = ref<CatalogExportModule | null>(null);
const writeback = ref<WritebackModule | null>(null);
watchEffect(() => {
  if (effectiveTab.value === "overlay" || catalogExport.value) return;
  import("../../data/catalogExport").then((mod) => {
    catalogExport.value = mod;
  });
  import("../../data/writeback").then((mod) => {
    writeback.value = mod;
  });
});

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
    // path" as items/bonuses above. Sections and `filterDefaults` are still the static shipped
    // ones -- an overlay carries build_parameter slots, not the section structure they hang off
    // (see `CatalogOverlay.slots`) nor the per-filter defaults.
    const allEnabled = catalog.compose(layers.enabledOverlays.value);
    return catalogExport.value.toSlotsFile(
      NW_SLOTS.sections,
      allEnabled.slots,
      allEnabled.sectionPresets,
      NW_SLOTS.filterDefaults ?? {},
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
    emit("notice", "Clipboard blocked - select the text and copy it manually");
  }
}

/** Outcome of the last send. Shown in the modal rather than as a notice behind it,
 *  since an unreachable server is started and retried from here. Cleared on a tab change so
 *  it can never describe a file other than the one on screen. */
const saveStatus = ref<{ ok: boolean; message: string } | null>(null);
const saving = ref(false);

watch(effectiveTab, () => {
  saveStatus.value = null;
});

async function sendToLocalServer() {
  const module = writeback.value;
  if (!module || saving.value) return;
  saving.value = true;
  saveStatus.value = null;
  try {
    const { repo } = await module.writeDataFile(
      exportName.value,
      exportText.value,
    );
    saveStatus.value = {
      ok: true,
      message: `Wrote ${exportName.value} to ${repo}`,
    };
  } catch (error) {
    saveStatus.value = {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : `Writing ${exportName.value} failed`,
    };
  } finally {
    saving.value = false;
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
  <BaseModal
    title="Export"
    panel-class="max-h-[85vh] w-[880px] max-w-[92vw]"
    data-testid="layer-export"
    @close="emit('close')"
  >
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div class="mb-1.5 flex flex-wrap items-end gap-2">
        <TabStrip>
          <TabButton
            :active="effectiveTab === 'overlay'"
            @click="activeTab = 'overlay'"
            >This layer</TabButton
          >
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
        </TabStrip>
        <span class="flex-1"></span>
        <BaseButton @click="copyExport"><Copy />Copy</BaseButton>
        <BaseButton @click="downloadExport"><Download />Download</BaseButton>
        <BaseTooltip
          v-if="effectiveTab !== 'overlay'"
          :text="`Writes ${exportName} into the repo through the local server started by \`npm run dev\` or \`npm run data-server\`.`"
        >
          <BaseButton
            :disabled="saving || !writeback"
            data-testid="layer-export-save"
            @click="sendToLocalServer"
            ><Save />{{
              saving ? "Sending…" : "Send to local server"
            }}</BaseButton
          >
        </BaseTooltip>
      </div>
      <CodeBlock :value="exportText" :rows="20" class="w-full" />
      <p
        v-if="saveStatus"
        class="mt-1"
        :class="saveStatus.ok ? 'text-muted' : 'text-danger'"
        data-testid="layer-export-save-status"
      >
        {{ saveStatus.message }}
      </p>
      <p class="mt-1 text-muted">
        <template v-if="effectiveTab === 'items'">
          Composed from all enabled layers - for regenerating the shipped data
          files.
        </template>
        <template v-else-if="effectiveTab === 'bonuses'">
          Composed from all enabled layers - for regenerating the shipped data
          files.
        </template>
        <template v-else-if="effectiveTab === 'slots'">
          Composed from all enabled layers' presets - for regenerating
          data/slots.json.
        </template>
        <template v-else> Just this layer's raw overlay JSON. </template>
      </p>
    </div>
  </BaseModal>
</template>
